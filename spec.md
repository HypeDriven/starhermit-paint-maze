# Paint Maze — Specification

**Status:** running spec, describing the game as it ships today.
**Genre:** coverage puzzle · **Players:** 1 · **Platforms:** desktop and mobile browsers, portrait and landscape.

## Game

A paint ball sits in a corridor maze. Each roll sends it in a straight line until the next tile is a wall, painting every tile it crosses. A level is finished when every floor tile is painted. Rolling over painted tiles is allowed but still costs a move. A roll into an adjacent wall is refused: nothing moves, the move count is unchanged, and the ball does a small bump.

**Scoring.** Each level has a par, which is the optimal number of rolls. A finish at or under par earns 3 stars, within par + 2 earns 2, and anything slower earns 1. The best move count and the most stars per level are kept.

**Assists.** Undo (unlimited), Restart and Hint are always free and never affect stars. Hint runs a breadth-first search from the current position (capped at 80,000 states). It highlights the next roll on the arrow buttons, draws a pulsing arrow beside the ball and shows "Try rolling …". If no finish exists from the current position, it says so and suggests Undo or Restart.

## Levels

There are 60 levels in `data/levels.json`, grouped into four worlds of 15: Studio, Gallery, Workshop and Atelier. Each world has its own paint and wall palette. Levels unlock one at a time: a level opens when the one before it is finished.

- The first three Studio levels are hand-authored teaching levels: a single corridor, an L-bend, and a ring.
- The other 57 are made by `tools/generate-levels.mjs`, a seeded, deterministic generator. It carves corridors with random rolls, rejects boards with open 2×2 areas above a per-world limit, and solves each candidate by BFS. The optimal solution length becomes the par, and the solution is stored with the level.
- Boards are cropped to one wall tile around the floor, so the largest board is 11×13.
- Par ranges per world: Studio 1–6, Gallery 6–10, Workshop 9–14, Atelier 12–18. Within a world, levels are ordered easiest to hardest.

## Screens and controls

- **Title:** Play (reads "Continue" once there is progress), Levels, How to play, Settings, and the total star count. When hosted, it also shows "Hi, {nickname}" and **Invite a friend**; on `*.starhermit.com` without a token it shows **Sign in with StarHermit**. Play resumes the level in progress, or opens the first unfinished level.
- **Levels:** one section per world showing its star total, in a centred column at most 68 rem wide (fifteen buttons per row on desktop). Each level button shows its stars and marks the current level; locked levels show a lock and are disabled.
- **Game:** a top bar with Levels (☰), a "World · n" title and Settings (⚙), and a HUD with Moves, Par, Left and the star rating so far. Below that are the board and the controls: four arrow buttons (arrows toward walls are disabled), Undo, Restart and Hint.
  - Phones in portrait: the controls sit in a thumb row under the board.
  - Wide desktops and phones in landscape: the controls form a column to the right of the board, with the arrows in a cross.
  - Large screens (above 1600×1000): `ui-scale.js` sets `--ui-scale` (`min(w/1600, h/1000)`, capped at 2.5) and the whole page is CSS-`zoom`ed by it (dvh/vw lengths divided by it); the board's tile-size cap and padding grow by the same factor, so the layout matches a 1600×1000 window magnified.
- **Input:** the on-screen arrows, the arrow keys or W A S D, and a swipe on the board (at least 24 px). Tapping a tile in the same row or column as the ball rolls toward it. U or Z undoes, R restarts, H shows a hint, and Esc closes a dialog or goes back a screen. Keys are matched by `KeyboardEvent.code`; on StarHermit the player's rebinds apply, and How to play lists the effective keys.
  - Each roll updates the game state immediately and its animation is queued, so fast input is never lost.
  - Undo, Restart and Hint are disabled while an animation is playing.
- **Instructions:** levels 1–3 show a tip card explaining how rolling works, painting, and planning for par. The first Gallery level has a tip about bigger mazes and Hint. "How to play" is available from the title screen.
- **Finish:** the paint ripples across the board with confetti, then a dialog shows the stars and "{moves} moves · par {par}" (plus the leaderboard line when signed in), with Replay, Levels and Next level. Focus starts on Next level, so Enter continues.
  - The last level of a world says "{World} complete!".
  - The last level of the game says that every maze is painted.
  - Beating an earlier result says "New best!".

## Presentation

The board is drawn on a Canvas 2D element. Its static layer (a raised slab, carved corridors with inner-edge shading, tile seams and a drop shadow) is cached and rebuilt only on resize or a quality change. Each frame draws the paint, the ball, the hint arrow and the particles on top, and the canvas only redraws while something is moving.

- **Rolling:** the ball eases along its path with squash and stretch, taking 110 ms + 55 ms per tile (capped at 520 ms).
- **Painting:** tiles paint as the ball's centre reaches them, spreading from the tile centre over 220 ms. The ball settles with a small bounce, and droplets splash on landing.
- **Reduced motion:** follows the `prefers-reduced-motion` setting unless changed in Settings. It shortens rolls to 90 ms and removes the bump, particles and ambient motion.

**Graphics** (Settings → Graphics tab):

- **Quality:** Auto, Low, Balanced, High or Ultra.
  - Auto is chosen from the StarHermit hardware level (see below): Low from level 0, Balanced from 4, High from 10, Ultra from 17.
  - Choosing a preset clears the per-effect overrides.
- **Render scale:** 50–200 %. The pixel-ratio cap per preset is 1 / 1.5 / 2 / 3, and Ultra renders at ×1.25.
- **Per-effect overrides**, each defaulting to "From preset (…)":
  - Shadows (slab shadow, wall shading, ball shadow)
  - Paint glow (ball halo and paint sheen)
  - Particles (off, or 30 % / all of the preset's particle budget)
  - Ambient motion (drifting paint haze)
- **Adaptive resolution:** averages 90 frames; above 26 ms it steps down by 0.1 to 60 %, and below 14 ms it steps back up by 0.05.
- **Show frame rate:** a readout in the board's corner.
- A summary line "GPU · Level N · effects · W×H px" shows the GPU name, its hardware level ("Level" localized), the active effects and the render size in pixels.
- Changes apply immediately and persist. `body[data-gfx-preset]` exposes the active preset.
- Settled paint is cached in an offscreen layer (next to the cached static board), so a frame only draws tiles still spreading, the ball, hint, particles and the finish wave — on every preset.

**Hardware-level detection.** `src/gpu-level.js` (shared StarHermit copy, `window.StarHermitGpu`, a classic script loaded before `src/main.js`, never edited here) rates the WebGL unmasked renderer plus device facts (`detectSystem()`: phone/tablet, cores, memory, screen) on the StarHermit hardware level 0–20 (0 = Galaxy S20 / Intel UHD or weaker, every software renderer and no hardware WebGL; 20 = RTX 5090; each level ≈ 1.23×; laptop parts two levels below desktop; phones, tablets and ≤ 4 GB machines capped at 9). `src/gfx.js` maps it with `presetForLevel(level, { low: 0, balanced: 4, high: 10, ultra: 17 })`, so Auto picks Ultra on strong GPUs; adaptive resolution still steps down when slow. Headless SwiftShader is level 0 → Low. Phones and tablets pace Auto FPS at half the display refresh rate ("Auto (half refresh rate)") and start at 16 simultaneous sounds (shared `game-options.js`).

**Per-preset budgets** (`BUDGETS` / `budgetFor` / `particleCap` in `src/gfx.js`). Each preset holds 60 FPS on the weakest GPU Auto gives it — Low at level 0, Balanced 4, High 10, Ultra 17. Board, tiles, controls and rules are identical on every preset; only visuals change. Counts are tuned at the floor level and scale up within the preset on faster GPUs (`StarHermitGpu.scaleBudget`, ≤ 2×, at most 720 particles).

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Particle cap at Particles high (low: 30 %) | 80 | 120 | 220 | 360 |
| Level-complete confetti at Particles high (low: 40 %) | 40 | 60 | 90 | 140 |
| Drifting haze blobs (Ambient on) | 3 | 4 | 7 | 10 |
| Canvas pixel-ratio cap / scale | 1 | 1.5 | 2 | 3 × 1.25 |
| Per-frame `shadowBlur` ball halo (Glow) | off | off | on | on |

**Benchmark** (`node tools/gfx-bench.mjs paint-maze`; hook `tests/gfx-bench.mjs` picks the preset in Settings → Graphics, presses Play and keeps rolling with the on-screen direction buttons, restarting every dozen rolls and going Next after a finished level). A 2D canvas: the gate is CPU time per frame. Measured 2026-10-17 (GPU ms above the draws-skipped floor, projected to the preset's floor level; CPU p90 on the RTX 5090 run):

- Desktop 1920×1080: PASS low (typical 0.00 / slow 0.00 ms GPU, CPU 0.40 ms); PASS balanced (0.00 / 0.00, CPU 0.40); PASS high (0.00 / 0.05, CPU 0.50); PASS ultra (0.00 / 0.00, CPU 0.50).
- Mobile 390×844 @3×: PASS low (0.00 / 0.23, CPU 0.30); PASS balanced (0.00 / 0.14, CPU 0.40).

**Audio.** Short authored samples play through Web Audio, which starts on the first gesture. The sounds are listed in `sfx/manifest.txt`: roll, landing (splat when new tiles were painted, otherwise stop), bump, undo, hint, level complete, three stars, world complete, and game complete. Volume is set in Settings. Missing or undecodable audio is skipped.

## Settings and persistence

Settings → General has the language (all nine locales), sound volume and Reduce motion.

Progress is saved in `localStorage` (`paint-maze:v2`):

- per-level best moves and stars
- the level in progress, stored as its roll string and replayed on resume, so undo history survives a reload
- settings

## Localization

All UI text comes from `src/i18n.js` in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT.

- **Language setting:** Settings → General → **Language** lists **Automatic — <resolved language>** and the nine locales by native name, with a status line (Saved to account / Saved on this device / Account sync unavailable). It is bound to `sh-language.js` (`GameLanguage.bindSelect`), so the shared options panel shows no second selector. An older explicit locale choice migrates once.
- **Resolution:** explicit choice → for Automatic, the StarHermit account's `preferredLanguage` (`GET /api/v1/me/language`, signed in only) → the browser's languages → en-US, matching tags to the nearest shipped locale (es-MX → es-419, fr-BE → fr-FR, en-AU → en-GB, pt-PT → pt-BR). The choice is stored per player in `localStorage['paint-maze.language.<user|guest>']` and, when signed in, in the per-player settings key `ui.language` as `{ choice }`; a failed settings read never overwrites it and the game never writes the platform preference. Standalone play makes no language request. `?lang=<tag>` forces a locale for the page load (QA links) and hides the selector.
- **Live switching:** a change applies at once — `<html lang>`, every `data-i18n` label, the HUD, level title, tip, key list, Graphics panel, sync pill, greeting and an open finish dialog (with its leaderboard line) re-render in place; the level in progress is untouched.
- `tests/i18n.test.mjs` checks that every key used in markup and code exists in all nine locales with matching placeholders.

## StarHermit integration

All platform traffic goes through the shared SDK `starhermit-sdk.js` (an unmodified copy of the canonical client, loaded before `src/main.js` as `window.StarHermit`); `src/platform.js` adapts it. `starhermit.txt` declares `name`, `description`, `launch`, `owner`, `server=score-script.js`, `cover` and one `control.<action>=<codes> | <label>` line per keyboard action.

- **Launch token:** `StarHermit.init()` reads `#game_token=` (library launch) or `#access_token=` (direct sign-in return) once and strips it; the slug is the `game_scope` claim. The SDK renews the token before expiry. If renewal is refused the greeting hides, a "signed out — playing locally" toast shows, sign-in is re-offered and play continues locally.
- **Sign-in:** on `*.starhermit.com` without a token the title shows **Sign in with StarHermit** (`StarHermit.signIn()`); hidden when signed in and when running locally.
- **Identity:** the profile nickname (fallback a localized "Player <id prefix>") is shown on the title screen.
- **Cloud save:** progress, the level in progress and tips seen are mirrored to the `game:<slug>` slot through `StarHermit.loadJSON` / `writeSave`, so every write after the launch load is conditional on the version it saw. Saves are debounced by 2 s and flushed on `pagehide` or when the page is hidden. A pill shows Saving… / Saved to cloud / an error.
- **Merging:** on launch, the remote document is merged in (`mergeRemote`): the fewest moves and most stars per level win, tips seen are unioned, and this device's level in progress is kept (the remote one is used only when there is none); the merged document is written back when it differs. When another device saved first, the SDK refuses the write and emits `saveconflict`: the game re-reads the slot, applies the same merge and saves again, so neither side's progress is lost.
- **Report a problem:** Settings → Graphics → **Report a problem** (signed in only, from the shared `game-options.js`) files a bug report through `StarHermit.reportBug` with a small non-personal `context.json` (viewport, language, FPS cap, audio limit); uncaught errors are filed as crash reports through `StarHermit.captureCrashes` (SDK-capped).
- **Settings KV:** volume, Reduce motion and the graphics settings are patched to the per-player settings store on change and applied at boot (the account value wins).
- **Controls:** keyboard input routes through `StarHermit.loadBindings()` (platform rebinds over the `control.*` defaults).
- **Invite:** **Invite a friend** copies `StarHermit.inviteLink()` to the clipboard and confirms with a toast.
- **Leaderboard:** after every finished level, a signed-in player's total star count (all levels) is posted through `StarHermit.submitScores` to the `total-stars` board (integer, higher is better, 0–180). The platform script `score-script.js` (canonical copy in the games repo's `tools/score-script.js`) accepts it on a practice session, range-checks it and posts it. The finish dialog shows "Leaderboard rank: #N" (or posted / not posted) under the move count.
- **Offline:** without a token, the game runs entirely offline, makes no request and shows no leaderboard line.

Matchmaking, chat, achievements and replays are not used.

## Files

| Path | Contents |
|---|---|
| `index.html`, `styles.css` | Page and layout |
| `src/rules.js` | Pure rules: parsing, rolls, legality, BFS solver, stars, replay, snapshots |
| `src/render.js` | Canvas renderer and palettes |
| `src/main.js` | Screens, input, level flow, settings, persistence wiring |
| `src/gpu-level.js` | Shared StarHermit hardware-level module (`window.StarHermitGpu`), copied from the platform tools, never edited here |
| `src/gfx.js` | Pure graphics-quality model: presets, hardware-level detection (`detectLevel`, `presetForLevel`, `detectTier`), per-preset `BUDGETS` / `budgetFor` / `particleCap` |
| `src/i18n.js`, `src/storage.js`, `src/audio.js`, `src/platform.js` | Strings, profile/cloud doc, sound, StarHermit adapter |
| `score-script.js` | StarHermit platform script (`server=`): range-checks the posted total stars and posts them to the `total-stars` board |
| `data/levels.json` | The 60 levels, with par and optimal solution |
| `tools/generate-levels.mjs`, `tools/serve.mjs` | Level generator, dev static server (`npm start`) |
| `tests/` | Unit tests, `e2e.mjs`, `hosted.mjs`, `gfx-bench.mjs` (dev-only hook for the platform's `tools/gfx-bench.mjs`) |

## Tests

- `npm test` runs the unit tests:
  - rules and solver
  - every level is enclosed, its stored solution completes it, and its par equals the BFS optimum
  - the difficulty ramp and phone-sized boards
  - the graphics model (hardware level → preset: no WebGL/SwiftShader/llvmpipe, AMD Radeon Graphics and Intel UHD → Low, Iris Xe → Balanced, GTX 1070 → High, RTX 4080/5090 → Ultra, phones such as Adreno 740 capped at Balanced; the per-preset budget table)
  - storage and cloud merge
  - every locale has every key with matching placeholders, and every key used in markup and code exists
  - the platform adapter: ETag-conditional cloud save, a 412 conflict that re-reads, merges and saves, sign-in on a UUID host, no requests standalone
- `npm run test:e2e` drives the visible UI in Chrome at 1280×800, 390×844 (touch) and 844×390 (touch). It solves levels with the on-screen arrows, keys, swipe and tile taps, and exercises How to play, Undo, Hint, Restart, resume after reload, level select state, and the language and graphics settings with persistence. At 1280×800 and 390×844 it ends with a language step against a stubbed StarHermit API: the account's preferred fr-CA makes Automatic resolve to French (Canada); choosing Deutsch mid-level re-renders the settings, HUD and tip in place without resetting the level, PUTs `ui.language`, and Report a problem posts to `/reports`. It fails on any console error or warning, failed request, or control outside the viewport.
- `npm run test:hosted` checks the StarHermit flow (token strip, nickname, `game:<slug>` cloud save, restore) against a fake API.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.


## Sound and frame-rate options

The options panel includes Sound controls for master, music, effects and UI volume, a mute that preserves volume levels, and an Auto or manual concurrent-sound limit (1–64). Changes apply immediately with perceptual volume curves. A shared allocator bounds Web Audio and media playback, including loops and scheduled sources. Graphics includes Auto display refresh or a custom maximum frame rate from 1–1000 FPS; rendering is paced independently of simulation and input. Preferences persist locally, with FPS stored per detected GPU, and reconcile with Starhermit settings when signed in. The controls support keyboard and touch input and the supported English, Spanish, German, French, Portuguese and Italian locales.
