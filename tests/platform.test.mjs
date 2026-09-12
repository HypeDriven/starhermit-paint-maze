/**
 * Paint Maze — StarHermit platform adapter tests (dev only, not shipped).
 * Pure Node, no dependencies: node tests/platform.test.mjs
 *
 * Covers the stored-zip helper (structure readable by strict zip readers),
 * base64 round-trips and launch-token payload decoding. The produced zip is
 * also checked by tests/e2e-adjacent tooling with python3 zipfile.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = require(path.join(ROOT, 'platform.js'));

let failures = 0;
const check = (name, fn) => {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL - ${name}: ${e.message}`);
	}
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

check('zip local header, central directory and EOCD line up', () => {
	const bytes = platform.zipStore('save.json', new TextEncoder().encode('{"a":1}'));
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert(dv.getUint32(0, true) === 0x04034b50, 'bad local header signature');
	const nameLen = dv.getUint16(26, true);
	const dataLen = dv.getUint32(18, true);
	const cdOff = 30 + nameLen + dataLen;
	assert(dv.getUint32(cdOff, true) === 0x02014b50, 'central directory not at local-header offset + name + data');
	const cdNameLen = dv.getUint16(cdOff + 28, true);
	const cdSize = 46 + cdNameLen;
	const eocdOff = cdOff + cdSize;
	assert(dv.getUint32(eocdOff, true) === 0x06054b50, 'bad EOCD signature');
	assert(dv.getUint16(eocdOff + 8, true) === 1 && dv.getUint16(eocdOff + 10, true) === 1,
		'EOCD entry counts are not 1/1');
	assert(dv.getUint32(eocdOff + 12, true) === cdSize, 'EOCD central-directory size mismatch');
	assert(dv.getUint32(eocdOff + 16, true) === cdOff, 'EOCD central-directory offset mismatch');
	assert(dv.getUint16(eocdOff + 20, true) === 0, 'EOCD comment length not 0');
	assert(eocdOff + 22 === bytes.length, 'trailing bytes after EOCD');
});

check('zip round-trips payload bytes and crc', () => {
	const payload = new TextEncoder().encode(JSON.stringify({ schema: 1, moves: 42 }));
	const back = platform.unzipFirstEntry(platform.zipStore('save.json', payload));
	assert(back.length === payload.length, 'length changed');
	for (let i = 0; i < payload.length; i++) assert(back[i] === payload[i], `byte ${i} differs`);
});

check('base64 helpers round-trip binary data', () => {
	const src = new Uint8Array(70000);
	for (let i = 0; i < src.length; i++) src[i] = (i * 31 + 7) & 0xff;
	const back = platform.base64ToBytes(platform.bytesToBase64(src));
	assert(back.length === src.length, 'length changed');
	for (let i = 0; i < src.length; i++) assert(back[i] === src[i], `byte ${i} differs`);
});

check('jwt payload decodes sub and game_scope without verifying', () => {
	const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const token = `${b64url({ alg: 'none' })}.${b64url({ sub: 'u-1234-abcd', game_scope: 'paint-maze', exp: 1 })}.sig`;
	const payload = platform.decodeJwtPayload(token);
	assert(payload && payload.sub === 'u-1234-abcd', 'sub not decoded');
	assert(payload.game_scope === 'paint-maze', 'game_scope not decoded');
	assert(platform.decodeJwtPayload('not-a-jwt') === null, 'garbage token decoded');
	assert(platform.decodeJwtPayload(null) === null, 'null token decoded');
});

check('boot and pushCloud no-op without a browser token', () => {
	assert(platform.boot({}) === false, 'boot succeeded without window/token');
	let built = 0;
	platform.pushCloud(() => { built++; return { ok: true }; });
	assert(built === 0, 'builder ran while offline');
});

console.log(failures === 0 ? '\nPLATFORM PASS' : `\nPLATFORM FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
