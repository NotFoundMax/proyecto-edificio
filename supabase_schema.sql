-- ============================================================
-- Esquema SQL para "Los Castaños 104" — Supabase
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Tabla de perfiles (roles)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'propietario')),
  nombre TEXT,
  departamento TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla de departamentos
CREATE TABLE IF NOT EXISTS departamentos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  m2 NUMERIC(8,2) NOT NULL,
  coeficiente NUMERIC(6,2) NOT NULL,
  propietario_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Datos iniciales (5 departamentos, total 1040.98 m²)
INSERT INTO departamentos (nombre, m2, coeficiente) VALUES
  ('101', 141.29, 13.57),
  ('201', 202.72, 19.47),
  ('301', 200.56, 19.27),
  ('401', 150.51, 14.46),
  ('501', 345.90, 33.23)
ON CONFLICT (nombre) DO NOTHING;

-- 3. Tabla de gastos
CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  mes TEXT NOT NULL, -- formato YYYY-MM
  concepto TEXT NOT NULL,
  monto NUMERIC(10,2) NOT NULL,
  categoria TEXT NOT NULL,
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('mensual','trimestral','semestral','anual','unico','extraordinario')),
  pagado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabla de consumo de agua
CREATE TABLE IF NOT EXISTS agua_consumo (
  id SERIAL PRIMARY KEY,
  mes TEXT NOT NULL,
  departamento_id INT REFERENCES departamentos(id),
  consumo_m3 NUMERIC(8,2) NOT NULL DEFAULT 0,
  monto NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mes, departamento_id)
);

-- 5. Tabla de cuotas (prorrateo)
CREATE TABLE IF NOT EXISTS cuotas (
  id SERIAL PRIMARY KEY,
  mes TEXT NOT NULL,
  departamento_id INT REFERENCES departamentos(id),
  gasto_comun NUMERIC(10,2) NOT NULL,
  consumo_agua NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','parcial')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mes, departamento_id)
);

-- 6. Tabla de pagos
CREATE TABLE IF NOT EXISTS pagos (
  id SERIAL PRIMARY KEY,
  mes TEXT NOT NULL,
  departamento_id INT REFERENCES departamentos(id),
  monto NUMERIC(10,2) NOT NULL,
  fecha TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Tabla de caja chica
CREATE TABLE IF NOT EXISTS caja_chica (
  id SERIAL PRIMARY KEY,
  mes TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  concepto TEXT NOT NULL,
  monto NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Tabla de meses (estado de cierre)
CREATE TABLE IF NOT EXISTS meses (
  mes TEXT PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  total_gastos NUMERIC(10,2) DEFAULT 0,
  total_cuotas NUMERIC(10,2) DEFAULT 0,
  total_pagos NUMERIC(10,2) DEFAULT 0,
  cerrado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agua_consumo ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_chica ENABLE ROW LEVEL SECURITY;
ALTER TABLE meses ENABLE ROW LEVEL SECURITY;

-- Función helper: es admin?
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles: cada usuario ve su propio perfil; admin ve todos
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (auth.uid() = id OR is_admin());
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (auth.uid() = id OR is_admin());

-- Departamentos: todos leen; solo admin modifica
CREATE POLICY "departamentos_select" ON departamentos
  FOR SELECT USING (true);
CREATE POLICY "departamentos_admin" ON departamentos
  FOR ALL USING (is_admin());

-- Gastos: todos leen; solo admin modifica
CREATE POLICY "gastos_select" ON gastos
  FOR SELECT USING (true);
CREATE POLICY "gastos_admin" ON gastos
  FOR ALL USING (is_admin());

-- Agua: todos leen; solo admin modifica
CREATE POLICY "agua_select" ON agua_consumo
  FOR SELECT USING (true);
CREATE POLICY "agua_admin" ON agua_consumo
  FOR ALL USING (is_admin());

-- Cuotas: propietario ve solo las suyas; admin ve todas
CREATE POLICY "cuotas_select" ON cuotas
  FOR SELECT USING (
    is_admin() OR
    departamento_id IN (SELECT id FROM departamentos WHERE propietario_id = auth.uid())
  );
CREATE POLICY "cuotas_admin" ON cuotas
  FOR ALL USING (is_admin());

-- Pagos: propietario ve solo los suyos; admin ve todos
CREATE POLICY "pagos_select" ON pagos
  FOR SELECT USING (
    is_admin() OR
    departamento_id IN (SELECT id FROM departamentos WHERE propietario_id = auth.uid())
  );
CREATE POLICY "pagos_admin" ON pagos
  FOR ALL USING (is_admin());

-- Caja chica: todos leen; solo admin modifica
CREATE POLICY "caja_select" ON caja_chica
  FOR SELECT USING (true);
CREATE POLICY "caja_admin" ON caja_chica
  FOR ALL USING (is_admin());

-- Meses: todos leen; solo admin modifica
CREATE POLICY "meses_select" ON meses
  FOR SELECT USING (true);
CREATE POLICY "meses_admin" ON meses
  FOR ALL USING (is_admin());
