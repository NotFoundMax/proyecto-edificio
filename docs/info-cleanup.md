# Limpieza de información (Fase 4)

Matriz "visible por defecto vs plegado" por pantalla.

| Pantalla | Visible por defecto | Plegado/oculto |
|---|---|---|
| Dashboard | mes, 3 summary cards, cuota por depto | caja chica, extra-info, cerrar mes, FAB |
| Gastos | lista, filtros básicos, totales | recibo de luz card |
| Gas | mes, lista | parámetros (precio, kg, kg/m³, balones) |
| Servicios | personal, jardinería | hints descriptivos |
| Config | miembros activos | solicitudes, invitaciones, crear edificio |
| Cálculo | detalle por depto | simplificar deudas (hasta generar) |
| Informes | preview | export buttons (secundarios) |

Regla: primordial primero; secundario en `<details>`/accordion o menú overflow. Implementación progresiva en Fase 5.