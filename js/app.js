const App = {
    currentScreen: 'dashboard',
    currentMes: Calculos.getCurrentMes(),
    perfil: null,
    loginMode: 'login',

    async init() {
        Auth.init();
        this.bindAuth();
        const session = await Auth.getSession();
        if (!session) {
            this.showLogin();
            return;
        }
        await this.resolverAcceso();
    },

    // PostgREST responde PGRST205 / 404 cuando la tabla todavia no existe
    // en el backend: casi siempre significa "falta aplicar la migracion".
    migracionFalta(err) {
        if (!err) return false;
        const status = err.status || (err.response && err.response.status);
        return err.code === 'PGRST205' || status === 404;
    },

    // Decide a donde va el usuario: login, sin acceso, pendiente o la app.
    async resolverAcceso() {
        // getSession() devuelve la sesion guardada aunque este vencida.
        // getUser() la valida contra el servidor y detecta el refresh fallido.
        try {
            const user = await Auth.getUser();
            if (!user) throw new Error('sin sesion valida');
        } catch (err) {
            await Auth.logout();
            this.showLogin();
            this.showLoginInfo('Tu sesion expiro. Volve a entrar.');
            return;
        }

        const perfil = await Auth.getPerfil();
        if (!perfil) {
            this.showLogin();
            return;
        }
        this.perfil = perfil;
        try {
            await Auth.getMembresias();
            await Auth.getInvitaciones();
            await Auth.getEdificiosVisibles();
        } catch (err) {
            console.error('No se pudieron cargar las membresias:', (err && err.message) || err);
            this.showLogin();
            this.showLoginInfo(this.migracionFalta(err)
                ? 'La base de datos todavia no tiene las tablas de edificios. Aplica SQL_EDIFICIOS.sql en el SQL Editor de Supabase.'
                : 'No se pudieron cargar tus edificios. Revisa tu conexion e intenta de nuevo.');
            return;
        }

        const aprobados = Auth.miembrosAprobados();
        if (aprobados.length === 0) {
            if (Auth.miembrosPendientes().length > 0) this.showPendiente();
            else this.showAcceso();
            return;
        }

        // Puerta de entrada: siempre se elige el edificio antes de entrar.
        this.showEdificios();
    },

    // === Menu de edificios ===
    showEdificios() {
        this.enApp = false;
        this.enMenuEdificios = true;
        this.hideChrome();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-edificios').classList.add('active');
        this.renderEdificios();
    },

    renderEdificios() {
        const cont = document.getElementById('lista-edificios-menu');
        const zonaCrear = document.getElementById('crear-desde-menu');
        if (!cont) return;

        zonaCrear.style.display = Auth.esAdminDeAlguno() ? 'block' : 'none';

        const mios = Auth.miembrosAprobados();
        const ultimo = StorageEngine.getEdificioId();
        const rolLabel = m => m.es_owner ? 'Owner' : (m.rol === 'admin' ? 'Admin' : 'Propietario');

        cont.innerHTML = mios.map(m => `
            <button class="list-item edificio-item" data-ed="${m.edificio_id}">
                <div class="list-item-info" style="text-align:left;">
                    <div class="list-item-title">${this.esc(this.nombreEdificio(m.edificio_id))}</div>
                    <div class="list-item-subtitle">
                        ${this.esc((Auth.edificios.find(e => e.id === m.edificio_id) || {}).direccion || 'Sin dirección')}
                        · ${rolLabel(m)}
                    </div>
                </div>
                <span class="edificio-entrar">Entrar →</span>
            </button>
        `).join('');

        cont.querySelectorAll('.edificio-item').forEach(btn => {
            const id = Number(btn.dataset.ed);
            if (id === ultimo) btn.classList.add('ultimo');
            btn.addEventListener('click', () => this.entrarAEdificio(id));
        });
    },

    async entrarAEdificio(id) {
        this.setEdificioActivo(id);
        this.startApp();
    },

    setEdificioActivo(id) {
        Auth.setEdificioActivo(id);
        StorageEngine.setEdificioId(id);
    },

    startApp() {
        this.enApp = true;
        this.enMenuEdificios = false;
        DB.onWriteBlocked = () => this.toast('Modo solo lectura: solo el administrador de este edificio puede modificar', 'error');
        this.showChrome();
        this.applyRole();
        // Primero descarga, despues siembra: si se sembrara antes, un
        // edificio recien creado (sin cache local) partiria de los datos
        // demo y los subiria al servidor.
        DB.syncFromServer().then(() => {
            DB.initFirstRun();
            DB.migrateMesActual();
            this.currentMes = this.loadMesInicial();
            this.applyRole();
            this.render();
        });
        this.populateCategorias();
        this.bindNavigation();
        this.bindModals();
        this.bindForms();
        this.bindMonthSelectors();
        this.bindConfig();
        this.bindExport();
        this.bindFilters();
        this.bindGastoFrecuencia();
        this.navigateTo('dashboard');
    },

    loadMesInicial() {
        const sistema = Calculos.getCurrentMes();
        const guardado = DB.getMesActual();
        if (guardado && guardado <= sistema) return guardado;
        const meses = Calculos.getMesesConDatos();
        const ultimo = meses[0];
        if (ultimo && ultimo <= sistema) return ultimo;
        return sistema;
    },

    // === Auth UI ===
    bindAuth() {
        document.getElementById('form-login').addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.loginMode === 'signup') this.doSignup();
            else this.doLogin();
        });

        document.getElementById('btn-toggle-signup').addEventListener('click', () => {
            this.switchLoginMode(this.loginMode === 'signup' ? 'login' : 'signup');
        });

        document.getElementById('btn-forgot-password').addEventListener('click', () => this.forgotPassword());

        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-logout-pendiente').addEventListener('click', () => this.logout());
        document.getElementById('btn-logout-acceso').addEventListener('click', () => this.logout());
        document.getElementById('btn-logout-menu').addEventListener('click', () => this.logout());

        document.getElementById('error-panel-close').addEventListener('click', () => this.ocultarError());

        document.getElementById('form-crear-edificio-menu').addEventListener('submit', (e) => {
            e.preventDefault();
            this.crearEdificio('menu-edificio-nombre', 'menu-edificio-direccion');
        });

        document.getElementById('edificio-select').addEventListener('change', (e) => {
            this.switchEdificio(Number(e.target.value));
        });

        document.getElementById('form-crear-edificio').addEventListener('submit', (e) => {
            e.preventDefault();
            this.crearEdificio('nuevo-edificio-nombre', 'nuevo-edificio-direccion');
        });
        document.getElementById('form-crear-edificio-config').addEventListener('submit', (e) => {
            e.preventDefault();
            this.crearEdificio('config-edificio-nombre', 'config-edificio-direccion');
        });
        document.getElementById('form-invitar').addEventListener('submit', (e) => {
            e.preventDefault();
            this.enviarInvitacion();
        });
    },

    hideChrome() {
        document.getElementById('app-header').style.display = 'none';
        document.getElementById('bottom-nav').style.display = 'none';
    },

    showChrome() {
        document.getElementById('app-header').style.display = '';
        document.getElementById('bottom-nav').style.display = '';
    },

    showLogin(perfilInvalido = false) {
        this.enApp = false;
        this.enMenuEdificios = false;
        this.hideChrome();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-login').classList.add('active');
        this.switchLoginMode('login');
        this.clearLoginFeedback();
    },

    showPendiente() {
        this.enApp = false;
        this.enMenuEdificios = false;
        this.hideChrome();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-pendiente').classList.add('active');
        const pendiente = Auth.miembrosPendientes()[0];
        const detalle = document.getElementById('pendiente-detalle');
        if (pendiente && detalle) {
            // Si el edificio es privado, la RLS todavia no deja ver su
            // nombre: en ese caso el mensaje va sin nombre.
            const ed = Auth.edificios.find(x => x.id === pendiente.edificio_id);
            const para = ed ? ' para ' + ed.nombre : '';
            detalle.textContent = 'Tu solicitud' + para + ' fue enviada. El administrador del edificio tiene que aprobarla antes de que puedas ver los estados de cuenta.';
        }
    },

    // El usuario esta registrado pero no tiene ningun edificio aprobado.
    showAcceso() {
        this.enApp = false;
        this.enMenuEdificios = false;
        this.hideChrome();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-acceso').classList.add('active');
        this.renderAcceso();
    },

    async renderAcceso() {
        await Auth.getEdificiosPublicos();

        const zonaInv = document.getElementById('invitaciones-pendientes');
        const zonaSol = document.getElementById('solicitar-acceso');
        const zonaCrear = document.getElementById('crear-edificio-zona');
        const pendientes = Auth.miembrosPendientes().map(m => m.edificio_id);

        zonaInv.style.display = Auth.invitaciones.length ? 'block' : 'none';
        zonaSol.style.display = Auth.edificiosPublicos.length ? 'block' : 'none';
        zonaCrear.style.display = Auth.esAdminDeAlguno() ? 'block' : 'none';

        const contInv = document.getElementById('lista-invitaciones');
        contInv.innerHTML = Auth.invitaciones.map(inv => `
            <div class="list-item">
                <div class="list-item-info">
                    <div class="list-item-title">${this.nombreEdificio(inv.edificio_id)}</div>
                    <div class="list-item-subtitle">Invitación para administrar</div>
                </div>
                <button class="btn btn-sm btn-primary invitacion-aceptar" data-id="${inv.id}">Aceptar</button>
            </div>
        `).join('');
        contInv.querySelectorAll('.invitacion-aceptar').forEach(btn => {
            btn.addEventListener('click', () => this.aceptarInvitacion(Number(btn.dataset.id)));
        });

        const contSol = document.getElementById('lista-edificios');
        contSol.innerHTML = Auth.edificiosPublicos.map(ed => {
            const yaSolicito = pendientes.includes(ed.id);
            return `
            <div class="list-item">
                <div class="list-item-info">
                    <div class="list-item-title">${ed.nombre}</div>
                    <div class="list-item-subtitle">${ed.direccion || 'Sin dirección'}</div>
                </div>
                ${yaSolicito
                    ? '<span class="badge">Solicitud enviada</span>'
                    : `<input type="text" class="solicitud-depto" data-ed="${ed.id}" placeholder="Tu depto (ej: 101)" style="max-width:110px;">
                       <button class="btn btn-sm btn-primary solicitar-acceso" data-ed="${ed.id}">Solicitar</button>`}
            </div>`;
        }).join('');
        contSol.querySelectorAll('.solicitar-acceso').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = contSol.querySelector(`.solicitud-depto[data-ed="${btn.dataset.ed}"]`);
                this.solicitarAcceso(Number(btn.dataset.ed), input ? input.value.trim() : '');
            });
        });
    },

    async aceptarInvitacion(id) {
        const { error } = await Auth.aceptarInvitacion(id);
        if (error) {
            this.toast('No se pudo aceptar la invitación', 'error');
            return;
        }
        await Auth.getMembresias();
        const m = Auth.membresiaDe(id);
        this.setEdificioActivo(id);
        this.toast('Invitación aceptada', 'success');
        this.startApp();
        if (!m) this.renderAcceso();
    },

    async solicitarAcceso(edificioId, departamento) {
        const { error } = await Auth.aplicarAEdificio(edificioId, departamento);
        if (error) {
            this.toast(error.message || 'No se pudo enviar la solicitud', 'error');
            return;
        }
        await Auth.getMembresias();
        this.toast('Solicitud enviada. Esperando aprobación', 'success');
        this.renderAcceso();
    },

    async crearEdificio(nombreId, direccionId) {
        const nombre = document.getElementById(nombreId).value.trim();
        const direccion = document.getElementById(direccionId).value.trim();
        if (!nombre) return;
        const { data, error } = await Auth.crearEdificio(nombre, direccion);
        if (error) {
            this.toast(this._errorPostgres(error, 'No se pudo crear el edificio'), 'error');
            return;
        }
        const nuevo = data && data.id ? data : (Array.isArray(data) ? data[0] : data);
        await Auth.getMembresias();
        document.getElementById(nombreId).value = '';
        document.getElementById(direccionId).value = '';
        this.toast('Edificio creado', 'success');
        if (nuevo && nuevo.id && Auth.membresiaDe(nuevo.id)) {
            this.setEdificioActivo(nuevo.id);
            if (this.enMenuEdificios) this.renderEdificios();
            else if (!this.enApp) this.startApp();
            else await this.switchEdificio(nuevo.id);
        } else if (this.enMenuEdificios) {
            this.renderEdificios();
        } else {
            this.renderAcceso();
        }
    },

    async enviarInvitacion() {
        const input = document.getElementById('invitar-email');
        const email = input.value.trim();
        if (!email) return;
        const { error } = await Auth.crearInvitacion(email);
        if (error) {
            this.toast(error.message || 'No se pudo enviar la invitación', 'error');
            return;
        }
        input.value = '';
        this.toast('Invitación enviada', 'success');
        this.renderMiembros();
    },

    nombreEdificio(id) {
        const n = Number(id);
        const e = Auth.edificios.find(x => x.id === n) || Auth.edificiosPublicos.find(x => x.id === n);
        if (e) return e.nombre;
        if (n === Auth.edificioActivo) {
            const cfg = DB.getConfig();
            if (cfg && cfg.nombre) return cfg.nombre;
        }
        return 'Edificio ' + n;
    },

    // El selector se muestra siempre, incluso con un solo edificio: es la
    // unica pista visible de que la app es multi-edificio y da acceso a la
    // administracion de cada uno.
    renderEdificioSelect() {
        const sel = document.getElementById('edificio-select');
        const mios = Auth.miembrosAprobados();
        if (mios.length === 0) {
            sel.style.display = 'none';
            return;
        }
        sel.innerHTML = mios.map(m =>
            `<option value="${m.edificio_id}" ${m.edificio_id === Auth.edificioActivo ? 'selected' : ''}>${this.esc(this.nombreEdificio(m.edificio_id))}</option>`
        ).join('');
        sel.style.display = 'inline-block';
    },

    async switchEdificio(id) {
        if (!id || id === Auth.edificioActivo) return;
        this.setEdificioActivo(id);
        this.applyRole();
        await DB.syncFromServer();
        DB.initFirstRun();
        DB.migrateMesActual();
        this.currentMes = this.loadMesInicial();
        this.applyRole();
        this.render();
        this.toast('Edificio cambiado a ' + this.nombreEdificio(id), 'success');
    },

    switchLoginMode(mode) {
        this.loginMode = mode;
        const isSignup = mode === 'signup';
        document.getElementById('login-title').textContent = isSignup ? 'Crear cuenta' : 'Ingresar';
        document.getElementById('login-subtitle').textContent = isSignup
            ? 'Crea tu cuenta con tu email. El administrador deberá aprobar tu acceso.'
            : 'Ingresa para ver los estados de cuenta del edificio.';
        document.getElementById('login-password2-group').style.display = isSignup ? 'block' : 'none';
        document.getElementById('btn-login-submit').textContent = isSignup ? 'Crear cuenta' : 'Ingresar';
        document.getElementById('btn-toggle-signup').textContent = isSignup
            ? '¿Ya tienes cuenta? Ingresa'
            : '¿No tienes cuenta? Crea una';
        this.clearLoginFeedback();
    },

    setLoginLoading(on) {
        const btn = document.getElementById('btn-login-submit');
        btn.disabled = on;
        btn.textContent = on ? 'Espere...' : (this.loginMode === 'signup' ? 'Crear cuenta' : 'Ingresar');
    },

    showLoginError(msg) {
        const el = document.getElementById('login-error');
        el.textContent = msg;
        el.style.display = 'block';
        document.getElementById('login-info').style.display = 'none';
    },

    showLoginInfo(msg) {
        const el = document.getElementById('login-info');
        el.textContent = msg;
        el.style.display = 'block';
        document.getElementById('login-error').style.display = 'none';
    },

    clearLoginFeedback() {
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-info').style.display = 'none';
    },

    loginErrorMessage(err) {
        const msg = (err && err.message) || '';
        if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos';
        if (msg.includes('Email not confirmed')) return 'Todavía no confirmaste tu email. Revisa tu bandeja de entrada.';
        if (msg.includes('Too many requests') || msg.includes('rate limit')) return 'Demasiados intentos. Espera unos minutos y vuelve a intentar.';
        return msg;
    },

    async doLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        if (!email || !password) return;
        this.setLoginLoading(true);
        try {
            await Auth.login(email, password);
            this.setLoginLoading(false);
            await this.resolverAcceso();
        } catch (err) {
            this.setLoginLoading(false);
            this.showLoginError(this.loginErrorMessage(err));
        }
    },

    async doSignup() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const password2 = document.getElementById('login-password2').value;
        if (password.length < 6) {
            this.showLoginError('La contraseña debe tener al menos 6 caracteres');
            return;
        }
        if (password !== password2) {
            this.showLoginError('Las contraseñas no coinciden');
            return;
        }
        this.setLoginLoading(true);
        try {
            const res = await Auth.signup(email, password);
            this.setLoginLoading(false);
            this.switchLoginMode('login');
            document.getElementById('login-email').value = email;
            document.getElementById('login-password').value = '';
            document.getElementById('login-password2').value = '';
            if (res && res.user) {
                this.showLoginInfo('Cuenta creada. Revisa tu email para confirmarla. Después pedí acceso al edificio desde la pantalla de acceso.');
            } else {
                this.showLoginInfo('Revisa tu email para confirmar tu cuenta.');
            }
        } catch (err) {
            this.setLoginLoading(false);
            this.showLoginError(this.loginErrorMessage(err));
        }
    },

    async forgotPassword() {
        const email = document.getElementById('login-email').value.trim();
        if (!email) {
            this.showLoginError('Ingresa tu email para enviarte el enlace de recuperación');
            return;
        }
        this.setLoginLoading(true);
        try {
            await Auth.resetPassword(email);
            this.setLoginLoading(false);
            this.showLoginInfo('Te enviamos un enlace para restablecer tu contraseña. Revisa tu email.');
        } catch (err) {
            this.setLoginLoading(false);
            this.showLoginError(this.loginErrorMessage(err));
        }
    },

    async logout() {
        await Auth.logout();
        this.perfil = null;
        document.getElementById('login-password').value = '';
        document.getElementById('login-password2').value = '';
        this.showLogin();
    },

    // Escapa texto que viene de otros usuarios (nombres, emails) antes
    // de meterlo en innerHTML: si no, un nombre con HTML es XSS.
    esc(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    applyRole() {
        const isAdmin = Auth.canWrite();
        document.body.classList.toggle('readonly', !isAdmin);
        const chip = document.getElementById('user-chip');
        const nombre = Auth.nombre();
        const label = nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
        const rol = Auth.esOwnerDe(Auth.edificioActivo) ? 'Owner' : (isAdmin ? 'Admin' : 'Propietario');
        chip.textContent = (label ? label + ' · ' : '') + rol;
        chip.style.display = 'inline-block';
        document.title = this.nombreEdificio(Auth.edificioActivo) + ' · Estado de cuenta';
        const panel = document.getElementById('usuarios-admin');
        if (panel) panel.style.display = isAdmin ? 'block' : 'none';
        document.getElementById('btn-logout').style.display = 'inline-block';
        document.querySelectorAll('.servicio-params input').forEach(i => { i.disabled = !isAdmin; });
        this.renderEdificioSelect();
        if (isAdmin) this.renderMiembros();
    },

    // === Miembros del edificio activo ===
    async renderMiembros() {
        const ed = Auth.edificioActivo;
        const panel = document.getElementById('usuarios-admin');
        if (!panel || !ed) return;
        const esAdmin = Auth.esAdminDe(ed);
        const esOwner = Auth.esOwnerDe(ed);
        panel.style.display = esAdmin ? 'block' : 'none';
        if (!esAdmin) return;

        const cont = document.getElementById('lista-usuarios');
        const contSol = document.getElementById('lista-solicitudes');
        const contInv = document.getElementById('lista-invitaciones-admin');
        const cfg = DB.getConfig();
        const titulo = document.getElementById('miembros-titulo');
        if (titulo) titulo.textContent = 'Miembros de ' + (cfg.nombre || this.nombreEdificio(ed));

        let miembros = [];
        try {
            miembros = await Auth.listarMiembros(ed);
        } catch (err) {
            cont.innerHTML = '<p class="empty-state">No se pudieron cargar los miembros</p>';
            return;
        }

        const pendientes = miembros.filter(m => m.estado === 'pendiente');
        const activos = miembros.filter(m => m.estado === 'aprobado');
        const etiqueta = m => this.esc(m.nombre || (m.email ? m.email.split('@')[0] : m.user_id.slice(0, 8)));

        // --- Solicitudes de acceso
        const wrap = document.getElementById('solicitudes-wrap');
        if (wrap) wrap.style.display = pendientes.length ? 'block' : 'none';
        contSol.innerHTML = pendientes.map(m => `
            <div class="list-item usuario-item">
                <div class="list-item-info" style="flex:1;min-width:0;">
                    <div class="list-item-title" style="word-break:break-all;">${etiqueta(m)}</div>
                    <div class="list-item-subtitle">${this.esc(m.email || '')}</div>
                </div>
                <div class="usuario-controls fila">
                    <input type="text" class="miembro-depto" data-id="${m.membresia_id}" value="${this.esc(m.departamento || '')}" placeholder="Dpto (ej: 101)">
                    <button class="btn btn-sm btn-primary solicitud-aprobar" data-id="${m.membresia_id}">Aprobar</button>
                    <button class="btn btn-sm btn-outline solicitud-rechazar" data-id="${m.membresia_id}">Rechazar</button>
                </div>
            </div>
        `).join('');

        contSol.querySelectorAll('.solicitud-aprobar').forEach(btn => {
            btn.addEventListener('click', async () => {
                const inp = contSol.querySelector('.miembro-depto[data-id="' + btn.dataset.id + '"]');
                const cambios = { estado: 'aprobado' };
                if (inp && inp.value.trim()) cambios.departamento = inp.value.trim();
                const res = await Auth.actualizarMiembro(btn.dataset.id, cambios);
                if (res.error) this.toast('No se pudo aprobar', 'error');
                else this.toast('Acceso aprobado', 'success');
                this.renderMiembros();
            });
        });

        contSol.querySelectorAll('.solicitud-rechazar').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Rechazar esta solicitud de acceso?')) return;
                const res = await Auth.actualizarMiembro(btn.dataset.id, { estado: 'rechazado' });
                if (res.error) this.toast('No se pudo rechazar', 'error');
                else this.toast('Solicitud rechazada', 'success');
                this.renderMiembros();
            });
        });

        // --- Miembros activos
        if (activos.length === 0) {
            cont.innerHTML = '<p class="empty-state">Todavia no hay miembros en este edificio</p>';
        } else {
            cont.innerHTML = activos.map(m => {
                const soyYo = m.user_id === (Auth.user && Auth.user.id);
                const roles = [
                    m.es_owner ? '<span class="badge">Owner</span>' : '',
                    m.rol === 'admin' ? '<span class="badge">Admin</span>' : '<span class="badge">Propietario</span>'
                ].join(' ');
                const btnAdmin = esOwner && !m.es_owner && !soyYo
                    ? '<button class="btn btn-sm ' + (m.rol === 'admin' ? 'btn-outline' : 'btn-primary') + ' miembro-rol" data-id="' + m.membresia_id + '" data-rol="' + m.rol + '">' + (m.rol === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button>'
                    : '';
                const btnTransferir = esOwner && m.rol === 'admin' && !m.es_owner && !soyYo
                    ? '<button class="btn btn-sm btn-outline miembro-transferir" data-id="' + m.membresia_id + '" data-user="' + m.user_id + '">Transferir</button>'
                    : '';
                const btnQuitar = esOwner && !soyYo
                    ? '<button class="btn btn-sm btn-outline miembro-eliminar" data-id="' + m.membresia_id + '">Quitar</button>'
                    : '';
                return `
                <div class="list-item usuario-item">
                    <div class="list-item-info" style="flex:1;min-width:0;">
                        <div class="list-item-title" style="word-break:break-all;">${etiqueta(m)} ${roles}</div>
                        <div class="list-item-subtitle">${this.esc(m.email || '')}</div>
                    </div>
                    <div class="usuario-controls fila">
                        <input type="text" class="miembro-depto" data-id="${m.membresia_id}" value="${this.esc(m.departamento || '')}" placeholder="Dpto (ej: 101)">
                        ${btnAdmin}${btnTransferir}${btnQuitar}
                    </div>
                </div>`;
            }).join('');
        }

        cont.querySelectorAll('.miembro-depto').forEach(inp => {
            inp.addEventListener('change', async () => {
                const res = await Auth.actualizarMiembro(inp.dataset.id, { departamento: inp.value.trim() || null });
                if (res.error) this.toast('No se pudo asignar el departamento', 'error');
                else this.toast('Departamento asignado', 'success');
            });
        });

        cont.querySelectorAll('.miembro-rol').forEach(btn => {
            btn.addEventListener('click', async () => {
                const nuevo = btn.dataset.rol === 'admin' ? 'propietario' : 'admin';
                const res = await Auth.actualizarMiembro(btn.dataset.id, { rol: nuevo });
                if (res.error) this.toast('Solo el owner puede cambiar los roles', 'error');
                else this.toast(nuevo === 'admin' ? 'Promovido a admin' : 'Quitado de admin', 'success');
                this.renderMiembros();
            });
        });

        cont.querySelectorAll('.miembro-eliminar').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Quitar a este miembro del edificio?')) return;
                const res = await Auth.eliminarMiembro(btn.dataset.id);
                if (res.error) this.toast('No se pudo quitar', 'error');
                else this.toast('Miembro eliminado', 'success');
                this.renderMiembros();
            });
        });

        cont.querySelectorAll('.miembro-transferir').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Transferir la propiedad del edificio a este admin? Vas a perder el control.')) return;
                const res = await Auth.transferirOwner(ed, btn.dataset.user);
                if (res.error) this.toast(res.error.message || 'No se pudo transferir', 'error');
                else {
                    this.toast('Propiedad transferida', 'success');
                    await Auth.getMembresias();
                    this.applyRole();
                }
            });
        });

        // --- Invitaciones enviadas por este edificio
        const misInvitaciones = await this.invitacionesDeEdificio(ed);
        contInv.innerHTML = misInvitaciones.length
            ? misInvitaciones.map(i => `
                <div class="list-item">
                    <div class="list-item-info" style="min-width:0;">
                        <div class="list-item-title" style="word-break:break-all;">${this.esc(i.email)}</div>
                        <div class="list-item-subtitle">Invitaci�n pendiente</div>
                    </div>
                    <button class="btn btn-sm btn-outline invitacion-revocar" data-id="${i.id}">Revocar</button>
                </div>
            `).join('')
            : '<p class="empty-state">Sin invitaciones pendientes</p>';

        contInv.querySelectorAll('.invitacion-revocar').forEach(btn => {
            btn.addEventListener('click', async () => {
                await Auth.revocarInvitacion(btn.dataset.id);
                this.toast('Invitaci�n revocada', 'success');
                this.renderMiembros();
            });
        });
    },

    async invitacionesDeEdificio(edificioId) {
        const { data } = await Auth.supabase
            .from('invitaciones')
            .select('id, email, estado')
            .eq('edificio_id', edificioId)
            .eq('estado', 'pendiente');
        return data || [];
    },
    populateCategorias() {
        const select = document.getElementById('gasto-categoria');
        const filter = document.getElementById('filter-categoria');
        select.innerHTML = '';
        filter.innerHTML = '<option value="">Todas las categorías</option>';

        Object.entries(CATEGORIAS).forEach(([key, val]) => {
            const opt = `<option value="${key}">${val.icon} ${val.label}</option>`;
            select.innerHTML += opt;
            filter.innerHTML += opt;
        });
    },

    // === Navigation ===
    bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.navigateTo(btn.dataset.screen);
            });
        });

        document.getElementById('btn-config').addEventListener('click', () => {
            this.navigateTo('config');
        });

        document.getElementById('btn-add-gasto-dashboard').addEventListener('click', () => {
            this.openGastoModal();
        });
    },

    navigateTo(screen) {
        this.currentScreen = screen;
        this._gasPeriodo = null;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`screen-${screen}`).classList.add('active');

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-btn[data-screen="${screen}"]`);
        if (navBtn) navBtn.classList.add('active');

        const titles = {
            dashboard: this.nombreEdificio(Auth.edificioActivo),
            propietarios: 'Departamentos',
            gastos: 'Gastos',
            servicios: 'Gastos Fijos',
            calculo: 'Cálculo Mensual',
            informes: 'Informes',
            config: 'Configuración'
        };
        document.getElementById('header-title').textContent = titles[screen] || this.nombreEdificio(Auth.edificioActivo);
        document.getElementById('btn-config').style.display = screen === 'config' ? 'none' : 'block';

        this.render();
    },

    // === Month Selectors ===
    bindMonthSelectors() {
        const handlers = [
            ['btn-prev-month', -1], ['btn-next-month', 1],
            ['btn-prev-month-calc', -1], ['btn-next-month-calc', 1],
            ['btn-prev-month-inf', -1], ['btn-next-month-inf', 1],
            ['btn-prev-month-gas', -1], ['btn-next-month-gas', 1],
            ['btn-prev-month-agua', -1], ['btn-next-month-agua', 1]
        ];
        handlers.forEach(([id, delta]) => {
            document.getElementById(id).addEventListener('click', () => {
                this.currentMes = Calculos.shiftMes(this.currentMes, delta);
                this._gasPeriodo = null;
                DB.saveMesActual(this.currentMes);
                this.render();
            });
        });
    },

    // === Modals ===
    bindModals() {
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                if (modal && (modal.id === 'modal-estado-cuenta' || modal.id === 'modal-pago')) {
                    modal.style.display = 'none';
                    return;
                }
                this.confirmarCierreModal(modal);
            });
        });

        const estadoModal = document.getElementById('modal-estado-cuenta');
        document.getElementById('btn-estado-cerrar').addEventListener('click', () => {
            estadoModal.style.display = 'none';
        });
        document.getElementById('btn-estado-pdf').addEventListener('click', () => {
            this.exportEstadoCuentaPdf();
        });

        document.getElementById('form-pago').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarPago();
        });
        document.getElementById('pago-concepto').addEventListener('change', () => {
            this._sugerirMontoPago();
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target !== modal) return;
                if (modal.id === 'modal-confirm') modal.style.display = 'none';
            });
        });

        document.getElementById('btn-add-propietario').addEventListener('click', () => {
            this.openPropietarioModal();
        });

        document.getElementById('btn-add-gasto').addEventListener('click', () => {
            this.openGastoModal();
        });

        document.getElementById('btn-add-personal').addEventListener('click', () => {
            this.openPersonalModal();
        });

        document.getElementById('btn-add-jardineria').addEventListener('click', () => {
            this.openJardineriaModal();
        });

        document.getElementById('btn-agua-formula').addEventListener('click', () => {
        this.openFacturaAguaModal();
        });

        document.getElementById('btn-simplificar-deudas').addEventListener('click', () => {
            this.showSimplificacion();
        });

        document.getElementById('confirm-cancel').addEventListener('click', () => {
            document.getElementById('modal-confirm').style.display = 'none';
        });

        document.getElementById('confirm-save').addEventListener('click', () => {
            document.getElementById('modal-confirm').style.display = 'none';
            document.getElementById('confirm-save').style.display = 'none';
            const modal = this._modalCierre;
            this._modalCierre = null;
            if (modal) this.closeModalConGuardado(modal);
        });
    },

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    },

    closeModalConGuardado(modal) {
        if (!modal) return;
        const resultado = this._guardarBorrador(modal);
        modal.style.display = 'none';
        if (resultado === 'nuevo') this.toast('Borrador guardado', 'success');
        if (resultado) this.render();
    },

    _guardarBorrador(modal) {
        switch (modal.id) {
            case 'modal-propietario': {
                const p = this._leerFormPropietario();
                if (!(p.nombre || p.departamento)) return null;
                const esNuevo = !p.id;
                DB.savePropietario(p);
                return esNuevo ? 'nuevo' : 'actualizado';
            }
            case 'modal-gasto': {
                const g = this._leerFormGasto();
                if (!g.concepto) return null;
                const esNuevo = !g.id;
                DB.saveGasto(g);
                return esNuevo ? 'nuevo' : 'actualizado';
            }
            case 'modal-personal': {
                const p = this._leerFormPersonal();
                if (!p.nombre) return null;
                const esNuevo = !p.id;
                DB.savePersonal(p);
                return esNuevo ? 'nuevo' : 'actualizado';
            }
            case 'modal-jardineria': {
                const j = this._leerFormJardineria();
                if (!j.descripcion) return null;
                const esNuevo = !j.id;
                DB.saveJardineria(j);
                return esNuevo ? 'nuevo' : 'actualizado';
            }
            case 'modal-agua-formula': {
                const { factura } = this._leerFormAgua();
                const hasData = document.getElementById('agua-consumo').value !== ''
                    || parseFloat(document.getElementById('agua-cargo-fijo').value) > 0
                    || parseFloat(document.getElementById('agua-potable').value) > 0
                    || parseFloat(document.getElementById('agua-alcantarillado').value) > 0;
                if (!hasData) return null;
                const { params } = this._leerFormAgua();
                DB.saveFacturaAgua(this.currentMes, factura);
                DB.saveAguaParams(params);
                return 'actualizado';
            }
            default:
                return null;
        }
    },

    _leerFormPropietario() {
        const id = document.getElementById('propietario-id').value;
        const coeficiente = parseFloat(document.getElementById('propietario-coeficiente').value);
        const propietario = {
            nombre: document.getElementById('propietario-nombre').value.trim(),
            apellido: document.getElementById('propietario-apellido').value.trim(),
            departamento: document.getElementById('propietario-departamento').value.trim(),
            coeficiente: isNaN(coeficiente) ? 0 : coeficiente,
            m2: parseFloat(document.getElementById('propietario-m2').value) || 0,
            cuotaMensual: parseFloat(document.getElementById('propietario-cuota').value) || 0,
            email: document.getElementById('propietario-email').value.trim()
        };
        if (id) propietario.id = parseInt(id);
        return propietario;
    },

    _leerFormGasto() {
        const id = document.getElementById('gasto-id').value;
        const monto = parseFloat(document.getElementById('gasto-monto').value);
        const gasto = {
            concepto: document.getElementById('gasto-concepto').value.trim(),
            monto: isNaN(monto) ? 0 : monto,
            fecha: document.getElementById('gasto-fecha').value,
            categoria: document.getElementById('gasto-categoria').value,
            frecuencia: document.getElementById('gasto-frecuencia').value,
            division: document.getElementById('gasto-division').value,
            pagado: document.getElementById('gasto-estado').value === 'pagado',
            notas: document.getElementById('gasto-notas').value.trim()
        };
        if (id) gasto.id = parseInt(id);
        return gasto;
    },

    _leerFormPersonal() {
        const id = document.getElementById('personal-id').value;
        const tipo = document.querySelector('input[name="gasto-tipo"]:checked').value;
        const nombre = document.getElementById('personal-nombre').value.trim();
        const notas = document.getElementById('personal-notas').value.trim();
        let personal;
        if (tipo === 'fijo') {
            personal = {
                tipo: 'fijo',
                nombre,
                categoria: document.getElementById('fijo-categoria').value,
                monto: parseFloat(document.getElementById('fijo-monto').value) || 0,
                frecuencia: document.getElementById('fijo-frecuencia').value,
                mesDesde: `${document.getElementById('fijo-mes-desde-anio').value}-${document.getElementById('fijo-mes-desde-mes').value}`,
                notas
            };
        } else {
            const horarioSel = document.getElementById('personal-horario').value;
            personal = {
                tipo: 'personal',
                nombre,
                rol: document.getElementById('personal-rol').value,
                sueldoMensual: parseFloat(document.getElementById('personal-sueldo').value) || 0,
                horario: horarioSel === 'otro'
                    ? document.getElementById('personal-horario-otro').value.trim()
                    : horarioSel,
                dias: document.getElementById('personal-dias').value.trim(),
                vacaciones: document.getElementById('personal-vacaciones').value.trim(),
                notas
            };
        }
        if (id) personal.id = parseInt(id);
        return personal;
    },

    _leerFormJardineria() {
        const id = document.getElementById('jardineria-id').value;
        const item = {
            fecha: document.getElementById('jardineria-fecha').value,
            estado: document.getElementById('jardineria-estado').value,
            descripcion: document.getElementById('jardineria-descripcion').value.trim(),
            notas: document.getElementById('jardineria-notas').value.trim()
        };
        if (id) item.id = parseInt(id);
        return item;
    },

    _leerFormAgua() {
        const aguaPotable = parseFloat(document.getElementById('agua-potable').value) || 0;
        const alcantarillado = parseFloat(document.getElementById('agua-alcantarillado').value) || 0;
        const cargoFijo = parseFloat(document.getElementById('agua-cargo-fijo').value) || 0;
        const igvPct = parseFloat(document.getElementById('agua-igv').value) || 0;
        const igv = parseFloat(document.getElementById('agua-igv-monto').value) || 0;
        const factura = {
            consumo: parseFloat(document.getElementById('agua-consumo').value) || 0,
            aguaPotable,
            alcantarillado,
            cargoFijo,
            igv,
            igvPct
        };
        const params = {
            tramosAgua: this.readTramosAguaModal('agua'),
            tramosAlcant: this.readTramosAguaModal('agua-a')
        };
        return { factura, params };
    },

    openPropietarioModal(propietario = null) {
        const title = document.getElementById('modal-propietario-title');
        const form = document.getElementById('form-propietario');

        if (propietario) {
            title.textContent = 'Editar Departamento';
            document.getElementById('propietario-id').value = propietario.id;
            document.getElementById('propietario-nombre').value = propietario.nombre || '';
            document.getElementById('propietario-apellido').value = propietario.apellido || '';
            document.getElementById('propietario-departamento').value = propietario.departamento || '';
            document.getElementById('propietario-coeficiente').value = propietario.coeficiente;
            document.getElementById('propietario-m2').value = propietario.m2 || '';
            document.getElementById('propietario-cuota').value = propietario.cuotaMensual || '';
            document.getElementById('propietario-email').value = propietario.email || '';
        } else {
            title.textContent = 'Nuevo Departamento';
            form.reset();
            document.getElementById('propietario-id').value = '';
        }

        document.getElementById('modal-propietario').style.display = 'flex';
    },

    openEstadoCuentaModal(propietarioId) {
        const ec = Calculos.calcEstadoCuenta(propietarioId);
        if (!ec) {
            this.toast('No se encontró el departamento', 'error');
            return;
        }
        const p = ec.propietario;
        const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento;
        document.getElementById('estado-cuenta-title').textContent = `Estado de Cuenta — ${p.departamento} ${fullName}`;

        const cuerpo = document.getElementById('estado-cuenta-cuerpo');
        if (ec.filas.length === 0) {
            cuerpo.innerHTML = '<p class="empty-state">Sin movimientos registrados</p>';
        } else {
            const filas = ec.filas.map(f => `
                <tr>
                    <td>${Calculos.getMesLabel(f.mes)}</td>
                    <td>${Calculos.formatMoney(f.cuotaFija)}</td>
                    <td>${f.extraordinarias > 0 ? Calculos.formatMoney(f.extraordinarias) : '—'}</td>
                    <td>${f.gas > 0 ? Calculos.formatMoney(f.gas) : '—'}</td>
                    <td>${f.agua > 0 ? Calculos.formatMoney(f.agua) : '—'}</td>
                    <td>${Calculos.formatMoney(f.cargo)}</td>
                    <td>${Calculos.formatMoney(f.pagado)}</td>
                    <td class="${f.saldo > 0.01 ? 'ec-debe' : 'ec-al-dia'}">${Calculos.formatMoney(f.saldo)}</td>
                    <td class="${f.acumulado > 0.01 ? 'ec-debe' : f.acumulado < -0.01 ? 'ec-favor' : 'ec-al-dia'}">${Calculos.formatMoney(f.acumulado)}</td>
                </tr>`).join('');

            const totalClase = ec.totalAcumulado > 0.01 ? 'ec-debe' : ec.totalAcumulado < -0.01 ? 'ec-favor' : 'ec-al-dia';
            cuerpo.innerHTML = `
                <div class="ec-info">Cuota fija mensual: <strong>${Calculos.formatMoney(p.cuotaMensual || 0)}</strong></div>
                <div class="ec-table-wrap">
                <table class="ec-table">
                    <thead>
                        <tr><th>Mes</th><th>Cuota</th><th>Extra.</th><th>Gas</th><th>Agua</th><th>Cargo</th><th>Pagado</th><th>Saldo</th><th>Acum.</th></tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
                </div>
                <div class="ec-total ${totalClase}">Saldo acumulado: ${Calculos.formatMoney(ec.totalAcumulado)}</div>`;
        }

        this._estadoCuentaId = propietarioId;
        document.getElementById('modal-estado-cuenta').style.display = 'flex';
    },

    exportEstadoCuentaPdf() {
        if (typeof window.jspdf === 'undefined' || !this._estadoCuentaId) {
            this.toast('Librería PDF no disponible', 'error');
            return;
        }
        const ec = Calculos.calcEstadoCuenta(this._estadoCuentaId);
        if (!ec) return;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const config = DB.getConfig();
        const p = ec.propietario;
        const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento;

        doc.setFontSize(16);
        doc.text(config.nombre || 'Edificio', 20, 20);
        doc.setFontSize(11);
        doc.text(`Estado de Cuenta — ${p.departamento} ${fullName}`, 20, 30);
        doc.setFontSize(9);
        doc.text(`Cuota mensual fija: ${Calculos.formatMoney(p.cuotaMensual || 0)}`, 20, 38);

        let y = 46;
        ec.filas.forEach(f => {
            const extra = f.extraordinarias > 0 ? ` · Extra: ${Calculos.formatMoney(f.extraordinarias)}` : '';
            const gas = f.gas > 0 ? ` · Gas: ${Calculos.formatMoney(f.gas)}` : '';
            const agua = f.agua > 0 ? ` · Agua: ${Calculos.formatMoney(f.agua)}` : '';
            doc.text(`${Calculos.getMesLabel(f.mes)}: Cargo ${Calculos.formatMoney(f.cargo)} | Pagado ${Calculos.formatMoney(f.pagado)} | Saldo ${Calculos.formatMoney(f.saldo)} | Acumulado ${Calculos.formatMoney(f.acumulado)}${extra}${gas}${agua}`, 20, y);
            y += 6;
        });

        y += 4;
        doc.setFontSize(11);
        doc.text(`Saldo acumulado: ${Calculos.formatMoney(ec.totalAcumulado)}`, 20, y);
        doc.save(`estado-cuenta-${p.departamento.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`);
        this.toast('PDF descargado', 'success');
    },

    openGastoModal(gasto = null) {
        const title = document.getElementById('modal-gasto-title');
        const form = document.getElementById('form-gasto');

        if (gasto) {
            title.textContent = 'Editar Gasto';
            document.getElementById('gasto-id').value = gasto.id;
            document.getElementById('gasto-concepto').value = gasto.concepto;
            document.getElementById('gasto-monto').value = gasto.monto;
            document.getElementById('gasto-fecha').value = gasto.fecha;
            document.getElementById('gasto-categoria').value = gasto.categoria;
            document.getElementById('gasto-frecuencia').value = gasto.frecuencia || 'mensual';
            document.getElementById('gasto-division').value = gasto.division || 'proporcional';
            document.getElementById('gasto-estado').value = gasto.pagado ? 'pagado' : 'pendiente';
            document.getElementById('gasto-notas').value = gasto.notas || '';
        } else {
            title.textContent = 'Nuevo Gasto';
            form.reset();
            document.getElementById('gasto-id').value = '';
            document.getElementById('gasto-fecha').value = new Date().toISOString().split('T')[0];
            document.getElementById('gasto-frecuencia').value = 'mensual';
            document.getElementById('gasto-division').value = 'proporcional';
            document.getElementById('gasto-estado').value = 'pendiente';
        }

        this.updateCuotaPreview();
        document.getElementById('modal-gasto').style.display = 'flex';
    },

    setTipoGastoFijo(tipo) {
        const isPersonal = tipo !== 'fijo';
        document.getElementById('grupo-personal').style.display = isPersonal ? 'block' : 'none';
        document.getElementById('grupo-fijo').style.display = isPersonal ? 'none' : 'block';
        document.getElementById('label-nombre').textContent = isPersonal ? 'Nombre' : 'Concepto';
        document.getElementById('personal-nombre').placeholder = isPersonal ? 'Ej: Juan' : 'Ej: Mant. ascensores';
        document.querySelectorAll('input[name="gasto-tipo"]').forEach(r => {
            r.checked = r.value === (isPersonal ? 'personal' : 'fijo');
        });
    },

    fillMesDesdeSelects(mesDesde) {
        const [y, m] = (mesDesde || Calculos.getCurrentMes()).split('-').map(Number);
        const yearEl = document.getElementById('fijo-mes-desde-anio');
        const monthEl = document.getElementById('fijo-mes-desde-mes');
        const now = new Date().getFullYear();
        yearEl.innerHTML = '';
        for (let yy = now - 3; yy <= now; yy++) {
            yearEl.innerHTML += `<option value="${yy}"${yy === y ? ' selected' : ''}>${yy}</option>`;
        }
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const mSel = String(m).padStart(2, '0');
        monthEl.innerHTML = '';
        months.forEach((n, i) => {
            const v = String(i + 1).padStart(2, '0');
            monthEl.innerHTML += `<option value="${v}"${v === mSel ? ' selected' : ''}>${n}</option>`;
        });
    },

    openPersonalModal(personal = null) {
        const form = document.getElementById('form-personal');
        const tipo = (personal && personal.tipo) || 'personal';
        const isPersonal = tipo !== 'fijo';
        this.setTipoGastoFijo(tipo);
        document.getElementById('modal-personal-title').textContent = personal
            ? (isPersonal ? 'Editar Empleado' : 'Editar Gasto Fijo')
            : (isPersonal ? 'Nuevo Empleado' : 'Nuevo Gasto Fijo');
        if (personal) {
            document.getElementById('personal-id').value = personal.id;
            document.getElementById('personal-nombre').value = personal.nombre || '';
            document.getElementById('fijo-categoria').value = personal.categoria || 'otros';
            document.getElementById('fijo-monto').value = personal.monto || '';
            document.getElementById('fijo-frecuencia').value = personal.frecuencia || 'mensual';
            this.fillMesDesdeSelects(personal.mesDesde || Calculos.getCurrentMes());
            const turnos = ['Turno mañana', 'Turno tarde', 'Turno noche', 'Dominguero', 'Tiempo completo'];
            const horario = personal.horario || '';
            document.getElementById('personal-sueldo').value = personal.sueldoMensual || '';
            document.getElementById('personal-rol').value = personal.rol || 'portero';
            document.getElementById('personal-horario').value = turnos.includes(horario) ? horario : (horario ? 'otro' : '');
            document.getElementById('personal-horario-otro').value = turnos.includes(horario) ? '' : horario;
            document.getElementById('personal-horario-otro-group').style.display = horario && !turnos.includes(horario) ? 'block' : 'none';
            document.getElementById('personal-dias').value = personal.dias || '';
            document.getElementById('personal-vacaciones').value = personal.vacaciones || '';
            document.getElementById('personal-notas').value = personal.notas || '';
        } else {
            document.getElementById('modal-personal-title').textContent = isPersonal ? 'Nuevo Empleado' : 'Nuevo Gasto Fijo';
            form.reset();
            document.getElementById('personal-id').value = '';
            this.setTipoGastoFijo('personal');
            document.getElementById('personal-rol').value = 'portero';
            document.getElementById('personal-horario').value = '';
            document.getElementById('personal-horario-otro').value = '';
            document.getElementById('personal-horario-otro-group').style.display = 'none';
            document.getElementById('fijo-categoria').value = 'ascensores';
            document.getElementById('fijo-frecuencia').value = 'mensual';
            this.fillMesDesdeSelects(Calculos.getCurrentMes());
        }
        document.getElementById('modal-personal').style.display = 'flex';
    },

    openJardineriaModal(item = null) {
        const form = document.getElementById('form-jardineria');
        if (item) {
            document.getElementById('modal-jardineria-title').textContent = 'Editar Trabajo';
            document.getElementById('jardineria-id').value = item.id;
            document.getElementById('jardineria-fecha').value = item.fecha;
            document.getElementById('jardineria-estado').value = item.estado || 'a-realizar';
            document.getElementById('jardineria-descripcion').value = item.descripcion || '';
            document.getElementById('jardineria-notas').value = item.notas || '';
        } else {
            document.getElementById('modal-jardineria-title').textContent = 'Nuevo Trabajo';
            form.reset();
            document.getElementById('jardineria-id').value = '';
            document.getElementById('jardineria-fecha').value = new Date().toISOString().split('T')[0];
            document.getElementById('jardineria-estado').value = 'a-realizar';
        }
        document.getElementById('modal-jardineria').style.display = 'flex';
    },

    openFacturaAguaModal() {
        const f = DB.getFacturaAgua(this.currentMes);
        const p = DB.getAguaParams();
        document.getElementById('agua-factura-title').textContent = `Factura del Agua — ${Calculos.getMesLabel(this.currentMes)}`;
        document.getElementById('agua-consumo').value = f && f.consumo !== undefined ? f.consumo : '';
        document.getElementById('agua-cargo-fijo').value = f ? f.cargoFijo : '';
        document.getElementById('agua-igv').value = (f && f.igvPct !== undefined) ? f.igvPct : 18;
        document.getElementById('agua-potable').value = f ? f.aguaPotable : '';
        document.getElementById('agua-alcantarillado').value = f ? f.alcantarillado : '';
        this.setTramosAguaModal(p);
        if (f && f.igv !== undefined) {
            document.getElementById('agua-igv-monto').value = f.igv;
            this.updateAguaFacturaTotal();
        } else {
            this.recalcIgvMonto();
        }
        document.getElementById('modal-agua-formula').style.display = 'flex';
    },

    setTramosAguaModal(p) {
        [['agua', p.tramosAgua], ['agua-a', p.tramosAlcant]].forEach(([prefix, tramos]) => {
            tramos.forEach((t, i) => {
                const n = i + 1;
                const hasta = document.getElementById(`${prefix}-t${n}-hasta`);
                const precio = document.getElementById(`${prefix}-t${n}-precio`);
                if (hasta) hasta.value = (t.hasta === null || t.hasta === undefined || t.hasta === Infinity) ? '' : t.hasta;
                if (precio) precio.value = t.precio;
            });
        });
    },

    readTramosAguaModal(prefix) {
        return [1, 2, 3].map(n => {
            const hasta = document.getElementById(`${prefix}-t${n}-hasta`).value;
            const precio = parseFloat(document.getElementById(`${prefix}-t${n}-precio`).value);
            return {
                hasta: hasta === '' ? null : parseFloat(hasta),
                precio: isNaN(precio) ? 0 : precio
            };
        });
    },

    recalcAguaMontos() {
        const consumo = parseFloat(document.getElementById('agua-consumo').value) || 0;
        if (consumo > 0) {
            const aguaPotable = Calculos._calcTarifaProgresiva(consumo, this.readTramosAguaModal('agua'));
            const alcantarillado = Calculos._calcTarifaProgresiva(consumo, this.readTramosAguaModal('agua-a'));
            document.getElementById('agua-potable').value = aguaPotable.toFixed(2);
            document.getElementById('agua-alcantarillado').value = alcantarillado.toFixed(2);
        }
        this.recalcIgvMonto();
    },

    recalcIgvMonto() {
        const a = parseFloat(document.getElementById('agua-potable').value) || 0;
        const b = parseFloat(document.getElementById('agua-alcantarillado').value) || 0;
        const c = parseFloat(document.getElementById('agua-cargo-fijo').value) || 0;
        const pct = parseFloat(document.getElementById('agua-igv').value) || 0;
        document.getElementById('agua-igv-monto').value = ((a + b + c) * pct / 100).toFixed(2);
        this.updateAguaFacturaTotal();
    },

    updateAguaFacturaTotal() {
        const a = parseFloat(document.getElementById('agua-potable').value) || 0;
        const b = parseFloat(document.getElementById('agua-alcantarillado').value) || 0;
        const c = parseFloat(document.getElementById('agua-cargo-fijo').value) || 0;
        const igv = parseFloat(document.getElementById('agua-igv-monto').value) || 0;
        document.getElementById('agua-factura-total').textContent = `Total: ${Calculos.formatMoney(a + b + c + igv)}`;
    },

    // === Gasto Frecuencia Preview ===
    bindGastoFrecuencia() {
        document.getElementById('gasto-frecuencia').addEventListener('change', () => this.updateCuotaPreview());
        document.getElementById('gasto-monto').addEventListener('input', () => this.updateCuotaPreview());
        document.getElementById('gasto-division').addEventListener('change', () => this.updateCuotaPreview());
    },

    updateCuotaPreview() {
        const freq = document.getElementById('gasto-frecuencia').value;
        const monto = parseFloat(document.getElementById('gasto-monto').value) || 0;
        const division = document.getElementById('gasto-division').value;
        const group = document.getElementById('gasto-cuota-extra-group');
        const divGroup = document.getElementById('gasto-division-group');
        const preview = document.getElementById('gasto-cuota-preview');
        const propietarios = DB.getPropietarios();
        const totalCoef = propietarios.reduce((s, p) => s + p.coeficiente, 0);

        if (freq !== 'extraordinario') {
            group.style.display = 'none';
            divGroup.style.display = 'none';
            return;
        }

        divGroup.style.display = 'block';

        if (monto <= 0 || propietarios.length === 0) {
            group.style.display = 'none';
            return;
        }

        group.style.display = 'block';

        let items;
        if (division === 'igualitario') {
            const montoPorDept = monto / propietarios.length;
            items = propietarios.map(p => `
                <div class="cuota-preview-item">
                    <span>${p.nombre}</span>
                    <span>${Calculos.formatMoney(montoPorDept)}</span>
                </div>
            `).join('');
        } else {
            items = propietarios.map(p => {
                const cuota = totalCoef > 0 ? (monto * p.coeficiente) / totalCoef : 0;
                return `
                    <div class="cuota-preview-item">
                        <span>${p.nombre} (${p.coeficiente}%)</span>
                        <span>${Calculos.formatMoney(cuota)}</span>
                    </div>
                `;
            }).join('');
        }

        preview.innerHTML = items + `<div class="cuota-preview-total"><span>Total</span><span>${Calculos.formatMoney(monto)}</span></div>`;
    },

    // === Forms ===
    bindForms() {
        document.getElementById('form-propietario').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('propietario-id').value;
            const propietario = this._leerFormPropietario();

            if (propietario.coeficiente <= 0 || propietario.coeficiente > 100) {
                this.toast('El coeficiente debe estar entre 0 y 100', 'error');
                return;
            }

            DB.savePropietario(propietario);
            this.closeAllModals();
            this.toast(id ? 'Departamento actualizado' : 'Departamento agregado', 'success');
            this.render();
        });

        document.getElementById('form-gasto').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('gasto-id').value;
            const gasto = this._leerFormGasto();

            DB.saveGasto(gasto);
            this.closeAllModals();
            this.toast(id ? 'Gasto actualizado' : 'Gasto agregado', 'success');
            this.render();
        });

        document.getElementById('form-config').addEventListener('submit', (e) => {
            e.preventDefault();
            DB.saveConfig({
                nombre: document.getElementById('config-nombre').value.trim(),
                direccion: document.getElementById('config-direccion').value.trim(),
                moneda: document.getElementById('config-moneda').value,
                mesInicio: parseInt(document.getElementById('config-mes-inicio').value)
            });
            this.toast('Configuración guardada', 'success');
        });

        document.querySelectorAll('input[name="gasto-tipo"]').forEach(r => {
            r.addEventListener('change', () => this.setTipoGastoFijo(r.value));
        });

        document.getElementById('form-personal').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('personal-id').value;
            const personal = this._leerFormPersonal();

            DB.savePersonal(personal);
            this.closeAllModals();
            this.toast(id ? 'Gasto fijo actualizado' : 'Gasto fijo agregado', 'success');
            this.render();
        });

        document.getElementById('form-jardineria').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('jardineria-id').value;
            const item = this._leerFormJardineria();

            DB.saveJardineria(item);
            this.closeAllModals();
            this.toast(id ? 'Trabajo actualizado' : 'Trabajo agregado', 'success');
            this.render();
        });

        document.getElementById('form-agua-formula').addEventListener('submit', (e) => {
            e.preventDefault();
            const { factura, params } = this._leerFormAgua();

            DB.saveFacturaAgua(this.currentMes, factura);
            DB.saveAguaParams(params);
            this.closeAllModals();
            this.toast('Factura del agua guardada', 'success');
            this.render();
        });

        ['agua-consumo'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.recalcAguaMontos());
        });

        ['agua-potable', 'agua-alcantarillado', 'agua-cargo-fijo', 'agua-igv'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.recalcIgvMonto());
        });

        document.getElementById('agua-igv-monto').addEventListener('input', () => this.updateAguaFacturaTotal());

        ['agua-t1', 'agua-t2', 'agua-t3', 'agua-a-t1', 'agua-a-t2', 'agua-a-t3'].forEach(prefix => {
            [prefix + '-hasta', prefix + '-precio'].forEach(id => {
                document.getElementById(id).addEventListener('input', () => this.recalcAguaMontos());
            });
        });

        document.getElementById('personal-horario').addEventListener('change', (e) => {
            document.getElementById('personal-horario-otro-group').style.display = e.target.value === 'otro' ? 'block' : 'none';
        });

        document.getElementById('btn-luz-guardar').addEventListener('click', () => {
            const monto = parseFloat(document.getElementById('luz-monto').value) || 0;
            const pagado = document.getElementById('luz-estado').value === 'pagado';
            if (monto <= 0) {
                DB.saveGastoLuz(this.currentMes, 0, false);
                document.getElementById('luz-monto').value = '';
                this.toast('Recibo de luz eliminado del mes', 'success');
            } else {
                DB.saveGastoLuz(this.currentMes, monto, pagado);
                this.toast(`Recibo de luz registrado: ${Calculos.formatMoney(monto)}`, 'success');
            }
            this.render();
        });
    },

    // === Filters ===
    bindFilters() {
        document.getElementById('filter-categoria').addEventListener('change', () => this.renderGastos());
        document.getElementById('filter-frecuencia').addEventListener('change', () => this.renderGastos());
    },

    // === Config ===
    bindConfig() {
        const config = DB.getConfig();
        document.getElementById('config-nombre').value = config.nombre || '';
        document.getElementById('config-direccion').value = config.direccion || '';
        document.getElementById('config-moneda').value = config.moneda || 'S/.';
        document.getElementById('config-mes-inicio').value = config.mesInicio || 1;

        document.getElementById('btn-reset-data').addEventListener('click', () => {
            this.showConfirm('Borrar Todos los Datos', 'Esta acción es irreversible. ¿Estás seguro?', () => {
                DB.resetAll();
                this.closeAllModals();
                this.toast('Datos eliminados', 'success');
                this.render();
            });
        });

        document.getElementById('btn-export-backup').addEventListener('click', () => {
            const json = DB.exportAll();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-gastos-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.toast('Backup descargado', 'success');
        });

        document.getElementById('btn-import-backup').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    DB.importAll(ev.target.result);
                    this.toast('Backup importado correctamente', 'success');
                    this.render();
                } catch {
                    this.toast('Error al importar el archivo', 'error');
                }
            };
            reader.readAsText(file);
        });
    },

    // === Export ===
    bindExport() {
        document.getElementById('btn-export-pdf').addEventListener('click', () => this.exportPDF());
        document.getElementById('btn-export-excel').addEventListener('click', () => this.exportExcel());
    },

    exportPDF() {
        if (typeof window.jspdf === 'undefined') {
            this.toast('Librería PDF no disponible', 'error');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const config = DB.getConfig();
        const resumen = Calculos.calcResumenPropietarios(this.currentMes);
        const gastos = DB.getGastos({ mes: this.currentMes });
        const totalGastos = Calculos.calcTotalGastosMes(this.currentMes);
        const totalGas = Calculos.calcGasTotal(this.currentMes);
        const totalAgua = Calculos.calcAguaTotal(this.currentMes);
        const propietarios = DB.getPropietarios();

        doc.setFontSize(16);
        doc.text(config.nombre || this.nombreEdificio(Auth.edificioActivo), 20, 20);
        doc.setFontSize(10);
        doc.text(`Mes: ${Calculos.getMesLabel(this.currentMes)}`, 20, 28);

        let y = 38;

        if (gastos.length > 0) {
            doc.setFontSize(12);
            doc.text(`Gastos del Mes: ${Calculos.formatMoney(totalGastos)}`, 20, y);
            y += 8;
            doc.setFontSize(9);
            gastos.forEach(g => {
                const estado = g.pagado ? 'Pagado' : 'Pendiente';
                doc.text(`• ${g.concepto} [${Calculos.categoriaLabel(g.categoria)}] ${Calculos.formatMoney(g.monto)} - ${estado}`, 20, y);
                y += 6;
            });
            y += 4;
        }

        if (totalGas > 0) {
            doc.setFontSize(12);
            doc.text(`Gas: ${Calculos.formatMoney(totalGas)}`, 20, y);
            y += 8;
            const fechas = DB.getGasFechas(this.currentMes);
            if (fechas.inicio && fechas.fin) {
                doc.setFontSize(9);
                doc.text(`Período de lectura: ${Calculos.formatFecha(fechas.inicio)} → ${Calculos.formatFecha(fechas.fin)}`, 20, y);
                y += 6;
            }
            doc.setFontSize(9);
            propietarios.forEach(p => {
                const r = Calculos.calcGasDepto(this.currentMes, p.departamento);
                if (r) {
                    doc.text(`• ${p.departamento} ${p.nombre}: ${r.consumo.toFixed(3)} m³ - ${Calculos.formatMoney(r.total)}`, 20, y);
                    y += 6;
                }
            });
            y += 4;
        }

        if (totalAgua > 0) {
            doc.setFontSize(12);
            doc.text(`Agua: ${Calculos.formatMoney(totalAgua)}`, 20, y);
            y += 8;
            doc.setFontSize(9);
            propietarios.forEach(p => {
                const r = Calculos.calcAguaDepto(this.currentMes, p.departamento);
                if (r) {
                    doc.text(`• ${p.departamento} ${p.nombre}: ${r.consumo.toFixed(2)} m³ - ${Calculos.formatMoney(r.total)}`, 20, y);
                    y += 6;
                }
            });
            y += 4;
        }

        doc.setFontSize(12);
        doc.text('Resumen por Departamento', 20, y);
        y += 8;
        doc.setFontSize(9);
        resumen.forEach(p => {
            const gasR = Calculos.calcGasDepto(this.currentMes, p.departamento);
            const aguaR = Calculos.calcAguaDepto(this.currentMes, p.departamento);
            const extra = (gasR ? gasR.total : 0) + (aguaR ? aguaR.total : 0);
            let line = `${p.departamento} ${p.nombre}: Cuota ${Calculos.formatMoney(p.cuota)} | Pagado ${Calculos.formatMoney(p.pagado)} | Saldo ${Calculos.formatMoney(p.saldo)}`;
            if (extra > 0) line += ` | Gas/Agua ${Calculos.formatMoney(extra)}`;
            doc.text(line, 20, y);
            y += 6;
        });

        doc.save(`informe-${this.currentMes}.pdf`);
        this.toast('PDF descargado', 'success');
    },

    exportExcel() {
        if (typeof XLSX === 'undefined') {
            this.toast('Librería Excel no disponible', 'error');
            return;
        }

        const resumen = Calculos.calcResumenPropietarios(this.currentMes);
        const gastos = DB.getGastos({ mes: this.currentMes });
        const config = DB.getConfig();
        const propietarios = DB.getPropietarios();

        const wb = XLSX.utils.book_new();

        const wsData = [
            [config.nombre || 'Edificio'],
            ['Mes:', Calculos.getMesLabel(this.currentMes)],
            [],
            ['Depto', 'Nombre', 'Coef %', 'Cuota Fija', 'Pagado', 'Saldo', 'Estado']
        ];
        resumen.forEach(p => {
            wsData.push([p.departamento, p.nombre, p.coeficiente, p.cuota, p.pagado, p.saldo, p.estado === 'pagado' ? 'Pagado' : 'Pendiente']);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Resumen');

        const gastosData = [
            ['Detalle de Gastos'],
            [],
            ['Fecha', 'Concepto', 'Categoría', 'Frecuencia', 'Monto', 'Mensual Equiv.', 'Estado']
        ];
        gastos.forEach(g => {
            gastosData.push([
                g.fecha, g.concepto,
                Calculos.categoriaLabel(g.categoria),
                Calculos.frecuenciaLabel(g.frecuencia),
                g.monto,
                Calculos.getGastoMensualEquivalente(g),
                g.pagado ? 'Pagado' : 'Pendiente'
            ]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(gastosData);
        ws2['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Gastos');

        const gasFechas = DB.getGasFechas(this.currentMes);
        const gasData = [
            ['Detalle de Gas'],
            ['Período de lectura:', gasFechas.inicio || '', '→', gasFechas.fin || ''],
            [],
            ['Depto', 'Nombre', 'Lectura Ini', 'Lectura Fin', 'Consumo m³', 'Subtotal', 'Monto Fijo', 'Total']
        ];
        propietarios.forEach(p => {
            const gas = DB.getGas(this.currentMes);
            const d = gas[p.departamento] || {};
            const r = Calculos.calcGasDepto(this.currentMes, p.departamento);
            gasData.push([
                p.departamento, p.nombre,
                d.lecturaIni || 0, d.lecturaFin || 0,
                r ? r.consumo : 0,
                r ? r.subtotal : 0,
                r ? r.montoFijo : 0,
                r ? r.total : 0
            ]);
        });
        const ws3 = XLSX.utils.aoa_to_sheet(gasData);
        ws3['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Gas');

        const factura = DB.getFacturaAgua(this.currentMes);
        const aguaData = [
            ['Detalle de Agua'],
            [],
            ['Factura (recibo)', factura ? Calculos.formatMoney(factura.aguaPotable + factura.alcantarillado + factura.cargoFijo + factura.igv) : 'Sin factura'],
            [],
            ['Depto', 'Nombre', 'Lectura Ini', 'Lectura Fin', 'Consumo m³', '%', 'Agua', 'Alcantarillado', 'Cargo Fijo', 'IGV', 'Total']
        ];
        propietarios.forEach(p => {
            const agua = DB.getAgua(this.currentMes);
            const d = agua[p.departamento] || {};
            const r = Calculos.calcAguaDepto(this.currentMes, p.departamento);
            aguaData.push([
                p.departamento, p.nombre,
                d.lecturaIni || 0, d.lecturaFin || 0,
                r ? r.consumo : 0,
                r ? (r.share * 100).toFixed(1) : 0,
                r ? r.aguaPotable : 0,
                r ? r.alcantarillado : 0,
                r ? r.cargoFijo : 0,
                r ? r.igv : 0,
                r ? r.total : 0
            ]);
        });
        const ws4 = XLSX.utils.aoa_to_sheet(aguaData);
        ws4['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws4, 'Agua');

        XLSX.writeFile(wb, `informe-${this.currentMes}.xlsx`);
        this.toast('Excel descargado', 'success');
    },

    // === Confirm Dialog ===
    confirmarCierreModal(modal) {
        if (!modal) return;
        this._modalCierre = modal;
        document.getElementById('confirm-title').textContent = 'Guardar cambios';
        document.getElementById('confirm-message').textContent = 'Los datos ingresados aún no están guardados. ¿Qué deseas hacer?';
        const okBtn = document.getElementById('confirm-ok');
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        newOk.textContent = 'Descartar';
        newOk.addEventListener('click', () => {
            document.getElementById('modal-confirm').style.display = 'none';
            document.getElementById('confirm-save').style.display = 'none';
            const m = this._modalCierre;
            this._modalCierre = null;
            if (m) m.style.display = 'none';
        });
        document.getElementById('confirm-save').style.display = '';
        document.getElementById('modal-confirm').style.display = 'flex';
    },

    showConfirm(title, message, onConfirm) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('confirm-save').style.display = 'none';
        const okBtn = document.getElementById('confirm-ok');
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        newOk.textContent = 'Confirmar';
        newOk.addEventListener('click', () => {
            document.getElementById('modal-confirm').style.display = 'none';
            onConfirm();
        });
        document.getElementById('modal-confirm').style.display = 'flex';
    },

    // === Toast ===
    toast(message, type = '') {
        // Un error de Postgres trae codigo y mensaje largo: un toast de
        // 3 segundos es ilegible, va al panel persistente.
        if (type === 'error' && (String(message).indexOf('PG ') !== -1 || String(message).length > 70)) {
            this.mostrarError(message);
            return;
        }
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type ? 'toast-' + type : ''}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    // Panel de error del servidor. Se queda hasta que lo cierres.
    mostrarError(message) {
        const panel = document.getElementById('error-panel');
        const msg = document.getElementById('error-panel-msg');
        if (!panel || !msg) return;
        msg.textContent = String(message);
        panel.hidden = false;
    },

    ocultarError() {
        const panel = document.getElementById('error-panel');
        if (panel) panel.hidden = true;
    },

    // Las RPC devuelven un PostgrestError suelto ({code, message, ...}),
    // no una Exception. Se formatea igual que el error de fetch para
    // que el panel muestre siempre el codigo y el mensaje de Postgres.
    _errorPostgres(error, contexto) {
        if (!error) return String(contexto);
        const partes = [contexto];
        if (error.code) partes.push('PG ' + error.code + ': ' + (error.message || ''));
        else partes.push(error.message || '');
        if (error.hint) partes.push('Sugerencia: ' + error.hint);
        if (error.details) partes.push('Detalle: ' + error.details);
        return partes.join('\n');
    },

    // === Render ===
    render() {
        const mesLabel = Calculos.getMesLabel(this.currentMes);
        document.getElementById('current-month-label').textContent = mesLabel;
        document.getElementById('calc-month-label').textContent = mesLabel;
        document.getElementById('inf-month-label').textContent = mesLabel;
        document.getElementById('gas-month-label').textContent = mesLabel;
        document.getElementById('agua-month-label').textContent = mesLabel;

        this.renderDashboard();
        this.renderPropietarios();
        this.renderGastos();
        this.renderGas();
        this.renderAgua();
        this.renderPersonal();
        this.renderJardineria();
        this.renderLuzCard();
        this.renderCalculo();
        this.renderInformePreview();
    },

    renderDashboard() {
        const cajaChica = DB.getCajaChica(this.currentMes);
        const totalCuotasMensuales = Calculos.calcTotalCuotasMensuales();
        const totalGastosNormales = Calculos.calcTotalGastosNormalesPagados(this.currentMes);
        const totalGastosExtra = Calculos.calcTotalGastosExtraordinarios(this.currentMes);
        const resumen = Calculos.calcResumenPropietarios(this.currentMes);
        const totalPagado = resumen.reduce((sum, p) => sum + p.pagado, 0);
        const balance = totalPagado - totalGastosNormales;

        document.getElementById('caja-chica-monto').textContent = Calculos.formatMoney(cajaChica);
        document.getElementById('total-gastos').textContent = Calculos.formatMoney(totalGastosNormales);
        document.getElementById('total-pagado').textContent = Calculos.formatMoney(totalPagado);

        const balanceEl = document.getElementById('total-balance');
        balanceEl.textContent = Calculos.formatMoney(balance);
        balanceEl.className = 'card-value ' + (balance >= 0 ? 'status-pagado' : 'status-debe');

        const extraInfo = document.getElementById('extra-info');
        let extraHtml = '';
        extraHtml += `<div class="extra-info-item">📅 Total cuotas fijas: <strong>${Calculos.formatMoney(totalCuotasMensuales)}</strong> · Pagado: <strong>${Calculos.formatMoney(totalPagado)}</strong></div>`;
        if (totalGastosExtra > 0) {
            extraHtml += `<div class="extra-info-item">⚡ Gastos extraordinarios: <strong>${Calculos.formatMoney(totalGastosExtra)}</strong></div>`;
        }
        if (balance < 0) {
            extraHtml += `<div class="extra-info-item extra-deficit">⚠️ Déficit: Los gastos (${Calculos.formatMoney(totalGastosNormales)}) superan las cuotas (${Calculos.formatMoney(totalCuotasMensuales)})
                <div class="deficit-actions">
                    <button class="btn btn-sm btn-outline" onclick="App.cubrirDeficit('caja chica')">Usar Caja Chica</button>
                    <button class="btn btn-sm btn-outline" onclick="App.cubrirDeficit('extraordinario')">Crear Cuota Extra.</button>
                </div>
            </div>`;
        }
        extraInfo.innerHTML = extraHtml;

        const container = document.getElementById('dashboard-propietarios');

        if (resumen.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos cargados</p>';
            return;
        }

        container.innerHTML = resumen.map(p => {
            const statusClass = p.estado === 'pagado' ? 'status-pagado' : (p.estado === 'debe' ? 'status-debe' : 'status-pendiente');
            const statusText = p.estado === 'pagado' ? 'Al día' : (p.estado === 'debe' ? 'Debe' : 'Parcial');
            const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento;

            const ec = Calculos.calcEstadoCuenta(p.id);
            const acumulado = ec ? ec.totalAcumulado : p.saldo;
            const debe = acumulado > 0.01;
            const aFavor = acumulado < -0.01;
            const mesesMora = ec && ec.mesesAdeudados.length
                ? ec.mesesAdeudados.map(m => Calculos.getMesLabel(m)).join(', ')
                : '';

            return `
                <div class="owner-summary">
                    <div class="owner-summary-left">
                        <div class="owner-avatar">${p.departamento || fullName.substring(0, 2)}</div>
                        <div class="owner-summary-info">
                            <div class="owner-name">${fullName}</div>
                            <div class="owner-dept">Cuota: ${Calculos.formatMoney(p.cuotaFija)} · Pagó: ${Calculos.formatMoney(p.pagado)}</div>
                            ${mesesMora ? `<div class="owner-mora">Meses: ${mesesMora}</div>` : ''}
                        </div>
                    </div>
                    <div class="owner-summary-right">
                        ${debe ? `<div class="owner-debt status-debe">${Calculos.formatMoney(acumulado)}</div>` : ''}
                        ${aFavor ? `<div class="owner-debt status-pagado">+${Calculos.formatMoney(Math.abs(acumulado))}</div>` : ''}
                        ${!debe && !aFavor ? `<div class="owner-debt status-pagado">S/. 0</div>` : ''}
                        <div class="owner-status ${statusClass}">${statusText}</div>
                        <button class="btn btn-sm btn-outline btn-estado-cuenta" data-id="${p.id}">Estado de cuenta</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-estado-cuenta').forEach(btn => {
            btn.addEventListener('click', () => this.openEstadoCuentaModal(parseInt(btn.dataset.id)));
        });

        document.getElementById('btn-edit-caja').onclick = () => this.editCajaChica();
    },

    editCajaChica() {
        const actual = DB.getCajaChica(this.currentMes);
        const nuevo = prompt(`Caja chica de ${Calculos.getMesLabel(this.currentMes)}:`, actual);
        if (nuevo === null) return;
        const num = parseFloat(nuevo);
        if (isNaN(num)) {
            this.toast('Monto inválido', 'error');
            return;
        }
        DB.saveCajaChica(this.currentMes, num);
        this.toast('Caja chica actualizada', 'success');
        this.render();
    },

    cubrirDeficit(tipo) {
        const deficit = Math.abs(Calculos.calcDeficit(this.currentMes));

        if (tipo === 'caja chica') {
            const cajaChica = DB.getCajaChica(this.currentMes);
            if (cajaChica < deficit) {
                this.toast(`Caja chica insuficiente (${Calculos.formatMoney(cajaChica)})`, 'error');
                return;
            }
            DB.saveCajaChica(this.currentMes, cajaChica - deficit);
            const cajaMes = DB.getCajaMes(this.currentMes);
            DB.saveCajaMes(this.currentMes, cajaMes + deficit);
            this.toast(`Se tomaron ${Calculos.formatMoney(deficit)} de caja chica`, 'success');
        } else if (tipo === 'extraordinario') {
            const propietarios = DB.getPropietarios();
            const montoPorDept = deficit / propietarios.length;
            propietarios.forEach(p => {
                DB.saveGasto({
                    concepto: `Cuota extraordinaria - ${Calculos.getMesLabel(this.currentMes)}`,
                    monto: montoPorDept,
                    fecha: new Date().toISOString().split('T')[0],
                    categoria: 'arreglos',
                    frecuencia: 'extraordinario',
                    division: 'igualitario',
                    pagadoPor: null,
                    notas: `Creada para cubrir déficit de ${Calculos.formatMoney(deficit)}`
                });
            });
            this.toast(`Cuota extraordinaria de ${Calculos.formatMoney(montoPorDept)} por depto creada`, 'success');
        }

        this.render();
    },

    cerrarMes() {
        this.showConfirm(
            'Cerrar Mes',
            `¿Cerrar ${Calculos.getMesLabel(this.currentMes)}? El saldo se transferirá a caja chica.`,
            () => {
                const nuevoSaldo = DB.cerrarMes(this.currentMes);
                this.closeAllModals();
                this.toast(`Mes cerrado. Caja chica: ${Calculos.formatMoney(nuevoSaldo)}`, 'success');
                this.currentMes = Calculos.shiftMes(this.currentMes, 1);
                DB.saveMesActual(this.currentMes);
                this.render();
            }
        );
    },

    renderPropietarios() {
        const container = document.getElementById('lista-propietarios');
        const info = document.getElementById('coeficientes-info');
        const propietarios = DB.getPropietarios();
        const totalCoef = propietarios.reduce((sum, p) => sum + p.coeficiente, 0);
        const totalM2 = propietarios.reduce((sum, p) => sum + (p.m2 || 0), 0);

        info.innerHTML = `
            <div class="info-bar">
                <span>Coef. total: <strong>${totalCoef.toFixed(2)}%</strong></span>
                <span>m² total: <strong>${totalM2.toFixed(2)}m²</strong></span>
            </div>
        `;

        if (propietarios.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos cargados</p>';
            return;
        }

        container.innerHTML = propietarios.map(p => {
            const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento;
            return `
                <div class="list-item" data-id="${p.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${fullName}</div>
                        <div class="list-item-subtitle">Dpto ${p.departamento || '-'} · ${p.coeficiente}%${p.m2 ? ' · ' + p.m2 + 'm²' : ''}${p.cuotaMensual ? ' · Cuota: ' + Calculos.formatMoney(p.cuotaMensual) : ''}</div>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn-estado-propietario" data-id="${p.id}" title="Estado de cuenta">📊</button>
                        <button class="btn-edit-propietario" data-id="${p.id}" title="Editar">✏️</button>
                        <button class="btn-delete-propietario" data-id="${p.id}" title="Eliminar">🗑</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-estado-propietario').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openEstadoCuentaModal(parseInt(btn.dataset.id));
            });
        });

        container.querySelectorAll('.btn-edit-propietario').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = DB.getPropietario(parseInt(btn.dataset.id));
                if (p) this.openPropietarioModal(p);
            });
        });

        container.querySelectorAll('.btn-delete-propietario').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = DB.getPropietario(parseInt(btn.dataset.id));
                if (p) {
                    this.showConfirm('Eliminar Departamento', `¿Eliminar a ${p.nombre}?`, () => {
                        DB.deletePropietario(p.id);
                        this.toast('Departamento eliminado', 'success');
                        this.render();
                    });
                }
            });
        });
    },

    renderGastos() {
        const container = document.getElementById('lista-gastos');
        const totalesEl = document.getElementById('gastos-totales');
        const categoria = document.getElementById('filter-categoria').value;
        const frecuencia = document.getElementById('filter-frecuencia').value;
        let gastos = DB.getGastos({ mes: this.currentMes });

        if (categoria) gastos = gastos.filter(g => g.categoria === categoria);
        if (frecuencia) gastos = gastos.filter(g => g.frecuencia === frecuencia);

        if (gastos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay gastos registrados este mes</p>';
            totalesEl.style.display = 'none';
            return;
        }

        const totalMonto = gastos.reduce((sum, g) => sum + g.monto, 0);
        const pagados = gastos.filter(g => g.pagado);
        const pendientes = gastos.filter(g => !g.pagado);
        const totalPagados = pagados.reduce((sum, g) => sum + g.monto, 0);
        const totalPendientes = pendientes.reduce((sum, g) => sum + g.monto, 0);

        document.getElementById('gastos-total-monto').textContent = Calculos.formatMoney(totalMonto);
        document.getElementById('gastos-pagados-monto').textContent = Calculos.formatMoney(totalPagados);
        document.getElementById('gastos-pendientes-monto').textContent = Calculos.formatMoney(totalPendientes);
        totalesEl.style.display = 'flex';

        container.innerHTML = gastos.map(g => {
            const equiv = Calculos.getGastoMensualEquivalente(g);
            const freqLabel = Calculos.frecuenciaLabel(g.frecuencia);
            const showEquiv = g.frecuencia !== 'mensual' && g.frecuencia !== 'extraordinario' && g.origen !== 'fijo';
            const divisionLabel = g.frecuencia === 'extraordinario' ? (g.division === 'igualitario' ? 'Igualitario' : 'Proporcional') : '';

            return `
                <div class="list-item" data-id="${g.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${Calculos.categoriaIcon(g.categoria)} ${g.concepto}</div>
                        <div class="list-item-subtitle">
                            <span class="badge badge-${g.categoria}">${Calculos.categoriaLabel(g.categoria)}</span>
                            <span class="badge badge-freq">${freqLabel}</span>
                            ${divisionLabel ? `<span class="badge badge-freq">${divisionLabel}</span>` : ''}
                            ${g.pagado ? '<span class="badge badge-pagado">✅ Pagado</span>' : '<span class="badge badge-pendiente">⏳ Por pagar</span>'}
                            · ${g.fecha}
                            ${showEquiv ? '<br>Mensual equiv: ' + Calculos.formatMoney(equiv) : ''}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="list-item-amount">${Calculos.formatMoney(g.monto)}</span>
                        <div class="list-item-actions">
                            <button class="btn-toggle-pagado btn-icon" data-id="${g.id}" title="${g.pagado ? 'Marcar por pagar' : 'Marcar pagado'}">${g.pagado ? '⏳' : '✅'}</button>
                            <button class="btn-edit-gasto" data-id="${g.id}" title="Editar">✏️</button>
                            <button class="btn-delete-gasto" data-id="${g.id}" title="Eliminar">🗑</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-edit-gasto').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const g = DB.getGasto(parseInt(btn.dataset.id));
                if (g) this.openGastoModal(g);
            });
        });

        container.querySelectorAll('.btn-delete-gasto').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const g = DB.getGasto(parseInt(btn.dataset.id));
                if (g) {
                    this.showConfirm('Eliminar Gasto', `¿Eliminar "${g.concepto}"?`, () => {
                        DB.deleteGasto(g.id);
                        this.toast('Gasto eliminado', 'success');
                        this.render();
                    });
                }
            });
        });

        container.querySelectorAll('.btn-toggle-pagado').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const g = DB.getGasto(parseInt(btn.dataset.id));
                if (g) {
                    DB.saveGasto({ ...g, pagado: !g.pagado });
                    this.toast(g.pagado ? 'Marcado como pagado' : 'Marcado como por pagar', 'success');
                    this.render();
                }
            });
        });
    },

    renderGas() {
        const container = document.getElementById('gas-lista');
        const propietarios = DB.getPropietarios();
        const gasData = DB.getGas(this.currentMes);
        const params = DB.getGasParams();
        const ro = Auth.canWrite() ? '' : ' disabled';

        document.getElementById('gas-precio-balon').value = params.precioBalon;
        document.getElementById('gas-kg-balon').value = params.kgBalon;
        document.getElementById('gas-kg-m3').value = params.kgM3;
        document.getElementById('gas-n-balones').value = params.nBalones;
        document.getElementById('gas-balones-total').textContent = `Total balones del mes: ${Calculos.formatMoney((params.nBalones || 3) * params.precioBalon)}`;

        let html = '';
        let totalGeneral = 0;

        const fechas = DB.getGasFechas(this.currentMes);
        const d = this._gasPeriodo || {};
        const [iniY, iniM, iniD] = (fechas.inicio || '---').split('-');
        const [finY, finM, finD] = (fechas.fin || '---').split('-');
        const iniDisp = d.dIni !== undefined ? d.dIni : iniD;
        const iniMDisp = d.mIni !== undefined ? d.mIni : iniM;
        const finDisp = d.dFin !== undefined ? d.dFin : finD;
        const finMDisp = d.mFin !== undefined ? d.mFin : finM;

        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const dayOptions = (cls, val) => {
            let o = '<option value="">—</option>';
            for (let i = 1; i <= 31; i++) {
                const v = String(i).padStart(2, '0');
                o += `<option value="${v}"${v === val ? ' selected' : ''}>${i}</option>`;
            }
            return `<select class="${cls}"${ro} style="width:58px;font-size:0.75rem;padding:3px;border:1px solid var(--border);border-radius:4px;">${o}</select>`;
        };
        const monthOptions = (cls, val) => {
            let o = '<option value="">—</option>';
            monthNames.forEach((n, i) => {
                const v = String(i + 1).padStart(2, '0');
                o += `<option value="${v}"${v === val ? ' selected' : ''}>${n}</option>`;
            });
            return `<select class="${cls}"${ro} style="width:64px;font-size:0.75rem;padding:3px;border:1px solid var(--border);border-radius:4px;">${o}</select>`;
        };

        html += `
            <div class="list-item periodo-card" style="background:var(--gray-50);">
                <div class="list-item-info">
                    <div class="list-item-title" style="font-size:0.85rem;">📅 Período de lectura (se aplica a todas las medidas)</div>
                    <div class="list-item-subtitle" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <span style="font-size:0.75rem;">Desde:</span>
                        ${dayOptions('periodo-dini', iniDisp)}
                        ${monthOptions('periodo-mini', iniMDisp)}
                        <span style="font-size:0.75rem;">→ Hasta:</span>
                        ${dayOptions('periodo-dfin', finDisp)}
                        ${monthOptions('periodo-mfin', finMDisp)}
                    </div>
                </div>
            </div>
        `;

        propietarios.forEach(p => {
            const d = gasData[p.departamento] || {};
            const lecturaIni = d.lecturaIni || '';
            const lecturaFin = d.lecturaFin || '';
            const resultado = Calculos.calcGasDepto(this.currentMes, p.departamento);

            html += `
                <div class="list-item">
                    <div class="list-item-info">
                        <div class="list-item-title">🔥 ${p.departamento} — ${p.nombre} ${p.apellido || ''}</div>
                        <div class="list-item-subtitle" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <span style="font-size:0.75rem;">Lectura inicial:</span>
                            <input type="number" class="gas-ini" data-dept="${p.departamento}" value="${lecturaIni}" step="0.001"${ro} style="width:80px;font-size:0.8rem;padding:4px;border:1px solid var(--border);border-radius:4px;">
                            <span style="font-size:0.75rem;">Final:</span>
                            <input type="number" class="gas-fin" data-dept="${p.departamento}" value="${lecturaFin}" step="0.001"${ro} style="width:80px;font-size:0.8rem;padding:4px;border:1px solid var(--border);border-radius:4px;">
                            ${resultado ? `<span class="badge badge-freq">${resultado.consumo.toFixed(3)} m³</span>` : ''}
                        </div>
                        ${resultado ? `
                        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;line-height:1.4;">
                            Subtotal: ${Calculos.formatMoney(resultado.subtotal)} · Fijo: ${Calculos.formatMoney(resultado.montoFijo)}
                        </div>
                        ` : ''}
                    </div>
                    <div style="text-align:right;">
                        ${resultado ? `<span class="list-item-amount">${Calculos.formatMoney(resultado.total)}</span>` : '<span class="list-item-amount" style="color:var(--text-muted)">—</span>'}
                    </div>
                </div>
            `;
            if (resultado) totalGeneral += resultado.total;
        });

        const rango = (fechas.inicio && fechas.fin)
            ? ` · 📅 ${Calculos.formatFecha(fechas.inicio)} → ${Calculos.formatFecha(fechas.fin)}`
            : '';
        html += `
            <div class="list-item total-row" style="background:var(--gray-50);font-weight:bold;">
                <div class="list-item-info"><div class="list-item-title">TOTAL GAS${rango}</div></div>
                <span class="list-item-amount">${Calculos.formatMoney(totalGeneral)}</span>
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('.gas-ini, .gas-fin').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const iniEl = container.querySelector(`.gas-ini[data-dept="${dept}"]`);
                const finEl = container.querySelector(`.gas-fin[data-dept="${dept}"]`);
                const ini = iniEl.value === '' ? 0 : parseFloat(iniEl.value) || 0;
                const fin = finEl.value === '' ? 0 : parseFloat(finEl.value) || 0;
                DB.saveGas(this.currentMes, dept, ini, fin);
                this.renderGas();
                this.renderInformePreview();
            });
        });

        container.querySelectorAll('.periodo-dini, .periodo-mini, .periodo-dfin, .periodo-mfin').forEach(el => {
            el.addEventListener('change', () => {
                const year = this.currentMes.split('-')[0];
                const dIni = container.querySelector('.periodo-dini').value;
                const mIni = container.querySelector('.periodo-mini').value;
                const dFin = container.querySelector('.periodo-dfin').value;
                const mFin = container.querySelector('.periodo-mfin').value;
                this._gasPeriodo = { dIni, mIni, dFin, mFin };
                const fechas = DB.getGasFechas(this.currentMes);
                let inicio = fechas.inicio || '';
                let fin = fechas.fin || '';
                if (dIni && mIni) inicio = `${year}-${mIni}-${dIni}`;
                else if (!dIni && !mIni) inicio = '';
                if (dFin && mFin) fin = `${year}-${mFin}-${dFin}`;
                else if (!dFin && !mFin) fin = '';
                DB.saveGasFechas(this.currentMes, inicio, fin);
                this.renderGas();
                this.renderInformePreview();
            });
        });

        ['gas-precio-balon', 'gas-kg-balon', 'gas-kg-m3', 'gas-n-balones'].forEach(id => {
            document.getElementById(id).onchange = () => {
                DB.saveGasParams({
                    precioBalon: parseFloat(document.getElementById('gas-precio-balon').value) || 245,
                    kgBalon: parseFloat(document.getElementById('gas-kg-balon').value) || 45,
                    kgM3: parseFloat(document.getElementById('gas-kg-m3').value) || 2.464,
                    nBalones: parseFloat(document.getElementById('gas-n-balones').value) || 3
                });
                this.renderGas();
                this.renderInformePreview();
            };
        });
    },

    renderAgua() {
        const container = document.getElementById('agua-lista');
        const propietarios = DB.getPropietarios();
        const aguaData = DB.getAgua(this.currentMes);
        const factura = DB.getFacturaAgua(this.currentMes);
        const ro = Auth.canWrite() ? '' : ' disabled';

        let html = '';
        let totalGeneral = 0;

        propietarios.forEach(p => {
            const d = aguaData[p.departamento] || {};
            const lecturaIni = d.lecturaIni || '';
            const lecturaFin = d.lecturaFin || '';
            const resultado = Calculos.calcAguaDepto(this.currentMes, p.departamento);

            html += `
                <div class="list-item">
                    <div class="list-item-info">
                        <div class="list-item-title">💧 ${p.departamento} — ${p.nombre} ${p.apellido || ''}</div>
                        <div class="list-item-subtitle" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <span style="font-size:0.75rem;">Lectura inicial:</span>
                            <input type="number" class="agua-ini" data-dept="${p.departamento}" value="${lecturaIni}" step="0.001"${ro} style="width:80px;font-size:0.8rem;padding:4px;border:1px solid var(--border);border-radius:4px;">
                            <span style="font-size:0.75rem;">Final:</span>
                            <input type="number" class="agua-fin" data-dept="${p.departamento}" value="${lecturaFin}" step="0.001"${ro} style="width:80px;font-size:0.8rem;padding:4px;border:1px solid var(--border);border-radius:4px;">
                            ${resultado ? `<span class="badge badge-freq">${resultado.consumo.toFixed(2)} m³ · ${(resultado.share * 100).toFixed(1)}%</span>` : ''}
                        </div>
                        ${resultado ? `
                        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;line-height:1.4;">
                            Agua: ${Calculos.formatMoney(resultado.aguaPotable)} · Alcant: ${Calculos.formatMoney(resultado.alcantarillado)} · Cargo fijo: ${Calculos.formatMoney(resultado.cargoFijo)} · IGV: ${Calculos.formatMoney(resultado.igv)}
                        </div>
                        ` : ''}
                    </div>
                    <div style="text-align:right;">
                        ${resultado ? `<span class="list-item-amount">${Calculos.formatMoney(resultado.total)}</span>` : '<span class="list-item-amount" style="color:var(--text-muted)">—</span>'}
                    </div>
                </div>
            `;
            if (resultado) totalGeneral += resultado.total;
        });

        html += `
            <div class="list-item" style="background:var(--gray-50);font-weight:bold;">
                <div class="list-item-info"><div class="list-item-title">TOTAL AGUA</div></div>
                <span class="list-item-amount">${factura ? Calculos.formatMoney(totalGeneral) : 'Sin factura'}</span>
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('.agua-ini, .agua-fin').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const iniEl = container.querySelector(`.agua-ini[data-dept="${dept}"]`);
                const finEl = container.querySelector(`.agua-fin[data-dept="${dept}"]`);
                const ini = iniEl.value === '' ? 0 : parseFloat(iniEl.value) || 0;
                const fin = finEl.value === '' ? 0 : parseFloat(finEl.value) || 0;
                DB.saveAgua(this.currentMes, dept, ini, fin);
                this.renderAgua();
                this.renderInformePreview();
            });
        });
    },

    renderLuzCard() {
        const container = document.getElementById('luz-monto');
        if (!container) return;
        const g = DB.getGastoLuz(this.currentMes);
        const editable = Auth.canWrite();
        document.getElementById('luz-mes-label').textContent = Calculos.getMesLabel(this.currentMes);
        container.value = g ? g.monto : '';
        document.getElementById('luz-estado').value = g && g.pagado ? 'pagado' : 'pendiente';
        document.getElementById('luz-monto').disabled = !editable;
        document.getElementById('luz-estado').disabled = !editable;
        const status = document.getElementById('luz-status');
        if (g) {
            const badge = g.pagado ? 'badge-pagado' : 'badge-pendiente';
            const text = g.pagado ? 'Pagado' : 'Por pagar';
            status.innerHTML = `Registrado <span class="badge ${badge}">${text}</span>`;
        } else {
            status.innerHTML = 'Sin registrar este mes';
        }
    },

    renderPersonal() {
        const container = document.getElementById('lista-personal');
        const personal = DB.getPersonal();
        if (!container) return;
        if (personal.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay gastos fijos registrados</p>';
            return;
        }
        container.innerHTML = personal.map(p => {
            if (p.tipo === 'fijo') {
                return `
                    <div class="list-item" data-id="${p.id}">
                        <div class="list-item-info">
                            <div class="list-item-title">${Calculos.categoriaIcon(p.categoria)} ${p.nombre} <span class="badge badge-freq">${Calculos.frecuenciaLabel(p.frecuencia)}</span></div>
                            <div class="list-item-subtitle">
                                Monto: <strong>${p.monto ? Calculos.formatMoney(p.monto) : '—'}</strong>
                                ${p.mesDesde ? ' · Desde ' + Calculos.getMesLabel(p.mesDesde) : ''}
                                ${p.notas ? '<br>' + p.notas : ''}
                            </div>
                        </div>
                        <div class="list-item-actions">
                            <button class="btn-edit-personal" data-id="${p.id}" title="Editar">✏️</button>
                            <button class="btn-delete-personal" data-id="${p.id}" title="Eliminar">🗑</button>
                        </div>
                    </div>
                `;
            }
            const rol = DB.ROLES_PERSONAL[p.rol] || DB.ROLES_PERSONAL.otros;
            return `
                <div class="list-item" data-id="${p.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${rol.categoria === 'porteria' ? '💂' : ''}${rol.categoria === 'descansero' ? '🏠' : ''}${rol.categoria === 'mantenimiento' ? '🛠' : ''}${rol.categoria === 'jardineria' ? '🌿' : ''}${rol.categoria === 'administracion' ? '📋' : ''} ${p.nombre} <span class="badge badge-freq">${rol.label}</span></div>
                        <div class="list-item-subtitle">
                            Sueldo: <strong>${p.sueldoMensual ? Calculos.formatMoney(p.sueldoMensual) : '—'}</strong>
                            ${p.horario ? ' · Horario: ' + p.horario : ''}
                            ${p.dias ? ' · Días: ' + p.dias : ''}
                            ${p.vacaciones ? '<br>🏖 Vacaciones: ' + p.vacaciones : ''}
                            ${p.notas ? '<br>' + p.notas : ''}
                        </div>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn-edit-personal" data-id="${p.id}" title="Editar">✏️</button>
                        <button class="btn-delete-personal" data-id="${p.id}" title="Eliminar">🗑</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-edit-personal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = DB.getPersonalId(parseInt(btn.dataset.id));
                if (p) this.openPersonalModal(p);
            });
        });

        container.querySelectorAll('.btn-delete-personal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = DB.getPersonalId(parseInt(btn.dataset.id));
                if (p) {
                    this.showConfirm('Eliminar Gasto Fijo', `¿Eliminar "${p.nombre}"? Se quitará su gasto del cálculo.`, () => {
                        DB.deletePersonal(p.id);
                        this.toast('Gasto fijo eliminado', 'success');
                        this.render();
                    });
                }
            });
        });
    },

    renderJardineria() {
        const container = document.getElementById('lista-jardineria');
        if (!container) return;
        const items = DB.getJardineria().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">Sin trabajos de jardinería</p>';
            return;
        }
        container.innerHTML = items.map(j => {
            const badge = j.estado === 'realizado'
                ? '<span class="badge badge-pagado">✅ Realizado</span>'
                : '<span class="badge badge-pendiente">⏳ A realizar</span>';
            return `
                <div class="list-item" data-id="${j.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">🌿 ${j.descripcion}</div>
                        <div class="list-item-subtitle">
                            ${badge} · ${j.fecha || ''}
                            ${j.notas ? '<br>' + j.notas : ''}
                        </div>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn-edit-jardineria" data-id="${j.id}" title="Editar">✏️</button>
                        <button class="btn-delete-jardineria" data-id="${j.id}" title="Eliminar">🗑</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-edit-jardineria').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const j = DB.getJardineriaId(parseInt(btn.dataset.id));
                if (j) this.openJardineriaModal(j);
            });
        });

        container.querySelectorAll('.btn-delete-jardineria').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const j = DB.getJardineriaId(parseInt(btn.dataset.id));
                if (j) {
                    this.showConfirm('Eliminar Trabajo', `¿Eliminar "${j.descripcion}"?`, () => {
                        DB.deleteJardineria(j.id);
                        this.toast('Trabajo eliminado', 'success');
                        this.render();
                    });
                }
            });
        });
    },

    renderCalculo() {
        const container = document.getElementById('calculo-detalles');
        const resumen = Calculos.calcResumenPropietarios(this.currentMes);
        const gastos = DB.getGastos({ mes: this.currentMes });
        const totalGastos = Calculos.calcTotalGastosMes(this.currentMes);
        const totalCoef = DB.getPropietarios().reduce((sum, p) => sum + p.coeficiente, 0);
        const pagos = DB.getPagos(this.currentMes);
        const gastosExtra = gastos.filter(g => g.frecuencia === 'extraordinario');

        let html = '';

        if (gastos.length > 0) {
            const porCategoria = Calculos.calcGastosPorCategoria(this.currentMes);
            html += `
                <div class="calc-detail">
                    <div class="calc-detail-header">
                        <h4>Desglose de Gastos del Mes</h4>
                        <span class="calc-amount">${Calculos.formatMoney(totalGastos)}</span>
                    </div>
                    <div class="calc-breakdown">
                        ${Object.entries(porCategoria).map(([cat, monto]) => `
                            <div class="calc-breakdown-item">
                                <span>${Calculos.categoriaIcon(cat)} ${Calculos.categoriaLabel(cat)}</span>
                                <span class="calc-share">${Calculos.formatMoney(monto)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            document.getElementById('btn-simplificar-deudas').style.display = 'block';
        } else {
            document.getElementById('btn-simplificar-deudas').style.display = 'none';
        }

        resumen.forEach(p => {
            const porcentajeReal = totalCoef > 0 ? ((p.coeficiente / totalCoef) * 100).toFixed(1) : 0;
            const pagosDepto = pagos.filter(pg => pg.propietarioId === p.id);
            const pagosFija = pagosDepto.filter(pg => pg.tipo === 'fija');
            const pagosExtra = pagosDepto.filter(pg => pg.tipo === 'extraordinaria');
            const pagosGas = pagosDepto.filter(pg => pg.tipo === 'gas');
            const pagosAgua = pagosDepto.filter(pg => pg.tipo === 'agua');
            const totalFijaPagado = pagosFija.reduce((sum, pg) => sum + pg.monto, 0);
            const totalExtraPagado = pagosExtra.reduce((sum, pg) => sum + pg.monto, 0);
            const totalGasPagado = pagosGas.reduce((sum, pg) => sum + pg.monto, 0);
            const totalAguaPagado = pagosAgua.reduce((sum, pg) => sum + pg.monto, 0);
            const gasActual = Calculos.calcGasDepto(this.currentMes, p.departamento);
            const aguaActual = Calculos.calcAguaDepto(this.currentMes, p.departamento);

            html += `
                <div class="calc-detail">
                    <div class="calc-detail-header">
                        <h4>${p.nombre} ${p.apellido || ''} (${p.departamento || '-'})</h4>
                        <span class="calc-amount ${p.saldo <= 0.01 ? 'status-pagado' : 'status-debe'}">${Calculos.formatMoney(Math.max(0, p.saldo))}</span>
                    </div>
                    <div class="calc-breakdown">
                        <div class="calc-breakdown-item">
                            <span>Coef: ${p.coeficiente}% (${porcentajeReal}% real)${p.m2 ? ' · ' + p.m2 + 'm²' : ''}</span>
                        </div>
                        <div class="calc-breakdown-item">
                            <span>Cuota fija mensual:</span>
                            <span class="calc-share">${Calculos.formatMoney(p.cuota)}</span>
                        </div>
                        <div class="calc-breakdown-item">
                            <span>Pagado cuota fija:</span>
                            <span class="calc-share" style="color:var(--success)">${Calculos.formatMoney(totalFijaPagado)}</span>
                        </div>
            `;

            if (totalExtraPagado > 0) {
                html += `
                        <div class="calc-breakdown-item">
                            <span>Pagado extraordinaria:</span>
                            <span class="calc-share" style="color:var(--success)">${Calculos.formatMoney(totalExtraPagado)}</span>
                        </div>
                `;
            }

            if (gasActual || totalGasPagado > 0) {
                html += `
                        <div class="calc-breakdown-item">
                            <span>Pagado gas:</span>
                            <span class="calc-share" style="color:var(--success)">${Calculos.formatMoney(totalGasPagado)}</span>
                        </div>
                `;
            }

            if (aguaActual || totalAguaPagado > 0) {
                html += `
                        <div class="calc-breakdown-item">
                            <span>Pagado agua:</span>
                            <span class="calc-share" style="color:var(--success)">${Calculos.formatMoney(totalAguaPagado)}</span>
                        </div>
                `;
            }

            html += `
                        <div class="calc-breakdown-item">
                            <span><strong>Saldo:</strong></span>
                            <span class="calc-share ${p.saldo <= 0.01 ? 'status-pagado' : 'status-debe'}"><strong>${Calculos.formatMoney(p.saldo)}</strong></span>
                        </div>
            `;

            if (pagosDepto.length > 0) {
                html += `
                        <div class="calc-breakdown-item" style="flex-direction:column;align-items:flex-start;gap:2px;margin-top:4px;">
                            <span style="font-size:0.75rem;color:var(--text-muted);">Historial de pagos:</span>
                `;
                pagosDepto.forEach(pg => {
                    const tipoLabel = pg.tipo === 'extraordinaria' ? '⚡ Extra' : (pg.tipo === 'gas' ? '🔥 Gas' : (pg.tipo === 'agua' ? '💧 Agua' : '📅 Fija'));
                    html += `
                            <div style="display:flex;align-items:center;gap:6px;font-size:0.8rem;">
                                <span>${tipoLabel} ${Calculos.formatMoney(pg.monto)} <span style="color:var(--text-muted)">${pg.fecha}</span></span>
                                <button class="btn-icon btn-edit-pago" data-id="${pg.id}" title="Editar">✏️</button>
                                <button class="btn-icon btn-delete-pago" data-id="${pg.id}" title="Eliminar">🗑️</button>
                            </div>
                    `;
                });
                html += `
                        </div>
                `;
            }

            html += `
                        <div class="calc-breakdown-item" style="flex-wrap:wrap;gap:6px;margin-top:6px;">
                            <button class="btn btn-sm btn-primary btn-pagar-fija" data-id="${p.id}">
                                💵 Pagar Cuota
                            </button>
                `;

            if (gastosExtra.length > 0) {
                html += `
                            <button class="btn btn-sm btn-primary btn-pagar-extra" data-id="${p.id}">
                                ⚡ Pagar Cuota Extra
                            </button>
                `;
            }

            if (gasActual) {
                html += `
                            <button class="btn btn-sm btn-primary btn-pagar-gas" data-id="${p.id}">
                                🔥 Pagar Gas (${Calculos.formatMoney(gasActual.total)})
                            </button>
                `;
            }

            html += `
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        document.getElementById('simplificacion').style.display = 'none';

        container.querySelectorAll('.btn-pagar-fija').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openPagoModal(parseInt(btn.dataset.id), 'fija');
            });
        });

        container.querySelectorAll('.btn-pagar-gas').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openPagoModal(parseInt(btn.dataset.id), 'gas');
            });
        });

        container.querySelectorAll('.btn-pagar-extra').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openPagoModal(parseInt(btn.dataset.id), 'extraordinaria');
            });
        });

        container.querySelectorAll('.btn-edit-pago').forEach(btn => {
            btn.addEventListener('click', () => {
                this.editarPago(parseInt(btn.dataset.id));
            });
        });

        container.querySelectorAll('.btn-delete-pago').forEach(btn => {
            btn.addEventListener('click', () => {
                this.eliminarPago(parseInt(btn.dataset.id));
            });
        });
    },

    openPagoModal(propietarioId, tipoPreset = 'fija', pago = null) {
        const propietario = DB.getPropietario(propietarioId);
        if (!propietario) return;
        const editando = !!pago;
        const tipoFijo = editando ? (pago.tipo || 'fija') : tipoPreset;

        document.getElementById('modal-pago-title').textContent = editando ? 'Editar Pago' : 'Registrar Pago';
        document.getElementById('pago-id').value = editando ? pago.id : '';
        document.getElementById('pago-propietario-id').value = propietario.id;
        const fullName = [propietario.departamento, propietario.nombre, propietario.apellido].filter(Boolean).join(' ');
        document.getElementById('pago-propietario-nombre').textContent = fullName;
        const mes = editando ? pago.mes : this.currentMes;
        document.getElementById('pago-mes').value = mes;

        const select = document.getElementById('pago-concepto');
        const grupoConcepto = select.closest('.form-group');
        const fijoLabel = document.getElementById('pago-concepto-fijo');
        const esFijo = tipoFijo === 'gas';
        this._pagoTipoFijo = esFijo ? tipoFijo : null;
        select.style.display = esFijo ? 'none' : '';
        fijoLabel.style.display = esFijo ? '' : 'none';
        if (esFijo) {
            fijoLabel.textContent = `🔥 Gas de ${Calculos.getMesLabel(mes)}`;
        }

        select.innerHTML = '';
        if (!esFijo) {
            const addOpt = (value, label) => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify(value);
                opt.textContent = label;
                select.appendChild(opt);
            };
            addOpt({ tipo: 'fija', gastoId: null }, `📅 Cuota fija de ${Calculos.getMesLabel(mes)}`);
            const extras = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            if (extras.length > 0) addOpt({ tipo: 'extraordinaria', gastoId: null }, `⚡ Cuota extra de ${Calculos.getMesLabel(mes)}`);
            const aguaR = Calculos.calcAguaDepto(mes, propietario.departamento);
            if (aguaR) addOpt({ tipo: 'agua', gastoId: null }, `💧 Agua de ${Calculos.getMesLabel(mes)}`);

            const preset = editando ? (pago.tipo || 'fija') : tipoPreset;
            let matched = false;
            for (const opt of select.options) {
                const v = JSON.parse(opt.value);
                if (v.tipo === preset) {
                    opt.selected = true;
                    matched = true;
                    break;
                }
            }
            if (!matched && select.options.length) select.options[0].selected = true;
        }

        document.getElementById('pago-monto').value = editando && pago.monto ? pago.monto : '';
        document.getElementById('pago-fecha').value = editando && pago.fecha
            ? pago.fecha
            : new Date().toISOString().split('T')[0];
        document.getElementById('pago-metodo').value = (editando && pago.metodo) ? pago.metodo : 'efectivo';

        if (!editando) this._sugerirMontoPago();
        document.getElementById('modal-pago').style.display = 'flex';
    },

    _sugerirMontoPago() {
        const propietario = DB.getPropietario(parseInt(document.getElementById('pago-propietario-id').value));
        const mes = document.getElementById('pago-mes').value;
        if (!propietario) return;
        const tipo = this._pagoTipoFijo || (() => {
            const opt = document.getElementById('pago-concepto').selectedOptions[0];
            return opt ? JSON.parse(opt.value).tipo : null;
        })();
        if (!tipo) return;
        let monto = '';
        if (tipo === 'fija') {
            if (propietario.cuotaMensual > 0) monto = String(propietario.cuotaMensual);
        } else if (tipo === 'agua') {
            const aguaR = Calculos.calcAguaDepto(mes, propietario.departamento);
            if (aguaR) monto = String(aguaR.total);
        } else if (tipo === 'gas') {
            const gasR = Calculos.calcGasDepto(mes, propietario.departamento);
            if (gasR) monto = String(gasR.total);
        } else if (tipo === 'extraordinaria') {
            const extras = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            if (extras.length > 0) {
                const propietarios = DB.getPropietarios();
                const totalCoef = propietarios.reduce((s, p) => s + p.coeficiente, 0);
                const share = extras.reduce((sum, g) => sum + Calculos._calcGastoParaPropietario(g, propietario, totalCoef, propietarios.length), 0);
                if (share > 0) monto = String(share);
            }
        }
        document.getElementById('pago-monto').value = monto;
    },

    guardarPago() {
        const id = document.getElementById('pago-id').value;
        const propietarioId = parseInt(document.getElementById('pago-propietario-id').value);
        const mes = document.getElementById('pago-mes').value;
        let tipo = this._pagoTipoFijo;
        if (!tipo) {
            const opt = document.getElementById('pago-concepto').selectedOptions[0];
            if (!opt) {
                this.toast('Selecciona qué está pagando', 'error');
                return;
            }
            tipo = JSON.parse(opt.value).tipo;
        }
        const monto = parseFloat(document.getElementById('pago-monto').value);
        if (isNaN(monto) || monto <= 0) {
            this.toast('Monto inválido', 'error');
            return;
        }
        const pago = {
            propietarioId,
            monto,
            fecha: document.getElementById('pago-fecha').value || new Date().toISOString().split('T')[0],
            mes,
            tipo,
            gastoId: null,
            metodo: document.getElementById('pago-metodo').value
        };
        if (id) pago.id = parseInt(id);
        DB.savePago(pago);
        document.getElementById('modal-pago').style.display = 'none';
        this._pagoTipoFijo = null;
        this.toast('Pago guardado', 'success');
        this.render();
    },

    editarPago(pagoId) {
        const data = DB._load();
        const pago = data.pagos.find(p => p.id === pagoId);
        if (!pago) return;
        this.openPagoModal(pago.propietarioId, 'fija', pago);
    },

    eliminarPago(pagoId) {
        const pago = DB._load().pagos.find(p => p.id === pagoId);
        if (!pago) return;

        const propietario = DB.getPropietario(pago.propietarioId);
        const nombre = propietario ? propietario.nombre : 'Desconocido';
        this.showConfirm('Eliminar Pago', `¿Eliminar pago de ${Calculos.formatMoney(pago.monto)} de ${nombre}?`, () => {
            DB.deletePago(pagoId);
            this.toast('Pago eliminado', 'success');
            this.render();
        });
    },

    showSimplificacion() {
        const transferencias = Calculos.simplificarDeudas();
        const container = document.getElementById('lista-pagos-simplificados');
        const wrapper = document.getElementById('simplificacion');

        if (transferencias.length === 0) {
            container.innerHTML = '<p class="empty-state">Todos están al día</p>';
        } else {
            container.innerHTML = transferencias.map(t => `
                <div class="debt-item">
                    <span>${t.de}</span>
                    <span class="debt-arrow">→</span>
                    <span>${t.para}</span>
                    <span class="debt-amount">${Calculos.formatMoney(t.monto)}</span>
                </div>
            `).join('');
        }

        wrapper.style.display = 'block';
    },

    renderInformePreview() {
        const container = document.getElementById('preview-informe');
        const resumen = Calculos.calcResumenPropietarios(this.currentMes);
        const gastos = DB.getGastos({ mes: this.currentMes });
        const totalGastos = Calculos.calcTotalGastosMes(this.currentMes);
        const gastosPagados = gastos.filter(g => g.pagado);
        const gastosPendientes = gastos.filter(g => !g.pagado);
        const totalPagados = gastosPagados.reduce((sum, g) => sum + g.monto, 0);
        const totalPendientes = gastosPendientes.reduce((sum, g) => sum + g.monto, 0);
        const totalGas = Calculos.calcGasTotal(this.currentMes);
        const totalAgua = Calculos.calcAguaTotal(this.currentMes);
        const propietarios = DB.getPropietarios();

        const gasFechas = DB.getGasFechas(this.currentMes);
        const gasRango = (gasFechas.inicio && gasFechas.fin)
            ? ` · 📅 ${Calculos.formatFecha(gasFechas.inicio)} → ${Calculos.formatFecha(gasFechas.fin)}`
            : '';

        if (gastos.length === 0 && totalGas === 0 && totalAgua === 0) {
            container.innerHTML = `<p class="empty-state">No hay datos para ${Calculos.getMesLabel(this.currentMes)}</p>`;
            return;
        }

        let html = `
            <div class="calc-detail">
                <div class="calc-detail-header">
                    <h4>${Calculos.getMesLabel(this.currentMes)}</h4>
                    <span class="calc-amount">${Calculos.formatMoney(totalGastos)}</span>
                </div>
                <div class="calc-breakdown">
                    ${gastos.map(g => {
                        const showEquiv = g.frecuencia !== 'mensual' && g.frecuencia !== 'extraordinario' && g.origen !== 'fijo';
                        const estadoBadge = g.pagado
                            ? '<span class="badge badge-pagado">✅</span>'
                            : '<span class="badge badge-pendiente">⏳</span>';
                        return `
                            <div class="calc-breakdown-item">
                                <span>${Calculos.categoriaIcon(g.categoria)} ${g.concepto} <span class="badge badge-freq">${Calculos.frecuenciaLabel(g.frecuencia)}</span> ${estadoBadge}</span>
                                <span class="calc-share">${Calculos.formatMoney(g.monto)}${showEquiv ? ' <small>(' + Calculos.formatMoney(Calculos.getGastoMensualEquivalente(g)) + '/mes)</small>' : ''}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="calc-breakdown" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px;">
                    <div class="calc-breakdown-item">
                        <span>✅ Pagados (${gastosPagados.length})</span>
                        <span class="calc-share status-pagado">${Calculos.formatMoney(totalPagados)}</span>
                    </div>
                    <div class="calc-breakdown-item">
                        <span>⏳ Por pagar (${gastosPendientes.length})</span>
                        <span class="calc-share status-debe">${Calculos.formatMoney(totalPendientes)}</span>
                    </div>
                </div>
            </div>
        `;

        if (totalGas > 0) {
            html += `
                <div class="calc-detail">
                    <div class="calc-detail-header">
                        <h4>🔥 Gas${gasRango}</h4>
                        <span class="calc-amount">${Calculos.formatMoney(totalGas)}</span>
                    </div>
                    <div class="calc-breakdown">
                        ${propietarios.map(p => {
                            const r = Calculos.calcGasDepto(this.currentMes, p.departamento);
                            if (!r) return '';
                            return `
                                <div class="calc-breakdown-item">
                                    <span>${p.departamento} — ${p.nombre}</span>
                                    <span class="calc-share">${r.consumo.toFixed(3)} m³ → ${Calculos.formatMoney(r.total)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        if (totalAgua > 0) {
            html += `
                <div class="calc-detail">
                    <div class="calc-detail-header">
                        <h4>💧 Agua</h4>
                        <span class="calc-amount">${Calculos.formatMoney(totalAgua)}</span>
                    </div>
                    <div class="calc-breakdown">
                        ${propietarios.map(p => {
                            const r = Calculos.calcAguaDepto(this.currentMes, p.departamento);
                            if (!r) return '';
                            return `
                                <div class="calc-breakdown-item">
                                    <span>${p.departamento} — ${p.nombre}</span>
                                    <span class="calc-share">${r.consumo.toFixed(2)} m³ → ${Calculos.formatMoney(r.total)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        html += `<h3>Resumen por Departamento</h3>`;
        html += resumen.map(p => {
            const gasR = Calculos.calcGasDepto(this.currentMes, p.departamento);
            const aguaR = Calculos.calcAguaDepto(this.currentMes, p.departamento);
            const extra = (gasR ? gasR.total : 0) + (aguaR ? aguaR.total : 0);
            return `
                <div class="calc-breakdown-item" style="padding:8px 0;">
                    <span>${p.nombre} ${p.apellido || ''} (${p.departamento || '-'})</span>
                    <span class="calc-share ${p.saldo <= 0.01 ? 'status-pagado' : 'status-debe'}">
                        Cuota: ${Calculos.formatMoney(Math.max(0, p.saldo))}
                        ${extra > 0 ? ' · Gas/Agua: ' + Calculos.formatMoney(extra) : ''}
                        ${p.estado === 'pagado' ? ' ✅' : ''}
                    </span>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
