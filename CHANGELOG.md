# Changelog

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
