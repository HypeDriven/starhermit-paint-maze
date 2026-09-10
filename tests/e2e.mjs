/**
 * Paint Maze — end-to-end playthrough test (dev only, not shipped).
 *
 * Serves the repo with an embedded static server (ephemeral port) and drives
 * the real visible UI in headless Chrome (playwright-core + system Chrome),
 * on desktop (1280x800) and mobile (390x844, touch) viewports.
 *
 * Screenshots: /tmp/paint-maze-e2e-<stage>-<desktop|mobile>.png
 *
 * Covers: boot, a full playthrough to "Complete!" driven only through real
 * arrow keys and on-screen direction buttons (the direction to press comes from
 * the in-page hint API, but every input is a genuine key press or click), the
 * win overlay, undo, restart, save/resume across a reload, and touch-target
 * sizes on a phone viewport. Fails on any non-benign console/page error.
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
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ts': 'text/plain',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  // The same files also answer under /nested/game/ so root-absolute asset
  // paths (which break when a game is served from a subfolder) fail here.
  if (url.startsWith('/nested/game/')) url = url.slice('/nested/game'.length);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// Benign GPU/swiftshader noise, from tools/production_game_audit.mjs.
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const SHOT = (stage, vp) => `/tmp/paint-maze-e2e-${stage}-${vp}.png`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

async function readHud(page) {
  return page.evaluate(() => ({
    remaining: document.getElementById('hud-score').textContent.trim(),
    moves: document.getElementById('hud-moves').textContent.trim(),
    status: document.getElementById('status-line').textContent.trim(),
  }));
}

async function runPass(vpName, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!browserNoise.test(e.message)) errors.push(`pageerror: ${e.message}`); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  let responsive = false;
  try {
    await step(`${vpName}: load — HUD, canvas and direction controls visible`, async () => {
      await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
      // Start from a clean slate once, then let the game persist normally.
      await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#hud', { state: 'visible', timeout: 10000 });
      await page.waitForSelector('#game-canvas', { state: 'visible' });
      for (const id of ['#btn-up', '#btn-left', '#btn-down', '#btn-right']) {
        await page.waitForSelector(id, { state: 'visible' });
      }
      await page.screenshot({ path: SHOT('loaded', vpName) });
    });

    await step(`${vpName}: direction buttons visible and clickable`, async () => {
      for (const id of ['#btn-up', '#btn-left', '#btn-down', '#btn-right']) {
        const box = await page.locator(id).boundingBox();
        if (!box || box.width < 20 || box.height < 20) {
          throw new Error(`${id} unusable on ${vpName}: ${JSON.stringify(box)}`);
        }
        if (box.width < 44 || box.height < 44) {
          console.log(`  note (${vpName}): ${id} is ${Math.round(box.width)}x${Math.round(box.height)}px,`
            + ' below the 44x44px touch-target minimum in spec.md');
        }
      }
    });

    await step(`${vpName}: game boots with a live board`, async () => {
      await page.waitForFunction(() => {
        const s = window.__paintMaze && window.__paintMaze.state();
        return !!s && parseInt(document.getElementById('hud-score').textContent, 10) > 0;
      }, null, { timeout: 10000 });
      const hud = await readHud(page);
      if (hud.moves !== '0') throw new Error(`fresh game started at moves=${hud.moves}`);
    });

    await step(`${vpName}: play to completion via real arrow keys and buttons`, async () => {
      const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
      const btns = ['#btn-up', '#btn-right', '#btn-down', '#btn-left'];
      for (let i = 0; i < 600; i++) {
        const hud = await readHud(page);
        if (parseInt(hud.moves, 10) > 0) responsive = true;
        if (hud.remaining === '0') break;
        const dir = await page.evaluate(() => window.__paintMaze.hint());
        if (dir === null || dir === undefined) throw new Error('no hint available mid-game');
        // Alternate between the two real input paths a player would use.
        if (i % 2 === 0) await page.keyboard.press(keys[dir]);
        else await page.locator(btns[dir]).click();
        if (i === 3) await page.screenshot({ path: SHOT('play', vpName) });
      }
      await page.waitForFunction(
        () => document.getElementById('status-line').textContent.trim() === 'Complete!',
        null, { timeout: 30000 },
      );
      const final = await readHud(page);
      if (final.remaining !== '0') throw new Error(`won but remaining=${final.remaining}`);
      if (!(parseInt(final.moves, 10) > 0)) throw new Error('won without any moves');
      await page.waitForSelector('#overlay', { state: 'visible' });
      console.log(`  completed in ${final.moves} moves`);
      await page.screenshot({ path: SHOT('complete', vpName) });
    });

    await step(`${vpName}: undo restores the previous position`, async () => {
      await page.locator('#btn-overlay-next').click(); // dismiss win overlay via New maze
      await page.waitForSelector('#overlay', { state: 'hidden' });
      await page.waitForFunction(() => window.__paintMaze.state().moves === 0);
      const dir = await page.evaluate(() => window.__paintMaze.hint());
      await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][dir]);
      await page.waitForFunction(() => window.__paintMaze.state().moves === 1);
      const painted = await page.evaluate(() => window.__paintMaze.state().ballIdx);
      await page.locator('#btn-undo').click();
      await page.waitForFunction(() => window.__paintMaze.state().moves === 0);
      const back = await page.evaluate(() => window.__paintMaze.state().ballIdx);
      if (back === painted) throw new Error('undo left the roller where it was');
      const hud = await readHud(page);
      if (hud.moves !== '0') throw new Error(`undo left moves=${hud.moves}`);
    });

    await step(`${vpName}: progress survives a reload, restart clears it`, async () => {
      const dir = await page.evaluate(() => window.__paintMaze.hint());
      await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][dir]);
      await page.waitForFunction(() => window.__paintMaze.state().moves === 1);
      const before = await page.evaluate(() => {
        const s = window.__paintMaze.state();
        return { seed: s.seedStr, ball: s.ballIdx, moves: s.moves };
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!(window.__paintMaze && window.__paintMaze.state()));
      const after = await page.evaluate(() => {
        const s = window.__paintMaze.state();
        return { seed: s.seedStr, ball: s.ballIdx, moves: s.moves };
      });
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`save not restored: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      }
      await page.locator('#btn-restart').click();
      await page.waitForFunction(() => window.__paintMaze.state().moves === 0);
      const restarted = await page.evaluate(() => window.__paintMaze.state().seedStr);
      if (restarted !== before.seed) throw new Error('restart changed the maze seed');
    });

    if (errors.length) {
      throw new Error(`${vpName}: non-benign page errors:\n` + errors.join('\n'));
    }
    await step(`${vpName}: no non-benign console/page errors`, async () => {});
  } finally {
    await context.close();
  }
  return { responsive, errors };
}

// Boot without a web server (file://) and from a subfolder: both fail if any
// asset is referenced by a root-absolute path such as /bundle.js.
async function bootsAt(url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => {
      const s = window.__paintMaze && window.__paintMaze.state();
      return !!s && parseInt(document.getElementById('hud-score').textContent, 10) > 0;
    }, null, { timeout: 10000 });
    const helpOpen = await page.evaluate(() => document.getElementById('how-to-play').open);
    if (!helpOpen) throw new Error('How to play is not open for a first-time player');
    await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][
      await page.evaluate(() => window.__paintMaze.hint())]);
    await page.waitForFunction(() => window.__paintMaze.state().moves === 1);
    if (await page.evaluate(() => document.getElementById('how-to-play').open)) {
      throw new Error('How to play stayed open after the first roll');
    }
  } finally {
    await context.close();
  }
}

let exitCode = 0;
try {
  await step('boots from a subfolder URL (no root-absolute asset paths)',
    () => bootsAt(BASE + 'nested/game/index.html'));
  await step('boots from file:// (index.html opened straight from disk)',
    () => bootsAt('file://' + path.join(ROOT, 'index.html')));
  const desktop = await runPass('desktop', { width: 1280, height: 800 }, false);
  const mobile = await runPass('mobile', { width: 390, height: 844 }, true);

  const allErrors = [...desktop.errors, ...mobile.errors];
  if (allErrors.length) {
    console.log('PAGE ERRORS:\n' + allErrors.join('\n'));
    exitCode = 1;
  } else if (!desktop.responsive || !mobile.responsive) {
    console.log('\nE2E FAIL — inputs produced no game response on'
      + `${desktop.responsive ? '' : ' desktop'}${mobile.responsive ? '' : ' mobile'}`);
    exitCode = 1;
  } else {
    console.log('\nE2E PASS — full playthrough completed on desktop and mobile, no page errors');
  }
} catch (e) {
  console.error('E2E FAIL:', e.stack || e.message || e);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
