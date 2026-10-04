/**
 * Paint Maze — hosted-mode (StarHermit) integration test (dev only, not shipped).
 *
 * Serves the repo with an embedded static server plus a fake platform /api
 * (profile, `game:<slug>` cloud save, launch-token refresh) and drives the real UI in
 * headless Chrome (playwright-core + system Chrome) with a #game_token
 * launch fragment.
 *
 * Covers: fragment read once + stripped, Bearer on every REST call, nickname
 * (never username) in the HUD, cloud save PUT as zip+base64 with a visible
 * sync status, and remote-preferred restore on a later launch. Fails on any
 * console/page error.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
	'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
};

const calls = [];
let cloudZip = null; // bytes served by the next GET cloud-saves
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64url({ alg: 'none' })}.${b64url({ sub: 'u-1234-abcd-9999', game_scope: 'paint-maze' })}.sig`;

const server = http.createServer((req, res) => {
	const url = decodeURIComponent(req.url.split('?')[0]);
	const auth = req.headers.authorization || '';
	if (url.startsWith('/api/')) {
		calls.push({ method: req.method, url, auth });
		if (req.method === 'GET' && url === '/api/v1/users/u-1234-abcd-9999/profile') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: 'u-1234-abcd-9999', username: 'should_not_appear', nickname: 'MazePainter' }));
			return;
		}
		if (req.method === 'POST' && url === '/api/v1/games/paint-maze/launch-token') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ token: jwt + '2' }));
			return;
		}
		if (url === '/api/v1/me/cloud-saves/game:paint-maze') {
			if (req.method === 'GET') {
				if (!cloudZip) { res.writeHead(404); res.end(); return; }
				res.writeHead(200, { 'Content-Type': 'application/zip' });
				res.end(Buffer.from(cloudZip));
				return;
			}
			if (req.method === 'PUT') {
				let body = '';
				req.on('data', (c) => { body += c; });
				req.on('end', () => {
					const doc = JSON.parse(body);
					if (!doc.dataBase64) { res.writeHead(400); res.end(); return; }
					cloudZip = Buffer.from(doc.dataBase64, 'base64');
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end('{}');
				});
				return;
			}
		}
		res.writeHead(404); res.end(); return;
	}
	const file = path.join(ROOT, url === '/' ? 'index.html' : url);
	if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
	fs.readFile(file, (e, d) => {
		if (e) { res.writeHead(404); res.end(); return; }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
		res.end(d);
	});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
	executablePath: '/usr/bin/google-chrome',
	args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

let failures = 0;
const check = (name, cond, extra) => {
	if (cond) console.log(`ok - ${name}`);
	else { failures++; console.error(`FAIL - ${name}${extra ? ': ' + extra : ''}`); }
};

try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
	page.on('console', (m) => {
		// The first cloud-save load 404s when no save exists yet (404 = none);
		// the browser logs that as a resource error even though it is expected.
		if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
	});

	// A fresh document per launch: from the stripped URL a second goto with
	// only a fragment added would be a same-document navigation.
	const launch = async () => {
		await page.goto('about:blank');
		await page.goto(BASE + '#game_token=' + jwt, { waitUntil: 'load' });
	};

	await page.goto(BASE, { waitUntil: 'load' });
	await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
	await launch();
	await page.waitForSelector('body[data-ready="true"]', { timeout: 10000 });

	const hashNow = await page.evaluate(() => location.hash);
	check('fragment stripped after read', hashNow === '', hashNow);

	await page.waitForFunction(() => !document.getElementById('hello').hidden, null, { timeout: 10000 });
	const hello = await page.textContent('#hello');
	check('nickname shown on the title screen', hello.includes('MazePainter'), hello);
	check('username never displayed', !(await page.textContent('body')).includes('should_not_appear'));

	// One roll through the visible arrows queues a cloud save (2 s debounce); the sync pill reports it.
	await page.click('#btn-play');
	await page.waitForSelector('#screen-game.active');
	await page.click('.dir[data-dir="R"]');
	await page.waitForFunction(() => document.body.dataset.moves === '1');
	await page.waitForFunction(() => document.getElementById('sync').dataset.status === 'synced', null, { timeout: 10000 });
	check('sync status shown and reaches synced', true);

	const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/v1/me/cloud-saves/game:paint-maze');
	check('cloud save PUT issued to the game slot', !!put);
	check('Bearer on cloud PUT', !!put && put.auth === 'Bearer ' + jwt, put && put.auth);
	check('cloud save carries a zip payload', !!cloudZip && cloudZip.length > 30);

	const prof = calls.find((c) => c.method === 'GET' && c.url === '/api/v1/users/u-1234-abcd-9999/profile');
	check('profile fetched from /users/{sub}', !!prof);
	check('no /api/v1/me identity or achievement calls', !calls.some((c) => c.url === '/api/v1/me' || c.url.startsWith('/api/v1/me/achievements')));

	// Second launch with the local cache wiped: the remote doc restores the level in progress.
	await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
	calls.length = 0;
	await launch();
	await page.waitForSelector('body[data-ready="true"]');
	await page.waitForFunction(() => document.getElementById('btn-play').textContent === 'Continue', null, { timeout: 10000 });
	// Level 1 is a single roll, so the save holds a finished level worth 3 stars.
	await page.waitForFunction(() => /^3 \//.test(document.getElementById('title-stars').textContent), null, { timeout: 10000 });
	check('remote save restored progress (3 stars)', true);

	check('no console/page errors in hosted mode', errors.length === 0, errors.join(' | '));
	await context.close();
} catch (e) {
	failures++;
	console.error('FAIL - hosted mode:', e.stack || e.message);
} finally {
	await browser.close();
	server.close();
}
console.log(failures === 0 ? '\nHOSTED PASS' : `\nHOSTED FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
