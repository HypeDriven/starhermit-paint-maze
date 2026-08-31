'use strict';

// Render: Three.js scene graph, semantic entity views, camera, lighting.
const THREE = require('three');
const rules = require('./rules');

let renderer = null;
let scene = null;
let camera = null;
let ballMesh = null;
let cellGroup = null;
let wallGroup = null;
let disposed = false;

function init(canvas) {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	scene = new THREE.Scene();
	camera = new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, -100, 100);

	const amb = new THREE.AmbientLight(0xffffff, 0.6);
	scene.add(amb);
	const dir = new THREE.DirectionalLight(0xffffff, 0.9);
	dir.position.set(-8, -8, 20);
	scene.add(dir);

	// floor cells (instanced)
	cellGroup = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }), rules.size * rules.size);
	wallGroup = new THREE.Group();
	ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 24), new THREE.MeshStandardMaterial({ color: 0xffcc33 }));

	disposed = false;
}

function update(state) {
	if (!renderer || disposed) return;
	const size = state.size;
	// position cells and set colors (painted vs not)
	for (let i = 0; i < size * size; i++) {
		const cx = i % size, cy = (i - cx) / size;
		cellGroup.setMatrixAt(i, new THREE.Matrix4().makeTranslation(cx - (size - 1) / 2, -(cy - (size - 1) / 2), 0));
		cellGroup.setColorAt(i, rules.isPainted(state, i) ? new THREE.Color(0x3aa0ff) : new THREE.Color(0xdddddd));
	}
	cellGroup.instanceMatrix.needsUpdate = true;
	if (cellGroup.instanceColor) cellGroup.instanceColor.needsUpdate = true;

	ballMesh.position.set((state.ballIdx % size - (size - 1) / 2), -(((state.ballIdx - (state.ballIdx % size)) / size) - (size - 1) / 2), 0);
}

function resize(width, height) {
	if (!renderer || disposed) return;
	renderer.setSize(width, height);
	const aspect = width / height;
	camera.left = -7.5 * Math.max(aspect, 1);
	camera.right = 7.5 * Math.max(aspect, 1);
	camera.top = 7.5; camera.bottom = -7.5;
	camera.updateProjectionMatrix();
}

function dispose() {
	if (!renderer || disposed) return;
	disposed = true;
	renderer.dispose();
	renderer = null; scene = null; camera = null; ballMesh = null; cellGroup = null; wallGroup = null;
}

module.exports = { init, update, resize, dispose };
