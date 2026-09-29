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

- **Title:** Play (reads "Continue" once there is progress), Levels, How to play, Settings, and the total star count. When hosted, it also shows "Hi, {nickname}". Play resumes the level in progress, or opens the first unfinished level.
- **Levels:** one section per world showing its star total. Each level button shows its stars and marks the current level; locked levels show a lock and are disabled.
- **Game:** a top bar with Levels (☰), a "World · n" title and Settings (⚙), and a HUD with Moves, Par, Left and the star rating so far. Below that are the board and the controls: four arrow buttons (arrows toward walls are disabled), Undo, Restart and Hint.
  - Phones in portrait: the controls sit in a thumb row under the board.
  - Wide desktops and phones in landscape: the controls form a column to the right of the board, with the arrows in a cross.
- **Input:** the on-screen arrows, the arrow keys or W A S D, and a swipe on the board (at least 24 px). Tapping a tile in the same row or column as the ball rolls toward it. U or Z undoes, R restarts, H shows a hint, and Esc closes a dialog or goes back a screen.
  - Each roll updates the game state immediately and its animation is queued, so fast input is never lost.
  - Undo, Restart and Hint are disabled while an animation is playing.
- **Instructions:** levels 1–3 show a tip card explaining how rolling works, painting, and planning for par. The first Gallery level has a tip about bigger mazes and Hint. "How to play" is available from the title screen.
- **Finish:** the paint ripples across the board with confetti, then a dialog shows the stars and "{moves} moves · par {par}", with Replay, Levels and Next level. Focus starts on Next level, so Enter continues.
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
  - Auto is chosen from the GPU's unmasked renderer name: no hardware context or a software renderer gives Low, discrete GPUs and Apple M-series give High, and anything else gives Balanced. Touch devices are capped at Balanced.
  - Choosing a preset clears the per-effect overrides.
- **Render scale:** 50–200 %. The pixel-ratio cap per preset is 1 / 1.5 / 2 / 3, and Ultra renders at ×1.25.
- **Per-effect overrides**, each defaulting to "From preset (…)":
  - Shadows (slab shadow, wall shading, ball shadow)
  - Paint glow (ball halo and paint sheen)
  - Particles (off, or budgets of 60 or 220)
  - Ambient motion (drifting paint haze)
- **Adaptive resolution:** averages 90 frames; above 26 ms it steps down by 0.1 to 60 %, and below 14 ms it steps back up by 0.05.
- **Show frame rate:** a readout in the board's corner.
- A summary line shows the GPU name, the active effects and the render size in pixels.
- Changes apply immediately and persist. `body[data-gfx-preset]` exposes the active preset.

**Audio.** Short authored samples play through Web Audio, which starts on the first gesture. The sounds are listed in `sfx/manifest.txt`: roll, landing (splat when new tiles were painted, otherwise stop), bump, undo, hint, level complete, three stars, world complete, and game complete. Volume is set in Settings. Missing or undecodable audio is skipped.

## Settings and persistence

Settings → General has the language (all nine locales), sound volume and Reduce motion.

Progress is saved in `localStorage` (`paint-maze:v2`):

- per-level best moves and stars
- the level in progress, stored as its roll string and replayed on resume, so undo history survives a reload
- settings

## Localization

All UI text comes from `src/i18n.js` in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT. The first-run locale is matched from the browser language (for example es-MX → es-419, fr-BE → fr-FR, en-AU → en-GB); after that, the Settings choice is used.

## StarHermit integration

`src/platform.js` works as follows:

- **Launch token:** read once from the `#game_token` URL fragment and then stripped.
- **Identity:** the nickname comes from `/api/v1/users/{sub}/profile` and is shown on the title screen. The username is never shown.
- **Token refresh:** the launch token is refreshed every 45 minutes.
- **Cloud save:** progress, the level in progress and tips seen are mirrored to the cloud-save slot as a zip, base64-encoded. Saves are debounced by 2 s and flushed on `pagehide` or when the page is hidden. A pill shows Saving… / Saved to cloud / an error.
- **Merging:** on launch, the remote document is merged in. The best moves and most stars per level win, and the remote level in progress is preferred.
- **Offline:** without a token, the game runs entirely offline.

There is no server script.

## Files

| Path | Contents |
|---|---|
| `index.html`, `styles.css` | Page and layout |
| `src/rules.js` | Pure rules: parsing, rolls, legality, BFS solver, stars, replay, snapshots |
| `src/render.js` | Canvas renderer and palettes |
| `src/main.js` | Screens, input, level flow, settings, persistence wiring |
| `src/gfx.js` | Pure graphics-quality model |
| `src/i18n.js`, `src/storage.js`, `src/audio.js`, `src/platform.js` | Strings, profile/cloud doc, sound, StarHermit adapter |
| `data/levels.json` | The 60 levels, with par and optimal solution |
| `tools/generate-levels.mjs`, `tools/serve.mjs` | Level generator, dev static server (`npm start`) |
| `tests/` | Unit tests, `e2e.mjs`, `hosted.mjs` |

## Tests

- `npm test` runs the unit tests:
  - rules and solver
  - every level is enclosed, its stored solution completes it, and its par equals the BFS optimum
  - the difficulty ramp and phone-sized boards
  - the graphics model
  - storage and cloud merge
  - every locale has every key with matching placeholders
- `npm run test:e2e` drives the visible UI in Chrome at 1280×800, 390×844 (touch) and 844×390 (touch). It solves levels with the on-screen arrows, keys, swipe and tile taps, and exercises How to play, Undo, Hint, Restart, resume after reload, level select state, and the language and graphics settings with persistence. It fails on any console error or warning, failed request, or control outside the viewport.
- `npm run test:hosted` checks the StarHermit flow against a fake API.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.
