# Track Manager

A local, private desktop app to move your music tracks from **idea → released**.
Inspired by TRACKIT, rebuilt cross‑platform (Electron) so it runs on Windows.

Every track is a card on a Kanban board. You give it stages that match how *you*
work, tick off a checklist to see how close each track really is, and keep your
own music, client work and label releases in separate **scenes**. Nothing is
uploaded anywhere — all data lives on your machine.

## Features (v0.1 — MVP)

- **Kanban board** — drag track cards between your own stages.
- **Custom stages** — rename, reorder and add/remove stages per scene (your roadmap).
- **Checklists with progress** — each card shows a % done bar as you tick items off.
- **Track details** — BPM, key, label/destination and free‑form notes.
- **Scenes** — separate boards for your music, each client, each label.
- **Backup** — export everything to a single `.json` file and import it back
  (e.g. onto a new machine). No account, works fully offline.

## Run it

```bash
npm install
npm start
```

On Windows you can also just double‑click **`start.bat`**.

### Note for this machine
`npm install` downloads the Electron runtime. If **Windows Defender real‑time
protection** is on, it can silently delete `electron.exe` from
`node_modules/electron/dist` as a false positive, which makes launch fail with
`Cannot read properties of undefined (reading 'whenReady')` or a missing‑exe
error. If that happens, add this project folder to Defender's exclusions (or
temporarily disable real‑time protection) and re‑run `npm install`.

`start.bat` also clears the `ELECTRON_RUN_AS_NODE` environment variable, which —
if set — makes Electron run as plain Node and breaks the app.

## Where is my data?

A single JSON file in Electron's per‑user data directory
(`%APPDATA%/Track Manager/track-manager-data.json` on Windows). Use
**Export backup** in the sidebar to make your own copy any time.

## Build a standalone installer (optional)

```bash
npm run dist
```

Produces a Windows installer via electron‑builder in `dist/`.

## Roadmap (next up)

Not built yet — the planned "full replica + improvements" phase:

- Attach samples / MIDI / voice notes to a track (link, don't copy files).
- Timestamped fixes ("lead too quiet at 2:34").
- Feedback log per track.
- Reusable checklist templates.
- Theme builder (background, gradient, custom image).
- Analytics: where your tracks stall, start‑to‑finish ratio.
