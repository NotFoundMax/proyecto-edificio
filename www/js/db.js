const DB = {
    _default() {
        return {
            edificio: {
                nombre: 'Edificio Residencial',
                direccion: '',
                moneda: 'S/.',
                mesInicio: 1
            },
            propietarios: [
                { id: 1, nombre: '101', apellido: '', departamento: '101', coeficiente: 13.89, m2: 141.29, cuotaMensual: 0, email: '' },
                { id: 2, nombre: '201', apellido: '', departamento: '201', coeficiente: 19.07, m2: 202.72, cuotaMensual: 0, email: '' },
                { id: 3, nombre: '301', apellido: '', departamento: '301', coeficiente: 19.38, m2: 200.56, cuotaMensual: 0, email: '' },
                { id: 4, nombre: '401', apellido: '', departamento: '401', coeficiente: 15.72, m2: 150.51, cuotaMensual: 0, email: '' },
                { id: 5, nombre: '501', apellido: '', departamento: '501', coeficiente: 31.31, m2: 345.90, cuotaMensual: 0, email: '' }
            ],
            gastos: [],
            pagos: [],
            personal: [],
            jardineria: [],
            aguaFacturas: {},
            cajaChica: {},
            cajaMes: {},
            nextId: { propietario: 6, gasto: 1, pago: 1, personal: 1, jardineria: 1 }
        };
    },

    _load() {
        try {
            const raw = StorageEngine.getLocal();
            if (!raw) return this._default();
            const data = JSON.parse(raw);
            if (!data.nextId) data.nextId = { propietario: 1, gasto: 1, pago: 1 };
            ['personal', 'jardineria'].forEach(k => {
                if (!data.nextId[k]) data.nextId[k] = 1;
            });
            if (!data.edificio) data.edificio = this._default().edificio;
            if (!data.edificio.moneda) data.edificio.moneda = 'S/.';
            if (!data.cajaChica) data.cajaChica = {};
            if (!data.cajaMes) data.cajaMes = {};
            if (!data.propietarios) data.propietarios = [];
            if (!data.gastos) data.gastos = [];
            if (!data.pagos) data.pagos = [];
            if (!data.personal) data.personal = [];
            if (!data.jardineria) data.jardineria = [];
            if (!data.aguaFacturas) data.aguaFacturas = {};
            if (!data.gasFecha) data.gasFecha = {};

            data.gastos.forEach(g => {
                if (!g.mes) {
                    const m = (g.fecha || '').match(/^(\d{4})-(\d{2})/);
                    if (m) {
                        g.mes = `${m[1]}-${m[2]}`;
                    } else {
                        const now = new Date();
                        g.mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    }
                }
            });

            // Un edificio creado desde la app arranca vacio: no se le
            // inyectan los departamentos de ejemplo de Los Castanos.
            if (!data.sinDefaults) {
                const defaults = this._default().propietarios;
                defaults.forEach(dp => {
                    if (!data.propietarios.find(p => p.departamento === dp.departamento)) {
                        data.propietarios.push({ ...dp, id: data.nextId.propietario++ });
                    }
                });
            }

            data.propietarios.forEach(p => {
                if (p.cuotaMensual === undefined) p.cuotaMensual = 0;
                if (p.apellido === undefined) p.apellido = '';
            });

            data.personal.forEach(p => {
                if (!p.tipo) p.tipo = 'personal';
            });

            return data;
        } catch {
            return this._default();
        }
    },

    onWriteBlocked: null,

    _save(data) {
        if (typeof Auth !== 'undefined' && Auth.edificioActivo && !Auth.canWrite()) {
            if (this.onWriteBlocked) this.onWriteBlocked();
            return;
        }
        StorageEngine.setLocal(JSON.stringify(data));
        StorageEngine.push(data);
    },

    async syncFromServer() {
        try {
            const data = await StorageEngine.pull();
            if (data && data.propietarios) {
                StorageEngine.setLocal(JSON.stringify(data));
                return true;
            }
        } catch {
            // Backend unavailable, keep localStorage data
        }
        return false;
    },

    _nextId(data, type) {
        const id = data.nextId[type];
        data.nextId[type] = id + 1;
        return id;
    },

    getMoneda() {
        return this._load().edificio.moneda || 'S/.';
    },

    // === Edificio ===
    getConfig() {
        return this._load().edificio;
    },

    saveConfig(config) {
        const data = this._load();
        data.edificio = { ...data.edificio, ...config };
        this._save(data);
    },

    // === Propietarios ===
    getPropietarios() {
        const data = this._load();
        const props = data.propietarios || [];
        // Recalcular coeficientes para que siempre sumen 100%
        const totalM2 = props.reduce((s, p) => s + (Number(p.m2) || 0), 0);
        props.forEach(p => {
            p.coeficiente = totalM2 > 0 ? (Number(p.m2) || 0) / totalM2 * 100 : 0;
            p.coeficiente = Math.round(p.coeficiente * 100) / 100;
        });
        // Ajuste de residual en el último
        const suma = props.reduce((s, p) => s + p.coeficiente, 0);
        const residual = Math.round((100 - suma) * 100) / 100;
        if (residual !== 0 && props.length > 0) {
            props[props.length - 1].coeficiente = Math.round((props[props.length - 1].coeficiente + residual) * 100) / 100;
        }
        return props;
    },

    getPropietario(id) {
        return this._load().propietarios.find(p => p.id === id);
    },

    savePropietario(propietario) {
        const data = this._load();
        if (propietario.id) {
            const idx = data.propietarios.findIndex(p => p.id === propietario.id);
            if (idx !== -1) data.propietarios[idx] = { ...data.propietarios[idx], ...propietario };
        } else {
            propietario.id = this._nextId(data, 'propietario');
            data.propietarios.push(propietario);
        }
        // Recalcular coeficientes de TODOS los departamentos para que sumen 100%
        const totalM2 = data.propietarios.reduce((s, p) => s + (Number(p.m2) || 0), 0);
        data.propietarios.forEach(p => {
            p.coeficiente = totalM2 > 0 ? (Number(p.m2) || 0) / totalM2 * 100 : 0;
            // Redondear a 2 decimales
            p.coeficiente = Math.round(p.coeficiente * 100) / 100;
        });
        // Ajuste de céntimos: el último departamento absorbe el residual
        const sumaCoef = data.propietarios.reduce((s, p) => s + p.coeficiente, 0);
        const residual = Math.round((100 - sumaCoef) * 100) / 100;
        if (residual !== 0 && data.propietarios.length > 0) {
            const ultimo = data.propietarios[data.propietarios.length - 1];
            ultimo.coeficiente = Math.round((ultimo.coeficiente + residual) * 100) / 100;
        }
        this._save(data);
        // Devolver el propietario actualizado con su nuevo coeficiente
        return data.propietarios.find(p => p.id === propietario.id) || propietario;
    },

    deletePropietario(id) {
        const data = this._load();
        data.propietarios = data.propietarios.filter(p => p.id !== id);
        // Recalcular coeficientes de los restantes
        const totalM2 = data.propietarios.reduce((s, p) => s + (Number(p.m2) || 0), 0);
        data.propietarios.forEach(p => {
            p.coeficiente = totalM2 > 0 ? (Number(p.m2) || 0) / totalM2 * 100 : 0;
            p.coeficiente = Math.round(p.coeficiente * 100) / 100;
        });
        const sumaCoef = data.propietarios.reduce((s, p) => s + p.coeficiente, 0);
        const residual = Math.round((100 - sumaCoef) * 100) / 100;
        if (residual !== 0 && data.propietarios.length > 0) {
            const ultimo = data.propietarios[data.propietarios.length - 1];
            ultimo.coeficiente = Math.round((ultimo.coeficiente + residual) * 100) / 100;
        }
        this._save(data);
    },

    // === Gastos ===
    getGastos(filtros = {}) {
        let gastos = this._load().gastos;
        if (filtros.mes) {
            gastos = gastos.filter(g => {
                if (g.frecuencia === 'extraordinario') {
                    return g.mes === filtros.mes;
                }
                return this._gastoAplicaEnMes(g, filtros.mes);
            });
        }
        if (filtros.categoria) {
            gastos = gastos.filter(g => g.categoria === filtros.categoria);
        }
        return gastos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    },

    getData() {
        return this._load();
    },

    getGastosRaw() {
        return this._load().gastos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    },

    getGasto(id) {
        return this._load().gastos.find(g => g.id === id);
    },

    saveGasto(gasto) {
        const data = this._load();
        const fecha = new Date(gasto.fecha);
        gasto.mes = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

        if (gasto.id) {
            const idx = data.gastos.findIndex(g => g.id === gasto.id);
            if (idx !== -1) data.gastos[idx] = { ...data.gastos[idx], ...gasto };
        } else {
            gasto.id = this._nextId(data, 'gasto');
            data.gastos.push(gasto);
        }
        this._save(data);
        return gasto;
    },

    deleteGasto(id) {
        const data = this._load();
        data.gastos = data.gastos.filter(g => g.id !== id);
        this._save(data);
    },

    _gastoAplicaEnMes(gasto, mesKey) {
        if (!gasto.mes) return true;
        const [gYear, gMonth] = gasto.mes.split('-').map(Number);
        const [tYear, tMonth] = mesKey.split('-').map(Number);

        const gDate = new Date(gYear, gMonth - 1);
        const tDate = new Date(tYear, tMonth - 1);
        const diffMonths = (tDate.getFullYear() - gDate.getFullYear()) * 12 + (tDate.getMonth() - gDate.getMonth());

        if (diffMonths < 0) return false;

        switch (gasto.frecuencia) {
            case 'mensual': return true;
            case 'trimestral': return diffMonths % 3 === 0;
            case 'semestral': return diffMonths % 6 === 0;
            case 'anual': return diffMonths % 12 === 0;
            case 'unico': return diffMonths === 0;
            case 'extraordinario': return gasto.mes === mesKey;
            default: return diffMonths === 0;
        }
    },

    // === Pagos ===
    getPagos(mes) {
        return this._load().pagos.filter(p => p.mes === mes);
    },

    savePago(pago) {
        const data = this._load();
        if (!pago.tipo) pago.tipo = 'fija';
        if (pago.id) {
            const idx = data.pagos.findIndex(p => p.id === pago.id);
            if (idx !== -1) data.pagos[idx] = { ...data.pagos[idx], ...pago };
        } else {
            pago.id = this._nextId(data, 'pago');
            data.pagos.push(pago);
        }
        this._save(data);
        return pago;
    },

    deletePago(id) {
        const data = this._load();
        data.pagos = data.pagos.filter(p => p.id !== id);
        this._save(data);
    },

    // === Caja Chica ===
    getCajaChica(mes) {
        const data = this._load();
        if (!data.cajaChica) data.cajaChica = {};
        if (data.cajaChica[mes] !== undefined) return data.cajaChica[mes];
        return 0;
    },

    saveCajaChica(mes, monto) {
        const data = this._load();
        if (!data.cajaChica) data.cajaChica = {};
        data.cajaChica[mes] = monto;
        this._save(data);
    },

    // === Caja del Mes ===
    getCajaMes(mes) {
        const data = this._load();
        if (!data.cajaMes) data.cajaMes = {};
        return data.cajaMes[mes] || 0;
    },

    saveCajaMes(mes, monto) {
        const data = this._load();
        if (!data.cajaMes) data.cajaMes = {};
        data.cajaMes[mes] = monto;
        this._save(data);
    },

    // === Cierre de Mes ===
    cerrarMes(mes) {
        const data = this._load();
        if (!data.cajaChica) data.cajaChica = {};
        if (!data.cajaMes) data.cajaMes = {};

        const cajaMes = data.cajaMes[mes] || 0;
        const cajaChicaActual = data.cajaChica[mes] || 0;
        const nuevoSaldo = cajaChicaActual + cajaMes;

        data.cajaChica[mes] = nuevoSaldo;
        data.cajaMes[mes] = 0;

        this._save(data);
        return nuevoSaldo;
    },

    // === Mes Actual (persistido para no saltar de mes sin cerrar) ===
    getMesActual() {
        return this._load().mesActual || null;
    },

    saveMesActual(mes) {
        const data = this._load();
        data.mesActual = mes;
        this._save(data);
    },

    // === Migración única: datos cargados en el mes actual que correspondían al anterior ===
    migrateMesActual() {
        const data = this._load();
        const from = Calculos.getCurrentMes();
        const to = Calculos.shiftMes(from, -1);
        if (!data.migrations) data.migrations = {};
        if (data.migrations.mesActual2026) return false;

        const [ty, tm] = to.split('-').map(Number);
        const ultimoDia = new Date(ty, tm, 0).getDate();
        const shiftFecha = (fecha) => {
            if (!fecha || typeof fecha !== 'string') return fecha;
            const [y, m, d] = fecha.split('-').map(Number);
            if (!y || !m || !d) return fecha;
            return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
        };

        let moved = false;

        data.gastos.forEach(g => {
            if (g.mes === from) {
                g.mes = to;
                g.fecha = shiftFecha(g.fecha);
                moved = true;
            }
        });
        data.pagos.forEach(p => {
            if (p.mes === from) {
                p.mes = to;
                p.fecha = shiftFecha(p.fecha);
                moved = true;
            }
        });

        if (data.gas && data.gas[from]) {
            if (!data.gas[to]) data.gas[to] = {};
            Object.assign(data.gas[to], data.gas[from]);
            delete data.gas[from];
            moved = true;
        }
        if (data.gasFecha && data.gasFecha[from]) {
            data.gasFecha[to] = data.gasFecha[from];
            delete data.gasFecha[from];
            moved = true;
        }
        if (data.agua && data.agua[from]) {
            if (!data.agua[to]) data.agua[to] = {};
            Object.assign(data.agua[to], data.agua[from]);
            delete data.agua[from];
            moved = true;
        }
        if (data.aguaFacturas && data.aguaFacturas[from]) {
            data.aguaFacturas[to] = data.aguaFacturas[from];
            delete data.aguaFacturas[from];
            moved = true;
        }
        if (data.cajaChica && data.cajaChica[from]) {
            data.cajaChica[to] = (data.cajaChica[to] || 0) + data.cajaChica[from];
            delete data.cajaChica[from];
            moved = true;
        }
        if (data.cajaMes && data.cajaMes[from]) {
            data.cajaMes[to] = (data.cajaMes[to] || 0) + data.cajaMes[from];
            delete data.cajaMes[from];
            moved = true;
        }

        data.migrations.mesActual2026 = true;
        if (moved || !data.mesActual) data.mesActual = to;
        this._save(data);
        return moved;
    },

    // === Backup ===
    exportAll() {
        return JSON.stringify(this._load(), null, 2);
    },

    importAll(jsonStr) {
        const data = JSON.parse(jsonStr);
        this._save(data);
    },

    resetAll() {
        StorageEngine.removeLocal();
    },

    isFirstRun() {
        return !StorageEngine.getLocal();
    },

    initFirstRun() {
        const hadCache = !!StorageEngine.getLocal();
        const data = this._load();
        let needsSave = false;

        if (!data.cajaChica) {
            data.cajaChica = {};
            needsSave = true;
        }
        if (!data.edificio.moneda) {
            data.edificio.moneda = 'S/.';
            needsSave = true;
        }
        if (!data.sinDefaults && (!data.propietarios || data.propietarios.length === 0)) {
            data.propietarios = this._default().propietarios;
            data.nextId = { ...this._default().nextId, ...data.nextId };
            needsSave = true;
        }

        // Sin cache local significa que tampoco hubo descarga: en ese caso
        // no se sube nada, o se mandarian los datos por defecto de otro
        // edificio.
        if (needsSave && hadCache) this._save(data);
    },

    // === Gas ===
    getGas(mes) {
        const data = this._load();
        if (!data.gas) data.gas = {};
        return data.gas[mes] || {};
    },

    saveGas(mes, depto, lecturaIni, lecturaFin, fechaIni, fechaFin) {
        const data = this._load();
        if (!data.gas) data.gas = {};
        if (!data.gas[mes]) data.gas[mes] = {};
        data.gas[mes][depto] = {
            lecturaIni,
            lecturaFin,
            fechaIni: fechaIni || '',
            fechaFin: fechaFin || ''
        };
        this._save(data);
    },

    getGasFechas(mes) {
        const data = this._load();
        if (data.gasFecha && data.gasFecha[mes]) return data.gasFecha[mes];
        const gas = data.gas && data.gas[mes];
        if (gas) {
            for (const depto of Object.keys(gas)) {
                const d = gas[depto];
                if (d && (d.fechaIni || d.fechaFin)) return { inicio: d.fechaIni || '', fin: d.fechaFin || '' };
            }
        }
        return { inicio: '', fin: '' };
    },

    saveGasFechas(mes, inicio, fin) {
        const data = this._load();
        if (!data.gasFecha) data.gasFecha = {};
        data.gasFecha[mes] = { inicio: inicio || '', fin: fin || '' };
        this._save(data);
    },

    getGasParams() {
        const data = this._load();
        const p = data.gasParams || {};
        return {
            precioBalon: p.precioBalon || 245,
            kgBalon: p.kgBalon || 45,
            kgM3: p.kgM3 || 2.464,
            nBalones: p.nBalones || 3
        };
    },

    saveGasParams(params) {
        const data = this._load();
        data.gasParams = params;
        this._save(data);
    },

    // === Agua ===
    getAgua(mes) {
        const data = this._load();
        if (!data.agua) data.agua = {};
        return data.agua[mes] || {};
    },

    saveAgua(mes, depto, lecturaIni, lecturaFin) {
        const data = this._load();
        if (!data.agua) data.agua = {};
        if (!data.agua[mes]) data.agua[mes] = {};
        data.agua[mes][depto] = { lecturaIni, lecturaFin };
        this._save(data);
    },

    getAguaFechas(mes) {
        const data = this._load();
        if (data.aguaFecha && data.aguaFecha[mes]) return data.aguaFecha[mes];
        return { inicio: '', fin: '' };
    },

    saveAguaFechas(mes, inicio, fin) {
        const data = this._load();
        if (!data.aguaFecha) data.aguaFecha = {};
        data.aguaFecha[mes] = { inicio: inicio || '', fin: fin || '' };
        this._save(data);
    },

    // === Personal (porteros, descansero, mantenimiento) ===
    ROLES_PERSONAL: {
        portero: { label: 'Portero', categoria: 'porteria' },
        descansero: { label: 'Descansero', categoria: 'descansero' },
        mantenimiento: { label: 'Mantenimiento', categoria: 'mantenimiento' },
        jardinero: { label: 'Jardinería', categoria: 'jardineria' },
        administracion: { label: 'Administración', categoria: 'administracion' },
        otros: { label: 'Otros', categoria: 'otros' }
    },

    getPersonal() {
        return this._load().personal;
    },

    getPersonalId(id) {
        return this._load().personal.find(p => p.id === id);
    },

    _syncGastoFijo(data, item) {
        const idx = data.gastos.findIndex(g => g.personalId === item.id && (g.origen === 'sueldo' || g.origen === 'fijo'));
        const tipo = item.tipo || 'personal';
        const isPersonal = tipo === 'personal';
        const monto = parseFloat(isPersonal ? item.sueldoMensual : item.monto) || 0;

        if (monto <= 0) {
            if (idx !== -1) data.gastos.splice(idx, 1);
            return;
        }

        const now = new Date();
        const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const mes = item.mesDesde || currentMes;
        const rol = this.ROLES_PERSONAL[item.rol] || this.ROLES_PERSONAL.otros;

        const base = isPersonal
            ? { concepto: `Sueldo ${item.nombre} (${rol.label})`, categoria: rol.categoria }
            : { concepto: item.nombre, categoria: item.categoria || 'otros' };

        if (idx !== -1) {
            const existing = data.gastos[idx];
            if (isPersonal) {
                data.gastos[idx] = { ...existing, ...base, monto };
            } else {
                data.gastos[idx] = {
                    ...existing,
                    ...base,
                    monto,
                    mes,
                    fecha: `${mes}-01`,
                    frecuencia: item.frecuencia || 'mensual',
                    division: 'proporcional',
                    pagado: true,
                    notas: item.notas || '',
                    origen: 'fijo',
                    personalId: item.id
                };
            }
            return;
        }

        data.gastos.push({
            ...base,
            monto,
            id: this._nextId(data, 'gasto'),
            mes,
            fecha: isPersonal
                ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                : `${mes}-01`,
            frecuencia: isPersonal ? 'mensual' : (item.frecuencia || 'mensual'),
            division: 'proporcional',
            pagado: true,
            notas: item.notas || '',
            origen: isPersonal ? 'sueldo' : 'fijo',
            personalId: item.id
        });
    },

    savePersonal(personal) {
        const data = this._load();
        if (personal.id) {
            const idx = data.personal.findIndex(p => p.id === personal.id);
            if (idx !== -1) data.personal[idx] = { ...data.personal[idx], ...personal };
        } else {
            personal.id = this._nextId(data, 'personal');
            data.personal.push(personal);
        }
        this._syncGastoFijo(data, personal);
        this._save(data);
        return personal;
    },

    deletePersonal(id) {
        const data = this._load();
        data.personal = data.personal.filter(p => p.id !== id);
        data.gastos = data.gastos.filter(g => !((g.origen === 'sueldo' || g.origen === 'fijo') && g.personalId === id));
        this._save(data);
    },

    // === Jardinería ===
    getJardineria() {
        return this._load().jardineria;
    },

    getJardineriaId(id) {
        return this._load().jardineria.find(j => j.id === id);
    },

    saveJardineria(item) {
        const data = this._load();
        if (item.id) {
            const idx = data.jardineria.findIndex(j => j.id === item.id);
            if (idx !== -1) data.jardineria[idx] = { ...data.jardineria[idx], ...item };
        } else {
            item.id = this._nextId(data, 'jardineria');
            data.jardineria.push(item);
        }
        this._save(data);
        return item;
    },

    deleteJardineria(id) {
        const data = this._load();
        data.jardineria = data.jardineria.filter(j => j.id !== id);
        this._save(data);
    },

    // === Tarifa del agua (Doméstico 1) ===
    _aguaParamsDefault() {
        return {
            tramosAgua: [
                { hasta: 20, precio: 1.499 },
                { hasta: 50, precio: 2.128 },
                { hasta: null, precio: 5.438 }
            ],
            tramosAlcant: [
                { hasta: 20, precio: 0.935 },
                { hasta: 50, precio: 1.309 },
                { hasta: null, precio: 2.592 }
            ]
        };
    },

    getAguaParams() {
        const data = this._load();
        const def = this._aguaParamsDefault();
        return {
            tramosAgua: (data.aguaParams && data.aguaParams.tramosAgua) || def.tramosAgua,
            tramosAlcant: (data.aguaParams && data.aguaParams.tramosAlcant) || def.tramosAlcant
        };
    },

    saveAguaParams(params) {
        const data = this._load();
        data.aguaParams = {
            tramosAgua: params.tramosAgua,
            tramosAlcant: params.tramosAlcant
        };
        this._save(data);
    },

    // === Factura de agua (recibo del mes) ===
    getFacturaAgua(mes) {
        const data = this._load();
        return (data.aguaFacturas && data.aguaFacturas[mes]) || null;
    },

    saveFacturaAgua(mes, factura) {
        const data = this._load();
        if (!data.aguaFacturas) data.aguaFacturas = {};
        data.aguaFacturas[mes] = {
            consumo: factura.consumo,
            aguaPotable: factura.aguaPotable,
            alcantarillado: factura.alcantarillado,
            cargoFijo: factura.cargoFijo,
            igv: factura.igv,
            igvPct: factura.igvPct
        };
        this._save(data);
    },

    // === Luz (recibo mensual) ===
    getLuz(mes) {
        const data = this._load();
        if (!data.luz) data.luz = {};
        return data.luz[mes] || {};
    },

    saveLuz(mes, area, lecturaIni, lecturaFin) {
        const data = this._load();
        if (!data.luz) data.luz = {};
        if (!data.luz[mes]) data.luz[mes] = {};
        data.luz[mes][area] = { lecturaIni, lecturaFin };
        this._save(data);
    },

    getLuzFechas(mes) {
        const data = this._load();
        if (data.luzFecha && data.luzFecha[mes]) return data.luzFecha[mes];
        return { inicio: '', fin: '' };
    },

    saveLuzFechas(mes, inicio, fin) {
        const data = this._load();
        if (!data.luzFecha) data.luzFecha = {};
        data.luzFecha[mes] = { inicio: inicio || '', fin: fin || '' };
        this._save(data);
    },

    getGastoLuz(mes) {
        return this._load().gastos.find(g => g.origen === 'luz' && g.mes === mes) || null;
    },

    saveGastoLuz(mes, monto, pagado) {
        const data = this._load();
        const [year, month] = mes.split('-').map(Number);
        const ultimoDia = String(new Date(year, month, 0).getDate()).padStart(2, '0');
        const idx = data.gastos.findIndex(g => g.origen === 'luz' && g.mes === mes);

        if (monto <= 0) {
            if (idx !== -1) {
                data.gastos.splice(idx, 1);
                this._save(data);
            }
            return null;
        }

        if (idx !== -1) {
            data.gastos[idx] = { ...data.gastos[idx], monto, pagado };
        } else {
            data.gastos.push({
                id: this._nextId(data, 'gasto'),
                concepto: 'Recibo de luz',
                monto,
                mes,
                fecha: `${mes}-${ultimoDia}`,
                categoria: 'luz',
                frecuencia: 'mensual',
                division: 'proporcional',
                pagado,
                notas: '',
                origen: 'luz'
            });
        }
        this._save(data);
        return data.gastos[idx >= 0 ? idx : data.gastos.length - 1];
    }
};
