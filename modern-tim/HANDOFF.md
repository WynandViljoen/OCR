# Modern TIM: handoff notes (2026-10-28)

Where the project stands, so a new chat can pick up exactly here.

## What it is
A browser physics puzzle game in the spirit of *The Incredible Machine*, aimed at STEM kids (about 8 to 13).
Vite + TypeScript + Matter.js 0.20, plain HTML/CSS, custom canvas rendering. Each level teaches one idea.

- v0.5d: Community dialog form removed (cm-form/cm-name/cm-publish gone); saveAndPublish saves to My builds first (reuses an identical build by signature) and refuses to publish if it cannot save.
- v0.5c: Build.puzzle (puzzle id, kept by loadBuilds, set by linkBuildPuzzle after Save and publish); puzzleTag(id) = #%04X hex, same format in admin.php; showPuzzleStates() fills .build-pz lines in My builds.
- v0.5b: site icons (repo root favicon.ico + manifest.webmanifest, icons/*; SVG + apple-touch PNG inlined as data URIs in modern-tim/index.html head). Cron must copy favicon.ico, manifest.webmanifest, icons/ for the non-inlined ones.
- v0.5a: pzCall returns status+text; share.php puzzle_post_api registers a shutdown handler that returns fatals as JSON. Used to debug a live-site publish failure ("That did not work").
- v0.5 (major): puzzle record has `seconds` (solution run time, sent by the client from checkPuzzle) shown on the dashboard. Next minors: 0.5a, 0.5b...
- v0.4za: Publish button (#btn-publish), sandboxPuzzleReady() turns the goal on in the Sandbox when a fixed ball+basket exist (auto-stop), #pubask save-and-publish dialog, exactly 1 ball and 1 basket (palette limit, checkPuzzle, share.php). Version after 0.4z is 0.4za (letters continue).
- v0.4z: COMMUNITY PUZZLES. Server in share.php (GET ?puzzle=list|get|mine, POST {action: submit|withdraw|complete|vote}; data tim-data/puzzles.json {next,order,puzzles{id:{device,creator,cur,draft,reason,difficulty,done,votes}}}, shots in tim-data/puzzle-shots/; admin.php shares the file and flock). Admin: view=puzzles (puzzle_action p_approve/p_reject/p_pull/p_delete/p_rate/p_up/p_down/p_top/p_bottom, `?pshot=`), play-test link `./?preview=KEY&puzzle=ID&version=cur|draft` (needs the preview key; wrong key -> 403). Client: game/puzzles.ts (API, splitBoard, checkPuzzle, puzzleToLevel; names prefixed pz* to avoid bundle collisions), Level.community, loadLevel(index, restore, custom), onCommunitySolved, Community dialog in main.ts. Rules: 5 per device (pending+live), edits wait for approval, rating shown as label, completion only, vote only after completing. Open idea: fixed part variants (Light/Heavy crate, Weak/Strong spring) for creators. Test: npm run check-puzzles; a Playwright end-to-end run was done by hand.
- v0.4y: SANDBOX -> PUZZLE MAKER, step 1. PlacedPart.fixed (sandbox only; separate from `locked`, which is the level's own); toolbar #tb-fix + L key (toggleFixed in main.ts); drawFixedMark in draw.ts (hatch + dashed outline + padlock). canTinker() now always false (no Tinker lab, no spring strength); importParts drops saved props/power. share.php passes `fixed`. NEXT (agreed with the user): tray from the creator's solution, Publish (must solve), 5 slots per browser keyed by deviceId (not name), dashboard approval queue (also for edits), separate Community puzzles area, completion only, thumbs up/down by players who finished. Level presets (strong spring, heavy crate) still work in campaign levels; community puzzles would need fixed part variants if creators need them.
- v0.4x: PUZZLE SETS. levels.ts = base (October) set; levels-nov.ts = NOV_LEVELS (same ids/names, harder); seasons.ts LEVEL_SETS/applyLevelSet (mutates the LEVELS array in place)/rememberedSet. Server decides: scores.php SEASON_SETS (month -> set; latest key <= season id wins, 'base' before), SET_REVS (per-level versions inside a set; client NOV_REVS in level-revs.ts; change one level with `npm run level-revs -- bump-nov <id>` so only it is wiped), setFor(), revsNow(); admin.php has a copy of SEASON_SETS (check-versions compares). GET ?revs=1 returns {revs, season, set}; ?preview=KEY&set=nov -> {ok} (key in tim-data/preview.key, made by admin.php preview_key()). Client main.ts: previewing (URL ?preview=&set=) = nothing saved/sent, banner #preview-bar; otherwise fetchRevs -> scrubChangedLevels -> switchToLiveSet. To add a December set: write NEXT levels, register in seasons.ts, add '2026-12' => 'dec' + SET_REVS in scores.php and SEASON_SETS in admin.php (admin preview shows it). If no set is added, the previous set keeps running (boards/stars wiped by the season roll).
- v0.4w: SEASONS (calendar month, America/Vancouver). scores.php syncSeason()/archiveSeason() under the data-file lock; archive = tim-data/seasons/YYYY-MM.json (+ seasons/shots/); `_season` key in scores-data.json; nowTs() honours env TIM_TEST_NOW (tests only). Client: fetchRevs returns {revs, season}; fetchStars returns season + previous; syncLocalBests only sends runs newer than the season start. Admin: ?season=YYYY-MM selects an archive, Season results table. (Puzzle sets: see 0.4x. Level ids and names are the same in every set, so archives need no names.)
- v0.4v: scores.php `?stars=1` (topStars, PHP 7.0-safe) feeds the game's ★ Stars tab (ui.setStars, fetchStars); first-level coach (#coach, COACH_KEY, updateCoach in main.ts).
- v0.4u: admin.php Now filter is a checkbox dropdown (`now[]`; a plain `now=top` still works), `$nows` array.
- v0.4t: admin.php board_status()/board_row_shown(): Player + Now filters apply to the community boards table as well as Records broken.
- v0.4s: precision: distance 3 decimals (pathMeters/formatValue/scores.php/admin format_score), time 2 (steps/60 is never finer than 0.0167 s).
- v0.4r: failure card has Edit only; REST_STEPS 75 (1.25 s), MIN_RUN_STEPS 60. check-failure guards the margin against the longest pause in any solution (0.9 s today).
- v0.4q: admin.php full-width layout; scores_view() builds its three tables with ob_start and prints boards, refused, records in that order.
- v0.4p: Simulation.checkFailure() (world.ts): ball(s) lost, or all free bodies + moving fixed parts still for 2 s after 3 s (gears ignored) -> failed/onFailed; main.ts freezes the loop and shows #failed card (Retry/Edit). Tune REST_* constants there; `npm run check-levels` must show every solution solving and `npm run check-failure` pass.
- v0.4o: board rows keep `shot` only on the number one (scores.php shotOf/topShots/deleteShots); beaten or scrubbed pictures are deleted; admin boards table shows a View link per number one. Public JSON strips `shot` (publicBoard).
- v0.4n: FIXED live bug (0.4h-0.4m): game/level-revs.ts was missing from the `order` list in scripts/build-single.mjs, so trySubmit threw ReferenceError and no score was ever sent. New modules MUST be added to that list; `npm run check-bundle` enforces it. Always smoke-test a real solve in the built index.html (scratchpad solve.js style) before release.
- v0.4n: community.ts syncLocalBests() runs at every start (after the level-version scrub and the pending flush) and sends local bests that earn a place on the community board.
- v0.4m: onSolved sends the score first and guards the cosmetic steps; scores.php logs refusals to tim-data/rejects.log (shown on the admin High scores page); client timeout 12 s.
- v0.4l: admin.php boards table bolds every entry tied with number one (same rule as star_counts()).
- v0.4k: level list marks are per board (shortest, fastest, spare) and use only boards fetched when the list opens (starBoards in main.ts).
- v0.4j: admin.php level_label() prefixes the level number (order of LEVEL_NAMES = game order; keep them in step when adding levels).
- v0.4i: admin.php Player filter (`player` param, lower-cased name) on the High scores page.
- v0.4h: per-level version (level-revs.ts + scores.php LEVEL_REVS); a changed version scrubs community boards (syncRevs in scores.php) and local scores (scrubChangedLevels on load). After ANY level or physics change run `npm run level-revs -- bump <id>|all` BEFORE the release version bump, or the check fails.
- v0.4g: Now filter options are exactly #1 / Tied #1 / Beaten (no combined option).
- v0.4f: admin.php Records broken has a `now` filter (top/tied/beaten) applied after standing().
- v0.4e: admin.php standing() fills the Now column of the Records broken table.
- v0.4d: admin.php fmt_time() prints Y-m-d H:i.
- v0.4c: admin.php ADMIN_BUILD must equal VERSION (check-versions); bump both every release.
- v0.4b: admin.php star_counts() adds a Stars column on the Players page (by name, ties count).
- v0.4a: scores.php stores row version 'v' and a record-breaking screenshot (tim-data/shots, served by admin.php?shot=); client sends version always, shot only when mayBreakRecord().
- v0.4: level 20 is 'maze' (ball instead of mouse; old id cheese retired, boards reset).
- v0.3n: one general `hint` string per level (no ghost of the solution).
- v0.3m: energy solution uses 3 of 4 planks; crane id is now crane3 (boards reset) with a spare plank.
- v0.3l: mode-controls + zoom-controls live in .board-controls under the board (fitBoard subtracts 52px).
- v0.3k: levels 8, 15, 16, 17 rebuilt (ids pulleys2, tackle2, tradeoff2, crane2 reset their boards); the effort crate is a fixed crate on a ledge with a key 'eff'.
- v0.3j: three very hard levels added after Sky high (slalom, cheese, energy); ids are whitelisted in scores.php and named in admin.php.
- v0.3i: canvas `contextmenu` handler ignores touch/pen (uses `PointerEvent.pointerType` or `lastPointerType` set in the pointerdown handler). Right-click delete stays for mouse; the toolbar ✕ (`#tb-delete`) is the touch way to delete.
- v0.3h: `holdsBest(board, category, name)` in profile.ts returns 'first' | 'tied' | null; stars count both. Boards order ties by earliest `at`, so the first achiever stays #1 (the 5-row board limit means a 6th tied player would not be listed and gets no star). The admin "records broken" log still ignores ties.
- v0.3g: admin.php `ADMIN_BUILD` constant (shown on the login page), `?diag=1` connection check, login redirect to `admin.php?go=<time+rand>&view=<view>`, explicit message when the session is lost (bad csrf on login, or `?go` without a session). Use these to debug the host if the login loop returns: it was either a stale cached login page or sessions not persisting.
- v0.3f: admin.php sends `no_cache_headers()` on every response (the host has an active LiteSpeed page cache that cached admin pages and made the login page reappear); session cookie SameSite=Lax; dashboard header has a Refresh link (REQUEST_URI) and a live browser-local clock (inline script allowed by a CSP nonce, `$GLOBALS['tim_nonce']`). check-records covers it.
- v0.3e: anti-cache for boards: scores.php/share.php send no-store/no-cache/LiteSpeed/CDN headers; community.ts requests use `cache: 'no-store'` and `&_=<time>`; boards refresh on tab visibility (15 s throttle).
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
