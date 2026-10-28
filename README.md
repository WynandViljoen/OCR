# Modern TIM

A browser physics puzzle game in the spirit of *The Incredible Machine*, built to teach
kids (about 8 to 13) how simple machines work. Version 0.2b: seven science levels plus a sandbox, player names and per-level high scores.

This repo replaced the earlier Snap OCR page (its history is still in git).

## What is where

| Path | What it is |
| --- | --- |
| `index.html` | The playable game as ONE self-contained file. The server's cron job copies this file to the website folder, so it must keep this name and stay in the repo root. |
| `.cpanel.yml` | cPanel deploy settings. Leave as is. |
| `modern-tim/` | The full project source (Vite + TypeScript + Matter.js): `src/`, `scripts/`, its own `README.md` and `HANDOFF.md`. `modern-tim/modern-tim.html` is the same game without the page wrapper (for pasting into viewers that add their own). |

## Updating the live page

The root `index.html` is generated from the source. After any change in `modern-tim/src/`, rebuild it:

```bash
cd modern-tim
node scripts/build-site.mjs ../index.html     # Node 22.13+; wraps the game as a full web page
```

Before publishing a physics or level change, run `npm run check-levels` inside `modern-tim/`
(every level's solution must solve, and no level may solve itself).

See `modern-tim/README.md` for how to play, the parts list and how to add parts and levels.
