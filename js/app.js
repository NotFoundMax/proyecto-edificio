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
        this.bindPropietarioForm();
        if (Auth.esPropietario()) {
            this.navigateTo('propietario');
        } else {
            this.navigateTo('dashboard');
        }
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

        const themeBtn = document.getElementById('btn-theme');
        if (themeBtn) {
            const applyIcon = () => {
                const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
                const icon = themeBtn.querySelector('.material-symbols-outlined');
                if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
                themeBtn.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
                themeBtn.title = dark ? 'Modo claro' : 'Modo oscuro';
            };
            applyIcon();
            themeBtn.addEventListener('click', () => {
                const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
                const next = isDark ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('theme', next); } catch(e) {}
                applyIcon();
            });
        }
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
        const header = document.getElementById('app-header');
        const nav = document.getElementById('bottom-nav');
        if (header) header.style.display = 'none';
        if (nav) nav.style.display = 'none';
    },

    showChrome() {
        const header = document.getElementById('app-header');
        const nav = document.getElementById('bottom-nav');
        if (header) header.style.display = '';
        if (nav) nav.style.display = '';
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
        if (select) select.innerHTML = '';
        if (filter) filter.innerHTML = '<option value="">Todas las categorías</option>';

        Object.entries(CATEGORIAS).forEach(([key, val]) => {
            const opt = `<option value="${key}">${val.icon} ${val.label}</option>`;
            if (select) select.innerHTML += opt;
            if (filter) filter.innerHTML += opt;
        });
    },

    // === Navigation ===
    bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'btn-more-menu') {
                    document.getElementById('more-menu').style.display = 'flex';
                    return;
                }
                this.navigateTo(btn.dataset.screen);
            });
        });

        const moreMenu = document.getElementById('more-menu');
        if (moreMenu) {
            moreMenu.querySelectorAll('button[data-screen]').forEach(b => {
                b.addEventListener('click', () => {
                    this.navigateTo(b.dataset.screen);
                    moreMenu.style.display = 'none';
                });
            });
        }

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
            propietario: 'Mi Departamento',
            propietarios: 'Departamentos',
            gastos: 'Gastos',
            consumos: 'Consumos',
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
            ['btn-prev-month-agua', -1], ['btn-next-month-agua', 1],
            ['btn-prev-month-consumos', -1], ['btn-next-month-consumos', 1]
        ];
        handlers.forEach(([id, delta]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', () => {
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

        const formPago = document.getElementById('form-pago');
        if (formPago) formPago.addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarPago();
        });
        const pagoConcepto = document.getElementById('pago-concepto');
        if (pagoConcepto) pagoConcepto.addEventListener('change', () => {
            this._sugerirMontoPago();
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target !== modal) return;
                if (modal.id === 'modal-confirm') modal.style.display = 'none';
            });
        });

        const btnAddProp = document.getElementById('btn-add-propietario');
        if (btnAddProp) btnAddProp.addEventListener('click', () => {
            this.openPropietarioModal();
        });

        const btnAddGasto = document.getElementById('btn-add-gasto');
        if (btnAddGasto) btnAddGasto.addEventListener('click', () => {
            this.openGastoModal();
        });

        const btnAddPersonal = document.getElementById('btn-add-personal');
        if (btnAddPersonal) btnAddPersonal.addEventListener('click', () => {
            this.openPersonalModal();
        });

        const btnAddJard = document.getElementById('btn-add-jardineria');
        if (btnAddJard) btnAddJard.addEventListener('click', () => {
            this.openJardineriaModal();
        });

        const btnAguaFormula = document.getElementById('btn-agua-formula');
        if (btnAguaFormula) btnAguaFormula.addEventListener('click', () => {
            this.openFacturaAguaModal();
        });

        const btnSimpl = document.getElementById('btn-simplificar-deudas');
        if (btnSimpl) btnSimpl.addEventListener('click', () => {
            this.showSimplificacion();
        });

        const confirmCancel = document.getElementById('confirm-cancel');
        if (confirmCancel) confirmCancel.addEventListener('click', () => {
            const mc = document.getElementById('modal-confirm');
            if (mc) mc.style.display = 'none';
        });

        const confirmSave = document.getElementById('confirm-save');
        if (confirmSave) confirmSave.addEventListener('click', () => {
            const mc = document.getElementById('modal-confirm');
            if (mc) mc.style.display = 'none';
            confirmSave.style.display = 'none';
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
        const ocupEl = document.getElementById('propietario-ocupacion');
        const propietario = {
            nombre: document.getElementById('propietario-nombre').value.trim(),
            apellido: document.getElementById('propietario-apellido').value.trim(),
            departamento: document.getElementById('propietario-departamento').value.trim(),
            coeficiente: isNaN(coeficiente) ? 0 : coeficiente,
            m2: parseFloat(document.getElementById('propietario-m2').value) || 0,
            cuotaMensual: parseFloat(document.getElementById('propietario-cuota').value) || 0,
            email: document.getElementById('propietario-email').value.trim(),
            ocupacion: ocupEl ? ocupEl.value : 'propietario'
        };
        if (id) propietario.id = parseInt(id);
        // Coeficiente calculado automáticamente a partir de m²
        const m2 = propietario.m2 || 0;
        const otrosM2 = (DB.getPropietarios() || []).filter(p => p.id !== (id ? parseInt(id) : -1)).reduce((s, p) => s + (Number(p.m2) || 0), 0);
        const total = otrosM2 + m2;
        propietario.coeficiente = total > 0 ? (m2 / total) * 100 : 0;
        // Cuota mensual: se calcula en el cierre de mes, no se ingresa manualmente
        propietario.cuotaMensual = 0;
        return propietario;
    },

    _actualizarCoeficientePropietario() {
        const m2Input = document.getElementById('propietario-m2');
        const m2 = parseFloat(m2Input.value) || 0;
        const id = document.getElementById('propietario-id').value;
        const otrosM2 = (DB.getPropietarios() || [])
            .filter(p => p.id !== (id ? parseInt(id) : -1))
            .reduce((s, p) => s + (Number(p.m2) || 0), 0);
        const total = otrosM2 + m2;
        const coef = total > 0 ? (m2 / total) * 100 : 0;
        const coefDisplay = document.getElementById('propietario-coeficiente-display');
        const cuotaDisplay = document.getElementById('propietario-cuota-display');
        const coefHidden = document.getElementById('propietario-coeficiente');
        const cuotaHidden = document.getElementById('propietario-cuota');
        if (coefDisplay) coefDisplay.textContent = coef.toFixed(2) + '%';
        if (cuotaDisplay) cuotaDisplay.textContent = 'Se calcula al cerrar el mes';
        if (coefHidden) coefHidden.value = coef.toFixed(2);
        if (cuotaHidden) cuotaHidden.value = '0';
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
        const m2Input = document.getElementById('propietario-m2');
        const m2UnlockWrap = document.getElementById('propietario-m2-unlock-wrap');
        const m2Unlock = document.getElementById('propietario-m2-unlock');
        const m2Lock = document.getElementById('propietario-m2-lock');
        const ocup = document.getElementById('propietario-ocupacion');

        if (propietario) {
            title.textContent = 'Editar datos del departamento';
            document.getElementById('propietario-id').value = propietario.id;
            document.getElementById('propietario-nombre').value = propietario.nombre || '';
            document.getElementById('propietario-apellido').value = propietario.apellido || '';
            document.getElementById('propietario-departamento').value = propietario.departamento || '';
            if (m2Input) { m2Input.value = propietario.m2 || ''; m2Input.disabled = true; }
            if (m2UnlockWrap) m2UnlockWrap.style.display = 'block';
            if (m2Unlock) {
                m2Unlock.checked = false;
                m2Unlock.onchange = () => {
                    if (!m2Input) return;
                    if (m2Unlock.checked) {
                        const ok = confirm('Editar el área (m²) afecta el coeficiente y el prorrateo. ¿Deseas continuar?');
                        if (!ok) { m2Unlock.checked = false; m2Input.disabled = true; return; }
                        m2Input.disabled = false;
                        m2Input.focus();
                    } else {
                        m2Input.disabled = true;
                    }
                };
            }
            if (m2Lock) m2Lock.textContent = '(protegido por defecto)';
            if (ocup) ocup.value = propietario.ocupacion || 'propietario';
            this._actualizarCoeficientePropietario();
            document.getElementById('propietario-email').value = propietario.email || '';
        } else {
            title.textContent = 'Nuevo departamento';
            form.reset();
            document.getElementById('propietario-id').value = '';
            if (m2Input) m2Input.disabled = false;
            if (m2UnlockWrap) m2UnlockWrap.style.display = 'none';
            if (m2Unlock) m2Unlock.checked = false;
            if (m2Lock) m2Lock.textContent = '';
            if (ocup) ocup.value = 'propietario';
            this._actualizarCoeficientePropietario();
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
                    <td>${Calculos.formatMoney(f.cuotaFija || 0)}</td>
                    <td>${(f.extraordinarias||0) > 0.005 ? Calculos.formatMoney(f.extraordinarias) : '—'}</td>
                    <td>${(f.gas||0) > 0.005 ? Calculos.formatMoney(f.gas) : '—'}</td>
                    <td>${(f.agua||0) > 0.005 ? Calculos.formatMoney(f.agua) : '—'}</td>
                    <td>${Calculos.formatMoney(f.cargo || 0)}</td>
                    <td>${Calculos.formatMoney(f.pagado || 0)}</td>
                    <td class="${(f.saldo||0) > 0.01 ? 'ec-debe' : 'ec-al-dia'}">${Calculos.formatMoney(f.saldo || 0)}</td>
                    <td class="${(f.acumulado||0) > 0.01 ? 'ec-debe' : (f.acumulado||0) < -0.01 ? 'ec-favor' : 'ec-al-dia'}">${Calculos.formatMoney(f.acumulado || 0)}</td>
                </tr>`).join('');

            const totalClase = ec.totalAcumulado > 0.01 ? 'ec-debe' : ec.totalAcumulado < -0.01 ? 'ec-favor' : 'ec-al-dia';
            cuerpo.innerHTML = `
                <div class="ec-info">Cálculo por mes: <strong>gastos comunes prorrateados por coeficiente + consumos de agua y gas</strong> (las extraordinarias se muestran aparte cuando aplican).</div>
                <div class="ec-table-wrap">
                <table class="ec-table">
                    <thead>
                        <tr><th>Mes</th><th>Comunes</th><th>Extra.</th><th>Gas</th><th>Agua</th><th>Cargo</th><th>Pagado</th><th>Saldo</th><th>Acum.</th></tr>
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
        doc.text(`Cálculo: prorrateo por coeficiente + consumos (agua/gas)`, 20, 38);

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

    // === Propietario Form: coeficiente y cuota automáticos ===
    bindPropietarioForm() {
        const m2Input = document.getElementById('propietario-m2');
        if (m2Input) {
            m2Input.addEventListener('input', () => this._actualizarCoeficientePropietario());
        }
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
        const propietarios = this.getPropietariosOrdenados();
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
        this.bindGastosNuevo();
        const formTransferir = document.getElementById('form-transferir');
        if (formTransferir) formTransferir.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = parseInt(document.getElementById('transferir-propietario-id').value);
            const p = DB.getPropietario(id);
            if (!p) { this.toast('No se encontró el departamento', 'error'); return; }
            const nombre = (document.getElementById('transferir-nombre').value || '').trim();
            const apellido = (document.getElementById('transferir-apellido').value || '').trim();
            const email = (document.getElementById('transferir-email').value || '').trim();
            const ocup = document.getElementById('transferir-ocupacion') ? document.getElementById('transferir-ocupacion').value : (p.ocupacion || 'propietario');
            const nota = (document.getElementById('transferir-nota').value || '').trim();
            if (!nombre) { this.toast('Ingresa el nombre del nuevo titular', 'error'); return; }
            const actualizado = { ...p, nombre, apellido, email, ocupacion: ocup };
            if (nota) actualizado.notaTitularidad = nota;
            DB.savePropietario(actualizado);
            this.closeAllModals();
            this.toast('Titularidad transferida', 'success');
            this.render();
        });

        document.getElementById('form-propietario').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('propietario-id').value;
            const propietario = this._leerFormPropietario();

            if (!propietario.m2 || propietario.m2 <= 0) {
                this.toast('El m² del departamento debe ser mayor a 0', 'error');
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

        // Luz: gestionada desde tabla de consumos (renderLuzCard)
    },

    // === Filters ===
    bindFilters() {
        const fc = document.getElementById('filter-categoria');
        const ff = document.getElementById('filter-frecuencia');
        if (fc) fc.addEventListener('change', () => this.renderGastos());
        if (ff) ff.addEventListener('change', () => this.renderGastos());
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
        const propietarios = this.getPropietariosOrdenados();

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
        const propietarios = this.getPropietariosOrdenados();

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


    getPropietariosOrdenados() {
        const list = (DB.getPropietarios ? DB.getPropietarios() : []) || [];
        return [...list].sort((a,b)=>{
            const da = String(a.departamento || '').trim();
            const db = String(b.departamento || '').trim();
            const na = parseInt(da.replace(/\D/g,''),10);
            const nb = parseInt(db.replace(/\D/g,''),10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return nb - na;
            if (da !== db) return db.localeCompare(da, 'es', {numeric:true, sensitivity:'base'});
            return String(b.id||0).localeCompare(String(a.id||0));
        });
    },

    // === Render ===
    render() {
        const mesLabel = Calculos.getMesLabel(this.currentMes);
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('current-month-label', mesLabel);
        set('calc-month-label', mesLabel);
        set('inf-month-label', mesLabel);
        set('gas-month-label', mesLabel);
        set('agua-month-label', mesLabel);
        set('consumos-month-label', mesLabel);

        this.renderDashboard();
        this.renderPropietarioView();
        this.renderPropietarios();
        this.renderGastos();
        this.renderConsumos && this.renderConsumos();
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
        const calc = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const totals = calc ? calc.totals : { comunes:0, cargo:0, pagado:0, pendiente:0, departamentos:0, alDia:0, consumosMes:0, gastosMes:0 };
        const totalCargo = totals.cargo || 0;
        const totalPagado = totals.pagado || 0;
        const totalPendiente = totals.pendiente || 0;
        const totalGastosMes = (totals.gastosMes != null ? totals.gastosMes : totals.comunes) || 0;
        const pct = totalCargo > 0 ? Math.round((totalPagado / totalCargo) * 100) : 0;

        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('kpi-gastos', Calculos.formatMoney(totals.comunes || 0));
        setText('kpi-recaudado', pct + '%');
        setText('kpi-caja', Calculos.formatMoney(cajaChica));
        setText('kpi-estado-mes', 'Abierto');

        const extraInfo = document.getElementById('extra-info');
        let extraHtml = '';
        if (totalPendiente > 0.01) {
            extraHtml += `<div class="dashboard-alert" role="alert">
                <div class="dashboard-alert-title"><span class="material-symbols-outlined" style="font-size:20px;">payments</span> Cobros pendientes del mes</div>
                <div class="dashboard-alert-body">Total calculado a cobrar: <strong>${Calculos.formatMoney(totalCargo)}</strong>. Recaudado: <strong>${Calculos.formatMoney(totalPagado)}</strong>. Pendiente: <strong>${Calculos.formatMoney(totalPendiente)}</strong> (${totals.alDia || 0} de ${totals.departamentos || 0} departamentos al día).</div>
                <div class="dashboard-alert-actions">
                    <button class="btn btn-sm" onclick="App.navigateTo('calculo')">Ir a Cálculo</button>
                </div>
            </div>`;
        }
        if (extraInfo) extraInfo.innerHTML = extraHtml;

        // === Semáforo de Cuadre (cargos calculados vs pagos) ===
        this.actualizarSemaforoCuadre(totalCargo, totalCargo, totalPagado);

        const container = document.getElementById('dashboard-propietarios');
        if (!container) return;

        const rows = calc ? calc.rows : [];
        if (rows.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos cargados</p>';
        } else {
            container.innerHTML = `
                <table class="deptos-table">
                    <thead>
                        <tr>
                            <th>Depto</th>
                            <th>m²</th>
                            <th class="num-left">Total a pagar</th>
                            <th class="num-left">Pagado</th>
                            <th class="num-left">Saldo</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            const estadoKey = r.saldo <= 0.01 ? 'ok' : (r.pagado > 0.01 ? 'parcial' : 'debe');
                            const estadoText = r.estado || (estadoKey === 'ok' ? 'Al día' : (estadoKey === 'parcial' ? 'Parcial' : 'Pendiente'));
                            return `
                                <tr>
                                    <td><strong>${r.depto}</strong></td>
                                    <td>${Number(r.m2||0).toFixed(2)}</td>
                                    <td class="num-left">${Calculos.formatMoney(r.cargo || 0)}</td>
                                    <td class="num-left">${Calculos.formatMoney(r.pagado || 0)}</td>
                                    <td class="num-left">${Calculos.formatMoney(Math.max(0, r.saldo || 0))}</td>
                                    <td><span class="badge-status ${estadoKey}">${estadoText}</span></td>
                                    <td><button class="btn btn-sm btn-outline btn-estado-cuenta" data-id="${r.id}">Estado de cuenta</button></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;

            container.querySelectorAll('.btn-estado-cuenta').forEach(btn => {
                btn.addEventListener('click', () => this.openEstadoCuentaModal(parseInt(btn.dataset.id)));
            });
        }

        const btnEditCaja = document.getElementById('btn-edit-caja');
        if (btnEditCaja) btnEditCaja.onclick = () => this.editCajaChica();
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
            const propietarios = this.getPropietariosOrdenados();
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

    actualizarSemaforoCuadre(totalGastos, totalCuotas, totalPagos) {
        const elG = document.getElementById('sc-gastos');
        const elC = document.getElementById('sc-cuotas');
        const elP = document.getElementById('sc-pagos');
        const elAlert = document.getElementById('sc-alert');
        const card = document.getElementById('semaforo-cuadre');
        const btnCerrar = document.getElementById('btn-cerrar-mes');
        if (!elG || !elC || !elP || !card) return;

        elG.textContent = Calculos.formatMoney(totalGastos);
        elC.textContent = Calculos.formatMoney(totalCuotas);
        elP.textContent = Calculos.formatMoney(totalPagos);

        const cuadre = (typeof Calculator !== 'undefined' && Calculator.verificarCuadre)
            ? Calculator.verificarCuadre(totalGastos, totalCuotas, totalPagos)
            : { cuadra: Math.abs(totalGastos-totalCuotas)<0.01 && Math.abs(totalCuotas-totalPagos)<0.01, diferencias: {gastosVsCuotas: totalGastos-totalCuotas, cuotasVsPagos: totalCuotas-totalPagos}, semaforo: 'rojo' };
        card.classList.remove('is-ok', 'is-warn', 'is-error');

        const diffGC = Math.abs((cuadre.diferencias && cuadre.diferencias.gastosVsCuotas) || 0);
        const diffCP = Math.abs((cuadre.diferencias && cuadre.diferencias.cuotasVsPagos) || 0);

        if (cuadre.cuadra && cuadre.semaforo === 'verde') {
            card.classList.add('is-ok');
            if (elAlert) elAlert.textContent = 'Cuadre exacto: gastos, cuotas y pagos coinciden.';
            if (btnCerrar) btnCerrar.disabled = false;
        } else if (diffGC < 0.01 && diffCP > 0.01) {
            // Gastos y cuotas cuadran, faltan pagos
            card.classList.add('is-warn');
            if (elAlert) elAlert.textContent = 'Cuotas generadas según gastos; pagos pendientes por ' + Calculos.formatMoney(diffCP) + '.';
            if (btnCerrar) btnCerrar.disabled = false;
        } else if (diffGC >= 0.01 && diffCP < 0.01) {
            card.classList.add('is-error');
            if (elAlert) elAlert.textContent = 'Diferencia entre gastos y cuotas: ' + Calculos.formatMoney(diffGC) + '. Revisa el prorrateo/cálculo.';
            if (btnCerrar) btnCerrar.disabled = true;
        } else {
            card.classList.add('is-error');
            const partes = [];
            if (diffGC >= 0.01) partes.push('gastos vs cuotas ' + Calculos.formatMoney(diffGC));
            if (diffCP >= 0.01) partes.push('cuotas vs pagos ' + Calculos.formatMoney(diffCP));
            if (elAlert) elAlert.textContent = 'Descuadre: ' + (partes.join(' · ') || 'revisar valores') + '.';
            if (btnCerrar) btnCerrar.disabled = true;
        }
    },

    cerrarMes() {
        // Verificar cuadre antes de cerrar (modelo unificado)
        const calc = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const totalCargo = calc ? (calc.totals.cargo || 0) : 0;
        const totalPagos = calc ? (calc.totals.pagado || 0) : 0;
        const cuadre = Calculator.verificarCuadre(totalCargo, totalCargo, totalPagos);
        if (!cuadre.cuadra || Math.abs(totalCargo - totalPagos) > 0.01) {
            this.toast('No se puede cerrar el mes: hay pagos pendientes o descuadre en el cálculo', 'error');
            return;
        }
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

    renderPropietarioView() {
        const screen = document.getElementById('screen-propietario');
        if (!screen) return;
        // Vista del propietario (o vista previa del primero) basada en cálculo unificado
        const props = this.getPropietariosOrdenados();
        const prop = props[0];
        if (!prop) return;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const mes = this.currentMes;
        const mesLabel = Calculos.getMesLabel(mes);
        set('prop-month-label', mesLabel);

        const nombreFull = [prop.nombre, prop.apellido].filter(Boolean).join(' ') || 'Propietario';
        set('prop-pill', `Depto ${prop.departamento || '-'} · ${nombreFull}`);
        set('prop-depto-num', prop.departamento || '-');
        set('prop-m2', (prop.m2 ? Number(prop.m2).toFixed(2) : '-') + ' m²');
        set('prop-coef', (Number(prop.coeficiente) || 0).toFixed(2) + '%');
        set('prop-nombre', nombreFull);

        const calc = Calculos.calcMes ? Calculos.calcMes(mes) : null;
        const row = calc ? calc.rows.find(r => r.id == prop.id) : null;
        const comunes = row ? (Number(row.comunes) || 0) : 0;
        const agua = row ? (Number(row.agua) || 0) : 0;
        const gas = row ? (Number(row.gas) || 0) : 0;
        const cargo = row ? (Number(row.cargo) || 0) : 0;
        const pagado = row ? (Number(row.pagado) || 0) : 0;
        const saldo = row ? (Number(row.saldo) || Math.max(0, cargo - pagado)) : Math.max(0, cargo - pagado);

        set('prop-monto', Calculos.formatMoney(Math.max(0, saldo)));
        set('prop-hero-detail', `Total del mes ${Calculos.formatMoney(cargo)} · Pagado ${Calculos.formatMoney(pagado)}`);
        set('prop-gasto-comun', Calculos.formatMoney(comunes));
        set('prop-agua', Calculos.formatMoney(agua));
        set('prop-gas', Calculos.formatMoney(gas));
        set('prop-total', Calculos.formatMoney(cargo));

        const heroLabel = document.getElementById('prop-hero-label');
        const estadoEl = document.getElementById('prop-estado');
        if (heroLabel) heroLabel.textContent = saldo > 0.01 ? `Saldo pendiente — ${mesLabel}` : `Estado de cuenta — ${mesLabel}`;
        if (estadoEl) {
            if (saldo <= 0.01) {
                estadoEl.textContent = 'Al día';
                estadoEl.className = 'badge badge-pagado';
            } else {
                estadoEl.textContent = 'Pago pendiente';
                estadoEl.className = 'badge badge-pendiente';
            }
        }

        // Historial de pagos del mes para este depto
        const pagos = (DB.getPagos(mes) || []).filter(pg => pg.propietarioId === prop.id);
        const hist = document.getElementById('prop-historial-pagos');
        if (hist) {
            if (pagos.length === 0) {
                hist.innerHTML = '<p class="empty-state" style="margin:0">Sin pagos registrados este mes.</p>';
            } else {
                hist.innerHTML = `
                    <table class="deptos-table">
                        <thead><tr><th>Fecha</th><th>Concepto</th><th class="num-left">Monto</th><th>Estado</th></tr></thead>
                        <tbody>
                            ${pagos.map(pg => {
                                const concepto = pg.tipo === 'agua' ? 'Pago agua' : (pg.tipo === 'gas' ? 'Pago gas' : (pg.tipo === 'extraordinaria' ? 'Cuota extraordinaria' : 'Abono cuota'));
                                return `<tr>
                                    <td>${pg.fecha || ''}</td>
                                    <td>${concepto} ${mesLabel.toLowerCase()}</td>
                                    <td class="num-left">${Calculos.formatMoney(Number(pg.monto)||0)}</td>
                                    <td><span class="badge badge-pagado">Registrado</span></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                    <p style="font-size:13px;color:var(--md-sys-color-on-surface-variant);margin-top:8px">Si tienes observaciones sobre tu estado de cuenta, comunícate con la administración.</p>
                `;
            }
        }

        // Bottom nav tabs dentro de la vista propietario
        const nav = document.getElementById('prop-bottom-nav');
        if (nav && !nav._bound) {
            nav.querySelectorAll('.prop-nav-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const view = btn.dataset.view;
                    nav.querySelectorAll('.prop-nav-btn').forEach(b => {
                        const on = b === btn;
                        b.classList.toggle('active', on);
                        b.style.color = on ? 'var(--md-sys-color-on-surface)' : 'var(--md-sys-color-on-surface-variant)';
                        b.style.background = on ? 'var(--md-sys-color-surface-container-high)' : 'none';
                    });
                    ['dashboard','comunicados','tickets','configuracion'].forEach(v => {
                        const el = document.getElementById('prop-view-' + v);
                        if (el) el.style.display = (v === view) ? 'block' : 'none';
                    });
                });
            });
            nav._bound = true;
        }

        // Month selector for propietario view
        const prev = document.getElementById('btn-prev-month-prop');
        const next = document.getElementById('btn-next-month-prop');
        if (prev && !prev._bound) { prev.addEventListener('click', () => { this.currentMes = Calculos.shiftMes(this.currentMes, -1); DB.saveMesActual(this.currentMes); this.render(); }); prev._bound = true; }
        if (next && !next._bound) { next.addEventListener('click', () => { this.currentMes = Calculos.shiftMes(this.currentMes, 1); DB.saveMesActual(this.currentMes); this.render(); }); next._bound = true; }

        // Responsive grid tweak
        const grid = screen.querySelector('.prop-grid');
        if (grid) grid.style.gridTemplateColumns = window.innerWidth <= 720 ? '1fr' : '1fr 1fr';
    },

    renderPropietarios() {
        const container = document.getElementById('lista-propietarios');
        const info = document.getElementById('coeficientes-info');
        const info2 = document.getElementById('departamentos-info');
        const subtitle = document.getElementById('departamentos-subtitle');
        const propietariosRaw = this.getPropietariosOrdenados();
        const propietarios = [...propietariosRaw].sort((a, b) => {
            const na = parseInt(String(a.departamento || '').replace(/\D/g, ''), 10);
            const nb = parseInt(String(b.departamento || '').replace(/\D/g, ''), 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return nb - na; // mayor a menor
            return String(b.departamento || '').localeCompare(String(a.departamento || ''), 'es');
        });
        const totalCoef = propietarios.reduce((sum, p) => sum + (Number(p.coeficiente) || 0), 0);
        const totalM2 = propietarios.reduce((sum, p) => sum + (Number(p.m2) || 0), 0);

        if (info) info.innerHTML = '';
        if (subtitle) subtitle.textContent = `${propietarios.length} departamentos · ${totalM2.toFixed(2)} m² totales`;
        if (info2) info2.innerHTML = `El coeficiente se calcula automáticamente según los m² y siempre suma 100%. <strong>Suma actual: ${totalCoef.toFixed(2)}%</strong>`;

        if (!container) return;
        if (propietarios.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos cargados</p>';
            return;
        }

        const iconEdit = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293z"/></svg>';
        const iconTransfer = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6M5.216 14A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/><path d="M13.5 5.5a.5.5 0 0 1 .5.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1V6a.5.5 0 0 1 .5-.5"/></svg>';
        const iconHist = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg>';
        const iconPay = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495l-.2-.05zm1.591 1.872c1.287.323 1.852.859 1.852 1.769 0 1.097-.826 1.828-2.2 1.939V8.73z"/></svg>';
        const iconReceipt = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm-.5 2.5A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5M5 8a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1z"/><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm10-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1"/></svg>';

        let totalCargo = 0;
        const calcMes = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const rows = propietarios.map(p => {
            const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento || '-';
            let cargo = 0, saldo = 0, pagado = 0;
            try {
                const row = calcMes && calcMes.rows ? calcMes.rows.find(r => r.id == p.id) : null;
                if (row) { cargo = row.cargo || 0; saldo = row.saldo || 0; pagado = row.pagado || 0; }
            } catch (e) { cargo = 0; saldo = 0; pagado = 0; }
            totalCargo += cargo;
            const alDia = saldo <= 0.01;
            const estadoHtml = alDia
                ? '<span class="badge badge-pagado">Al día</span>'
                : `<span class="badge badge-pendiente">Pendiente ${Calculos.formatMoney(Math.max(0,saldo))}</span>`;
            const payBtn = alDia
                ? `<button class="btn-depto-pago" data-id="${p.id}" title="Ver último comprobante (al día)" aria-label="Ver último comprobante">${iconReceipt}</button>`
                : `<button class="btn-depto-pago primary" data-id="${p.id}" title="Registrar pago / Abono" aria-label="Registrar pago o abono">${iconPay}</button>`;
            return `
                <tr data-id="${p.id}">
                    <td><strong>${p.departamento || '-'}</strong></td>
                    <td>${fullName}</td>
                    <td class="num">${(Number(p.m2) || 0).toFixed(2)}</td>
                    <td class="num">${(Number(p.coeficiente) || 0).toFixed(2)}%</td>
                    <td class="num-left">${Calculos.formatMoney(cargo)}</td>
                    <td>${estadoHtml}</td>
                    <td>
                        <div class="deptos-actions">
                            <button class="btn-depto-editar" data-id="${p.id}" title="Editar datos (m² protegido por defecto)" aria-label="Editar datos">${iconEdit}</button>
                            <button class="btn-depto-transferir" data-id="${p.id}" title="Transferir titularidad (mantiene historial y metraje)" aria-label="Transferir titularidad">${iconTransfer}</button>
                            <button class="btn-depto-historial" data-id="${p.id}" title="Estado de cuenta / Historial" aria-label="Estado de cuenta e historial">${iconHist}</button>
                            ${payBtn}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Depto</th><th>Propietario</th><th class="num">m²</th><th class="num">Coeficiente</th><th class="num-left">Total a pagar (S/)</th><th>Estado (mes)</th><th>Acciones</th></tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr><td colspan="2">Total</td><td class="num">${totalM2.toFixed(2)}</td><td class="num">${totalCoef.toFixed(2)}%</td><td class="num-left">${Calculos.formatMoney(totalCargo)}</td><td colspan="2"></td></tr></tfoot>
                </table>
            </div>
        `;

        container.querySelectorAll('.btn-depto-editar').forEach(btn => btn.addEventListener('click', () => {
            const p = DB.getPropietario(parseInt(btn.dataset.id)); if (p) this.openPropietarioModal(p);
        }));
        container.querySelectorAll('.btn-depto-transferir').forEach(btn => btn.addEventListener('click', () => {
            const p = DB.getPropietario(parseInt(btn.dataset.id)); if (p) this.openTransferirTitularidadModal(p);
        }));
        container.querySelectorAll('.btn-depto-historial').forEach(btn => btn.addEventListener('click', () => {
            this.openEstadoCuentaModal(parseInt(btn.dataset.id));
        }));
        container.querySelectorAll('.btn-depto-pago').forEach(btn => btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            const p = DB.getPropietario(id);
            if (!p) return;
            let saldo = 0;
            try {
                const ec = Calculos.calcEstadoCuenta(id);
                const fila = ec && ec.filas ? ec.filas.find(f => f.mes === this.currentMes) : null;
                saldo = fila ? (fila.saldo || 0) : 0;
            } catch (e) {}
            if (saldo <= 0.01) {
                const pagos = (DB.getPagos(this.currentMes) || []).filter(pg => pg.propietarioId === id);
                if (pagos.length) {
                    // Abrir último pago/comprobante del mes
                    const ultimo = pagos[pagos.length - 1];
                    this.openPagoModal(id, 'fija', ultimo);
                    return;
                }
            }
            this.openPagoModal(id, 'fija');
        }));
    },

    bindGastosNuevo() {
        const tabR = document.getElementById('gastos-tab-recurrentes');
        const tabD = document.getElementById('gastos-tab-delmes');
        const tabC = document.getElementById('gastos-tab-consumos');
        const pR = document.getElementById('panel-recurrentes');
        const pD = document.getElementById('panel-delmes');
        const pC = document.getElementById('panel-consumos');
        const activate = (which) => {
            const map = [['recurrentes', tabR, pR], ['delmes', tabD, pD], ['consumos', tabC, pC]];
            map.forEach(([k,t,p]) => {
                if (!t || !p) return;
                const on = k === which;
                t.classList.toggle('active', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
                p.classList.toggle('active', on);
                p.style.display = on ? 'block' : 'none';
            });
        };
        if (tabR && pR) {
            tabR.onclick = () => activate('recurrentes');
            if (tabD) tabD.onclick = () => activate('delmes');
            if (tabC) tabC.onclick = () => activate('consumos');
        }
        const btnNom = document.getElementById('btn-add-nomina');
        if (btnNom) btnNom.onclick = () => this.openPersonalModal && this.openPersonalModal();
        const btnServ = document.getElementById('btn-add-servicio-rec');
        if (btnServ) btnServ.onclick = () => this.openPersonalModal && this.openPersonalModal();
        const btnJard = document.getElementById('btn-add-jardineria-rec');
        if (btnJard) btnJard.onclick = () => this.openJardineriaModal && this.openJardineriaModal();
        const form = document.getElementById('form-gasto-mes');
        if (form && !form._bound) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const concepto = (document.getElementById('gm-concepto')?.value || '').trim();
                const monto = parseFloat(document.getElementById('gm-monto')?.value);
                const categoria = document.getElementById('gm-categoria')?.value || 'otros';
                const estado = document.getElementById('gm-estado')?.value || 'pendiente';
                if (!concepto || isNaN(monto) || monto <= 0) { this.toast('Completa concepto y monto', 'error'); return; }
                const fecha = new Date().toISOString().split('T')[0];
                DB.saveGasto({ concepto, monto, fecha, categoria, frecuencia: 'unico', division: 'proporcional', pagado: estado === 'pagado', notas: '' });
                form.reset();
                this.toast('Gasto del mes agregado', 'success');
                this.render();
            });
            form._bound = true;
        }
        const prev = document.getElementById('btn-prev-month-gastos');
        const next = document.getElementById('btn-next-month-gastos');
        if (prev && !prev._bound) { prev.addEventListener('click', () => this.changeMonth(-1)); prev._bound = true; }
        if (next && !next._bound) { next.addEventListener('click', () => this.changeMonth(1)); next._bound = true; }
    },

    _chip(label, kind) {
        const k = kind ? ` gasto-chip-${kind}` : '';
        const txt = this.esc ? this.esc(label || '') : (label || '');
        return `<span class="gasto-chip${k}">${txt}</span>`;
    },

    _gastoRowHtml(name, chipsHtml, amount, editFn, delFn, id, sub) {
        const nm = this.esc ? this.esc(name || '') : (name || '');
        const sb = this.esc ? this.esc(sub || '') : (sub || '');
        return `
            <div class="gasto-row">
                <div><div class="name">${nm}</div><div class="freq">${sb}</div></div>
                <div class="luz-status" style="text-align:left;line-height:1.8">${chipsHtml || ''}</div>
                <div class="amt">${Calculos.formatMoney(amount || 0)}</div>
                <div class="acts">
                    <button class="icon-btn ${editFn}" data-id="${id}" title="Editar" aria-label="Editar">✎</button>
                    <button class="icon-btn ${delFn}" data-id="${id}" title="Eliminar" aria-label="Eliminar">🗑</button>
                </div>
            </div>
        `;
    },

    renderGastosNuevo() {
        const nominaEl = document.getElementById('gastos-nomina');
        const servEl = document.getElementById('gastos-servicios');
        const jardEl = document.getElementById('gastos-jardineria');
        const mesEl = document.getElementById('gastos-delmes');
        if (!nominaEl && !servEl && !jardEl && !mesEl) return;

        // tab switching idempotent
        const tabR = document.getElementById('gastos-tab-recurrentes');
        const tabD = document.getElementById('gastos-tab-delmes');
        const tabC = document.getElementById('gastos-tab-consumos');
        const pR = document.getElementById('panel-recurrentes');
        const pD = document.getElementById('panel-delmes');
        const pC = document.getElementById('panel-consumos');
        if (tabR && pR && !tabR._boundTabs) {
            const activate = (which) => {
                const map = [['recurrentes', tabR, pR], ['delmes', tabD, pD], ['consumos', tabC, pC]];
                map.forEach(([k,t,p]) => { if (!t || !p) return; const on = k === which; t.classList.toggle('active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); p.classList.toggle('active', on); p.style.display = on ? 'block' : 'none'; });
            };
            tabR.addEventListener('click', () => activate('recurrentes'));
            if (tabD) tabD.addEventListener('click', () => activate('delmes'));
            if (tabC) tabC.addEventListener('click', () => activate('consumos'));
            tabR._boundTabs = true;
        }

        const lbl = (Calculos.getMesLabel ? Calculos.getMesLabel(this.currentMes) : this.currentMes);
        const gLbl = document.getElementById('gastos-month-label'); if (gLbl) gLbl.textContent = lbl;
        const fLbl = document.getElementById('gastos-form-mes'); if (fLbl) fLbl.textContent = lbl;
        const imp = document.getElementById('gastos-impacto'); if (imp) imp.innerHTML = `Todo lo que registres impacta el cálculo de <strong>${lbl}</strong>.`;
        const cLbl = document.getElementById('consumos-month-label'); if (cLbl) cLbl.textContent = lbl;

        const personal = (DB.getPersonal ? DB.getPersonal() : []) || [];
        const nomina = personal.filter(p => (p.tipo || 'personal') === 'personal');
        const servicios = personal.filter(p => p.tipo === 'fijo');
        const jardineria = (DB.getJardineria ? DB.getJardineria() : []) || [];
        const gastos = (DB.getGastos ? DB.getGastos(this.currentMes) : []) || [];

        const sumNom = nomina.reduce((a,p)=>a+(parseFloat(p.sueldoMensual)||0),0);
        const sumServ = servicios.reduce((a,p)=>a+(parseFloat(p.monto ?? p.sueldoMensual)||0),0);
        const sumJard = jardineria.reduce((a,j)=>a+(parseFloat(j.montoTotal!=null?j.montoTotal:j.monto)||0),0);
        const sumDel = gastos.reduce((a,g)=>a+(parseFloat(g.monto)||0),0);
        let sumAgua = 0, sumGas = 0, sumLuz = 0;
        try { sumAgua = Calculos.calcAguaTotal ? (Calculos.calcAguaTotal(this.currentMes) || 0) : 0; } catch(e) { sumAgua = 0; }
        try { sumGas = Calculos.calcGasTotal ? (Calculos.calcGasTotal(this.currentMes) || 0) : 0; } catch(e) { sumGas = 0; }
        try {
            const luz = DB.getLuz ? DB.getLuz(this.currentMes) : null;
            const gl = DB.getGastoLuz ? DB.getGastoLuz(this.currentMes) : null;
            sumLuz = parseFloat(luz?.monto != null ? luz.monto : (gl?.monto != null ? gl.monto : 0)) || 0;
        } catch(e) { sumLuz = 0; }
        const sumCons = sumAgua + sumGas + sumLuz;
        const sumRec = sumNom + sumServ + sumJard;
        const sumTotal = sumRec + sumDel + sumCons;

        const setMeta = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setMeta('meta-nomina', `${nomina.length} ítem${nomina.length===1?'':'s'} · ${Calculos.formatMoney(sumNom)}/mes`);
        setMeta('meta-servicios', `${servicios.length} ítem${servicios.length===1?'':'s'} · ${Calculos.formatMoney(sumServ)}/mes`);
        setMeta('meta-jardineria', `${jardineria.length} ítem${jardineria.length===1?'':'s'} · ${Calculos.formatMoney(sumJard)}`);
        setMeta('meta-delmes', `${gastos.length} ítem${gastos.length===1?'':'s'} · ${Calculos.formatMoney(sumDel)}`);

        const resumen = document.getElementById('gastos-resumen');
        if (resumen) {
            resumen.innerHTML = `
                <div class="summary-item"><span class="label">Recurrentes</span><span class="value">${Calculos.formatMoney(sumRec)}</span></div>
                <div class="summary-item"><span class="label">Del mes (puntuales)</span><span class="value">${Calculos.formatMoney(sumDel)}</span></div>
                <div class="summary-item"><span class="label">Consumos</span><span class="value">${Calculos.formatMoney(sumCons)}</span></div>
                <div class="summary-item summary-diff"><span class="label">Total del mes</span><span class="value">${Calculos.formatMoney(sumTotal)}</span></div>
            `;
        }

        if (nominaEl) {
            nominaEl.innerHTML = nomina.length ? nomina.map(p => {
                const rol = (DB.ROLES_PERSONAL && DB.ROLES_PERSONAL[p.rol]) ? DB.ROLES_PERSONAL[p.rol].label : 'Personal';
                const chips = this._chip('Mensual') + ' ' + this._chip('Activo','ok');
                return this._gastoRowHtml(p.nombre || 'Sin nombre', chips, p.sueldoMensual || 0, 'btn-edit-personal-g', 'btn-del-personal-g', p.id, rol);
            }).join('') : '<div class="empty-state">No hay nómina registrada.<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-nomina">+ Agregar nómina</button></div></div>';
            nominaEl.querySelectorAll('.btn-edit-personal-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.openPersonalModal(p); });
            nominaEl.querySelectorAll('.btn-del-personal-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.showConfirm('Eliminar', `¿Eliminar "${p.nombre}"?`, () => { DB.deletePersonal(p.id); this.toast('Eliminado','success'); this.render(); }); });
            const ea = document.getElementById('empty-add-nomina'); if (ea) ea.onclick = () => this.openPersonalModal && this.openPersonalModal();
        }

        if (servEl) {
            servEl.innerHTML = servicios.length ? servicios.map(p => {
                const freq = p.frecuencia === 'trimestral' ? 'Trimestral' : 'Mensual';
                const monto = parseFloat(p.monto ?? p.sueldoMensual) || 0;
                const chips = this._chip(freq) + ' ' + this._chip('Prorrateable');
                return this._gastoRowHtml(p.nombre || 'Sin nombre', chips, monto, 'btn-edit-serv-g', 'btn-del-serv-g', p.id, 'Contrato / servicio');
            }).join('') : '<div class="empty-state">No hay servicios recurrentes.<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-serv">+ Agregar servicio recurrente</button></div></div>';
            servEl.querySelectorAll('.btn-edit-serv-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.openPersonalModal(p); });
            servEl.querySelectorAll('.btn-del-serv-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.showConfirm('Eliminar', `¿Eliminar "${p.nombre}"?`, () => { DB.deletePersonal(p.id); this.toast('Eliminado','success'); this.render(); }); });
            const es = document.getElementById('empty-add-serv'); if (es) es.onclick = () => this.openPersonalModal && this.openPersonalModal();
        }

        if (jardEl) {
            jardEl.innerHTML = jardineria.length ? jardineria.map(j => {
                const freq = (j.frecuencia || 'unico') === 'trimestral' ? 'Trimestral' : ((j.frecuencia || 'unico') === 'mensual' ? 'Mensual' : 'Único');
                const monto = parseFloat(j.montoTotal!=null?j.montoTotal:j.monto) || 0;
                const chips = this._chip(freq);
                return this._gastoRowHtml(j.descripcion || 'Jardinería', chips, monto, 'btn-edit-jard-g', 'btn-del-jard-g', j.id, 'Jardinería');
            }).join('') : '<div class="empty-state">No hay servicios de jardinería registrados.<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-jard">+ Agregar jardinería</button></div></div>';
            jardEl.querySelectorAll('.btn-edit-jard-g').forEach(btn => btn.onclick = () => { const j = DB.getJardineriaId ? DB.getJardineriaId(parseInt(btn.dataset.id)) : null; if (j && this.openJardineriaModal) this.openJardineriaModal(j); });
            jardEl.querySelectorAll('.btn-del-jard-g').forEach(btn => btn.onclick = () => { const j = DB.getJardineriaId ? DB.getJardineriaId(parseInt(btn.dataset.id)) : null; if (j) this.showConfirm('Eliminar', `¿Eliminar "${j.descripcion || 'registro'}"?`, () => { DB.deleteJardineria(j.id); this.toast('Eliminado','success'); this.render(); }); });
            const ej = document.getElementById('empty-add-jard'); if (ej) ej.onclick = () => this.openJardineriaModal && this.openJardineriaModal();
        }

        if (mesEl) {
            mesEl.innerHTML = gastos.length ? gastos.map(g => {
                const estado = g.pagado ? this._chip('Pagado','ok') : this._chip('Pendiente','warn');
                const cat = (Calculos.categoriaLabel ? Calculos.categoriaLabel(g.categoria) : (g.categoria || 'Otros'));
                const chips = this._chip('Único') + ' ' + this._chip(cat) + ' ' + estado;
                const sub = g.fecha ? `Registrado el ${g.fecha}` : '';
                return this._gastoRowHtml(g.concepto || 'Gasto', chips, g.monto || 0, 'btn-edit-gasto-g', 'btn-del-gasto-g', g.id, sub);
            }).join('') : '<div class="empty-state">No hay gastos puntuales en este mes. Usá el formulario para registrar uno.</div>';
            mesEl.querySelectorAll('.btn-edit-gasto-g').forEach(btn => btn.onclick = () => { const g = (DB.getGastos ? DB.getGastos() : []).find(x => x.id == btn.dataset.id); if (g && this.openGastoModal) this.openGastoModal(g); });
            mesEl.querySelectorAll('.btn-del-gasto-g').forEach(btn => btn.onclick = () => { const g = (DB.getGastos ? DB.getGastos() : []).find(x => x.id == btn.dataset.id); if (g) this.showConfirm('Eliminar', `¿Eliminar "${g.concepto}"?`, () => { DB.deleteGasto(g.id); this.toast('Eliminado','success'); this.render(); }); });
        }
    },

    renderGastos() {
        if (document.getElementById('panel-recurrentes') || document.getElementById('panel-delmes')) {
            this.renderGastosNuevo && this.renderGastosNuevo();
            return;
        }
        const container = document.getElementById('lista-gastos');
        const totalesEl = document.getElementById('gastos-totales');
        const categoriaEl = document.getElementById('filter-categoria');
        const frecuenciaEl = document.getElementById('filter-frecuencia');
        if (!container) return;
        const categoria = categoriaEl ? categoriaEl.value : '';
        const frecuencia = frecuenciaEl ? frecuenciaEl.value : '';
        let gastos = DB.getGastos({ mes: this.currentMes });

        if (categoria) gastos = gastos.filter(g => g.categoria === categoria);
        if (frecuencia) gastos = gastos.filter(g => g.frecuencia === frecuencia);

        if (gastos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay gastos registrados este mes</p>';
            if (totalesEl) totalesEl.style.display = 'none';
            return;
        }

        const totalMonto = gastos.reduce((sum, g) => sum + g.monto, 0);
        const pagados = gastos.filter(g => g.pagado);
        const pendientes = gastos.filter(g => !g.pagado);
        const totalPagados = pagados.reduce((sum, g) => sum + g.monto, 0);
        const totalPendientes = pendientes.reduce((sum, g) => sum + g.monto, 0);

        const _gtm=document.getElementById('gastos-total-monto'); if(_gtm) _gtm.textContent = Calculos.formatMoney(totalMonto);
        document.getElementById('gastos-pagados-monto').textContent = Calculos.formatMoney(totalPagados);
        document.getElementById('gastos-pendientes-monto').textContent = Calculos.formatMoney(totalPendientes);
        if (totalesEl) totalesEl.style.display = 'flex';

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
                            ${g.pagado ? '<span class="badge badge-pagado"> Pagado</span>' : '<span class="badge badge-pendiente"> Por pagar</span>'}
                            · ${g.fecha}
                            ${showEquiv ? '<br>Mensual equiv: ' + Calculos.formatMoney(equiv) : ''}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="list-item-amount">${Calculos.formatMoney(g.monto)}</span>
                        <div class="list-item-actions">
                            <button class="btn-toggle-pagado btn-icon" data-id="${g.id}" title="${g.pagado ? 'Marcar por pagar' : 'Marcar pagado'}">${g.pagado ? '' : ''}</button>
                            <button class="btn-edit-gasto" data-id="${g.id}" title="Editar">️</button>
                            <button class="btn-delete-gasto" data-id="${g.id}" title="Eliminar"></button>
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


    _renderPeriodoConsumo(tipo) {
        const map = {
            agua: { el: 'agua-periodo', get: () => DB.getAguaFechas ? DB.getAguaFechas(this.currentMes) : {inicio:'',fin:''}, save: (i,f) => DB.saveAguaFechas && DB.saveAguaFechas(this.currentMes,i,f), stateKey: 'agua' },
            gas:  { el: 'gas-periodo',  get: () => DB.getGasFechas  ? DB.getGasFechas(this.currentMes)  : {inicio:'',fin:''}, save: (i,f) => DB.saveGasFechas  && DB.saveGasFechas(this.currentMes,i,f),  stateKey: 'gas'  },
            luz:  { el: 'luz-periodo',  get: () => DB.getLuzFechas  ? DB.getLuzFechas(this.currentMes)  : {inicio:'',fin:''}, save: (i,f) => DB.saveLuzFechas  && DB.saveLuzFechas(this.currentMes,i,f),  stateKey: 'luz'  }
        };
        const cfg = map[tipo]; if (!cfg) return;
        const el = document.getElementById(cfg.el); if (!el) return;
        this._periodoState = this._periodoState || {};
        const fechas = cfg.get() || {inicio:'',fin:''};
        const st = this._periodoState[cfg.stateKey] || {};
        const [iniY, iniM, iniD] = (fechas.inicio || '---').split('-');
        const [finY, finM, finD] = (fechas.fin || '---').split('-');
        const iniDisp = st.dIni !== undefined ? st.dIni : iniD;
        const iniMDisp = st.mIni !== undefined ? st.mIni : iniM;
        const finDisp = st.dFin !== undefined ? st.dFin : finD;
        const finMDisp = st.mFin !== undefined ? st.mFin : finM;
        const ro = Auth.canWrite() ? '' : ' disabled';
        const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const dayOptions = (cls, val) => {
            let o = '<option value="">—</option>';
            for (let i=1;i<=31;i++){ const v=String(i).padStart(2,'0'); o += `<option value="${v}"${v===val?' selected':''}>${i}</option>`; }
            return `<select class="${cls}" data-tipo="${tipo}"${ro}>${o}</select>`;
        };
        const monthOptions = (cls, val) => {
            let o = '<option value="">—</option>';
            monthNames.forEach((n,i)=>{ const v=String(i+1).padStart(2,'0'); o += `<option value="${v}"${v===val?' selected':''}>${n}</option>`; });
            return `<select class="${cls}" data-tipo="${tipo}"${ro}>${o}</select>`;
        };
        el.innerHTML = `
            <div class="consumo-periodo">
                <span class="consumo-periodo-title">Período de lectura</span>
                <span class="luz-status">Desde:</span>
                ${dayOptions('periodo-dini', iniDisp)}
                ${monthOptions('periodo-mini', iniMDisp)}
                <span class="consumo-periodo-sep">→</span>
                <span class="luz-status">Hasta:</span>
                ${dayOptions('periodo-dfin', finDisp)}
                ${monthOptions('periodo-mfin', finMDisp)}
            </div>`;
        el.querySelectorAll('select').forEach(sel => {
            sel.onchange = () => {
                const year = this.currentMes.split('-')[0];
                const q = (c)=> (el.querySelector(c) || {}).value || '';
                const dIni=q('.periodo-dini'), mIni=q('.periodo-mini'), dFin=q('.periodo-dfin'), mFin=q('.periodo-mfin');
                this._periodoState[cfg.stateKey] = { dIni, mIni, dFin, mFin };
                // keep legacy gas state in sync
                if (tipo === 'gas') this._gasPeriodo = { dIni, mIni, dFin, mFin };
                let inicio = (fechas.inicio || '');
                let fin = (fechas.fin || '');
                if (dIni && mIni) inicio = `${year}-${mIni}-${dIni}`; else if (!dIni && !mIni) inicio = '';
                if (dFin && mFin) fin = `${year}-${mFin}-${dFin}`; else if (!dFin && !mFin) fin = '';
                cfg.save(inicio, fin);
                this.render();
            };
        });
    },

    renderGas() {
        this._renderPeriodoConsumo('gas');
        const container = document.getElementById('gas-lista');
        const resumenEl = document.getElementById('gas-resumen');
        if (!container) return;
        const propietarios = this.getPropietariosOrdenados();
        const gasData = DB.getGas(this.currentMes) || {};
        const params = DB.getGasParams ? DB.getGasParams() : { precioBalon:245, kgBalon:45, kgM3:2.464, nBalones:3 };
        const fechas = DB.getGasFechas ? DB.getGasFechas(this.currentMes) : { inicio:'', fin:'' };
        const ro = Auth.canWrite() ? '' : ' disabled';
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        setVal('gas-precio-balon', params.precioBalon);
        setVal('gas-kg-balon', params.kgBalon);
        setVal('gas-kg-m3', params.kgM3);
        setVal('gas-n-balones', params.nBalones);
        const bal = document.getElementById('gas-balones-total');
        if (bal) bal.textContent = `Total balones del mes: ${Calculos.formatMoney((params.nBalones || 3) * (params.precioBalon || 0))}`;

        let totalConsumo = 0;
        let totalMonto = 0;
        const rows = propietarios.map(p => {
            const d = gasData[p.departamento] || {};
            const lecturaIni = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : '';
            const lecturaFin = (d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaFin !== '') ? Number(d.lecturaFin) : '';
            const resultado = Calculos.calcGasDepto ? Calculos.calcGasDepto(this.currentMes, p.departamento) : null;
            const consumo = resultado ? (resultado.consumo || 0) : (lecturaIni !== '' && lecturaFin !== '' ? Math.max(0, Number(lecturaFin) - Number(lecturaIni)) : 0);
            const monto = resultado ? (resultado.total || 0) : 0;
            if (resultado) { totalConsumo += consumo; totalMonto += monto; }
            else if (consumo) { totalConsumo += consumo; }
            const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || '-';
            return `
                <tr>
                    <td><strong>${p.departamento || '-'}</strong></td>
                    <td>${nombre}</td>
                    <td class="num">${lecturaIni === '' ? '—' : Number(lecturaIni).toFixed(3)}</td>
                    <td class="num"><input type="number" class="gas-fin-input" data-dept="${p.departamento}" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.001"${ro} style="width:110px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right"></td>
                    <td class="num">${consumo ? Number(consumo).toFixed(3) : '—'}</td>
                    <td class="num-left">${monto ? Calculos.formatMoney(monto) : '—'}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Depto</th><th>Propietario</th><th class="num">Lect. anterior (m³)</th><th class="num">Lect. actual (m³)</th><th class="num">Consumo (m³)</th><th class="num-left">Monto S/</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6"><p class="empty-state">Sin departamentos</p></td></tr>'}</tbody>
                </table>
            </div>
        `;

        if (resumenEl) {
            const tarifa = (totalConsumo > 0 && totalMonto > 0) ? Calculos.formatMoney(totalMonto / totalConsumo) : '—';
            resumenEl.innerHTML = `
                <div class="kpi-card"><div class="kpi-label">Consumo total</div><div class="kpi-value">${totalConsumo ? totalConsumo.toFixed(3) + ' m³' : '—'}</div></div>
                <div class="kpi-card"><div class="kpi-label">Total gas del mes</div><div class="kpi-value">${totalMonto ? Calculos.formatMoney(totalMonto) : '—'}</div></div>
                <div class="kpi-card"><div class="kpi-label">Costo por m³</div><div class="kpi-value">${tarifa}</div></div>
            `;
        }

        container.querySelectorAll('.gas-fin-input').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const d = (DB.getGas(this.currentMes) || {})[dept] || {};
                const ini = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : 0;
                const fin = input.value === '' ? 0 : parseFloat(input.value) || 0;
                DB.saveGas(this.currentMes, dept, ini, fin);
                this.render();
            });
        });

        ['gas-precio-balon', 'gas-kg-balon', 'gas-kg-m3', 'gas-n-balones'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.onchange = () => {
                if (DB.saveGasParams) DB.saveGasParams({
                    precioBalon: parseFloat(document.getElementById('gas-precio-balon').value) || 245,
                    kgBalon: parseFloat(document.getElementById('gas-kg-balon').value) || 45,
                    kgM3: parseFloat(document.getElementById('gas-kg-m3').value) || 2.464,
                    nBalones: parseFloat(document.getElementById('gas-n-balones').value) || 3
                });
                this.render();
            };
        });
    },

    renderConsumos() {
        const tabA = document.getElementById('consumos-tab-agua');
        const tabG = document.getElementById('consumos-tab-gas');
        const tabL = document.getElementById('consumos-tab-luz');
        const pA = document.getElementById('panel-consumos-agua');
        const pG = document.getElementById('panel-consumos-gas');
        const pL = document.getElementById('panel-consumos-luz');
        if (tabA && tabG && tabL && pA && pG && pL && !tabA._bound) {
            const activate = (which) => {
                const map = { agua: [tabA,pA], gas: [tabG,pG], luz: [tabL,pL] };
                Object.entries(map).forEach(([k,[t,p]]) => {
                    const on = k === which;
                    t.classList.toggle('active', on);
                    t.setAttribute('aria-selected', on ? 'true' : 'false');
                    p.classList.toggle('active', on);
                    p.style.display = on ? 'block' : 'none';
                });
            };
            tabA.addEventListener('click', () => activate('agua'));
            tabG.addEventListener('click', () => activate('gas'));
            tabL.addEventListener('click', () => activate('luz'));
            tabA._bound = true;
        }
    },

    renderAgua() {
        this._renderPeriodoConsumo('agua');
        const container = document.getElementById('agua-lista');
        if (!container) return;
        const propietarios = this.getPropietariosOrdenados();
        const aguaData = DB.getAgua(this.currentMes) || {};
        const factura = DB.getFacturaAgua ? DB.getFacturaAgua(this.currentMes) : null;
        const ro = Auth.canWrite() ? '' : ' disabled';
        let totalConsumo = 0;
        let totalMonto = 0;

        const rows = propietarios.map(p => {
            const d = aguaData[p.departamento] || {};
            const lecturaIni = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : '';
            const lecturaFin = (d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaFin !== '') ? Number(d.lecturaFin) : '';
            const resultado = Calculos.calcAguaDepto ? Calculos.calcAguaDepto(this.currentMes, p.departamento) : null;
            const consumo = resultado ? (resultado.consumo || 0) : (lecturaIni !== '' && lecturaFin !== '' ? Math.max(0, Number(lecturaFin) - Number(lecturaIni)) : 0);
            const monto = resultado ? (resultado.total || 0) : 0;
            if (resultado) { totalConsumo += consumo; totalMonto += monto; }
            else if (consumo) { totalConsumo += consumo; }
            const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || '-';
            return `
                <tr>
                    <td><strong>${p.departamento || '-'}</strong></td>
                    <td>${nombre}</td>
                    <td class="num">${lecturaIni === '' ? '—' : Number(lecturaIni).toFixed(1)}</td>
                    <td class="num"><input type="number" class="agua-fin-input" data-dept="${p.departamento}" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.1"${ro} style="width:110px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right"></td>
                    <td class="num">${consumo ? Number(consumo).toFixed(1) : '—'}</td>
                    <td class="num-left">${monto ? Calculos.formatMoney(monto) : (factura ? Calculos.formatMoney(0) : '—')}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Depto</th><th>Propietario</th><th class="num">Lect. anterior (m³)</th><th class="num">Lect. actual (m³)</th><th class="num">Consumo</th><th class="num-left">Monto S/</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6"><p class="empty-state">Sin departamentos</p></td></tr>'}</tbody>
                </table>
            </div>
        `;

        const resumen = document.getElementById('agua-resumen');
        if (resumen) {
            let tarifa = '—';
            if (factura && totalConsumo > 0) {
                const t = (factura.montoTotal || factura.total || totalMonto) / totalConsumo;
                if (isFinite(t)) tarifa = Calculos.formatMoney(t);
            } else if (totalConsumo > 0 && totalMonto > 0) {
                tarifa = Calculos.formatMoney(totalMonto / totalConsumo);
            }
            const facturaMonto = factura ? Calculos.formatMoney(factura.montoTotal || factura.total || totalMonto) : 'Sin factura';
            resumen.innerHTML = `
                <div class="kpi-card"><div class="kpi-label">Consumo total</div><div class="kpi-value">${totalConsumo ? totalConsumo.toFixed(1) : '—'}</div></div>
                <div class="kpi-card"><div class="kpi-label">Factura del mes</div><div class="kpi-value">${facturaMonto}</div></div>
                <div class="kpi-card"><div class="kpi-label">Tarifa por m³</div><div class="kpi-value">${tarifa}</div></div>
            `;
        }

        container.querySelectorAll('.agua-fin-input').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const d = (DB.getAgua(this.currentMes) || {})[dept] || {};
                const ini = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : 0;
                const fin = input.value === '' ? 0 : parseFloat(input.value) || 0;
                DB.saveAgua(this.currentMes, dept, ini, fin);
                this.render();
            });
        });
    },
    renderLuzCard() {
        this._renderPeriodoConsumo('luz');
        const container = document.getElementById('luz-lista');
        const resumenEl = document.getElementById('luz-resumen');
        const labelEl = document.getElementById('luz-mes-label');
        if (labelEl) labelEl.textContent = Calculos.getMesLabel ? Calculos.getMesLabel(this.currentMes) : this.currentMes;
        if (!container) return;
        const area = 'Áreas comunes';
        const luzData = (DB.getLuz ? DB.getLuz(this.currentMes) : {}) || {};
        const d = luzData[area] || {};
        const g = DB.getGastoLuz ? DB.getGastoLuz(this.currentMes) : null;
        const ro = Auth.canWrite() ? '' : ' disabled';
        const lecturaIni = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : '';
        const lecturaFin = (d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaFin !== '') ? Number(d.lecturaFin) : '';
        const consumo = (lecturaIni !== '' && lecturaFin !== '') ? Math.max(0, Number(lecturaFin) - Number(lecturaIni)) : 0;
        const monto = g ? (parseFloat(g.monto) || 0) : 0;
        const pagado = !!(g && g.pagado);
        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Depto</th><th>Área</th><th class="num">Lect. anterior (kWh)</th><th class="num">Lect. actual (kWh)</th><th class="num">Consumo (kWh)</th><th class="num-left">Monto S/</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><strong>A.C.</strong></td>
                            <td>${area}</td>
                            <td class="num">${lecturaIni === '' ? '—' : Number(lecturaIni).toFixed(1)}</td>
                            <td class="num"><input type="number" class="luz-fin-input" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.1"${ro} style="width:110px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right"></td>
                            <td class="num">${consumo ? Number(consumo).toFixed(1) : '—'}</td>
                            <td class="num-left"><input type="number" class="luz-monto-input" value="${monto ? monto : ''}" step="0.01" min="0" placeholder="0.00"${ro} style="width:110px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right"></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">
                <label for="luz-estado-input" style="font-size:13px;color:var(--md-sys-color-on-surface-variant);">Estado del recibo:</label>
                <select id="luz-estado-input" class="luz-estado-input"${ro} style="padding:6px 10px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);">
                    <option value="pendiente"${!pagado ? ' selected' : ''}>Pendiente</option>
                    <option value="pagado"${pagado ? ' selected' : ''}>Pagado</option>
                </select>
                <span class="luz-status">${g ? (pagado ? 'Registrado como pagado' : 'Registrado como pendiente') : 'Sin registrar este mes'}</span>
            </div>
        `;
        if (resumenEl) {
            const tarifa = (consumo > 0 && monto > 0) ? Calculos.formatMoney(monto / consumo) : '—';
            resumenEl.innerHTML = `
                <div class="kpi-card"><div class="kpi-label">Consumo total</div><div class="kpi-value">${consumo ? Number(consumo).toFixed(1) + ' kWh' : '—'}</div></div>
                <div class="kpi-card"><div class="kpi-label">Monto del mes</div><div class="kpi-value">${monto ? Calculos.formatMoney(monto) : '—'}</div></div>
                <div class="kpi-card"><div class="kpi-label">Tarifa por kWh</div><div class="kpi-value">${tarifa}</div></div>
            `;
        }
        const finInput = container.querySelector('.luz-fin-input');
        const montoInput = container.querySelector('.luz-monto-input');
        const estadoInput = container.querySelector('.luz-estado-input');
        const saveLuzAll = () => {
            const ini = lecturaIni === '' ? 0 : Number(lecturaIni);
            const finRaw = finInput ? finInput.value : '';
            const fin = finRaw !== '' ? (parseFloat(finRaw) || 0) : 0;
            const m = montoInput ? (parseFloat(montoInput.value) || 0) : 0;
            if (ini < 0 || fin < 0 || m < 0) { this.toast('Las lecturas y el monto deben ser mayores o iguales a 0', 'error'); this.render(); return; }
            if (lecturaIni !== '' && finRaw !== '' && fin < ini) { this.toast('La lectura actual de luz no puede ser menor que la anterior', 'error'); this.render(); return; }
            if (DB.saveLuz) DB.saveLuz(this.currentMes, area, ini, fin);
            const est = estadoInput ? estadoInput.value : 'pendiente';
            if (DB.saveGastoLuz) DB.saveGastoLuz(this.currentMes, m, est === 'pagado');
            this.render();
        };
        if (finInput) finInput.addEventListener('change', saveLuzAll);
        if (montoInput) montoInput.addEventListener('change', saveLuzAll);
        if (estadoInput) estadoInput.addEventListener('change', saveLuzAll);
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
                            <button class="btn-edit-personal" data-id="${p.id}" title="Editar">️</button>
                            <button class="btn-delete-personal" data-id="${p.id}" title="Eliminar"></button>
                        </div>
                    </div>
                `;
            }
            const rol = DB.ROLES_PERSONAL[p.rol] || DB.ROLES_PERSONAL.otros;
            return `
                <div class="list-item" data-id="${p.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${rol.categoria === 'porteria' ? '' : ''}${rol.categoria === 'descansero' ? '' : ''}${rol.categoria === 'mantenimiento' ? '' : ''}${rol.categoria === 'jardineria' ? '' : ''}${rol.categoria === 'administracion' ? '' : ''} ${p.nombre} <span class="badge badge-freq">${rol.label}</span></div>
                        <div class="list-item-subtitle">
                            Sueldo: <strong>${p.sueldoMensual ? Calculos.formatMoney(p.sueldoMensual) : '—'}</strong>
                            ${p.horario ? ' · Horario: ' + p.horario : ''}
                            ${p.dias ? ' · Días: ' + p.dias : ''}
                            ${p.vacaciones ? '<br> Vacaciones: ' + p.vacaciones : ''}
                            ${p.notas ? '<br>' + p.notas : ''}
                        </div>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn-edit-personal" data-id="${p.id}" title="Editar">️</button>
                        <button class="btn-delete-personal" data-id="${p.id}" title="Eliminar"></button>
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
                ? '<span class="badge badge-pagado"> Realizado</span>'
                : '<span class="badge badge-pendiente"> A realizar</span>';
            return `
                <div class="list-item" data-id="${j.id}">
                    <div class="list-item-info">
                        <div class="list-item-title"> ${j.descripcion}</div>
                        <div class="list-item-subtitle">
                            ${badge} · ${j.fecha || ''}
                            ${j.notas ? '<br>' + j.notas : ''}
                        </div>
                    </div>
                    <div class="list-item-actions">
                        <button class="btn-edit-jardineria" data-id="${j.id}" title="Editar">️</button>
                        <button class="btn-delete-jardineria" data-id="${j.id}" title="Eliminar"></button>
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
        const mes = this.currentMes;
        const calc = Calculos.calcMes ? Calculos.calcMes(mes) : { rows: [], totals: { comunes:0, consumosInd:0, consumosMes:0, cargo:0, pagado:0, pendiente:0, alDia:0, departamentos:0, m2:0, coef:0 } };
        const { rows, totals } = calc;

        const resumenEl = document.getElementById('calculo-resumen');
        if (resumenEl) {
            resumenEl.innerHTML = `
                <div class="summary-item"><span class="label">Gastos comunes a distribuir</span><span class="value">${Calculos.formatMoney(totals.comunes)}</span><span class="luz-status">Gastos del mes (incl. luz) prorrateados</span></div>
                <div class="summary-item"><span class="label">Consumos del mes</span><span class="value">${Calculos.formatMoney(totals.consumosMes)}</span><span class="luz-status">Agua, gas y luz (medidos/recibos)</span></div>
                <div class="summary-item"><span class="label">Total a cobrar</span><span class="value">${Calculos.formatMoney(totals.cargo)}</span><span class="luz-status">${totals.departamentos} departamento${totals.departamentos===1?'':'s'}</span></div>
                <div class="summary-item emph"><span class="label">Recaudado / Pendiente</span><span class="value">${Calculos.formatMoney(totals.pagado)}</span><span class="luz-status">Pendiente: ${Calculos.formatMoney(totals.pendiente)} · ${totals.alDia} de ${totals.departamentos} al día</span></div>
            `;
        }

        const prorrateoEl = document.getElementById('calculo-prorrateo');
        if (prorrateoEl) {
            if (rows.length === 0) {
                prorrateoEl.innerHTML = '<p class="empty-state" style="padding:16px;">No hay departamentos cargados</p>';
            } else {
                prorrateoEl.innerHTML = `
                    <div style="padding:14px 16px;border-bottom:1px solid var(--md-sys-color-outline-variant);background:var(--md-sys-color-surface-container-low);">
                        <h3 style="font-size:15px;font-weight:700;margin:0;">1. Detalle de prorrateo por departamento</h3>
                        <p class="luz-status" style="margin:2px 0 0;">Distribución según coeficiente (m²). Los montos cuadran con el total del mes.</p>
                    </div>
                    <div style="padding:14px 16px;">
                        <div class="luz-status" style="background:var(--md-sys-color-surface-container-low);border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
                            <strong>Cómo se calcula:</strong> Gastos del mes prorrateados por coeficiente (incluye luz como gasto común) + consumos individuales de agua y gas = total a pagar. Los coeficientes suman 100%.
                        </div>
                        <div class="deptos-table-wrap">
                        <table class="deptos-table calc-table">
                            <thead>
                                <tr>
                                    <th>Depto</th>
                                    <th>m²</th>
                                    <th>Coeficiente</th>
                                    <th class="num-left">Gastos comunes</th>
                                    <th class="num-left">Consumos (agua/gas)</th>
                                    <th class="num-left">Total a pagar</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => `
                                    <tr>
                                        <td><strong>${r.depto}</strong></td>
                                        <td>${r.m2.toFixed(2)}</td>
                                        <td>${r.coef.toFixed(2)}%</td>
                                        <td class="num-left">${Calculos.formatMoney(r.comunes)}</td>
                                        <td class="num-left">${Calculos.formatMoney(r.consumos)}</td>
                                        <td class="num-left"><strong>${Calculos.formatMoney(r.cargo)}</strong></td>
                                        <td><span class="badge-status ${r.estadoClass}">${r.estado}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td><strong>Total</strong></td>
                                    <td><strong>${(totals.m2||0).toFixed(2)}</strong></td>
                                    <td><strong>${(totals.coef||0).toFixed(2)}%</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.comunes)}</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.consumosInd)}</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.cargo)}</strong></td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                    </div>
                `;
            }
        }

        // Estado de cobros
        const matrizEl = document.getElementById('calculo-matriz-pagos');
        if (matrizEl) {
            matrizEl.innerHTML = `
                <div class="deptos-table-wrap" style="margin:0">
                <table class="deptos-table matrix-table">
                    <thead>
                        <tr>
                            <th>Depto</th>
                            <th class="num-left">Total</th>
                            <th class="num-left">Pagado</th>
                            <th class="num-left">Saldo</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            const label = r.saldo <= 0.01 ? 'Ver comprobante' : 'Registrar abono';
                            return `
                                <tr>
                                    <td><strong>${r.depto}</strong></td>
                                    <td class="num-left">${Calculos.formatMoney(r.cargo)}</td>
                                    <td class="num-left">${Calculos.formatMoney(r.pagado)}</td>
                                    <td class="num-left">${Calculos.formatMoney(Math.max(0,r.saldo))}</td>
                                    <td><span class="badge-status ${r.estadoClass}">${r.estado}</span></td>
                                    <td style="text-align:right"><button class="btn btn-sm btn-outline btn-calc-abono" data-id="${r.id}">${label}</button></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                </div>
            `;
            matrizEl.querySelectorAll('.btn-calc-abono').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.openPagoModal(parseInt(btn.dataset.id), 'fija');
                });
            });
        }

        const simpl = document.getElementById('simplificacion');
        if (simpl) simpl.style.display = 'none';
    },

    openTransferirTitularidadModal(propietario) {
        if (!propietario) return;
        const fullName = [propietario.nombre, propietario.apellido].filter(Boolean).join(' ') || propietario.departamento || '';
        const title = document.getElementById('modal-transferir-title');
        const info = document.getElementById('transferir-info');
        const idEl = document.getElementById('transferir-propietario-id');
        const nombre = document.getElementById('transferir-nombre');
        const apellido = document.getElementById('transferir-apellido');
        const email = document.getElementById('transferir-email');
        const ocup = document.getElementById('transferir-ocupacion');
        const nota = document.getElementById('transferir-nota');
        if (!idEl || !nombre) return;
        if (title) title.textContent = `Transferir titularidad — Depto ${propietario.departamento || ''}`;
        if (info) info.textContent = `Titular actual: ${fullName}. Se conservará el departamento, su metraje (${Number(propietario.m2||0).toFixed(2)} m²) y todo el historial financiero.`;
        idEl.value = propietario.id;
        nombre.value = '';
        apellido.value = '';
        if (email) email.value = '';
        if (ocup) ocup.value = propietario.ocupacion || 'propietario';
        if (nota) nota.value = '';
        const modal = document.getElementById('modal-transferir');
        if (modal) modal.style.display = 'flex';
    },

    generarBoletas() {
        this.showConfirm(
            'Generar boletas',
            `¿Generar las boletas/resumen de cobro de ${Calculos.getMesLabel(this.currentMes)} para todos los departamentos? (No se envían automáticamente)`,
            () => {
                this.closeAllModals();
                this.toast('Boletas preparadas para el mes seleccionado. Revisa el cálculo e informes para compartirlas.', 'success');
            }
        );
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
            fijoLabel.textContent = ` Gas de ${Calculos.getMesLabel(mes)}`;
        }

        select.innerHTML = '';
        if (!esFijo) {
            const addOpt = (value, label) => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify(value);
                opt.textContent = label;
                select.appendChild(opt);
            };
            addOpt({ tipo: 'fija', gastoId: null }, ` Cuota fija de ${Calculos.getMesLabel(mes)}`);
            const extras = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            if (extras.length > 0) addOpt({ tipo: 'extraordinaria', gastoId: null }, ` Cuota extra de ${Calculos.getMesLabel(mes)}`);
            const aguaR = Calculos.calcAguaDepto(mes, propietario.departamento);
            if (aguaR) addOpt({ tipo: 'agua', gastoId: null }, ` Agua de ${Calculos.getMesLabel(mes)}`);

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
            try {
                const row = Calculos.calcCargoPropietarioMes ? Calculos.calcCargoPropietarioMes(mes, propietario.id) : null;
                if (row && row.cargo > 0) monto = String(Number(row.cargo.toFixed(2)));
            } catch(e) {}
            if (!monto && propietario.cuotaMensual > 0) monto = String(propietario.cuotaMensual);
        } else if (tipo === 'agua') {
            const aguaR = Calculos.calcAguaDepto(mes, propietario.departamento);
            if (aguaR) monto = String(aguaR.total);
        } else if (tipo === 'gas') {
            const gasR = Calculos.calcGasDepto(mes, propietario.departamento);
            if (gasR) monto = String(gasR.total);
        } else if (tipo === 'extraordinaria') {
            const extras = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            if (extras.length > 0) {
                const propietarios = this.getPropietariosOrdenados();
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
        // Prevención de sobrepagos (modelo unificado)
        let pendiente = 0;
        try {
            const row = Calculos.calcCargoPropietarioMes ? Calculos.calcCargoPropietarioMes(mes, propietarioId) : null;
            if (row) pendiente = Math.max(0, Number(row.saldo) || 0);
            else {
                const ec = Calculos.calcEstadoCuenta(propietarioId);
                const filaMes = ec ? ec.filas.find(f => f.mes === mes) : null;
                pendiente = filaMes ? Math.max(0, filaMes.saldo) : 0;
            }
        } catch(e) {}
        if (pendiente > 0) {
            const sobrepago = Calculator.verificarSobrepago(monto, pendiente);
            if (sobrepago.sobrepago) {
                const ok = confirm(`El monto (S/ ${monto.toFixed(2)}) supera la cuota pendiente (S/ ${pendiente.toFixed(2)}) por S/ ${sobrepago.excedente.toFixed(2)}.\n\n¿Desea registrar el pago de todas formas?`);
                if (!ok) return;
            }
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
        if (!container) return;
        const mes = this.currentMes;
        const mesLabel = Calculos.getMesLabel(mes);
        const gastos = DB.getGastos({ mes }) || [];
        const calc = Calculos.calcMes ? Calculos.calcMes(mes) : { rows: [], totals: { cargo:0, pagado:0, pendiente:0, gastosMes:0, comunes:0 } };
        const { rows, totals } = calc;

        let totalCuotas = totals.cargo || 0, totalCobrado = totals.pagado || 0, totalPendiente = totals.pendiente || 0;
        const filasDeptos = rows.map(r => {
            const nombre = [r.nombre, r.apellido].filter(Boolean).join(' ') || r.depto || '-';
            const saldo = Math.max(0, r.saldo || 0);
            const alDia = saldo <= 0.01;
            return `<tr>
                <td>${r.depto || '-'}</td>
                <td>${nombre}</td>
                <td style="text-align:left;font-variant-numeric:tabular-nums">${Calculos.formatMoney(r.cargo || 0)}</td>
                <td style="text-align:left;font-variant-numeric:tabular-nums">${Calculos.formatMoney(r.pagado || 0)}</td>
                <td style="text-align:left;font-variant-numeric:tabular-nums">${Calculos.formatMoney(saldo)}</td>
                <td>${alDia ? '<span class="badge badge-pagado">Al día</span>' : '<span class="badge badge-pendiente">Pendiente</span>'}</td>
            </tr>`;
        }).join('');

        const totalGastos = (totals.gastosMes != null ? totals.gastosMes : (typeof Calculos.calcTotalGastosMes === 'function' ? Calculos.calcTotalGastosMes(mes) : gastos.reduce((s,g)=>s+(Number(g.monto)||0),0)));
        const hayPendiente = totalPendiente > 0.01;

        // Detalle de gastos
        const detalleRows = gastos.map(g => {
            const tipo = g.frecuencia === 'extraordinario' ? 'Extraordinario' : (g.origen === 'sueldo' || g.origen === 'fijo' ? 'Fijo' : 'Variable');
            const cat = (Calculos.categoriaLabel ? Calculos.categoriaLabel(g.categoria) : (g.categoria || '')) || '';
            return `<tr>
                <td>${g.concepto || ''}</td>
                <td>${tipo}</td>
                <td>${cat}</td>
                <td style="text-align:left;font-variant-numeric:tabular-nums">${Calculos.formatMoney(Number(g.monto)||0)}</td>
            </tr>`;
        }).join('');

        // Agregar agua/gas/luz como líneas si existen y no están ya como gastos
        const extraDetalle = [];
        try {
            const agua = (typeof Calculos.calcAguaTotal === 'function') ? Calculos.calcAguaTotal(mes) : 0;
            if (agua > 0 && !gastos.some(g => (g.categoria||'').toLowerCase()==='agua')) extraDetalle.push({concepto:'Agua (consumo)', tipo:'Variable · Consumo', cat:'Servicios básicos', monto:agua});
        } catch(e){}
        try {
            const gas = (typeof Calculos.calcGasTotal === 'function') ? Calculos.calcGasTotal(mes) : 0;
            if (gas > 0 && !gastos.some(g => (g.categoria||'').toLowerCase()==='gas')) extraDetalle.push({concepto:'Gas', tipo:'Variable · Consumo', cat:'Servicios básicos', monto:gas});
        } catch(e){}
        try {
            const luz = (DB.getGastoLuz ? DB.getGastoLuz(mes) : null);
            if (luz && luz.monto) extraDetalle.push({concepto:'Luz (áreas comunes)', tipo:'Variable · Servicio', cat:'Servicios básicos', monto:Number(luz.monto)||0});
        } catch(e){}
        const extraRows = extraDetalle.map(d => `<tr><td>${d.concepto}</td><td>${d.tipo}</td><td>${d.cat}</td><td style="text-align:left;font-variant-numeric:tabular-nums">${Calculos.formatMoney(d.monto)}</td></tr>`).join('');

        container.innerHTML = `
            <div class="informe-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
                <div class="kpi-card"><div class="kpi-label">Total gastos</div><div class="kpi-value">${Calculos.formatMoney(totalGastos)}</div></div>
                <div class="kpi-card"><div class="kpi-label">Total a cobrar</div><div class="kpi-value">${Calculos.formatMoney(totalCuotas)}</div></div>
                <div class="kpi-card"><div class="kpi-label">Recaudado</div><div class="kpi-value">${Calculos.formatMoney(totalCobrado)}</div></div>
                <div class="kpi-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;${hayPendiente?'border-color:rgba(210,153,34,.35);':''}">
                    <div><div class="kpi-label">Pendiente</div><div class="kpi-value">${Calculos.formatMoney(totalPendiente)}</div></div>
                    <span title="${hayPendiente?'Hay saldo pendiente':'Al día'}" aria-label="${hayPendiente?'Pendiente':'Al día'}" style="width:14px;height:14px;border-radius:50%;flex:0 0 14px;background:${hayPendiente?'#d29922':'#1a7f37'};box-shadow:0 0 0 2px #fff inset,0 0 8px ${hayPendiente?'rgba(210,153,34,.5)':'rgba(26,127,55,.4)'}"></span>
                </div>
            </div>

            <div class="card" style="margin-bottom:16px">
                <div style="padding:14px 16px;border-bottom:1px solid var(--md-sys-color-outline-variant);display:flex;justify-content:space-between;align-items:center;background:var(--md-sys-color-surface-container-low)">
                    <strong>Resumen por departamento</strong><span style="color:var(--md-sys-color-on-surface-variant);font-size:13px">Estado de pago — ${mesLabel}</span>
                </div>
                <div style="padding:16px;overflow:auto">
                    <table class="deptos-table">
                        <thead><tr><th>Depto</th><th>Propietario</th><th style="text-align:left">Total a pagar</th><th style="text-align:left">Pagado</th><th style="text-align:left">Saldo</th><th>Estado</th></tr></thead>
                        <tbody>${filasDeptos || '<tr><td colspan="6"><p class="empty-state">Sin departamentos</p></td></tr>'}</tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <div style="padding:14px 16px;border-bottom:1px solid var(--md-sys-color-outline-variant);display:flex;justify-content:space-between;align-items:center;background:var(--md-sys-color-surface-container-low)">
                    <strong>Detalle de gastos — ${mesLabel}</strong>
                </div>
                <div style="padding:16px;overflow:auto">
                    <table class="deptos-table">
                        <thead><tr><th>Concepto</th><th>Tipo</th><th>Categoría</th><th style="text-align:left">Monto</th></tr></thead>
                        <tbody>${(detalleRows + extraRows) || '<tr><td colspan="4"><p class="empty-state">Sin gastos registrados este mes</p></td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

};

document.addEventListener('DOMContentLoaded', () => App.init());
