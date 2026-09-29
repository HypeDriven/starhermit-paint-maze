// StarHermit platform adapter: launch token, account identity, cloud save.
// Hosted mode activates only when a launch token is read from the URL
// fragment (query-string fallbacks exist for local dev only). Without a
// token every entry point no-ops, so offline/local play is untouched.

// ---- stored-zip helper (single entry, no compression) ----
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(bytes) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
	const enc = new TextEncoder();
	const nameB = enc.encode(name);
	const crc = crc32(dataBytes);
	const out = [];
	const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
	const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
	u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
	u32(crc); u32(dataBytes.length); u32(dataBytes.length);
	u16(nameB.length); u16(0);
	const local = out.length;
	const head = new Uint8Array(out);
	const cd = [];
	const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
	const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
	c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
	c32(crc); c32(dataBytes.length); c32(dataBytes.length);
	c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
	const cdHead = new Uint8Array(cd);
	const cdOff = head.length + nameB.length + dataBytes.length;
	const parts = [head, nameB, dataBytes, cdHead, nameB];
	const eocd = [];
	const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
	const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
	e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
	e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
	parts.push(new Uint8Array(eocd));
	const total = parts.reduce((n, p) => n + p.length, 0);
	const buf = new Uint8Array(total);
	let o = 0;
	for (const p of parts) { buf.set(p, o); o += p.length; }
	return buf;
}
function unzipFirstEntry(zipBytes) {
	// Stored single-entry reader: scan local headers for compression 0.
	const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
	let off = 0;
	while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
		const method = dv.getUint16(off + 8, true);
		const size = dv.getUint32(off + 18, true);
		const nameLen = dv.getUint16(off + 26, true);
		const extraLen = dv.getUint16(off + 28, true);
		const dataOff = off + 30 + nameLen + extraLen;
		if (method !== 0) throw new Error('unsupported zip entry');
		return zipBytes.slice(dataOff, dataOff + size);
	}
	throw new Error('bad zip');
}
function bytesToBase64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(s);
}
function base64ToBytes(b64) {
	const s = atob(b64);
	const b = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
	return b;
}

// ---- launch token / identity / cloud save ----

const REFRESH_MS = 45 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

const state = {
	token: null,
	sub: null,
	slug: null,
	hosted: false,
	refreshTimer: null,
	saveTimer: null,
	saveBuilder: null,
	saving: false,
	handlers: {}
};

// Read the token exactly once: from the fragment on any host, or (local dev
// only) from the query string. The fragment is stripped from the URL so it
// is never kept in history or shared links.
function readLaunchToken() {
	const loc = window.location;
	if (loc.hash) {
		const token = new URLSearchParams(loc.hash.slice(1)).get('game_token');
		if (token) {
			try { history.replaceState(null, '', loc.pathname + loc.search); } catch (e) { /* ignore */ }
			return token;
		}
	}
	if (!/\.starhermit\.com$/i.test(loc.hostname)) {
		const params = new URLSearchParams(loc.search);
		return params.get('game_token') || params.get('token') || params.get('launch');
	}
	return null;
}

// Payload decode only (no verify): sub = user id, game_scope = this game's slug.
function decodeJwtPayload(token) {
	const parts = String(token).split('.');
	if (parts.length !== 3) return null;
	try {
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const pad = '='.repeat((4 - b64.length % 4) % 4);
		return JSON.parse(atob(b64 + pad));
	} catch (e) { return null; }
}

function api(path, options) {
	options = options || {};
	const headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + state.token });
	return fetch(path, Object.assign({}, options, { headers }));
}

function setSync(status) {
	if (state.handlers.onSync) state.handlers.onSync(status);
}

async function loadIdentity() {
	const fallback = 'Player ' + String(state.sub || '????????').slice(0, 8);
	let name = fallback;
	try {
		const res = await api('/api/v1/users/' + encodeURIComponent(state.sub) + '/profile');
		if (res.ok) {
			const profile = await res.json().catch(() => null);
			if (profile && typeof profile.nickname === 'string' && profile.nickname) name = profile.nickname;
		}
	} catch (e) { /* offline or rate limited: keep the fallback */ }
	if (state.handlers.onName) state.handlers.onName(name);
}

// Scoped launch tokens may be re-minted with the current token; swap the new
// one in and keep the 45-minute schedule, retrying failures after ~60 s.
async function refreshToken() {
	if (!state.slug) return;
	try {
		const res = await api('/api/v1/games/' + encodeURIComponent(state.slug) + '/launch-token', { method: 'POST' });
		if (!res.ok) throw new Error('refresh ' + res.status);
		const data = await res.json().catch(() => null);
		const token = data && (data.token || data.launchToken || data.access_token);
		if (!token) throw new Error('refresh: no token in response');
		state.token = token;
	} catch (e) {
		scheduleRefresh(REFRESH_RETRY_MS);
		return;
	}
	scheduleRefresh(REFRESH_MS);
}

function scheduleRefresh(delay) {
	if (typeof setTimeout === 'undefined') return;
	if (state.refreshTimer) clearTimeout(state.refreshTimer);
	state.refreshTimer = setTimeout(refreshToken, delay);
}

async function loadCloudDoc() {
	if (!state.slug || !state.handlers.onRemote) return;
	try {
		const res = await api('/api/v1/me/cloud-saves/' + encodeURIComponent(state.slug));
		if (res.status === 404) return;
		if (!res.ok) throw new Error('cloud load ' + res.status);
		const bytes = new Uint8Array(await res.arrayBuffer());
		const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
		state.handlers.onRemote(doc);
	} catch (e) { /* remote load is best-effort; the local cache rules */ }
}

// Queue a cloud save. `builder` reads the current local cache when the
// debounced write fires, so bursts of moves collapse into one PUT.
function pushCloud(builder) {
	if (!state.hosted || !state.slug) return;
	state.saveBuilder = builder;
	if (state.saving) return; // flushCloud runs again when the in-flight PUT settles
	if (state.saveTimer) clearTimeout(state.saveTimer);
	state.saveTimer = setTimeout(flushCloud, SAVE_DEBOUNCE_MS);
}

async function flushCloud() {
	if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
	if (state.saving || !state.saveBuilder) return;
	const builder = state.saveBuilder;
	state.saveBuilder = null;
	let doc = null;
	try { doc = builder(); } catch (e) { return; }
	if (!doc) return;
	state.saving = true;
	setSync('saving');
	try {
		const payload = bytesToBase64(zipStore('save.json', new TextEncoder().encode(JSON.stringify(doc))));
		const res = await api('/api/v1/me/cloud-saves/' + encodeURIComponent(state.slug), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dataBase64: payload })
		});
		if (!res.ok) throw new Error('cloud save ' + res.status);
		setSync('synced');
	} catch (e) {
		setSync('error');
		state.saveBuilder = builder; // a later local change retries
	} finally {
		state.saving = false;
	}
	if (state.saveBuilder) pushCloud(state.saveBuilder);
}

// Start hosted mode. Returns true when a launch token was read. `handlers`:
// onName(nickname), onSync('saving'|'synced'|'error'), onRemote(doc).
function boot(handlers) {
	state.handlers = handlers || {};
	if (typeof window === 'undefined' || typeof document === 'undefined') return false;
	const token = readLaunchToken();
	if (!token) return false;
	const payload = decodeJwtPayload(token) || {};
	state.token = token;
	state.sub = payload.sub || null;
	state.slug = payload.game_scope || null;
	state.hosted = true;
	if (state.slug) scheduleRefresh(REFRESH_MS);
	loadIdentity();
	loadCloudDoc();
	return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	window.addEventListener('pagehide', flushCloud);
	document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloud(); });
}

export {
	boot, pushCloud, flushCloud, decodeJwtPayload,
	zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes
};
