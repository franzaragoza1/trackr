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
    tracks: []
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
  if (!state.accent) state.accent = '#5b8cff';
  applyAccent(state.accent);
  document.getElementById('accentPicker').value = state.accent;
  render();
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
        track.stageId = stage.id;
        track.updatedAt = Date.now();
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
  if (track.bpm) meta.push(`<span class="chip">${escapeHtml(track.bpm)} BPM</span>`);
  if (track.key) meta.push(`<span class="chip">${escapeHtml(track.key)}</span>`);
  if (track.label) meta.push(`<span class="chip">${escapeHtml(track.label)}</span>`);

  const done = (track.checklist || []).filter((i) => i.done).length;
  const totalItems = (track.checklist || []).length;

  card.innerHTML = `
    <div class="card-title">${escapeHtml(track.title || 'Untitled')}</div>
    ${meta.length ? `<div class="card-meta">${meta.join('')}</div>` : ''}
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="card-foot">
      <span>${totalItems ? `${done}/${totalItems} done` : 'No checklist'}</span>
      <span>${pct}%</span>
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
let modalChecklist = []; // working copy while modal open

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
  renderModalChecklist();

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

function saveTrackFromModal() {
  const scene = activeScene();
  const payload = {
    title: document.getElementById('tTitle').value.trim() || 'Untitled',
    bpm: document.getElementById('tBpm').value.trim(),
    key: document.getElementById('tKey').value.trim(),
    label: document.getElementById('tLabel').value.trim(),
    notes: document.getElementById('tNotes').value,
    stageId: document.getElementById('tStage').value,
    checklist: modalChecklist
  };

  if (editingTrackId) {
    const track = scene.tracks.find((t) => t.id === editingTrackId);
    Object.assign(track, payload, { updatedAt: Date.now() });
  } else {
    scene.tracks.push({ id: uid(), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
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
  affected.forEach((t) => (t.stageId = first));
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
  const scene = { id: uid(), name: name.trim(), stages: makeStages(DEFAULT_STAGES), tracks: [] };
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
