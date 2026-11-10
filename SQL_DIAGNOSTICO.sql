-- Diagnostico del fix de app_data.id
-- SOLO LECTURA: no inserta, no actualiza, no borra nada.
-- Correr en el SQL Editor de Supabase y pegar la salida completa.

\echo '--- 1) Columna app_data.id (esperado: default = nextval(...)) ---'
select a.attname,
       format_type(a.atttypid, a.atttypmod) as tipo,
       a.attnotnull                        as not_null,
       pg_get_expr(d.adbin, d.adrelid)     as default_actual
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attrelid = 'public.app_data'::regclass
   and a.attname = 'id'
   and not a.attisdropped;

\echo '--- 2) La secuencia existe? (si no hay filas: NO EXISTE) ---'
select c.relname, c.relkind::text as tipo_rel
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relname = 'app_data_id_seq'
   and n.nspname = 'public';

\echo '--- 3) pg_get_serial_sequence (NULL = sin OWNED BY, el setval se salta) ---'
select pg_get_serial_sequence('public.app_data', 'id') as secuencia_detectada;

\echo '--- 4) Estado de la secuencia (proximo id vs max id) ---'
select (select last_value from public.app_data_id_seq)                                   as ultimo_valor,
       (select is_called  from public.app_data_id_seq)                                   as consumida,
       (select last_value from public.app_data_id_seq)
         + (case when (select is_called from public.app_data_id_seq) then 1 else 0 end)   as proximo_id,
       (select max(id) from public.app_data)                                              as max_id_actual,
       (select count(*) from public.app_data)                                             as filas;

\echo '--- 5) UNIQUE en edificio_id (necesario para el upsert del cliente) ---'
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.app_data'::regclass;

\echo '--- 6) Edificios sin fila en app_data (restos del intento fallido) ---'
select e.id, e.nombre
  from public.edificios e
  left join public.app_data a on a.edificio_id = e.id
 where a.id is null;

\echo '--- 7) Version de crear_edificio instalada en produccion ---'
select pg_get_functiondef('public.crear_edificio(text,text)'::regprocedure);

\echo '--- 8) Edificios y sus app_data ---'
select e.id, e.nombre, a.id as app_data_id, a.edificio_id
  from public.edificios e
  left join public.app_data a on a.edificio_id = e.id
 order by e.id;
