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

        document.getElementById('btn-logout').addEventListener('click', () => this.confirmLogout());

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
        document.getElementById('btn-logout-pendiente').addEventListener('click', () => this.confirmLogout());
        document.getElementById('btn-logout-acceso').addEventListener('click', () => this.confirmLogout());
        document.getElementById('btn-logout-menu').addEventListener('click', () => this.confirmLogout());

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
            this.toast('No se pudo aceptar la invitación. Revisa tu conexión e inténtalo de nuevo.', 'error');
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
            this.toast('No se pudo enviar la solicitud de acceso: ' + (error.message || 'ocurrió un error') + '. Revisa los datos o tu conexión e inténtalo de nuevo.', 'error');
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
            this.mostrarError(this._errorPostgres(error, 'No se pudo crear el edificio. Revisa los datos o la conexión e inténtalo de nuevo.'));
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
        if (msg.includes('Invalid login credentials')) return 'No se pudo ingresar: el correo o la contraseña no son correctos. Verifica tus datos e inténtalo de nuevo.';
        if (msg.includes('Email not confirmed')) return 'No se pudo ingresar: tu correo aún no está confirmado. Revisa tu bandeja (y spam) y confirma tu cuenta, luego vuelve a intentar.';
        if (msg.includes('Too many requests') || msg.includes('rate limit')) return 'No se pudo ingresar: hubo demasiados intentos. Espera unos minutos y vuelve a intentar.';
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) return 'No se pudo ingresar por un problema de conexión. Revisa tu internet e inténtalo de nuevo.';
        return msg ? ('No se pudo completar la acción: ' + msg + '. Inténtalo de nuevo.') : 'No se pudo completar la acción. Inténtalo de nuevo.';
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

    confirmLogout() {
        this.showConfirm('Cerrar sesión', '¿Deseas cerrar tu sesión en esta cuenta?', async () => {
            await this.logout();
        });
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
            ['btn-prev-month-consumos', -1], ['btn-next-month-consumos', 1],
            ['btn-prev-month-prop', -1], ['btn-next-month-prop', 1],
            ['btn-prev-month-gastos', -1], ['btn-next-month-gastos', 1]
        ];
        handlers.forEach(([id, delta]) => {
            const el = document.getElementById(id);
            if (!el || el._boundMonth) return;
            el.addEventListener('click', () => this.changeMonth(delta));
            el._boundMonth = true;
        });
        // Encabezado de periodo unificado (todas las pantallas)
        document.querySelectorAll('[data-periodo-header] .js-periodo-prev, [data-periodo-header] .js-periodo-next').forEach(el => {
            if (el._boundMonth) return;
            const delta = parseInt(el.dataset.periodoNav || '0', 10) || (el.classList.contains('js-periodo-prev') ? -1 : 1);
            el.addEventListener('click', () => this.changeMonth(delta));
            el._boundMonth = true;
        });
    },

    changeMonth(delta) {
        this.currentMes = Calculos.shiftMes(this.currentMes, delta);
        this._gasPeriodo = null;
        DB.saveMesActual(this.currentMes);
        this.render();
    },

    // === Modals ===
    bindModals() {
        // Delegación robusta para botones de historial (dashboard, dptos, etc.)
        if (!document._boundHistorialDelegation) {
            document.addEventListener('click', (e) => {
                const h = e.target.closest('.btn-historial-depto, .btn-depto-historial, .btn-estado-cuenta');
                if (!h) return;
                const id = parseInt(h.dataset.id, 10);
                if (id) {
                    e.preventDefault();
                    this.openHistorialDeptoModal(id);
                }
            });
            document._boundHistorialDelegation = true;
        }

        document.querySelectorAll('.modal-cancel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                if (!modal) return;
                if (modal.id === 'modal-estado-cuenta' || modal.id === 'modal-pago' || modal.id === 'modal-confirm' || modal.id === 'modal-comprobante') {
                    modal.style.display = 'none';
                    this._restoreModalFocus();
                    return;
                }
                this.confirmarCierreModal(modal);
            });
        });
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                if (modal && (modal.id === 'modal-estado-cuenta' || modal.id === 'modal-pago' || modal.id === 'modal-confirm' || modal.id === 'modal-comprobante')) {
                    modal.style.display = 'none';
                    this._restoreModalFocus();
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

        const btnLuzFormula = document.getElementById('btn-luz-formula');
        if (btnLuzFormula) btnLuzFormula.addEventListener('click', () => {
            this.openFacturaLuzModal();
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

        const compCerrar = document.getElementById('btn-comprobante-cerrar');
        if (compCerrar) compCerrar.addEventListener('click', () => {
            const m = document.getElementById('modal-comprobante');
            if (m) m.style.display = 'none';
            this._restoreModalFocus();
        });
        const compEditar = document.getElementById('btn-comprobante-editar');
        if (compEditar) compEditar.addEventListener('click', () => {
            const info = this._comprobanteActual;
            const m = document.getElementById('modal-comprobante');
            if (m) m.style.display = 'none';
            if (!info || !info.pagoId) return;
            const pago = (DB.getPagos(info.mes || this.currentMes) || []).find(p => p.id == info.pagoId) || (DB._load().pagos || []).find(p => p.id == info.pagoId);
            if (pago) this.openPagoModal(info.propietarioId, pago.tipo || 'fija', pago);
            else this.toast('No se pudo abrir el pago para editar.', 'error');
        });
    },

    _saveModalFocus() {
        const ae = document.activeElement;
        if (ae && ae !== document.body) this._modalReturnFocus = ae;
    },
    _restoreModalFocus() {
        const el = this._modalReturnFocus;
        this._modalReturnFocus = null;
        try { if (el && typeof el.focus === 'function') el.focus(); } catch(e) {}
    },
    closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        this._restoreModalFocus();
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
        const ocupEl = document.getElementById('propietario-ocupacion');
        const residentesEl = document.getElementById('propietario-residentes');
        const m2 = parseFloat(document.getElementById('propietario-m2').value) || 0;
        const propietario = {
            nombre: document.getElementById('propietario-nombre').value.trim(),
            apellido: document.getElementById('propietario-apellido').value.trim(),
            departamento: document.getElementById('propietario-departamento').value.trim(),
            m2,
            coeficiente: 0,
            cuotaMensual: 0,
            email: document.getElementById('propietario-email').value.trim(),
            ocupacion: ocupEl ? ocupEl.value : 'propietario',
            residentes: residentesEl ? Math.max(0, parseInt(residentesEl.value, 10) || 0) : 1
        };
        if (id) propietario.id = parseInt(id);
        const otrosM2 = (DB.getPropietarios() || []).filter(p => p.id !== (id ? parseInt(id) : -1)).reduce((s, p) => s + (Number(p.m2) || 0), 0);
        const total = otrosM2 + m2;
        propietario.coeficiente = total > 0 ? (m2 / total) * 100 : 0;
        return propietario;
    },

    // Validación de departamento duplicado (nuevo o edición)
    _validarDepartamentoPropietario() {
        const input = document.getElementById('propietario-departamento');
        const id = document.getElementById('propietario-id').value;
        const valor = input ? String(input.value || '').trim() : '';
        const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
        if (!valor) {
            this._mostrarErrorDepartamento('Ingresa el número/código del departamento.');
            return false;
        }
        const duplicado = (DB.getPropietarios() || []).some(p =>
            String(p.id) !== String(id || '') && norm(p.departamento) === norm(valor)
        );
        if (duplicado) {
            this._mostrarErrorDepartamento(`El departamento “${valor}” ya está en uso. Elige otro código.`);
            return false;
        }
        this._limpiarErrorDepartamento();
        return true;
    },

    _mostrarErrorDepartamento(msg) {
        const input = document.getElementById('propietario-departamento');
        const errEl = document.getElementById('propietario-departamento-error');
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        if (input) input.setAttribute('aria-invalid', 'true');
    },

    _limpiarErrorDepartamento() {
        const input = document.getElementById('propietario-departamento');
        const errEl = document.getElementById('propietario-departamento-error');
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        if (input) input.removeAttribute('aria-invalid');
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
        const modoInput = document.getElementById('personal-modo');
        const esServicio = modoInput ? modoInput.value === 'servicio' : false;
        const notas = (document.getElementById('personal-notas').value || '').trim();
        let personal;
        if (esServicio) {
            const anioEl = document.getElementById('fijo-mes-desde-anio');
            const mesEl = document.getElementById('fijo-mes-desde-mes');
            const mesDesde = (anioEl && mesEl) ? `${anioEl.value}-${mesEl.value}` : (this.currentMes || Calculos.getCurrentMes());
            personal = {
                tipo: 'fijo',
                nombre: (document.getElementById('servicio-concepto').value || '').trim(),
                categoria: document.getElementById('fijo-categoria').value,
                monto: parseFloat(document.getElementById('fijo-monto').value) || 0,
                frecuencia: document.getElementById('fijo-frecuencia').value,
                mesDesde,
                notas
            };
        } else {
            personal = {
                tipo: 'personal',
                nombre: (document.getElementById('personal-nombre').value || '').trim(),
                rol: document.getElementById('personal-rol').value,
                sueldoMensual: parseFloat(document.getElementById('personal-sueldo').value) || 0,
                mesDesde: this.currentMes || (Calculos.getCurrentMes ? Calculos.getCurrentMes() : ''),
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

    _leerFormLuz() {
        const energia = parseFloat(document.getElementById('luz-energia').value) || 0;
        const alumbradoPublico = parseFloat(document.getElementById('luz-alumbrado').value) || 0;
        const cargoFijo = parseFloat(document.getElementById('luz-cargo-fijo').value) || 0;
        const igvPct = parseFloat(document.getElementById('luz-igv').value) || 0;
        const igv = parseFloat(document.getElementById('luz-igv-monto').value) || 0;
        return {
            consumo: parseFloat(document.getElementById('luz-consumo').value) || 0,
            energia,
            alumbradoPublico,
            cargoFijo,
            igv,
            igvPct
        };
    },

    openPropietarioModal(propietario = null) {
        const title = document.getElementById('modal-propietario-title');
        const form = document.getElementById('form-propietario');
        const m2Input = document.getElementById('propietario-m2');
        const m2UnlockWrap = document.getElementById('propietario-m2-unlock-wrap');
        const m2Unlock = document.getElementById('propietario-m2-unlock');
        const m2Lock = document.getElementById('propietario-m2-lock');
        const ocup = document.getElementById('propietario-ocupacion');
        const residentes = document.getElementById('propietario-residentes');

        if (propietario) {
            title.textContent = 'Editar datos del departamento';
            document.getElementById('propietario-id').value = propietario.id;
            document.getElementById('propietario-nombre').value = propietario.nombre || '';
            document.getElementById('propietario-apellido').value = propietario.apellido || '';
            document.getElementById('propietario-departamento').value = propietario.departamento || '';
            this._limpiarErrorDepartamento();
            if (m2Input) { m2Input.value = propietario.m2 || ''; m2Input.readOnly = true; m2Input.disabled = true; }
            if (m2UnlockWrap) m2UnlockWrap.style.display = 'block';
            if (m2Unlock) {
                m2Unlock.checked = false;
                m2Unlock.onchange = () => {
                    if (!m2Input) return;
                    if (m2Unlock.checked) {
                        const ok = confirm('Editar el área (m²) afecta el coeficiente y el prorrateo de todo el edificio (1040.98 m²). ¿Deseas continuar?');
                        if (!ok) { m2Unlock.checked = false; m2Input.readOnly = true; m2Input.disabled = true; return; }
                        m2Input.disabled = false; m2Input.readOnly = false; m2Input.focus();
                    } else {
                        m2Input.readOnly = true; m2Input.disabled = true;
                    }
                };
            }
            if (m2Lock) m2Lock.textContent = '(protegida por defecto)';
            if (ocup) ocup.value = propietario.ocupacion || 'propietario';
            if (residentes) residentes.value = (propietario.residentes != null ? propietario.residentes : 1);
            this._actualizarCoeficientePropietario();
            document.getElementById('propietario-email').value = propietario.email || '';
        } else {
            title.textContent = 'Nuevo departamento';
            form.reset();
            document.getElementById('propietario-id').value = '';
            if (m2Input) { m2Input.disabled = false; m2Input.readOnly = false; }
            if (m2UnlockWrap) m2UnlockWrap.style.display = 'none';
            if (m2Unlock) m2Unlock.checked = false;
            if (m2Lock) m2Lock.textContent = '';
            if (ocup) ocup.value = 'propietario';
            if (residentes) residentes.value = 1;
            this._actualizarCoeficientePropietario();
            this._limpiarErrorDepartamento();
        }

        this._saveModalFocus();
        document.getElementById('modal-propietario').style.display = 'flex';
        const mp = document.getElementById('modal-propietario'); if (mp) { const f = mp.querySelector('input:not([disabled]):not([type="hidden"]), select, textarea, button'); if (f) try{f.focus();}catch(e){} }
    },

    openEstadoCuentaModal(propietarioId) {
        const ec = Calculos.calcEstadoCuenta(propietarioId);
        if (!ec) {
            this.toast('No se encontró el departamento', 'error');
            return;
        }
        const p = ec.propietario;
        const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || p.departamento || '—';
        const depto = p.departamento || '—';
        const cfg = (DB.getConfig ? DB.getConfig() : {}) || {};
        const edificio = cfg.nombre || 'Edificio';
        const emision = new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'long', year:'numeric' });
        const total = Number(ec.totalAcumulado || 0);
        const totalClase = total > 0.01 ? 'pendiente' : (total < -0.01 ? 'favor' : 'aldia');
        const totalLabel = total > 0.01 ? 'Saldo pendiente' : (total < -0.01 ? 'Saldo a favor' : 'Al día');
        const cuerpo = document.getElementById('estado-cuenta-cuerpo');
        if (cuerpo) {
            if (!ec.filas || ec.filas.length === 0) {
                cuerpo.innerHTML = `
                    <div class="ec-statement">
                        <div class="ec-header">
                            <div class="ec-brand"><div class="kicker">${edificio}</div><h2 id="estado-cuenta-title">Estado de cuenta</h2><p class="sub">Depto. ${depto} · ${fullName}</p></div>
                            <div class="ec-meta"><span class="comprobante-badge neutral">Sin movimientos</span><div class="comprobante-ref">Emisión: ${emision}</div></div>
                        </div>
                        <div class="ec-section"><p class="empty-state" style="padding:24px 0;">Sin movimientos registrados para este departamento. Cuando haya cargos o pagos del periodo, aparecerán aquí.</p></div>
                    </div>`;
            } else {
                const filas = ec.filas.map(f => `
                    <tr>
                        <td><strong>${Calculos.getMesLabel(f.mes)}</strong></td>
                        <td class="num-left">${Calculos.formatMoney(f.cuotaFija || 0)}</td>
                        <td class="num-left">${(f.extraordinarias||0) > 0.005 ? Calculos.formatMoney(f.extraordinarias) : '—'}</td>
                        <td class="num-left">${(f.gas||0) > 0.005 ? Calculos.formatMoney(f.gas) : '—'}</td>
                        <td class="num-left">${(f.agua||0) > 0.005 ? Calculos.formatMoney(f.agua) : '—'}</td>
                        <td class="num-left"><strong>${Calculos.formatMoney(f.cargo || 0)}</strong></td>
                        <td class="num-left">${Calculos.formatMoney(f.pagado || 0)}</td>
                        <td class="num-left ${(f.saldo||0) > 0.01 ? 'ec-debe' : 'ec-al-dia'}">${Calculos.formatMoney(f.saldo || 0)}</td>
                        <td class="num-left ${(f.acumulado||0) > 0.01 ? 'ec-debe' : (f.acumulado||0) < -0.01 ? 'ec-favor' : 'ec-al-dia'}">${Calculos.formatMoney(f.acumulado || 0)}</td>
                    </tr>`).join('');
                cuerpo.innerHTML = `
                    <div class="ec-statement">
                        <div class="ec-header">
                            <div class="ec-brand">
                                <div class="kicker">${edificio}</div>
                                <h2 id="estado-cuenta-title">Estado de cuenta</h2>
                                <p class="sub">Depto. ${depto} · ${fullName}</p>
                            </div>
                            <div class="ec-meta">
                                <span class="comprobante-badge ${totalClase==='pendiente'?'warn':(totalClase==='favor'?'neutral':'ok')}">${totalLabel}</span>
                                <div class="comprobante-ref">Saldo acumulado: <strong>${Calculos.formatMoney(total)}</strong></div>
                                <div class="comprobante-ref">Emisión: ${emision}</div>
                            </div>
                        </div>
                        <div class="ec-summary-bar">
                            <div class="ec-sum-item"><span class="label">Departamento</span><span class="val">${depto}</span></div>
                            <div class="ec-sum-item"><span class="label">Titular</span><span class="val">${fullName}</span></div>
                            <div class="ec-sum-item"><span class="label">Coeficiente</span><span class="val">${Number(p.coeficiente||0).toFixed(2)}%</span></div>
                            <div class="ec-sum-item"><span class="label">Área</span><span class="val">${Number(p.m2||0).toFixed(2)} m²</span></div>
                        </div>
                        <div class="ec-section">
                            <div class="ec-table-wrap deptos-table-wrap">
                                <table class="deptos-table ec-table" style="width:100%;">
                                    <thead>
                                        <tr><th>Periodo</th><th class="num-left">Comunes</th><th class="num-left">Extra.</th><th class="num-left">Gas</th><th class="num-left">Agua</th><th class="num-left">Cargo</th><th class="num-left">Pagado</th><th class="num-left">Saldo</th><th class="num-left">Acumulado</th></tr>
                                    </thead>
                                    <tbody>${filas}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="ec-footer-note ${totalClase}">
                            <div><strong>Saldo acumulado:</strong> ${Calculos.formatMoney(total)}</div>
                            <div class="luz-status" style="margin-top:4px;">Detalle por periodo: gastos comunes prorrateados por coeficiente, consumos (agua/gas/luz) y cuotas extraordinarias cuando aplican. El acumulado refleja el arrastre de saldos entre periodos.</div>
                        </div>
                    </div>`;
            }
        }

        this._estadoCuentaId = propietarioId;
        this._estadoCuentaMode = "estado";
        this._saveModalFocus();
        const modal = document.getElementById('modal-estado-cuenta');
        if (modal) {
            modal.style.display = 'flex';
            const f = modal.querySelector('button, [href], input, select, textarea');
            if (f) try{f.focus();}catch(e){}
        }
    },


    openHistorialDeptoModal(propietarioId) {
        const ec = Calculos.calcEstadoCuenta(propietarioId);
        if (!ec) { this.toast('No se encontró el departamento', 'error'); return; }
        const p = ec.propietario || DB.getPropietario(propietarioId) || {};
        const titular = [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || p.departamento || '—';
        const coef = Number(p.coeficiente || 0).toFixed(2) + '%';
        const cfg = (DB.getConfig ? DB.getConfig() : {}) || {};
        const edificio = cfg.nombre || 'Edificio';
        const hoy = new Date();
        const filas = (ec.filas || []).slice().sort((a,b)=>String(b.mes).localeCompare(String(a.mes)));
        const rows = filas.length ? filas.map(f => {
            const [y,m] = String(f.mes || '').split('-').map(Number);
            const fechaRef = (y && m) ? new Date(y, m, 0) : null; // fin del periodo
            const fechaRefTxt = fechaRef ? fechaRef.toLocaleDateString('es-PE') : '—';
            const mesPagoTxt = (Calculos.getMesLabel ? Calculos.getMesLabel(f.mes) : f.mes) || '—';
            let mora = '0';
            if ((f.saldo || 0) > 0.01 && fechaRef) {
                const diff = Math.floor((hoy - fechaRef) / 86400000);
                mora = diff > 0 ? String(diff) : '0';
            } else if ((f.saldo || 0) > 0.01) {
                mora = '—';
            }
            const pagosPeriodo = ((DB.getPagos ? DB.getPagos(f.mes) : []) || []).filter(pg => pg.propietarioId == propietarioId);
            let fechaHtml = '<span class="luz-status">—</span>';
            let pagoHtml = Calculos.formatMoney(Number(f.pagado || 0));
            if (pagosPeriodo.length > 0) {
                const pagosOrden = [...pagosPeriodo].sort((a,b) => `${a.fecha||''} ${a.hora||''}`.localeCompare(`${b.fecha||''} ${b.hora||''}`));
                const fmtFechaPago = (pg) => {
                    if (!pg.fecha) return '—';
                    try {
                        const d = new Date(pg.fecha + 'T' + (pg.hora || '00:00') + ':00');
                        const fd = d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const fh = pg.hora ? String(pg.hora).slice(0,5) : '';
                        return fh ? `${fd} ${fh}` : fd;
                    } catch(e) { return (Calculos.formatFecha ? Calculos.formatFecha(pg.fecha) : pg.fecha) + (pg.hora ? ` ${String(pg.hora).slice(0,5)}` : ''); }
                };
                fechaHtml = `<div style="display:flex;flex-direction:column;gap:2px;">${pagosOrden.map(pg => `<span>${fmtFechaPago(pg)}</span>`).join('')}</div>`;
                pagoHtml = `<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-start;">${pagosOrden.map(pg => `<span>${Calculos.formatMoney(Number(pg.monto || 0))}</span>`).join('')}</div>`;
            } else if (Number(f.pagado || 0) > 0.01) {
                fechaHtml = `<span class="luz-status">No registrada</span>`;
            }
            return `<tr>
                <td>${fechaHtml}</td>
                <td>${this.esc ? this.esc(mesPagoTxt) : mesPagoTxt}</td>
                <td>${this.esc ? this.esc(titular) : titular}</td>
                <td>${coef}</td>
                <td class="num-left">${Calculos.formatMoney(Number(f.cargo || 0))}</td>
                <td class="num-left">${pagoHtml}</td>
                <td class="num-left">${Calculos.formatMoney(Number(f.acumulado || 0))}</td>
                <td>${mora}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="8"><p class="empty-state" style="padding:16px 0;">Sin movimientos registrados para este departamento.</p></td></tr>`;

        const cuerpo = document.getElementById('estado-cuenta-cuerpo');
        if (cuerpo) {
            cuerpo.innerHTML = `
                <div class="ec-statement">
                    <div class="ec-header">
                        <div class="ec-brand">
                            <div class="kicker">${this.esc ? this.esc(edificio) : edificio}</div>
                            <h2 id="estado-cuenta-title">Historial del departamento</h2>
                            <p class="sub">Dpto. ${this.esc ? this.esc(p.departamento || '—') : (p.departamento || '—')} · ${this.esc ? this.esc(titular) : titular}</p>
                        </div>
                        <div class="ec-meta">
                            <span class="comprobante-badge neutral">Historial</span>
                            <div class="comprobante-ref">Coeficiente actual: <strong>${coef}</strong></div>
                        </div>
                    </div>
                    <div class="ec-section">
                        <div class="deptos-table-wrap">
                            <table class="deptos-table" style="width:100%;">
                                <thead><tr><th>Fecha</th><th>Mes</th><th>Propietario</th><th>Coeficiente</th><th class="num-left">Cuota del mes</th><th class="num-left">Pago realizado</th><th class="num-left">Saldo acumulado</th><th>Mora (días)</th></tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        <p class="luz-status" style="margin-top:8px;">“Fecha” corresponde al día y hora en que se registró cada pago. “Mes” indica el mes/periodo de pago al que corresponde. La mora se calcula en días sobre saldos pendientes (referencia: fin del periodo).</p>
                    </div>
                </div>`;
        }
        this._estadoCuentaId = propietarioId;
        this._historialDeptoId = propietarioId;
        this._estadoCuentaMode = 'historial';
        if (this._saveModalFocus) this._saveModalFocus();
        const modal = document.getElementById('modal-estado-cuenta');
        if (modal) {
            modal.style.display = 'flex';
            const f = modal.querySelector('button, [href], input, select, textarea');
            if (f) try { f.focus(); } catch(e) {}
        }
    },

    exportHistorialDeptoPdf(propietarioId) {
        if (typeof window.jspdf === 'undefined') { this.toast('Librería PDF no disponible', 'error'); return; }
        const ec = Calculos.calcEstadoCuenta(propietarioId);
        if (!ec) return;
        const p = ec.propietario || DB.getPropietario(propietarioId) || {};
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const cfg = (DB.getConfig ? DB.getConfig() : {}) || {};
        const titular = [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || p.departamento || '—';
        const coef = Number(p.coeficiente || 0).toFixed(2) + '%';
        const hoy = new Date();
        let y = 42, margin = 40, pageW = doc.internal.pageSize.getWidth();
        doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(31,35,40);
        doc.text(cfg.nombre || 'Edificio', margin, y); y += 18;
        doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(87,96,106);
        doc.text(`Historial del departamento · Dpto ${p.departamento || '-'} ${titular}`, margin, y); y += 14;
        doc.text(`Coeficiente actual: ${coef}`, margin, y); y += 14;
        doc.setDrawColor(208,215,222); doc.line(margin,y,pageW-margin,y); y += 14;
        const filas = (ec.filas || []).slice().sort((a,b)=>String(b.mes).localeCompare(String(a.mes)));
        const body = filas.map(f => {
            const [yy,mm] = String(f.mes || '').split('-').map(Number);
            const fechaRef = (yy && mm) ? new Date(yy, mm, 0) : null;
            const fechaRefTxt = fechaRef ? fechaRef.toLocaleDateString('es-PE') : '—';
            const mesPagoTxt = (Calculos.getMesLabel ? Calculos.getMesLabel(f.mes) : f.mes) || '—';
            let mora = '0';
            if ((f.saldo || 0) > 0.01 && fechaRef) {
                const diff = Math.floor((hoy - fechaRef) / 86400000);
                mora = diff > 0 ? String(diff) : '0';
            } else if ((f.saldo || 0) > 0.01) {
                mora = '—';
            }
            const pagosPeriodo = ((DB.getPagos ? DB.getPagos(f.mes) : []) || []).filter(pg => pg.propietarioId == propietarioId);
            let fechaTxt = '—';
            let pagoTxt = Calculos.formatMoney(Number(f.pagado || 0));
            if (pagosPeriodo.length > 0) {
                const pagosOrden = [...pagosPeriodo].sort((a,b) => `${a.fecha||''} ${a.hora||''}`.localeCompare(`${b.fecha||''} ${b.hora||''}`));
                const fmt = (pg) => {
                    if (!pg.fecha) return '—';
                    try {
                        const d = new Date(pg.fecha + 'T' + (pg.hora || '00:00') + ':00');
                        const fd = d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const fh = pg.hora ? String(pg.hora).slice(0,5) : '';
                        return fh ? `${fd} ${fh}` : fd;
                    } catch(e) { return (Calculos.formatFecha ? Calculos.formatFecha(pg.fecha) : pg.fecha) + (pg.hora ? ` ${String(pg.hora).slice(0,5)}` : ''); }
                };
                fechaTxt = pagosOrden.map(fmt).join('\n');
                pagoTxt = pagosOrden.map(pg => Calculos.formatMoney(Number(pg.monto || 0))).join('\n');
            } else if (Number(f.pagado || 0) > 0.01) {
                fechaTxt = 'No registrada';
            }
            return [fechaTxt, mesPagoTxt, titular, coef, Calculos.formatMoney(Number(f.cargo||0)), pagoTxt, Calculos.formatMoney(Number(f.acumulado||0)), mora];
        });
        if (typeof doc.autoTable === 'function') {
            doc.autoTable({
                startY: y,
                head: [['Fecha', 'Mes', 'Propietario', 'Coeficiente', 'Cuota del mes', 'Pago realizado', 'Saldo acumulado', 'Mora (días)']],
                body: body.length ? body : [['—','—','—','—','—','—','Sin movimientos','—']],
                theme: 'plain',
                styles: { font: 'helvetica', fontSize: 8.5, textColor: [31,35,40], cellPadding: 5, lineColor:[234,238,242], lineWidth:0.5, valign: 'top' },
                headStyles: { fillColor:[246,248,250], textColor:[87,96,106], fontStyle:'bold' },
                margin: { left: margin, right: margin }
            });
        } else {
            doc.setFontSize(9); body.forEach(r=>{ doc.text(r.join(' | '), margin, y); y+=12; });
        }
        doc.save(`historial-dpto-${String(p.departamento||'').replace(/[^a-zA-Z0-9]+/g,'-')}.pdf`);
        this.toast('PDF descargado', 'success');
    },

    exportEstadoCuentaPdf() {
        if (typeof window.jspdf === 'undefined' || !this._estadoCuentaId) {
            this.toast('Librería PDF no disponible', 'error');
            return;
        }
        if (this._estadoCuentaMode === 'historial') {
            this.exportHistorialDeptoPdf(this._estadoCuentaId);
            return;
        }
        const ec = Calculos.calcEstadoCuenta(this._estadoCuentaId);
        if (!ec) return;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const config = DB.getConfig();
        const p = ec.propietario;
        const fullName = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.departamento;
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 40;
        let y = 42;

        const drawHeader = () => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.setTextColor(31, 35, 40);
            doc.text(config.nombre || 'Edificio', margin, y);
            y += 18;
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(87, 96, 106);
            doc.text(`Estado de cuenta · Dpto ${p.departamento} ${fullName}`, margin, y);
            y += 14;
            doc.setDrawColor(208, 215, 222);
            doc.line(margin, y, pageW - margin, y);
            y += 16;
        };

        drawHeader();

        doc.setFontSize(9);
        doc.setTextColor(87, 96, 106);
        doc.text('Cargo = gastos comunes prorrateados por coeficiente + consumos (agua/gas/luz según periodo).', margin, y);
        y += 14;

        const body = (ec.filas || []).map(f => ([
            Calculos.getMesLabel(f.mes),
            Calculos.formatMoney(f.cuotaFija || 0),
            (f.extraordinarias || 0) > 0.005 ? Calculos.formatMoney(f.extraordinarias) : '—',
            (f.gas || 0) > 0.005 ? Calculos.formatMoney(f.gas) : '—',
            (f.agua || 0) > 0.005 ? Calculos.formatMoney(f.agua) : '—',
            Calculos.formatMoney(f.cargo || 0),
            Calculos.formatMoney(f.pagado || 0),
            Calculos.formatMoney(f.saldo || 0),
            Calculos.formatMoney(f.acumulado || 0),
        ]));

        if (typeof doc.autoTable === 'function') {
            doc.autoTable({
                startY: y,
                head: [['Mes', 'Comunes', 'Extra', 'Gas', 'Agua', 'Cargo', 'Pagado', 'Saldo', 'Acum.']],
                body: body.length ? body : [['Sin movimientos', '—', '—', '—', '—', '—', '—', '—', '—']],
                theme: 'plain',
                styles: { font: 'helvetica', fontSize: 8.5, textColor: [31,35,40], cellPadding: { top: 6, right: 6, bottom: 6, left: 6 }, lineColor: [234,238,242], lineWidth: 0.5 },
                headStyles: { fillColor: [246,248,250], textColor: [87,96,106], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [255,255,255] },
                margin: { left: margin, right: margin },
                columnStyles: { 0: { cellWidth: 78 }, 1: { halign: 'left' }, 2: { halign: 'left' }, 3: { halign: 'left' }, 4: { halign: 'left' }, 5: { halign: 'left' }, 6: { halign: 'left' }, 7: { halign: 'left' }, 8: { halign: 'left' } },
                didParseCell: (data) => {
                    if (data.section === 'body' && body.length) {
                        const fila = ec.filas[data.row.index];
                        if (!fila) return;
                        if (data.column.index === 7 && (fila.saldo || 0) > 0.01) data.cell.styles.textColor = [159, 46, 34];
                        if (data.column.index === 8) {
                            if ((fila.acumulado || 0) > 0.01) data.cell.styles.textColor = [159, 46, 34];
                            else if ((fila.acumulado || 0) < -0.01) data.cell.styles.textColor = [26, 127, 55];
                        }
                    }
                }
            });
            y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 18;
        } else {
            // fallback simple
            doc.setFontSize(9); doc.setTextColor(31,35,40);
            body.forEach(row => { doc.text(row.join('  |  '), margin, y); y += 12; if (y > 760) { doc.addPage(); y = 42; } });
            y += 10;
        }

        if (y > 760) { doc.addPage(); y = 42; }
        const total = ec.totalAcumulado || 0;
        const totalColor = total > 0.01 ? [159,46,34] : (total < -0.01 ? [26,127,55] : [31,35,40]);
        doc.setFillColor(246,248,250);
        doc.setDrawColor(208,215,222);
        doc.roundedRect(margin, y - 4, pageW - margin * 2, 28, 6, 6, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(31,35,40);
        doc.text('Saldo acumulado', margin + 10, y + 13);
        doc.setTextColor(...totalColor);
        doc.text(Calculos.formatMoney(total), pageW - margin - 10, y + 13, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setTextColor(87,96,106); doc.setFontSize(8);

        const footY = doc.internal.pageSize.getHeight() - 24;
        doc.text(`Generado el ${new Date().toLocaleDateString('es-PE')} · ${this.labelPeriodo ? this.labelPeriodo(this.currentMes) : Calculos.getMesLabel(this.currentMes)}`, margin, footY);

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

    openPersonalModal(personal = null, modo = null) {
        const form = document.getElementById('form-personal');
        if (!form) return;
        const esServicio = personal ? personal.tipo === 'fijo' : modo === 'servicio';
        const grupoNomina = document.getElementById('grupo-nomina');
        const grupoServicio = document.getElementById('grupo-servicio');
        const modoInput = document.getElementById('personal-modo');
        if (modoInput) modoInput.value = esServicio ? 'servicio' : 'nomina';
        if (grupoNomina) grupoNomina.style.display = esServicio ? 'none' : 'block';
        if (grupoServicio) grupoServicio.style.display = esServicio ? 'block' : 'none';

        const nombreInput = document.getElementById('personal-nombre');
        const conceptoInput = document.getElementById('servicio-concepto');
        const sueldoInput = document.getElementById('personal-sueldo');
        const montoInput = document.getElementById('fijo-monto');
        if (nombreInput) nombreInput.required = !esServicio;
        if (conceptoInput) conceptoInput.required = esServicio;
        if (sueldoInput) sueldoInput.required = !esServicio;
        if (montoInput) montoInput.required = esServicio;

        const title = document.getElementById('modal-personal-title');
        if (title) title.textContent = personal
            ? (esServicio ? 'Editar Servicio tercerizado' : 'Editar Empleado')
            : (esServicio ? 'Servicio tercerizado' : 'Nuevo Empleado');

        if (personal) {
            document.getElementById('personal-id').value = personal.id;
            if (esServicio) {
                if (conceptoInput) conceptoInput.value = personal.nombre || '';
                document.getElementById('fijo-categoria').value = personal.categoria || 'otros';
                if (montoInput) montoInput.value = personal.monto || '';
                document.getElementById('fijo-frecuencia').value = personal.frecuencia || 'mensual';
                this.fillMesDesdeSelects(personal.mesDesde || Calculos.getCurrentMes());
            } else {
                if (nombreInput) nombreInput.value = personal.nombre || '';
                document.getElementById('personal-rol').value = personal.rol || 'portero';
                if (sueldoInput) sueldoInput.value = personal.sueldoMensual || '';
            }
            document.getElementById('personal-notas').value = personal.notas || '';
        } else {
            form.reset();
            document.getElementById('personal-id').value = '';
            if (modoInput) modoInput.value = esServicio ? 'servicio' : 'nomina';
            if (!esServicio) {
                document.getElementById('personal-rol').value = 'portero';
            } else {
                document.getElementById('fijo-categoria').value = 'ascensores';
                document.getElementById('fijo-frecuencia').value = 'mensual';
                this.fillMesDesdeSelects(Calculos.getCurrentMes());
            }
            document.getElementById('personal-notas').value = '';
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
        document.getElementById('agua-consumo').value = f && f.consumo !== undefined && f.consumo !== null ? f.consumo : '';
        document.getElementById('agua-cargo-fijo').value = f && f.cargoFijo != null ? f.cargoFijo : '';
        document.getElementById('agua-igv').value = (f && f.igvPct !== undefined && f.igvPct !== null) ? f.igvPct : 18;
        document.getElementById('agua-potable').value = f && f.aguaPotable != null ? f.aguaPotable : '';
        document.getElementById('agua-alcantarillado').value = f && f.alcantarillado != null ? f.alcantarillado : '';
        document.getElementById('agua-igv-monto').value = f && f.igv != null ? f.igv : '';
        this.setTramosAguaModal(p);
        this.updateAguaFacturaTotal();
        const btnCalc = document.getElementById('btn-agua-calcular-tarifa');
        if (btnCalc && !btnCalc._bound) {
            btnCalc.addEventListener('click', () => this.recalcAguaMontos());
            btnCalc._bound = true;
        }
        document.getElementById('modal-agua-formula').style.display = 'flex';
    },

    openFacturaLuzModal() {
        const f = DB.getFacturaLuz ? DB.getFacturaLuz(this.currentMes) : null;
        document.getElementById('luz-factura-title').textContent = `Factura de Luz — ${Calculos.getMesLabel(this.currentMes)}`;
        document.getElementById('luz-consumo').value = f && f.consumo !== undefined && f.consumo !== null ? f.consumo : '';
        document.getElementById('luz-cargo-fijo').value = f && f.cargoFijo != null ? f.cargoFijo : '';
        document.getElementById('luz-energia').value = f && f.energia != null ? f.energia : '';
        document.getElementById('luz-alumbrado').value = f && f.alumbradoPublico != null ? f.alumbradoPublico : '';
        document.getElementById('luz-igv').value = (f && f.igvPct !== undefined && f.igvPct !== null) ? f.igvPct : 18;
        document.getElementById('luz-igv-monto').value = f && f.igv != null ? f.igv : '';
        this.updateLuzFacturaTotal();
        document.getElementById('modal-luz-formula').style.display = 'flex';
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

    recalcIgvLuzMonto() {
        const energia = parseFloat(document.getElementById('luz-energia').value) || 0;
        const alumbrado = parseFloat(document.getElementById('luz-alumbrado').value) || 0;
        const cargoFijo = parseFloat(document.getElementById('luz-cargo-fijo').value) || 0;
        const pct = parseFloat(document.getElementById('luz-igv').value) || 0;
        document.getElementById('luz-igv-monto').value = ((energia + alumbrado + cargoFijo) * pct / 100).toFixed(2);
        this.updateLuzFacturaTotal();
    },

    updateLuzFacturaTotal() {
        const energia = parseFloat(document.getElementById('luz-energia').value) || 0;
        const alumbrado = parseFloat(document.getElementById('luz-alumbrado').value) || 0;
        const cargoFijo = parseFloat(document.getElementById('luz-cargo-fijo').value) || 0;
        const igv = parseFloat(document.getElementById('luz-igv-monto').value) || 0;
        document.getElementById('luz-factura-total').textContent = `Total: ${Calculos.formatMoney(energia + alumbrado + cargoFijo + igv)}`;
    },

    // === Propietario Form: coeficiente y cuota automáticos ===
    bindPropietarioForm() {
        const m2Input = document.getElementById('propietario-m2');
        if (m2Input) {
            m2Input.addEventListener('input', () => this._actualizarCoeficientePropietario());
        }
        const deptoInput = document.getElementById('propietario-departamento');
        if (deptoInput) {
            deptoInput.addEventListener('input', () => this._validarDepartamentoPropietario());
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

            if (!this._validarDepartamentoPropietario()) return;

            if (!propietario.m2 || propietario.m2 <= 0) {
                this.toast('El m² del departamento debe ser mayor a 0', 'error');
                return;
            }

            try {
                DB.savePropietario(propietario);
            } catch (err) {
                if (err && err.message === 'DEPARTAMENTO_DUPLICADO') {
                    this._mostrarErrorDepartamento(`El departamento “${propietario.departamento}” ya está en uso. Elige otro código.`);
                    this.toast('Ese departamento ya está registrado. Usa otro código.', 'error');
                    return;
                }
                this.toast('No se pudo guardar el departamento. Inténtalo de nuevo.', 'error');
                return;
            }
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

        document.getElementById('form-personal').addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('personal-id').value;
            const personal = this._leerFormPersonal();

            DB.savePersonal(personal);
            this.closeAllModals();
            const esServicio = personal.tipo === 'fijo';
            const msg = id
                ? (esServicio ? 'Servicio actualizado' : 'Empleado actualizado')
                : (esServicio ? 'Servicio agregado' : 'Empleado agregado');
            this.toast(msg, 'success');
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

        ['agua-consumo', 'agua-potable', 'agua-alcantarillado', 'agua-cargo-fijo', 'agua-igv-monto'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateAguaFacturaTotal());
        });

        const igvPct = document.getElementById('agua-igv');
        if (igvPct) igvPct.addEventListener('input', () => this.recalcIgvMonto());
        // Tramos: sin recálculo automático; usar botón "Calcular desde tarifa (opcional)"

        const formLuz = document.getElementById('form-luz-formula');
        if (formLuz) formLuz.addEventListener('submit', (e) => {
            e.preventDefault();
            const factura = this._leerFormLuz();
            DB.saveFacturaLuz(this.currentMes, factura);
            // Modelo tipo agua: la luz se calcula por factura/lecturas; elimina gasto legado para evitar doble conteo
            try {
                const gl = DB.getGastoLuz ? DB.getGastoLuz(this.currentMes) : null;
                if (gl && DB.deleteGasto) DB.deleteGasto(gl.id);
            } catch (err) { /* no-op */ }
            this.closeAllModals();
            this.toast('Factura de luz guardada', 'success');
            this.render();
        });

        ['luz-consumo', 'luz-energia', 'luz-alumbrado', 'luz-cargo-fijo', 'luz-igv-monto'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateLuzFacturaTotal());
        });
        const luzIgvPct = document.getElementById('luz-igv');
        if (luzIgvPct) luzIgvPct.addEventListener('input', () => this.recalcIgvLuzMonto());
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
        const aguaSel = document.getElementById('config-agua-modalidad');
        const aguaHelp = document.getElementById('config-agua-ayuda');
        const setAguaHelp = (v) => {
            if (!aguaHelp) return;
            aguaHelp.textContent = v === 'coeficiente'
                ? 'El total de agua del periodo se prorratea según el coeficiente (m²) de cada departamento.'
                : v === 'ocupantes'
                    ? 'El total de agua del periodo se prorratea por número de ocupantes (cápita). Ajusta “Nº de ocupantes” en cada departamento.'
                    : 'Por defecto: lectura de medidor interno (m³) por departamento; el consumo se suma directo a su boleta (sin prorratear).';
        };
        if (aguaSel) {
            aguaSel.value = config.aguaModalidad || 'medidor';
            setAguaHelp(aguaSel.value);
            if (!aguaSel._bound) {
                aguaSel.addEventListener('change', () => {
                    const cfg = DB.getConfig();
                    cfg.aguaModalidad = aguaSel.value;
                    DB.saveConfig(cfg);
                    setAguaHelp(aguaSel.value);
                    this.toast('Modalidad de agua actualizada. El cálculo del periodo usará esta configuración.', 'success');
                    this.render();
                });
                aguaSel._bound = true;
            }
        }

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
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const config = DB.getConfig();
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 40;
        let y = 42;

        const calc = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const totals = calc ? calc.totals : {};
        const rows = calc ? calc.rows : [];
        const gastos = DB.getGastos({ mes: this.currentMes }) || [];
        const totalGastos = Calculos.calcTotalGastosMes ? Calculos.calcTotalGastosMes(this.currentMes) : 0;
        const totalGas = Calculos.calcGasTotal ? Calculos.calcGasTotal(this.currentMes) : 0;
        const totalAgua = Calculos.calcAguaTotal ? Calculos.calcAguaTotal(this.currentMes) : 0;
        const periodo = this.labelPeriodo ? this.labelPeriodo(this.currentMes) : Calculos.getMesLabel(this.currentMes);

        const sectionTitle = (t) => {
            if (y > 760) { doc.addPage(); y = 42; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(31,35,40);
            doc.text(t, margin, y); y += 10;
            doc.setDrawColor(234,238,242); doc.line(margin, y, pageW - margin, y); y += 12;
        };

        // Header
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(31,35,40);
        doc.text(config.nombre || 'Edificio', margin, y); y += 18;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(87,96,106);
        doc.text(`Informe del periodo · ${periodo}`, margin, y); y += 14;
        doc.setDrawColor(208,215,222); doc.line(margin, y, pageW - margin, y); y += 18;

        // Resumen KPIs
        sectionTitle('Resumen del periodo');
        const kpis = [
            ['Gastos del periodo', Calculos.formatMoney(totals.totalGastosPeriodo != null ? totals.totalGastosPeriodo : (totals.comunes || 0))],
            ['Cuotas generadas', Calculos.formatMoney(totals.totalCuotasGeneradas != null ? totals.totalCuotasGeneradas : (totals.comunes || 0))],
            ['Total a cobrar', Calculos.formatMoney(totals.cargo || 0)],
            ['Total recaudado', Calculos.formatMoney(totals.pagado || 0)],
            ['Pendiente', Calculos.formatMoney(totals.pendiente || 0)],
            ['Consumos (agua/gas/luz)', Calculos.formatMoney(totals.consumosMes || 0)],
        ];
        if (typeof doc.autoTable === 'function') {
            doc.autoTable({
                startY: y,
                body: kpis,
                theme: 'plain',
                styles: { font: 'helvetica', fontSize: 9, textColor: [31,35,40], cellPadding: { top: 6, right: 8, bottom: 6, left: 8 }, lineColor: [234,238,242], lineWidth: 0.5 },
                columnStyles: { 0: { textColor: [87,96,106], cellWidth: 220 }, 1: { fontStyle: 'bold' } },
                margin: { left: margin, right: margin },
                tableWidth: pageW - margin * 2,
            });
            y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 18;
        } else {
            kpis.forEach(k => { doc.setFont('helvetica','normal'); doc.setTextColor(87,96,106); doc.text(k[0], margin, y); doc.setTextColor(31,35,40); doc.setFont('helvetica','bold'); doc.text(k[1], margin+240, y); y += 14; });
            y += 8;
        }

        // Gastos del mes
        if (gastos.length > 0) {
            sectionTitle(`Gastos registrados (${Calculos.formatMoney(totalGastos)})`);
            if (typeof doc.autoTable === 'function') {
                doc.autoTable({
                    startY: y,
                    head: [['Fecha', 'Concepto', 'Categoría', 'Frecuencia', 'Monto', 'Estado']],
                    body: gastos.map(g => [
                        g.fecha || '—',
                        g.concepto || '—',
                        Calculos.categoriaLabel ? Calculos.categoriaLabel(g.categoria) : (g.categoria || '—'),
                        Calculos.frecuenciaLabel ? Calculos.frecuenciaLabel(g.frecuencia) : (g.frecuencia || '—'),
                        Calculos.formatMoney(g.monto || 0),
                        g.pagado ? 'Pagado' : 'Pendiente'
                    ]),
                    theme: 'plain',
                    styles: { font: 'helvetica', fontSize: 8.5, textColor: [31,35,40], cellPadding: 5, lineColor: [234,238,242], lineWidth: 0.5, overflow: 'linebreak' },
                    headStyles: { fillColor: [246,248,250], textColor: [87,96,106], fontStyle: 'bold' },
                    margin: { left: margin, right: margin },
                    columnStyles: { 4: { fontStyle: 'bold' } }
                });
                y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 18;
            }
        }

        // Consumos
        if ((totalGas || 0) > 0.005 || (totalAgua || 0) > 0.005) {
            sectionTitle('Consumos');
            const crows = [];
            if ((totalGas || 0) > 0.005) crows.push(['Gas', Calculos.formatMoney(totalGas), 'Distribuido según lecturas/consumo del periodo']);
            if ((totalAgua || 0) > 0.005) crows.push(['Agua', Calculos.formatMoney(totalAgua), 'Según modalidad de cálculo configurada']);
            if (typeof doc.autoTable === 'function') {
                doc.autoTable({
                    startY: y,
                    head: [['Servicio', 'Total', 'Nota']],
                    body: crows,
                    theme: 'plain',
                    styles: { font: 'helvetica', fontSize: 8.5, textColor: [31,35,40], cellPadding: 5, lineColor: [234,238,242], lineWidth: 0.5 },
                    headStyles: { fillColor: [246,248,250], textColor: [87,96,106], fontStyle: 'bold' },
                    margin: { left: margin, right: margin },
                });
                y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 18;
            }
        }

        // Resumen por departamento
        if (rows.length > 0) {
            sectionTitle('Resumen por departamento (prorrateo por participación)');
            const body = rows.map(r => [
                r.depto || '',
                `${Number(r.coef || 0).toFixed(2)}%`,
                Calculos.formatMoney(r.comunes || 0),
                Calculos.formatMoney(r.consumos || (Number(r.agua||0)+Number(r.gas||0)+Number(r.luz||0)) || 0),
                Calculos.formatMoney(r.cargo || r.total || 0),
                Calculos.formatMoney(r.pagado || 0),
                Calculos.formatMoney(r.saldo || 0),
                r.estado || (Number(r.saldo||0) <= 0.01 ? 'Al día' : 'Pendiente')
            ]);
            if (typeof doc.autoTable === 'function') {
                doc.autoTable({
                    startY: y,
                    head: [['Dpto', 'Coef.', 'Comunes', 'Consumos', 'Cargo', 'Pagado', 'Saldo', 'Estado']],
                    body,
                    theme: 'plain',
                    styles: { font: 'helvetica', fontSize: 8.5, textColor: [31,35,40], cellPadding: 5, lineColor: [234,238,242], lineWidth: 0.5 },
                    headStyles: { fillColor: [246,248,250], textColor: [87,96,106], fontStyle: 'bold' },
                    margin: { left: margin, right: margin },
                    didParseCell: (data) => {
                        if (data.section === 'body') {
                            const r = rows[data.row.index]; if (!r) return;
                            if (data.column.index === 6 && (r.saldo || 0) > 0.01) data.cell.styles.textColor = [159,46,34];
                            if (data.column.index === 7) data.cell.styles.textColor = (r.saldo || 0) > 0.01 ? [159,46,34] : [26,127,55];
                        }
                    }
                });
                y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 14;
            }
        }

        const footY = doc.internal.pageSize.getHeight() - 24;
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(87,96,106);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-PE')} · Prorrateo por participación (coeficiente/m²)`, margin, footY);

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
        this._saveModalFocus();
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
        const mc = document.getElementById('modal-confirm');
        if (mc) { const f = mc.querySelector('button, [href], input, select, textarea'); if (f) try{f.focus();}catch(e){} }
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


    labelPeriodo(mes = this.currentMes) {
        return `Periodo de liquidación: ${Calculos.getMesLabel(mes)}`;
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
        set('gastos-month-label', this.labelPeriodo ? this.labelPeriodo(this.currentMes) : mesLabel);
        document.querySelectorAll('.js-periodo-month-label').forEach(el => { el.textContent = mesLabel; });

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
        const totals = calc ? calc.totals : { comunes:0, cargo:0, pagado:0, pendiente:0, departamentos:0, alDia:0, consumosMes:0, gastosMes:0, totalGastosPeriodo:0, totalCuotasGeneradas:0 };
        const totalGastosPeriodo = (totals.totalGastosPeriodo != null ? totals.totalGastosPeriodo : totals.comunes) || 0;
        const totalCuotasGeneradas = (totals.totalCuotasGeneradas != null ? totals.totalCuotasGeneradas : totals.comunes) || 0;
        const totalCargo = totals.cargo || 0;
        const totalPagado = totals.pagado || 0;
        const totalPendiente = totals.pendiente || 0;
        const pct = totalCargo > 0 ? Math.round((totalPagado / totalCargo) * 100) : 0;

        // Mantenimiento generado y variación vs periodo anterior
        const mesAnterior = Calculos.shiftMes ? Calculos.shiftMes(this.currentMes, -1) : null;
        let mantenimientoActual = totalGastosPeriodo;
        let mantenimientoAnterior = 0;
        try {
            if (mesAnterior && Calculos.calcMes) {
                const calcAnt = Calculos.calcMes(mesAnterior);
                const tAnt = calcAnt ? calcAnt.totals : {};
                mantenimientoAnterior = (tAnt.totalGastosPeriodo != null ? tAnt.totalGastosPeriodo : (tAnt.comunes || 0)) || 0;
            }
        } catch(e) { mantenimientoAnterior = 0; }
        const diffMant = mantenimientoActual - mantenimientoAnterior;
        let varText = 'Sin datos del periodo anterior';
        let varColor = '';
        if (mesAnterior) {
            if (Math.abs(mantenimientoAnterior) < 0.01 && Math.abs(mantenimientoActual) < 0.01) {
                varText = 'Sin variación vs periodo anterior';
            } else if (Math.abs(mantenimientoAnterior) < 0.01) {
                varText = `+${Calculos.formatMoney(mantenimientoActual)} vs periodo anterior (sin base previa)`;
                varColor = 'var(--md-sys-color-error, #cf222e)';
            } else {
                const pctVar = (diffMant / mantenimientoAnterior) * 100;
                const signo = diffMant > 0.005 ? '+' : (diffMant < -0.005 ? '−' : '');
                const absDiff = Math.abs(diffMant);
                const absPct = Math.abs(pctVar);
                varText = `${signo}${Calculos.formatMoney(absDiff)} (${signo}${absPct.toFixed(1)}%) vs ${Calculos.getMesLabel(mesAnterior)}`;
                varColor = diffMant > 0.005 ? 'var(--md-sys-color-error, #cf222e)' : (diffMant < -0.005 ? 'var(--md-sys-color-success, #1a7f37)' : '');
            }
        }

        const mesLabel = Calculos.getMesLabel(this.currentMes);
        const cierreInfo = DB.getCierreMes ? DB.getCierreMes(this.currentMes) : null;
        const cerrado = !!cierreInfo;
        const estadoPeriodo = cerrado ? 'Cerrado' : 'Abierto';
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const ml = document.getElementById('current-month-label'); if (ml) ml.textContent = mesLabel;
        const setBadge = (badge) => {
            if (!badge) return;
            badge.textContent = estadoPeriodo;
            badge.className = (badge.classList.contains('js-periodo-badge') ? 'js-periodo-badge ' : '') + 'period-status-badge ' + (cerrado ? 'cerrado' : 'abierto');
            badge.style.font = 'var(--md-sys-typescale-label-large)';
            badge.style.lineHeight = '1';
            badge.title = cerrado
                ? 'Cerrado: periodo liquidado y boletas emitidas. La cobranza puede seguir registrándose.'
                : 'Abierto: periodo en edición/cálculo, aún no cerrado.';
        };
        setBadge(document.getElementById('periodo-estado-badge'));
        document.querySelectorAll('.js-periodo-badge').forEach(setBadge);
        setText('kpi-gastos', Calculos.formatMoney(totalGastosPeriodo));
        setText('kpi-recaudado', pct + '%');
        const det = document.getElementById('kpi-recaudado-detalle');
        if (det) det.textContent = `${Calculos.formatMoney(totalPagado)} cobrados de ${Calculos.formatMoney(totalCargo)} · Pendiente ${Calculos.formatMoney(totalPendiente)}`;
        setText('kpi-caja', Calculos.formatMoney(cajaChica));
        const varEl = document.getElementById('kpi-mantenimiento-var');
        if (varEl) { varEl.textContent = varText; varEl.style.color = varColor || 'var(--md-sys-color-on-surface-variant)'; }

        const scLbl = document.getElementById('sc-periodo-label');
        if (scLbl) scLbl.textContent = `— ${mesLabel}`;
        const scCtx = document.getElementById('sc-context');
        if (scCtx) {
            scCtx.textContent = cerrado
                ? `Periodo cerrado: gastos y cuotas corresponden a ${mesLabel}. La cobranza registrada puede continuar actualizándose.`
                : `Periodo abierto: en edición y cálculo. Verifica que gastos y cuotas cuadren antes de cerrar.`;
        }
        const dSub = document.getElementById('dashboard-deptos-sub');
        if (dSub) { dSub.textContent = ''; dSub.style.display = 'none'; }

        const extraInfo = document.getElementById('extra-info');
        let extraHtml = '';
        if ((totals.conCargo || 0) > 0) {
            const alDiaCount = totals.alDia || 0;
            const conCargoCount = totals.conCargo || 0;
            const pendienteCount = Math.max(0, conCargoCount - alDiaCount);
            if (pendienteCount > 0) {
                extraHtml += `<div class="dashboard-alert" role="status" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;">
                    <div style="display:flex;align-items:center;gap:8px;font-weight:600;"><span class="material-symbols-outlined" style="font-size:18px;">payments</span> ${alDiaCount} de ${conCargoCount} con cargo al día</div>
                    <button class="btn btn-sm btn-outline" onclick="App.navigateTo('calculo')">Ir a Cálculo</button>
                </div>`;
            }
        }
        if (extraInfo) extraInfo.innerHTML = extraHtml;

        // Nota de composición del cargo
        const compNoteId = 'dashboard-cargo-note';
        let compNote = document.getElementById(compNoteId);
        if (!compNote) {
            const extra = document.getElementById('extra-info');
            if (extra) {
                compNote = document.createElement('div');
                compNote.id = compNoteId;
                compNote.className = 'luz-status';
                compNote.style.margin = '0 0 var(--space-3)';
                extra.parentNode.insertBefore(compNote, extra.nextSibling);
            }
        }
        if (compNote) compNote.textContent = '';

        // === Semáforo de Cuadre (Gastos del Periodo vs Cuotas Generadas) ===
        this.actualizarSemaforoCuadre(totalGastosPeriodo, totalCuotasGeneradas, totalPagado);

        const container = document.getElementById('dashboard-propietarios');
        if (!container) return;

        const rows = calc ? calc.rows : [];
        if (rows.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos registrados. Usa “+ Nuevo departamento” para agregarlos y poder calcular prorrateos y cobros.</p>';
        } else {
            container.innerHTML = `
                <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th>Dpto</th>
                            <th class="num-left">Total a pagar</th>
                            <th class="num-left">Pagado</th>
                            <th class="num-left">Saldo acumulado</th>
                            <th>Estado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            let saldoAcum = Number(r.saldo || 0);
                            try {
                                const ec = Calculos.calcEstadoCuenta ? Calculos.calcEstadoCuenta(r.id) : null;
                                if (ec && ec.filas) {
                                    const fila = ec.filas.find(f => f.mes === this.currentMes);
                                    if (fila) saldoAcum = Number(fila.acumulado != null ? fila.acumulado : fila.saldo || 0);
                                    else {
                                        const pasadas = ec.filas.filter(f => f.mes <= this.currentMes);
                                        if (pasadas.length) saldoAcum = Number(pasadas[pasadas.length - 1].acumulado || 0);
                                    }
                                }
                            } catch(e) {}
                            const estadoKey = r.saldo <= 0.01 ? 'ok' : (r.pagado > 0.01 ? 'parcial' : 'debe');
                            const estadoText = r.estado || (estadoKey === 'ok' ? 'Al día' : (estadoKey === 'parcial' ? 'Parcial' : 'Pendiente'));
                            const saldoClase = saldoAcum > 0.01 ? 'ec-debe' : (saldoAcum < -0.01 ? 'ec-favor' : '');
                            return `
                                <tr>
                                    <td><strong>${r.depto}</strong></td>
                                    <td class="num-left">${Calculos.formatMoney(r.cargo || 0)}</td>
                                    <td class="num-left">${Calculos.formatMoney(r.pagado || 0)}</td>
                                    <td class="num-left ${saldoClase}"><strong>${Calculos.formatMoney(Math.abs(saldoAcum) < 0.005 ? 0 : saldoAcum)}</strong></td>
                                    <td><span class="badge-status ${estadoKey}">${estadoText}</span></td>
                                    <td><button class="btn btn-sm btn-outline btn-historial-depto" data-id="${r.id}">Ver historial</button></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                </div>
            `;

            container.querySelectorAll('.btn-historial-depto, .btn-estado-cuenta').forEach(btn => {
                btn.addEventListener('click', () => this.openHistorialDeptoModal(parseInt(btn.dataset.id)));
            });
        }

        const btnEditCaja = document.getElementById('btn-edit-caja');
        if (btnEditCaja) btnEditCaja.onclick = () => this.editCajaChica();
        const btnCerrarMes = document.getElementById('btn-cerrar-mes');
        if (btnCerrarMes) btnCerrarMes.onclick = () => this.cerrarMes();
    },

    editCajaChica() {
        const actual = DB.getCajaChica(this.currentMes);
        const label = Calculos.getMesLabel ? Calculos.getMesLabel(this.currentMes) : this.currentMes;
        const nuevo = prompt(`Editar caja chica — ${label}\nIngresa el monto:`, actual);
        if (nuevo === null) return;
        const num = parseFloat(String(nuevo).replace(',', '.'));
        if (isNaN(num) || num < 0) {
            this.toast('Monto inválido. Ingresa un valor mayor o igual a 0.', 'error');
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

    actualizarSemaforoCuadre(totalGastosPeriodo, totalCuotasGeneradas, totalPagos) {
        const card = document.getElementById('semaforo-cuadre');
        const btnCerrar = document.getElementById('btn-cerrar-mes');
        if (!card) return;
        card.classList.remove('is-ok', 'is-warn', 'is-error');
        const gastos = Number(totalGastosPeriodo || 0);
        const cuotas = Number(totalCuotasGeneradas || 0);
        const pagos = Number(totalPagos || 0);
        const elG = document.getElementById('sc-gastos');
        const elC = document.getElementById('sc-cuotas');
        const elP = document.getElementById('sc-pagos');
        const elAlert = document.getElementById('sc-alert');
        if (elG) elG.textContent = Calculos.formatMoney(gastos);
        if (elC) elC.textContent = Calculos.formatMoney(cuotas);
        if (elP) elP.textContent = Calculos.formatMoney(pagos);
        const diffGC = Math.abs(gastos - cuotas);
        const cuadraAritmetica = diffGC < 0.01;
        const pendienteCobro = Math.max(0, (Calculos.round2 ? Calculos.round2(cuotas - pagos) : (cuotas - pagos)));
        const excedente = Math.max(0, (Calculos.round2 ? Calculos.round2(pagos - cuotas) : (pagos - cuotas)));

        if (cuadraAritmetica && pendienteCobro < 0.01) {
            card.classList.add('is-ok');
            if (excedente >= 0.01) {
                if (elAlert) elAlert.textContent = 'Cuadre correcto: gastos y cuotas coinciden (100%). La cobranza registrada supera las cuotas por ' + Calculos.formatMoney(excedente) + ' (saldo a favor/excedente).';
            } else {
                if (elAlert) elAlert.textContent = 'Cuadre correcto: gastos y cuotas coinciden (100%) y la cobranza del periodo está completa.';
            }
            if (btnCerrar) { btnCerrar.disabled = false; btnCerrar.title = ''; }
        } else if (cuadraAritmetica) {
            card.classList.add('is-warn');
            if (elAlert) elAlert.textContent = 'Gastos y cuotas cuadran (100%). Cobranza pendiente por ' + Calculos.formatMoney(pendienteCobro) + '. Es normal si los pagos se reciben el mes siguiente; podrás cerrar cuando la cobranza del periodo esté completa.';
            if (btnCerrar) { btnCerrar.disabled = true; btnCerrar.title = 'Bloqueado: hay pagos pendientes.'; }
        } else {
            card.classList.add('is-error');
            if (elAlert) elAlert.textContent = 'Descuadre: gastos del periodo (' + Calculos.formatMoney(gastos) + ') no coinciden con cuotas generadas (' + Calculos.formatMoney(cuotas) + '). Diferencia: ' + Calculos.formatMoney(diffGC) + '. Revisa el prorrateo antes de cerrar.';
            if (btnCerrar) { btnCerrar.disabled = true; btnCerrar.title = 'Bloqueado: existe descuadre aritmético entre gastos y cuotas generadas.'; }
        }
    },

    cerrarMes() {
        if (DB.isMesCerrado && DB.isMesCerrado(this.currentMes)) {
            this.toast('Este periodo ya está cerrado. Las boletas ya fueron emitidas.', 'info');
            return;
        }
        const calc = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const t = calc ? calc.totals : { totalGastosPeriodo: 0, totalCuotasGeneradas: 0, pagado: 0, pendiente: 0, cargo: 0, comunes: 0 };
        const gastosPeriodo = Number(t.totalGastosPeriodo != null ? t.totalGastosPeriodo : (t.comunes || 0));
        const cuotasGeneradas = Number(t.totalCuotasGeneradas != null ? t.totalCuotasGeneradas : (t.comunes || 0));
        const pagado = Number(t.pagado || 0);
        const pendiente = Number(t.pendiente != null ? t.pendiente : Math.max(0, (t.cargo||0) - pagado));
        const diffGC = Math.abs(gastosPeriodo - cuotasGeneradas);

        if (diffGC >= 0.01) {
            this.toast(`No se puede cerrar el periodo: descuadre aritmético. Total Gastos del Periodo ${Calculos.formatMoney(gastosPeriodo)} vs Total Cuotas Generadas ${Calculos.formatMoney(cuotasGeneradas)} (dif. ${Calculos.formatMoney(diffGC)}). Corrige el prorrateo e inténtalo de nuevo.`, 'error');
            return;
        }
        if (pendiente >= 0.01) {
            this.toast(`No se puede cerrar el periodo ni emitir boletas: hay ${Calculos.formatMoney(pendiente)} pendientes de cobro. Registra los pagos y vuelve a intentar.`, 'error');
            return;
        }

        this.showConfirm(
            'Cerrar periodo y emitir boletas',
            `Vas a cerrar ${Calculos.getMesLabel(this.currentMes)} (periodo de mantenimiento liquidado).

¿Qué hará esta acción?
• Verifica que gastos y cuotas cuadren al 100% y que no haya cobros pendientes.
• Emite/guarda las boletas por departamento.
• Registra el cierre y traslada el saldo a caja chica.
• Avanza al siguiente periodo.

Recomendación: ejecutarlo desde Cálculo cuando hayas revisado el detalle. ¿Continuar?`,
            () => {
                try {
                    const mesCerrado = this.currentMes;
                    const calcCierre = Calculos.calcMes ? Calculos.calcMes(mesCerrado) : null;
                    if (DB.emitirBoletasPeriodo && calcCierre) {
                        DB.emitirBoletasPeriodo(mesCerrado, calcCierre);
                    }
                    const nuevoSaldo = DB.cerrarMes(mesCerrado);
                    this.closeAllModals();
                    const cant = calcCierre && calcCierre.rows ? calcCierre.rows.length : 0;
                    this.toast(`Periodo cerrado: ${cant} boleta(s) emitida(s) y guardadas por departamento (según participación). Caja Chica: ${Calculos.formatMoney(nuevoSaldo)}`, 'success');
                    this.currentMes = Calculos.shiftMes(mesCerrado, 1);
                    DB.saveMesActual(this.currentMes);
                    this.render();
                } catch (e) {
                    console.error(e);
                    this.toast('No se pudo cerrar el periodo ni emitir las boletas. Revisa el estado e inténtalo de nuevo.', 'error');
                }
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
                hist.innerHTML = '<p class="empty-state" style="margin:0">Sin pagos registrados este mes. Cuando se registren abonos o pagos, aparecerán aquí.</p>';
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

        // Navegación de periodo: encabezado unificado (.js-periodo-*) y compatibilidad legacy
        const prev = document.getElementById('btn-prev-month-prop');
        const next = document.getElementById('btn-next-month-prop');
        if (prev && !prev._boundMonth) { prev.addEventListener('click', () => this.changeMonth(-1)); prev._boundMonth = true; }
        if (next && !next._boundMonth) { next.addEventListener('click', () => this.changeMonth(1)); next._boundMonth = true; }

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
        if (info2) info2.innerHTML = '';

        if (!container) return;
        if (propietarios.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay departamentos registrados. Usa “+ Nuevo departamento” para agregarlos y poder calcular prorrateos y cobros.</p>';
            return;
        }

        const iconEdit = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293z"/></svg>';
        const iconTransfer = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6M5.216 14A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/><path d="M13.5 5.5a.5.5 0 0 1 .5.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1V6a.5.5 0 0 1 .5-.5"/></svg>';
        const iconHist = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg>';
        const iconPay = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495l-.2-.05zm1.591 1.872c1.287.323 1.852.859 1.852 1.769 0 1.097-.826 1.828-2.2 1.939V8.73z"/></svg>';
        const iconTrash = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>';
        const iconReceipt = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm-.5 2.5A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5M5 8a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1z"/><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm10-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1"/></svg>';

        const calcMes = Calculos.calcMes ? Calculos.calcMes(this.currentMes) : null;
        const rows = propietarios.map(p => {
            const titular = [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || '-';
            let cargo = 0, saldo = 0, pagado = 0;
            try {
                const row = calcMes && calcMes.rows ? calcMes.rows.find(r => r.id == p.id) : null;
                if (row) { cargo = row.cargo || 0; saldo = row.saldo || 0; pagado = row.pagado || 0; }
            } catch (e) { cargo = 0; saldo = 0; pagado = 0; }
            const alDia = saldo <= 0.01;
            const estadoHtml = alDia
                ? '<span class="badge badge-pagado">Al día</span>'
                : `<span class="badge badge-pendiente">Pendiente</span>`;
            const payBtn = alDia
                ? `<button class="btn-depto-historial" data-id="${p.id}" title="Ver historial / último comprobante" aria-label="Ver historial">${iconReceipt}</button>`
                : `<button class="btn-depto-pago primary" data-id="${p.id}" title="Registrar pago / Abono" aria-label="Registrar pago o abono">${iconPay}</button>`;
            return `
                <tr data-id="${p.id}">
                    <td><strong>${p.departamento || '-'}</strong></td>
                    <td>${this.esc ? this.esc(titular) : titular}</td>
                    <td>${(Number(p.m2) || 0).toFixed(2)}</td>
                    <td>${(Number(p.coeficiente) || 0).toFixed(2)}%</td>
                    <td>${estadoHtml}</td>
                    <td>
                        <div class="deptos-actions">
                            <button class="btn-depto-editar" data-id="${p.id}" title="Editar datos" aria-label="Editar datos">${iconEdit}</button>
                            <button class="btn-depto-transferir" data-id="${p.id}" title="Transferir titularidad" aria-label="Transferir titularidad">${iconTransfer}</button>
                            <button class="btn-depto-eliminar" data-id="${p.id}" title="Eliminar departamento" aria-label="Eliminar departamento" style="color:#9f2e22;">${iconTrash}</button>
                            ${payBtn}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead><tr><th>Dpto</th><th>Titular</th><th>m²</th><th>Coeficiente</th><th>Estado de pagos</th><th>Acciones</th></tr></thead>
                    <tbody>${rows}</tbody>
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
            this.openHistorialDeptoModal(parseInt(btn.dataset.id));
        }));
        container.querySelectorAll('.btn-depto-pago').forEach(btn => btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            this.openPagoModal(id, 'fija');
        }));
        container.querySelectorAll('.btn-depto-eliminar').forEach(btn => btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            const p = DB.getPropietario(id);
            if (!p) return;
            const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || '-';
            const depto = p.departamento || '-';
            const msg = `¿Eliminar el departamento ${depto} (${nombre})?\n\nEsto borrará el departamento y sus datos (pagos, consumos, historial). Los coeficientes de los demás se recalcularán. Esta acción no se puede deshacer.`;
            if (!confirm(msg)) return;
            // Confirmación fuerte: pedir que escriba el código del departamento
            const typed = prompt(`Escribe el código del departamento para confirmar: ${depto}`);
            if (typed === null) return;
            if (String(typed).trim().toLowerCase() !== String(depto).trim().toLowerCase()) {
                this.toast('Confirmación incorrecta. No se eliminó.', 'error');
                return;
            }
            try {
                DB.deletePropietario(id);
                this.toast('Departamento eliminado', 'success');
                this.render();
            } catch (err) {
                this.toast('No se pudo eliminar el departamento.', 'error');
            }
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
        if (btnNom) btnNom.onclick = () => this.openPersonalModal && this.openPersonalModal(null, 'nomina');
        const btnServ = document.getElementById('btn-add-servicio-rec');
        if (btnServ) btnServ.onclick = () => this.openPersonalModal && this.openPersonalModal(null, 'servicio');
        const btnJard = document.getElementById('btn-add-jardineria-rec');
        if (btnJard) btnJard.onclick = () => this.openJardineriaModal && this.openJardineriaModal();
        const form = document.getElementById('form-gasto-mes');
        if (form && !form._bound) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                try {
                    const concepto = (document.getElementById('gm-concepto')?.value || '').trim();
                    const cantidad = parseFloat(document.getElementById('gm-cantidad')?.value) || 1;
                    const monto = parseFloat(document.getElementById('gm-monto')?.value);
                    const categoria = document.getElementById('gm-categoria')?.value || 'otros';
                    const entidad = (document.getElementById('gm-entidad')?.value || '').trim();
                    const frecuencia = 'unico';
                    const origenPago = document.getElementById('gm-origen-pago')?.value || 'cuenta_general';
                    if (!concepto || isNaN(monto) || monto <= 0) { this.toast('No se pudo agregar el gasto: completa el concepto y un monto mayor a 0. Corrige e inténtalo de nuevo.', 'error'); return; }
                    const fecha = new Date().toISOString().split('T')[0];
                    const mes = this.currentMes;
                    const _cm = Calculos.getCurrentMes ? Calculos.getCurrentMes() : mes;
                    if (mes < _cm && DB.getCierreMes && DB.getCierreMes(mes)) {
                        this.toast('No se pueden registrar gastos en un periodo cerrado.', 'error');
                        return;
                    }
                    // Punto 3: si se paga con Caja Chica, descontar de inmediato
                    if (origenPago === 'caja_chica') {
                        const saldoCaja = DB.getCajaChica(mes) || 0;
                        const nuevoSaldo = (Calculos.round2 ? Calculos.round2(saldoCaja - monto) : Math.round((saldoCaja - monto) * 100) / 100);
                        DB.saveCajaChica(mes, nuevoSaldo);
                    }
                    DB.saveGasto({
                        concepto, monto, cantidad, fecha, categoria,
                        entidad,
                        frecuencia, division: 'proporcional',
                        pagado: true,
                        origenPago,
                        mes,
                        notas: origenPago === 'caja_chica' ? 'Pagado con Caja Chica (reposición en prorrateo del periodo)' : ''
                    });
                    form.reset();
                    this.toast(
                        origenPago === 'caja_chica'
                            ? 'Gasto guardado: se descontó de Caja Chica y se incluirá en el prorrateo del periodo para su reposición.'
                            : 'Gasto guardado (Cuenta General) e incluido en el cálculo del periodo.',
                        'success'
                    );
                    this.render();
                } catch (err) {
                    console.error(err);
                    this.toast('No se pudo guardar el gasto. Revisa los datos e inténtalo de nuevo.', 'error');
                }
            });
            form._bound = true;
        }
        const prev = document.getElementById('btn-prev-month-gastos');
        const next = document.getElementById('btn-next-month-gastos');
        if (prev && !prev._boundMonth) { prev.addEventListener('click', () => this.changeMonth(-1)); prev._boundMonth = true; }
        if (next && !next._boundMonth) { next.addEventListener('click', () => this.changeMonth(1)); next._boundMonth = true; }
        const filtroMes = document.getElementById('gastos-mes-filter');
        if (filtroMes && !filtroMes._bound) {
            filtroMes.addEventListener('change', () => {
                if (filtroMes.value) {
                    this.currentMes = filtroMes.value;
                    this._gasPeriodo = null;
                    DB.saveMesActual(this.currentMes);
                    this.render();
                }
            });
            filtroMes._bound = true;
        }
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
        const periodoLbl = (this.labelPeriodo ? this.labelPeriodo(this.currentMes) : ('Periodo de liquidación: ' + lbl));
        const gLbl = document.getElementById('gastos-month-label'); if (gLbl) gLbl.textContent = periodoLbl;
        const gFilter = document.getElementById('gastos-mes-filter'); if (gFilter) gFilter.value = this.currentMes;
        const fLbl = document.getElementById('gastos-form-mes'); if (fLbl) fLbl.textContent = lbl;
        const mesCerrado = !!(DB.isMesCerrado ? DB.isMesCerrado(this.currentMes) : (DB.getCierreMes && DB.getCierreMes(this.currentMes)));
        const imp = document.getElementById('gastos-impacto');
        if (imp) {
            if (mesCerrado) {
                imp.innerHTML = `Periodo <strong>${lbl}</strong> cerrado. Se muestran los gastos filtrados de este mes.`;
            } else {
                imp.innerHTML = `Mostrando solo los gastos del mes seleccionado (<strong>${lbl}</strong>). Los registros y valores corresponden a este periodo.`;
            }
        }
        const cLbl = document.getElementById('consumos-month-label'); if (cLbl) cLbl.textContent = lbl;
        const formWrap = document.getElementById('gasto-mes-form-wrap');
        if (formWrap) formWrap.style.display = mesCerrado ? 'none' : '';
        const canEditMes = !mesCerrado && (Auth.canWrite ? Auth.canWrite() : true);
        ['btn-add-nomina','btn-add-servicio-rec','btn-add-jardineria-rec'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = canEditMes ? '' : 'none';
        });

        // Listas: filtradas por el mes consultado
        const mesSel = this.currentMes;
        const personal = (DB.getPersonal ? DB.getPersonal(mesSel) : []) || [];
        const nomina = personal.filter(p => (p.tipo || 'personal') === 'personal');
        const servicios = personal.filter(p => p.tipo === 'fijo');
        const jardineria = (DB.getJardineria ? DB.getJardineria(mesSel) : []) || [];
        const gastosMesAplican = (DB.getGastos ? DB.getGastos(mesSel) : []) || [];
        // "Del mes": gastos puntuales/registrados para este periodo (no recurrentes que solo aplican)
        const gastos = gastosMesAplican.filter(g => {
            const f = g.frecuencia || 'unico';
            // Solo gastos puntuales/extraordinarios del mes; los recurrentes
            // (mensual/trimestral/semestral/anual) se gestionan en "Recurrentes"
            // y no deben duplicarse en "Puntuales".
            return f === 'unico' || f === 'extraordinario' || f === 'puntual';
        });

        const sumNom = nomina.reduce((a,p)=>a+(parseFloat(p.sueldoMensual)||0),0);
        const sumServ = servicios.reduce((a,p)=>a+(parseFloat(p.monto ?? p.sueldoMensual)||0),0);
        const sumJard = jardineria.reduce((a,j)=>a+(parseFloat(j.montoTotal!=null?j.montoTotal:j.monto)||0),0);
        const sumDel = gastos.reduce((a,g)=>a+(parseFloat(g.monto)||0),0);
        let sumAgua = 0, sumGas = 0, sumLuz = 0, sumAguaComun = 0, sumLuzComun = 0;
        try { sumAgua = Calculos.calcAguaTotal ? (Calculos.calcAguaTotal(mesSel) || 0) : 0; } catch(e) { sumAgua = 0; }
        try { sumGas = Calculos.calcGasTotal ? (Calculos.calcGasTotal(mesSel) || 0) : 0; } catch(e) { sumGas = 0; }
        try {
            if (DB.getFacturaLuz && DB.getFacturaLuz(mesSel) && Calculos.calcLuzTotal) {
                sumLuz = Calculos.calcLuzTotal(mesSel) || 0;
            } else {
                const gl = DB.getGastoLuz ? DB.getGastoLuz(mesSel) : null;
                sumLuz = parseFloat(gl?.monto != null ? gl.monto : 0) || 0;
            }
        } catch(e) { sumLuz = 0; }
        try {
            const calcMesResumen = Calculos.calcMes ? Calculos.calcMes(mesSel) : null;
            sumAguaComun = Number(calcMesResumen && calcMesResumen.totals ? (calcMesResumen.totals.aguaComun || 0) : 0) || 0;
            sumLuzComun = Number(calcMesResumen && calcMesResumen.totals ? (calcMesResumen.totals.luzComun || 0) : 0) || 0;
        } catch(e) { sumAguaComun = 0; sumLuzComun = 0; }
        const sumCons = sumAgua + sumGas + sumLuz;
        const sumConsComun = (Calculos.round2 ? Calculos.round2(sumAguaComun + sumLuzComun) : (sumAguaComun + sumLuzComun));
        const sumRec = sumNom + sumServ + sumJard;

        const setMeta = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setMeta('meta-nomina', `${nomina.length} ítem${nomina.length===1?'':'s'} · ${Calculos.formatMoney(sumNom)}/mes`);
        setMeta('meta-servicios', `${servicios.length} ítem${servicios.length===1?'':'s'} · ${Calculos.formatMoney(sumServ)}/mes`);
        setMeta('meta-jardineria', `${jardineria.length} ítem${jardineria.length===1?'':'s'} · ${Calculos.formatMoney(sumJard)}`);
        setMeta('meta-delmes', `${gastos.length} ítem${gastos.length===1?'':'s'} · ${Calculos.formatMoney(sumDel)}`);

        // 4 cajas superiores: valores filtrados por el mes elegido
        const resumen = document.getElementById('gastos-resumen');
        if (resumen) {
            const recMes = sumRec;
            const puntMes = sumDel;
            const comunesConsumo = sumConsComun;
            // El total del mes NO incluye consumos individuales (agua/gas/luz por departamento),
            // solo recurrentes + puntuales + consumos comunes (áreas comunes prorrateados).
            const totalMes = (Calculos.round2 ? Calculos.round2(recMes + puntMes + comunesConsumo) : (recMes + puntMes + comunesConsumo));
            const comunesDetalle = [];
            if (sumAguaComun > 0.005) comunesDetalle.push(`Agua ${Calculos.formatMoney(sumAguaComun)}`);
            if (sumLuzComun > 0.005) comunesDetalle.push(`Luz ${Calculos.formatMoney(sumLuzComun)}`);
            const consComunesLabel = comunesDetalle.length
                ? `${comunesDetalle.join(' · ')} · se prorratean por coeficiente`
                : 'Sin consumos comunes (áreas comunes) en este periodo';
            resumen.innerHTML = `
                <div class="summary-item"><span class="label">Recurrentes (mes)</span><span class="value">${Calculos.formatMoney(recMes)}</span><span class="luz-status">Nómina, servicios y jardinería del periodo</span></div>
                <div class="summary-item"><span class="label">Puntuales (mes)</span><span class="value">${Calculos.formatMoney(puntMes)}</span><span class="luz-status">Gastos del mes seleccionado</span></div>
                <div class="summary-item"><span class="label">Consumos comunes (mes)</span><span class="value">${Calculos.formatMoney(comunesConsumo)}</span><span class="luz-status">${consComunesLabel}</span></div>
                <div class="summary-item summary-diff"><span class="label">Total del mes</span><span class="value">${Calculos.formatMoney(totalMes)}</span><span class="luz-status">${Calculos.getMesLabel ? Calculos.getMesLabel(mesSel) : mesSel} · incluye consumos comunes prorrateados</span></div>
            `;
        }

        const fmtFecha = (iso) => {
            if (!iso) return '—';
            const parts = String(iso).split('-');
            if (parts.length < 3) return iso;
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        };
        const finDeMes = (mes) => {
            const [y, m] = String(mes || '').split('-').map(Number);
            if (!y || !m) return '';
            const d = new Date(y, m, 0).getDate();
            return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        };

        if (nominaEl) {
            const fechaNomina = finDeMes(this.currentMes);
            const rows = nomina
                .map(p => ({ ...p, _fecha: fechaNomina }))
                .sort((a, b) => (b._fecha || '').localeCompare(a._fecha || '') || (a.nombre || '').localeCompare(b.nombre || ''));
            nominaEl.innerHTML = rows.length ? `
                <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead><tr><th>Fecha</th><th>Nombre</th><th>Rol</th><th>Periodo</th><th class="num-left">Monto</th>${canEditMes ? '<th style="text-align:right;">Acciones</th>' : ''}</tr></thead>
                    <tbody>
                        ${rows.map(p => {
                            const rol = (DB.ROLES_PERSONAL && DB.ROLES_PERSONAL[p.rol]) ? DB.ROLES_PERSONAL[p.rol].label : (p.rol || '—');
                            return `
                            <tr>
                                <td>${fmtFecha(p._fecha)}</td>
                                <td><strong>${p.nombre || 'Sin nombre'}</strong></td>
                                <td>${rol}</td>
                                <td>Mensual</td>
                                <td class="num-left">${Calculos.formatMoney(parseFloat(p.sueldoMensual)||0)}</td>
                                ${canEditMes ? `<td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-sm btn-outline btn-edit-personal-g" data-id="${p.id}" aria-label="Editar">Editar</button>
                                    <button class="btn btn-sm btn-danger btn-del-personal-g" data-id="${p.id}" aria-label="Eliminar">Eliminar</button>
                                </td>` : ''}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table></div>` : `<div class="empty-state">No hay nómina registrada.${canEditMes ? '<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-nomina">+ Agregar nómina</button></div>' : ''}</div>`;
            if (canEditMes) {
                nominaEl.querySelectorAll('.btn-edit-personal-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.openPersonalModal(p); });
                nominaEl.querySelectorAll('.btn-del-personal-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.showConfirm('Eliminar', `¿Eliminar "${p.nombre}"? Esta acción quitará el registro/gasto asociado del cálculo del periodo.`, () => { DB.deletePersonal(p.id); this.toast('Eliminado','success'); this.render(); }); });
                const ea = document.getElementById('empty-add-nomina'); if (ea) ea.onclick = () => this.openPersonalModal && this.openPersonalModal(null, 'nomina');
            }
        }

        if (servEl) {
            const rows = servicios
                .map(p => {
                    const baseMes = p.mesDesde || this.currentMes;
                    return { ...p, _fecha: finDeMes(baseMes) || finDeMes(this.currentMes) };
                })
                .sort((a, b) => (b._fecha || '').localeCompare(a._fecha || '') || (a.nombre || '').localeCompare(b.nombre || ''));
            servEl.innerHTML = rows.length ? `
                <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead><tr><th>Fecha</th><th>Nombre</th><th>Rol</th><th>Periodo</th><th class="num-left">Monto</th>${canEditMes ? '<th style="text-align:right;">Acciones</th>' : ''}</tr></thead>
                    <tbody>
                        ${rows.map(p => {
                            const periodo = (Calculos.frecuenciaLabel && Calculos.frecuenciaLabel(p.frecuencia)) || p.frecuencia || 'Mensual';
                            const monto = parseFloat(p.monto ?? p.sueldoMensual) || 0;
                            const rol = (Calculos.categoriaLabel && Calculos.categoriaLabel(p.categoria)) || p.categoria || 'Servicio';
                            return `
                            <tr>
                                <td>${fmtFecha(p._fecha)}</td>
                                <td><strong>${p.nombre || 'Sin nombre'}</strong></td>
                                <td>${rol}</td>
                                <td>${periodo}</td>
                                <td class="num-left">${Calculos.formatMoney(monto)}</td>
                                ${canEditMes ? `<td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-sm btn-outline btn-edit-serv-g" data-id="${p.id}" aria-label="Editar">Editar</button>
                                    <button class="btn btn-sm btn-danger btn-del-serv-g" data-id="${p.id}" aria-label="Eliminar">Eliminar</button>
                                </td>` : ''}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table></div>` : `<div class="empty-state">No hay servicios recurrentes.${canEditMes ? '<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-serv">+ Agregar servicio recurrente</button></div>' : ''}</div>`;
            if (canEditMes) {
                servEl.querySelectorAll('.btn-edit-serv-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.openPersonalModal(p); });
                servEl.querySelectorAll('.btn-del-serv-g').forEach(btn => btn.onclick = () => { const p = DB.getPersonalId(parseInt(btn.dataset.id)); if (p) this.showConfirm('Eliminar', `¿Eliminar "${p.nombre}"? Esta acción quitará el registro/gasto asociado del cálculo del periodo.`, () => { DB.deletePersonal(p.id); this.toast('Eliminado','success'); this.render(); }); });
                const es = document.getElementById('empty-add-serv'); if (es) es.onclick = () => this.openPersonalModal && this.openPersonalModal(null, 'servicio');
            }
        }

        if (jardEl) {
            const rowsJ = [...jardineria].sort((a,b) => (b.fecha || '').localeCompare(a.fecha || '') || (a.descripcion || '').localeCompare(b.descripcion || ''));
            jardEl.innerHTML = rowsJ.length ? `
                <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead><tr><th>Fecha</th><th>Nombre</th><th>Rol</th><th>Periodo</th><th>Estado</th><th class="num-left">Monto</th>${canEditMes ? '<th style="text-align:right;">Acciones</th>' : ''}</tr></thead>
                    <tbody>
                        ${rowsJ.map(j => {
                            const freq = (Calculos.frecuenciaLabel && Calculos.frecuenciaLabel(j.frecuencia)) || j.frecuencia || 'Único';
                            const monto = parseFloat(j.montoTotal!=null?j.montoTotal:j.monto) || 0;
                            const est = (j.estado === 'realizado') ? this._chip('Realizado','ok') : this._chip('A realizar','warn');
                            return `
                            <tr>
                                <td>${fmtFecha(j.fecha || '')}</td>
                                <td><strong>${j.descripcion || 'Jardinería'}</strong></td>
                                <td>Jardinería</td>
                                <td>${freq}</td>
                                <td>${est}</td>
                                <td class="num-left">${Calculos.formatMoney(monto)}</td>
                                ${canEditMes ? `<td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-sm btn-outline btn-edit-jard-g" data-id="${j.id}" aria-label="Editar">Editar</button>
                                    <button class="btn btn-sm btn-danger btn-del-jard-g" data-id="${j.id}" aria-label="Eliminar">Eliminar</button>
                                </td>` : ''}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table></div>` : `<div class="empty-state">No hay servicios de jardinería registrados.${canEditMes ? '<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="empty-add-jard">+ Agregar jardinería</button></div>' : ''}</div>`;
            if (canEditMes) {
                jardEl.querySelectorAll('.btn-edit-jard-g').forEach(btn => btn.onclick = () => { const j = DB.getJardineriaId ? DB.getJardineriaId(parseInt(btn.dataset.id)) : null; if (j && this.openJardineriaModal) this.openJardineriaModal(j); });
                jardEl.querySelectorAll('.btn-del-jard-g').forEach(btn => btn.onclick = () => { const j = DB.getJardineriaId ? DB.getJardineriaId(parseInt(btn.dataset.id)) : null; if (j) this.showConfirm('Eliminar', `¿Eliminar "${j.descripcion || 'registro'}"? Se quitará del listado y puede afectar totales asociados.`, () => { DB.deleteJardineria(j.id); this.toast('Eliminado','success'); this.render(); }); });
                const ej = document.getElementById('empty-add-jard'); if (ej) ej.onclick = () => this.openJardineriaModal && this.openJardineriaModal();
            }
        }

        if (mesEl) {
            const rowsG = [...gastos].sort((a,b) => (b.fecha || '').localeCompare(a.fecha || '') || (a.concepto || '').localeCompare(b.concepto || ''));
            mesEl.innerHTML = rowsG.length ? `
                <div class="deptos-table-wrap">
                <table class="deptos-table" style="width:100%;">
                    <thead><tr><th>Fecha</th><th>Nombre</th><th>Entidad</th><th>Estado</th><th class="num">Cantidad</th><th class="num-left">Monto</th>${canEditMes ? '<th style="text-align:right;">Acciones</th>' : ''}</tr></thead>
                    <tbody>
                        ${rowsG.map(g => {
                            const entidad = g.entidad || (Calculos.categoriaLabel && Calculos.categoriaLabel(g.categoria)) || g.categoria || '—';
                            const estado = g.pagado ? this._chip('Pagado','ok') : this._chip('Pendiente','warn');
                            return `
                            <tr>
                                <td>${fmtFecha(g.fecha || '')}</td>
                                <td><strong>${g.concepto || 'Gasto'}</strong></td>
                                <td>${entidad}</td>
                                <td>${estado}</td>
                                <td class="num">${(Number(g.cantidad) || 1)}</td>
                                <td class="num-left">${Calculos.formatMoney(parseFloat(g.monto)||0)}</td>
                                ${canEditMes ? `<td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-sm btn-outline btn-edit-gasto-g" data-id="${g.id}" aria-label="Editar">Editar</button>
                                    <button class="btn btn-sm btn-danger btn-del-gasto-g" data-id="${g.id}" aria-label="Eliminar">Eliminar</button>
                                </td>` : ''}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table></div>` : '<div class="empty-state">No hay gastos puntuales en este mes.</div>';
            if (canEditMes) {
                mesEl.querySelectorAll('.btn-edit-gasto-g').forEach(btn => btn.onclick = () => { const g = (DB.getGastos ? DB.getGastos() : []).find(x => x.id == btn.dataset.id); if (g && this.openGastoModal) this.openGastoModal(g); });
                mesEl.querySelectorAll('.btn-del-gasto-g').forEach(btn => btn.onclick = () => { const g = (DB.getGastos ? DB.getGastos() : []).find(x => x.id == btn.dataset.id); if (g) this.showConfirm('Eliminar', `¿Eliminar "${g.concepto}"? Se eliminará del periodo y el cálculo/semaforo se actualizará.`, () => { DB.deleteGasto(g.id); this.toast('Eliminado','success'); this.render(); }); });
            }
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
            container.innerHTML = '<p class="empty-state">No hay gastos registrados este mes. Agrega gastos recurrentes o puntuales para calcular el total a cobrar.</p>';
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
                    <td class="num"><input type="number" class="gas-fin-input" data-dept="${p.departamento}" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.001"${ro} style="width:100%;min-width:120px;max-width:180px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right;box-sizing:border-box"></td>
                    <td class="num">${consumo ? Number(consumo).toFixed(3) : '—'}</td>
                    <td class="num-left">${monto ? Calculos.formatMoney(monto) : '—'}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Dpto</th><th>Propietario</th><th class="num">Lect. anterior (m³)</th><th class="num">Lect. actual (m³)</th><th class="num">Consumo (m³)</th><th class="num-left">Monto S/</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6"><p class="empty-state">Sin departamentos registrados. Ve a Dptos para agregarlos.</p></td></tr>'}</tbody>
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
                const finRaw = input.value;
                const fin = finRaw === '' ? 0 : parseFloat(finRaw) || 0;
                if (fin < 0 || ini < 0) { this.toast('No se pudo guardar el gas: las lecturas deben ser mayores o iguales a 0. Corrige el valor e inténtalo de nuevo.', 'error'); this.render(); return; }
                if (finRaw !== '' && (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') && fin < ini) { this.toast('No se pudo guardar el gas: la lectura actual no puede ser menor que la anterior. Verifica e inténtalo de nuevo.', 'error'); this.render(); return; }
                try { DB.saveGas(this.currentMes, dept, ini, fin); } catch(e) { this.toast('No se pudo guardar la lectura de gas. Inténtalo de nuevo.', 'error'); }
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
                    <td class="num"><input type="number" class="agua-fin-input" data-dept="${p.departamento}" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.1"${ro} style="width:100%;min-width:120px;max-width:180px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right;box-sizing:border-box"></td>
                    <td class="num">${consumo ? Number(consumo).toFixed(1) : '—'}</td>
                    <td class="num-left">${monto ? Calculos.formatMoney(monto) : (factura ? Calculos.formatMoney(0) : '—')}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="deptos-table-wrap">
                <table class="deptos-table">
                    <thead><tr><th>Dpto</th><th>Propietario</th><th class="num">Lect. anterior (m³)</th><th class="num">Lect. actual (m³)</th><th class="num">Consumo</th><th class="num-left">Monto S/</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6"><p class="empty-state">Sin departamentos registrados. Ve a Dptos para agregarlos.</p></td></tr>'}</tbody>
                </table>
            </div>
        `;

        const resumen = document.getElementById('agua-resumen');
        if (resumen) {
            const info = Calculos.getAguaFacturaInfo ? Calculos.getAguaFacturaInfo(this.currentMes) : null;
            if (info) {
                const comunText = info.costoComun > 0.005
                    ? `Costo: ${Calculos.formatMoney(info.costoComun)} · se prorratea por coeficiente entre los departamentos.`
                    : 'Sin costo adicional por áreas comunes.';
                resumen.innerHTML = `
                    <div class="luz-status" style="margin:0 0 10px;">Cada departamento paga su consumo medido. La diferencia entre el consumo total del recibo y la suma de consumos medidos corresponde a <strong>áreas comunes</strong> (limpieza, jardinería, etc.) y su costo se <strong>distribuye por coeficiente</strong> entre los departamentos.</div>
                    <div class="dashboard-kpis" style="margin-bottom:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="kpi-card"><div class="kpi-label">Factura (recibo)</div><div class="kpi-value">${Calculos.formatMoney(info.total)}</div><div class="luz-status">Consumo total: ${info.consumoFactura ? info.consumoFactura.toFixed(1) + ' m³' : '—'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Departamentos (consumo medido)</div><div class="kpi-value">${info.consumoDeptos.toFixed(1)} m³</div><div class="luz-status">Costo por consumo individual: ${Calculos.formatMoney(info.costoDeptos)}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Áreas comunes</div><div class="kpi-value">${info.consumoComun.toFixed(1)} m³</div><div class="luz-status">${comunText}</div></div>
                    </div>
                `;
            } else {
                let tarifa = '—';
                if (totalConsumo > 0 && totalMonto > 0) tarifa = Calculos.formatMoney(totalMonto / totalConsumo) + '/m³';
                resumen.innerHTML = `
                    <div class="luz-status" style="margin:0 0 10px;">Ingresa la <strong>factura del agua</strong> (consumo total y montos del recibo) para calcular el costo por consumo de cada departamento y ver el consumo/costo de <strong>áreas comunes</strong>.</div>
                    <div class="dashboard-kpis" style="margin-bottom:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="kpi-card"><div class="kpi-label">Consumo medido (dptos)</div><div class="kpi-value">${totalConsumo ? totalConsumo.toFixed(1) + ' m³' : '—'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Factura del mes</div><div class="kpi-value">${factura ? (Calculos.formatMoney((Number(factura.aguaPotable)||0)+(Number(factura.alcantarillado)||0)+(Number(factura.cargoFijo)||0)+(Number(factura.igv)||0))) : 'Sin factura'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Tarifa por m³</div><div class="kpi-value">${tarifa}</div></div>
                    </div>
                `;
            }
        }

        container.querySelectorAll('.agua-fin-input').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const aguaData = DB.getAgua(this.currentMes) || {};
                const d = aguaData[dept] || {};
                const ini = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : 0;
                const finRaw = input.value;
                const fin = finRaw === '' ? 0 : parseFloat(finRaw) || 0;
                if (fin < 0 || ini < 0) { this.toast('No se pudo guardar el agua: las lecturas deben ser mayores o iguales a 0. Corrige el valor e inténtalo de nuevo.', 'error'); this.render(); return; }
                if (finRaw !== '' && (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') && fin < ini) { this.toast('No se pudo guardar el agua: la lectura actual no puede ser menor que la anterior. Verifica e inténtalo de nuevo.', 'error'); this.render(); return; }
                const info = Calculos.getAguaFacturaInfo ? Calculos.getAguaFacturaInfo(this.currentMes) : null;
                if (info && info.consumoFactura > 0) {
                    let sumaOtros = 0;
                    this.getPropietariosOrdenados().forEach(p => {
                        if (String(p.departamento) === String(dept)) return;
                        const ad = aguaData[p.departamento] || {};
                        const li = (ad.lecturaIni !== undefined && ad.lecturaIni !== null && ad.lecturaIni !== '') ? Number(ad.lecturaIni) : 0;
                        const lf = (ad.lecturaFin !== undefined && ad.lecturaFin !== null && ad.lecturaFin !== '') ? Number(ad.lecturaFin) : 0;
                        sumaOtros += Math.max(0, lf - li);
                    });
                    const consumoDepto = finRaw === '' ? 0 : Math.max(0, fin - ini);
                    const sumaTotal = sumaOtros + consumoDepto;
                    if (sumaTotal - info.consumoFactura > 0.001) {
                        const disponible = Math.max(0, info.consumoFactura - sumaOtros);
                        this.toast(`No se puede guardar: el consumo de departamentos (${sumaTotal.toFixed(1)} m³) superaría el consumo de la factura (${info.consumoFactura.toFixed(1)} m³). Disponible para este departamento: ${disponible.toFixed(1)} m³.`, 'error');
                        this.render();
                        return;
                    }
                }
                try { DB.saveAgua(this.currentMes, dept, ini, finRaw === '' ? '' : fin); } catch(e) { this.toast('No se pudo guardar la lectura de agua. Inténtalo de nuevo.', 'error'); }
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
        const propietarios = this.getPropietariosOrdenados();
        const luzData = (DB.getLuz ? DB.getLuz(this.currentMes) : {}) || {};
        const factura = DB.getFacturaLuz ? DB.getFacturaLuz(this.currentMes) : null;
        const ro = Auth.canWrite() ? '' : ' disabled';
        let totalConsumo = 0;
        let totalMonto = 0;

        const rows = propietarios.map(p => {
            const d = luzData[p.departamento] || {};
            const lecturaIni = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : '';
            const lecturaFin = (d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaFin !== '') ? Number(d.lecturaFin) : '';
            const resultado = Calculos.calcLuzDepto ? Calculos.calcLuzDepto(this.currentMes, p.departamento) : null;
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
                    <td class="num"><input type="number" class="luz-fin-input" data-dept="${p.departamento}" value="${lecturaFin === '' ? '' : lecturaFin}" step="0.1"${ro} style="width:100%;min-width:120px;max-width:180px;padding:6px 8px;border:1px solid var(--md-sys-color-outline);border-radius:6px;font:14px var(--md-sys-typescale-font);text-align:right;box-sizing:border-box"></td>
                    <td class="num">${consumo ? Number(consumo).toFixed(1) : '—'}</td>
                    <td class="num-left">${monto ? Calculos.formatMoney(monto) : (factura ? Calculos.formatMoney(0) : '—')}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <details class="consumo-lecturas-details" style="border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;background:var(--md-sys-color-surface);overflow:hidden;">
                <summary style="padding:10px 12px;cursor:pointer;font-weight:600;font-size:13px;background:var(--md-sys-color-surface-container-low);">Lecturas por departamento (opcional, para modalidad por medidor)</summary>
                <div class="deptos-table-wrap" style="border:0;border-radius:0;">
                    <table class="deptos-table">
                        <thead><tr><th>Dpto</th><th>Propietario</th><th class="num">Lect. anterior (kWh)</th><th class="num">Lect. actual (kWh)</th><th class="num">Consumo</th><th class="num-left">Monto S/</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="6"><p class="empty-state">Sin departamentos registrados. Ve a Dptos para agregarlos.</p></td></tr>'}</tbody>
                    </table>
                </div>
            </details>
        `;

        if (resumenEl) {
            const info = Calculos.getLuzFacturaInfo ? Calculos.getLuzFacturaInfo(this.currentMes) : null;
            if (info) {
                const comunText = info.costoComun > 0.005
                    ? `Costo: ${Calculos.formatMoney(info.costoComun)} · se prorratea por coeficiente entre los departamentos.`
                    : 'Sin costo adicional por áreas comunes.';
                resumenEl.innerHTML = `
                    <div class="luz-status" style="margin:0 0 10px;">Cada departamento paga su consumo medido. La diferencia entre el consumo total del recibo y la suma de consumos medidos corresponde a <strong>áreas comunes</strong> (pasillos, escaleras, iluminación común, etc.) y su costo se <strong>distribuye por coeficiente</strong> entre los departamentos.</div>
                    <div class="dashboard-kpis" style="margin-bottom:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="kpi-card"><div class="kpi-label">Factura (recibo)</div><div class="kpi-value">${Calculos.formatMoney(info.total)}</div><div class="luz-status">Consumo total: ${info.consumoFactura ? info.consumoFactura.toFixed(1) + ' kWh' : '—'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Departamentos (consumo medido)</div><div class="kpi-value">${info.consumoDeptos.toFixed(1)} kWh</div><div class="luz-status">Costo por consumo individual: ${Calculos.formatMoney(info.costoDeptos)}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Áreas comunes</div><div class="kpi-value">${info.consumoComun.toFixed(1)} kWh</div><div class="luz-status">${comunText}</div></div>
                    </div>
                `;
            } else {
                let tarifa = '—';
                if (totalConsumo > 0 && totalMonto > 0) tarifa = Calculos.formatMoney(totalMonto / totalConsumo) + '/kWh';
                resumenEl.innerHTML = `
                    <div class="luz-status" style="margin:0 0 10px;">Ingresa la <strong>factura de luz</strong> (consumo total y montos del recibo) para calcular el costo por consumo de cada departamento y ver el consumo/costo de <strong>áreas comunes</strong>.</div>
                    <div class="dashboard-kpis" style="margin-bottom:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="kpi-card"><div class="kpi-label">Consumo medido (dptos)</div><div class="kpi-value">${totalConsumo ? totalConsumo.toFixed(1) + ' kWh' : '—'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Factura del mes</div><div class="kpi-value">${factura ? Calculos.formatMoney((Number(factura.energia)||0)+(Number(factura.alumbradoPublico)||0)+(Number(factura.cargoFijo)||0)+(Number(factura.igv)||0)) : 'Sin factura'}</div></div>
                        <div class="kpi-card"><div class="kpi-label">Tarifa por kWh</div><div class="kpi-value">${tarifa}</div></div>
                    </div>
                `;
            }
        }

        container.querySelectorAll('.luz-fin-input').forEach(input => {
            input.addEventListener('change', () => {
                const dept = input.dataset.dept;
                const luzDataMes = DB.getLuz(this.currentMes) || {};
                const d = luzDataMes[dept] || {};
                const ini = (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') ? Number(d.lecturaIni) : 0;
                const finRaw = input.value;
                const fin = finRaw === '' ? 0 : parseFloat(finRaw) || 0;
                if (fin < 0 || ini < 0) { this.toast('No se pudo guardar la luz: las lecturas deben ser mayores o iguales a 0. Corrige el valor e inténtalo de nuevo.', 'error'); this.render(); return; }
                if (finRaw !== '' && (d.lecturaIni !== undefined && d.lecturaIni !== null && d.lecturaIni !== '') && fin < ini) { this.toast('No se pudo guardar la luz: la lectura actual no puede ser menor que la anterior. Verifica e inténtalo de nuevo.', 'error'); this.render(); return; }
                const info = Calculos.getLuzFacturaInfo ? Calculos.getLuzFacturaInfo(this.currentMes) : null;
                if (info && info.consumoFactura > 0) {
                    let sumaOtros = 0;
                    this.getPropietariosOrdenados().forEach(p => {
                        if (String(p.departamento) === String(dept)) return;
                        const ld = luzDataMes[p.departamento] || {};
                        const li = (ld.lecturaIni !== undefined && ld.lecturaIni !== null && ld.lecturaIni !== '') ? Number(ld.lecturaIni) : 0;
                        const lf = (ld.lecturaFin !== undefined && ld.lecturaFin !== null && ld.lecturaFin !== '') ? Number(ld.lecturaFin) : 0;
                        sumaOtros += Math.max(0, lf - li);
                    });
                    const consumoDepto = finRaw === '' ? 0 : Math.max(0, fin - ini);
                    const sumaTotal = sumaOtros + consumoDepto;
                    if (sumaTotal - info.consumoFactura > 0.001) {
                        const disponible = Math.max(0, info.consumoFactura - sumaOtros);
                        this.toast(`No se puede guardar: el consumo de departamentos (${sumaTotal.toFixed(1)} kWh) superaría el consumo de la factura (${info.consumoFactura.toFixed(1)} kWh). Disponible para este departamento: ${disponible.toFixed(1)} kWh.`, 'error');
                        this.render();
                        return;
                    }
                }
                try { DB.saveLuz(this.currentMes, dept, ini, finRaw === '' ? '' : fin); } catch(e) { this.toast('No se pudo guardar la lectura de luz. Inténtalo de nuevo.', 'error'); }
                this.render();
            });
        });
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

    _diasMoraMesLiquidado(mes, hoy = new Date()) {
        if (!mes || typeof mes !== 'string') return 0;
        const parts = mes.split('-');
        const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (!y || !m) return 0;
        // mora desde el día 15 del mes siguiente al liquidado
        const inicioMora = new Date(y, m, 15); // JS month: m (0-based next month) since liquidado m-1 -> +1 = m
        const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const diff = Math.floor((base - inicioMora) / 86400000);
        return diff > 0 ? diff : 0;
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
                prorrateoEl.innerHTML = '<p class="empty-state" style="padding:16px;">No hay departamentos cargados. Regístralos en Dptos para generar el cálculo y prorrateo del mes.</p>';
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
                                    <th>Dpto</th>
                                    <th>Titular</th>
                                    <th>m²</th>
                                    <th>Coeficiente</th>
                                    <th class="num-left">Gastos comunes</th>
                                    <th class="num-left">Consumos (agua/gas)</th>
                                    <th class="num-left">Total a pagar</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => {
                                    const titular = [r.nombre, r.apellido].filter(Boolean).join(' ').trim() || r.departamento || '—';
                                    return `
                                    <tr>
                                        <td><strong>${r.depto}</strong></td>
                                        <td>${this.esc ? this.esc(titular) : titular}</td>
                                        <td>${r.m2.toFixed(2)}</td>
                                        <td>${r.coef.toFixed(2)}%</td>
                                        <td class="num-left">${Calculos.formatMoney(r.comunes)}</td>
                                        <td class="num-left">${Calculos.formatMoney(r.consumos)}</td>
                                        <td class="num-left"><strong>${Calculos.formatMoney(r.cargo)}</strong></td>
                                    </tr>
                                `;}).join('')}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td><strong>Total</strong></td>
                                    <td></td>
                                    <td><strong>${(totals.m2||0).toFixed(2)}</strong></td>
                                    <td><strong>${(totals.coef||0).toFixed(2)}%</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.comunes)}</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.consumosInd)}</strong></td>
                                    <td class="num-left"><strong>${Calculos.formatMoney(totals.cargo)}</strong></td>
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
                            <th>Dpto</th>
                            <th class="num-left">Total</th>
                            <th class="num-left">Pagado</th>
                            <th class="num-left">Saldo</th>
                            <th>Estado</th>
                            <th>Días de mora</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            let label = 'Registrar abono';
                            let action = 'pagar';
                            if (r.cargo <= 0.01 && r.pagado <= 0.01) {
                                label = 'Sin movimientos';
                                action = 'none';
                            } else if (r.saldo <= 0.01) {
                                label = 'Ver comprobante';
                                action = 'ver';
                            }
                            const disabled = action === 'none' ? 'disabled' : '';
                            const saldoPend = Math.max(0, Number(r.saldo) || 0);
                            const diasMora = saldoPend > 0.01 ? (typeof this._diasMoraMesLiquidado === 'function' ? this._diasMoraMesLiquidado(mes) : 0) : 0;
                            return `
                                <tr>
                                    <td><strong>${r.depto}</strong></td>
                                    <td class="num-left">${Calculos.formatMoney(r.cargo)}</td>
                                    <td class="num-left">${Calculos.formatMoney(r.pagado)}</td>
                                    <td class="num-left">${Calculos.formatMoney(saldoPend)}</td>
                                    <td><span class="badge-status ${r.estadoClass}">${r.estado}</span></td>
                                    <td>${saldoPend > 0.01 ? (diasMora > 0 ? `<span style="color:var(--md-sys-color-error);font-weight:600">${diasMora}</span>` : '0') : '—'}</td>
                                    <td style="text-align:right"><button class="btn btn-sm btn-outline btn-calc-abono" data-id="${r.id}" data-action="${action}" ${disabled}>${label}</button></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                </div>
            `;
            matrizEl.querySelectorAll('.btn-calc-abono').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id);
                    const action = btn.dataset.action;
                    if (action === 'none') return;
                    if (action === 'ver') {
                        const pagos = (DB.getPagos(this.currentMes) || []).filter(pg => pg.propietarioId == id);
                        if (pagos.length) {
                            if (typeof this.openComprobanteModal === 'function') {
                                this.openComprobanteModal(id, pagos[pagos.length - 1]);
                            } else {
                                this.openPagoModal(id, 'fija', pagos[pagos.length - 1]);
                            }
                            return;
                        }
                        this.toast('No hay comprobantes registrados para este departamento en el periodo.', 'info');
                        this.openEstadoCuentaModal(id);
                        return;
                    }
                    this.openPagoModal(id, 'fija');
                });
            });
        }

        const simpl = document.getElementById('simplificacion');
        if (simpl) simpl.style.display = 'none';

        const btnCerrarMes = document.getElementById('btn-cerrar-mes');
        if (btnCerrarMes) {
            btnCerrarMes.onclick = () => this.cerrarMes();
            const cerrado = DB.isMesCerrado && DB.isMesCerrado(this.currentMes);
            const gastosPeriodo = Number((totals.totalGastosPeriodo != null ? totals.totalGastosPeriodo : (totals.comunes || 0)) || 0);
            const cuotasGeneradas = Number((totals.totalCuotasGeneradas != null ? totals.totalCuotasGeneradas : (totals.comunes || 0)) || 0);
            const pagado = Number(totals.pagado || 0);
            const pendienteCobro = Math.max(0, (Calculos.round2 ? Calculos.round2(cuotasGeneradas - pagado) : (cuotasGeneradas - pagado)));
            const diffGC = Math.abs(gastosPeriodo - cuotasGeneradas);
            if (cerrado) {
                btnCerrarMes.disabled = true;
                btnCerrarMes.textContent = 'Mes cerrado';
                btnCerrarMes.title = 'Este periodo ya fue cerrado.';
            } else if (diffGC >= 0.01) {
                btnCerrarMes.disabled = true;
                btnCerrarMes.title = 'Bloqueado: existe descuadre aritmético entre gastos y cuotas generadas.';
                btnCerrarMes.textContent = 'Cerrar mes';
            } else if (pendienteCobro >= 0.01) {
                btnCerrarMes.disabled = true;
                btnCerrarMes.title = 'Bloqueado: hay pagos pendientes por cobrar.';
                btnCerrarMes.textContent = 'Cerrar mes';
            } else {
                btnCerrarMes.disabled = false;
                btnCerrarMes.title = '';
                btnCerrarMes.textContent = 'Cerrar mes';
            }
        }
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
            'Generar boletas (preparación)',
            `Se preparará el resumen/boleta de cobro de ${Calculos.getMesLabel(this.currentMes)} para todos los departamentos según el cálculo actual. Esta acción NO envía correos ni mensajes automáticamente. ¿Deseas continuar?`,
            () => {
                try {
                    this.closeAllModals();
                    this.toast('Boletas preparadas para el mes seleccionado. Revisa Cálculo e Informes para verificarlas y compartirlas manualmente.', 'success');
                } catch (e) {
                    this.toast('No se pudieron preparar las boletas. Revisa el cálculo del mes e inténtalo de nuevo.', 'error');
                }
            }
        );
    },

    openComprobanteModal(propietarioId, pago) {
        const propietario = DB.getPropietario(propietarioId);
        if (!propietario || !pago) {
            this.toast('No se encontró el comprobante para este periodo.', 'error');
            return;
        }
        const mes = pago.mes || this.currentMes;
        const depto = propietario.departamento || '—';
        const titular = [propietario.nombre, propietario.apellido].filter(Boolean).join(' ').trim() || '—';
        const row = Calculos.calcCargoPropietarioMes ? Calculos.calcCargoPropietarioMes(mes, propietarioId) : null;
        const cargo = row ? Number(row.cargo || 0) : 0;
        const pagadoMes = row ? Number(row.pagado || 0) : 0;
        const saldo = row ? Math.max(0, Number(row.saldo || 0)) : 0;
        const alDia = saldo <= 0.01;
        const tipoLabel = pago.tipo === 'gas' ? 'Gas' : (pago.tipo === 'agua' ? 'Agua' : (pago.tipo === 'extraordinaria' ? 'Cuota extraordinaria' : 'Pago del periodo'));
        const metodo = pago.metodo ? (pago.metodo.charAt(0).toUpperCase() + pago.metodo.slice(1)) : '—';
        const periodo = Calculos.getMesLabel ? Calculos.getMesLabel(mes) : mes;
        let fechaLarga = '—';
        if (pago.fecha) {
            try { fechaLarga = new Date(pago.fecha + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }); }
            catch(e) { fechaLarga = (Calculos.formatFecha ? Calculos.formatFecha(pago.fecha) : pago.fecha); }
        }
        const horaPago = pago.hora ? String(pago.hora).slice(0,5) : '';
        const fechaHoraLarga = horaPago ? `${fechaLarga} · ${horaPago}` : fechaLarga;
        const cfg = (DB.getConfig ? DB.getConfig() : {}) || {};
        const edificio = cfg.nombre || 'Edificio';
        const montoPago = Number(pago.monto || 0);
        const comprobanteNro = `CP-${String(mes).replace('-', '')}-${String(pago.id).padStart(5, '0')}`;
        const emision = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const body = document.getElementById('comprobante-cuerpo');
        if (body) {
            body.innerHTML = `
                <div class="comprobante-receipt">
                    <div class="comprobante-header">
                        <div class="comprobante-brand">
                            <div class="kicker">${edificio}</div>
                            <h2>Comprobante de pago</h2>
                            <p class="sub">Depto. ${depto} · ${titular}</p>
                        </div>
                        <div class="comprobante-meta">
                            <span class="comprobante-badge ${alDia ? 'ok' : 'warn'}">${alDia ? 'Periodo al día' : 'Saldo pendiente'}</span>
                            <div class="comprobante-ref">N.º <strong>${comprobanteNro}</strong></div>
                            <div class="comprobante-ref">Emisión: ${emision}</div>
                        </div>
                    </div>

                    <div class="comprobante-amount">
                        <div>
                            <div class="label">Monto recibido</div>
                            <div class="value">${Calculos.formatMoney(montoPago)}</div>
                        </div>
                        <div class="hint">
                            <div><strong>${tipoLabel}</strong></div>
                            <div>${periodo}</div>
                        </div>
                    </div>

                    <div class="comprobante-section">
                        <h3>Detalle del pago</h3>
                        <div class="comprobante-grid-pro">
                            <div class="comprobante-field"><span class="label">Departamento</span><span class="val">${depto}</span></div>
                            <div class="comprobante-field"><span class="label">Titular</span><span class="val">${titular}</span></div>
                            <div class="comprobante-field"><span class="label">Periodo</span><span class="val">${periodo}</span></div>
                            <div class="comprobante-field"><span class="label">Fecha y hora de pago</span><span class="val">${fechaHoraLarga}</span></div>
                            <div class="comprobante-field"><span class="label">Concepto</span><span class="val">${tipoLabel}</span></div>
                            <div class="comprobante-field"><span class="label">Método de pago</span><span class="val">${metodo}</span></div>
                        </div>
                    </div>

                    <div class="comprobante-section" style="padding-top:8px;">
                        <h3>Resumen del periodo</h3>
                    </div>
                    <div class="comprobante-summary">
                        <table>
                            <tr><td>Total del periodo</td><td>${Calculos.formatMoney(cargo)}</td></tr>
                            <tr><td>Pagado acumulado</td><td>${Calculos.formatMoney(pagadoMes)}</td></tr>
                            <tr><td>Este pago</td><td>${Calculos.formatMoney(montoPago)}</td></tr>
                            <tr class="total ${alDia ? 'saldo-ok' : 'saldo-pendiente'}"><td>Saldo pendiente</td><td>${Calculos.formatMoney(saldo)}</td></tr>
                        </table>
                    </div>

                    <div class="comprobante-footer">
                        Comprobante emitido por el sistema para el periodo seleccionado. ${alDia ? 'El periodo no registra saldo pendiente.' : 'Queda un saldo pendiente por regularizar en este periodo.'} Este documento es un registro interno de pago.
                    </div>
                </div>
            `;
        }
        this._comprobanteActual = { propietarioId, pagoId: pago.id, mes };
        this._saveModalFocus();
        const modal = document.getElementById('modal-comprobante');
        if (modal) {
            modal.style.display = 'flex';
            const f = modal.querySelector('button, [href], input, select, textarea');
            if (f) try { f.focus(); } catch(e) {}
        }
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
            addOpt({ tipo: 'fija', gastoId: null }, ` Pago del mes (cargo calculado) — ${Calculos.getMesLabel(mes)}`);
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
        const ahora = new Date();
        const horaActual = `${String(ahora.getHours()).padStart(2,'0')}:${String(ahora.getMinutes()).padStart(2,'0')}`;
        const horaEl = document.getElementById('pago-hora');
        if (horaEl) horaEl.value = (editando && pago.hora) ? pago.hora : horaActual;
        document.getElementById('pago-metodo').value = (editando && pago.metodo) ? pago.metodo : 'efectivo';

        const moraGroup = document.getElementById('pago-mora-group');
        const moraPct = document.getElementById('pago-mora-pct');
        if (moraPct && !moraPct._boundMora) {
            moraPct.addEventListener('input', () => { if (!document.getElementById('pago-id').value) this._sugerirMontoPago(); });
            moraPct._boundMora = true;
        }
        if (moraGroup) moraGroup.style.display = (!editando && !esFijo) ? '' : 'none';
        if (moraPct && !editando) moraPct.value = moraPct.value || '5';

        if (!editando) this._sugerirMontoPago();
        this._saveModalFocus();
        document.getElementById('modal-pago').style.display = 'flex';
        const mpg = document.getElementById('modal-pago'); if (mpg) { const f = mpg.querySelector('input:not([disabled]):not([type="hidden"]), select, textarea, button'); if (f) try{f.focus();}catch(e){} }
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
                let saldoAnterior = 0;
                try {
                    const ec = Calculos.calcEstadoCuenta ? Calculos.calcEstadoCuenta(propietario.id) : null;
                    if (ec && Array.isArray(ec.filas) && ec.filas.length) {
                        // filas vienen en orden descendente; buscamos acumulado del mes inmediatamente anterior al seleccionado
                        const cron = [...ec.filas].sort((a,b) => String(a.mes).localeCompare(String(b.mes)));
                        const idx = cron.findIndex(f => f.mes === mes);
                        if (idx > 0) saldoAnterior = Number(cron[idx - 1].acumulado || 0);
                        else if (idx === -1) {
                            // mes no presente en historial: usar acumulado del último mes anterior al seleccionado
                            const prev = cron.filter(f => f.mes < mes).pop();
                            if (prev) saldoAnterior = Number(prev.acumulado || 0);
                        }
                    }
                } catch(e2) { saldoAnterior = 0; }

                const pendienteMes = row ? Math.max(0, Number(row.saldo != null ? row.saldo : (row.cargo - (row.pagado || 0))) || 0) : 0;
                const base = Number(((Calculos.round2 ? Calculos.round2(pendienteMes + saldoAnterior) : (pendienteMes + saldoAnterior))) || 0);
                let sugerido = base;
                let recargo = 0;
                const moraInfo = document.getElementById('pago-mora-info');
                const moraGroup = document.getElementById('pago-mora-group');
                const pctEl = document.getElementById('pago-mora-pct');
                const diasMora = (typeof this._diasMoraMesLiquidado === 'function') ? this._diasMoraMesLiquidado(mes) : 0;
                const pct = pctEl ? (parseFloat(String(pctEl.value).replace(',', '.')) || 0) : 5;
                const aplicaMora = diasMora > 0 && pendienteMes > 0.01;
                if (aplicaMora) {
                    recargo = Number(((Calculos.round2 ? Calculos.round2(pendienteMes * (pct / 100)) : (pendienteMes * (pct / 100)))) || 0);
                    sugerido = Number(((Calculos.round2 ? Calculos.round2(base + recargo) : (base + recargo))) || 0);
                }
                if (moraInfo) {
                    if (aplicaMora) moraInfo.textContent = `${diasMora} día(s) de mora acumulada. El recargo (${pct}%) se aplica sobre el saldo pendiente del mes liquidado.`;
                    else if (pendienteMes > 0.01) moraInfo.textContent = 'Sin mora acumulada por ahora. Si corresponde mora, se aplica el recargo predeterminado (5%) sobre el saldo pendiente del mes liquidado.';
                    else moraInfo.textContent = 'Sin saldo pendiente del mes. El recargo por mora se aplica solo cuando existe saldo pendiente con mora.';
                }
                const baseEl = document.getElementById('pago-mora-base');
                const recEl = document.getElementById('pago-mora-recargo');
                const totEl = document.getElementById('pago-mora-total');
                const pctLbl = document.getElementById('pago-mora-pct-label');
                const baseMostrar = Math.max(0, base);
                const totalMostrar = Math.max(0, sugerido);
                if (pctLbl) pctLbl.textContent = String(Number.isFinite(pct) ? pct : 5);
                if (baseEl) baseEl.textContent = Calculos.formatMoney(baseMostrar);
                if (recEl) recEl.textContent = Calculos.formatMoney(recargo);
                if (totEl) totEl.textContent = Calculos.formatMoney(totalMostrar);
                if (moraGroup) moraGroup.style.display = (!this._pagoTipoFijo) ? '' : 'none';

                if (sugerido > 0.01) {
                    monto = String(Number(sugerido.toFixed(2)));
                } else if (row && row.cargo > 0.01 && pendienteMes <= 0.01 && saldoAnterior <= 0.01) {
                    // periodo al día y sin deuda anterior: no sugerir pago adicional por defecto
                    monto = '';
                } else if (sugerido < -0.01) {
                    // saldo a favor cubre el periodo: no sugerir monto a pagar
                    monto = '';
                }
            } catch(e) {}
            if (!monto && propietario.cuotaMensual > 0) monto = String(propietario.cuotaMensual);
        } else if (tipo === 'agua') {
            const aguaR = Calculos.calcAguaDepto(mes, propietario.departamento);
            if (aguaR) monto = String(aguaR.total);
            const moraGroup = document.getElementById('pago-mora-group');
            if (moraGroup) moraGroup.style.display = 'none';
        } else if (tipo === 'gas') {
            const gasR = Calculos.calcGasDepto(mes, propietario.departamento);
            if (gasR) monto = String(gasR.total);
            const moraGroup = document.getElementById('pago-mora-group');
            if (moraGroup) moraGroup.style.display = 'none';
        } else if (tipo === 'extraordinaria') {
            const extras = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            if (extras.length > 0) {
                const propietarios = this.getPropietariosOrdenados();
                const totalCoef = propietarios.reduce((s, p) => s + p.coeficiente, 0);
                const share = extras.reduce((sum, g) => sum + Calculos._calcGastoParaPropietario(g, propietario, totalCoef, propietarios.length), 0);
                if (share > 0) monto = String(share);
            }
            const moraGroup = document.getElementById('pago-mora-group');
            if (moraGroup) moraGroup.style.display = 'none';
        }
        const montoEl = document.getElementById('pago-monto');
        if (montoEl) montoEl.value = (monto === '' || monto == null) ? '' : monto;
    },

    guardarPago() {
        const id = document.getElementById('pago-id').value;
        const propietarioId = parseInt(document.getElementById('pago-propietario-id').value);
        const mes = document.getElementById('pago-mes').value;
        let tipo = this._pagoTipoFijo;
        if (!tipo) {
            const opt = document.getElementById('pago-concepto').selectedOptions[0];
            if (!opt) {
                this.toast('No se pudo guardar el pago: selecciona el concepto que se está pagando e inténtalo de nuevo.', 'error');
                return;
            }
            tipo = JSON.parse(opt.value).tipo;
        }
        const montoRaw = document.getElementById('pago-monto').value;
        const monto = parseFloat(montoRaw);
        if (montoRaw === '' || isNaN(monto) || monto <= 0) {
            this.toast('Ingresa un monto mayor a 0 para guardar el pago.', 'error');
            const mEl = document.getElementById('pago-monto'); if (mEl) try{mEl.focus();}catch(e){}
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
        const _horaNow = new Date();
        const pago = {
            propietarioId,
            monto,
            fecha: document.getElementById('pago-fecha').value || new Date().toISOString().split('T')[0],
            hora: (document.getElementById('pago-hora') && document.getElementById('pago-hora').value) || `${String(_horaNow.getHours()).padStart(2,'0')}:${String(_horaNow.getMinutes()).padStart(2,'0')}`,
            mes,
            tipo,
            gastoId: null,
            metodo: document.getElementById('pago-metodo').value
        };
        if (id) pago.id = parseInt(id);
        try {
            DB.savePago(pago);
            document.getElementById('modal-pago').style.display = 'none';
            this._pagoTipoFijo = null;
            this.toast('Pago guardado. Los saldos y estados del mes se actualizaron.', 'success');
            this.render();
        } catch (err) {
            console.error(err);
            this.toast('No se pudo guardar el pago. Revisa los datos o tu conexión e inténtalo de nuevo (el formulario sigue abierto).', 'error');
        }
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
        this.showConfirm('Eliminar Pago', `¿Eliminar el pago de ${Calculos.formatMoney(pago.monto)} de ${nombre}? Los saldos y estados del periodo se recalcularán.`, () => {
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

        const totalGastos = (totals.totalGastosPeriodo != null ? totals.totalGastosPeriodo : (totals.gastosMes != null ? totals.gastosMes : (typeof Calculos.calcTotalGastosMes === 'function' ? Calculos.calcTotalGastosMes(mes) : gastos.reduce((s,g)=>s+(Number(g.monto)||0),0))));
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
            <div class="luz-status" style="margin-bottom:12px">Resumen del mes según cálculo unificado: gastos comunes prorrateados por coeficiente + consumos individuales de agua y gas (y gastos registrados del periodo).</div>
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
                        <thead><tr><th>Dpto</th><th>Propietario</th><th style="text-align:left">Total a pagar</th><th style="text-align:left">Pagado</th><th style="text-align:left">Saldo</th><th>Estado</th></tr></thead>
                        <tbody>${filasDeptos || '<tr><td colspan="6"><p class="empty-state">Sin departamentos registrados. Ve a Dptos para agregarlos.</p></td></tr>'}</tbody>
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
                        <tbody>${(detalleRows + extraRows) || '<tr><td colspan="4"><p class="empty-state">Sin gastos registrados este mes. Registra gastos en la sección Gastos para ver el detalle.</p></td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

};

document.addEventListener('DOMContentLoaded', () => App.init());
