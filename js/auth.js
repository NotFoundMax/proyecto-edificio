const Auth = {
    supabase: null,
    session: null,
    user: null,
    perfil: null,
    membresias: [],
    edificios: [],
    edificiosPublicos: [],
    invitaciones: [],
    edificioActivo: null,

    init() {
        this.supabase = window.supabase.createClient(
            APP_CONFIG.supabaseUrl,
            APP_CONFIG.supabaseAnonKey,
            { auth: { persistSession: true, autoRefreshToken: true } }
        );
        // Mantiene el token vivo: sin esto, los pushes de StorageEngine
        // empiezan a fallar cuando expira la sesion.
        this.supabase.auth.onAuthStateChange((_evento, session) => {
            this.session = session;
            this.user = session ? session.user : null;
        });
    },

    async getSession() {
        const { data } = await this.supabase.auth.getSession();
        this.session = data.session || null;
        return this.session;
    },

    async getUser() {
        const { data } = await this.supabase.auth.getUser();
        this.user = data.user || null;
        return this.user;
    },

    async login(email, password) {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.session = data.session;
        return data.session;
    },

    async signup(email, password) {
        const { data, error } = await this.supabase.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    async resetPassword(email) {
        const { error } = await this.supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
    },

    async logout() {
        await this.supabase.auth.signOut();
        this.session = null;
        this.user = null;
        this.perfil = null;
        this.membresias = [];
        this.edificios = [];
        this.edificiosPublicos = [];
        this.invitaciones = [];
        this.edificioActivo = null;
    },

    // Perfil global: solo nombre y email para mostrar. El rol ya
    // no vive aca, vive en la membresia de cada edificio.
    async getPerfil() {
        const user = await this.getUser();
        if (!user) return null;
        const { data } = await this.supabase
            .from('usuarios')
            .select('id, email, nombre, creado_en')
            .eq('id', user.id)
            .maybeSingle();
        this.perfil = data || { id: user.id, email: user.email, nombre: null };
        return this.perfil;
    },

    async getMembresias() {
        const user = await this.getUser();
        if (!user) return (this.membresias = []);
        // Filtra por user_id: la policy deja ver tambien los miembros de
        // los edificios que administra, y aca solo queremos las propias.
        const { data, error } = await this.supabase
            .from('membresias')
            .select('id, edificio_id, rol, estado, departamento, nombre, es_owner')
            .eq('user_id', user.id)
            .order('edificio_id', { ascending: true });
        if (error) throw error;
        this.membresias = data || [];
        return this.membresias;
    },

    // Edificios que el usuario puede ver: los publicos mas los suyos.
    // La RLS ya restringe el select, asi que no hace falta filtrar aca.
    async getEdificiosVisibles() {
        const { data, error } = await this.supabase
            .from('edificios')
            .select('id, nombre, direccion, activo, publico')
            .order('nombre', { ascending: true });
        if (error) throw error;
        this.edificios = data || [];
        return this.edificios;
    },

    async getEdificiosPublicos() {
        const { data, error } = await this.supabase
            .from('edificios')
            .select('id, nombre, direccion')
            .eq('activo', true)
            .eq('publico', true)
            .order('nombre', { ascending: true });
        if (error) throw error;
        this.edificiosPublicos = data || [];
        return this.edificiosPublicos;
    },

    async getInvitaciones() {
        const { data, error } = await this.supabase
            .from('invitaciones')
            .select('id, edificio_id, email, estado, expira_en')
            .eq('estado', 'pendiente');
        if (error) throw error;
        this.invitaciones = data || [];
        return this.invitaciones;
    },

    // === Edificio activo ===
    setEdificioActivo(id) {
        this.edificioActivo = id;
        StorageEngine.setEdificioId(id);
    },

    membresiaDe(edificioId) {
        return this.membresias.find(m => m.edificio_id === edificioId) || null;
    },

    esMiembroAprobado(edificioId) {
        const m = this.membresiaDe(edificioId);
        return !!(m && m.estado === 'aprobado');
    },

    esAdminDe(edificioId) {
        const m = this.membresiaDe(edificioId);
        return !!(m && m.estado === 'aprobado' && m.rol === 'admin');
    },

    esOwnerDe(edificioId) {
        const m = this.membresiaDe(edificioId);
        return !!(m && m.estado === 'aprobado' && m.es_owner);
    },

    miembrosAprobados() {
        return this.membresias.filter(m => m.estado === 'aprobado');
    },

    miembrosPendientes() {
        return this.membresias.filter(m => m.estado === 'pendiente');
    },

    esAdminDeAlguno() {
        return this.membresias.some(m => m.estado === 'aprobado' && m.rol === 'admin');
    },

    puedeEscribir() {
        return this.edificioActivo ? this.esAdminDe(this.edificioActivo) : false;
    },

    esPropietario() {
        return !this.puedeEscribir();
    },

    // Se mantiene por compatibilidad con los callers existentes:
    // el permiso de escritura es por edificio activo, no global.
    canWrite() {
        return this.puedeEscribir();
    },

    nombre() {
        const p = this.perfil || {};
        if (p.nombre) return p.nombre;
        const email = p.email || (this.user && this.user.email) || '';
        return email ? email.split('@')[0] : '';
    },

    // === Acciones ===
    async crearEdificio(nombre, direccion) {
        return await this.supabase.rpc('crear_edificio', {
            p_nombre: nombre,
            p_direccion: direccion || null
        });
    },

    async aplicarAEdificio(edificioId, departamento) {
        return await this.supabase.rpc('aplicar_a_edificio', {
            p_edificio: edificioId,
            p_departamento: departamento || null
        });
    },

    async aceptarInvitacion(invitacionId) {
        return await this.supabase.rpc('aceptar_invitacion', {
            p_invitacion: invitacionId
        });
    },

    async transferirOwner(edificioId, nuevoUserId) {
        return await this.supabase.rpc('transferir_owner', {
            p_edificio: edificioId,
            p_nuevo_user: nuevoUserId
        });
    },

    async listarMiembros(edificioId) {
        const { data, error } = await this.supabase.rpc('listar_miembros', {
            p_edificio: edificioId
        });
        if (error) throw error;
        return data || [];
    },

    async crearInvitacion(email, edificioId) {
        const user = await this.getUser();
        return await this.supabase
            .from('invitaciones')
            .insert({
                edificio_id: edificioId || this.edificioActivo,
                email: email.trim().toLowerCase(),
                invitado_por: user ? user.id : null
            })
            .select('id, edificio_id, email, estado, expira_en')
            .single();
    },

    async revocarInvitacion(invitacionId) {
        const { error } = await this.supabase
            .from('invitaciones')
            .update({ estado: 'revocada' })
            .eq('id', invitacionId);
        if (error) throw error;
    },

    async actualizarMiembro(membresiaId, cambios) {
        const { data, error } = await this.supabase
            .from('membresias')
            .update(cambios)
            .eq('id', membresiaId)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminarMiembro(membresiaId) {
        const { error } = await this.supabase
            .from('membresias')
            .delete()
            .eq('id', membresiaId);
        if (error) throw error;
    },

    async actualizarInvitacionesInvitado() {
        return await this.getInvitaciones();
    }
};
