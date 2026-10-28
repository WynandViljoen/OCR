# Modern TIM: Machine Lab

A browser puzzle game in the spirit of *The Incredible Machine*, built to teach
kids (roughly ages 8 to 13) how simple machines work. Each level is about one
science idea: ramps, forces, springs, levers, chain reactions, gears. A last
level puts them all together, and a sandbox lets kids invent their own machines.

Built with **Vite + TypeScript + Matter.js** and plain HTML/CSS. No game engine.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
```

Other scripts:

```bash
npm run build          # type-check + production build into dist/
npm run preview        # serve the production build
npm run check-levels   # headless: every level's solution works, and no level solves itself
npm run build:single   # one self-contained HTML file in dist-single/ (Node 22.13+, no npm install needed)
```

## How to play

1. Pick a level from the numbered chips at the top.
2. **Build**: drag a part from the Parts tray onto the board, or tap a part and then tap the board.
3. **Move** any part you placed by dragging it. Puzzle parts (the grey ones that came with the level) stay put.
4. Click a part to select it. A small toolbar appears above it (well clear of the part, so you can still
   grab and drag it) with rotate, flip, spring strength and delete.
5. Zoom in with the mouse wheel, a pinch, or the `+` button for fiddly placements. Drag the background to look around.
6. Press **Start** (or `Space`). Press **Stop** to go back and adjust. Your parts stay where they were.
7. A dotted line shows where the ball went last time, so you can see what to fix.
8. Get a ball into the green zone of the basket to solve the level.

### Solid space
Parts cannot overlap. Drop, drag, rotate or nudge one into another and it slides to the nearest free grid spot; with no room within reach it stays put. The rules live in `src/game/space.ts` (pure geometry), checked by `npm run check-space`.

### Community scores
The High scores card has two tabs: **Community** (shared by everyone, kept by `scores.php` on the server) and **My best** (this player, stored in this browser).
Finished runs are posted to `scores.php`; if the server can't be reached they wait in localStorage (`modern-tim:pending`) and are sent next visit.
Names are not passwords: anyone can type any name, and the server only rejects impossible numbers. `npm run check-community` tests the client with a fake server.

### Name and high scores
- The first time you open the game it asks for your name. It is stored in this browser; click the name chip in the top bar to change player.
- Every level has five boards (top 5 each, one row per name): **Shortest path** and **Longest path** (how far the winning ball travelled, in metres, 100 px = 1 m) **Fastest solve** and **Slowest solve** (seconds from Start to goal) and **Most spare tools** (inventory parts left unused; 0 spare is not scored).
- Scores live in localStorage (`modern-tim:player`, `modern-tim:scores`), so they are per browser and device. A shared online board would need a small server script.

### Controls

| Input | Action |
| --- | --- |
| Drag from the tray | Place a part |
| Tap tray, then tap board | Place a part (hold `Shift` to place several) |
| Drag a placed part | Move it (touch works too) |
| `R` / `Shift+R` / `Shift`+wheel | Rotate the selected part, or the part you're placing |
| Mouse wheel, trackpad pinch, two-finger pinch | Zoom in and out around the pointer (up to 300%) |
| `+` / `−` / `0`, or the zoom buttons | Zoom in, zoom out, show the whole board |
| Drag the background | Pan around while zoomed (works while the machine runs, too) |
| `F` | Flip direction (conveyor, motor gear) |
| `1` `2` `3` | Spring strength |
| Arrow keys | Nudge the selected part |
| `Delete` or right-click | Remove a part |
| `Ctrl/Cmd+Z` | Undo |
| `Space` | Start / stop |
| `Esc` | Put down the part in your hand |

### Parts

| Part | What it does | Science |
| --- | --- | --- |
| Ball | Light and bouncy | Gravity |
| Bowling ball | 10x heavier | Mass and momentum |
| Ramp | Static tilted plank | Inclined plane |
| Wall | Static block | |
| Conveyor | Pushes things along its arrows | Force, friction |
| Spring | Launches whatever lands on it; strength 1 to 3 | Elastic energy |
| Domino | Tall, tips over and knocks the next one | Chain reaction, stored energy |
| Seesaw | Lever on a fulcrum with a lip at each end | Levers |
| Paddle wheel | Spins freely when pushed | Rotation |
| Motor gear | Turns by itself | Power source |
| Small / Big gear | Driven by meshed gears, opposite direction | Gear ratios and direction |
| Paddle gear | Gear with two bats | Turning motion becomes a push |
| Basket | The goal | |
| Mouse | Just for fun | |

### Levels

| # | Level | Idea | What the player does |
| --- | --- | --- | --- |
| 1 | Ramps | Gravity and inclined planes | Angle a ramp under a falling ball |
| 2 | Conveyors | Forces and friction | Use belts to move a ball off a shelf |
| 3 | Springs | Elastic energy | Tilt and tune a spring to bounce over a wall |
| 4 | Levers | Levers and fulcrums | Drop a bowling ball on a seesaw to fling a ball |
| 5 | Dominoes | Chain reactions | Bridge a gap with a domino chain |
| 6 | Gears | Gear trains | Connect a motor to a paddle gear so it spins the right way |
| 7 | Big machine | Systems | Conveyors up a slope, then a spring over a wall |
| ★ | Sandbox | Engineering | Unlimited parts, no goal, saved in the browser |

Every level has a **Science corner** with a short explanation and a "Try this" experiment,
and a "what you learned" line on the Solved card. Solved levels get a green chip.

## Project layout

```
index.html               UI shell (top bar, tray, board, science corner)
src/main.ts              state, pointer/keyboard input, placement, rendering loop
src/styles.css           UI styles
src/game/parts.ts        part types, physics tuning, body factories (PART_DEFS)
src/game/mechanics.ts    gear-train maths (meshing, speeds, snapping), hit-testing geometry
src/game/world.ts        Simulation: Matter engine, conveyors, springs, pivots, gears, goal
src/game/draw.ts         custom canvas drawing for parts, thumbnails, arrows, paper
src/game/levels.ts       level data and science text
src/game/space.ts        solid-space rule: footprints, overlap test, nearest free spot
src/game/community.ts  talks to scores.php (fetch board, send run, retry later)
src/game/version.ts      the on-screen version number (bump each release)
src/game/profile.ts      player name and high-score rules and storage (no DOM, no Matter)
src/game/ui.ts           DOM: palette, level chips, toolbar, science corner, solved card
scripts/check-levels.ts  headless solvability check (npm run check-levels)
scripts/check-space.ts  solid-space check (npm run check-space)
scripts/check-community.ts  community client check (npm run check-community)
scripts/check-scores.ts  high-score rules check (npm run check-scores)
scripts/build-single.mjs bundle into one HTML file
```

### How it works

- **One source of truth.** The game state is a list of `PlacedPart` records. Both modes come from
  `sim.load(parts, play)`. Edit mode freezes everything; play mode releases it. Stop just rebuilds,
  so there is nothing to snapshot.
- **Picking parts up.** Hit-testing measures the distance to each part's outline (16 px with a mouse,
  26 px with a finger), so thin ramps are easy to grab. Clicking right on a placed part always picks it
  up, even while you're holding a new part from the tray.
- **Pivots** (seesaw, wheels, gears) are dynamic bodies held on their axle every step, so they rotate
  freely without drifting.
- **Gears** don't rely on teeth colliding. `computeGearTrain()` finds meshed gears (centres exactly
  `rA + rB` apart; every gear has 4 px of radius per tooth so any two can mesh), then each driven gear
  turns at `-speed × rA / rB`. Teeth still push balls. Dropped gears snap into mesh and get their teeth
  lined up. In edit mode, arrows preview which way each gear will turn.
- **Springs** set the landing body's speed along the spring's normal to a fixed launch speed
  (10 / 13 / 16 px per step), which makes bounces predictable enough to aim.
- **Sleeping is off.** Small worlds don't need it, and sleeping bodies ignore conveyor pushes.

### Adding a part

1. Add the name to `PartType` and a `PartDef` to `PART_DEFS` in `src/game/parts.ts` (and `PALETTE_ORDER`).
2. Per-step behaviour goes in `world.ts` (look for `beforeStep` / `afterStep`), keyed by body label.
3. Custom drawing goes in `draw.ts` `drawDecoration()` / `drawUnderlay()`. The palette thumbnail is
   generated from the part's own bodies automatically.

### Adding a level

Add an object to `LEVELS` in `src/game/levels.ts`: fixed parts, an `inventory`, a `solution`, and
the `science` text. Then run `npm run check-levels`. It fails if the solution doesn't work or if the
level can be solved without adding anything.

## Testing notes

The levels were tuned by running the real physics headlessly in Chromium. Each solution solves, each
empty board does not. Mouse and touch dragging were checked the same way. Physics constants live
in `parts.ts`; re-run `check-levels` after changing them.

## Ideas for later

Ropes and pulleys, balloons (buoyancy), a magnet, sound effects, a level editor with sharing,
a "predict then test" mode that asks kids to guess the outcome before pressing Start.
