# Changelog

## Modern TIM 0.4l

- **Current community boards now show everyone tied for number one in bold**, each marked "1.", so the bold entries per player match the stars on the Players page. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4k

- **Level list marks now follow the boards**: the three marks always stand for Shortest path, Fastest solve and Most spare tools, in that order. A gold star means you hold (or tie) number one on that board, a grey dot means not yet, so a player who only holds the fastest record sees dot, star, dot. Hover a mark to see which board it is.
- **Stars can only come from boards fetched from the server when the list is opened.** Boards remembered from earlier in the visit are no longer used for stars, so a record that was beaten (or a level that was scrubbed) cannot leave a star behind. Offline, the list shows no marks.

## Modern TIM 0.4j

- **Dashboard levels now carry their number**, in the same order as the game's level list (for example "1. Ramps"): in the Records broken table, the Level filter and the Current community boards. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4i

- **The High scores page has a Player filter** next to Level, Board and Now. It lists every name that has a record or a place on a board, narrows the Records broken table to that player, and in Current community boards shows only that player's entries (and only the levels where they have one). Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4h

- **Levels now remember the version they were last changed in, and a change scrubs that level's high scores.** Every level has a version in `modern-tim/src/game/level-revs.ts` (and `scores.php`). When it changes, `scores.php` clears the community boards for that level the next time anyone asks, and each player's game downloads the new versions on load and clears its own copy of that level's scores (and any runs still waiting to be sent), with a short message. A game that still has the old level cannot post scores to the new board. The dashboard's community boards table shows each level's version.
- **Changes can no longer slip through unnoticed**: `npm run level-revs` fingerprints every level and fails if one changed without a bump; `npm run level-revs -- bump <id>` (or `bump all` after a physics change) records the change. This release only starts the tracking (all levels at 0.4g), so no scores are cleared by it.
- **Level list stars are easier to see**: boards you have not won yet show as small grey dots, and a dot becomes a gold star once you hold (or tie) number one on that board.
- Stars still come only from the live community boards: you hold a star only while you are number one or tied on that board.

## Modern TIM 0.4g

- **The Now filter now matches the column exactly**: #1, Tied #1 or Beaten, with no combined option. #1 shows only players who are alone in first place; Tied #1 shows shared first places. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4f

- **The Records broken table can now be filtered by the Now column**: Any standing, Number one now (or tied), Tied for number one, or Beaten since. It works together with the Level and Board filters. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4e

- **The Records broken table has a new Now column** showing whether the player is still number one (**#1**), tied for number one (**Tied #1**) or has been passed (Beaten) on the community board today. It is worked out from the current boards each time the page loads. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4d

- **Dates on the admin dashboard now include the year and are written year-month-day** (for example 2026-10-30 06:12) on every page: Players, Records broken, the community boards and the Log. Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4c

- **The admin dashboard shows its version number** under the clock ("Dashboard v0.4c"). It is kept equal to the game version, and a new check (`npm run check-versions`) fails if admin.php, the game, the README or the CHANGELOG disagree.
- **Every entry on the community boards now shows the date and time it was logged**, next to its version, in the "Current community boards" table (the "Records broken" table already had a When column).
- Server file only: copy `admin.php` (the cron job does).

## Modern TIM 0.4b

- **The admin Players page now has a Stars column.** A star is one community board (a level times Shortest path, Fastest solve or Most spare tools) where the player holds or ties number one, the same rule as the stars in the game. Stars are matched by name, adding up every name the device has used, and shown as ★ N (hover for the maximum). Server file only: copy `admin.php` (the cron job does); no game change.

## Modern TIM 0.4a

- **The admin High scores page now shows the game version and a screenshot for each broken record.** The "Records broken" table has the columns *Score*, *Version* and *Screenshot* (a View link to the picture). The current community boards also show the version next to each score.
- **Screenshots are only kept when a record is broken** (strictly better than the old number one): not for ties and not for the first score on a board. The game sends a small picture of the board only when a run could break a record, and the server checks again before saving it. Pictures are kept in `tim-data/shots` (closed to the web, newest 150 kept) and only shown to a signed-in admin.
- **Server files changed:** copy `scores.php` and `admin.php` (the cron job does). Records broken before this update show - for version and screenshot.

## Modern TIM 0.4 (major release)

- **Level 20 is now a ball maze.** The mouse is replaced by a ball: *Cheese maze* became *Spring maze*, with the same walls and basket and a new solution. It now gives you four planks and a spring, so you can finish with a spare plank. Its boards were reset (new id `maze`).
- Since 0.3k the pulley and crane levels (8, 15, 16, 17) were rebuilt, there is one general tip per level, the board controls moved under the board, and spare tools are possible on every level.
- **Server files changed:** copy `scores.php` and `admin.php` (the cron job does). Until then the old `scores.php` rejects scores for level 20.

## Modern TIM 0.3n

- **One tip per level, and never the answer.** The Hint button now shows a single general tip (the same one every time you press it). The second, more detailed tip and the orange ghost outline of the solution are gone. All 21 tips were rewritten to point at the idea without naming the parts or positions. Game only (no server files).

## Modern TIM 0.3m

- **Spare tools are now possible on every level.** *Energy transfer* (level 21) can be solved with three planks, so the fourth is a spare (the recorded solution and hint now say so). *Crane* (level 17) needed all of its parts, so it now comes with one extra plank; its boards were reset (new id `crane3`).
- **Server files changed:** copy `scores.php` and `admin.php` (the cron job does).

## Modern TIM 0.3l

- **Select / Pan and the zoom buttons moved out of the way.** They now sit together in one row just under the board, at the right, instead of floating over the bottom corners where they covered parts. The board is a little shorter on wide screens to make room. Game only (no server files).

## Modern TIM 0.3k

- **Levels 8, 15, 16 and 17 rebuilt as multi-part machines.** A single lift no longer solves them. In *Pulleys*, *Heavy lifting* and *Force or distance* the heavy effort crate is now parked on a ledge, and you must free it with a bowling ball: ramps, a spring and (in Heavy lifting) a conveyor send the ball onto the ledge, then you rig the pulley and rope. In *Crane* the motor pulley lifts a crate with a ball on top; where you put the pulley decides where the crate swings and where the ball lands.
- Old scores for these four levels are scrapped: they got new level ids (`pulleys2`, `tackle2`, `tradeoff2`, `crane2`), so their boards start empty, and players see them as unsolved again. Other levels are unchanged.
- **Server files changed:** copy `scores.php` and `admin.php` (the cron job does). Old entries for the four retired ids stay in `scores-data.json` but are ignored.
- All four were solved on the real physics engine and in the browser; each is robust to small nudges and none solves with just the pulley and rope.

## Modern TIM 0.3j

- **Three new, very hard levels (19 to 21).** *Spring slalom* (weave under, over and under three gates with a strong spring), *Cheese maze* (carry the mouse past two walls to the cheese; only the mouse counts) and *Energy transfer* (use ramps so the heavy bowling ball knocks the small ball over a tall wall). Each was solved on the real physics engine, with no attributes, within its inventory and with no overlapping parts; none solves with an empty board.
- Spring power is preset by the level (the attribute lock still applies).
- **Server files changed:** copy `scores.php` and `admin.php` (the cron job does). The old `scores.php` would reject the new level ids. Stars and boards for the three levels appear once it is updated.
- The mouse's path is now measured, so Cheese maze can post to the Shortest path board.
- The level dropdown now lists 21 levels.

## Modern TIM 0.3i

- **Touch screens: holding a finger on a part no longer deletes it.** A long press on a touch screen fires the browser's right-click event, which the game used to treat as "remove this part". Touch and pen presses are now ignored for that, so a part is removed on a touch screen only with the **✕** button (or Delete for a selected group). Mouse users are unchanged: right-click still removes a part (or drops the tool in your hand), and Delete/Backspace still work. A touch laptop switches automatically depending on whether you last used the mouse or a finger.

## Modern TIM 0.3h

- **Tying a community record now earns the star.** A player gets a star for a board when their score equals the community best, not only when they beat it. The player who reached the score first stays at the top of the board (ties are ordered by who got there first), so the name shown as #1 does not change.
- After a run that ties the record, the Solved card says **"Tied for #1 in the community!"**.
- The level dropdown legend now reads "you hold or tie the community best".
- Only the game changed (no server files). New check in `check-scores` for ties and name matching.

## Modern TIM 0.3g

- **Admin sign-in is now self-diagnosing.** After a correct password you are sent to a one-off address (`admin.php?go=…&view=…`) that no page cache can answer with an old copy, and you land on the page you asked for (for example High scores). If the server still loses the session, the page now says so in plain words instead of silently showing the login again.
- The login page shows its **build number** (so you can see whether the server has the newest `admin.php`) and a **connection check** link (`admin.php?diag=1`). It reports PHP version, whether sessions start, whether the session folder is writable and whether your browser sent the cookie. Nothing private is shown.
- `check-records` covers the redirect, the lost-session message and the connection check.

## Modern TIM 0.3f

- **Fix: the admin dashboard kept asking for the password.** The host's page cache (the same one that delayed the community scores) was keeping a copy of the admin pages and serving the login page again. `admin.php` now sends the full no-cache header set (including LiteSpeed and CDN ones) on every response, the login page and the tracking API included. The session cookie is also simpler and more compatible: SameSite=Lax (was Strict), and no path trick on old PHP.
- **Dashboard: Refresh button and clock.** A **Refresh** button reloads the current page with the newest data (filters kept). The top right shows a live clock in the viewer's own local time and "Page built HH:MM:SS" in Vancouver time. A small script allowed by a one-time nonce drives the clock; everything else on the page stays script-free.
- `check-records` now clicks through all four dashboard pages while signed in and checks the headers, the Refresh button and the clock.
- Copy the updated `admin.php` to the server (the cron line does it).

## Modern TIM 0.3e

- **New community scores show up straight away.** A new record could take minutes to appear because something between the server and the browser kept an old copy of the board. `scores.php` and `share.php` now send the full set of no-cache headers (including the LiteSpeed, Cloudflare and Varnish ones), and the game asks for fresh data every time (`cache: no-store` plus a unique number on each request). The boards also refresh when you come back to the game tab. Copy the updated `scores.php` and `share.php` to the server (the cron line does it).

## Modern TIM 0.3d

- **Removed the "Test all levels" button** (and its dialog) from the game. The same check still runs from the command line: `npm run check-levels`.
- **The Sandbox button always shows its name** ("🛠️ Sandbox"), also on narrow phone screens, where it used to shrink to an icon.
- **Community score delivery is more robust.** A run that cannot be sent (server down or erroring) is kept and retried on the next page load and each time a level is opened. A run the server refuses for good (for example an unknown level from an old `scores.php`) is now dropped instead of blocking every run queued behind it. New check in `check-community` covers it.
- Checked end to end with a real solve against `scores.php`: the run lands on the community board. If the server fails at that moment, the run waits and arrives after the next visit once the server works again.

## Modern TIM 0.3c

- **Fix: the server files now run on old PHP.** The host's error log showed `syntax error, unexpected '=>'` in `scores.php` (line 64) and `admin.php` (line 259): the host runs PHP older than 7.4, which cannot read `fn() =>` arrow functions. That broke the community scores, the stars and the admin dashboard. `scores.php`, `admin.php` and `share.php` were rewritten with plain PHP 7.0 syntax (no arrow functions, no `mixed`, nullable or `void` types), and the cookie code falls back to the old call style below PHP 7.3.
- New guard: `npm run check-php-compat` fails if any of the three files gets newer-than-7.0 syntax again.
- The game itself is unchanged.

## Modern TIM 0.3b

- **No home screen any more.** The game opens straight into the campaign, on your first unsolved level. The top bar has a **level dropdown** (all 18 levels with a green tick for solved ones and up to 3 stars each) and a **🛠️ Sandbox** button next to it. The Sandbox button lights up while you are in the Sandbox; pick any level from the dropdown to go back.
- Stars: one for each community board (Shortest path, Fastest solve, Most spare tools) where you are number one. They load from the score server when the dropdown opens; if it cannot be reached the dropdown says so.
- The 0.3a Home and Campaign screens were removed.

## Modern TIM 0.3a

- **Home screen.** The game now opens on a home screen with two buttons: **Campaign** and **Sandbox**. The 🏠 button in the top bar comes back to it.
- **Campaign screen** replaces the long level strip. All 18 levels are shown as cards: a green tick for solved levels, the current level outlined, and **three stars per level** (one each for Shortest path, Fastest solve and Most spare tools) for every community board where the player holds number one. Stars are loaded from the score server; offline, the screen says so. The top bar now shows only the current level ("Level 3 · Springs"); tapping it opens the Campaign screen.
- Esc on the Campaign screen goes back to Home. Opening a shared build link goes straight to the Sandbox.

## Modern TIM 0.3

- **Sandbox builds.** In the Sandbox a new **📁 My builds** button opens a list of up to 10 saved builds per player. Save the board (with an optional name), **Load** a build back, **Replace with current**, **Rename** (Enter saves, Esc cancels) or **Delete**. Loading puts your previous board on the Undo stack. Builds are kept in this browser, separately for each player name, and are not synced to other devices.
- **Share links.** **Share** on a saved build (or 🔗 Share the board) makes a short link like `index.html?s=Ab3xYz9K` with a Copy button. When someone opens a link the game asks "Ana shared a build called ...: open it?" and, if they say yes, loads it into their Sandbox as an unsaved copy that Undo can take back. They can then save it to one of their 10 slots. Missing or wrong links show a friendly message.
- New server file `share.php` (copy it beside `index.html`). It rebuilds every part from known part types and numbers, so nothing a player sends is stored as is. Limits: 64 KB, 300 parts, 20 new links per hour per visitor, 20000 links in all. Data lives in `tim-data/shares/` (closed to the web).
- Loading saved or shared parts is stricter now: only known part types, numbers kept in range, at most 300 parts, broken strings dropped.
- New checks: `npm run check-builds` (slots, rename, damaged storage, share client) and `npm run check-share` (needs php).
- Deploy: the cron line must also copy `share.php` (see README).

## Modern TIM 0.2o

- **Attributes are locked outside the Sandbox.** In the 18 puzzle levels there is no Tinker lab card and no spring Strength buttons. Players use basic tools only. Levels that need a strong spring, a heavy crate, a multi-strand rope or a motor pulley now hand those out already set, and the part card says so ("In this level: 15 kg, 4 strands"). Rotate and flip still work. The Sandbox keeps every slider.
- All 18 levels were re-tested on the real physics with the attribute lock: every solution uses only basic tools and the level's own inventory, and no empty board solves itself. `check-levels` and the in-game "Test all levels" now fail a level whose solution sets attributes. Sky high was re-solved with the standard plank length. Level hints and science text no longer mention sliders.
- **Admin dashboard: new "High scores" page.** It lists every time a community record was broken (new record, who it beat, by how much), with filters by level and board, plus the current top 5 of every board. A record counts only when it is strictly better than the old number one: ties and the first score on an empty board are not logged.
- `scores.php` writes the record log (`tim-data/records.log`). Copy both `scores.php` and `admin.php` to the server.
- New check: `npm run check-records` (needs php).

## Modern TIM 0.2n

- **Nine new, harder levels** (10 to 18). Each one was checked on the real physics: its solution solves, and the empty board does not.
  - 10 **Over the Top**: a spring and a plank to clear a tall wall and a low ceiling.
  - 11 **Domino Bridge**: lay a plank across a gap, then space nine dominoes so the chain reaches the far ball.
  - 12 **Chain reaction**: three dominoes carry the push to a heavy ball, which lands on a seesaw and flicks the little ball into the basket.
  - 13 **Double dominoes**: two rows to build with only seven dominoes.
  - 14 **Long reach**: the motor and paddle are too far apart for gears alone. Use big gears and a crossed string.
  - 15 **Heavy lifting**: a block and tackle with four rope strands lifts a crate nearly three times as heavy as yours.
  - 16 **Force or distance**: two strands is the only choice that works. More strands need more rope than the room allows.
  - 17 **Crane**: turn on the pulley motor, lengthen its rail, and hang an equal counterweight.
  - 18 **Sky high**: one spring and two planks to reach a platform higher than the wall.
- The level strip scrolls so the level you are on is always in view.
- New level ids added to the `LEVELS` list in `scores.php`. Copy the updated `scores.php` to the server so scores for the new levels are accepted.

## Modern TIM 0.2m

- High scores: removed the Longest path and Slowest solve boards. Each level now has Shortest path, Fastest solve and Most spare tools. Old saved scores that contain the removed boards still load (the extra boards are ignored). Copy the updated `scores.php` to the server.

## Modern TIM 0.2l
- **Zoom out**: the − button and key now go 80%, 60%, 50%, 40% (wheel and pinch go smoothly down to 40%). Zoomed out, the whole playfield sits centred on a grey margin. The + button steps back up through the same stops. Parts, selection and placing work at every zoom.

## Modern TIM 0.2k
- **Portrait phone layout** reworked: a compact header (logo, name and version on one line, player chip beside it), one row of equal buttons (sound, Undo, Reset, Start), scrolling level chips, a one-line "turn your phone sideways" tip you can dismiss, the Select/Pan and zoom buttons moved to a row under the board so they never cover parts, and the Parts tray as one sideways-scrolling strip. Landscape is unchanged.

## Modern TIM 0.2j
- **Two new levels** (verified on the real physics engine): **7 Spin it** (no motor: a heavy ball hits the left paddle gear and the spin must travel through a gear chain to the right paddle, which bats the ball into the basket; count the gears, an even number keeps the direction) and **8 Pulleys** (lift the crate up into an upside-down basket with a rope, a pulley and a heavier counterweight; try equal weights first, then the Tinker lab weight slider). Big machine is now level 9.
- Free gear trains: a hit now gets a "light gear" boost (`FLYWHEEL_LEVERAGE` in world.ts) so a falling ball can really start a train. The old pooling treated gears as heavy solid discs, so almost nothing happened. Also fixed a feedback loop where the train's own turning was read back as a hit.
- Level data can now name parts (`key`) and tie ropes and strings to them (`link`), and set Tinker-lab numbers (`props`). A level can use `goalTargets: ['crate']`; crates now record a path like balls do.
- `scores.php` knows the new level ids (`spin`, `pulleys`): copy the new file to the server or the community boards will reject them.

## Modern TIM 0.2i
- Fixed level 7 "Big machine": its recorded solution failed on the real physics engine (found by the new Test all levels button). The two belts are re-laid end to end on the long wall and verified: all 7 levels now pass `check-levels` (solution solves, empty board does not). Note the level is sensitive: the spring must stay at x = 630 and the belts close to where they are.
- Verified on real Matter 0.20 (not just maths): a rope over a pulley lifts the lighter weight, balanced weights stay put, a motor-lifted pulley raises hanging crates by its rail length, and a ball hitting the paddle gear spins it and a meshed gear the opposite way.

## Modern TIM 0.2h
- **Pulley motor**: a Pulley now has a "Pulley motor" slider in the Tinker lab (Off / Lift up / Lower down), plus lift speed and rail length. When you press Start it slides along a dotted blue rail (arrow shows the way) and a rope over it drags the weights along. Off by default, so old builds behave the same.
- **Tool categories** in the sandbox: Balls, Ramps and walls, Moving things, Dominoes and critters, Gears and strings, Pulleys and weights, Goals. Click a heading to fold it (remembered), or use the new "Find a part" box. Levels with few parts keep the flat list.
- **Test all levels** button (under the parts): runs every recorded solution and checks that no level solves itself, on a separate simulation, and lists the results. `npm run check-levels` now shares the same code (`src/game/selftest.ts`).
- **Hints**: 💡 Hint button (or H). Hint 1 nudges, hint 2 names the parts, hint 3 draws a faint orange ghost of one solution on the board. Sandbox has none. Hint use is logged for the admin dashboard.
- **Sound and confetti**: small synthesised sounds (place, start, bounces and thuds, success) and a confetti burst on solving. The 🔊 button mutes (remembered); reduced-motion users get no confetti.
- **Phones and tablets**: bigger touch targets, one-row header, scrolling level chips, wrapped goal bar, safe-area padding.
- Not done yet: new levels for pulleys and the spinning paddle gear. I could not check their physics here, so use "Test all levels" once they exist.
- Not verified here: the pulley motor in real Matter, and the sounds on a real device. Please run `npm run check-levels` and try a lifting pulley in the sandbox.

## Modern TIM 0.2g
- New root file `admin.php`: the player tracking API plus a password-protected admin dashboard. Pages: **Players** (name, device id, browser/OS, visits, plays, solves, online dot), **Levels** (opened / Start pressed / solved, fastest solve) and **Log** (filter by name, level, event or device). Auto-refresh and JSON export included.
- Every browser now gets a **device id** from the server: random and signed, so it cannot be edited or invented (a changed id is replaced). It is kept in localStorage, a cookie and an HttpOnly cookie. A player can still lose it by clearing site data or switching browser; no website can prevent that.
- Logged events: visit, name chosen / changed, level opened, Start pressed, puzzle solved (with seconds), admin sign-in and failed sign-ins. IP addresses are not stored, only a short salted hash. Sign-in locks for 15 minutes after 5 wrong passwords.
- Data lives in `tim-data/` next to `admin.php` (created automatically, closed to the web by `.htaccess`, git-ignored). The log rotates at about 1.5 MB.
- Deploy: `admin.php` (and `scores.php`) must be copied next to `index.html`. The password hash is `ADMIN_HASH` at the top of `admin.php`.

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
