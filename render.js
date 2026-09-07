'use strict';

// Render: Three.js scene graph, semantic entity views, camera, lighting.
// Falls back to a 2D canvas painter when WebGL is unavailable, so the board is
// always visible even on machines without a usable GL context.
const THREE = require('three');
const rules = require('./rules');

const COLOR = {
	painted: 0x2f7fe0,
	unpainted: 0xe6eaf3,
	block: 0x8894ad,
	wall: 0x4a5468,
	ball: 0xffc93c,
	background: 0xeef1f8
};

const MARGIN = 0.9; // world units of padding around the board

let renderer = null;
let scene = null;
let camera = null;
let ballMesh = null;
let cellMesh = null;
let wallMesh = null;
let boardGroup = null;
let canvasEl = null;
let fallbackCtx = null;
let disposed = false;
let currentSize = 0;
let frame = 0;
let lastState = null;
let ballPos = { x: 0, y: 0 };
let ballTarget = { x: 0, y: 0 };

function reducedMotion() {
	return typeof window !== 'undefined' && window.matchMedia
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Grid cell -> world position (board centred on the origin, +y up on screen).
function worldX(x, size) { return x - (size - 1) / 2; }
function worldY(y, size) { return -(y - (size - 1) / 2); }

function init(canvas) {
	canvasEl = canvas;
	disposed = false;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch (e) {
		renderer = null;
	}
	if (!renderer) {
		fallbackCtx = canvas.getContext('2d');
		return !!fallbackCtx;
	}
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(COLOR.background, 1);
	scene = new THREE.Scene();
	camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
	camera.position.set(0, -6, 18);
	camera.lookAt(0, 0, 0);

	scene.add(new THREE.AmbientLight(0xffffff, 1.5));
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(-6, -8, 14);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xcfe0ff, 0.8);
	fill.position.set(8, 10, 6);
	scene.add(fill);

	boardGroup = new THREE.Group();
	scene.add(boardGroup);
	return true;
}

function usable() { return !disposed && (!!renderer || !!fallbackCtx); }

function disposeBoard() {
	if (!boardGroup) return;
	for (const child of boardGroup.children.slice()) {
		boardGroup.remove(child);
		if (child.geometry) child.geometry.dispose();
		if (child.material) child.material.dispose();
	}
	cellMesh = null; wallMesh = null; ballMesh = null;
}

// Interior + border wall segments of the level, as world-space slabs.
function wallSegments(state) {
	const size = state.size;
	const out = [];
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		for (const d of [1, 2]) { // right, down: each shared edge once
			const nx = x + rules.DIRS[d].dx, ny = y + rules.DIRS[d].dy;
			const outside = nx >= size || ny >= size;
			if (!rules.hasWall(state.cells, i, d)) continue;
			if (outside) continue; // border drawn separately as a frame
			out.push(d === 1
				? { x: worldX(x, size) + 0.5, y: worldY(y, size), w: 0.12, h: 1 }
				: { x: worldX(x, size), y: worldY(y, size) - 0.5, w: 1, h: 0.12 });
		}
	}
	const span = size;
	out.push({ x: 0, y: span / 2, w: span + 0.12, h: 0.12 });
	out.push({ x: 0, y: -span / 2, w: span + 0.12, h: 0.12 });
	out.push({ x: -span / 2, y: 0, w: 0.12, h: span + 0.12 });
	out.push({ x: span / 2, y: 0, w: 0.12, h: span + 0.12 });
	return out;
}

function buildBoard(state) {
	disposeBoard();
	const size = state.size;
	currentSize = size;

	cellMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(0.92, 0.92, 0.3),
		new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }),
		size * size
	);
	boardGroup.add(cellMesh);

	const segs = wallSegments(state);
	wallMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 0.75),
		new THREE.MeshStandardMaterial({ color: COLOR.wall, roughness: 0.6, metalness: 0.1 }),
		segs.length
	);
	const m = new THREE.Matrix4();
	segs.forEach((s, i) => {
		m.makeScale(s.w, s.h, 1).setPosition(s.x, s.y, 0.35);
		wallMesh.setMatrixAt(i, m);
	});
	wallMesh.instanceMatrix.needsUpdate = true;
	boardGroup.add(wallMesh);

	ballMesh = new THREE.Mesh(
		new THREE.SphereGeometry(0.34, 24, 24),
		new THREE.MeshStandardMaterial({ color: COLOR.ball, roughness: 0.35, metalness: 0.15 })
	);
	boardGroup.add(ballMesh);

	ballTarget = ballCoords(state);
	ballPos = { x: ballTarget.x, y: ballTarget.y };
	if (camera) {
		const half = size / 2 + MARGIN;
		camera.top = half; camera.bottom = -half; camera.left = -half; camera.right = half;
		camera.updateProjectionMatrix();
	}
}

function ballCoords(state) {
	const size = state.size;
	const x = state.ballIdx % size, y = (state.ballIdx - x) / size;
	return { x: worldX(x, size), y: worldY(y, size) };
}

// Push the logical state into the scene. Cheap enough to call after every move.
function update(state) {
	if (!usable() || !state) return;
	lastState = state;
	if (fallbackCtx) { draw2d(state); return; }
	if (!cellMesh || currentSize !== state.size) buildBoard(state);

	const size = state.size;
	const m = new THREE.Matrix4();
	const color = new THREE.Color();
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		const paintable = rules.isPaintable(state, i);
		const painted = paintable && rules.isPainted(state, i);
		// Painted cells also sit slightly higher, so progress reads without colour.
		const z = !paintable ? 0.3 : painted ? 0.06 : -0.06;
		m.makeTranslation(worldX(x, size), worldY(y, size), z);
		cellMesh.setMatrixAt(i, m);
		cellMesh.setColorAt(i, color.setHex(!paintable ? COLOR.block : painted ? COLOR.painted : COLOR.unpainted));
	}
	cellMesh.instanceMatrix.needsUpdate = true;
	if (cellMesh.instanceColor) cellMesh.instanceColor.needsUpdate = true;

	ballTarget = ballCoords(state);
	if (reducedMotion()) ballPos = ballTarget;
	ballMesh.position.set(ballPos.x, ballPos.y, 0.45);
	renderFrame();
}

function renderFrame() {
	if (!renderer || disposed) return;
	renderer.render(scene, camera);
}

// Damped follow so a roll reads as motion; settles exactly on the target.
function tick() {
	if (!usable()) return;
	if (fallbackCtx) return;
	if (!ballMesh) return;
	const dx = ballTarget.x - ballPos.x, dy = ballTarget.y - ballPos.y;
	if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
		if (ballPos.x !== ballTarget.x || ballPos.y !== ballTarget.y) {
			ballPos = { x: ballTarget.x, y: ballTarget.y };
			ballMesh.position.set(ballPos.x, ballPos.y, 0.45);
			renderFrame();
		}
		return;
	}
	ballPos = { x: ballPos.x + dx * 0.28, y: ballPos.y + dy * 0.28 };
	ballMesh.position.set(ballPos.x, ballPos.y, 0.45);
	renderFrame();
}

function start() {
	if (frame) return;
	const loop = () => {
		frame = requestAnimationFrame(loop);
		if (document.hidden) return;
		tick();
	};
	frame = requestAnimationFrame(loop);
}

function stop() {
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
}

// 2D fallback: same colour and height language, flat.
function draw2d(state) {
	const ctx = fallbackCtx;
	const size = state.size;
	const w = canvasEl.width, h = canvasEl.height;
	const cell = Math.floor(Math.min(w, h) / (size + 1));
	const ox = (w - cell * size) / 2, oy = (h - cell * size) / 2;
	ctx.fillStyle = '#eef1f8';
	ctx.fillRect(0, 0, w, h);
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		const paintable = rules.isPaintable(state, i);
		const painted = paintable && rules.isPainted(state, i);
		ctx.fillStyle = !paintable ? '#8894ad' : painted ? '#2f7fe0' : '#e6eaf3';
		ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
	}
	ctx.strokeStyle = '#4a5468';
	ctx.lineWidth = Math.max(2, cell * 0.12);
	ctx.beginPath();
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		if (rules.hasWall(state.cells, i, 1)) { ctx.moveTo(ox + (x + 1) * cell, oy + y * cell); ctx.lineTo(ox + (x + 1) * cell, oy + (y + 1) * cell); }
		if (rules.hasWall(state.cells, i, 2)) { ctx.moveTo(ox + x * cell, oy + (y + 1) * cell); ctx.lineTo(ox + (x + 1) * cell, oy + (y + 1) * cell); }
		if (rules.hasWall(state.cells, i, 0) && y === 0) { ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + (x + 1) * cell, oy); }
		if (rules.hasWall(state.cells, i, 3) && x === 0) { ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox, oy + (y + 1) * cell); }
	}
	ctx.stroke();
	const bx = state.ballIdx % size, by = (state.ballIdx - bx) / size;
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
	const rect = canvasEl.getBoundingClientRect();
	const w = Math.max(1, Math.round(rect.width));
	const h = Math.max(1, Math.round(rect.height));
	if (renderer) {
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(w, h, false);
		if (camera && currentSize) {
			const half = currentSize / 2 + MARGIN;
			const aspect = w / h;
			camera.left = -half * Math.max(aspect, 1);
			camera.right = half * Math.max(aspect, 1);
			camera.top = half / Math.min(aspect, 1);
			camera.bottom = -half / Math.min(aspect, 1);
			camera.updateProjectionMatrix();
		}
		renderFrame();
	} else if (fallbackCtx) {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvasEl.width = Math.round(w * dpr);
		canvasEl.height = Math.round(h * dpr);
		if (lastState) draw2d(lastState);
	}
}

function dispose() {
	if (disposed) return;
	disposed = true;
	stop();
	disposeBoard();
	if (renderer) renderer.dispose();
	renderer = null; scene = null; camera = null; boardGroup = null; fallbackCtx = null;
}

module.exports = { init, update, resize, start, stop, dispose, usesWebGL: () => !!renderer };
