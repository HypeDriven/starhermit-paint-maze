// StarHermit platform adapter over the shared SDK (starhermit-sdk.js, loaded
// by index.html as window.StarHermit). The SDK reads the launch token
// (#game_token / #access_token, stripped after read), renews it, and owns the
// `game:<slug>` cloud-save slot, the settings KV, controls and the invite
// link. Hosted mode = the SDK holds a token. Without one every entry point
// no-ops and makes no request, so offline/local play is untouched.

const SAVE_DEBOUNCE_MS = 2000;

const sdk = () => (typeof window !== 'undefined' && window.StarHermit) || globalThis.StarHermit || null;
const hosted = () => { const s = sdk(); return !!(s && s.signedIn && s.slug); };

const state = {
	inited: false,
	saveTimer: null,
	saveBuilder: null,
	saving: false,
	handlers: {}
};

function setSync(status) {
	if (state.handlers.onSync) state.handlers.onSync(status);
}

async function loadIdentity() {
	const p = await sdk().profile();
	const name = p ? p.displayName : 'Player ' + String(sdk().userId || '').slice(0, 6);
	if (state.handlers.onName) state.handlers.onName(name);
}

async function loadCloudDoc() {
	if (!state.handlers.onRemote) return;
	const doc = await sdk().loadJSON(); // null when none / unreachable: the local cache rules
	if (doc) state.handlers.onRemote(doc);
}

// Queue a cloud save. `builder` reads the current local cache when the
// debounced write fires, so bursts of moves collapse into one PUT.
function pushCloud(builder) {
	if (!hosted()) return;
	state.saveBuilder = builder;
	if (state.saving) return; // flushCloud runs again when the in-flight PUT settles
	if (state.saveTimer) clearTimeout(state.saveTimer);
	state.saveTimer = setTimeout(flushCloud, SAVE_DEBOUNCE_MS);
}

async function flushCloud() {
	if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
	if (state.saving || !state.saveBuilder || !hosted()) return;
	const builder = state.saveBuilder;
	state.saveBuilder = null;
	let doc = null;
	try { doc = builder(); } catch (e) { return; }
	if (!doc) return;
	state.saving = true;
	setSync('saving');
	const ok = await sdk().writeSave(JSON.stringify(doc), { keepalive: true });
	if (ok) setSync('synced');
	else {
		setSync('error');
		state.saveBuilder = state.saveBuilder || builder; // a later local change retries
	}
	state.saving = false;
	if (state.saveBuilder) pushCloud(state.saveBuilder);
}

// Start hosted mode. Returns true when a launch token was read. `handlers`:
// onName(nickname), onSync('saving'|'synced'|'error'), onRemote(doc),
// onAuth({signedIn}) after a sign-out (refused token renewal).
function boot(handlers) {
	state.handlers = handlers || {};
	const s = sdk();
	if (!s || typeof window === 'undefined' || typeof document === 'undefined') return false;
	if (!state.inited) {
		state.inited = true;
		s.init();
		let was = hosted();
		s.on('auth', (a) => {
			if (a.signedIn === was) return; // renewals change nothing visible
			was = a.signedIn;
			if (state.handlers.onAuth) state.handlers.onAuth(a);
		});
		window.addEventListener('pagehide', flushCloud);
		document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloud(); });
	}
	if (!hosted()) return false;
	loadIdentity();
	loadCloudDoc();
	return true;
}

// Per-player settings KV, keyboard bindings, sign-in and invite.
const getSettings = async () => (hosted() ? sdk().getSettings() : null);
const patchSettings = (obj) => { if (hosted()) sdk().patchSettings(obj); };
async function loadBindings(defaults) {
	const copy = JSON.parse(JSON.stringify(defaults));
	if (!hosted()) return copy;
	try { return await sdk().loadBindings(defaults); } catch (e) { return copy; }
}
const canSignIn = () => { const s = sdk(); return !!(s && s.canSignIn()); };
const signIn = () => { const s = sdk(); return !!(s && s.signIn()); };
const inviteLink = () => (hosted() ? sdk().inviteLink() : null);

export {
	boot, pushCloud, flushCloud, hosted,
	getSettings, patchSettings, loadBindings, canSignIn, signIn, inviteLink
};
