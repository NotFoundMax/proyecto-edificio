-- Arreglo puntual: app_data.id sin secuencia ni default.
-- Son 3 cambios y una verificacion. No depende del resto de la migracion.
--
-- Por que falla: app_data.id es integer NOT NULL y la fila se identifica
-- por edificio_id, asi que el INSERT no manda id. Sin default, Postgres
-- lo completa con NULL y revienta con 23502.

do $$
declare
  vmax bigint;
begin
  if not exists (
    select 1 from pg_class
     where relname = 'app_data_id_seq'
       and relnamespace = 'public'::regnamespace
  ) then
    execute 'create sequence public.app_data_id_seq';
  end if;

  -- OWNED BY hace que pg_get_serial_sequence la encuentre en el futuro.
  execute 'alter sequence public.app_data_id_seq owned by public.app_data.id';
  execute 'alter table public.app_data alter column id set default nextval(''public.app_data_id_seq'')';

  -- La secuencia tiene que quedar por encima del max existente.
  select coalesce(max(id), 0) into vmax from public.app_data;
  perform setval('public.app_data_id_seq', vmax, true);
end $$;

-- === VERIFICACION ===
-- 1) tiene que decir: integer | NO | nextval('app_data_id_seq'::regclass)
select data_type,
       is_nullable,
       column_default
  from information_schema.columns
 where table_name = 'app_data'
   and column_name = 'id';

-- 2) tiene que devolver public.app_data_id_seq
select pg_get_serial_sequence('public.app_data', 'id') as secuencia;

-- 3) proximo_id TIENE QUE SER mayor que max_id_actual. Si son iguales,
--    el proximo edificio choca con duplicate key.
select (select last_value from public.app_data_id_seq)
         + (case when (select is_called from public.app_data_id_seq) then 1 else 0 end) as proximo_id,
       (select max(id) from public.app_data) as max_id_actual;

-- 4) edificios huerfanos del intento fallido (0 = limpio).
-- Va en plpgsql porque si public.edificios todavia no existe, un SELECT
-- normal aborta todo el script y se pierde la lectura de las consultas
-- anteriores.
do $$
declare
  r record;
  n int := 0;
begin
  if to_regclass('public.edificios') is null then
    raise notice 'public.edificios no existe todavia: se omite la busqueda de huerfanos';
    return;
  end if;
  for r in
    select e.id, e.nombre
      from public.edificios e
      left join public.app_data a on a.edificio_id = e.id
     where a.id is null
  loop
    n := n + 1;
    raise notice 'HUERFANO: edificio id=% sin fila en app_data (%)', r.id, r.nombre;
  end loop;
  if n = 0 then
    raise notice 'OK: ningun edificio sin fila en app_data';
  end if;
end $$;
