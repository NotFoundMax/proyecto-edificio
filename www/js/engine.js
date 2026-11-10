const StorageEngine = {
    ACTIVE_KEY: 'gastos_edificio_activo',
    _localApi: '/api/data',
    _syncPending: false,
    edificioId: null,

    getEdificioId() {
        if (!this.edificioId) {
            const saved = localStorage.getItem(this.ACTIVE_KEY);
            this.edificioId = saved ? parseInt(saved, 10) || 1 : 1;
        }
        return this.edificioId;
    },

    setEdificioId(id) {
        this.edificioId = id;
        localStorage.setItem(this.ACTIVE_KEY, String(id));
    },

    _key() {
        this._migrateLegacy();
        return 'gastos_edificio_data_' + this.getEdificioId();
    },

    // La app anterior guardaba todo en 'gastos_edificio_data' (un solo
    // edificio). Sin esto, un arranque sin red caeria en los datos demo y
    // podria subirlos al servidor. La clave vieja no se borra.
    _migrateLegacy() {
        if (this._legacyChecked) return;
        this._legacyChecked = true;
        const legacy = localStorage.getItem('gastos_edificio_data');
        if (!legacy) return;
        if (!localStorage.getItem('gastos_edificio_data_1')) {
            localStorage.setItem('gastos_edificio_data_1', legacy);
        }
    },

    getLocal() {
        return localStorage.getItem(this._key());
    },

    setLocal(json) {
        localStorage.setItem(this._key(), json);
    },

    removeLocal() {
        localStorage.removeItem(this._key());
    },

    async pull() {
        try {
            if (APP_CONFIG.engine === 'supabase') {
                return await this._pullSupabase();
            }
            return await this._pullLocalServer();
        } catch {
            return null;
        }
    },

    async push(data) {
        if (this._syncPending) return;
        this._syncPending = true;
        try {
            if (APP_CONFIG.engine === 'supabase') {
                await this._pushSupabase(data);
            } else {
                await fetch(this._localApi, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            }
        } catch (err) {
            console.warn('No se pudo sincronizar', err);
        } finally {
            this._syncPending = false;
        }
    },

    async _pullLocalServer() {
        const resp = await fetch(this._localApi);
        if (!resp.ok) return null;
        return await resp.json();
    },

    async _pullSupabase() {
        const ed = this.getEdificioId();
        const url = APP_CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/app_data?edificio_id=eq.' + ed + '&select=data';
        const resp = await fetch(url, {
            headers: this._authHeaders()
        });
        if (!resp.ok) return null;
        const rows = await resp.json();
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows[0].data || null;
    },

    async _pushSupabase(data) {
        const ed = this.getEdificioId();
        const url = APP_CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/app_data?on_conflict=edificio_id';
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                ...this._authHeaders(),
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                edificio_id: ed,
                data: data,
                updated_at: new Date().toISOString()
            })
        });
        if (!resp.ok) {
            throw await this._pgError(resp, 'No se pudo guardar');
        }
    },

    // PostgREST devuelve el detalle de Postgres en el CUERPO de la
    // respuesta, no en la consola del navegador. Sin esto el usuario
    // solo ve "Failed to load resource: 400" y no hay forma de
    // diagnosticar nada.
    async _pgError(resp, contexto) {
        const crudo = await resp.text();
        let info = null;
        try {
            info = JSON.parse(crudo);
        } catch {
            info = null;
        }

        // El cuerpo crudo siempre en consola, por si hace falta.
        console.error('[' + contexto + '] HTTP ' + resp.status, crudo);

        const partes = [contexto + ': HTTP ' + resp.status];
        if (info && info.message) {
            partes.push('PG ' + (info.code || '????') + ': ' + info.message);
        } else if (crudo) {
            partes.push(crudo.slice(0, 300));
        }
        if (info && info.hint) partes.push('Sugerencia: ' + info.hint);
        if (info && info.details) partes.push('Detalle: ' + info.details);

        const err = new Error(partes.join('\n'));
        err.status = resp.status;
        err.pgCode = info ? info.code : null;
        return err;
    },

    _authHeaders() {
        const key = APP_CONFIG.supabaseAnonKey;
        const headers = { apikey: key };
        const token = (typeof Auth !== 'undefined' && Auth.session) ? Auth.session.access_token : null;
        if (token) {
            headers.Authorization = 'Bearer ' + token;
        } else if (key.startsWith('eyJ')) {
            headers.Authorization = 'Bearer ' + key;
        }
        return headers;
    }
};
