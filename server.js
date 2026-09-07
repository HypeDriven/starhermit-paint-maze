'use strict';

// Server: static file HTTP + WebSocket (StarHermit).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.opus': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.woff2': 'font/woff2'
};

function send(res, code, body) {
	res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end(body);
}

const server = http.createServer((req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'method not allowed'); return; }
	let url;
	try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { send(res, 400, 'bad request'); return; }
	if (url === '/') url = '/index.html';
	// Resolve inside ROOT only: reject traversal such as /../secrets.
	const file = path.resolve(ROOT, '.' + path.posix.normalize(url));
	if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { send(res, 403, 'forbidden'); return; }
	fs.stat(file, (err, st) => {
		if (err || !st.isFile()) { send(res, 404, 'not found'); return; }
		const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
		res.writeHead(200, {
			'Content-Type': type,
			'Content-Length': st.size,
			'X-Content-Type-Options': 'nosniff'
		});
		if (req.method === 'HEAD') { res.end(); return; }
		fs.createReadStream(file).on('error', () => res.end()).pipe(res);
	});
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'hello' })); });

server.listen(PORT);

module.exports = { server };
