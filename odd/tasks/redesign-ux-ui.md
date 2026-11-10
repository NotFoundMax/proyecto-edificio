# Rediseño UX/UI — proyecto-edificio

## Specs
S1. Vanilla liviano: sin framework; CSS propio + Material Symbols; componentes reutilizables.
S2. Dark mode desde Fase 1: toggle manual + prefers-color-scheme, persistido en localStorage.
S3. Solo visual: no se toca lógica de negocio ni JS de datos; se reorganiza información (primordial primero, secundario plegado/oculto).
S4. Admin desktop primero, luego propietario mobile; ambos formatos existen para ambos roles (especialización, no exclusión).
S5. Tipografía Inter; iconos Material Symbols; densidad confortable.
S6. Estándar Material Design (Material 3) con tokens; accesibilidad WCAG 2.1 AA.
S7. Breakpoints Material: sm 600 / md 905 / lg 1240 / xl 1440.

## Tasks
T1. Fase 0 — Auditoría y baseline (capturas + matriz de información + lista de ruido). [S3]
T2. Fase 1 — Design System: tokens (color light/dark, tipografía, spacing, elevación, radio, breakpoints) + design/system.md. [S1,S2,S5,S6]
T3. Fase 2 — Shells responsivos (desktop admin + mobile propietario). [S4,S7]
T4. Fase 3 — Componentes vanilla (button, input, modal/bottomsheet, card, table responsive, badge, toast, empty, skeleton, confirm, tabs, accordion, FAB). [S1]
T5. Fase 4 — Limpieza de información por pantalla (primordial primero, secundario plegado). [S3]
T6. Fase 5 — Migración pantalla por pantalla (login, acceso, pendiente, edificios, dashboard, estado de cuenta, gastos, servicios, cálculo, informes, config). [S3,S4]
T7. Fase 6 — Accesibilidad y polish (WCAG AA, reduced-motion, lazy load, Lighthouse). [S6]
T8. Fase 7 — Verificación y rollout (Playwright screenshots, branch redesign, preview Netlify). [S6]

## Log
L1. (usuario) Rediseñar frontend con estándares actuales (Material Design), excelente vista desktop para admins y excelente vista mobile para propietarios. Solo visual. Vanilla liviano. Dark mode desde fase 1. Admin desktop luego propietario mobile; ambos formatos para ambos.
L2. (decisiones) Tipografía Inter; iconos Material Symbols; densidad confortable; plegado solo en pantallas con mucha info (primordial primero).