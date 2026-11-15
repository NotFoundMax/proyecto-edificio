# Sprint 1 — Verificación frontend (heurísticas de Nielsen)

## 0. Estado de ejecución Playwright autenticada
- Script: `eval_nielsen_auth.py`
- Requisitos: servidor activo (`http://localhost:8080/`, `python3 -m http.server 8080 --directory www`), Playwright/Chromium disponibles.
- Ejecución (credenciales solo en entorno local, no compartir):
  ```bash
  EVAL_EMAIL="usuario" EVAL_PASSWORD="clave" /home/max/lab-docs/.venv/bin/python eval_nielsen_auth.py
  ```
- Salida esperada: `/tmp/nielsen-eval-auth/result.json` + capturas de login, post-login, inicio, dashboard, departamentos, estado de cuenta, gastos (recurrentes/del mes/consumos agua-gas-luz), cálculo, informes, móvil.
- **Nota de la corrida previa:** generó capturas hasta `06f-consumo-luz.png` pero no `result.json` ni pantallas finales (Cálculo, Informes, móvil), lo que sugiere interrupción/fallo antes de finalizar. Reejecutar y revisar la salida de consola; el script debe completarse y escribir `result.json` aunque haya errores parciales.

## 1. Checklist de verificación (Sprint 1)

### 0.2 Carga y consola
- [ ] Carga inicial sin errores 404 en consola/red (favicon y assets resueltos).
- [ ] Navegación principal sin `pageerror`.

### 1.1 Visibilidad del estado (feedback)
- [ ] Acciones de guardado/registro muestran estado **procesando** (botón deshabilitado o indicador) y resultado **éxito/error**.
- [ ] Ante fallo recuperable se ofrece **reintentar** o se indica claramente cómo repetir la acción.
- [ ] Estados vacíos indican qué falta y CTA para completarlo (gastos, consumos, informes, listas).

### 1.2 Errores accionables
- [ ] Mensajes de error/validación siguen el patrón: **qué pasó + causa (si aplica) + qué hacer**.
- [ ] Validaciones inline señalan el campo afectado y conservan valores ingresados.
- [ ] Login, lecturas/montos inválidos y descuadre de cierre muestran guía de corrección.

### 1.4 Acciones sensibles y simuladas
- [ ] **Cerrar mes**: confirmación con alcance/consecuencia y bloqueo con motivo claro si hay descuadre o pagos pendientes.
- [ ] **Generar boletas**: se presenta como preparación/resumen (no envío automático) y la confirmación lo explicita.
- [ ] Acciones irreversibles/destructivas requieren confirmación informada.

### Regresión y consistencia
- [ ] Montos/estados coherentes entre Dashboard, Cálculo, Dptos, Estado de cuenta e Informes para el mismo mes (`calcMes`).
- [ ] Navegación y tabs (Gastos/Consumos) mantienen contexto; modales cierran y devuelven control.
- [ ] Revisión en escritorio y móvil (390px): sin overflow crítico, controles usables.

## 2. Evidencia a adjuntar
- Capturas por pantalla/flujo (incl. modales y estados de error/éxito).
- `result.json` con `console_errors`, `page_errors`, visibilidad y muestra de texto.
- Notas de casos no cubiertos por falta de datos/credenciales de prueba.
