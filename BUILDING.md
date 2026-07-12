# Building & development

Developer notes for running trackr from source and producing installers.

## Run from source

```bash
npm install
npm start
```

On Windows you can also double‑click **`start.bat`**, which additionally clears the
`ELECTRON_RUN_AS_NODE` environment variable — if that variable is set, Electron runs as
plain Node and the app fails to start (`Cannot read properties of undefined (reading
'whenReady')`).

> **Windows Defender note:** `npm install` downloads the Electron runtime. With real‑time
> protection on, Defender can silently delete `electron.exe` from
> `node_modules/electron/dist` as a false positive. If launch fails with a missing‑exe or
> `whenReady` error, add the project folder to Defender's exclusions (or temporarily disable
> real‑time protection) and re‑run `npm install`.

## Where data lives

A single JSON file in Electron's per‑user data directory
(`%APPDATA%/trackr/track-manager-data.json` on Windows). The AI key is stored separately in
`ai-config.json` in the same folder — never in the project and never in a backup.

## Build installers

### Windows (from Windows)

```bash
npm run dist
```

Produces `dist/trackr Setup <version>.exe` (NSIS, per‑user, no admin needed), unsigned.

> If the build fails extracting `winCodeSign` with a *"Cannot create symbolic link"* error,
> extract it once by hand (the macOS symlinks it chokes on aren't needed on Windows), then
> rebuild:
> `7za x <cache>/winCodeSign/*.7z -o<cache>/winCodeSign/winCodeSign-2.6.0`
> (cache = `%LOCALAPPDATA%/electron-builder/Cache`).

### macOS (`.dmg`)

macOS installers can only be built on macOS — run `npx electron-builder --mac dmg` on a Mac.

### Both, via GitHub Actions

`.github/workflows/build.yml` builds Windows **and** macOS on every version tag (or manually
from the Actions tab):

```bash
git tag v0.1.2 && git push origin v0.1.2
```

Artifacts appear under the run's **Artifacts** section. The workflow uses `--publish never`
(build only, no auto‑release).

## Free mode for distributed builds

The assistant's **Free** option needs a bundled OpenRouter key.

- **Locally:** copy `free-config.example.json` to `free-config.json` and add a key whose
  **credit limit is set to 0** on OpenRouter (so only `:free` models can run — extracting it
  from the app then costs nothing). `free-config.json` is gitignored (kept out of the repo so
  it won't be flagged by secret scanners) but is bundled into packaged builds.
- **In CI:** add a repository secret `FREE_OR_KEY`; the workflow writes `free-config.json`
  from it. Without it, the app simply hides the Free option and everyone uses their own key.

## Roadmap

- Live folder watching (auto‑refresh the Inbox as you save new projects).
- Streaming AI responses and proactive nudges.
- Sort the board by "longest untouched".
