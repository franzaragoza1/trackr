const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

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
    backgroundColor: '#14151a',
    title: 'Track Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
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
