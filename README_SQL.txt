-- =====================================================
-- GASTOS EDIFICIO — Setup completo de auth y roles
-- Correr en SQL Editor (es idempotente, se puede repetir)
-- =====================================================

-- 1) Tabla de perfiles (rol inicial: pendiente)
create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'pendiente' check (rol in ('admin','propietario','pendiente')),
  departamento text,
  creado_en timestamptz default now()
);

-- 2) Funcion is_admin() (security definer: evita recursion RLS)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin');
$$;

-- 3) Trigger: todo usuario nuevo de Auth -> rol pendiente
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, rol) values (new.id, 'pendiente')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) RLS sobre los datos (app_data)
alter table public.app_data enable row level security;

drop policy if exists "leer aprobados" on public.app_data;
create policy "leer aprobados" on public.app_data
  for select using (
    exists (select 1 from public.usuarios u
      where u.id = auth.uid() and u.rol in ('admin','propietario'))
  );

drop policy if exists "insertar solo admin" on public.app_data;
create policy "insertar solo admin" on public.app_data
  for insert with check (public.is_admin());

drop policy if exists "actualizar solo admin" on public.app_data;
create policy "actualizar solo admin" on public.app_data
  for update using (public.is_admin());

-- 5) RLS sobre perfiles
alter table public.usuarios enable row level security;

drop policy if exists "ver propio o admin" on public.usuarios;
create policy "ver propio o admin" on public.usuarios
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "admin actualiza" on public.usuarios;
create policy "admin actualiza" on public.usuarios
  for update using (public.is_admin());

-- 6) Promover al admin existente
insert into public.usuarios (id, rol)
select id, 'admin' from auth.users where email = 'erickdnogales@gmail.com'
on conflict (id) do update set rol = 'admin';

-- =====================================================
-- PASO 2 — Migration: email en usuarios (correr DESPUÉS del paso 1)
-- =====================================================
alter table public.usuarios add column if not exists email text;

update public.usuarios u
set email = (select au.email from auth.users au where au.id = u.id)
where u.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, rol, email) values (new.id, 'pendiente', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

insert into public.usuarios (id, rol, email)
select au.id, 'admin', au.email from auth.users au
where au.email in ('erickdnogales@gmail.com', 'margeorygertrud18@gmail.com')
on conflict (id) do update set rol = 'admin', email = excluded.email;

-- =====================================================
-- PASO 3 - Nombres visibles en el header
-- =====================================================
alter table public.usuarios add column if not exists nombre text;

update public.usuarios
set nombre = 'Erick'
where email = 'erickdnogales@gmail.com' and (nombre is null or nombre = '');

update public.usuarios
set nombre = 'Margeory'
where email = 'margeorygertrud18@gmail.com' and (nombre is null or nombre = '');
