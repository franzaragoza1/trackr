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
  return { version: 1, accent: '#b6f230', activeSceneId: scene.id, scenes: [scene] };
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
  setLang(state.lang || defaultLang());
  applyI18n();
  applyTheme(state.theme);
  document.getElementById('accentPicker').value = state.theme.accent;
  render();
  refreshInbox();
  if (!state.setupDone) openWizard();
}

// Guess a starting language from the OS before the user has chosen one.
function defaultLang() {
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}

// Switch language, persist, re-translate static text and re-render dynamic UI.
function changeLang(lang) {
  setLang(lang);
  state.lang = lang;
  save();
  applyI18n();
  render();
}

/* ------------------------------------------------------------------ *
 * First-run Quick Setup wizard
 * ------------------------------------------------------------------ */
let wizChoice = { proj: '', mix: '', master: '' };

function openWizard() {
  wizChoice = { proj: '', mix: '', master: '' };
  ['wizProjPath', 'wizMixPath', 'wizMasterPath'].forEach((id) => {
    const e = document.getElementById(id);
    e.hidden = true;
    e.textContent = '';
  });
  syncWizControls();
  document.getElementById('setupWizard').hidden = false;
}

function syncWizControls() {
  document.querySelectorAll('#wizLang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
  // Re-label folder buttons (applyI18n resets them to "Choose…" on language change).
  [['proj', 'wizProjBtn'], ['mix', 'wizMixBtn'], ['master', 'wizMasterBtn']].forEach(([k, id]) => {
    document.getElementById(id).textContent = wizChoice[k] ? t('wiz.change') : t('wiz.choose');
  });
}

async function wizPick(kind, pathId) {
  const res = await window.api.chooseFolder();
  if (!res.ok) return;
  wizChoice[kind] = res.folder;
  const pathEl = document.getElementById(pathId);
  pathEl.hidden = false;
  pathEl.textContent = res.folder;
  syncWizControls();
}

function finishWizard() {
  const scene = activeScene();
  if (wizChoice.proj && !scene.scanFolders.includes(wizChoice.proj)) scene.scanFolders.push(wizChoice.proj);
  if (wizChoice.mix && !scene.mediaFolders.some((m) => m.path === wizChoice.mix && m.role === 'mixdown')) {
    scene.mediaFolders.push({ id: uid(), path: wizChoice.mix, role: 'mixdown' });
  }
  if (wizChoice.master && !scene.mediaFolders.some((m) => m.path === wizChoice.master && m.role === 'master')) {
    scene.mediaFolders.push({ id: uid(), path: wizChoice.master, role: 'master' });
  }
  state.setupDone = true;
  if (!state.lang) state.lang = LANG;
  save();
  document.getElementById('setupWizard').hidden = true;
  render();
  refreshInbox();
}

function wireWizard() {
  document.querySelectorAll('#wizLang button').forEach((b) =>
    b.addEventListener('click', () => {
      changeLang(b.dataset.lang);
      syncWizControls();
    })
  );
  document.getElementById('wizProjBtn').addEventListener('click', () => wizPick('proj', 'wizProjPath'));
  document.getElementById('wizMixBtn').addEventListener('click', () => wizPick('mix', 'wizMixPath'));
  document.getElementById('wizMasterBtn').addEventListener('click', () => wizPick('master', 'wizMasterPath'));
  document.getElementById('wizFinishBtn').addEventListener('click', finishWizard);
  document.getElementById('wizSkipBtn').addEventListener('click', finishWizard);
}

/* Normalize older data so newer fields always exist. Grows as features land. */
function migrate(st) {
  if (typeof st.lang !== 'string') st.lang = '';
  if (typeof st.setupDone !== 'boolean') {
    // Existing users (who already have tracks or folders) skip the first-run wizard.
    st.setupDone = (st.scenes || []).some(
      (s) => (s.tracks && s.tracks.length) || (s.scanFolders && s.scanFolders.length) || (s.mediaFolders && s.mediaFolders.length)
    );
  }
  if (!Array.isArray(st.checklistTemplates)) st.checklistTemplates = [];
  if (!st.theme) {
    st.theme = { accent: st.accent || '#b6f230', mode: 'dark', bgType: 'solid', bgColor: '', bgColor2: '#23262f', bgAngle: 135, bgImagePath: '' };
  }
  (st.scenes || []).forEach((scene) => {
    if (!Array.isArray(scene.scanFolders)) scene.scanFolders = [];
    if (!Array.isArray(scene.mediaFolders)) scene.mediaFolders = [];
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
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--on-accent', contrastOn(color)); // readable text on the accent
}

// Pick black or white text for a given accent, by relative luminance (WCAG).
function contrastOn(hex) {
  const c = String(hex).replace('#', '');
  if (c.length < 6) return '#16180f';
  const chan = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
  return L > 0.45 ? '#16180f' : '#ffffff';
}

/* Apply the full theme: mode, accent and background. */
function applyTheme(t) {
  if (!t) return;
  const root = document.documentElement;
  root.setAttribute('data-theme', t.mode === 'light' ? 'light' : 'dark');
  applyAccent(t.accent || '#b6f230');

  const main = document.querySelector('.main');
  if (!main) return;
  let bg = '';
  if (t.bgType === 'gradient') {
    bg = `linear-gradient(${t.bgAngle || 135}deg, ${t.bgColor || '#161719'}, ${t.bgColor2 || '#23262f'})`;
  } else if (t.bgType === 'image' && t.bgImagePath) {
    bg = `center / cover no-repeat url("${window.api.mediaUrl(t.bgImagePath)}")`;
  } else if (t.bgType === 'solid' && t.bgColor) {
    bg = t.bgColor;
  }
  main.style.background = bg; // empty string clears to default
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
  document.getElementById('sceneStats').textContent = total
    ? t('stats.line', { n: total, tracks: t(total > 1 ? 'stats.tracks' : 'stats.track'), r: released })
    : t('stats.none');

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
      body.innerHTML = `<div class="empty-col">${t('board.drop')}</div>`;
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
      <span>${totalItems ? t('card.done', { d: done, t: totalItems }) : t('card.noChecklist')}</span>
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
const roleRank = (a) => (a.role === 'master' ? 0 : a.role === 'mixdown' ? 1 : 2);

function renderModalAttachments() {
  const ul = document.getElementById('tAttachments');
  ul.innerHTML = '';
  primaryAudioEl = null;
  if (!modalAttachments.length) {
    ul.innerHTML = `<li class="attach-empty">${t('track.noAttach')}</li>`;
    return;
  }

  // Masters first, then mixdowns, then others; newest first within each.
  const display = modalAttachments.slice().sort((a, b) => roleRank(a) - roleRank(b) || (b.mtime || 0) - (a.mtime || 0));
  // Primary audio (drives fix seeking) = latest master, else latest mixdown, else first audio.
  const firstAudio = display.find((a) => (a.kind || attachKind(a.name)) === 'audio');
  const primaryPath = firstAudio ? firstAudio.path : null;

  display.forEach((att) => {
    const kind = att.kind || attachKind(att.name);
    const li = document.createElement('li');
    li.className = 'attach-item';
    const isAudio = kind === 'audio';
    const roleBadge = att.role ? `<span class="role-badge role-${att.role}">${att.role === 'master' ? 'MASTER' : 'MIX'}</span>` : '';
    li.innerHTML = `
      <div class="attach-row">
        <span class="attach-icon">${kind === 'audio' ? '♪' : kind === 'midi' ? '𝅘𝅥' : '⎙'}</span>
        ${roleBadge}
        <span class="attach-name" title="${escapeHtml(att.path)}">${escapeHtml(att.name)}</span>
        <button class="ghost-btn small attach-reveal" type="button">${t('track.show')}</button>
        <button class="check-del attach-del" type="button" title="${t('track.remove')}">×</button>
      </div>
      ${isAudio ? '<audio class="attach-audio" controls preload="metadata"></audio>' : ''}`;

    if (isAudio) {
      const audio = li.querySelector('.attach-audio');
      audio.src = window.api.mediaUrl(att.path);
      if (att.path === primaryPath) primaryAudioEl = audio;
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
  res.files.forEach((file) => {
    if (modalAttachments.some((a) => a.path === file.path)) return; // dedupe
    modalAttachments.push({ id: uid(), name: file.name, path: file.path, kind: attachKind(file.name) });
  });
  renderModalAttachments();
}

/* ---- Timestamped fixes ---- */
function renderModalFixes() {
  const ul = document.getElementById('tFixes');
  ul.innerHTML = '';
  if (!modalFixes.length) {
    ul.innerHTML = `<li class="attach-empty">${t('track.noFixes')}</li>`;
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
        <button class="fix-time" type="button" title="${t('track.jump')}">${fmtTime(fix.at)}</button>
        <span class="fix-text">${escapeHtml(fix.text)}</span>
        <button class="check-del" type="button" title="${t('track.remove')}">×</button>`;
      li.querySelector('input').addEventListener('change', (e) => {
        fix.done = e.target.checked;
        renderModalFixes();
      });
      li.querySelector('.fix-time').addEventListener('click', () => {
        if (primaryAudioEl) {
          primaryAudioEl.currentTime = fix.at || 0;
          primaryAudioEl.play().catch(() => {});
        } else {
          toast(t('toast.attachAudioSeek'));
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
    ul.innerHTML = `<li class="attach-empty">${t('track.noFeedback')}</li>`;
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
          <span class="feedback-who">${escapeHtml(fb.who || t('track.someone'))}</span>
          <span class="feedback-when">${when}</span>
        </div>
        <div class="feedback-text">${escapeHtml(fb.text)}</div>
        <div class="feedback-actions">
          <button class="ghost-btn small fb-to-task" type="button">${t('track.toTodo')}</button>
          <button class="check-del" type="button" title="${t('track.remove')}">×</button>
        </div>`;
      li.querySelector('.fb-to-task').addEventListener('click', () => {
        modalChecklist.push({ id: uid(), text: fb.text, done: false });
        renderModalChecklist();
        toast(t('toast.addedToChecklist'));
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
    `<option value="">${t('track.applyTpl')}</option>` +
    templates.map((tpl) => `<option value="${tpl.id}">${escapeHtml(tpl.name)} (${tpl.items.length})</option>`).join('');
}

function applyTemplate() {
  const id = document.getElementById('templateSelect').value;
  const tpl = (state.checklistTemplates || []).find((x) => x.id === id);
  if (!tpl) return toast(t('toast.pickTpl'));
  tpl.items.forEach((text) => modalChecklist.push({ id: uid(), text, done: false }));
  renderModalChecklist();
  toast(t('toast.applied', { name: tpl.name }));
}

function saveTemplate() {
  if (!modalChecklist.length) return toast(t('toast.addItemsFirst'));
  const name = prompt(t('prompt.tplName'));
  if (!name || !name.trim()) return;
  state.checklistTemplates.push({
    id: uid(),
    name: name.trim(),
    items: modalChecklist.map((i) => i.text)
  });
  save();
  renderTemplateSelect();
  toast(t('toast.tplSaved'));
}

function deleteTemplate() {
  const id = document.getElementById('templateSelect').value;
  const tpl = (state.checklistTemplates || []).find((x) => x.id === id);
  if (!tpl) return toast(t('toast.pickTplDel'));
  if (!confirm(t('confirm.delTpl', { name: tpl.name }))) return;
  state.checklistTemplates = state.checklistTemplates.filter((x) => x.id !== id);
  save();
  renderTemplateSelect();
  toast(t('toast.tplDeleted'));
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
  toast(t('toast.trackDeleted'));
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
      <button class="stage-move" data-dir="-1" title="${t('stages.up')}">▲</button>
      <button class="stage-move" data-dir="1" title="${t('stages.down')}">▼</button>
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
  if (scene.stages.length <= 1) return toast(t('toast.keepOneStage'));
  const affected = scene.tracks.filter((tr) => tr.stageId === stageId);
  if (affected.length && !confirm(t('confirm.affectedStage', { n: affected.length }))) return;
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
  const name = prompt(t('prompt.sceneName'));
  if (!name || !name.trim()) return;
  const scene = { id: uid(), name: name.trim(), stages: makeStages(DEFAULT_STAGES), tracks: [], scanFolders: [] };
  state.scenes.push(scene);
  state.activeSceneId = scene.id;
  save();
  render();
}

function renameScene() {
  const scene = activeScene();
  const name = prompt(t('prompt.renameScene'), scene.name);
  if (!name || !name.trim()) return;
  scene.name = name.trim();
  save();
  render();
}

function deleteScene() {
  if (state.scenes.length <= 1) return toast(t('toast.needOneScene'));
  const scene = activeScene();
  if (!confirm(t('confirm.deleteScene', { name: scene.name }))) return;
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
  if (res.ok) toast(t('toast.backupExported'));
}

async function importBackup() {
  if (!confirm(t('confirm.import'))) return;
  const res = await window.api.importData();
  if (!res.ok) return res.error && toast(t('toast.importFailed'));
  if (!res.data || !res.data.scenes) return toast(t('toast.notValidBackup'));
  state = res.data;
  migrate(state);
  setLang(state.lang || defaultLang());
  applyI18n();
  applyTheme(state.theme);
  document.getElementById('accentPicker').value = state.theme.accent;
  save();
  render();
  toast(t('toast.backupImported'));
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

// Trailing tokens on a bounce file name: role words + version numbers.
// Handles "Sunset MIX2", "Sunset M1", "Sunset master v3", etc.
const MEDIA_TOKENS = /\s*[([{]?\s*(mixdown|mixes|mix\s?\d*|mastered|master\s?\d*|mstr\s?\d*|md\s?\d*|m\s?\d+|premaster|pre\s?master|bounce|render|wip|final(e)?|def(initivo)?|v\.?\s?\d+|ver\.?\s?\d*|\d{1,3})\s*[)\]}]?\s*$/i;

// Reduce a bounce file name to the project it belongs to.
function mediaKey(name) {
  let s = String(name).toLowerCase().trim();
  s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(MEDIA_TOKENS, '').trim();
  } while (s !== prev && s.length > 1);
  return s || String(name).toLowerCase().trim();
}

// The key a track is matched against (its project name, or its title).
function trackMatchKey(track) {
  return projectKey(track.project && track.project.name ? track.project.name : track.title);
}

// Set of every attachment path already linked anywhere in the scene.
function attachedPaths(scene) {
  const set = new Set();
  scene.tracks.forEach((t) => (t.attachments || []).forEach((a) => set.add(a.path)));
  return set;
}

// Scan the bounce folders and return only the files not yet linked to any track.
async function getUnlinkedBounces() {
  const scene = activeScene();
  if (!scene.mediaFolders || !scene.mediaFolders.length) return [];
  const res = await window.api.scanMedia(scene.mediaFolders);
  if (!res || !res.ok) return [];
  const linked = attachedPaths(scene);
  return res.files
    .filter((f) => !linked.has(f.path))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

// Local best-guess track for a bounce (exact normalized-key match only).
function localGuessTrackId(scene, fileBaseName) {
  const k = mediaKey(fileBaseName);
  const t = scene.tracks.find((tr) => trackMatchKey(tr) === k);
  return t ? t.id : '';
}

// Attach one bounce file to a track.
function attachBounceToTrack(scene, file, trackId) {
  const t = scene.tracks.find((tr) => tr.id === trackId);
  if (!t) return false;
  if (!Array.isArray(t.attachments)) t.attachments = [];
  if (t.attachments.some((a) => a.path === file.path)) return false;
  t.attachments.push({ id: uid(), name: file.fileName, path: file.path, kind: 'audio', role: file.role, mtime: file.mtime });
  return true;
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
  renderMediaFolders();
  renderInbox();
  refreshInbox();
}

function renderMediaFolders() {
  const scene = activeScene();
  const ul = document.getElementById('mediaFolderList');
  ul.innerHTML = '';
  if (!scene.mediaFolders.length) {
    ul.innerHTML = `<li class="folder-empty">${t('projects.noBounceFolders')}</li>`;
    return;
  }
  scene.mediaFolders.forEach((mf) => {
    const li = document.createElement('li');
    li.className = 'folder-row';
    li.innerHTML = `<span class="role-badge role-${mf.role}">${mf.role === 'master' ? 'MASTER' : 'MIX'}</span>
      <span class="folder-path" title="${escapeHtml(mf.path)}">${escapeHtml(mf.path)}</span>
      <button class="icon-btn" title="Remove">×</button>`;
    li.querySelector('.icon-btn').addEventListener('click', () => {
      scene.mediaFolders = scene.mediaFolders.filter((x) => x.id !== mf.id);
      save();
      renderMediaFolders();
    });
    ul.appendChild(li);
  });
}

async function addMediaFolder(role) {
  const res = await window.api.chooseFolder();
  if (!res.ok) return;
  const scene = activeScene();
  if (scene.mediaFolders.some((m) => m.path === res.folder && m.role === role)) return;
  scene.mediaFolders.push({ id: uid(), path: res.folder, role });
  save();
  renderMediaFolders();
}

function renderFolders() {
  const scene = activeScene();
  const ul = document.getElementById('folderList');
  ul.innerHTML = '';
  if (!scene.scanFolders.length) {
    ul.innerHTML = `<li class="folder-empty">${t('projects.noFolders')}</li>`;
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
    empty.textContent = t('inbox.scanning');
    return;
  }

  const groups = unlinkedGroups();
  count.textContent = groups.length ? `(${groups.length})` : '';
  document.getElementById('addAllBtn').style.display = groups.length ? '' : 'none';

  if (!groups.length) {
    empty.hidden = false;
    empty.textContent = scene.scanFolders.length ? t('projects.emptyLinked') : t('projects.emptyNoFolders');
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
          ${g.versions > 1 ? `<span class="chip">${t('inbox.versions', { n: g.versions })}</span>` : ''}
          ${when ? `<span class="inbox-when">${when}</span>` : ''}
        </span>
      </div>
      <button class="primary-btn small add-one">${t('inbox.add')}</button>`;
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
  toast(t('toast.addedTracks', { n: groups.length }));
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
      <span class="project-missing" hidden>${t('proj.missing')}</span>
    </div>
    <div class="project-actions">
      <button class="ghost-btn small" id="openProjectBtn">${t('proj.open')}</button>
      <button class="ghost-btn small" id="revealProjectBtn">${t('proj.reveal')}</button>
      <button class="ghost-btn small" id="unlinkProjectBtn">${t('proj.unlink')}</button>
    </div>`;

  row.querySelector('#openProjectBtn').addEventListener('click', async () => {
    const r = await window.api.openPath(p.openPath);
    if (!r.ok) toast(t('toast.couldNotOpen'));
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
 * Theme builder
 * ------------------------------------------------------------------ */
const DEFAULT_THEME = { accent: '#b6f230', mode: 'dark', bgType: 'solid', bgColor: '', bgColor2: '#23262f', bgAngle: 135, bgImagePath: '' };

function openThemeModal() {
  syncThemeControls();
  document.getElementById('themeModal').hidden = false;
}

// Reflect state.theme into the modal controls and visible bg-control group.
function syncThemeControls() {
  const th = state.theme;
  document.querySelectorAll('#themeLang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
  document.querySelectorAll('#themeMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === (th.mode || 'dark')));
  document.querySelectorAll('#themeBgType button').forEach((b) => b.classList.toggle('active', b.dataset.bg === (th.bgType || 'solid')));
  document.getElementById('themeAccent').value = th.accent || '#b6f230';
  document.getElementById('bgColor1').value = th.bgColor || '#161719';
  document.getElementById('bgGradFrom').value = th.bgColor || '#161719';
  document.getElementById('bgGradTo').value = th.bgColor2 || '#23262f';
  document.getElementById('bgGradAngle').value = th.bgAngle || 135;
  document.getElementById('bgImageName').textContent = th.bgImagePath ? th.bgImagePath.split(/[\\/]/).pop() : '';

  document.getElementById('bgSolidCtl').hidden = th.bgType !== 'solid';
  document.getElementById('bgGradientCtl').hidden = th.bgType !== 'gradient';
  document.getElementById('bgImageCtl').hidden = th.bgType !== 'image';
}

function updateTheme(patch) {
  Object.assign(state.theme, patch);
  applyTheme(state.theme);
  syncThemeControls();
  document.getElementById('accentPicker').value = state.theme.accent;
  save();
}

function wireThemeModal() {
  document.getElementById('themeBtn').addEventListener('click', openThemeModal);
  document.querySelectorAll('#themeLang button').forEach((b) =>
    b.addEventListener('click', () => {
      changeLang(b.dataset.lang);
      syncThemeControls();
    })
  );
  document.getElementById('closeThemeModal').addEventListener('click', () => (document.getElementById('themeModal').hidden = true));
  document.getElementById('doneThemeBtn').addEventListener('click', () => (document.getElementById('themeModal').hidden = true));

  document.querySelectorAll('#themeMode button').forEach((b) =>
    b.addEventListener('click', () => updateTheme({ mode: b.dataset.mode }))
  );
  document.querySelectorAll('#themeBgType button').forEach((b) =>
    b.addEventListener('click', () => updateTheme({ bgType: b.dataset.bg }))
  );

  document.getElementById('themeAccent').addEventListener('input', (e) => updateTheme({ accent: e.target.value }));
  document.getElementById('bgColor1').addEventListener('input', (e) => updateTheme({ bgColor: e.target.value }));
  document.getElementById('bgGradFrom').addEventListener('input', (e) => updateTheme({ bgColor: e.target.value }));
  document.getElementById('bgGradTo').addEventListener('input', (e) => updateTheme({ bgColor2: e.target.value }));
  document.getElementById('bgGradAngle').addEventListener('input', (e) => updateTheme({ bgAngle: parseInt(e.target.value, 10) }));

  document.getElementById('bgImagePick').addEventListener('click', async () => {
    const res = await window.api.pickFiles();
    if (res.ok && res.files.length) updateTheme({ bgImagePath: res.files[0].path });
  });
  document.getElementById('bgImageClear').addEventListener('click', () => updateTheme({ bgImagePath: '' }));

  document.getElementById('themeResetBtn').addEventListener('click', () => {
    state.theme = { ...DEFAULT_THEME };
    applyTheme(state.theme);
    syncThemeControls();
    document.getElementById('accentPicker').value = state.theme.accent;
    save();
  });
}

/* ------------------------------------------------------------------ *
 * Bounces review (manual + AI-proposed linking)
 * ------------------------------------------------------------------ */
let bounceFiles = []; // unlinked bounces currently under review
let bounceChoice = {}; // path -> chosen trackId

async function openBouncesModal() {
  const scene = activeScene();
  if (!scene.mediaFolders || !scene.mediaFolders.length) {
    toast(t('toast.addBounceFolder'));
    return;
  }
  document.getElementById('bouncesModal').hidden = false;
  document.getElementById('bouncesStatus').textContent = t('inbox.scanning');
  document.getElementById('bouncesList').innerHTML = '';
  bounceFiles = await getUnlinkedBounces();
  bounceChoice = {};
  // Seed each choice with a local exact-match guess (still needs confirming).
  bounceFiles.forEach((f) => (bounceChoice[f.path] = localGuessTrackId(scene, f.name)));
  document.getElementById('bouncesStatus').textContent = '';
  renderBouncesList();
}

function trackOptionsHtml(selectedId) {
  const scene = activeScene();
  const opts = [`<option value="">${t('bounces.choose')}</option>`];
  scene.tracks
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((tr) => {
      const label = tr.project && tr.project.name ? tr.project.name : tr.title;
      opts.push(`<option value="${tr.id}"${tr.id === selectedId ? ' selected' : ''}>${escapeHtml(label)}</option>`);
    });
  return opts.join('');
}

function renderBouncesList() {
  const list = document.getElementById('bouncesList');
  const empty = document.getElementById('bouncesEmpty');
  list.innerHTML = '';
  if (!bounceFiles.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  bounceFiles.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'bounce-row';
    const roleBadge = f.role ? `<span class="role-badge role-${f.role}">${f.role === 'master' ? 'MASTER' : 'MIX'}</span>` : '';
    const guessed = bounceChoice[f.path];
    li.innerHTML = `
      <div class="bounce-head">
        ${roleBadge}
        <span class="bounce-name" title="${escapeHtml(f.path)}">${escapeHtml(f.fileName)}</span>
      </div>
      <audio class="bounce-audio" controls preload="metadata"></audio>
      <div class="bounce-actions">
        <select class="bounce-track">${trackOptionsHtml(guessed)}</select>
        <button class="primary-btn small link-one" type="button">${t('bounces.link')}</button>
      </div>`;

    li.querySelector('.bounce-audio').src = window.api.mediaUrl(f.path);
    const sel = li.querySelector('.bounce-track');
    if (guessed) sel.classList.add('has-guess');
    sel.addEventListener('change', () => {
      bounceChoice[f.path] = sel.value;
      sel.classList.toggle('has-guess', !!sel.value);
    });
    li.querySelector('.link-one').addEventListener('click', () => {
      const trackId = sel.value;
      if (!trackId) return toast(t('toast.chooseTrack'));
      linkOneBounce(f, trackId);
    });
    list.appendChild(li);
  });
}

function linkOneBounce(file, trackId) {
  const scene = activeScene();
  if (attachBounceToTrack(scene, file, trackId)) {
    save();
    render();
    bounceFiles = bounceFiles.filter((b) => b.path !== file.path);
    delete bounceChoice[file.path];
    renderBouncesList();
    toast(t('toast.linked'));
  }
}

function linkAllChosen() {
  const scene = activeScene();
  let n = 0;
  bounceFiles.slice().forEach((f) => {
    const trackId = bounceChoice[f.path];
    if (trackId && attachBounceToTrack(scene, f, trackId)) {
      n++;
      bounceFiles = bounceFiles.filter((b) => b.path !== f.path);
      delete bounceChoice[f.path];
    }
  });
  if (n) {
    save();
    render();
    renderBouncesList();
  }
  toast(n ? t('toast.linkedN', { n }) : t('toast.nothingChosen'));
}

// Ask the model to map each bounce to the best project. Fills the dropdowns.
async function aiSuggestBounces() {
  const cfg = await window.api.aiGetConfig();
  if (!aiReady(cfg)) {
    openAiModal();
    return toast(t('toast.setupAi'));
  }
  if (!bounceFiles.length) return;
  const scene = activeScene();
  const tracks = scene.tracks;
  if (!tracks.length) return toast(t('toast.noTracksMatch'));

  const btn = document.getElementById('aiSuggestBouncesBtn');
  const prev = btn.textContent;
  btn.textContent = '✨ Thinking…';
  btn.disabled = true;

  const projList = tracks.map((t, i) => `${i + 1}. ${t.project && t.project.name ? t.project.name : t.title}`).join('\n');
  const fileList = bounceFiles.map((f, i) => `${i + 1}. ${f.fileName}`).join('\n');
  const messages = [
    {
      role: 'system',
      content:
        'You match exported audio bounce files to music projects by name. Mixdowns often end in MIX1/MIX2, masters in M1/M2, but names vary. ' +
        'Return ONLY a JSON array, one object per bounce, like [{"b":1,"p":3},{"b":2,"p":0}] where b is the bounce number and p is the project number (0 if none is a confident match). No prose, no code fences.'
    },
    { role: 'user', content: `Projects:\n${projList}\n\nBounces:\n${fileList}` }
  ];

  const res = await window.api.aiChat(messages);
  btn.textContent = prev;
  btn.disabled = false;
  if (!res.ok) return toast(t('toast.aiError', { err: res.error }));

  let mapping;
  try {
    const clean = res.content.replace(/```json|```/g, '').trim();
    mapping = JSON.parse(clean.slice(clean.indexOf('['), clean.lastIndexOf(']') + 1));
  } catch (e) {
    return toast(t('toast.aiCantRead'));
  }
  let filled = 0;
  mapping.forEach((m) => {
    const f = bounceFiles[m.b - 1];
    const tr = tracks[m.p - 1];
    if (f && tr && m.p > 0) {
      bounceChoice[f.path] = tr.id;
      filled++;
    }
  });
  renderBouncesList();
  toast(filled ? t('toast.aiProposed', { n: filled }) : t('toast.aiNoMatch'));
}

/* ------------------------------------------------------------------ *
 * Insights / analytics
 * ------------------------------------------------------------------ */
const DAY = 86400000;
const STALL_MS = 21 * DAY; // "stuck" if untouched for 3+ weeks and not finished

function humanizeMs(ms) {
  if (ms < 0) ms = 0;
  const days = ms / DAY;
  if (days >= 1) return Math.round(days) + 'd';
  const hours = ms / 3600000;
  if (hours >= 1) return Math.round(hours) + 'h';
  const mins = Math.round(ms / 60000);
  return mins + 'm';
}

function computeInsights(scene) {
  const now = Date.now();
  const stages = scene.stages;
  const finalId = stages.length ? stages[stages.length - 1].id : null;
  const dwell = {}; // stageId -> { total, samples }
  stages.forEach((s) => (dwell[s.id] = { total: 0, samples: 0 }));

  const finished = [];
  const stalled = [];

  scene.tracks.forEach((track) => {
    const hist = (track.stageHistory || []).slice().sort((a, b) => a.at - b.at);
    for (let i = 0; i < hist.length; i++) {
      const sid = hist[i].stageId;
      const start = hist[i].at;
      const end = i + 1 < hist.length ? hist[i + 1].at : now;
      if (dwell[sid]) {
        dwell[sid].total += Math.max(0, end - start);
        dwell[sid].samples++;
      }
    }
    const isFinished = track.stageId === finalId;
    if (isFinished) {
      finished.push(track);
    } else {
      const last = hist.length ? hist[hist.length - 1].at : track.updatedAt || track.createdAt || now;
      const idle = now - last;
      if (idle >= STALL_MS) stalled.push({ track, idle });
    }
  });

  const perStage = stages.map((s) => ({
    id: s.id,
    name: s.name,
    avg: dwell[s.id].samples ? dwell[s.id].total / dwell[s.id].samples : 0,
    samples: dwell[s.id].samples
  }));

  // Bottleneck = non-final stage with the highest average dwell.
  let bottleneck = null;
  perStage.forEach((s) => {
    if (s.id === finalId) return;
    if (s.samples && (!bottleneck || s.avg > bottleneck.avg)) bottleneck = s;
  });

  const total = scene.tracks.length;
  const finishedN = finished.length;
  const ratio = finishedN ? total / finishedN : 0;

  stalled.sort((a, b) => b.idle - a.idle);

  return { total, finishedN, inProgress: total - finishedN, ratio, perStage, bottleneck, finished, stalled, finalId };
}

function openInsightsModal() {
  const scene = activeScene();
  document.getElementById('insightsScene').textContent = scene.name;
  renderInsights(computeInsights(scene));
  document.getElementById('insightsModal').hidden = false;
}

function renderInsights(ins) {
  const body = document.getElementById('insightsBody');
  if (!ins.total) {
    body.innerHTML = `<p class="hint">${t('ins.empty')}</p>`;
    return;
  }

  const maxAvg = Math.max(1, ...ins.perStage.map((s) => s.avg));
  const bars = ins.perStage
    .map((s) => {
      const w = s.avg ? Math.max(3, Math.round((s.avg / maxAvg) * 100)) : 0;
      const isNeck = ins.bottleneck && s.id === ins.bottleneck.id;
      return `
        <div class="stat-bar-row">
          <span class="stat-bar-name">${escapeHtml(s.name)}${isNeck ? ` <span class="neck-tag">${t('ins.bottleneckTag')}</span>` : ''}</span>
          <div class="stat-bar"><div class="stat-bar-fill${isNeck ? ' neck' : ''}" style="width:${w}%"></div></div>
          <span class="stat-bar-val">${s.samples ? humanizeMs(s.avg) : '—'}</span>
        </div>`;
    })
    .join('');

  const stalledList = ins.stalled.length
    ? ins.stalled
        .slice(0, 12)
        .map(
          (x) =>
            `<li class="insight-track" data-id="${x.track.id}"><span>${escapeHtml(x.track.title)}</span><span class="insight-idle">${t('ins.idle', { time: humanizeMs(x.idle) })}</span></li>`
        )
        .join('')
    : `<li class="hint">${t('ins.stuckNone')}</li>`;

  const finishedList = ins.finished.length
    ? ins.finished
        .slice()
        .reverse()
        .slice(0, 20)
        .map((tk) => `<li class="insight-track" data-id="${tk.id}"><span>${escapeHtml(tk.title)}</span></li>`)
        .join('')
    : `<li class="hint">${t('ins.finishedNone')}</li>`;

  body.innerHTML = `
    <div class="stat-tiles">
      <div class="stat-tile"><div class="stat-num">${ins.total}</div><div class="stat-lbl">${t('ins.tracks')}</div></div>
      <div class="stat-tile"><div class="stat-num">${ins.finishedN}</div><div class="stat-lbl">${t('ins.finished')}</div></div>
      <div class="stat-tile"><div class="stat-num">${ins.inProgress}</div><div class="stat-lbl">${t('ins.inProgress')}</div></div>
      <div class="stat-tile"><div class="stat-num">${ins.ratio ? '1 : ' + ins.ratio.toFixed(1) : '—'}</div><div class="stat-lbl">${t('ins.ratio')}</div></div>
    </div>

    ${ins.bottleneck ? `<p class="insight-note">${t('ins.bottleneck', { stage: `<strong>${escapeHtml(ins.bottleneck.name)}</strong>`, time: `<strong>${humanizeMs(ins.bottleneck.avg)}</strong>` })}</p>` : ''}

    <div class="section-head" style="margin-top:6px;">${t('ins.avgPerStage')}</div>
    <div class="stat-bars">${bars}</div>

    <div class="section-head">${t('ins.stuck')} <span class="hint tiny">${t('ins.stuckHint')}</span></div>
    <ul class="insight-list">${stalledList}</ul>

    <div class="section-head">${t('ins.finished')}</div>
    <ul class="insight-list wall">${finishedList}</ul>`;

  // Click a track name to open it.
  body.querySelectorAll('.insight-track').forEach((li) =>
    li.addEventListener('click', () => {
      document.getElementById('insightsModal').hidden = true;
      openTrackModal(li.dataset.id);
    })
  );
}

/* ------------------------------------------------------------------ *
 * AI assistant (OpenRouter)
 * ------------------------------------------------------------------ */
let aiHistory = []; // {role, content} for the current chat session

// Build a compact, text-only snapshot of the active scene for the model.
function aiContext() {
  const scene = activeScene();
  const stageName = (id) => (scene.stages.find((s) => s.id === id) || {}).name || '?';
  const now = Date.now();
  const lines = scene.tracks
    .map((t) => {
      const pct = progressOf(t);
      const todos = (t.checklist || []).filter((i) => !i.done).length;
      const openFixes = (t.fixes || []).filter((f) => !f.done).length;
      const last = (t.stageHistory || []).length ? t.stageHistory[t.stageHistory.length - 1].at : t.updatedAt || now;
      const idleDays = Math.round((now - last) / 86400000);
      return `- "${t.title}" | ${stageName(t.stageId)} | ${pct}% | ${todos} to-dos${openFixes ? ` | ${openFixes} fixes` : ''} | idle ${idleDays}d`;
    })
    .join('\n');
  return (
    `You are the assistant built into "Track Manager", a music producer's project manager. ` +
    `Be concise, practical and encouraging. Help the producer decide what to work on, unblock stuck tracks and stay organized.\n\n` +
    `Workspace: "${scene.name}". Stages: ${scene.stages.map((s) => s.name).join(' → ')}.\n` +
    `Tracks (${scene.tracks.length}):\n${lines || '(none yet)'}`
  );
}

function aiRenderText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function aiAppendMessage(role, html) {
  const wrap = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-msg ai-' + role;
  div.innerHTML = `<div class="ai-bubble">${html}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

// Is the assistant usable right now (free mode available, or a user key set)?
function aiReady(cfg) {
  return cfg && (cfg.mode === 'free' ? cfg.freeAvailable : cfg.hasKey);
}

// Three views inside the panel: pick a mode, enter a key, or chat.
function setAiView(view) {
  document.getElementById('aiChooser').hidden = view !== 'chooser';
  document.getElementById('aiSettings').hidden = view !== 'settings';
  document.getElementById('aiChatArea').hidden = view !== 'chat';
}

function updateModeBadge(cfg) {
  const badge = document.getElementById('aiModeBadge');
  if (aiReady(cfg)) {
    badge.textContent = cfg.mode === 'free' ? t('ai.badgeFree') : t('ai.badgeKey');
    badge.className = 'ai-mode-badge ' + (cfg.mode === 'free' ? 'mode-free' : 'mode-key');
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function aiGreetIfNeeded() {
  if (!aiHistory.length) {
    document.getElementById('aiMessages').innerHTML = '';
    aiAppendMessage('assistant', aiRenderText(t('ai.greet')));
  }
}

async function openAiModal() {
  document.getElementById('app').classList.add('assistant-open');
  document.getElementById('assistantPanel').hidden = false;
  const cfg = await window.api.aiGetConfig();
  document.getElementById('aiModel').value = cfg.model || '';
  document.getElementById('aiFreeUnavailable').hidden = cfg.freeAvailable;
  updateModeBadge(cfg);
  if (aiReady(cfg)) {
    setAiView('chat');
    aiGreetIfNeeded();
    document.getElementById('aiInput').focus();
  } else {
    setAiView('chooser');
  }
}

function closeAssistant() {
  document.getElementById('app').classList.remove('assistant-open');
  document.getElementById('assistantPanel').hidden = true;
}

function toggleAssistant() {
  if (document.getElementById('assistantPanel').hidden) openAiModal();
  else closeAssistant();
}

async function sendAiMessage(text) {
  aiAppendMessage('user', aiRenderText(text));
  aiHistory.push({ role: 'user', content: text });
  const pending = aiAppendMessage('assistant', '<span class="ai-typing">thinking…</span>');
  const messages = [{ role: 'system', content: aiContext() }, ...aiHistory];
  const res = await window.api.aiChat(messages);
  const bubble = pending.querySelector('.ai-bubble');
  if (res.ok) {
    bubble.innerHTML = aiRenderText(res.content);
    aiHistory.push({ role: 'assistant', content: res.content });
  } else {
    bubble.innerHTML = `<span class="ai-error">⚠ ${escapeHtml(res.error || 'AI request failed')}</span>`;
    if (/no api key/i.test(res.error || '')) setAiView('chooser');
  }
  document.getElementById('aiMessages').scrollTop = document.getElementById('aiMessages').scrollHeight;
}

async function saveAiConfig() {
  const key = document.getElementById('aiKey').value;
  const model = document.getElementById('aiModel').value;
  await window.api.aiSetConfig({ key, model });
  document.getElementById('aiKey').value = '';
  const cfg = await window.api.aiGetConfig();
  updateModeBadge(cfg);
  if (cfg.hasKey) {
    setAiView('chat');
    aiGreetIfNeeded();
    toast(t('toast.aiReady'));
  } else {
    toast(t('toast.enterKey'));
  }
}

// Generate checklist items for the track currently open in the modal.
async function aiSuggestChecklist() {
  const cfg = await window.api.aiGetConfig();
  if (!aiReady(cfg)) {
    openAiModal();
    return toast(t('toast.setupAi'));
  }
  const title = document.getElementById('tTitle').value.trim() || 'this track';
  const stageSel = document.getElementById('tStage');
  const stageName = stageSel.options[stageSel.selectedIndex] ? stageSel.options[stageSel.selectedIndex].text : '';
  const btn = document.getElementById('aiChecklistBtn');
  const prev = btn.textContent;
  btn.textContent = '✨ …';
  btn.disabled = true;
  const messages = [
    { role: 'system', content: 'You generate concise music-production checklists. Output ONLY the list, one short actionable item per line, no numbering, no headings, no extra prose.' },
    { role: 'user', content: `Checklist for the track "${title}" at the "${stageName}" stage. 6-9 items.` }
  ];
  const res = await window.api.aiChat(messages);
  btn.textContent = prev;
  btn.disabled = false;
  if (!res.ok) return toast(t('toast.aiError', { err: res.error }));
  const items = res.content
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 15);
  if (!items.length) return toast(t('toast.noSuggestions'));
  items.forEach((text) => modalChecklist.push({ id: uid(), text, done: false }));
  renderModalChecklist();
  toast(t('toast.added', { n: items.length }));
}

function wireAi() {
  document.getElementById('assistantBtn').addEventListener('click', toggleAssistant);
  document.getElementById('closeAiPanel').addEventListener('click', closeAssistant);
  document.getElementById('aiSettingsBtn').addEventListener('click', async () => {
    const cfg = await window.api.aiGetConfig();
    document.getElementById('aiFreeUnavailable').hidden = cfg.freeAvailable;
    setAiView('chooser'); // gear -> back to Free / key choice
  });

  document.getElementById('aiUseFreeBtn').addEventListener('click', async () => {
    const cfg = await window.api.aiGetConfig();
    if (!cfg.freeAvailable) {
      document.getElementById('aiFreeUnavailable').hidden = false;
      return;
    }
    await window.api.aiSetMode('free');
    updateModeBadge({ ...cfg, mode: 'free' });
    setAiView('chat');
    aiGreetIfNeeded();
    document.getElementById('aiInput').focus();
  });
  document.getElementById('aiUseKeyBtn').addEventListener('click', () => setAiView('settings'));

  document.getElementById('aiSaveConfigBtn').addEventListener('click', saveAiConfig);
  document.getElementById('aiClearKeyBtn').addEventListener('click', async () => {
    await window.api.aiClearKey();
    aiHistory = [];
    document.getElementById('aiMessages').innerHTML = '';
    updateModeBadge(null);
    setAiView('chooser');
    toast(t('toast.signedOut'));
  });
  document.getElementById('aiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('aiInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendAiMessage(text);
  });
  document.getElementById('aiChecklistBtn').addEventListener('click', aiSuggestChecklist);
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

  document.getElementById('insightsBtn').addEventListener('click', openInsightsModal);
  document.getElementById('closeInsightsModal').addEventListener('click', () => (document.getElementById('insightsModal').hidden = true));
  document.getElementById('doneInsightsBtn').addEventListener('click', () => (document.getElementById('insightsModal').hidden = true));

  document.getElementById('projectsBtn').addEventListener('click', openProjectsModal);
  document.getElementById('closeProjectsModal').addEventListener('click', () => (document.getElementById('projectsModal').hidden = true));
  document.getElementById('doneProjectsBtn').addEventListener('click', () => (document.getElementById('projectsModal').hidden = true));
  document.getElementById('addFolderBtn').addEventListener('click', addFolder);
  document.getElementById('rescanBtn').addEventListener('click', refreshInbox);
  document.getElementById('addAllBtn').addEventListener('click', addAllProjects);
  document.getElementById('addMixFolderBtn').addEventListener('click', () => addMediaFolder('mixdown'));
  document.getElementById('addMasterFolderBtn').addEventListener('click', () => addMediaFolder('master'));
  document.getElementById('reviewBouncesBtn').addEventListener('click', openBouncesModal);

  document.getElementById('closeBouncesModal').addEventListener('click', () => (document.getElementById('bouncesModal').hidden = true));
  document.getElementById('doneBouncesBtn').addEventListener('click', () => (document.getElementById('bouncesModal').hidden = true));
  document.getElementById('aiSuggestBouncesBtn').addEventListener('click', aiSuggestBounces);
  document.getElementById('linkShownBouncesBtn').addEventListener('click', linkAllChosen);

  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', importBackup);

  document.getElementById('accentPicker').addEventListener('input', (e) => {
    state.theme.accent = e.target.value;
    applyTheme(state.theme);
    save();
  });

  wireThemeModal();
  wireAi();
  wireWizard();

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
