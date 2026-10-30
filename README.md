# Modern TIM

A browser physics puzzle game in the spirit of *The Incredible Machine*, built to teach
kids (about 8 to 13) how simple machines work. Version 0.4s: twenty-one science levels plus a sandbox with 10 saved builds per player and share links, player names and per-level high scores.

This repo replaced the earlier Snap OCR page (its history is still in git).

## What is where

| Path | What it is |
| --- | --- |
| `index.html` | The playable game as ONE self-contained file. The server's cron job copies this file to the website folder, so it must keep this name and stay in the repo root. |
| `.cpanel.yml` | cPanel deploy settings. Leave as is. |
| `modern-tim/` | The full project source (Vite + TypeScript + Matter.js): `src/`, `scripts/`, its own `README.md` and `HANDOFF.md`. `modern-tim/modern-tim.html` is the same game without the page wrapper (for pasting into viewers that add their own). |

## Sharing Sandbox builds (share.php)
`share.php` stores a shared Sandbox build as a small JSON file in `tim-data/shares/` and gives back an 8-character code, so a link looks like `index.html?s=Ab3xYz9K`. It sits beside `index.html` like `scores.php`. Saved builds themselves (10 per player name) stay in the browser; only Share talks to the server.

## Community scores (scores.php)
`scores.php` is the only server code. It must sit in the same web folder as `index.html` (for example `public_html/ocr/`).
Add it to the deploy copy step, for example the cron command ends with
`... && cp index.html scores.php admin.php share.php /home/<user>/public_html/ocr/` (or upload it once in cPanel File Manager).
It creates `scores-data.json` beside itself; copying `scores.php` again never touches that data. Without it the game still works with
scores kept in each browser only.

## Updating the live page

The root `index.html` is generated from the source. After any change in `modern-tim/src/`, rebuild it:

```bash
cd modern-tim
node scripts/build-site.mjs ../index.html     # Node 22.13+; wraps the game as a full web page
```

Before publishing a physics or level change, run `npm run check-levels` inside `modern-tim/`
(every level's solution must solve, and no level may solve itself).

See `modern-tim/README.md` for how to play, the parts list and how to add parts and levels.
