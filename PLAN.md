# Track Manager — Plan de fases (2026-07-10)

> **ESTADO: Fases 2, 3 y 4 IMPLEMENTADAS y verificadas (2026-07-10).**
> - ✅ 2.6a stageHistory · ✅ Fase 3 scanner (8 DAWs, agrupación de versiones, Inbox)
> - ✅ 2.1–2.4 adjuntos+audio inline, fixes con seek, feedback, plantillas
> - ✅ 2.6b analítica · ✅ 2.5 theme builder · ✅ Fase 4 asistente IA (OpenRouter)
> - Verificado: tests de agrupación (11/11), scanner, analítica (7/7), round-trip de
>   media URL, parseo de checklist IA; arranque sin errores tras cada fase.
> - Pendiente opcional: watch en vivo de carpetas, streaming IA, orden por "sin tocar".

Base actual: **v0.1 MVP** commiteada (`d24606c`) — Kanban, etapas personalizables,
checklists con %, escenas, backup export/import, acento configurable.

## Orden de ejecución acordado

1. **2.6a** — Registrar `stageHistory` (pequeño; los datos valen oro después)
2. **Fase 3** — Scanner de carpeta de proyectos
3. **2.1 → 2.4** — Adjuntos, fixes con timestamp, feedback, plantillas
4. **2.6b** — Panel de analítica (ya con datos acumulados)
5. **2.5** — Theme builder
6. **Fase 4** — Asistente IA vía **OpenRouter**

---

## Fase 2 — Réplica completa de TRACKIT

### 2.1 Adjuntos por track (samples, MIDI, notas de voz)
- Drag & drop de archivos al modal del track → se guarda **solo la ruta** (link, nunca copia).
- Reproductor inline para audio (wav/mp3/m4a/ogg). Técnica: protocolo custom
  `local-media://` registrado en `main.js` para servir archivos locales sin
  desactivar `webSecurity`.
- Detección de archivos movidos/borrados: badge "no encontrado" + re-vincular.

### 2.2 Fixes con timestamp
- Lista por track: `mm:ss` + descripción ("lead bajo en 2:34"), marcables como resueltos.
- Mejora sobre TRACKIT: si hay un bounce adjunto, clic en el timestamp salta a ese
  segundo en el reproductor.

### 2.3 Log de feedback
- Entradas con quién / fecha / comentario, ancladas al track.
- Mejora: convertir un feedback en ítem de checklist con un clic.

### 2.4 Plantillas de checklist reutilizables
- Guardar cualquier checklist como plantilla con nombre ("Mixdown", "Promo") y
  aplicarla a cualquier track en 2 clics.

### 2.5 Theme builder completo
- Fondo sólido / gradiente / imagen propia + modo claro/oscuro (además del acento actual).

### 2.6 Analítica ("dónde mueren tus tracks")
- **2.6a (previo, hacer primero):** registrar `stageHistory` en cada track —
  array `[{stageId, at}]`; se añade entrada en cada movimiento de etapa (drop en
  tablero, cambio en modal, reasignación al borrar etapa). Migración al arrancar
  para tracks existentes.
- **2.6b (panel):** tiempo medio por etapa, etapa donde más se atascan, ratio
  empezados/terminados, tracks parados >N semanas, muro de terminados.

---

## Fase 3 — Scanner de carpeta de proyectos

**Objetivo:** apuntar la app a la(s) carpeta(s) donde se guardan los proyectos y
crear tarjetas automáticamente con el nombre de cada proyecto.

- **Config por escena:** `scene.scanFolders` = lista de carpetas raíz (p. ej. `D:\Proyectos Ableton`).
- **Scanner en `main.js`** (IPC `scan:run`), profundidad limitada (~4 niveles):
  - Ableton: carpetas `X Project/` con `X.als` (ignorar subcarpeta `Backup`)
  - FL Studio `.flp` · Cubase `.cpr` · Studio One `.song` · Reaper `.rpp` · Logic `.logicx` (carpeta-paquete)
  - Ignorar: `Backup`, `Samples`, `Freeze`, ocultas, `node_modules`, `.git`
- **Agrupación de versiones:** normalizar nombre (minúsculas, quitar `_-`,
  strip de tokens finales tipo `v2`, `final`, `master`, `(1)`, `wip`...) y agrupar
  `Final`, `Final V2`, `Final Final` bajo la clave base; representante = archivo
  más reciente; guardar nº de versiones.
- **Inbox:** modal "Projects folder" con: gestión de carpetas, botón Rescan,
  lista de proyectos detectados **sin tarjeta aún** (match por clave normalizada
  contra `track.project.key`), botón "Add" por proyecto y "Add all".
- **Tarjeta vinculada:** guarda `track.project = {key, name, openPath, folder, daw, mtime}`;
  chip del DAW en la tarjeta; en el modal: "Open project" (`shell.openPath`) y
  "Show in folder" (`shell.showItemInFolder`) vía IPC.
- **Vigilancia en vivo (opcional, después):** `chokidar` para que los proyectos
  nuevos aparezcan solos en el Inbox y las tarjetas muestren "último trabajo hace X días".
  Primera entrega: rescan manual (+ opcional al abrir la app).
- Sinergia con 2.6: ordenar tablero por "más tiempo sin tocar".

**Cambios previstos:** `main.js` (scanner + IPC `scan:chooseFolder`, `scan:run`,
`shell:openPath`, `shell:reveal`), `preload.js` (exponerlos), `index.html`
(botón + modal Inbox + fila de proyecto en el modal de track), `app.js` (UI + linking),
`styles.css` (estilos menores).

---

## Fase 4 — Asistente IA vía OpenRouter (decisión cerrada)

- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions` (formato OpenAI-compatible).
- **Key:** `sk-or-...` introducida por el usuario en Ajustes, guardada en `userData`
  (nunca en el repo); todas las llamadas desde `main.js`, el renderer no ve la key.
- **Modelo configurable** en ajustes; sugerencia: uno barato para tareas simples
  (generar checklists) y uno potente para el chat asistente. Con OpenRouter se
  puede cambiar de modelo por tarea sin tocar código.
- **Casos de uso:**
  1. Generar checklists por etapa/género → ítems listos para aplicar.
  2. Chat asistente con contexto real del estado (solo metadatos de texto:
     tracks, etapas, tiempos, fixes; nunca audio) — "¿qué termino esta semana?".
  3. Resumir/priorizar el log de feedback en tareas ordenadas.
  4. Ayudar al scanner a agrupar nombres ambiguos que la heurística no resuelva.
  5. Empujones proactivos: "este track lleva 3 semanas en Mixdown con 2 tareas".
- **Privacidad:** todo opt-in; la app sigue 100% offline salvo cuando se usa el asistente.
- **Coste:** pago por uso (céntimos por interacción, según modelo elegido).

---

## Notas de entorno (esta máquina)

- Windows Defender borra `electron.exe` como falso positivo si la protección en
  tiempo real está activa → excluir la carpeta del proyecto o desactivar al instalar.
- `ELECTRON_RUN_AS_NODE=1` rompe el arranque (app corre como Node plano);
  `start.bat` ya lo limpia.
