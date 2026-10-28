# Modern TIM: handoff notes (2026-10-28)

Where the project stands, so a new chat can pick up exactly here.

## What it is
A browser physics puzzle game in the spirit of *The Incredible Machine*, aimed at STEM kids (about 8 to 13).
Vite + TypeScript + Matter.js 0.20, plain HTML/CSS, custom canvas rendering. Each level teaches one idea.

## Current features (v0.2c)
- Edit mode / play mode, Start/Stop/Reset/Undo, keyboard shortcuts (see README).
- Parts: ball, bowling ball, ramp, wall, conveyor (flip), spring (strength 1-3), domino, seesaw
  (catapult lips), paddle wheel, motor gear, small/big gear, paddle gear, basket, mouse.
- Gears mesh by distance (4 px radius per tooth), snap into place, show direction arrows in edit mode.
- Levels: 1 Ramps, 2 Conveyors, 3 Springs, 4 Levers, 5 Dominoes, 6 Gears, 7 Big machine, plus Sandbox.
  Every level has science-corner text, a "try this" prompt and a "you learned" line.
- Pick up / move: generous hit-testing, drag from tray, drag placed parts, touch support.
- Floating part toolbar sits ~38 px above the selected part with a dotted stalk.
- Zoom up to 300%: mouse wheel / trackpad pinch / two-finger pinch / + − 0 keys / zoom buttons.
  Drag the background to pan. Shift+wheel rotates.
- Player name gate on first visit (stored as `modern-tim:player`); name chip in the top bar changes player.
- High scores per level (`modern-tim:scores`): shortest path, longest path, fastest solve, slowest solve, most spare tools; version badge from `src/game/version.ts`; top 5 each,
  one row per name, local to the browser. Logic in `src/game/profile.ts`; `Simulation` only measures the
  winning ball's path (`SolveInfo`), it does not change physics. Sandbox has no scores.
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
