'use strict';

/* ------------------------------------------------------------------ *
 * Track Manager — renderer logic (vanilla JS, no framework)
 * State is a single object persisted to disk via the preload `api`.
 * ------------------------------------------------------------------ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_STAGES = ['Idea', 'Writing', 'Arrangement', 'Mixdown', 'Mastering', 'Released'];

function makeStages(names) {
  return names.map((name) => ({ id: uid(), name }));
}

function seedData() {
  const stages = makeStages(DEFAULT_STAGES);
  const scene = {
    id: uid(),
    name: 'My Music',
    stages,
    tracks: [],
    scanFolders: []
  };
  return { version: 1, accent: '#5b8cff', activeSceneId: scene.id, scenes: [scene] };
}

let state = null;
let editingTrackId = null; // track currently open in modal (null = new)

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.save(state), 250);
}

async function boot() {
  const loaded = await window.api.load();
  state = loaded && loaded.scenes && loaded.scenes.length ? loaded : seedData();
  migrate(state);
  if (!state.accent) state.accent = '#5b8cff';
  applyAccent(state.accent);
  document.getElementById('accentPicker').value = state.accent;
  render();
  refreshInbox();
}

/* Normalize older data so newer fields always exist. Grows as features land. */
function migrate(st) {
  if (!Array.isArray(st.checklistTemplates)) st.checklistTemplates = [];
  (st.scenes || []).forEach((scene) => {
    if (!Array.isArray(scene.scanFolders)) scene.scanFolders = [];
    (scene.tracks || []).forEach((track) => {
      if (!Array.isArray(track.stageHistory) || !track.stageHistory.length) {
        const at = track.createdAt || Date.now();
        track.stageHistory = track.stageId ? [{ stageId: track.stageId, at }] : [];
      }
      if (!Array.isArray(track.attachments)) track.attachments = [];
      if (!Array.isArray(track.fixes)) track.fixes = [];
      if (!Array.isArray(track.feedback)) track.feedback = [];
    });
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const activeScene = () => state.scenes.find((s) => s.id === state.activeSceneId) || state.scenes[0];

function progressOf(track) {
  const items = track.checklist || [];
  if (!items.length) return 0;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

/* Move a track to a stage and record the transition in its history. */
function moveTrackToStage(track, stageId, ts = Date.now()) {
  if (!Array.isArray(track.stageHistory)) track.stageHistory = [];
  const changed = track.stageId !== stageId;
  track.stageId = stageId;
  track.updatedAt = ts;
  if (changed || track.stageHistory.length === 0) {
    track.stageHistory.push({ stageId, at: ts });
  }
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 1900);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------------------------ *
 * Render: sidebar scenes
 * ------------------------------------------------------------------ */
function renderScenes() {
  const list = document.getElementById('sceneList');
  list.innerHTML = '';
  state.scenes.forEach((scene) => {
    const li = document.createElement('li');
    li.className = 'scene-item' + (scene.id === state.activeSceneId ? ' active' : '');
    li.innerHTML = `<span>${escapeHtml(scene.name)}</span><span class="count">${scene.tracks.length}</span>`;
    li.addEventListener('click', () => {
      state.activeSceneId = scene.id;
      save();
      render();
      refreshInbox();
    });
    list.appendChild(li);
  });
}

/* ------------------------------------------------------------------ *
 * Render: board
 * ------------------------------------------------------------------ */
function renderBoard() {
  const scene = activeScene();
  const board = document.getElementById('board');
  board.innerHTML = '';

  document.getElementById('sceneTitle').textContent = scene.name;
  const total = scene.tracks.length;
  const released = scene.tracks.filter((t) => {
    const last = scene.stages[scene.stages.length - 1];
    return last && t.stageId === last.id;
  }).length;
  document.getElementById('sceneStats').textContent =
    total ? `${total} track${total > 1 ? 's' : ''} · ${released} released` : 'No tracks yet';

  scene.stages.forEach((stage) => {
    const col = document.createElement('div');
    col.className = 'column';
    col.dataset.stageId = stage.id;

    const tracks = scene.tracks.filter((t) => t.stageId === stage.id);
    col.innerHTML = `
      <div class="column-head">
        <span>${escapeHtml(stage.name)}</span>
        <span class="col-count">${tracks.length}</span>
      </div>
      <div class="column-body"></div>`;

    const body = col.querySelector('.column-body');
    if (!tracks.length) {
      body.innerHTML = '<div class="empty-col">Drop tracks here</div>';
    } else {
      tracks.forEach((t) => body.appendChild(renderCard(t)));
    }

    // drag targets
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const trackId = e.dataTransfer.getData('text/plain');
      const track = scene.tracks.find((t) => t.id === trackId);
      if (track && track.stageId !== stage.id) {
        moveTrackToStage(track, stage.id);
        save();
        render();
      }
    });

    board.appendChild(col);
  });
}

function renderCard(track) {
  const card = document.createElement('div');
  card.className = 'card';
  card.draggable = true;

  const pct = progressOf(track);
  const meta = [];
  if (track.project) meta.push(`<span class="chip chip-daw">${escapeHtml(track.project.daw || 'Project')}</span>`);
  if (track.bpm) meta.push(`<span class="chip">${escapeHtml(track.bpm)} BPM</span>`);
  if (track.key) meta.push(`<span class="chip">${escapeHtml(track.key)}</span>`);
  if (track.label) meta.push(`<span class="chip">${escapeHtml(track.label)}</span>`);

  const done = (track.checklist || []).filter((i) => i.done).length;
  const totalItems = (track.checklist || []).length;

  const nAttach = (track.attachments || []).length;
  const openFixes = (track.fixes || []).filter((f) => !f.done).length;
  const ind = [];
  if (nAttach) ind.push(`<span class="ind" title="Attachments">♪ ${nAttach}</span>`);
  if (openFixes) ind.push(`<span class="ind ind-fix" title="Open fixes">✎ ${openFixes}</span>`);

  card.innerHTML = `
    <div class="card-title">${escapeHtml(track.title || 'Untitled')}</div>
    ${meta.length ? `<div class="card-meta">${meta.join('')}</div>` : ''}
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="card-foot">
      <span>${totalItems ? `${done}/${totalItems} done` : 'No checklist'}</span>
      <span class="card-foot-right">${ind.join('')}<span>${pct}%</span></span>
    </div>`;

  card.addEventListener('click', () => openTrackModal(track.id));
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', track.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

function render() {
  renderScenes();
  renderBoard();
}

/* ------------------------------------------------------------------ *
 * Track modal
 * ------------------------------------------------------------------ */
let modalChecklist = []; // working copies while modal open
let modalAttachments = [];
let modalFixes = [];
let modalFeedback = [];
let primaryAudioEl = null; // first audio attachment's <audio>, used by fix seeking

const AUDIO_EXT = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.aif'];
const MIDI_EXT = ['.mid', '.midi'];

function extname(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}
function attachKind(name) {
  const e = extname(name);
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (MIDI_EXT.includes(e)) return 'midi';
  return 'other';
}
function parseTime(str) {
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const total = parseInt(m, 10) * 60 + parseInt(sec, 10);
    return isNaN(total) ? null : total;
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
function fmtTime(total) {
  const t = Math.max(0, Math.floor(total || 0));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function openTrackModal(trackId) {
  const scene = activeScene();
  editingTrackId = trackId;
  const track = trackId ? scene.tracks.find((t) => t.id === trackId) : null;

  document.getElementById('tTitle').value = track ? track.title : '';
  document.getElementById('tBpm').value = track ? track.bpm || '' : '';
  document.getElementById('tKey').value = track ? track.key || '' : '';
  document.getElementById('tLabel').value = track ? track.label || '' : '';
  document.getElementById('tNotes').value = track ? track.notes || '' : '';

  const stageSel = document.getElementById('tStage');
  stageSel.innerHTML = scene.stages
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join('');
  stageSel.value = track ? track.stageId : scene.stages[0].id;

  modalChecklist = track ? track.checklist.map((i) => ({ ...i })) : [];
  modalAttachments = track ? (track.attachments || []).map((a) => ({ ...a })) : [];
  modalFixes = track ? (track.fixes || []).map((f) => ({ ...f })) : [];
  modalFeedback = track ? (track.feedback || []).map((f) => ({ ...f })) : [];
  renderModalChecklist();
  renderModalAttachments();
  renderModalFixes();
  renderModalFeedback();
  renderTemplateSelect();
  renderProjectRow(track);

  document.getElementById('deleteTrackBtn').style.display = track ? '' : 'none';
  document.getElementById('trackModal').hidden = false;
  document.getElementById('tTitle').focus();
}

function closeTrackModal() {
  document.getElementById('trackModal').hidden = true;
  editingTrackId = null;
}

function renderModalChecklist() {
  const ul = document.getElementById('tChecklist');
  ul.innerHTML = '';
  modalChecklist.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'check-item' + (item.done ? ' done' : '');
    li.innerHTML = `
      <input type="checkbox" ${item.done ? 'checked' : ''} />
      <span>${escapeHtml(item.text)}</span>
      <button class="check-del" title="Remove">×</button>`;
    li.querySelector('input').addEventListener('change', (e) => {
      item.done = e.target.checked;
      renderModalChecklist();
    });
    li.querySelector('.check-del').addEventListener('click', () => {
      modalChecklist = modalChecklist.filter((i) => i.id !== item.id);
      renderModalChecklist();
    });
    ul.appendChild(li);
  });
  const done = modalChecklist.filter((i) => i.done).length;
  const pct = modalChecklist.length ? Math.round((done / modalChecklist.length) * 100) : 0;
  document.getElementById('tProgressFill').style.width = pct + '%';
  document.getElementById('tProgressPct').textContent = pct + '%';
}

/* ---- Attachments ---- */
function renderModalAttachments() {
  const ul = document.getElementById('tAttachments');
  ul.innerHTML = '';
  primaryAudioEl = null;
  if (!modalAttachments.length) {
    ul.innerHTML = '<li class="attach-empty">Nothing attached yet.</li>';
    return;
  }
  modalAttachments.forEach((att) => {
    const kind = att.kind || attachKind(att.name);
    const li = document.createElement('li');
    li.className = 'attach-item';
    const isAudio = kind === 'audio';
    li.innerHTML = `
      <div class="attach-row">
        <span class="attach-icon">${kind === 'audio' ? '♪' : kind === 'midi' ? '𝅘𝅥' : '⎙'}</span>
        <span class="attach-name" title="${escapeHtml(att.path)}">${escapeHtml(att.name)}</span>
        <button class="ghost-btn small attach-reveal" type="button">Show</button>
        <button class="check-del attach-del" type="button" title="Remove">×</button>
      </div>
      ${isAudio ? '<audio class="attach-audio" controls preload="none"></audio>' : ''}`;

    if (isAudio) {
      const audio = li.querySelector('.attach-audio');
      audio.src = window.api.mediaUrl(att.path);
      if (!primaryAudioEl) primaryAudioEl = audio; // first audio drives fix seeking
    }
    li.querySelector('.attach-reveal').addEventListener('click', () => window.api.reveal(att.path));
    li.querySelector('.attach-del').addEventListener('click', () => {
      modalAttachments = modalAttachments.filter((a) => a.id !== att.id);
      renderModalAttachments();
    });
    ul.appendChild(li);
  });
}

async function addAttachments() {
  const res = await window.api.pickFiles();
  if (!res.ok) return;
  res.files.forEach((f) => {
    if (modalAttachments.some((a) => a.path === f.path)) return; // dedupe
    modalAttachments.push({ id: uid(), name: f.name, path: f.path, kind: attachKind(f.name) });
  });
  renderModalAttachments();
}

/* ---- Timestamped fixes ---- */
function renderModalFixes() {
  const ul = document.getElementById('tFixes');
  ul.innerHTML = '';
  if (!modalFixes.length) {
    ul.innerHTML = '<li class="attach-empty">No fixes noted.</li>';
    return;
  }
  modalFixes
    .slice()
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .forEach((fix) => {
      const li = document.createElement('li');
      li.className = 'fix-item' + (fix.done ? ' done' : '');
      li.innerHTML = `
        <input type="checkbox" ${fix.done ? 'checked' : ''} />
        <button class="fix-time" type="button" title="Jump to this spot">${fmtTime(fix.at)}</button>
        <span class="fix-text">${escapeHtml(fix.text)}</span>
        <button class="check-del" type="button" title="Remove">×</button>`;
      li.querySelector('input').addEventListener('change', (e) => {
        fix.done = e.target.checked;
        renderModalFixes();
      });
      li.querySelector('.fix-time').addEventListener('click', () => {
        if (primaryAudioEl) {
          primaryAudioEl.currentTime = fix.at || 0;
          primaryAudioEl.play().catch(() => {});
        } else {
          toast('Attach an audio file to jump to a spot');
        }
      });
      li.querySelector('.check-del').addEventListener('click', () => {
        modalFixes = modalFixes.filter((f) => f.id !== fix.id);
        renderModalFixes();
      });
      ul.appendChild(li);
    });
}

/* ---- Feedback log ---- */
function renderModalFeedback() {
  const ul = document.getElementById('tFeedback');
  ul.innerHTML = '';
  if (!modalFeedback.length) {
    ul.innerHTML = '<li class="attach-empty">No feedback logged.</li>';
    return;
  }
  modalFeedback
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .forEach((fb) => {
      const li = document.createElement('li');
      li.className = 'feedback-item';
      const when = fb.at ? new Date(fb.at).toLocaleDateString() : '';
      li.innerHTML = `
        <div class="feedback-meta">
          <span class="feedback-who">${escapeHtml(fb.who || 'Someone')}</span>
          <span class="feedback-when">${when}</span>
        </div>
        <div class="feedback-text">${escapeHtml(fb.text)}</div>
        <div class="feedback-actions">
          <button class="ghost-btn small fb-to-task" type="button">→ Add as to-do</button>
          <button class="check-del" type="button" title="Remove">×</button>
        </div>`;
      li.querySelector('.fb-to-task').addEventListener('click', () => {
        modalChecklist.push({ id: uid(), text: fb.text, done: false });
        renderModalChecklist();
        toast('Added to checklist');
      });
      li.querySelector('.check-del').addEventListener('click', () => {
        modalFeedback = modalFeedback.filter((f) => f.id !== fb.id);
        renderModalFeedback();
      });
      ul.appendChild(li);
    });
}

/* ---- Checklist templates ---- */
function renderTemplateSelect() {
  const sel = document.getElementById('templateSelect');
  const templates = state.checklistTemplates || [];
  sel.innerHTML =
    '<option value="">Apply template…</option>' +
    templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.items.length})</option>`).join('');
}

function applyTemplate() {
  const id = document.getElementById('templateSelect').value;
  const tpl = (state.checklistTemplates || []).find((t) => t.id === id);
  if (!tpl) return toast('Pick a template first');
  tpl.items.forEach((text) => modalChecklist.push({ id: uid(), text, done: false }));
  renderModalChecklist();
  toast(`Applied "${tpl.name}"`);
}

function saveTemplate() {
  if (!modalChecklist.length) return toast('Add some checklist items first');
  const name = prompt('Template name (e.g. Mixdown, Promo):');
  if (!name || !name.trim()) return;
  state.checklistTemplates.push({
    id: uid(),
    name: name.trim(),
    items: modalChecklist.map((i) => i.text)
  });
  save();
  renderTemplateSelect();
  toast('Template saved');
}

function deleteTemplate() {
  const id = document.getElementById('templateSelect').value;
  const tpl = (state.checklistTemplates || []).find((t) => t.id === id);
  if (!tpl) return toast('Pick a template to delete');
  if (!confirm(`Delete template "${tpl.name}"?`)) return;
  state.checklistTemplates = state.checklistTemplates.filter((t) => t.id !== id);
  save();
  renderTemplateSelect();
  toast('Template deleted');
}

function saveTrackFromModal() {
  const scene = activeScene();
  const stageId = document.getElementById('tStage').value;
  const payload = {
    title: document.getElementById('tTitle').value.trim() || 'Untitled',
    bpm: document.getElementById('tBpm').value.trim(),
    key: document.getElementById('tKey').value.trim(),
    label: document.getElementById('tLabel').value.trim(),
    notes: document.getElementById('tNotes').value,
    checklist: modalChecklist,
    attachments: modalAttachments,
    fixes: modalFixes,
    feedback: modalFeedback
  };

  if (editingTrackId) {
    const track = scene.tracks.find((t) => t.id === editingTrackId);
    Object.assign(track, payload);
    moveTrackToStage(track, stageId); // records history only if the stage changed
  } else {
    const now = Date.now();
    const track = { id: uid(), ...payload, stageId, createdAt: now, updatedAt: now, stageHistory: [] };
    moveTrackToStage(track, stageId, now); // seeds initial history entry
    scene.tracks.push(track);
  }
  save();
  render();
  closeTrackModal();
}

function deleteCurrentTrack() {
  if (!editingTrackId) return;
  const scene = activeScene();
  scene.tracks = scene.tracks.filter((t) => t.id !== editingTrackId);
  save();
  render();
  closeTrackModal();
  toast('Track deleted');
}

/* ------------------------------------------------------------------ *
 * Stages editor
 * ------------------------------------------------------------------ */
function openStagesModal() {
  renderStageEditor();
  document.getElementById('stagesModal').hidden = false;
}

function renderStageEditor() {
  const scene = activeScene();
  const ul = document.getElementById('stageEditList');
  ul.innerHTML = '';
  scene.stages.forEach((stage, idx) => {
    const li = document.createElement('li');
    li.className = 'stage-row';
    li.innerHTML = `
      <button class="stage-move" data-dir="-1" title="Move up">▲</button>
      <button class="stage-move" data-dir="1" title="Move down">▼</button>
      <input type="text" value="${escapeHtml(stage.name)}" />
      <button class="icon-btn" title="Remove">×</button>`;

    li.querySelector('input').addEventListener('input', (e) => {
      stage.name = e.target.value;
      save();
    });
    li.querySelectorAll('.stage-move').forEach((btn) =>
      btn.addEventListener('click', () => moveStage(idx, parseInt(btn.dataset.dir, 10)))
    );
    li.querySelector('.icon-btn').addEventListener('click', () => removeStage(stage.id));
    ul.appendChild(li);
  });
}

function moveStage(idx, dir) {
  const scene = activeScene();
  const j = idx + dir;
  if (j < 0 || j >= scene.stages.length) return;
  [scene.stages[idx], scene.stages[j]] = [scene.stages[j], scene.stages[idx]];
  save();
  renderStageEditor();
  renderBoard();
}

function removeStage(stageId) {
  const scene = activeScene();
  if (scene.stages.length <= 1) return toast('Keep at least one stage');
  const affected = scene.tracks.filter((t) => t.stageId === stageId);
  if (affected.length && !confirm(`${affected.length} track(s) are in this stage. They will move to the first stage. Continue?`)) return;
  scene.stages = scene.stages.filter((s) => s.id !== stageId);
  const first = scene.stages[0].id;
  affected.forEach((t) => moveTrackToStage(t, first));
  save();
  renderStageEditor();
  renderBoard();
}

function addStage(name) {
  const scene = activeScene();
  scene.stages.push({ id: uid(), name });
  save();
  renderStageEditor();
  renderBoard();
}

/* ------------------------------------------------------------------ *
 * Scenes CRUD
 * ------------------------------------------------------------------ */
function addScene() {
  const name = prompt('Scene name (e.g. a client, a label, your own music):');
  if (!name || !name.trim()) return;
  const scene = { id: uid(), name: name.trim(), stages: makeStages(DEFAULT_STAGES), tracks: [], scanFolders: [] };
  state.scenes.push(scene);
  state.activeSceneId = scene.id;
  save();
  render();
}

function renameScene() {
  const scene = activeScene();
  const name = prompt('Rename scene:', scene.name);
  if (!name || !name.trim()) return;
  scene.name = name.trim();
  save();
  render();
}

function deleteScene() {
  if (state.scenes.length <= 1) return toast('You need at least one scene');
  const scene = activeScene();
  if (!confirm(`Delete scene "${scene.name}" and all its tracks? This cannot be undone.`)) return;
  state.scenes = state.scenes.filter((s) => s.id !== scene.id);
  state.activeSceneId = state.scenes[0].id;
  save();
  render();
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */
async function exportBackup() {
  const res = await window.api.exportData(state);
  if (res.ok) toast('Backup exported');
}

async function importBackup() {
  if (!confirm('Importing will replace everything currently in the app. Continue?')) return;
  const res = await window.api.importData();
  if (!res.ok) return res.error && toast('Import failed');
  if (!res.data || !res.data.scenes) return toast('Not a valid backup file');
  state = res.data;
  if (!state.accent) state.accent = '#5b8cff';
  applyAccent(state.accent);
  document.getElementById('accentPicker').value = state.accent;
  save();
  render();
  toast('Backup imported');
}

/* ------------------------------------------------------------------ *
 * Project folder scanner
 * ------------------------------------------------------------------ */

// Trailing tokens that mark a *version* of the same track, not a new track.
const VERSION_TOKENS = /\s*[([{]?\s*(v\.?\s?\d+|ver\.?\s?\d*|\d{1,3}|final(e)?|master(ed)?|wip|copy|bounce|render|latest|def|definitivo)\s*[)\]}]?\s*$/i;

// Reduce a project file name to a grouping key so "Song", "Song v2" and
// "Song Final" collapse to the same track.
function projectKey(name) {
  let s = String(name).toLowerCase().trim();
  s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(VERSION_TOKENS, '').trim();
  } while (s !== prev && s.length > 1);
  return s || String(name).toLowerCase().trim();
}

// Group raw project files by key; representative = most recently modified.
function groupProjects(projects) {
  const map = new Map();
  for (const p of projects) {
    const key = projectKey(p.name);
    const g = map.get(key);
    if (!g) {
      map.set(key, { key, name: p.name, openPath: p.openPath, folder: p.folder, daw: p.daw, mtime: p.mtime, versions: 1 });
    } else {
      g.versions++;
      if (p.mtime > g.mtime) {
        g.mtime = p.mtime;
        g.openPath = p.openPath;
        g.name = p.name;
        g.folder = p.folder;
        g.daw = p.daw;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.mtime - a.mtime);
}

function linkedKeys(scene) {
  const set = new Set();
  scene.tracks.forEach((t) => t.project && t.project.key && set.add(t.project.key));
  return set;
}

let scanRaw = []; // last raw scan result for the active scene
let scanBusy = false;

// Run a scan for the active scene's folders and refresh the badge / inbox.
async function refreshInbox() {
  const scene = activeScene();
  if (!scene.scanFolders || !scene.scanFolders.length) {
    scanRaw = [];
    updateInboxBadge();
    if (!document.getElementById('projectsModal').hidden) renderInbox();
    return;
  }
  scanBusy = true;
  if (!document.getElementById('projectsModal').hidden) renderInbox();
  const res = await window.api.scan(scene.scanFolders);
  scanBusy = false;
  scanRaw = res && res.ok ? res.projects : [];
  updateInboxBadge();
  if (!document.getElementById('projectsModal').hidden) renderInbox();
}

function unlinkedGroups() {
  const scene = activeScene();
  const linked = linkedKeys(scene);
  return groupProjects(scanRaw).filter((g) => !linked.has(g.key));
}

function updateInboxBadge() {
  const badge = document.getElementById('inboxBadge');
  const n = unlinkedGroups().length;
  if (n > 0) {
    badge.textContent = n;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function openProjectsModal() {
  document.getElementById('projectsModal').hidden = false;
  renderFolders();
  renderInbox();
  refreshInbox();
}

function renderFolders() {
  const scene = activeScene();
  const ul = document.getElementById('folderList');
  ul.innerHTML = '';
  if (!scene.scanFolders.length) {
    ul.innerHTML = '<li class="folder-empty">No folders yet — add the folder where you keep your projects.</li>';
    return;
  }
  scene.scanFolders.forEach((folder) => {
    const li = document.createElement('li');
    li.className = 'folder-row';
    li.innerHTML = `<span class="folder-path" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
      <button class="icon-btn" title="Remove">×</button>`;
    li.querySelector('.icon-btn').addEventListener('click', () => {
      scene.scanFolders = scene.scanFolders.filter((f) => f !== folder);
      save();
      renderFolders();
      refreshInbox();
    });
    ul.appendChild(li);
  });
}

function renderInbox() {
  const list = document.getElementById('inboxList');
  const empty = document.getElementById('inboxEmpty');
  const count = document.getElementById('inboxCount');
  const scene = activeScene();
  list.innerHTML = '';

  if (scanBusy) {
    count.textContent = '';
    empty.hidden = false;
    empty.textContent = 'Scanning…';
    return;
  }

  const groups = unlinkedGroups();
  count.textContent = groups.length ? `(${groups.length})` : '';
  document.getElementById('addAllBtn').style.display = groups.length ? '' : 'none';

  if (!groups.length) {
    empty.hidden = false;
    empty.textContent = scene.scanFolders.length
      ? 'No new projects found — everything is already on your board.'
      : 'No folders yet. Add a folder, then Rescan.';
    return;
  }
  empty.hidden = true;

  groups.forEach((g) => {
    const li = document.createElement('li');
    li.className = 'inbox-row';
    const when = g.mtime ? new Date(g.mtime).toLocaleDateString() : '';
    li.innerHTML = `
      <div class="inbox-info">
        <span class="inbox-name">${escapeHtml(g.name)}</span>
        <span class="inbox-meta">
          <span class="chip">${escapeHtml(g.daw)}</span>
          ${g.versions > 1 ? `<span class="chip">${g.versions} versions</span>` : ''}
          ${when ? `<span class="inbox-when">${when}</span>` : ''}
        </span>
      </div>
      <button class="primary-btn small add-one">Add</button>`;
    li.querySelector('.add-one').addEventListener('click', () => {
      linkProject(g);
      save();
      render();
      renderInbox();
      updateInboxBadge();
    });
    list.appendChild(li);
  });
}

function linkProject(group) {
  const scene = activeScene();
  const now = Date.now();
  const stageId = scene.stages[0].id;
  const track = {
    id: uid(),
    title: group.name,
    bpm: '', key: '', label: '', notes: '',
    checklist: [],
    stageId,
    createdAt: now,
    updatedAt: now,
    stageHistory: [],
    project: {
      key: group.key,
      name: group.name,
      openPath: group.openPath,
      folder: group.folder,
      daw: group.daw,
      mtime: group.mtime
    }
  };
  moveTrackToStage(track, stageId, now);
  scene.tracks.push(track);
}

function addAllProjects() {
  const groups = unlinkedGroups();
  if (!groups.length) return;
  groups.forEach(linkProject);
  save();
  render();
  renderInbox();
  updateInboxBadge();
  toast(`Added ${groups.length} track${groups.length > 1 ? 's' : ''}`);
}

async function addFolder() {
  const res = await window.api.chooseFolder();
  if (!res.ok) return;
  const scene = activeScene();
  if (!scene.scanFolders.includes(res.folder)) {
    scene.scanFolders.push(res.folder);
    save();
    renderFolders();
    refreshInbox();
  }
}

/* Render the linked-project row inside the track modal. */
async function renderProjectRow(track) {
  const row = document.getElementById('tProjectRow');
  if (!track || !track.project) {
    row.hidden = true;
    row.innerHTML = '';
    return;
  }
  const p = track.project;
  row.hidden = false;
  row.innerHTML = `
    <div class="project-info">
      <span class="chip">${escapeHtml(p.daw || 'Project')}</span>
      <span class="project-name" title="${escapeHtml(p.openPath)}">${escapeHtml(p.name)}</span>
      <span class="project-missing" hidden>· file not found</span>
    </div>
    <div class="project-actions">
      <button class="ghost-btn small" id="openProjectBtn">Open</button>
      <button class="ghost-btn small" id="revealProjectBtn">Show in folder</button>
      <button class="ghost-btn small" id="unlinkProjectBtn">Unlink</button>
    </div>`;

  row.querySelector('#openProjectBtn').addEventListener('click', async () => {
    const r = await window.api.openPath(p.openPath);
    if (!r.ok) toast('Could not open — file may have moved');
  });
  row.querySelector('#revealProjectBtn').addEventListener('click', () => window.api.reveal(p.openPath));
  row.querySelector('#unlinkProjectBtn').addEventListener('click', () => {
    delete track.project;
    save();
    render();
    renderProjectRow(track);
    updateInboxBadge();
  });

  // Flag if the linked file no longer exists.
  const exists = await window.api.exists(p.openPath);
  const missing = row.querySelector('.project-missing');
  if (missing) missing.hidden = !!exists;
}

/* ------------------------------------------------------------------ *
 * Wire up events
 * ------------------------------------------------------------------ */
function wire() {
  document.getElementById('addTrackBtn').addEventListener('click', () => openTrackModal(null));
  document.getElementById('closeTrackModal').addEventListener('click', closeTrackModal);
  document.getElementById('cancelTrackBtn').addEventListener('click', closeTrackModal);
  document.getElementById('saveTrackBtn').addEventListener('click', saveTrackFromModal);
  document.getElementById('deleteTrackBtn').addEventListener('click', deleteCurrentTrack);

  document.getElementById('addChecklistForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newCheckItem');
    const text = input.value.trim();
    if (!text) return;
    modalChecklist.push({ id: uid(), text, done: false });
    input.value = '';
    renderModalChecklist();
  });

  document.getElementById('addAttachmentBtn').addEventListener('click', addAttachments);
  document.getElementById('applyTemplateBtn').addEventListener('click', applyTemplate);
  document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);
  document.getElementById('delTemplateBtn').addEventListener('click', deleteTemplate);

  document.getElementById('addFixForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const timeEl = document.getElementById('newFixTime');
    const textEl = document.getElementById('newFixText');
    const text = textEl.value.trim();
    if (!text) return;
    const at = parseTime(timeEl.value);
    modalFixes.push({ id: uid(), at: at == null ? 0 : at, text, done: false });
    timeEl.value = '';
    textEl.value = '';
    renderModalFixes();
  });

  document.getElementById('addFeedbackForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const whoEl = document.getElementById('newFeedbackWho');
    const textEl = document.getElementById('newFeedbackText');
    const text = textEl.value.trim();
    if (!text) return;
    modalFeedback.push({ id: uid(), who: whoEl.value.trim(), text, at: Date.now() });
    whoEl.value = '';
    textEl.value = '';
    renderModalFeedback();
  });

  document.getElementById('editStagesBtn').addEventListener('click', openStagesModal);
  document.getElementById('closeStagesModal').addEventListener('click', () => (document.getElementById('stagesModal').hidden = true));
  document.getElementById('doneStagesBtn').addEventListener('click', () => (document.getElementById('stagesModal').hidden = true));
  document.getElementById('addStageForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newStageName');
    const name = input.value.trim();
    if (!name) return;
    addStage(name);
    input.value = '';
  });

  document.getElementById('addSceneBtn').addEventListener('click', addScene);
  document.getElementById('renameSceneBtn').addEventListener('click', renameScene);
  document.getElementById('deleteSceneBtn').addEventListener('click', deleteScene);

  document.getElementById('projectsBtn').addEventListener('click', openProjectsModal);
  document.getElementById('closeProjectsModal').addEventListener('click', () => (document.getElementById('projectsModal').hidden = true));
  document.getElementById('doneProjectsBtn').addEventListener('click', () => (document.getElementById('projectsModal').hidden = true));
  document.getElementById('addFolderBtn').addEventListener('click', addFolder);
  document.getElementById('rescanBtn').addEventListener('click', refreshInbox);
  document.getElementById('addAllBtn').addEventListener('click', addAllProjects);

  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', importBackup);

  document.getElementById('accentPicker').addEventListener('input', (e) => {
    state.accent = e.target.value;
    applyAccent(state.accent);
    save();
  });

  // close modals on overlay click / Esc
  document.querySelectorAll('.modal-overlay').forEach((ov) =>
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) ov.hidden = true;
    })
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach((ov) => (ov.hidden = true));
  });
}

wire();
boot();
