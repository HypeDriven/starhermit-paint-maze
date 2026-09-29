// Paint Maze controller: screens, input, level flow, persistence and settings.
import * as rules from './rules.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import * as gfx from './gfx.js';
import { t, setLocale, getLocale, matchLocale, LOCALES, LOCALE_NAMES } from './i18n.js';
import { loadProfile, saveProfile, recordResult, cloudDoc, mergeRemote } from './storage.js';
import * as platform from './platform.js';

const $ = (id) => document.getElementById(id);
const DIR_OF_KEY = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R' };

const game = {
  levels: [], worlds: [],
  profile: loadProfile(),
  idx: 0, level: null, board: null, state: null, history: [], dirs: '',
  pending: 0, anim: Promise.resolve(), finished: false,
  renderer: null, audio: new Audio(), detected: 'balanced', hosted: false,
};

/* ---------------- boot ---------------- */

function detectGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '');
  } catch { return null; }
}

async function boot() {
  const s = game.profile.settings;
  setLocale(s.locale || matchLocale(navigator.language));
  game.gpuName = detectGpu();
  game.detected = gfx.detectTier(game.gpuName, { touch: matchMedia('(pointer: coarse)').matches });
  game.renderer = new Renderer($('board'), { fpsEl: $('fps') });
  applyGraphics();
  applyMotion();
  game.audio.setVolume(s.volume ?? 0.7);
  applyI18n();
  bindUi();
  game.hosted = platform.boot({
    onName: (name) => { const h = $('hello'); h.textContent = t('hello', { name }); h.hidden = false; },
    onRemote: (doc) => {
      if (!mergeRemote(game.profile, doc)) return;
      saveProfile(game.profile);
      refreshTitle();
      if (document.body.dataset.screen === 'levels') renderLevels();
    },
    onSync: showSync,
  });
  try {
    const res = await fetch('data/levels.json');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    game.levels = data.levels;
    game.worlds = data.worlds;
  } catch {
    const e = $('load-error');
    e.textContent = t('loadError');
    e.hidden = false;
    $('btn-play').disabled = true;
    $('btn-levels').disabled = true;
  }
  refreshTitle();
  document.body.dataset.ready = 'true';
}

/* ---------------- i18n ---------------- */

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('.dir').forEach((b) => { b.setAttribute('aria-label', t('rollAria', { dir: t('dir.' + b.dataset.dir) })); });
  refreshTitle();
  if (game.level) updateHud();
  if (document.body.dataset.screen === 'levels') renderLevels();
}

/* ---------------- screens ---------------- */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  document.body.dataset.screen = name;
  if (name === 'game') requestAnimationFrame(() => game.renderer.resize());
}

function openOverlay(id) {
  const o = $('overlay-' + id);
  o.hidden = false;
  (o.querySelector('.btn.primary') || o.querySelector('.btn'))?.focus();
}
function closeOverlay(id) { $('overlay-' + id).hidden = true; }
const anyOverlay = () => [...document.querySelectorAll('.overlay')].find((o) => !o.hidden);

const totalStars = () => Object.values(game.profile.progress).reduce((s, r) => s + r.stars, 0);
const isDone = (i) => !!game.profile.progress[game.levels[i]?.id];
const isUnlocked = (i) => i === 0 || isDone(i) || isDone(i - 1);
const worldName = (w) => t('world.' + w);
const levelNumber = (i) => i - game.levels.findIndex((l) => l.world === game.levels[i].world) + 1;

function refreshTitle() {
  if (!game.levels.length) return;
  $('title-stars').textContent = t('starsTotal', { n: totalStars(), total: game.levels.length * 3 });
  const cur = game.profile.current && game.levels.findIndex((l) => l.id === game.profile.current.id);
  const started = Object.keys(game.profile.progress).length > 0 || (cur != null && cur >= 0);
  $('btn-play').textContent = t(started ? 'continue' : 'play');
}

function nextLevelIndex() {
  const cur = game.profile.current && game.levels.findIndex((l) => l.id === game.profile.current.id);
  if (cur != null && cur >= 0) return cur;
  const first = game.levels.findIndex((l, i) => !isDone(i));
  return first < 0 ? 0 : first;
}

function renderLevels() {
  $('levels-stars').textContent = `★ ${totalStars()} / ${game.levels.length * 3}`;
  const list = $('world-list');
  list.innerHTML = '';
  const current = nextLevelIndex();
  for (const w of game.worlds) {
    const idxs = game.levels.map((l, i) => (l.world === w ? i : -1)).filter((i) => i >= 0);
    const stars = idxs.reduce((s, i) => s + (game.profile.progress[game.levels[i].id]?.stars || 0), 0);
    const sec = document.createElement('section');
    sec.className = 'world' + (isUnlocked(idxs[0]) ? '' : ' locked');
    sec.dataset.world = w;
    sec.innerHTML = `<h3><span>${worldName(w)}</span><small>★ ${stars} / ${idxs.length * 3}</small></h3><div class="level-grid"></div>`;
    const grid = sec.querySelector('.level-grid');
    for (const i of idxs) {
      const r = game.profile.progress[game.levels[i].id];
      const b = document.createElement('button');
      b.className = 'btn level-btn' + (r ? ' done' : '') + (i === current ? ' current' : '');
      b.dataset.level = game.levels[i].id;
      const unlocked = isUnlocked(i);
      b.disabled = !unlocked;
      const n = levelNumber(i);
      b.innerHTML = `<span class="n">${unlocked ? n : '🔒'}</span><span class="s">${r ? '★'.repeat(r.stars) : ''}</span>`;
      b.setAttribute('aria-label', `${t('level', { n })}${unlocked ? '' : ' — ' + t('locked')}${r ? ` — ${r.stars}★` : ''}`);
      b.addEventListener('click', () => startLevel(i));
      grid.appendChild(b);
    }
    list.appendChild(sec);
  }
  list.querySelector('.level-btn.current')?.scrollIntoView({ block: 'center' });
}

/* ---------------- level flow ---------------- */

function startLevel(i, { fresh = false } = {}) {
  game.idx = i;
  game.level = game.levels[i];
  game.board = rules.parseLevel(game.level);
  game.history = [];
  game.dirs = '';
  game.finished = false;
  game.pending = 0;
  game.anim = Promise.resolve();
  let state = rules.createState(game.board);
  const cur = game.profile.current;
  if (!fresh && cur && cur.id === game.level.id && cur.dirs) {
    // Resume: replay the saved rolls, keeping each step for undo.
    let s = state;
    for (const d of cur.dirs) {
      const r = rules.roll(game.board, s, d);
      if (!r) break;
      game.history.push(s);
      s = r.state;
      game.dirs += d;
    }
    state = s;
  }
  game.state = state;
  document.body.dataset.world = game.level.world;
  $('level-title').textContent = t('levelOf', { world: worldName(game.level.world), n: levelNumber(i) });
  $('board').setAttribute('aria-label', `${t('level', { n: levelNumber(i) })}: ${game.board.cells.length}`);
  showTip();
  closeOverlay('complete');
  showScreen('game');
  game.renderer.setLevel(game.board, state, game.level.world);
  updateHud();
  saveCurrent();
}

function showTip() {
  const i = game.idx;
  const firstOfWorld = i > 0 && game.levels[i - 1].world !== game.levels[i].world;
  const key = i === 0 ? 'tut1' : i === 1 ? 'tut2' : i === 2 ? 'tut3' : firstOfWorld && game.levels[i].world === game.worlds[1] ? 'tutWorld' : null;
  const tip = $('tip');
  tip.hidden = !key;
  if (key) tip.textContent = t(key);
}

function updateHud() {
  const { state, level, board } = game;
  $('hud-moves').textContent = state.moves;
  $('hud-par').textContent = level.par;
  $('hud-left').textContent = state.remaining;
  const stars = rules.starsFor(Math.max(state.moves, 1), level.par);
  $('hud-stars').innerHTML = [1, 2, 3].map((k) => `<span class="${k <= stars ? '' : 'off'}">★</span>`).join('');
  const legal = new Set(game.finished ? [] : rules.legalDirs(board, state));
  document.querySelectorAll('.dir').forEach((b) => { b.disabled = !legal.has(b.dataset.dir); });
  $('btn-undo').disabled = !game.history.length || game.finished || game.pending > 0;
  $('btn-restart').disabled = !game.history.length || game.finished || game.pending > 0;
  $('btn-hint').disabled = game.finished || game.pending > 0;
  document.body.dataset.moves = state.moves;
  document.body.dataset.remaining = state.remaining;
}

function saveCurrent() {
  game.profile.current = game.finished ? null : { id: game.level.id, dirs: game.dirs };
  persist();
}

function persist() {
  saveProfile(game.profile);
  if (game.hosted) platform.pushCloud(() => cloudDoc(game.profile));
}

function announce(msg) { $('status').textContent = msg; }

function roll(dir) {
  if (game.finished || !game.level || anyOverlay()) return;
  game.audio.unlock();
  const r = rules.roll(game.board, game.state, dir);
  if (!r) {
    if (!game.pending) game.renderer.bump(dir);
    game.audio.play('bump', { gain: 0.6 });
    announce(t('blocked'));
    return;
  }
  // The logical state advances at once; animations play back in order.
  game.history.push(game.state);
  game.dirs += dir;
  const from = game.state.pos;
  game.state = r.state;
  const done = rules.isComplete(r.state);
  if (done) game.finished = true;
  else saveCurrent();
  game.pending++;
  updateHud();
  const level = game.level;
  game.anim = game.anim.then(async () => {
    if (game.level !== level) return;
    game.audio.play('roll', { gain: 0.5, rate: 0.9 + Math.random() * 0.2 });
    await game.renderer.animateRoll(from, dir, r.path, r.newly, r.state);
    game.audio.play(r.newly.length ? 'splat' : 'stop', { gain: r.newly.length ? 0.55 : 0.7 });
    announce(t('rolled', { dir: t('dir.' + dir), n: r.newly.length, left: r.state.remaining }));
  }).finally(() => {
    game.pending--;
    if (game.level !== level) return;
    updateHud();
    if (done) finish();
  });
}

function finish() {
  const { level, state } = game;
  const stars = rules.starsFor(state.moves, level.par);
  const hadRecord = !!game.profile.progress[level.id];
  const newBest = recordResult(game.profile, level.id, state.moves, stars);
  saveCurrent();
  updateHud();
  $('tip').hidden = true;
  game.renderer.celebrate();
  const last = game.idx === game.levels.length - 1;
  const worldEnd = last || game.levels[game.idx + 1].world !== level.world;
  game.audio.play(last ? 'finale' : worldEnd ? 'world' : 'complete');
  if (stars === 3) setTimeout(() => game.audio.play('perfect', { gain: 0.6 }), 350);
  $('complete-stars').innerHTML = [1, 2, 3].map((k) => `<span class="${k <= stars ? '' : 'off'}">★</span>`).join('');
  $('complete-title').textContent = worldEnd ? t('worldDone', { world: worldName(level.world) }) : t('complete');
  $('complete-sub').textContent = t('completeSub', { moves: state.moves, par: level.par });
  $('complete-extra').textContent = last ? t('allDone') : hadRecord && newBest ? t('newBest') : '';
  $('btn-next').hidden = last;
  document.body.dataset.stars = stars;
  setTimeout(() => { if (game.finished && game.level === level) openOverlay('complete'); }, game.renderer.reducedMotion ? 150 : 750);
}

function undo() {
  if (game.pending || game.finished || !game.history.length) return;
  game.state = game.history.pop();
  game.dirs = game.dirs.slice(0, -1);
  game.renderer.setState(game.state);
  game.audio.play('undo', { gain: 0.4, rate: 1.2 });
  updateHud();
  saveCurrent();
}

function restart() {
  if (game.pending || game.finished || !game.history.length) return;
  game.profile.current = null;
  startLevel(game.idx, { fresh: true });
}

function hint() {
  if (game.pending || game.finished || !game.level) return;
  const sol = rules.solve(game.board, game.state, 80000);
  game.audio.play('hint', { gain: 0.4 });
  if (!sol) { game.renderer.showHint(null); announce(t('hintStuck')); flashTip(t('hintStuck')); return; }
  const dir = sol[0];
  game.renderer.showHint(dir);
  document.querySelectorAll('.dir').forEach((b) => b.classList.toggle('primary', b.dataset.dir === dir));
  announce(t('hintMsg', { dir: t('dir.' + dir) }));
  flashTip(t('hintMsg', { dir: t('dir.' + dir) }));
}

function flashTip(msg) {
  const tip = $('tip');
  tip.textContent = msg;
  tip.hidden = false;
}

function clearHintMarks() { document.querySelectorAll('.dir.primary').forEach((b) => b.classList.remove('primary')); }

/* ---------------- settings ---------------- */

function gfxSettings() { return gfx.sanitize(game.profile.settings.gfx); }

function applyGraphics() {
  const q = gfx.resolve(game.profile.settings.gfx, game.detected);
  document.body.dataset.gfxPreset = q.preset;
  game.renderer.setQuality(q);
  return q;
}

function applyMotion() {
  const pref = game.profile.settings.reducedMotion;
  const on = pref == null ? matchMedia('(prefers-reduced-motion: reduce)').matches : pref;
  game.renderer.setReducedMotion(on);
  $('set-motion').checked = on;
}

function saveSettings() { persist(); }

function renderSettings() {
  const s = game.profile.settings;
  const loc = $('set-locale');
  loc.innerHTML = LOCALES.map((l) => `<option value="${l}">${LOCALE_NAMES[l]}</option>`).join('');
  loc.value = getLocale();
  $('set-volume').value = Math.round((s.volume ?? 0.7) * 100);
  renderGraphicsPanel();
}

function renderGraphicsPanel() {
  const saved = gfxSettings();
  const q = gfx.resolve(saved, game.detected);
  const sel = $('gfx-preset');
  sel.innerHTML = [['auto', t('auto', { tier: t(game.detected) })], ...gfx.PRESETS.map((p) => [p, t(p)])]
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = saved.preset;
  $('gfx-scale').value = Math.round(saved.renderScale * 100);
  $('gfx-scale-val').textContent = Math.round(saved.renderScale * 100) + ' %';
  const optLabel = (v) => t(v === 'low' || v === 'high' ? 'opt.' + v : v);
  $('gfx-cats').innerHTML = Object.entries(gfx.CATEGORIES).map(([cat, values]) => {
    const fromPreset = t('fromPreset', { v: optLabel(gfx.presetValue(q.preset, cat)) });
    const opts = [['', fromPreset], ...values.map((v) => [v, optLabel(v)])]
      .map(([v, l]) => `<option value="${v}" ${(saved.overrides[cat] || '') === v ? 'selected' : ''}>${l}</option>`).join('');
    return `<label class="field"><span>${t('cat.' + cat)}</span><select data-cat="${cat}">${opts}</select></label>`;
  }).join('');
  $('gfx-adaptive').checked = saved.adaptive;
  $('gfx-fps').checked = saved.showFps;
  const effects = gfx.activeEffects(q).map((k) => t('cat.' + k).toLowerCase()).join(', ') || t('noEffects');
  const px = game.renderer.pixelSize;
  $('gfx-summary').textContent = `${game.gpuName || 'GPU ?'} · ` + t('gfxSummary', { effects, w: px.w, h: px.h });
}

function updateGfx(mut) {
  const s = gfxSettings();
  mut(s);
  game.profile.settings.gfx = gfx.sanitize(s);
  applyGraphics();
  renderGraphicsPanel();
  saveSettings();
}

function selectTab(name) {
  for (const n of ['general', 'graphics']) {
    const on = n === name;
    $('tab-' + n).setAttribute('aria-selected', String(on));
    $('panel-' + n).hidden = !on;
  }
}

let syncTimer = null;
function showSync(status) {
  const el = $('sync');
  el.textContent = t(status === 'saving' ? 'syncSaving' : status === 'synced' ? 'syncSynced' : 'syncError');
  el.dataset.status = status;
  el.hidden = false;
  clearTimeout(syncTimer);
  if (status === 'synced') syncTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

/* ---------------- input ---------------- */

function bindUi() {
  $('btn-play').addEventListener('click', () => { game.audio.unlock(); startLevel(nextLevelIndex()); });
  $('btn-levels').addEventListener('click', () => { game.audio.unlock(); renderLevels(); showScreen('levels'); });
  $('btn-howto').addEventListener('click', () => openOverlay('howto'));
  const openSettings = () => { renderSettings(); selectTab('general'); openOverlay('settings'); };
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-game').addEventListener('click', openSettings);
  $('btn-menu').addEventListener('click', () => { renderLevels(); showScreen('levels'); });
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { refreshTitle(); showScreen(b.dataset.goto); }));
  document.querySelectorAll('.close-overlay').forEach((b) => b.addEventListener('click', () => closeOverlay(b.closest('.overlay').id.replace('overlay-', ''))));
  document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => {
    if (e.target === o && o.id !== 'overlay-complete') o.hidden = true;
  }));

  document.querySelectorAll('.dir').forEach((b) => b.addEventListener('click', () => { clearHintMarks(); roll(b.dataset.dir); }));
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', restart);
  $('btn-hint').addEventListener('click', hint);
  $('btn-next').addEventListener('click', () => startLevel(Math.min(game.idx + 1, game.levels.length - 1)));
  $('btn-replay').addEventListener('click', () => startLevel(game.idx, { fresh: true }));
  $('btn-complete-levels').addEventListener('click', () => { closeOverlay('complete'); renderLevels(); showScreen('levels'); });

  // Settings controls.
  $('tab-general').addEventListener('click', () => selectTab('general'));
  $('tab-graphics').addEventListener('click', () => { selectTab('graphics'); renderGraphicsPanel(); });
  $('set-locale').addEventListener('change', (e) => {
    game.profile.settings.locale = e.target.value;
    setLocale(e.target.value);
    applyI18n();
    renderSettings();
    if (game.level) {
      $('level-title').textContent = t('levelOf', { world: worldName(game.level.world), n: levelNumber(game.idx) });
      if (!game.finished) showTip();
    }
    saveSettings();
  });
  $('set-volume').addEventListener('input', (e) => {
    game.profile.settings.volume = e.target.value / 100;
    game.audio.unlock();
    game.audio.setVolume(game.profile.settings.volume);
  });
  $('set-volume').addEventListener('change', () => { game.audio.play('stop', { gain: 0.8 }); saveSettings(); });
  $('set-motion').addEventListener('change', (e) => { game.profile.settings.reducedMotion = e.target.checked; applyMotion(); saveSettings(); });
  $('gfx-preset').addEventListener('change', (e) => updateGfx((s) => Object.assign(s, gfx.choosePreset(s, e.target.value))));
  $('gfx-scale').addEventListener('input', (e) => { $('gfx-scale-val').textContent = e.target.value + ' %'; });
  $('gfx-scale').addEventListener('change', (e) => updateGfx((s) => { s.renderScale = e.target.value / 100; }));
  $('gfx-cats').addEventListener('change', (e) => {
    const cat = e.target.dataset.cat;
    if (cat) updateGfx((s) => { if (e.target.value) s.overrides[cat] = e.target.value; else delete s.overrides[cat]; });
  });
  $('gfx-adaptive').addEventListener('change', (e) => updateGfx((s) => { s.adaptive = e.target.checked; }));
  $('gfx-fps').addEventListener('change', (e) => updateGfx((s) => { s.showFps = e.target.checked; }));

  // Keyboard.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input')) return;
    const ov = anyOverlay();
    if (e.key === 'Escape') {
      if (ov && ov.id !== 'overlay-complete') { ov.hidden = true; e.preventDefault(); }
      else if (!ov && document.body.dataset.screen === 'game') { renderLevels(); showScreen('levels'); }
      else if (!ov && document.body.dataset.screen === 'levels') { refreshTitle(); showScreen('title'); }
      return;
    }
    if (ov || document.body.dataset.screen !== 'game' || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = DIR_OF_KEY[e.key] || DIR_OF_KEY[e.key.toLowerCase()];
    if (dir) { e.preventDefault(); clearHintMarks(); roll(dir); return; }
    const k = e.key.toLowerCase();
    if (k === 'u' || (k === 'z')) undo();
    else if (k === 'r') restart();
    else if (k === 'h') hint();
  });

  // Swipe or tap on the board: swipes roll that way; a tap in line with the ball rolls toward it.
  const cv = $('board');
  let start = null;
  cv.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; game.audio.unlock(); });
  cv.addEventListener('pointerup', (e) => {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    clearHintMarks();
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24) { roll(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U')); return; }
    const r = game.renderer, rect = cv.getBoundingClientRect();
    if (!r.tile || !game.board) return;
    const tx = Math.floor((e.clientX - rect.left - r.ox) / r.tile), ty = Math.floor((e.clientY - rect.top - r.oy) / r.tile);
    const bx = game.state.pos % game.board.w, by = (game.state.pos - bx) / game.board.w;
    if (tx === bx && ty !== by) roll(ty < by ? 'U' : 'D');
    else if (ty === by && tx !== bx) roll(tx < bx ? 'L' : 'R');
  });
  cv.addEventListener('pointercancel', () => { start = null; });

  addEventListener('resize', () => game.renderer.resize());
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion);
}

boot();
