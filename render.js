// Render: Three.js scene graph, semantic entity views, camera, lighting, VFX and
// graphics quality. Falls back to a 2D canvas painter when WebGL is unavailable,
// so the board is always visible even on machines without a usable GL context.
//
// ES module (bundled by esbuild) so three.js and its same-revision addons from
// node_modules resolve to one copy of the library.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import rules from './rules.js';
import gfx from './gfx.js';

const COLOR = {
	painted: 0x2f7fe0,
	unpainted: 0xe6eaf3,
	block: 0x8894ad,
	wall: 0x4a5468,
	ball: 0xffc93c,
	background: 0xeef1f8,
	table: 0xe4e9f3,
	plate: 0x3a4357
};

const MARGIN = 0.9; // world units of padding around the board
const BALL_R = 0.34;
const BALL_Z = 0.45;
const MAX_PARTICLES = 320;
const ENV_ROT = -Math.PI / 2;
const ENV_MATS = ['table', 'plate', 'un', 'paint', 'block', 'wall', 'ball', 'drop'];

let renderer = null;
let scene = null;
let camera = null;
let keyLight = null;
let hemi = null;
let ballMesh = null;
let blobShadow = null;
let meshes = null; // { un, paint, block } instanced tile meshes
let wallMesh = null;
let plateMesh = null;
let tableMesh = null;
let particles = null;
let boardGroup = null;
let canvasEl = null;
let fallbackCtx = null;
let disposed = false;
let currentSize = 0;
let builtDetail = null;
let frame = 0;
let lastState = null;
let ballPos = { x: 0, y: 0 };
let ballTarget = { x: 0, y: 0 };
let rollFrom = null; // world position the current roll started from
let clock = 0; // seconds of animation time
let lastNow = 0;
let needsRender = true;

// Per-cell display state (so painting can pop in as the ball passes).
let shownPainted = null; // Uint8Array: 1 when drawn as painted
let popStart = null; // Float64Array: clock time the pop started (-1 = none)
let pending = []; // cells painted in state but waiting for the ball to arrive
let lastSeed = null;

// Graphics state.
let q = gfx.resolve({}, 'low');
let detected = 'low';
let gpuName = '';
let composer = null;
let gradePass = null;
let postKey = null;
let postFailed = false;
let envTexture = null;
let adaptiveScale = 1;
let frameTimes = [];
let fps = 0;
let pixelRatio = 1;
let size = [0, 0];
let lastRendered = false;
const mats = {};
const tex = {};

function reducedMotion() {
	return typeof window !== 'undefined' && window.matchMedia
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function motionOn() { return q.motion === 'on' && !reducedMotion(); }
function particlesOn() { return q.particles !== 'off' && !reducedMotion(); }

// Grid cell -> world position (board centred on the origin, +y up on screen).
function worldX(x, n) { return x - (n - 1) / 2; }
function worldY(y, n) { return -(y - (n - 1) / 2); }

// Colour grade + vignette (display-space colours in, display-space out).
const GradeShader = {
	uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.16 } },
	vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
	fragmentShader: `
		uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
		varying vec2 vUv;
		void main() {
			vec4 src = texture2D(tDiffuse, vUv);
			vec3 c = clamp(src.rgb, 0.0, 1.0);
			// Gentle S-curve contrast, a touch more saturation, cool shadows / warm highlights.
			vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
			float l = dot(s, vec3(0.299, 0.587, 0.114));
			s = mix(vec3(l), s, 1.1);
			s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.02, 1.0, 0.98), smoothstep(0.2, 0.8, l));
			c = mix(c, s, uAmount);
			float d = length(vUv - 0.5);
			c *= 1.0 - uVignette * smoothstep(0.45, 0.9, d);
			gl_FragColor = vec4(c, src.a);
		}`
};

// Caps HDR values before bloom (tone mapping makes the cap invisible otherwise).
const ClampShader = {
	uniforms: { tDiffuse: { value: null }, uMax: { value: 3.0 } },
	vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
	fragmentShader: 'uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(uMax)), c.a); }'
};

// ---- procedural textures ---------------------------------------------------

function seededNoise(seed) {
	let s = seed >>> 0;
	return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Soft mottled near-white texture that multiplies the base colour.
function noiseTexture(sizePx, lo, blotches, seed) {
	const c = document.createElement('canvas');
	c.width = c.height = sizePx;
	const g = c.getContext('2d');
	const rnd = seededNoise(seed);
	g.fillStyle = '#fff';
	g.fillRect(0, 0, sizePx, sizePx);
	for (let i = 0; i < blotches; i++) {
		const x = rnd() * sizePx, y = rnd() * sizePx, r = sizePx * (0.04 + rnd() * 0.12);
		const v = Math.round(255 - rnd() * (255 - lo));
		const grad = g.createRadialGradient(x, y, 0, x, y, r);
		grad.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
		grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
		g.fillStyle = grad;
		g.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const img = g.getImageData(0, 0, sizePx, sizePx);
	for (let i = 0; i < img.data.length; i += 4) {
		const n = (rnd() - 0.5) * 6;
		img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
	}
	g.putImageData(img, 0, 0);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}

// Paint-ball texture: two pale stripes so the roll reads as rotation.
function ballTexture() {
	const c = document.createElement('canvas');
	c.width = 256; c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#ffffff';
	g.fillRect(0, 0, 256, 128);
	g.fillStyle = '#fff6d8';
	g.fillRect(0, 56, 256, 16);
	g.fillRect(60, 0, 12, 128);
	g.fillRect(188, 0, 12, 128);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function blobTexture() {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const g = c.getContext('2d');
	const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, 'rgba(20,28,46,0.45)');
	grad.addColorStop(1, 'rgba(20,28,46,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	return new THREE.CanvasTexture(c);
}

// ---- setup -----------------------------------------------------------------

function detectGpu(gl) {
	try {
		const ua = navigator.userAgent || '';
		if (/firefox/i.test(ua)) return String(gl.getParameter(gl.RENDERER) || '');
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
	} catch (e) { return ''; }
}

function isMobile() {
	try {
		return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
			|| /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
	} catch (e) { return false; }
}

function init(canvas) {
	canvasEl = canvas;
	disposed = false;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
	} catch (e) {
		renderer = null;
	}
	if (!renderer) {
		fallbackCtx = canvas.getContext('2d');
		return !!fallbackCtx;
	}
	gpuName = detectGpu(renderer.getContext());
	detected = gfx.detectPreset(gpuName, isMobile());
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = 1;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	scene = new THREE.Scene();
	scene.background = new THREE.Color(COLOR.background);
	camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
	camera.position.set(0, -6, 18);
	camera.lookAt(0, 0, 0);

	hemi = new THREE.HemisphereLight(0xffffff, 0xaab4cc, 1.2);
	hemi.position.set(0, 0, 1);
	scene.add(hemi);
	keyLight = new THREE.DirectionalLight(0xfff3e2, 2.2);
	keyLight.position.set(-6, 8, 14);
	keyLight.shadow.bias = -0.0004;
	keyLight.shadow.normalBias = 0.02;
	keyLight.shadow.radius = 3;
	keyLight.shadow.intensity = 0.75;
	scene.add(keyLight);
	scene.add(keyLight.target);
	const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
	fill.position.set(8, -10, 6);
	scene.add(fill);

	tex.table = noiseTexture(256, 226, 60, 7);
	tex.table.repeat.set(6, 6);
	tex.tile = noiseTexture(128, 238, 24, 11);
	tex.block = noiseTexture(128, 205, 40, 23);
	tex.ball = ballTexture();
	tex.blob = blobTexture();

	mats.table = new THREE.MeshStandardMaterial({ color: COLOR.table, roughness: 0.95, metalness: 0 });
	mats.plate = new THREE.MeshStandardMaterial({ color: COLOR.plate, roughness: 0.55, metalness: 0.15 });
	mats.un = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
	mats.paint = new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
	mats.block = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 });
	mats.wall = new THREE.MeshStandardMaterial({ color: COLOR.wall, roughness: 0.5, metalness: 0.2 });
	mats.ball = new THREE.MeshPhysicalMaterial({ color: COLOR.ball, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x6b4a00, emissiveIntensity: 0.25 });
	mats.drop = new THREE.MeshStandardMaterial({ color: COLOR.painted, roughness: 0.25, metalness: 0, emissive: COLOR.painted, emissiveIntensity: 0.35 });
	// Reflections read mostly as specular: diffuse surfaces take little of the room light.
	for (const [k, v] of [['table', 0.2], ['un', 0.2], ['paint', 0.35], ['block', 0.2], ['wall', 0.4], ['plate', 0.5], ['ball', 0.8], ['drop', 0.5]]) mats[k].envMapIntensity = v;
	mats.blob = new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false });

	// Tabletop the board rests on; it catches the board's shadow.
	tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mats.table);
	tableMesh.position.z = -0.42;
	tableMesh.receiveShadow = true;
	scene.add(tableMesh);

	boardGroup = new THREE.Group();
	scene.add(boardGroup);

	particles = {
		mesh: new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 1), mats.drop, MAX_PARTICLES),
		p: new Float32Array(MAX_PARTICLES * 3), v: new Float32Array(MAX_PARTICLES * 3),
		life: new Float32Array(MAX_PARTICLES), max: new Float32Array(MAX_PARTICLES), n: 0
	};
	particles.mesh.count = 0;
	particles.mesh.frustumCulled = false;
	scene.add(particles.mesh);

	applyGraphics();
	return true;
}

function usable() { return !disposed && (!!renderer || !!fallbackCtx); }

function disposeBoard() {
	if (!boardGroup) return;
	for (const child of boardGroup.children.slice()) {
		boardGroup.remove(child);
		if (child.geometry) child.geometry.dispose();
	}
	meshes = null; wallMesh = null; ballMesh = null; plateMesh = null; blobShadow = null;
}

// Interior + border wall segments of the level, as world-space slabs.
function wallSegments(state) {
	const n = state.size;
	const out = [];
	for (let i = 0; i < n * n; i++) {
		const x = i % n, y = (i - x) / n;
		for (const d of [1, 2]) { // right, down: each shared edge once
			const nx = x + rules.DIRS[d].dx, ny = y + rules.DIRS[d].dy;
			const outside = nx >= n || ny >= n;
			if (!rules.hasWall(state.cells, i, d)) continue;
			if (outside) continue; // border drawn separately as a frame
			out.push(d === 1
				? { x: worldX(x, n) + 0.5, y: worldY(y, n), w: 0.12, h: 1 }
				: { x: worldX(x, n), y: worldY(y, n) - 0.5, w: 1, h: 0.12 });
		}
	}
	out.push({ x: 0, y: n / 2, w: n + 0.12, h: 0.12 });
	out.push({ x: 0, y: -n / 2, w: n + 0.12, h: 0.12 });
	out.push({ x: -n / 2, y: 0, w: 0.12, h: n + 0.12 });
	out.push({ x: n / 2, y: 0, w: 0.12, h: n + 0.12 });
	return out;
}

function tileGeometry(h) {
	return q.detail === 'detailed'
		? new RoundedBoxGeometry(0.92, 0.92, h, 2, 0.07)
		: new THREE.BoxGeometry(0.92, 0.92, h);
}

function buildBoard(state) {
	disposeBoard();
	const n = state.size;
	currentSize = n;
	builtDetail = q.detail;

	meshes = {};
	for (const kind of ['un', 'paint', 'block']) {
		const m = new THREE.InstancedMesh(tileGeometry(0.3), mats[kind], n * n);
		m.count = 0;
		m.receiveShadow = true;
		m.castShadow = false; // raised blocks would shade open tiles into block-like greys
		boardGroup.add(m);
		meshes[kind] = m;
	}

	plateMesh = new THREE.Mesh(
		q.detail === 'detailed' ? new RoundedBoxGeometry(n + 0.7, n + 0.7, 0.36, 3, 0.16) : new THREE.BoxGeometry(n + 0.7, n + 0.7, 0.36),
		mats.plate
	);
	plateMesh.position.z = -0.27;
	plateMesh.receiveShadow = true;
	plateMesh.castShadow = true;
	boardGroup.add(plateMesh);

	const segs = wallSegments(state);
	wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.75), mats.wall, segs.length);
	const m = new THREE.Matrix4();
	segs.forEach((s, i) => {
		m.makeScale(s.w, s.h, 1).setPosition(s.x, s.y, 0.35);
		wallMesh.setMatrixAt(i, m);
	});
	wallMesh.instanceMatrix.needsUpdate = true;
	wallMesh.castShadow = true;
	wallMesh.receiveShadow = true;
	boardGroup.add(wallMesh);

	ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), mats.ball);
	ballMesh.castShadow = true;
	boardGroup.add(ballMesh);

	blobShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mats.blob);
	blobShadow.renderOrder = 1;
	boardGroup.add(blobShadow);

	shownPainted = new Uint8Array(n * n);
	popStart = new Float64Array(n * n).fill(-1);
	pending = [];
	ballTarget = ballCoords(state);
	ballPos = { x: ballTarget.x, y: ballTarget.y };
	rollFrom = null;
	fitShadowCamera(n);
	fitCamera();
}

function fitShadowCamera(n) {
	const sc = keyLight.shadow.camera;
	const ext = n / 2 + 1.4;
	Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
	sc.updateProjectionMatrix();
}

function fitCamera() {
	if (!camera || !currentSize) return;
	const half = currentSize / 2 + MARGIN;
	const w = size[0] || 1, h = size[1] || 1;
	const aspect = w / h;
	camera.left = -half * Math.max(aspect, 1);
	camera.right = half * Math.max(aspect, 1);
	camera.top = half / Math.min(aspect, 1);
	camera.bottom = -half / Math.min(aspect, 1);
	camera.updateProjectionMatrix();
}

function ballCoords(state) {
	const n = state.size;
	const x = state.ballIdx % n, y = (state.ballIdx - x) / n;
	return { x: worldX(x, n), y: worldY(y, n) };
}

// Push the logical state into the scene. Cheap enough to call after every move.
function update(state) {
	if (!usable() || !state) return;
	lastState = state;
	if (fallbackCtx) { draw2d(state); return; }
	const fresh = !meshes || currentSize !== state.size || lastSeed !== state.seedStr || builtDetail !== q.detail;
	if (fresh) buildBoard(state);
	lastSeed = state.seedStr;

	const n = state.size;
	const prevTarget = ballTarget;
	ballTarget = ballCoords(state);
	const animate = !fresh && motionOn() && (prevTarget.x !== ballTarget.x || prevTarget.y !== ballTarget.y);
	if (animate) rollFrom = { x: ballPos.x, y: ballPos.y, dx: Math.sign(ballTarget.x - ballPos.x), dy: Math.sign(ballTarget.y - ballPos.y) };
	pending = [];
	for (let i = 0; i < n * n; i++) {
		const painted = rules.isPaintable(state, i) && rules.isPainted(state, i);
		if (!painted) { shownPainted[i] = 0; popStart[i] = -1; continue; }
		if (shownPainted[i]) continue;
		if (animate) pending.push(i);
		else { shownPainted[i] = 1; popStart[i] = -1; }
	}
	if (reducedMotion()) ballPos = { x: ballTarget.x, y: ballTarget.y };
	layoutTiles();
	needsRender = true;
}

// Rebuild the three tile instance lists from the display state.
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
function layoutTiles() {
	const state = lastState;
	if (!state || !meshes) return false;
	const n = state.size;
	let anim = false;
	const count = { un: 0, paint: 0, block: 0 };
	for (let i = 0; i < n * n; i++) {
		const x = i % n, y = (i - x) / n;
		const paintable = rules.isPaintable(state, i);
		let kind, z;
		if (!paintable) { kind = 'block'; z = 0.3; }
		else if (shownPainted[i]) {
			kind = 'paint'; z = 0.06;
			// Pop: rises with a small overshoot as the paint lands.
			if (popStart[i] >= 0) {
				const t = (clock - popStart[i]) / 0.32;
				if (t >= 1) popStart[i] = -1;
				else {
					anim = true;
					const k = 1.70158, u = t - 1;
					const e = 1 + (k + 1) * u * u * u + k * u * u;
					z = -0.06 + 0.12 * e;
				}
			}
		} else { kind = 'un'; z = -0.06; }
		const mesh = meshes[kind];
		_m.makeTranslation(worldX(x, n), worldY(y, n), z);
		mesh.setMatrixAt(count[kind], _m);
		mesh.setColorAt(count[kind], _c.setHex(kind === 'block' ? COLOR.block : kind === 'paint' ? COLOR.painted : COLOR.unpainted));
		count[kind]++;
	}
	for (const kind of Object.keys(meshes)) {
		const mesh = meshes[kind];
		mesh.count = count[kind];
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	}
	return anim;
}

function paintCell(i) {
	shownPainted[i] = 1;
	popStart[i] = clock;
	if (!particlesOn()) return;
	const n = currentSize;
	const x = i % n, y = (i - x) / n;
	const per = q.particles === 'high' ? 5 : 2;
	for (let k = 0; k < per; k++) spawnDrop(worldX(x, n), worldY(y, n));
}

function spawnDrop(x, y) {
	const P = particles;
	if (P.n >= MAX_PARTICLES) return;
	const j = P.n++;
	const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.1;
	P.p[j * 3] = x + Math.cos(a) * 0.2; P.p[j * 3 + 1] = y + Math.sin(a) * 0.2; P.p[j * 3 + 2] = 0.2;
	P.v[j * 3] = Math.cos(a) * sp; P.v[j * 3 + 1] = Math.sin(a) * sp; P.v[j * 3 + 2] = 2 + Math.random() * 1.6;
	P.max[j] = P.life[j] = 0.45 + Math.random() * 0.25;
}

function stepParticles(dt) {
	const P = particles;
	if (!P || !P.n) { if (P) P.mesh.count = 0; return false; }
	let w = 0;
	for (let j = 0; j < P.n; j++) {
		P.life[j] -= dt;
		if (P.life[j] <= 0) continue;
		if (w !== j) {
			for (let c = 0; c < 3; c++) { P.p[w * 3 + c] = P.p[j * 3 + c]; P.v[w * 3 + c] = P.v[j * 3 + c]; }
			P.life[w] = P.life[j]; P.max[w] = P.max[j];
		}
		P.v[w * 3 + 2] -= 9 * dt;
		for (let c = 0; c < 3; c++) P.p[w * 3 + c] += P.v[w * 3 + c] * dt;
		if (P.p[w * 3 + 2] < 0.12) { P.p[w * 3 + 2] = 0.12; P.v[w * 3 + 2] = 0; P.v[w * 3] *= 0.8; P.v[w * 3 + 1] *= 0.8; }
		const s = Math.max(0.05, P.life[w] / P.max[w]);
		_m.makeScale(s, s, s).setPosition(P.p[w * 3], P.p[w * 3 + 1], P.p[w * 3 + 2]);
		P.mesh.setMatrixAt(w, _m);
		w++;
	}
	P.n = w;
	P.mesh.count = w;
	P.mesh.instanceMatrix.needsUpdate = true;
	return w > 0;
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Advance cosmetic animation; returns true while anything is still moving.
function tick(dt) {
	if (!ballMesh) return false;
	let moving = false;
	const dx = ballTarget.x - ballPos.x, dy = ballTarget.y - ballPos.y;
	if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
		if (ballPos.x !== ballTarget.x || ballPos.y !== ballTarget.y) moving = true;
		ballPos = { x: ballTarget.x, y: ballTarget.y };
	} else {
		// Critically damped-style follow, frame-rate independent.
		const k = 1 - Math.pow(0.72, dt * 60);
		const sx = dx * k, sy = dy * k;
		ballPos = { x: ballPos.x + sx, y: ballPos.y + sy };
		const dist = Math.hypot(sx, sy);
		if (dist > 0 && motionOn()) {
			_axis.set(-sy, sx, 0).normalize();
			_q.setFromAxisAngle(_axis, dist / BALL_R);
			ballMesh.quaternion.premultiply(_q);
		}
		moving = true;
	}
	// Paint lands as the ball passes over each pending tile.
	if (pending.length) {
		const n = currentSize;
		const settled = !moving;
		const ballProg = rollFrom ? (ballPos.x - rollFrom.x) * rollFrom.dx + (ballPos.y - rollFrom.y) * rollFrom.dy : Infinity;
		pending = pending.filter((i) => {
			const x = i % n, y = (i - x) / n;
			const prog = rollFrom ? (worldX(x, n) - rollFrom.x) * rollFrom.dx + (worldY(y, n) - rollFrom.y) * rollFrom.dy : 0;
			if (settled || ballProg >= prog - 0.35) { paintCell(i); return false; }
			return true;
		});
	}
	const popping = layoutTiles();
	const drops = stepParticles(dt);
	const idle = motionOn();
	const bob = idle ? Math.sin(clock * 2.4) * 0.025 + 0.025 : 0;
	ballMesh.position.set(ballPos.x, ballPos.y, BALL_Z + bob);
	if (blobShadow) {
		blobShadow.visible = q.shadows === 'off';
		blobShadow.position.set(ballPos.x + 0.06, ballPos.y - 0.04, 0.1);
		const s = 1 - bob * 2;
		blobShadow.scale.set(s, s, 1);
	}
	return moving || popping || drops || pending.length > 0 || idle;
}

// ---- graphics settings -----------------------------------------------------

/** Apply saved graphics settings (object from the Graphics panel; {} = auto). */
function setGraphics(saved) {
	q = gfx.resolve(saved || {}, detected);
	if (!renderer) return;
	applyGraphics();
}

function applyGraphics() {
	const sm = gfx.SHADOW_MAP[q.shadows];
	renderer.shadowMap.enabled = sm > 0;
	keyLight.castShadow = sm > 0;
	if (sm > 0 && keyLight.shadow.mapSize.x !== sm) {
		keyLight.shadow.mapSize.set(sm, sm);
		if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
	}
	keyLight.shadow.radius = q.shadows === 'high' ? 4 : 3;
	// Image-based lighting from a procedural room, generated once on demand.
	if (q.reflections === 'on') {
		if (!envTexture) {
			const pmrem = new THREE.PMREMGenerator(renderer);
			envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
			pmrem.dispose();
		}
		hemi.intensity = 0.95;
	} else hemi.intensity = 1.2;
	// Per-material env maps (not scene.environment) so each surface keeps its own intensity.
	for (const k of ENV_MATS) {
		mats[k].envMap = q.reflections === 'on' ? envTexture : null;
		// Board is z-up: tip the y-up room so its bright ceiling sits overhead and
		// face-on tiles mirror the darker floor, while bevels and the ball catch the lights.
		mats[k].envMapRotation.set(ENV_ROT, 0, 0);
	}
	const detailed = q.detail === 'detailed';
	mats.table.map = detailed ? tex.table : null;
	mats.un.map = detailed ? tex.tile : null;
	mats.block.map = detailed ? tex.block : null;
	mats.ball.map = detailed ? tex.ball : null;
	for (const m of Object.values(mats)) m.needsUpdate = true;
	if (!motionOn()) { pending.forEach(paintCellQuiet); pending = []; if (popStart) popStart.fill(-1); }
	if (!particlesOn() && particles) { particles.n = 0; particles.mesh.count = 0; }
	adaptiveScale = 1;
	frameTimes = [];
	postKey = null;
	postFailed = false;
	fpsVisible(q.showFps);
	if (canvasEl) canvasEl.setAttribute('data-gfx-preset', q.preset);
	if (lastState && builtDetail !== q.detail) update(lastState);
	else if (lastState) layoutTiles();
	needsRender = true;
}

function paintCellQuiet(i) { shownPainted[i] = 1; }

/** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
function graphicsInfo(t) {
	const px = [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)];
	return {
		webgl: !!renderer,
		gpu: gpuName || 'unknown GPU',
		detected,
		resolved: q,
		summary: gfx.describe(q, px, t),
		fps: Math.round(fps),
		adaptiveScale: Math.round(adaptiveScale * 100) / 100,
		postFailed
	};
}

function fpsVisible(on) {
	let el = document.getElementById('fps-meter');
	if (on && !el) {
		el = document.createElement('div');
		el.id = 'fps-meter';
		el.setAttribute('aria-hidden', 'true');
		el.textContent = '— fps';
		document.body.append(el);
	}
	if (el) el.hidden = !on;
}

function makePostKey(w, h) {
	return q.post && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join('|') : 'none';
}

function disposeComposer() {
	if (!composer) return;
	for (const p of composer.passes) if (p.dispose) p.dispose();
	composer.dispose();
	composer = null;
}

function buildPost(w, h) {
	disposeComposer();
	composer = null;
	gradePass = null;
	if (!q.post || postFailed) return;
	try {
		const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
		const target = new THREE.WebGLRenderTarget(pw, ph, {
			type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0
		});
		const c = new EffectComposer(renderer, target);
		c.setPixelRatio(pixelRatio);
		c.setSize(w, h);
		c.addPass(new RenderPass(scene, camera));
		if (q.ao !== 'off') {
			const ao = new GTAOPass(scene, camera, pw, ph);
			ao.output = GTAOPass.OUTPUT.Default;
			ao.blendIntensity = 0.7;
			ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: q.ao === 'high' ? 16 : 8 });
			ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 6 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
			c.addPass(ao);
		}
		if (q.bloom === 'on') {
			// Clamp the reflected room lights so their huge HDR values cannot smear.
			c.addPass(new ShaderPass(ClampShader));
			// High threshold: only the glossy ball, paint glints and droplets bloom.
			c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.25, 1.5));
		}
		c.addPass(new OutputPass());
		if (q.grade === 'on') {
			gradePass = new ShaderPass(GradeShader);
			c.addPass(gradePass);
		}
		if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
		if (q.antialias === 'fxaa') {
			const fxaa = new ShaderPass(FXAAShader);
			fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
			c.addPass(fxaa);
		}
		composer = c;
	} catch (e) {
		// Post-processing is an enhancement: render directly if the chain cannot be built.
		postFailed = true;
		composer = null;
	}
}

// Adaptive resolution: step the render scale down when frames are slow, back up when fast.
function adapt(dt) {
	frameTimes.push(dt);
	if (frameTimes.length < 90) return false;
	const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
	frameTimes = [];
	fps = 1000 / avg;
	const el = document.getElementById('fps-meter');
	if (el && !el.hidden) el.textContent = `${Math.round(fps)} fps · ${Math.round(pixelRatio * 100) / 100}×`;
	if (!q.adaptive) return false;
	const before = adaptiveScale;
	if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
	else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
	return before !== adaptiveScale;
}

function renderFrame(dtMs) {
	if (!renderer || disposed || !canvasEl) return;
	const rescale = dtMs ? adapt(dtMs) : false;
	const rect = canvasEl.getBoundingClientRect();
	const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
	const ratio = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * adaptiveScale;
	if (w !== size[0] || h !== size[1] || ratio !== pixelRatio || rescale) {
		size = [w, h];
		pixelRatio = ratio;
		renderer.setPixelRatio(ratio);
		renderer.setSize(w, h, false);
		fitCamera();
	}
	const key = makePostKey(w, h);
	if (key !== postKey) {
		postKey = key;
		buildPost(w, h);
	}
	if (composer) {
		try { composer.render(dtMs ? dtMs / 1000 : 0.016); }
		catch (e) { postFailed = true; postKey = null; composer = null; renderer.render(scene, camera); }
	} else renderer.render(scene, camera);
}

function loop(now) {
	frame = requestAnimationFrame(loop);
	if (document.hidden || !renderer) { lastRendered = false; return; }
	const dtMs = lastNow ? Math.min(250, now - lastNow) : 16;
	lastNow = now;
	clock += dtMs / 1000;
	const animating = tick(dtMs / 1000);
	if (animating || needsRender) {
		needsRender = false;
		// Only consecutive rendered frames say anything about GPU cost.
		renderFrame(lastRendered ? dtMs : 0);
		lastRendered = true;
	} else lastRendered = false;
}

function start() {
	if (frame || fallbackCtx) return;
	lastNow = 0;
	lastRendered = false;
	frame = requestAnimationFrame(loop);
}

function stop() {
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
}

// 2D fallback: same colour and height language, flat.
function draw2d(state) {
	const ctx = fallbackCtx;
	const n = state.size;
	const w = canvasEl.width, h = canvasEl.height;
	const cell = Math.floor(Math.min(w, h) / (n + 1));
	const ox = (w - cell * n) / 2, oy = (h - cell * n) / 2;
	ctx.fillStyle = '#eef1f8';
	ctx.fillRect(0, 0, w, h);
	for (let i = 0; i < n * n; i++) {
		const x = i % n, y = (i - x) / n;
		const paintable = rules.isPaintable(state, i);
		const painted = paintable && rules.isPainted(state, i);
		ctx.fillStyle = !paintable ? '#8894ad' : painted ? '#2f7fe0' : '#e6eaf3';
		ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
	}
	ctx.strokeStyle = '#4a5468';
	ctx.lineWidth = Math.max(2, cell * 0.12);
	ctx.beginPath();
	for (let i = 0; i < n * n; i++) {
		const x = i % n, y = (i - x) / n;
		if (rules.hasWall(state.cells, i, 1)) { ctx.moveTo(ox + (x + 1) * cell, oy + y * cell); ctx.lineTo(ox + (x + 1) * cell, oy + (y + 1) * cell); }
		if (rules.hasWall(state.cells, i, 2)) { ctx.moveTo(ox + x * cell, oy + (y + 1) * cell); ctx.lineTo(ox + (x + 1) * cell, oy + (y + 1) * cell); }
		if (rules.hasWall(state.cells, i, 0) && y === 0) { ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + (x + 1) * cell, oy); }
		if (rules.hasWall(state.cells, i, 3) && x === 0) { ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox, oy + (y + 1) * cell); }
	}
	ctx.stroke();
	const bx = state.ballIdx % n, by = (state.ballIdx - bx) / n;
	ctx.fillStyle = '#ffc93c';
	ctx.beginPath();
	ctx.arc(ox + (bx + 0.5) * cell, oy + (by + 0.5) * cell, cell * 0.33, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = '#3a3a1a';
	ctx.lineWidth = 2;
	ctx.stroke();
}

// Size the drawing buffer to the canvas' CSS box (never the whole window).
function resize() {
	if (!usable() || !canvasEl) return;
	if (renderer) {
		needsRender = true;
		renderFrame(0);
	} else if (fallbackCtx) {
		const rect = canvasEl.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvasEl.width = Math.round(Math.max(1, rect.width) * dpr);
		canvasEl.height = Math.round(Math.max(1, rect.height) * dpr);
		if (lastState) draw2d(lastState);
	}
}

function dispose() {
	if (disposed) return;
	disposed = true;
	stop();
	disposeBoard();
	disposeComposer();
	if (renderer) renderer.dispose();
	renderer = null; scene = null; camera = null; boardGroup = null; fallbackCtx = null; composer = null;
}

function usesWebGL() { return !!renderer; }

export { init, update, resize, start, stop, dispose, usesWebGL, setGraphics, graphicsInfo };
