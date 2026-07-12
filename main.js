const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Custom scheme to stream local media files into the renderer (supports range
// requests, so audio seeking works). Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'trackmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

const DATA_FILE = () => path.join(app.getPath('userData'), 'track-manager-data.json');

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE(), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null; // renderer will seed defaults
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE(), JSON.stringify(data, null, 2), 'utf-8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#161719',
    title: 'trackr',
    icon: path.join(__dirname, 'src', 'assets', 'iconHD.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Dev aid: TM_SHOT=<path> captures a screenshot after load, then exits.
  if (process.env.TM_SHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.TM_SHOT, img.toPNG());
        } catch (e) {
          /* ignore */
        }
        app.quit();
      }, 1500);
    });
  }
}

app.whenReady().then(() => {
  // trackmedia://x/<encoded-absolute-path>  ->  streams that local file.
  protocol.handle('trackmedia', (request) => {
    try {
      const encoded = request.url.replace(/^trackmedia:\/\/[^/]*\//, '');
      const filePath = decodeURIComponent(encoded);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('data:load', () => readData());

ipcMain.handle('data:save', (_e, data) => {
  writeData(data);
  return true;
});

ipcMain.handle('data:export', async (_e, data) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export backup',
    defaultPath: `track-manager-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('data:import', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- Project folder scanner ----

// Map DAW project files to a label. `.logicx` is a package folder on macOS.
const DAW_BY_EXT = {
  '.als': 'Ableton',
  '.flp': 'FL Studio',
  '.cpr': 'Cubase',
  '.song': 'Studio One',
  '.rpp': 'Reaper',
  '.logicx': 'Logic',
  '.ptx': 'Pro Tools',
  '.bwproject': 'Bitwig'
};

// Folders we never descend into — noise, backups and huge asset trees.
const SKIP_DIRS = new Set([
  'backup', 'backups', 'samples', 'freeze', 'ableton project info', 'imported',
  'node_modules', '.git', 'render', 'renders', 'bounces', 'recorded', 'cache'
]);

const MAX_DEPTH = 5;
const MAX_ENTRIES = 20000;

function scanFolder(root, acc, depth, budget) {
  if (depth > MAX_DEPTH || budget.count > MAX_ENTRIES) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return; // unreadable dir — skip
  }
  for (const ent of entries) {
    if (budget.count > MAX_ENTRIES) return;
    budget.count++;
    const name = ent.name;
    if (name.startsWith('.')) continue;
    const full = path.join(root, name);

    if (ent.isDirectory()) {
      const lower = name.toLowerCase();
      // Logic packages are directories but are themselves the "project file".
      if (lower.endsWith('.logicx')) {
        pushProject(full, name.slice(0, -7), '.logicx', acc);
        continue;
      }
      if (SKIP_DIRS.has(lower)) continue;
      scanFolder(full, acc, depth + 1, budget);
    } else if (ent.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (DAW_BY_EXT[ext]) {
        pushProject(full, name.slice(0, -ext.length), ext, acc);
      }
    }
  }
}

function pushProject(fullPath, baseName, ext, acc) {
  let mtime = 0;
  try {
    mtime = fs.statSync(fullPath).mtimeMs;
  } catch (e) {
    /* ignore */
  }
  acc.push({
    name: baseName,
    openPath: fullPath,
    folder: path.dirname(fullPath),
    daw: DAW_BY_EXT[ext],
    ext,
    mtime
  });
}

ipcMain.handle('scan:chooseFolder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose your projects folder',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths.length) return { ok: false };
  return { ok: true, folder: filePaths[0] };
});

ipcMain.handle('scan:run', (_e, folders) => {
  const acc = [];
  const budget = { count: 0 };
  for (const f of folders || []) {
    if (f && fs.existsSync(f)) scanFolder(f, acc, 0, budget);
  }
  return { ok: true, projects: acc, truncated: budget.count > MAX_ENTRIES };
});

// Audio bounce folders (mixdowns / masters) — collect audio files to link to tracks.
const MEDIA_EXT = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg']);

function scanMediaFolder(root, acc, depth, budget) {
  if (depth > MAX_DEPTH || budget.count > MAX_ENTRIES) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    if (budget.count > MAX_ENTRIES) return;
    budget.count++;
    const name = ent.name;
    if (name.startsWith('.')) continue;
    const full = path.join(root, name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name.toLowerCase())) continue;
      scanMediaFolder(full, acc, depth + 1, budget);
    } else if (ent.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (MEDIA_EXT.has(ext)) {
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch (e) {
          /* ignore */
        }
        acc.push({ name: name.slice(0, -ext.length), fileName: name, path: full, mtime });
      }
    }
  }
}

// folders: [{ path, role }] -> audio files each tagged with its folder's role.
ipcMain.handle('scan:media', (_e, folders) => {
  const out = [];
  const budget = { count: 0 };
  for (const f of folders || []) {
    if (!f || !f.path || !fs.existsSync(f.path)) continue;
    const acc = [];
    scanMediaFolder(f.path, acc, 0, budget);
    acc.forEach((a) => out.push({ ...a, role: f.role }));
  }
  return { ok: true, files: out };
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  const err = await shell.openPath(p);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle('shell:reveal', (_e, p) => {
  shell.showItemInFolder(p);
  return { ok: true };
});

ipcMain.handle('fs:exists', (_e, p) => {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
});

// ---- AI assistant (OpenRouter) ----
// User key + model live in userData, never in the repo and never sent to the renderer.
const AI_FILE = () => path.join(app.getPath('userData'), 'ai-config.json');
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';

// Fallback chain of free OpenRouter models for the "Free" trial mode. Tried in
// order until one answers, so the app survives a slug being retired or rate-limited.
const DEFAULT_FREE_MODELS = ['openai/gpt-oss-120b:free', 'openrouter/free'];

// Optional bundled key for Free mode. Lives in free-config.json next to main.js
// (gitignored, but included in packaged builds). Credit-cap it to 0 on OpenRouter
// so only :free models ever run — extracting it costs the author nothing.
const FREE_FILE = path.join(__dirname, 'free-config.json');
function readFreeConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(FREE_FILE, 'utf-8'));
    if (!c || !c.key) return null;
    return { key: c.key, models: Array.isArray(c.models) && c.models.length ? c.models : DEFAULT_FREE_MODELS };
  } catch (e) {
    return null;
  }
}

function readAiConfig() {
  try {
    return JSON.parse(fs.readFileSync(AI_FILE(), 'utf-8'));
  } catch (e) {
    return { key: '', model: DEFAULT_MODEL, mode: '' };
  }
}
function writeAiConfig(c) {
  fs.writeFileSync(AI_FILE(), JSON.stringify(c, null, 2), 'utf-8');
}

async function callOpenRouter(key, model, messages) {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://track-manager.app',
        'X-Title': 'Track Manager'
      },
      body: JSON.stringify({ model, messages })
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: `OpenRouter ${resp.status}: ${txt.slice(0, 300)}` };
    }
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('ai:getConfig', () => {
  const c = readAiConfig();
  return {
    hasKey: !!c.key,
    model: c.model || DEFAULT_MODEL,
    mode: c.mode || '',
    freeAvailable: !!readFreeConfig()
  };
});

ipcMain.handle('ai:setConfig', (_e, { key, model }) => {
  const c = readAiConfig();
  if (typeof key === 'string' && key.trim()) c.key = key.trim();
  if (typeof model === 'string' && model.trim()) c.model = model.trim();
  c.mode = 'byok';
  writeAiConfig(c);
  return { ok: true };
});

ipcMain.handle('ai:setMode', (_e, mode) => {
  const c = readAiConfig();
  c.mode = mode === 'free' ? 'free' : 'byok';
  writeAiConfig(c);
  return { ok: true };
});

ipcMain.handle('ai:clearKey', () => {
  const c = readAiConfig();
  c.key = '';
  c.mode = '';
  writeAiConfig(c);
  return { ok: true };
});

ipcMain.handle('ai:chat', async (_e, { messages }) => {
  const c = readAiConfig();

  if (c.mode === 'free') {
    const free = readFreeConfig();
    if (!free) return { ok: false, error: 'Free mode is not set up in this build.' };
    let lastErr = 'no response';
    for (const model of free.models) {
      const r = await callOpenRouter(free.key, model, messages);
      if (r.ok) return r;
      lastErr = r.error || lastErr;
      // 429 (rate limit) or 404 (model gone) -> try the next free model
    }
    return { ok: false, error: 'All free models are busy right now — try again shortly, or use your own key. (' + lastErr + ')' };
  }

  if (!c.key) return { ok: false, error: 'No API key set' };
  return callOpenRouter(c.key, c.model || DEFAULT_MODEL, messages);
});

ipcMain.handle('pick:files', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Attach files to this track',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio / MIDI', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'aiff', 'aif', 'mid', 'midi'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return { ok: false };
  return {
    ok: true,
    files: filePaths.map((p) => ({ path: p, name: path.basename(p) }))
  };
});
