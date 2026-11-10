# Auditoría UX/UI — proyecto-edificio (Fase 0)

## Pantallas (12) + modales (9)

| # | Pantalla | Rol principal | Info primordial | Info secundaria / plegable |
|---|---|---|---|---|
| 1 | Login | ambos | email, password, submit | toggle signup, forgot password |
| 2 | Pendiente | propietario | mensaje de espera | — |
| 3 | Acceso | propietario | invitaciones, edificios públicos | crear edificio (admin) |
| 4 | Edificios | ambos | lista de edificios aprobados, entrar | crear edificio (admin) |
| 5 | Dashboard | admin | mes, 3 summary cards, cuota por depto | caja chica, extra-info, cerrar mes, FAB gasto |
| 6 | Propietarios | admin | lista deptos, agregar | coeficientes info |
| 7 | Gastos | admin | lista gastos, filtros, totales | recibo de luz (card) |
| 8 | Gas | admin | mes, params, lista | 4 params inline (precio, kg, kg/m³, balones) |
| 9 | Agua | admin | mes, lista | botón factura |
| 10 | Servicios | admin | personal, jardinería | hints descriptivos |
| 11 | Cálculo | admin | detalle por depto | simplificar deudas (oculto hasta generar) |
| 12 | Informes | admin | preview | export pdf/excel |
| 13 | Config | admin | miembros, solicitudes, invitaciones | crear edificio, selector edificio |

## Modales
propietario, estado de cuenta, pago, gasto, personal, jardinería, agua-fórmula, confirm.

## Ruido detectado (candidatos a plegar/ocultar)
- Dashboard: caja chica + extra-info + cerrar mes siempre visibles → accordion "Más".
- Gas: 4 inputs de parámetros siempre inline → colapsable "Parámetros".
- Gastos: recibo de luz card siempre visible → plegable.
- Servicios: hints largos siempre visibles → tooltip/expandir.
- Config: solicitudes e invitaciones → tabs o secciones colapsables.
- Modales grandes (personal, agua-fórmula) → dividir en secciones plegables.

## Información primordial por rol
- Admin (desktop): métricas, listas, acciones de gestión.
- Propietario (mobile): su estado de cuenta, saldo acumulado, pagos, cuota mensual.

## Próximo: Fase 1 — Design System (tokens + dark mode).