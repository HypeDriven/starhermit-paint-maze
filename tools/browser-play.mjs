// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). Desktop: studio-1 and studio-2 by
// the arrow keys through the finish cards, a Hint on studio-3, Esc to the
// level list. Phones: studio-1 by a finger swipe on the board (CDP touch
// events), studio-2 by the on-screen arrows, studio-3 with Hint, Undo and the
// four swipes, then the level list. Screenshots of each step go to --shots.
// Fails on console errors or warnings, the runtime's error screen, or a level
// that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    for (const name of ['playwright-core', 'playwright']) {
      const p = join(r, 'node_modules', name);
      if (existsSync(p)) return createRequire(join(r, 'package.json'))(name);
    }
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const DIRS = { left: [-0.3, 0], right: [0.3, 0], up: [0, -0.3], down: [0, 0.3] };
const desktop = [
  ['shot', 'title'], ['role', 'Play'], ['wait', 1500], ['shot', 'level1'], ['key', 'ArrowRight'], ['wait', 2000], ['expect', 'Painted!'],
  ['shot', 'complete'], ['role', 'Next level'], ['wait', 1200], ['key', 'ArrowRight'], ['wait', 600], ['key', 'ArrowDown'], ['wait', 2000],
  ['expect', 'Painted!'], ['key', 'Enter'], ['wait', 1200], ['key', 'KeyH'], ['wait', 600], ['expect', 'Try rolling'], ['shot', 'hint'],
  ['key', 'Escape'], ['wait', 1000], ['expect', 'Workshop'], ['shot', 'levels'],
];
const touch = [
  ['shot', 'title'], ['role', 'Play'], ['wait', 1500], ['shot', 'level1'], ['swipe', 'right'], ['wait', 2000], ['expect', 'Painted!'],
  ['shot', 'complete'], ['role', 'Next level'], ['wait', 1200], ['role', 'Roll right'], ['wait', 600], ['role', 'Roll down'], ['wait', 2000],
  ['expect', 'Painted!'], ['role', 'Next level'], ['wait', 1200], ['role', 'Hint'], ['wait', 600], ['expect', 'Try rolling'], ['shot', 'hint'],
  ['swipe', 'down'], ['wait', 800], ['role', 'Undo'], ['wait', 500], ['swipe', 'down'], ['wait', 800], ['swipe', 'right'], ['wait', 800],
  ['swipe', 'up'], ['wait', 800], ['swipe', 'left'], ['wait', 2000], ['expect', 'Painted!'], ['shot', 'complete3'],
  ['role', 'Next level'], ['wait', 1200], ['role', 'Levels'], ['wait', 1000], ['expect', 'Workshop'], ['shot', 'levels'],
];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: touch },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: touch },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000); // the first press can be lost while the runtime starts up
  const press = async (loc) => (v.hasTouch ? loc.tap({ timeout: 10000 }) : loc.click({ timeout: 10000 }));
  const seen = async (text) => (await page.getByText(text).count().catch(() => 0)) > 0 || (await page.getByLabel(text).count().catch(() => 0)) > 0;
  const board = async () => page.getByText(/^Level \d+: \d+$/).first().boundingBox({ timeout: 5000 }).catch(() => null);
  async function swipe(dir, quiet = false) {
    const box = await board();
    if (!box) { if (!quiet) problems.push('board not found'); return; }
    const [dx, dy] = DIRS[dir];
    const x0 = box.x + box.width / 2 - dx * box.width / 2, y0 = box.y + box.height / 2 - dy * box.height / 2;
    const pts = Array.from({ length: 7 }, (_, i) => ({ x: x0 + dx * box.width * i / 6, y: y0 + dy * box.height * i / 6 }));
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
      for (const p of pts.slice(1)) { await page.waitForTimeout(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down();
      for (const p of pts.slice(1)) { await page.waitForTimeout(16); await page.mouse.move(p.x, p.y); }
      await page.mouse.up();
    }
  }
  for (const [op, a] of v.steps) {
    try {
      if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(80); await page.keyboard.up(a); await page.waitForTimeout(80); }
      if (op === 'wait') await page.waitForTimeout(a);
      if (op === 'role') await press(page.getByRole('button', { name: a, exact: true }).first());
      if (op === 'drag' || op === 'swipe') await swipe(a);
      if (op === 'expect' && !(await seen(a))) problems.push(`expected "${a}" on screen`);
      if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    } catch (e) { problems.push(`${op} ${typeof a === 'string' ? a : JSON.stringify(a)}: ${e.message.split('\n')[0]}`); }
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
