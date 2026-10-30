# Paint Maze — Specification

**Status:** running spec, describing the game as it ships today.
**Genre:** coverage puzzle · **Players:** 1 · **Platforms:** the StarHermit engine (engine 1.28.0, `engine.minor=30`): natively in the StarHermit client and in browsers through the engine's web runtime; desktop and phones, portrait and landscape.

## Game

A paint ball sits in a corridor maze. Each roll sends it in a straight line until the next tile is a wall, painting every tile it crosses. A level is finished when every floor tile is painted. Rolling over painted tiles is allowed but still costs a move. A roll into an adjacent wall is refused: nothing moves, the move count is unchanged, and the ball does a small bump.

**Scoring.** Each level has a par, which is the optimal number of rolls. A finish at or under par earns 3 stars, within par + 2 earns 2, and anything slower earns 1. The best move count and the most stars per level are kept.

**Assists.** Undo (unlimited), Restart and Hint are always free and never affect stars. Hint runs a breadth-first search from the current position (capped at 80,000 states; a few milliseconds even natively). It highlights the next roll on the arrow buttons, draws a pulsing arrow beside the ball and shows "Try rolling …" in the tip card. If no finish exists from the current position, it says so and suggests Undo or Restart.

## Levels

There are 60 levels in `data/levels.json`, grouped into four worlds of 15: Studio, Gallery, Workshop and Atelier. Each world has its own paint, wall and page colours. Levels unlock one at a time: a level opens when the one before it is finished.

- The first three Studio levels are hand-authored teaching levels: a single corridor, an L-bend, and a ring.
- The other 57 are made by `tools/generate-levels.mjs` (`npm run levels`), a seeded, deterministic generator. It carves corridors with random rolls, rejects boards with open 2×2 areas above a per-world limit, and solves each candidate by BFS. The optimal solution length becomes the par, and the solution is stored with the level.
- Boards are cropped to one wall tile around the floor, so the largest board is 11×13.
- Par ranges per world: Studio 1–6, Gallery 6–10, Workshop 9–14, Atelier 12–18. Within a world, levels are ordered easiest to hardest.

## Screens

- **Title:** the four-square logo (squares pop in turn), Play (reads "Continue" once there is progress), Levels, How to play, Settings, and the total star count. Signed in, it greets "Hi, {nickname}" and offers **Invite a friend**; signed out it offers **Sign in with StarHermit**. Play resumes the level in progress, or opens the first unfinished level. Settings opens the runtime's Options.
- **Levels:** a top bar (Back, "Levels", a ★ total pill), then one section per world with its star total, in a centred column at most 1088 px wide (fifteen buttons per row on desktop, `repeat(auto-fill, minmax(64px, 1fr))` elsewhere), scrolling when taller than the window. Each button shows the level number and its stars (in the world's accent), done levels have an accent border, the current level is filled with the accent and takes focus; locked levels show 🔒 and are disabled, a locked world is dimmed.
- **Game:** a top bar with Levels (☰), a "World · n" title and Settings (⚙, the runtime's Options), a HUD with Moves, Par, Left and the star rating so far, an optional tip card (accent edge), the board and the controls: four arrow buttons (arrows toward walls are disabled; the hinted one shows filled), Undo, Restart and Hint (disabled while a roll animates).
  - Portrait: the arrows in a thumb row under the board, the tools under them.
  - Wide windows (≥ 900 × 560 logical px): the controls in a 260 px column right of the board, the arrows in a cross, the tools stacked.
  - Landscape phones (≤ 559 px tall): a 220 px column with a smaller cross, tools wrapping; the title drops the logo.
  - The runtime's interface size and text size scale the whole layout (replacing the browser build's `ui-scale.js`).
- **Instructions:** levels 1–3 show a tip card explaining rolling, painting and par; the first Gallery level has a tip about bigger mazes and Hint. "How to play" (title) lists the rules and the effective keys from the player's bindings; it closes with Close, Esc or a press outside it.
- **Finish:** the paint ripples across the board with confetti, then (0.75 s later, 0.15 s with reduced motion) a card shows the stars and "{moves} moves · par {par}" (plus "New best!" when an earlier result was beaten, and the leaderboard line when signed in), with Replay, Levels and Next level. Focus starts on Next level (Replay on the last level), so Enter continues.
  - The last level of a world says "{World} complete!"; the last level of the game says every maze is painted.
- A sync pill (Saving… / Saved to cloud / Cloud save failed) shows while signed in; a toast confirms invites and a sign-out.

## Controls

| Action | Keys (rebindable) | Gamepad | Pointer / touch |
|---|---|---|---|
| Roll up / down / left / right | ↑ W / ↓ S / ← A / → D | D-pad or left stick | the arrow buttons; a swipe on the board (≥ 24 px); a tap on a tile in the ball's row or column rolls toward it |
| Undo | U, Z | West | Undo |
| Restart | R | Select | Restart |
| Hint | H | North | Hint |
| Back / close | Esc | East, Start | ☰, ← and Close buttons |

Action names in `starhermit.txt` are lowercase (`roll_up` …); rebinds made in the browser build (`rollUp` …) do not carry over. On the game screen the roll keys always roll (they take the arrows back from a focused button, as the browser build's document handler did); Tab, Enter and the D-pad navigate the buttons elsewhere. Each roll updates the game state at once and its animation is queued, so fast input is never lost. F1 opens the runtime's Options.

## Presentation

The board is drawn as the browser build's Canvas 2D renderer drew it: the static layer (a raised slab with a soft drop shadow, corridors carved into it with inner-edge shading, tile seams) is painted with the same canvas code into a `starhermit:canvas` OffscreenCanvas once per level, window size or quality, and drawn as one image. Each frame draws the paint (tiles spreading from their centres over 220 ms), the drifting paint haze, the finish wave, the hint arrow, droplets and confetti and the ball with `starhermit:draw` primitives; the ball (radial gradient, rim, highlight, the glow halo) is a sprite painted once per tile size and squashed or stretched as it rolls. Animations run on the frame clock.

- **Rolling:** 110 ms + 55 ms per tile (capped at 520 ms), eased, with squash and stretch; the ball settles with a small bounce and droplets splash on landing.
- **Reduced motion** (the runtime's accessibility option): rolls take 90 ms and the bump, particles, haze and logo pop are off.
- **Graphics** follow the runtime's quality tier (`frame().quality`, `native/quality.ts`), as the browser build's presets did; counts grow up to 2× with the level index within a tier:

| | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Slab shadow, deeper wall shading, ball shadow | off | on | on | on |
| Ball halo and paint sheen | off | off | on | on |
| Particles (cap) | off | 30 % of 120 | 220 | 360 |
| Finish confetti | off | 40 % of 60 | 90 | 140 |
| Haze blobs | off | 4 | 7 | 10 |

The runtime's Options own what the old Settings › Graphics tab did (Auto by hardware level, render scale and pixel-ratio cap, adaptive resolution, frame-rate limit and readout); the old per-effect overrides are not offered.

**Audio.** Short authored samples (`sfx/`, listed in `sfx/manifest.txt`) play on the runtime's effects bus: roll, landing (splat when new tiles were painted, otherwise stop), bump, undo, hint, level complete, three stars (0.35 s after), world complete and game complete. Volumes, mute and the voice limit are the runtime's Options › Audio. Clips load one at a time once the mixer runs (in browsers after the first press); a sample still loading is silent.

## Persistence and StarHermit integration

- **Save:** the progress document `{ v: 2, progress: { levelId: { best, stars } }, current: { id, dirs } | null, tutorialSeen }` (`src/storage.js`) is the engine save (`starhermit:storage` `saves`, schema 2): on the device and, signed in, in the account's cloud slot. The level in progress is stored as its roll string and replayed on resume, so undo history survives. A conflict between devices merges (fewest moves and most stars per level win, tips seen are unioned, this device's level in progress is kept).
- **Migration:** the browser build's cloud save (`game:<slug>`, the same document written by the JS SDK) shows as a foreign save; it is merged in and replaced once (`replaceForeign`). Guests' old browser `localStorage` progress does not migrate. The browser build's account settings keys (`volume`, `reducedMotion`, `gfx`, `ui.language`) are removed; the runtime's Options own them now.
- **Language:** all text comes from `src/i18n.js` in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT, in the runtime's interface language (Options › Language, else the account's or device's), matched to the nearest shipped locale (es-MX → es-419, fr-BE → fr-FR, en-AU → en-GB, pt-PT → pt-BR). A change applies on the next frame; the level in progress is untouched.
- **Leaderboard:** after every finished level, a signed-in player's total star count is posted through the platform script `score-script.js` (`server=`; a practice session whose socket carries `{ type: 'result', scores: { 'total-stars': n } }`) to the `total-stars` board (integer, higher is better, 0–180). The script range-checks the client's total (the user's decision for solo boards; no server-side replay check). The finish card shows "Leaderboard rank: #N" (or posted / not posted).
- **Invite:** **Invite a friend** copies the platform's invite link to the clipboard and confirms with a toast.
- **Offline / guest:** the game runs fully offline; no leaderboard line is shown.

Matchmaking, chat, achievements and replays are not used.

## Files

| Path | Contents |
|---|---|
| `starhermit.txt` | Manifest: entry, engine pin, capabilities (`platform,storage,clipboard`), controls and gamepad defaults |
| `native/main.ts` | Entry: level flow, input (actions, swipes, taps), lifecycle |
| `native/screens.ts` | Title, levels, game layouts, cards, sync pill, toast |
| `native/render.ts` | Board renderer (canvas static layer + draw primitives) and palettes |
| `native/platform.ts` | Save, foreign-save migration, legacy settings cleanup, player, invite, leaderboard post |
| `native/audio.ts`, `native/quality.ts`, `native/style.ts`, `native/i18n.ts`, `native/game.ts` | Sound, quality tiers, UI styles and world tokens, locale wiring, typed facade over `src/` |
| `src/rules.js`, `src/storage.js`, `src/i18n.js` | Pure rules and BFS solver, progress document and merge, strings (shared with tests) |
| `data/levels.json` | The 60 levels with par and optimal solution |
| `tools/ui-style.css` → `assets/ui-style.json` | Class-based style sheet (`npm run css`) |
| `score-script.js` | Platform script posting `total-stars` |
| `index.html`, `starhermit-files.json` | The web loader and file index written by `npm run package` (never edited by hand) |

## Checks

- `npm test` = `npm run test:unit` (rules and solver; every level enclosed, its stored solution completes it, par equals the BFS optimum, difficulty ramp and phone-sized boards; progress document, foreign-save migration and merges; every locale has every key the client uses with matching placeholders and no unused rows) + `npm run test:native` (`tests/native.mjs`: web index up to date, `tsc`, `starhermit check .` with no warnings, and every `tests/native/*.play` as a guest render check):
  - `menus.play` (desktop): How to play, Options, the level list, keys (blocked roll, Hint, Esc navigation, Continue, U, R), Enter on the finish card.
  - `journey.play` (generated by `npm run plays`): all 60 levels solved in par with the keys, ending at 180 / 180 stars.
  - `phone.play` (390×844 @3): tile tap, swipe, arrows, Undo, Hint, Restart by touch.
  - `landscape.play` (844×390 @3): the side-column layout by touch.
- `npm run test:browser` (`tools/browser-play.mjs`): the packaged loader in Chrome on the GPU at 1366×768, 390×844 @3 and 844×390 @3 — keys, swipes (CDP touch), buttons, Hint, Undo, the finish cards and the level list — failing on console errors or warnings. `~/games/tools/engine-web-smoke.mjs` checks start-up at desktop and phone sizes.
- Signed-in paths (cloud merge, foreign save, legacy settings, leaderboard post) are covered by the unit tests of their logic; they are not live-tested here.

## Known limitations

- Rebinds made in the browser build do not carry over (actions were renamed to lowercase).
- Guests' browser-only progress (`localStorage`) does not migrate; signed-in cloud saves do.
- The finish and how-to cards are placed panels, not modal dialogs: arrow keys can move focus to the (dimmed) buttons behind them, as Tab could in the browser build.
