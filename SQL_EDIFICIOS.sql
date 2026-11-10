-- =====================================================
-- GASTOS EDIFICIO — Migracion multi-edificio
-- Correr en SQL Editor. Es idempotente: se puede repetir.
-- Al final esta el reporte de verificacion.
-- =====================================================

-- =====================================================
-- 0) Contexto
-- Hoy todo el edificio vive en una fila de app_data (id = 1)
-- y el rol es global (usuarios.rol). Con varios edificios eso
-- filtra datos: cualquier admin/propietario lee TODAS las filas.
-- Cada fila pasa a pertenecer a un edificio y el acceso se
-- resuelve por membresia.
-- =====================================================


-- =====================================================
-- 1) Edificios
-- =====================================================
create table if not exists public.edificios (
  id serial primary key,
  nombre text not null,
  direccion text,
  activo boolean not null default true,
  publico boolean not null default true,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);


-- =====================================================
-- 2) Membresias (un usuario puede estar en varios edificios)
-- =====================================================
create table if not exists public.membresias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  edificio_id int not null references public.edificios(id) on delete cascade,
  rol text not null default 'propietario' check (rol in ('admin', 'propietario')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  departamento text,
  nombre text,
  es_owner boolean not null default false,
  creado_en timestamptz not null default now()
);

-- Un usuario, una membresia por edificio
create unique index if not exists membresias_unica_usuario_edificio
  on public.membresias (user_id, edificio_id);

-- Un solo owner por edificio
create unique index if not exists membresias_unico_owner
  on public.membresias (edificio_id) where es_owner;

create index if not exists membresias_por_edificio
  on public.membresias (edificio_id, estado);


-- =====================================================
-- 3) Invitaciones
--    Van por email: el invitado todavia no tiene user_id
--    hasta que se registra y confirma su correo.
-- =====================================================
create table if not exists public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  edificio_id int not null references public.edificios(id) on delete cascade,
  email text not null,
  rol text not null default 'admin' check (rol = 'admin'),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada', 'revocada')),
  invitado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  expira_en timestamptz default (now() + interval '30 days')
);

create index if not exists invitaciones_por_email
  on public.invitaciones (lower(email), estado);

create unique index if not exists invitaciones_unica_pendiente
  on public.invitaciones (edificio_id, lower(email)) where estado = 'pendiente';


-- =====================================================
-- 4) app_data pasa a tener una fila por edificio
--    edificio_id NO es not null a proposito: el cliente
--    anterior escribe solo {id, data} durante la transicion.
-- =====================================================
alter table public.app_data add column if not exists edificio_id int;

-- El edificio 1 es el actual: se crea antes de referenciarlo
insert into public.edificios (id, nombre, direccion)
values (1, 'Edificio Principal', '')
on conflict (id) do nothing;

update public.edificios e
set nombre = coalesce(nullif(btrim(a.data -> 'edificio' ->> 'nombre'), ''), e.nombre),
    direccion = coalesce(a.data -> 'edificio' ->> 'direccion', e.direccion)
from public.app_data a
where a.id = 1 and e.id = 1;

-- El id 1 se inserto explicito: la secuencia del serial quedo
-- atrasada y el primer edificio creado desde la app reventaria
-- con duplicate key. Sin esto, crear un edificio falla siempre.
do $$
declare s text;
begin
  s := pg_get_serial_sequence('public.edificios', 'id');
  if s is not null then
    perform setval(s, (select coalesce(max(id), 0) from public.edificios), true);
  end if;
end $$;

-- Cada fila existente queda asignada a su propio id
update public.app_data set edificio_id = id where edificio_id is null;

-- Restriccion unique (no indice parcial): la necesita el upsert
-- del cliente con ?on_conflict=edificio_id
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_data_edificio_unico'
  ) then
    alter table public.app_data
      add constraint app_data_edificio_unico unique (edificio_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_data_edificio_fk'
  ) then
    alter table public.app_data
      add constraint app_data_edificio_fk
      foreign key (edificio_id) references public.edificios(id) on delete cascade;
  end if;
end $$;

-- app_data.id necesita un default. En la base real se creo como int
-- not null SIN secuencia, y el insert de crear_edificio (que no manda
-- id, porque la fila se identifica por edificio_id) reventaba con
-- 'null value in column "id"'.
--
-- OJO: no sirve pedir la secuencia con pg_get_serial_sequence, porque
-- devuelve NULL para un int con default nextval() al que todavia no
-- se le asigno OWNED BY, y el setval de abajo se saltea en silencio
-- (la secuencia queda en 1 y el siguiente insert choca con la clave
-- primaria). Se resuelve por nombre y se deja la secuencia en manos
-- de la columna.
do $$
declare vmax bigint;
begin
  if not exists (
    select 1 from pg_class
     where relname = 'app_data_id_seq' and relnamespace = 'public'::regnamespace
  ) then
    execute 'create sequence public.app_data_id_seq as ' ||
      (select format_type(a.atttypid, a.atttypmod)
         from pg_attribute a
        where a.attrelid = 'public.app_data'::regclass
          and a.attname = 'id'
          and not a.attisdropped);
  end if;

  execute 'alter sequence public.app_data_id_seq owned by public.app_data.id';
  execute 'alter table public.app_data alter column id set default nextval(''public.app_data_id_seq'')';

  -- La secuencia tiene que quedar por encima del max existente, si no
  -- el primer edificio creado desde la app reventaria con duplicate key.
  select coalesce(max(id), 0) into vmax from public.app_data;
  perform setval('public.app_data_id_seq', vmax, true);
end $$;


-- =====================================================
-- 5) Migrar los usuarios actuales a membresias del edificio 1
--    admin/propietario -> aprobado ; pendiente -> pendiente
--    Erick queda como owner (unico por edificio)
-- =====================================================
insert into public.membresias (user_id, edificio_id, rol, estado, departamento, nombre, es_owner)
select u.id,
       1,
       case when u.rol = 'admin' then 'admin' else 'propietario' end,
       case when u.rol = 'pendiente' then 'pendiente' else 'aprobado' end,
       u.departamento,
       u.nombre,
       (lower(coalesce(u.email, '')) = 'erickdnogales@gmail.com')
from public.usuarios u
on conflict (user_id, edificio_id) do nothing;


-- =====================================================
-- 6) Funciones de acceso por edificio
--    security definer: se usan dentro de politicas RLS y
--    necesitan saltar el RLS de membresias para no recursar.
-- =====================================================
create or replace function public.es_miembro(p_ed int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membresias m
    where m.edificio_id = p_ed and m.user_id = auth.uid() and m.estado = 'aprobado'
  );
$$;

create or replace function public.es_admin(p_ed int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membresias m
    where m.edificio_id = p_ed and m.user_id = auth.uid()
      and m.estado = 'aprobado' and m.rol = 'admin'
  );
$$;

create or replace function public.es_owner(p_ed int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membresias m
    where m.edificio_id = p_ed and m.user_id = auth.uid()
      and m.estado = 'aprobado' and m.es_owner
  );
$$;

-- Puede crear edificios quien administra al menos uno
create or replace function public.es_admin_de_alguno()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membresias m
    where m.user_id = auth.uid() and m.estado = 'aprobado' and m.rol = 'admin'
  );
$$;


-- =====================================================
-- 7) Guard de escalacion
--    Solo el owner convierte miembros en admin y solo el
--    owner transfiere la propiedad del edificio.
--    Los RPC de bootstrap (crear_edificio, aceptar_invitacion)
--    activan app.bypass_escalacion para poder hacerlo.
--    Solo valida cuando el valor CAMBIA: editar el departamento
--    de un admin existente no es una escalacion.
-- =====================================================
create or replace function public.guard_escalacion_miembro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.bypass_escalacion', true), 'off') = 'on' then
    return new;
  end if;

  if new.estado = 'aprobado' and old.estado <> 'aprobado'
     and not (public.es_admin(new.edificio_id) or public.es_owner(new.edificio_id)) then
    raise exception 'Solo un admin del edificio puede aprobar miembros';
  end if;

  if new.rol = 'admin' and old.rol <> 'admin'
     and not public.es_owner(new.edificio_id) then
    raise exception 'Solo el owner del edificio puede convertir miembros en admin';
  end if;

  if new.es_owner and not old.es_owner
     and not public.es_owner(new.edificio_id) then
    raise exception 'Solo el owner actual puede transferir la propiedad del edificio';
  end if;

  return new;
end $$;

drop trigger if exists guard_escalacion_miembro on public.membresias;
create trigger guard_escalacion_miembro
  before update on public.membresias
  for each row execute function public.guard_escalacion_miembro();


-- =====================================================
-- 8) RPC: crear edificio
--    El creador queda como owner+admin y se crea la fila
--    vacia de app_data (sin datos de ejemplo heredados).
-- =====================================================
create or replace function public.crear_edificio(p_nombre text, p_direccion text default null)
returns public.edificios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ed public.edificios;
begin
  if v_user is null then
    raise exception 'No autenticado';
  end if;
  if not public.es_admin_de_alguno() then
    raise exception 'Solo un administrador puede crear edificios';
  end if;
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'El nombre del edificio es obligatorio';
  end if;

  insert into public.edificios (nombre, direccion, creado_por)
  values (btrim(p_nombre), nullif(btrim(coalesce(p_direccion, '')), ''), v_user)
  returning * into v_ed;

  perform set_config('app.bypass_escalacion', 'on', true);

  insert into public.membresias (user_id, edificio_id, rol, estado, es_owner)
  values (v_user, v_ed.id, 'admin', 'aprobado', true);

  insert into public.app_data (edificio_id, data)
  values (
    v_ed.id,
    jsonb_build_object(
      'edificio', jsonb_build_object(
        'nombre', v_ed.nombre,
        'direccion', coalesce(v_ed.direccion, ''),
        'moneda', 'S/.',
        'mesInicio', 1
      ),
      'sinDefaults', true,
      'propietarios', '[]'::jsonb,
      'gastos', '[]'::jsonb,
      'pagos', '[]'::jsonb,
      'personal', '[]'::jsonb,
      'jardineria', '[]'::jsonb,
      'aguaFacturas', '{}'::jsonb,
      'cajaChica', '{}'::jsonb,
      'cajaMes', '{}'::jsonb,
      'nextId', jsonb_build_object(
        'propietario', 1, 'gasto', 1, 'pago', 1, 'personal', 1, 'jardineria', 1
      )
    )
  );

  return v_ed;
end $$;


-- =====================================================
-- 9) RPC: postular a un edificio como propietario
-- =====================================================
create or replace function public.aplicar_a_edificio(p_edificio int, p_departamento text default null)
returns public.membresias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.membresias;
begin
  if v_user is null then
    raise exception 'No autenticado';
  end if;
  if not exists (select 1 from public.edificios e where e.id = p_edificio and e.activo and e.publico) then
    raise exception 'El edificio no está disponible';
  end if;
  if public.es_miembro(p_edificio) then
    raise exception 'Ya perteneces a este edificio';
  end if;

  insert into public.membresias (user_id, edificio_id, rol, estado, departamento)
  values (v_user, p_edificio, 'propietario', 'pendiente', nullif(btrim(coalesce(p_departamento, '')), ''))
  on conflict (user_id, edificio_id) do update
    set departamento = excluded.departamento,
        estado = 'pendiente',
        rol = 'propietario'
  returning * into v_m;

  return v_m;
end $$;


-- =====================================================
-- 10) RPC: aceptar invitacion (el invitado queda admin)
--      Son las unicas dos vias para obtener admin: crear el
--      edificio o aceptar una invitacion del owner.
-- =====================================================
create or replace function public.aceptar_invitacion(p_invitacion uuid)
returns public.membresias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitaciones;
  v_m public.membresias;
begin
  if v_user is null then
    raise exception 'No autenticado';
  end if;

  select * into v_inv
  from public.invitaciones
  where id = p_invitacion and estado = 'pendiente';
  if not found then
    raise exception 'La invitación no existe o ya no está disponible';
  end if;
  if v_inv.expira_en is not null and v_inv.expira_en < now() then
    raise exception 'La invitación expiró';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if lower(v_inv.email) <> v_email then
    raise exception 'Esta invitación es para otro correo';
  end if;

  perform set_config('app.bypass_escalacion', 'on', true);

  insert into public.membresias (user_id, edificio_id, rol, estado)
  values (v_user, v_inv.edificio_id, 'admin', 'aprobado')
  on conflict (user_id, edificio_id) do update
    set rol = 'admin', estado = 'aprobado'
  returning * into v_m;

  update public.invitaciones set estado = 'aceptada' where id = p_invitacion;

  return v_m;
end $$;


-- =====================================================
-- 10b) RPC: transferir la propiedad del edificio
--       Va en un solo statement por una razon concreta: si
--       se degrada al owner actual y despues se promueve al
--       nuevo en dos updates, el guard ya no reconoce a nadie
--       como owner y el segundo update se rechaza siempre.
--       Solo se puede transferir a un admin aprobado.
-- =====================================================
create or replace function public.transferir_owner(p_edificio int, p_nuevo_user uuid)
returns public.membresias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_nuevo public.membresias;
begin
  if v_user is null then
    raise exception 'No autenticado';
  end if;
  if not public.es_owner(p_edificio) then
    raise exception 'Solo el owner actual puede transferir la propiedad del edificio';
  end if;

  select * into v_nuevo
  from public.membresias
  where user_id = p_nuevo_user
    and edificio_id = p_edificio
    and estado = 'aprobado'
    and rol = 'admin';
  if not found then
    raise exception 'El nuevo owner debe ser un admin aprobado de este edificio';
  end if;

  perform set_config('app.bypass_escalacion', 'on', true);

  update public.membresias set es_owner = false
   where edificio_id = p_edificio and es_owner;

  update public.membresias set es_owner = true where id = v_nuevo.id;

  return v_nuevo;
end $$;


-- =====================================================
-- 11) RPC: roster del edificio (solo admins)
--      Cruza usuarios para mostrar nombre/email sin abrir
--      la lectura de la tabla usuarios a todo el mundo.
-- =====================================================
create or replace function public.listar_miembros(p_edificio int)
returns table (
  membresia_id uuid,
  user_id uuid,
  email text,
  nombre text,
  departamento text,
  rol text,
  estado text,
  es_owner boolean,
  creado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.es_admin(p_edificio) or public.es_owner(p_edificio)) then
    raise exception 'Solo un admin del edificio puede ver sus miembros';
  end if;

  return query
    select m.id,
           m.user_id,
           coalesce(u.email, ''),
           coalesce(nullif(btrim(m.nombre), ''), nullif(btrim(u.nombre), ''), ''),
           m.departamento,
           m.rol,
           m.estado,
           m.es_owner,
           m.creado_en
    from public.membresias m
    left join public.usuarios u on u.id = m.user_id
    where m.edificio_id = p_edificio
    order by (m.estado = 'pendiente') desc, m.creado_en asc;
end $$;


-- =====================================================
-- 12) Permisos
--     Grants explicitos: el cliente (PostgREST con la key
--     publicable) necesita estos permisos sobre las tablas
--     nuevas y sobre los RPC. El RLS decide el alcance.
-- =====================================================
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.edificios, public.membresias, public.invitaciones, public.app_data
  to authenticated;

grant select on public.usuarios to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.crear_edificio(text, text) to authenticated;
grant execute on function public.aplicar_a_edificio(int, text) to authenticated;
grant execute on function public.aceptar_invitacion(uuid) to authenticated;
grant execute on function public.transferir_owner(int, uuid) to authenticated;
grant execute on function public.listar_miembros(int) to authenticated;
grant execute on function public.es_miembro(int) to authenticated;
grant execute on function public.es_admin(int) to authenticated;
grant execute on function public.es_owner(int) to authenticated;


-- =====================================================
-- 13) RLS: datos por edificio
--     Reemplaza las politicas globales (is_admin), que
--     permitian leer y escribir todas las filas.
--     coalesce deja accesibles las filas legacy.
-- =====================================================
alter table public.app_data enable row level security;

drop policy if exists "leer aprobados" on public.app_data;
drop policy if exists "insertar solo admin" on public.app_data;
drop policy if exists "actualizar solo admin" on public.app_data;

-- Los drop de los nombres nuevos hacen que la migracion se pueda
-- repetir sin fallar por "policy already exists"
drop policy if exists "app_data leer miembros" on public.app_data;
drop policy if exists "app_data insertar admin" on public.app_data;
drop policy if exists "app_data actualizar admin" on public.app_data;
drop policy if exists "app_data borrar owner" on public.app_data;

create policy "app_data leer miembros" on public.app_data
  for select using (public.es_miembro(coalesce(edificio_id, id)));

create policy "app_data insertar admin" on public.app_data
  for insert with check (public.es_admin(edificio_id));

create policy "app_data actualizar admin" on public.app_data
  for update
  using (public.es_admin(coalesce(edificio_id, id)))
  with check (public.es_admin(edificio_id));

create policy "app_data borrar owner" on public.app_data
  for delete using (public.es_owner(coalesce(edificio_id, id)));


-- =====================================================
-- 14) RLS: edificios
--     publico y activo -> visible para pedir acceso
-- =====================================================
alter table public.edificios enable row level security;

drop policy if exists "ver edificios" on public.edificios;
create policy "ver edificios" on public.edificios
  for select using (
    (activo and publico)
    or public.es_miembro(id)
    or public.es_admin(id)
  );


-- =====================================================
-- 15) RLS: membresias
-- =====================================================
alter table public.membresias enable row level security;

drop policy if exists "ver membresias" on public.membresias;
create policy "ver membresias" on public.membresias
  for select using (
    user_id = auth.uid()
    or public.es_admin(edificio_id)
    or public.es_owner(edificio_id)
  );

drop policy if exists "postular a edificio" on public.membresias;
create policy "postular a edificio" on public.membresias
  for insert with check (
    user_id = auth.uid()
    and rol = 'propietario'
    and estado = 'pendiente'
    and es_owner = false
  );

drop policy if exists "gestionar membresias" on public.membresias;
create policy "gestionar membresias" on public.membresias
  for update using (public.es_admin(edificio_id))
  with check (public.es_admin(edificio_id) or public.es_owner(edificio_id));

drop policy if exists "eliminar membresias" on public.membresias;
create policy "eliminar membresias" on public.membresias
  for delete using (public.es_owner(edificio_id));


-- =====================================================
-- 16) RLS: invitaciones
--     El invitado ve las suyas por correo; admin/owner gestionan
-- =====================================================
alter table public.invitaciones enable row level security;

drop policy if exists "ver invitaciones" on public.invitaciones;
create policy "ver invitaciones" on public.invitaciones
  for select using (
    public.es_admin(edificio_id)
    or public.es_owner(edificio_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "gestionar invitaciones" on public.invitaciones;
create policy "gestionar invitaciones" on public.invitaciones
  for all
  using (public.es_admin(edificio_id) or public.es_owner(edificio_id))
  with check (public.es_admin(edificio_id) or public.es_owner(edificio_id));


-- =====================================================
-- 17) Reporte de verificacion
-- =====================================================
select 'edificios' as tabla, count(*) as filas from public.edificios
union all select 'membresias', count(*) from public.membresias
union all select 'invitaciones', count(*) from public.invitaciones
union all select 'app_data', count(*) from public.app_data;

-- Membresias por usuario
select u.email, m.edificio_id, m.rol, m.estado, m.es_owner
from public.membresias m
left join public.usuarios u on u.id = m.user_id
order by m.edificio_id, m.rol, u.email;

-- app_data: una fila por edificio
select id, edificio_id, updated_at from public.app_data order by id;
