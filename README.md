# Track Manager

A local, private desktop app to move your music tracks from **idea → released**.
Inspired by TRACKIT, rebuilt cross‑platform (Electron) so it runs on Windows.

Every track is a card on a Kanban board. You give it stages that match how *you*
work, tick off a checklist to see how close each track really is, and keep your
own music, client work and label releases in separate **scenes**. Nothing is
uploaded anywhere — all data lives on your machine.

## Features

**Board & tracks**
- **Kanban board** — drag track cards between your own stages.
- **Custom stages** — rename, reorder and add/remove stages per scene (your roadmap).
- **Checklists with progress** — each card shows a % done bar as you tick items off.
- **Reusable checklist templates** — save a list ("Mixdown", "Promo") once and drop it on any track.
- **Track details** — BPM, key, label/destination and free‑form notes.
- **Scenes** — separate boards for your music, each client, each label.

**Ideas, fixes & feedback (per track)**
- **Attachments** — link samples, MIDI or voice notes to a track (files are never moved
  or copied). Audio plays inline with a real seek bar.
- **Timestamped fixes** — note "lead too quiet at 2:34"; click the timestamp to jump
  straight to that spot in the attached audio.
- **Feedback log** — record who said what; turn any note into a to‑do in one click.

**Projects folder scanner**
- Point a scene at the folder(s) where you keep your projects. Track Manager detects
  Ableton / FL Studio / Cubase / Studio One / Reaper / Logic / Pro Tools / Bitwig
  project files, **groups versions** (so `Song`, `Song v2`, `Song Final` collapse to one),
  and lists new ones in an **Inbox** — add them to the board with one click.
- Open the project in its DAW or reveal it in the file explorer from the track.
- **Link bounces (you stay in control)** — point the scene at your mixdowns folder and
  your masters folder, then open **Review & link bounces**. Each unlinked bounce is
  listed with an inline player so you can **listen first**. Let the **AI propose** which
  track each one belongs to, or pick from a dropdown manually — for files whose names
  don't match, assign them by hand. Nothing is attached until you press **Link**.
  Once linked, bounces are tagged MIX/MASTER, play inline in the track, and the latest
  master becomes the track's primary audio for timestamped fixes.

**Insights**
- Average time your tracks spend in each stage, your **biggest bottleneck**,
  finished‑vs‑started ratio, **stuck tracks** (untouched 3+ weeks) and a wall of
  everything you've finished.

**AI assistant (optional, via OpenRouter)**
- A chat that can see your current board — ask "what should I finish this week?" or
  why tracks keep stalling. Also generates checklists for a track in one click.
- Bring your own **OpenRouter** key; it's stored only on your machine and is the only
  thing that ever leaves it (to call OpenRouter). Everything else stays 100% offline.

**Theme**
- Light / dark mode, accent colour, and a solid / gradient / image background.

**Backup**
- Export everything to a single `.json` file and import it back (e.g. onto a new
  machine). No account.

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

The AI assistant's OpenRouter key is stored separately in `ai-config.json` in the
same folder — never in the project and never in your backup.

## Build a standalone installer (optional)

```bash
npm run dist
```

Produces a Windows installer via electron‑builder in `dist/`.

## Using the AI assistant

1. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Click **✨ Assistant** in the sidebar → the ⚙ settings → paste your key and pick a
   model (default `anthropic/claude-3.5-sonnet`; use `anthropic/claude-3.5-haiku` or
   `openai/gpt-4o-mini` for cheaper). Save.
3. Chat, or use **✨ Suggest** inside a track to generate a checklist.

Only text metadata about your tracks is ever sent — never your audio files.

## Roadmap (possible next steps)

- Live folder watching (auto‑refresh the Inbox as you save new projects).
- Streaming AI responses and proactive nudges ("this track has sat 3 weeks").
- Sort the board by "longest untouched".
