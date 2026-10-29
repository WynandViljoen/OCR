# Modern TIM: handoff notes (2026-10-28)

Where the project stands, so a new chat can pick up exactly here.

## What it is
A browser physics puzzle game in the spirit of *The Incredible Machine*, aimed at STEM kids (about 8 to 13).
Vite + TypeScript + Matter.js 0.20, plain HTML/CSS, custom canvas rendering. Each level teaches one idea.

- v0.3d: "Test all levels" UI removed (selftest.ts stays for `npm run check-levels`, and is no longer in the single-file build). `community.ts`: `trySubmit()` returns the Submission, 'retry' (network/5xx) or 'rejected' (4xx); `flushPending` drops rejected runs so they cannot block the queue, and `loadCommunity()` flushes pending runs before fetching a board.
- v0.3c: server PHP files must stay PHP 7.0 compatible (the cPanel host is older than 7.4 and choked on `fn() =>`): no arrow functions, `mixed`, nullable/void types, `??=`, spread, `match`, str_contains; cookie options arrays are guarded by `PHP_VERSION_ID >= 70300`. `npm run check-php-compat` enforces it. Ask the host's PHP version in cPanel (MultiPHP Manager) if in doubt.
- v0.3b: top bar = level dropdown (`#btn-campaign` + `#level-menu`, built by `renderMenu()` in main.ts) + `#btn-sandbox`; no home screen (0.3a's Home/Campaign screens removed). Boot opens the first unsolved level. Stars = how many of the 3 community boards (`community[levelId][category][0]`) belong to the current player; `loadAllCommunity()` fetches all 18 boards when the dropdown opens. `ui.setLevels` only writes the label and the Sandbox highlight.
- v0.3: Sandbox builds. `src/game/builds.ts` (pure: 10 slots per player in `modern-tim:builds:<name>`, rename/replace/delete, share client for `share.php`, `?s=CODE` helpers) + UI in main.ts (`#builds` and `#shared` dialogs, `importParts()` is the single strict loader for saved/shared parts, `exportParts()` the saver). `builds.ts` is in the `order` list of `scripts/build-single.mjs`. Server: `../share.php` (tim-data/shares/<code>.json). Opening `?s=CODE` asks first, then loads as an unsaved copy (Undo restores the old board). Checks: `npm run check-builds`, `npm run check-share`. The cron line must copy share.php too.
- v0.2o: attributes are locked outside the Sandbox (`canTinker()` in main.ts hides the Tinker lab card and the spring Strength buttons; `setProp`/`setPower` refuse). `Level.presets` fixes attributes for parts handed out in a level (applied by `withPreset()` when a part or rope is placed and in `solutionToParts`). `selftest.ts` fails a level whose solution sets attributes or exceeds its inventory. Sky high was re-solved with the default 170 px plank. Admin: new "High scores" page (`admin.php?view=scores`); `scores.php` appends a line to `tim-data/records.log` only when a run BREAKS a record (strictly better than the old number one; ties and first scores are not logged). `npm run check-records` tests this with PHP's built-in server (skips if php is missing).
- v0.2n: nine new levels (see Levels). All checked on the real Matter engine (`check-levels` and the in-game Test all levels dialog both pass). Rough robustness to placing parts a few pixels off (random nudges of 4 px / 2 degrees still solve): Over the Top 93%, Domino Bridge 100%, Chain reaction 90%, Double dominoes 100%, Heavy lifting 100%, Force or distance 100%, Crane 100%, Sky high about 50% (hardest). Long reach relies on gear snapping. Crane uses guide walls so the load crate rises straight. The level chip strip scrolls to the current level.
- v0.2j: levels 7 "Spin it" (`spin`) and 8 "Pulleys" (`pulleys`), Big machine is 9. Level parts support `key`, `link`, `props`. FLYWHEEL_LEVERAGE 95 works across about 70 to 120 (tested); keep `check-levels` green when touching it. Big machine and Spin it are sensitive to exact positions.

## Testing with real Matter (no npm needed)
`git clone --depth 1 --branch 0.20.0 https://github.com/liabru/matter-js` then copy `build/matter.js` to `modern-tim/node_modules/matter-js/index.js` with a `package.json` (`main: index.js`). Then `npm run check-levels`, `check-belts`, `check-space` (footprints vs bodies), `check-ropes` all run for real. node_modules is git-ignored. v0.2i: all pass.

## Current features (v0.2h)
- v0.2h: pulley `lift`/`liftSpeed`/`travel` props (world.ts `lifts`, `stepLifts()` runs before `stepRopes()`, rope anchors follow the pulley body); `PALETTE_GROUPS` in parts.ts + grouped palette/search in ui.ts (7+ parts); `src/game/selftest.ts` (used by check-levels and the Test all levels dialog); `Level.hints` + ghost of `solution`; `sound.ts` (WebAudio, `modern-tim:muted`), `confetti.ts`, `Simulation.onImpact`; phone CSS at the end of styles.css. Tracker event `hint` added (admin.php EVENTS). Still to do: pulley and paddle-gear levels (need real-physics verification).

## Earlier (v0.2g)
- v0.2g: `../admin.php` (tracking API `?api=track` + dashboard) and `src/game/tracker.ts` (device id in localStorage `modern-tim:device` + cookie `tim_device`, events visit/name/level/play/solve). Data in `tim-data/`. Password is a bcrypt hash in `ADMIN_HASH`. Tested locally with `php -S`; not tested on the real host.

## Earlier (v0.2f)
- v0.2f: free gear trains (`GearTrain.free`, `Flywheel` in world.ts pools angular velocity, drag 0.004) so a ball on the paddle gear drives meshed or strung gears; Select/Pan mode with marquee and group drag in main.ts (`multi`, `groupDrag`, `groupFits`); pulley system: crate, pulley (static circle r24, `PULLEY_RADIUS`), rope (`link {a,via,b}`, `strands` prop; maths in `src/game/rope.ts`, applied by `stepRopes()` in world.ts). Unverified against real Matter: flywheel and rope physics. Run `npm run check-levels`, `check-ropes`, `check-belts`, `check-space`.
- Edit mode / play mode, Start/Stop/Reset/Undo, keyboard shortcuts (see README).
- Parts: ball, bowling ball, ramp, wall, conveyor (flip), spring (strength 1-3), domino, seesaw
  (catapult lips), paddle wheel, motor gear, small/big gear, paddle gear, basket, mouse.
- Gears mesh by distance (4 px radius per tooth), snap into place, show direction arrows in edit mode.
- Levels: 1 Ramps, 2 Conveyors, 3 Springs, 4 Levers, 5 Dominoes, 6 Gears, 7 Spin it, 8 Pulleys, 9 Big machine, then the v0.2n set 10 Over the Top (`overtop`), 11 Domino Bridge (`bridge`), 12 Chain reaction (`chain`), 13 Double dominoes (`double`), 14 Long reach (`reach`), 15 Heavy lifting (`tackle`), 16 Force or distance (`tradeoff`), 17 Crane (`crane`), 18 Sky high (`skyhigh`), plus Sandbox. New level ids are in the `LEVELS` whitelist of `scores.php`.
  Every level has science-corner text, a "try this" prompt and a "you learned" line.
- Pick up / move: generous hit-testing, drag from tray, drag placed parts, touch support.
- Floating part toolbar sits ~38 px above the selected part with a dotted stalk.
- Zoom up to 300%: mouse wheel / trackpad pinch / two-finger pinch / + − 0 keys / zoom buttons.
  Drag the background to pan. Shift+wheel rotates.
- Player name gate on first visit (stored as `modern-tim:player`); name chip in the top bar changes player.
- High scores per level (`modern-tim:scores`): shortest path, fastest solve, most spare tools (longest/slowest removed in 0.2m; old saved keys are ignored); version badge from `src/game/version.ts`; top 5 each,
  one row per name, local to the browser. Logic in `src/game/profile.ts`; `Simulation` only measures the
  winning ball's path (`SolveInfo`), it does not change physics. Sandbox has no scores.
- Community scores: `../scores.php` (repo root) + `src/game/community.ts`. The Cron/.cpanel.yml copy step only copied
  index.html, so scores.php had to be added to it by hand (user action).
- Strings (`type: 'string'`, `link: {a,b}` gear ids, `anchored`): `syncStrings()` in main.ts recomputes their line each rebuild; the body is an invisible sensor strip used only for clicking. `computeGearTrain` treats them as same-direction links (F = crossed, opposite), factor 1/pulley.
- Tinker lab: `PROP_SPECS` in `src/game/props.ts`; factories in parts.ts read `propValue(type, props, key)`; conveyor speed in world.ts, motor speed in mechanics.ts. Defaults must stay equal to the old constants. NOT physics-verified in the sandbox: run `npm run check-levels`.
- Solid space (`src/game/space.ts`): footprints mirror the Matter bodies in parts.ts (keep them in step when sizes
  change; `npm run check-space` compares them when Matter is installed). Placement, drag, rotate and arrow keys go
  through `positionPart` in main.ts, which nudges to the nearest free grid spot. Level 7's solution was re-laid
  (two belts end to end), so its physics must be re-checked.
- Ball paths (dotted line of the last run), solved-level progress and sandbox build saved in localStorage.

## Verified
Every level's recorded solution solves and no level solves on an empty board
(`npm run check-levels`, also checked in headless Chromium). Mouse, touch, zoom and pan were tested
with Playwright.

## Caveats
- v0.2a (scores/name) was written in an environment with no npm access: `npm run check-scores` (12 checks) passed and
  the UI was tested in headless Chromium with a stand-in physics engine, but `npm run check-levels` and a real
  `npm run build` type-check were NOT run. Run both first.
- npm couldn't be installed in the build environment, so TypeScript was checked against a stand-in for
  `@types/matter-js`. `npm run build` may flag a few small type errors on a real install.
- Physics tuning (spring speeds, domino friction/density, conveyor force) is in `src/game/parts.ts`;
  level layouts depend on it, so re-run `npm run check-levels` after any change.

## How to run
- `npm install && npm run dev`, or
- `node scripts/build-single.mjs` to make one self-contained HTML file (Node 22.13+), or
- open `modern-tim.html` (the single-file build) directly in a browser.

## Ideas not done yet
Ropes and pulleys, balloons (buoyancy), magnets, sound effects, a level editor with sharing,
a "predict then test" mode.
