# Changelog

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
