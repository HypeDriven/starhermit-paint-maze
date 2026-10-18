// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts play and keeps rolling the ball with the on-screen direction buttons — paint spreads, the ball
// rolls and squashes, blocked rolls bump, drift haze moves; every dozen rolls the level restarts (the
// Restart button) so fresh paint keeps spreading, and a finished level goes to Next.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#overlay-settings:not([hidden])');
  await page.click('#tab-graphics');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#overlay-settings .close-overlay');
  await page.waitForSelector('#overlay-settings', { state: 'hidden' });
}

const DIRS = ['R', 'D', 'L', 'U', 'D', 'R', 'U', 'L'];

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 15000 });
  let open = true, i = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('#overlay-complete:not([hidden])').count()) {
          await page.click('#btn-next', { timeout: 3000 });
        } else if (++i % 12 === 0 && await page.locator('#btn-restart').isEnabled()) {
          await page.click('#btn-restart', { timeout: 2000 });
        } else {
          await page.click(`.dir[data-dir="${DIRS[i % DIRS.length]}"]`, { timeout: 2000 });
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(350).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
