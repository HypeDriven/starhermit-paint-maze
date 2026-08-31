'use strict';

// Server: static file HTTP + WebSocket (StarHermit).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

function send(res, code, body) { res.writeHead(code); res.end(body); }

const server = http.createServer((req, res) => {
	const url = req.url.split('?')[0];
	if (url === '/' || url === '/index.html') {
		res.writeHead(200, { 'Content-Type': 'text/html' });
		fs.readFile(path.join(ROOT, 'index.html'), (e, d) => e ? send(res, 500, 'err') : res.end(d));
		return;
	}
	const file = path.join(ROOT, url);
	if (!fs.existsSync(file)) { send(res, 404, 'not found'); return; }
	res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
	fs.readFile(file, (e, d) => e ? send(res, 500, 'err') : res.end(d));
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'hello' })); });

server.listen(PORT);

module.exports = { server };
