-- Como quedo el seed de roles del edificio 1
select e.id       as edificio,
       e.nombre,
       u.email,
       m.rol,
       m.estado,
       m.es_owner,
       coalesce(m.departamento, '-') as depto
from public.edificios e
left join public.membresias m on m.edificio_id = e.id
left join public.usuarios u on u.id = m.user_id
order by e.id, m.es_owner desc nulls last, m.rol, u.email;