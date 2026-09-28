'use strict';

// Settings panel: Graphics section (quality preset, render scale, per-effect
// overrides, adaptive resolution, frame-rate readout). Strings are localized
// from the browser language; the rest of the game is English-only.
const gfx = require('./gfx');
const render = require('./render');

const GFX_KEY = 'paint-maze:v1:graphics';

const CAT_ORDER = ['shadows', 'ao', 'bloom', 'grade', 'antialias', 'reflections', 'detail', 'particles', 'motion'];

const STRINGS = {
	'en-US': {
		settings: 'Settings', graphics: 'Graphics', close: 'Close', quality: 'Quality',
		auto: 'Auto (detected: {tier})', low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
		renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
		adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
		postNote: 'Post-processing is unavailable on this device, so the board is drawn without it.',
		noWebgl: '3D graphics are unavailable here; the flat board is shown and these options have no effect.',
		cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail', particles: 'Paint splashes', motion: 'Board animation' },
		tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', plain: 'Plain', detailed: 'Detailed', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'no shadows', shadows: 'shadows', fullAo: 'full ambient occlusion', ao: 'ambient occlusion', bloom: 'bloom', reflections: 'reflections' }
	},
	'en-GB': {
		settings: 'Settings', graphics: 'Graphics', close: 'Close', quality: 'Quality',
		auto: 'Auto (detected: {tier})', low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
		renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
		adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
		postNote: 'Post-processing is unavailable on this device, so the board is drawn without it.',
		noWebgl: '3D graphics are unavailable here; the flat board is shown and these options have no effect.',
		cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail', particles: 'Paint splashes', motion: 'Board animation' },
		tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', plain: 'Plain', detailed: 'Detailed', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'no shadows', shadows: 'shadows', fullAo: 'full ambient occlusion', ao: 'ambient occlusion', bloom: 'bloom', reflections: 'reflections' }
	},
	'es-419': {
		settings: 'Configuración', graphics: 'Gráficos', close: 'Cerrar', quality: 'Calidad',
		auto: 'Automática (detectada: {tier})', low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
		renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
		adaptive: 'Resolución adaptativa', showFps: 'Mostrar cuadros por segundo',
		postNote: 'El posprocesamiento no está disponible en este dispositivo; el tablero se dibuja sin él.',
		noWebgl: 'Los gráficos 3D no están disponibles; se muestra el tablero plano y estas opciones no tienen efecto.',
		cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', reflections: 'Reflejos', detail: 'Detalle de superficies', particles: 'Salpicaduras de pintura', motion: 'Animación del tablero' },
		tier: { off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas', plain: 'Simple', detailed: 'Detallado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'sin sombras', shadows: 'sombras', fullAo: 'oclusión ambiental completa', ao: 'oclusión ambiental', bloom: 'resplandor', reflections: 'reflejos' }
	},
	'es-ES': {
		settings: 'Ajustes', graphics: 'Gráficos', close: 'Cerrar', quality: 'Calidad',
		auto: 'Automática (detectada: {tier})', low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
		renderScale: 'Escala de renderizado', fromPreset: 'Según el preajuste ({tier})',
		adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
		postNote: 'El posprocesado no está disponible en este dispositivo; el tablero se dibuja sin él.',
		noWebgl: 'Los gráficos 3D no están disponibles; se muestra el tablero plano y estas opciones no tienen efecto.',
		cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Suavizado de bordes', reflections: 'Reflejos', detail: 'Detalle de superficies', particles: 'Salpicaduras de pintura', motion: 'Animación del tablero' },
		tier: { off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas', plain: 'Simple', detailed: 'Detallado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'sin sombras', shadows: 'sombras', fullAo: 'oclusión ambiental completa', ao: 'oclusión ambiental', bloom: 'resplandor', reflections: 'reflejos' }
	},
	'de-DE': {
		settings: 'Einstellungen', graphics: 'Grafik', close: 'Schließen', quality: 'Qualität',
		auto: 'Automatisch (erkannt: {tier})', low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
		renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
		adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
		postNote: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spielfeld wird ohne sie gezeichnet.',
		noWebgl: '3D-Grafik ist nicht verfügbar; das flache Spielfeld wird angezeigt und diese Optionen wirken nicht.',
		cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Spiegelungen', detail: 'Oberflächendetails', particles: 'Farbspritzer', motion: 'Spielfeldanimation' },
		tier: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', plain: 'Schlicht', detailed: 'Detailliert', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'keine Schatten', shadows: 'Schatten', fullAo: 'volle Umgebungsverdeckung', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', reflections: 'Spiegelungen' }
	},
	'fr-FR': {
		settings: 'Paramètres', graphics: 'Graphismes', close: 'Fermer', quality: 'Qualité',
		auto: 'Auto (détectée : {tier})', low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
		renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
		adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
		postNote: 'Le post-traitement n’est pas disponible sur cet appareil ; le plateau est dessiné sans.',
		noWebgl: 'Les graphismes 3D ne sont pas disponibles ; le plateau plat est affiché et ces options sont sans effet.',
		cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces', particles: 'Éclaboussures de peinture', motion: 'Animation du plateau' },
		tier: { off: 'Non', on: 'Oui', low: 'Basses', medium: 'Moyennes', high: 'Hautes', plain: 'Simple', detailed: 'Détaillé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'sans ombres', shadows: 'ombres', fullAo: 'occlusion ambiante complète', ao: 'occlusion ambiante', bloom: 'halo', reflections: 'reflets' }
	},
	'fr-CA': {
		settings: 'Paramètres', graphics: 'Graphiques', close: 'Fermer', quality: 'Qualité',
		auto: 'Auto (détectée : {tier})', low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
		renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
		adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
		postNote: 'Le post-traitement n’est pas offert sur cet appareil; le plateau est dessiné sans.',
		noWebgl: 'Les graphiques 3D ne sont pas offerts; le plateau plat est affiché et ces options sont sans effet.',
		cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces', particles: 'Éclaboussures de peinture', motion: 'Animation du plateau' },
		tier: { off: 'Non', on: 'Oui', low: 'Basses', medium: 'Moyennes', high: 'Hautes', plain: 'Simple', detailed: 'Détaillé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'sans ombres', shadows: 'ombres', fullAo: 'occlusion ambiante complète', ao: 'occlusion ambiante', bloom: 'halo', reflections: 'reflets' }
	},
	'pt-BR': {
		settings: 'Configurações', graphics: 'Gráficos', close: 'Fechar', quality: 'Qualidade',
		auto: 'Automática (detectada: {tier})', low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
		renderScale: 'Escala de renderização', fromPreset: 'Conforme a predefinição ({tier})',
		adaptive: 'Resolução adaptativa', showFps: 'Mostrar quadros por segundo',
		postNote: 'O pós-processamento não está disponível neste dispositivo; o tabuleiro é desenhado sem ele.',
		noWebgl: 'Gráficos 3D não estão disponíveis; o tabuleiro plano é exibido e estas opções não têm efeito.',
		cat: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Suavização de bordas', reflections: 'Reflexos', detail: 'Detalhe das superfícies', particles: 'Respingos de tinta', motion: 'Animação do tabuleiro' },
		tier: { off: 'Não', on: 'Sim', low: 'Baixas', medium: 'Médias', high: 'Altas', plain: 'Simples', detailed: 'Detalhado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'sem sombras', shadows: 'sombras', fullAo: 'oclusão ambiente completa', ao: 'oclusão ambiente', bloom: 'brilho', reflections: 'reflexos' }
	},
	'it-IT': {
		settings: 'Impostazioni', graphics: 'Grafica', close: 'Chiudi', quality: 'Qualità',
		auto: 'Automatica (rilevata: {tier})', low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
		renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
		adaptive: 'Risoluzione adattiva', showFps: 'Mostra fotogrammi al secondo',
		postNote: 'La post-elaborazione non è disponibile su questo dispositivo; il tabellone viene disegnato senza.',
		noWebgl: 'La grafica 3D non è disponibile; viene mostrato il tabellone piatto e queste opzioni non hanno effetto.',
		cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici', particles: 'Schizzi di vernice', motion: 'Animazione del tabellone' },
		tier: { off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte', plain: 'Semplice', detailed: 'Dettagliato', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
		desc: { noShadows: 'senza ombre', shadows: 'ombre', fullAo: 'occlusione ambientale completa', ao: 'occlusione ambientale', bloom: 'bagliore', reflections: 'riflessi' }
	}
};

// Pick the closest supported locale for a BCP 47 tag.
function pickLocale(tag) {
	const t = String(tag || '').toLowerCase();
	for (const k of Object.keys(STRINGS)) if (k.toLowerCase() === t) return k;
	const lang = t.split('-')[0];
	const region = t.split('-')[1] || '';
	if (lang === 'en') return ['gb', 'uk', 'ie', 'au', 'nz'].includes(region) ? 'en-GB' : 'en-US';
	if (lang === 'es') return region === 'es' ? 'es-ES' : 'es-419';
	if (lang === 'fr') return region === 'ca' ? 'fr-CA' : 'fr-FR';
	if (lang === 'pt') return 'pt-BR';
	if (lang === 'de') return 'de-DE';
	if (lang === 'it') return 'it-IT';
	return 'en-US';
}

let S = STRINGS['en-US'];
let el = {};
let saved = {};
let opener = null;
let infoTimer = 0;

function $(id) { return document.getElementById(id); }

function loadSaved() {
	try { return JSON.parse(window.localStorage.getItem(GFX_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function persist() {
	try { window.localStorage.setItem(GFX_KEY, JSON.stringify(saved)); } catch (e) { /* storage unavailable */ }
}

function tierName(cat, tier) {
	return (S.tier && S.tier[tier]) || tier;
}

function option(value, text) {
	const o = document.createElement('option');
	o.value = value;
	o.textContent = text;
	return o;
}

// Build the Graphics section controls (once).
function build() {
	const host = el.gfxFields;
	if (!host || host.childElementCount) return;
	const row = (id, label, control) => {
		const wrap = document.createElement('div');
		wrap.className = 'field';
		const l = document.createElement('label');
		l.htmlFor = id;
		l.textContent = label;
		wrap.append(l, control);
		host.append(wrap);
		return wrap;
	};
	const preset = document.createElement('select');
	preset.id = 'gfx-preset';
	preset.dataset.gfx = 'preset';
	row('gfx-preset', S.quality, preset);

	const scaleWrap = document.createElement('span');
	scaleWrap.className = 'range';
	const scale = document.createElement('input');
	scale.type = 'range'; scale.id = 'gfx-scale'; scale.min = '50'; scale.max = '200'; scale.step = '10';
	scale.dataset.gfx = 'render_scale';
	const out = document.createElement('output');
	out.id = 'gfx-scale-value';
	out.htmlFor = 'gfx-scale';
	scaleWrap.append(scale, out);
	row('gfx-scale', S.renderScale, scaleWrap);

	for (const cat of CAT_ORDER) {
		const sel = document.createElement('select');
		sel.id = `gfx-${cat}`;
		sel.dataset.gfx = cat;
		row(sel.id, S.cat[cat], sel);
	}
	for (const [id, key, label] of [['gfx-adaptive', 'adaptive', S.adaptive], ['gfx-fps', 'show_fps', S.showFps]]) {
		const cb = document.createElement('input');
		cb.type = 'checkbox'; cb.id = id; cb.dataset.gfx = key;
		row(id, label, cb).classList.add('check');
	}
	host.addEventListener('change', onChange);
	host.addEventListener('input', (e) => { if (e.target.id === 'gfx-scale') onChange(e); });
}

// Refill option labels (they name the current preset's tiers) and control values.
function sync() {
	const info = render.graphicsInfo((k) => S.desc[k]);
	const r = info.resolved;
	const preset = $('gfx-preset');
	if (!preset) return;
	preset.replaceChildren(option('auto', S.auto.replace('{tier}', S[info.detected] || info.detected)),
		...gfx.PRESETS.map((p) => option(p, S[p])));
	preset.value = gfx.PRESETS.includes(saved.preset) ? saved.preset : 'auto';
	for (const cat of CAT_ORDER) {
		const sel = $(`gfx-${cat}`);
		sel.replaceChildren(option('preset', S.fromPreset.replace('{tier}', tierName(cat, gfx.presetTier(r.preset, cat)))),
			...gfx.CATEGORIES[cat].map((t) => option(t, tierName(cat, t))));
		sel.value = gfx.CATEGORIES[cat].includes(saved[cat]) ? saved[cat] : 'preset';
	}
	const pct = Math.round(r.renderScale * 100);
	$('gfx-scale').value = String(pct);
	$('gfx-scale-value').textContent = `${pct}%`;
	$('gfx-adaptive').checked = r.adaptive;
	$('gfx-fps').checked = r.showFps;
	document.body.dataset.gfxPreset = r.preset;
	showInfo();
}

function showInfo() {
	if (!el.summary) return;
	const info = render.graphicsInfo((k) => S.desc[k]);
	el.summary.textContent = info.webgl ? `${info.gpu} · ${info.summary}` : S.noWebgl;
	if (el.note) {
		el.note.textContent = S.postNote;
		el.note.hidden = !info.postFailed;
	}
}

function onChange(e) {
	const t = e.target;
	const key = t.dataset && t.dataset.gfx;
	if (!key) return;
	if (key === 'preset') saved = gfx.choosePreset(saved, t.value);
	else if (key === 'render_scale') saved.render_scale = Number(t.value) / 100;
	else if (key === 'adaptive' || key === 'show_fps') saved[key] = t.checked;
	else if (t.value === 'preset') delete saved[key];
	else saved[key] = t.value;
	persist();
	render.setGraphics(saved);
	if (key === 'render_scale') {
		$('gfx-scale-value').textContent = `${t.value}%`;
		document.body.dataset.gfxPreset = render.graphicsInfo().resolved.preset;
		setTimeout(showInfo, 60);
	} else {
		sync();
		setTimeout(showInfo, 60); // pick up the rebuilt post chain / pixel size
	}
}

function isOpen() { return !!el.panel && !el.panel.hidden; }

function open() {
	if (!el.panel) return;
	opener = document.activeElement;
	sync();
	el.panel.hidden = false;
	const first = $('gfx-preset');
	if (first) first.focus();
	clearInterval(infoTimer);
	infoTimer = setInterval(showInfo, 1000);
}

function close() {
	if (!el.panel || el.panel.hidden) return;
	el.panel.hidden = true;
	clearInterval(infoTimer);
	if (opener && opener.focus) opener.focus();
	else if (el.button) el.button.focus();
}

// Keep Tab focus inside the open dialog; Escape closes it.
function onKey(e) {
	if (!isOpen()) return false;
	if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
	if (e.key === 'Tab') {
		const f = [...el.panel.querySelectorAll('select, input, button')].filter((n) => !n.disabled && n.offsetParent !== null);
		if (!f.length) return true;
		const first = f[0], last = f[f.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}
	return true; // swallow game shortcuts while the panel is open
}

function init() {
	const tag = (navigator.languages && navigator.languages[0]) || navigator.language;
	S = STRINGS[pickLocale(tag)];
	el = {
		button: $('btn-settings'), panel: $('settings'), closeBtn: $('btn-settings-close'),
		title: $('settings-title'), gfxTitle: $('settings-graphics-title'),
		gfxFields: $('gfx-fields'), summary: $('gfx-summary'), note: $('gfx-post-note')
	};
	saved = loadSaved();
	render.setGraphics(saved);
	document.body.dataset.gfxPreset = render.graphicsInfo().resolved.preset;
	if (!el.panel) return;
	if (el.button) {
		el.button.setAttribute('aria-label', S.settings);
		el.button.title = S.settings;
		el.button.addEventListener('click', (e) => { e.preventDefault(); open(); });
	}
	if (el.title) el.title.textContent = S.settings;
	if (el.gfxTitle) el.gfxTitle.textContent = S.graphics;
	if (el.closeBtn) {
		el.closeBtn.textContent = S.close;
		el.closeBtn.addEventListener('click', (e) => { e.preventDefault(); close(); });
	}
	el.panel.addEventListener('click', (e) => { if (e.target === el.panel) close(); });
	build();
}

module.exports = { init, open, close, isOpen, onKey, pickLocale, STRINGS, GFX_KEY };
