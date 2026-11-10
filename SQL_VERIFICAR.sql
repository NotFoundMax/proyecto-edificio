-- Verificacion post-migracion
select 'tablas nuevas' as check,
       string_agg(table_name, ', ' order by table_name) as resultado
from information_schema.tables
where table_schema='public' and table_name in ('edificios','membresias','invitaciones')
union all
select 'edificios seed', coalesce(string_agg(id || ': ' || nombre, ', '), 'NINGUNO') from public.edificios
union all
select 'app_data filas', count(*)::text || ' (fila id=1 -> edificio_id=' || coalesce(max(case when id=1 then edificio_id::text end),'?') || ')' from public.app_data
union all
select 'membresias seed', count(*)::text from public.membresias
union all
select 'policies app_data nuevas', count(*)::text from pg_policies
  where schemaname='public' and tablename='app_data' and policyname like 'app_data %'
union all
select 'policies app_data viejas (0 = ok)', count(*)::text from pg_policies
  where schemaname='public' and tablename='app_data'
    and policyname in ('leer aprobados','insertar solo admin','actualizar solo admin')
union all
select 'funciones multi-edificio (9 = ok)', count(*)::text from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('es_miembro','es_admin','es_owner','es_admin_de_alguno','crear_edificio',
     'aplicar_a_edificio','aceptar_invitacion','transferir_owner','listar_miembros')
union all
select 'columna edificio_id', case when exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='app_data' and column_name='edificio_id')
  then 'presente' else 'FALTA' end;