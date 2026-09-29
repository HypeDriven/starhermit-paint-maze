/**
 * Paint Maze — automated playthrough through the real, visible UI (dev only).
 *
 * Serves the repo (refusing tests/ and tools/) and drives headless Chrome via
 * playwright-core at desktop, portrait-phone and landscape-phone sizes. Levels
 * are solved by clicking the on-screen arrows (and keys, swipes and taps), using
 * the stored solutions only to decide which visible control to press. Fails on
 * any console error or warning, page error, failed request, or control that is
 * cut off by the viewport.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/levels.json'))).levels;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.opus': 'audio/ogg' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  if (/^\/(tests|tools|node_modules)\/|\/\./.test(url)) { res.writeHead(403); return res.end(); }
  fs.readFile(path.join(ROOT, url), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(url)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const ok = (msg) => console.log(`ok - ${msg}`);
const fail = (msg) => { throw new Error(msg); };
const body = (page, key) => page.evaluate((k) => document.body.dataset[k], key);

async function assertVisibleControls(page, name, where) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, select, input, h1, h2, .hud, .tip, #board')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.world-list') || el.closest('.card')) continue; // scroll containers
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.id || el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return out;
  });
  if (bad.length) fail(`${name}/${where}: controls outside the viewport: ${bad.join('; ')}`);
}

async function press(page, dir, touch) {
  const btn = page.locator(`.dir[data-dir="${dir}"]`);
  if (touch) {
    const b = await btn.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  } else await btn.click();
}

async function solveLevel(page, idx, { touch = false, via = 'buttons' } = {}) {
  const lv = LEVELS[idx];
  await page.waitForFunction((id) => document.getElementById('level-title').textContent.length > 0 && document.body.dataset.screen === 'game', lv.id);
  const start = Number(await body(page, 'moves'));
  let n = start;
  for (const d of lv.solution) {
    if (via === 'keys') await page.keyboard.press({ U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight' }[d]);
    else await press(page, d, touch);
    n++;
    await page.waitForFunction((m) => Number(document.body.dataset.moves) === m, n, { timeout: 4000 });
  }
  await page.waitForSelector('#overlay-complete:not([hidden])', { timeout: 6000 });
  const stars = Number(await body(page, 'stars'));
  if (stars !== 3) fail(`${lv.id}: expected 3 stars at par, got ${stars}`);
}

async function run(browser, name, ctxOpts, { full }) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  const touch = !!ctxOpts.hasTouch;

  await page.goto(BASE);
  await page.waitForSelector('body[data-ready="true"]');
  await assertVisibleControls(page, name, 'title');
  ok(`${name}: title screen`);

  await page.click('#btn-howto');
  await page.waitForSelector('#overlay-howto:not([hidden])');
  if (!/rolls in a straight line/.test(await page.textContent('#overlay-howto'))) fail('how-to text missing');
  await page.click('#overlay-howto .close-overlay');
  ok(`${name}: how to play opens and closes`);

  await page.click('#btn-play');
  await page.waitForSelector('#screen-game.active');
  if (await page.isHidden('#tip')) fail('first level shows no instructions');
  await assertVisibleControls(page, name, 'game');
  await solveLevel(page, 0, { touch });
  ok(`${name}: level 1 painted with the on-screen arrows (3 stars)`);
  await assertVisibleControls(page, name, 'complete');
  await page.click('#btn-next');
  await solveLevel(page, 1, { touch });
  await page.click('#btn-next');
  ok(`${name}: level 2 painted, Next advances`);

  if (!full) {
    // Tap a tile in line with the ball to roll toward it.
    await page.waitForSelector('#screen-game.active');
    const lv = LEVELS[2];
    const geo = await page.evaluate(() => { const c = document.getElementById('board'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, ...c.dataset }; });
    const [sx, sy] = lv.start;
    const tx = sx + 2; // level 3 is a ring: two tiles right of the start is floor
    await page.touchscreen.tap(geo.x + Number(geo.ox) + (tx + 0.5) * Number(geo.tile), geo.y + Number(geo.oy) + (sy + 0.5) * Number(geo.tile));
    await page.waitForFunction(() => Number(document.body.dataset.moves) === 1, null, { timeout: 4000 });
    ok(`${name}: tapping a tile in line with the ball rolls toward it`);
    await assertVisibleControls(page, name, 'game-2');
  } else {
    // Keyboard play on level 3.
    await solveLevel(page, 2, { via: 'keys' });
    await page.keyboard.press('Enter'); // focus sits on Next level
    await page.waitForSelector('#overlay-complete', { state: 'hidden' });
    ok(`${name}: level 3 painted with arrow keys; Enter goes to the next level`);

    // Level 4: blocked roll, undo, restart, hint, swipe.
    const lv = LEVELS[3];
    const disabled = await page.evaluate(() => [...document.querySelectorAll('.dir')].filter((b) => b.disabled).map((b) => b.dataset.dir));
    if (!disabled.length) fail('no walled direction is disabled on level 4');
    await press(page, lv.solution[0]);
    await page.waitForFunction(() => document.body.dataset.moves === '1');
    await page.waitForFunction(() => !document.getElementById('btn-undo').disabled);
    await page.click('#btn-undo');
    await page.waitForFunction(() => document.body.dataset.moves === '0');
    ok(`${name}: undo takes back a roll (walled arrows disabled: ${disabled.join(',')})`);
    await page.click('#btn-hint');
    const hinted = await page.evaluate(() => document.querySelector('.dir.primary')?.dataset.dir);
    if (hinted !== lv.solution[0]) fail(`hint suggested ${hinted}, expected ${lv.solution[0]}`);
    if (!/Try rolling/.test(await page.textContent('#tip'))) fail('hint text not shown');
    ok(`${name}: hint highlights the next optimal roll (${hinted})`);
    // Swipe on the board in the hinted direction.
    const box = await page.locator('#board').boundingBox();
    const [dx, dy] = { U: [0, -80], D: [0, 80], L: [-80, 0], R: [80, 0] }[hinted];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => document.body.dataset.moves === '1');
    ok(`${name}: swipe rolls the ball`);
    await page.waitForFunction(() => !document.getElementById('btn-restart').disabled);
    await page.click('#btn-restart');
    await page.waitForFunction(() => document.body.dataset.moves === '0');
    ok(`${name}: restart resets the level`);

    // Resume: a mid-level reload restores the rolls.
    await press(page, lv.solution[0]);
    await page.waitForFunction(() => document.body.dataset.moves === '1');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    if ((await page.textContent('#btn-play')) !== 'Continue') fail('title does not offer Continue');
    await page.click('#btn-play');
    await page.waitForFunction(() => document.body.dataset.moves === '1');
    ok(`${name}: in-progress level resumes after reload`);
    for (const d of lv.solution.slice(1)) { await press(page, d); await page.waitForTimeout(40); }
    await page.waitForSelector('#overlay-complete:not([hidden])', { timeout: 6000 });

    // Level select shows progress; the next level is open and later ones locked.
    await page.click('#btn-complete-levels');
    await page.waitForSelector('#screen-levels.active');
    const lvState = await page.evaluate(() => ({
      done: document.querySelectorAll('.level-btn.done').length,
      locked: document.querySelectorAll('.level-btn:disabled').length,
      stars: document.getElementById('levels-stars').textContent,
    }));
    if (lvState.done !== 4 || lvState.locked !== 55 || !/★ 12/.test(lvState.stars)) fail('level select state ' + JSON.stringify(lvState));
    ok(`${name}: level select shows ${lvState.done} done, ${lvState.locked} locked, ${lvState.stars}`);
    await page.click(`[data-level="${LEVELS[4].id}"]`);
    await page.waitForSelector('#screen-game.active');
    await page.click('#btn-menu');
    await page.waitForSelector('#screen-levels.active');
    await page.click('#screen-levels [data-goto="title"]');

    // Settings: language and graphics, persisted across reload.
    await page.click('#btn-settings');
    await page.waitForSelector('#overlay-settings:not([hidden])');
    await page.selectOption('#set-locale', 'de-DE');
    if ((await page.textContent('#btn-levels')) !== 'Level' || (await page.textContent('#tab-graphics')) !== 'Grafik') fail('German not applied');
    await page.selectOption('#set-locale', 'en-US');
    await page.click('#tab-graphics');
    await page.selectOption('#gfx-preset', 'low');
    if (await body(page, 'gfxPreset') !== 'low') fail('Low preset not applied');
    if (!/no effects/.test(await page.textContent('#gfx-summary'))) fail('Low summary: ' + await page.textContent('#gfx-summary'));
    await page.selectOption('#gfx-preset', 'high');
    await page.selectOption('#gfx-cats select[data-cat="glow"]', 'off');
    await page.check('#gfx-fps');
    const summary = await page.textContent('#gfx-summary');
    if (!/shadows/.test(summary) || /glow/.test(summary)) fail('High + glow off summary: ' + summary);
    await page.click('#overlay-settings .close-overlay');
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    if (await body(page, 'gfxPreset') !== 'high') fail('graphics preset not persisted');
    await page.click('#btn-settings');
    await page.click('#tab-graphics');
    if (await page.inputValue('#gfx-cats select[data-cat="glow"]') !== 'off') fail('glow override not persisted');
    await page.selectOption('#gfx-preset', 'ultra');
    if (await page.inputValue('#gfx-cats select[data-cat="glow"]') !== '') fail('choosing a preset did not clear overrides');
    await page.keyboard.press('Escape');
    ok(`${name}: settings — language switch, graphics presets/overrides/FPS persist, preset clears overrides`);
  }

  await context.close();
  if (errors.length) fail(`${name}: console/page errors:\n  ${errors.join('\n  ')}`);
  ok(`${name}: no console errors or warnings`);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
let code = 0;
try {
  await run(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await run(browser, 'mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  await run(browser, 'landscape', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — paint-maze, desktop + portrait + landscape');
} catch (e) {
  console.error('\nE2E FAIL:', e.stack);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
