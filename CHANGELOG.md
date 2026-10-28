# Changelog

## Modern TIM 0.2f
- **Paddle gear is now a real gear**: a ball (or anything) hitting its paddles spins it, and any gears meshed or strung to it turn too. A free gear train shares one spin; friction slows it down. A jammed train does not turn.
- **Select and move**: new Select / Pan switch under the board. Drag on empty space to draw a box, Shift+click adds or removes parts, Ctrl+A selects all. Drag any selected part to move the whole group; Delete, arrow keys and Esc work on the group. A group only moves if every part fits (no overlaps). Middle mouse button or Pan mode still pans.
- **Pulley system**: new Crate (weight), Pulley and Rope tools. Rope: click the weight on one side, then a pulley, then the weight on the other side. Heavier side wins. The pulley's "Rope strands" slider (1 to 4) makes a block and tackle: N strands give N times the pulling force but N times the distance. The Tinker lab shows who wins and why. Crate weight and pulley friction are sliders too.
- New `npm run check-ropes` (rope maths). Please re-run `npm run check-levels`, `check-belts` and `check-space`.
- Not verified in the build sandbox: real Matter behaviour of the spinning paddle gear and ropes. Test in a browser.

## Modern TIM 0.2e
- New **String** tool: click two gears and a string joins their centres. Both gears turn, even far apart. A straight string turns them the same way; press F to cross it and the second gear turns the opposite way. The second pulley can be made bigger or smaller (bigger = slower).
- New **Tinker lab** card: select any part and change its numbers with sliders, each with a kid-friendly sentence and the science word. Ball and bowling ball: bounciness, weight, grip. Ramp and wall: grip, bounciness. Conveyor: belt speed. Motor gear: motor speed. Spring: strength. Domino and mouse: weight, grip, bounce. Seesaw and paddle wheel: weight, axle drag. Untouched parts behave exactly as before.
- Gears show live facts (teeth, turns per second, direction, jammed).
- Level 6 "Gears" now also has one string in its inventory (an extra way to solve it; crossing the string matters).
- Please re-run `npm run check-levels` (physics reads the new numbers, defaults unchanged), plus `npm run check-belts`.

## Modern TIM 0.2d
- Community high scores shared by everyone who plays on the server, next to a personal "My best" tab. Both are on the High scores card; the Solved card shows your rank on each.
- New root file `scores.php` keeps the shared boards in `scores-data.json` (same top-5 rules). It must be copied to the web folder next to `index.html` (see README).
- If the server cannot be reached (or `scores.php` is not installed yet), the game works as before and waiting scores are sent next visit.
- Build script now supports `export async function`.

## Modern TIM 0.2c
- Solid space: parts can no longer overlap. A part dropped, dragged, rotated or nudged into another is moved to the nearest free spot; if there is no room it stays where it was and a message says so.
- Touching is fine (a ball resting on a ramp, meshed gears). The green goal zone of the basket is empty air; its walls are solid. Spinning paddles and gear teeth are not reserved while they turn.
- Removed the version badge from the bottom-right corner (the version stays in the header).
- Level 7 "Big machine": its recorded solution had two conveyors overlapping, so they now sit end to end. Please re-run `npm run check-levels`.

## Modern TIM 0.2b
- Game version now shows on screen: a badge in the bottom-right corner, and in the header (one `VERSION` constant in `modern-tim/src/game/version.ts`).
- Two new high-score boards for every puzzle: Fastest solve and Slowest solve (seconds from Start to the goal, simulated time, top 5 each).
- Scores saved by 0.2a still load. The Solved card scrolls if the screen is short.

## Modern TIM 0.2a
- First-time players are asked for their name; it is remembered in the browser. The name chip in the top bar changes player.
- High scores per level: Shortest path, Longest path (distance the winning ball travelled, in metres) and Most spare tools (unused inventory parts). Top 5 per category, one row per name.
- The Solved card shows how the run ranked. Scores are stored in each browser (localStorage), not shared between devices.
- Physics and levels are unchanged. The ball's path is only measured, never altered.

## Modern TIM 0.2
- The website is now Modern TIM, a physics puzzle game for STEM kids (replaces Snap OCR).
- Root `index.html` is the single-file build, so the server's cron copy step is unchanged.
- Full Vite + TypeScript + Matter.js source lives in `modern-tim/`.

## Snap OCR (earlier site, kept for history)

Versioning: first release is 0.01. Minor releases add letters (0.01a, 0.01b … 0.01z, then 0.01aa, 0.01ab …). A major release moves to the next number (0.02, 0.03 …) with no letter.
Update `VERSION` in `index.html` and add an entry here for every release.

## 0.01c
- Added a small blue duck next to the yellow one, facing it.

## 0.01b
- Added a small yellow duck at the bottom of the page.

## 0.01a
- Block-out tools: draw boxes over the photo before scanning. "Skip areas" paints them white so they are not read; "Keep only" reads just the boxed areas.
- Move, resize, remove boxes; undo and clear.
- Photo now opens in an editor first, and Scan text starts the reading.

## 0.01
- First release: take or choose a photo, read the text in the browser (Tesseract.js), copy or download, local history.
