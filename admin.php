<?php
/**
 * Modern TIM: player tracking API + admin dashboard (one file).
 *
 * Put this next to index.html. Data is kept in ./tim-data/ (created on first use,
 * closed to the web by .htaccess).
 *
 *   POST admin.php?api=track   called by the game (see src/game/tracker.ts)
 *   GET  admin.php             the admin dashboard (password protected)
 *   GET  admin.php?api=export  all players as JSON (admin only)
 *   GET  admin.php?view=scores the "High scores" page: every broken record + the current boards
 *
 * Records come from scores.php, which writes tim-data/records.log whenever a run breaks a
 * community record (strictly better than the old number one; ties and first scores do not count).
 *
 * Device ids: the server makes a random id and signs it (HMAC with a secret kept
 * in tim-data/secret.key). The browser keeps it in localStorage AND a cookie, and
 * the server also sets an HttpOnly cookie. A player cannot invent or edit an id,
 * because a changed id fails the signature and gets a new one. A player CAN lose
 * it (clearing site data, private window, other browser): no website can stop that.
 *
 * Privacy: IP addresses are never stored, only a short salted hash. No emails.
 * To change the password, put a new hash in ADMIN_HASH:
 *   php -r 'echo password_hash("NewPassword", PASSWORD_BCRYPT);'
 */
declare(strict_types=1);

const ADMIN_HASH = '$2y$10$2o0urLzMO6zfm0hP2RyzzOnQJjd3oaH8mC5vT.fUgrKrn8aegDCyO';
const DATA_DIR = __DIR__ . '/tim-data';
// Same table as SEASON_SETS in scores.php (check-versions makes sure they match): the month a puzzle set goes live.
const SEASON_SETS = ['2026-11' => 'nov'];
const DISPLAY_TZ = 'America/Vancouver';
/** Shown on the login page so you can tell which copy of this file the server is running. */
// Keep this equal to VERSION in modern-tim/src/game/version.ts (npm run check-versions fails when they differ).
const ADMIN_BUILD = '0.5o';
const PUZZLE_FILE = DATA_DIR . '/puzzles.json';
const PUZZLE_SHOT_DIR = DATA_DIR . '/puzzle-shots';
const ONLINE_SECONDS = 300;
const LOG_MAX_BYTES = 1500000;
const MAX_BODY = 4096;
const MAX_EVENTS_PER_HOUR = 240;
const EVENTS = ['visit', 'name', 'level', 'play', 'solve', 'hint'];
const SCORES_FILE = __DIR__ . '/scores-data.json';
const LEVEL_NAMES = [
    'ramps' => 'Ramps', 'conveyor' => 'Conveyors', 'springs' => 'Springs', 'levers' => 'Levers', 'dominoes' => 'Dominoes',
    'gears' => 'Gears', 'spin' => 'Spin it', 'pulleys2' => 'Pulleys', 'machine' => 'Big machine', 'overtop' => 'Over the Top',
    'bridge' => 'Domino Bridge', 'chain' => 'Chain reaction', 'double' => 'Double dominoes', 'reach' => 'Long reach',
    'tackle2' => 'Heavy lifting', 'tradeoff2' => 'Force or distance', 'crane3' => 'Crane', 'skyhigh' => 'Sky high', 'slalom' => 'Spring slalom', 'maze' => 'Spring maze', 'energy' => 'Energy transfer',
];
const BOARDS = ['shortest' => 'Shortest path', 'fastest' => 'Fastest solve', 'spare' => 'Most spare tools'];

date_default_timezone_set('UTC');

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function ensure_dir() {
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    foreach (['.htaccess' => "Require all denied\nDeny from all\n", 'index.html' => ''] as $f => $c) {
        if (!file_exists(DATA_DIR . '/' . $f)) {
            @file_put_contents(DATA_DIR . '/' . $f, $c);
        }
    }
}

function secret(): string {
    ensure_dir();
    $p = DATA_DIR . '/secret.key';
    if (!file_exists($p)) {
        @file_put_contents($p, bin2hex(random_bytes(32)), LOCK_EX);
    }
    return (string) @file_get_contents($p);
}

/** Run $fn(array &$data) under an exclusive lock on a JSON file. */
function with_json(string $name, callable $fn) {
    ensure_dir();
    $fh = @fopen(DATA_DIR . '/' . $name, 'c+');
    if (!$fh) {
        return;
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $data = $raw ? json_decode($raw, true) : [];
    if (!is_array($data)) {
        $data = [];
    }
    $fn($data);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_UNESCAPED_UNICODE));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
}

function read_json(string $name): array {
    $p = DATA_DIR . '/' . $name;
    $d = is_file($p) ? json_decode((string) @file_get_contents($p), true) : [];
    return is_array($d) ? $d : [];
}

function log_event(array $e) {
    ensure_dir();
    $p = DATA_DIR . '/events.log';
    if (is_file($p) && filesize($p) > LOG_MAX_BYTES) {
        @rename($p, DATA_DIR . '/events.old.log');
    }
    @file_put_contents($p, json_encode($e, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

function ip_hash(): string {
    return substr(hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''), secret()), 0, 10);
}

function clean($v, int $max): string {
    $s = is_string($v) || is_numeric($v) ? (string) $v : '';
    $s = preg_replace('/[\x00-\x1f\x7f<>]/u', '', $s) ?? '';
    return trim(mb_substr($s, 0, $max));
}

// ---------------------------------------------------------------------------
// Device ids
// ---------------------------------------------------------------------------

function sign_id(string $raw): string {
    return $raw . '.' . substr(hash_hmac('sha256', $raw, secret()), 0, 12);
}

function valid_id($id): bool {
    if (!is_string($id) || !preg_match('/^[a-f0-9]{16}\.[a-f0-9]{12}$/', $id)) {
        return false;
    }
    [$raw] = explode('.', $id);
    return hash_equals(sign_id($raw), $id);
}

function new_id(): string {
    return sign_id(bin2hex(random_bytes(8)));
}

function short_id(string $id): string {
    return strtoupper(substr($id, 0, 6));
}

function describe_agent(string $ua): array {
    $os = 'Other';
    foreach (['Windows' => 'Windows', 'Android' => 'Android', 'iPhone|iPad|iPod' => 'iOS', 'Mac OS X|Macintosh' => 'macOS', 'CrOS' => 'ChromeOS', 'Linux' => 'Linux'] as $re => $name) {
        if (preg_match('/' . $re . '/i', $ua)) {
            $os = $name;
            break;
        }
    }
    $browser = 'Other';
    foreach (['Edg/' => 'Edge', 'OPR/|Opera' => 'Opera', 'Firefox/|FxiOS' => 'Firefox', 'Chrome/|CriOS' => 'Chrome', 'Safari/' => 'Safari'] as $re => $name) {
        if (preg_match('/' . $re . '/', $ua)) {
            $browser = $name;
            break;
        }
    }
    $kind = preg_match('/iPad|Tablet/i', $ua) ? 'tablet' : (preg_match('/Mobi|iPhone|Android/i', $ua) ? 'phone' : 'computer');
    return ['os' => $os, 'browser' => $browser, 'kind' => $kind];
}

// ---------------------------------------------------------------------------
// Tracking API
// ---------------------------------------------------------------------------

function api_track() {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo '{"error":"POST only"}';
        return;
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) {
        http_response_code(413);
        echo '{"error":"too big"}';
        return;
    }
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        http_response_code(400);
        echo '{"error":"bad json"}';
        return;
    }

    $id = $in['id'] ?? '';
    if (!valid_id($id)) {
        $id = $_COOKIE['tim_device'] ?? '';
    }
    if (!valid_id($id)) {
        $id = new_id();
    }
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    if (PHP_VERSION_ID >= 70300) {
        setcookie('tim_device', $id, ['expires' => time() + 86400 * 730, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure]);
    } else {
        setcookie('tim_device', $id, time() + 86400 * 730, '/', '', $secure, true);
    }

    $ev = clean($in['ev'] ?? '', 12);
    if (!in_array($ev, EVENTS, true)) {
        echo json_encode(['id' => $id]);
        return;
    }
    $name = clean($in['name'] ?? '', 24);
    $level = preg_replace('/[^a-z0-9_-]/i', '', clean($in['level'] ?? '', 24)) ?? '';
    $version = clean($in['version'] ?? '', 12);
    $d = is_array($in['d'] ?? null) ? $in['d'] : [];
    $secs = isset($d['seconds']) && is_numeric($d['seconds']) ? round(max(0.0, min(3600.0, (float) $d['seconds'])), 2) : null;
    $from = clean($d['from'] ?? '', 24);

    $now = time();
    $ua = describe_agent((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $iph = ip_hash();
    $accepted = false;

    with_json('players.json', function (array &$all) use ($id, $ev, $name, $level, $version, $secs, $now, $ua, $iph, &$accepted) {
        $p = $all[$id] ?? ['id' => $id, 'name' => '', 'names' => [], 'first' => $now, 'last' => $now, 'visits' => 0, 'plays' => 0, 'solves' => 0, 'levels' => [], 'hour' => $now, 'hourCount' => 0];
        if ($now - (int) $p['hour'] > 3600) {
            $p['hour'] = $now;
            $p['hourCount'] = 0;
        }
        if (++$p['hourCount'] > MAX_EVENTS_PER_HOUR) {
            $all[$id] = $p;
            return;
        }
        $accepted = true;
        $p['last'] = $now;
        $p['ua'] = $ua;
        $p['ip'] = $iph;
        if ($version !== '') {
            $p['version'] = $version;
        }
        if ($name !== '') {
            $p['name'] = $name;
            if (!in_array($name, $p['names'], true)) {
                $p['names'][] = $name;
                $p['names'] = array_slice($p['names'], -10);
            }
        }
        if ($ev === 'visit') {
            $p['visits']++;
        }
        if ($level !== '') {
            $l = $p['levels'][$level] ?? ['opens' => 0, 'plays' => 0, 'solves' => 0, 'best' => null];
            if ($ev === 'level') {
                $l['opens']++;
            } elseif ($ev === 'play') {
                $l['plays']++;
                $p['plays']++;
            } elseif ($ev === 'solve') {
                $l['solves']++;
                $p['solves']++;
                if ($secs !== null && ($l['best'] === null || $secs < $l['best'])) {
                    $l['best'] = $secs;
                }
            }
            $p['levels'][$level] = $l;
        }
        $all[$id] = $p;
        // Keep the file bounded: drop the least recently seen players beyond 5000.
        if (count($all) > 5000) {
            uasort($all, function ($a, $b) {
                return ($b['last'] ?? 0) <=> ($a['last'] ?? 0);
            });
            $all = array_slice($all, 0, 5000, true);
        }
    });

    if ($accepted) {
        $entry = ['t' => $now, 'id' => $id, 'name' => $name, 'ev' => $ev, 'level' => $level, 'v' => $version, 'ip' => $iph];
        if ($secs !== null) {
            $entry['seconds'] = $secs;
        }
        if ($ev === 'name' && $from !== '') {
            $entry['from'] = $from;
        }
        log_event($entry);
    }
    echo json_encode(['id' => $id]);
}

// ---------------------------------------------------------------------------
// Admin: login, session, throttle
// ---------------------------------------------------------------------------

/** Tell the browser, the host's page cache (LiteSpeed) and any CDN never to keep a copy: admin pages depend on who is asking. */
function no_cache_headers() {
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-LiteSpeed-Cache-Control: no-cache');
    header('CDN-Cache-Control: no-store');
    header('Surrogate-Control: no-store');
}

function start_session() {
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_name('timadmin');
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure]);
    } else {
        session_set_cookie_params(0, '/', '', $secure, true);
    }
    $GLOBALS['tim_session_ok'] = @session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

function is_admin(): bool {
    return !empty($_SESSION['admin']) && (time() - (int) $_SESSION['admin']) < 8 * 3600;
}

function locked_out(string $iph): int {
    $wait = 0;
    with_json('login.json', function (array &$d) use ($iph, &$wait) {
        $fails = array_values(array_filter($d[$iph] ?? [], function ($t) {
            return time() - $t < 900;
        }));
        $d[$iph] = $fails;
        if (count($fails) >= 5) {
            $wait = 900 - (time() - $fails[0]);
        }
    });
    return max(0, $wait);
}

function note_failure(string $iph) {
    with_json('login.json', function (array &$d) use ($iph) {
        $d[$iph][] = time();
    });
}

function fmt_time(int $t): string {
    $d = new DateTime('@' . $t);
    $d->setTimezone(new DateTimeZone(DISPLAY_TZ));
    return $d->format('Y-m-d H:i');
}

function ago(int $t): string {
    $s = max(0, time() - $t);
    if ($s < 60) return $s . 's ago';
    if ($s < 3600) return intdiv($s, 60) . ' min ago';
    if ($s < 86400) return intdiv($s, 3600) . ' h ago';
    return intdiv($s, 86400) . ' d ago';
}

function h($v): string {
    return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function page_head(string $title, bool $refresh = false) {
    header('Content-Type: text/html; charset=utf-8');
    no_cache_headers();
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
    $GLOBALS['tim_nonce'] = bin2hex(random_bytes(12));
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-" . $GLOBALS['tim_nonce'] . "'; form-action 'self'; frame-ancestors 'none'");
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">';
    echo '<title>' . h($title) . '</title><style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#1d2433;--mute:#667085;--line:#e3e6ee;--acc:#2f6fed;--ok:#1a9d5b;--bad:#d63f3f}
@media(prefers-color-scheme:dark){:root{--bg:#12151c;--card:#1b2030;--ink:#e8ebf3;--mute:#9aa3b5;--line:#2c3348;--acc:#6b9bff;--ok:#43c88a;--bad:#ff7a7a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
main{max-width:none;margin:0 auto;padding:16px 20px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:22px 0 8px}
header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
nav{display:flex;gap:6px;flex-wrap:wrap}nav a,button,.btn{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:6px 12px;border-radius:8px;text-decoration:none;font:inherit;cursor:pointer}
header .stamp{text-align:right;font-size:13px;line-height:1.3}nav a.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.card b{display:block;font-size:24px}.card span{color:var(--mute);font-size:13px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600;font-size:13px}tr:last-child td{border:0}
.multi{display:inline-block;position:relative;vertical-align:middle}.multi summary{list-style:none;border:1px solid var(--line);background:var(--card);padding:6px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}
.multi summary::-webkit-details-marker{display:none}.multi summary::after{content:"\25BE";margin-left:6px;color:var(--mute)}
.multi .menu{position:absolute;z-index:3;margin-top:4px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;display:grid;gap:6px;min-width:140px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.multi .menu label{display:flex;gap:8px;align-items:center;cursor:pointer;white-space:nowrap}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--line);margin-right:6px}.dot.on{background:var(--ok)}
.mute{color:var(--mute)}.mono{font-family:ui-monospace,monospace;font-size:13px}a{color:var(--acc)}
input[type=password],input[type=text],select{padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
.login{max-width:340px;margin:12vh auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.err{color:var(--bad)}form.inline{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
</style></head><body>';
    if ($refresh) {
        // Reload every 30 seconds, but catch up when the tab comes back to the front (browsers pause background
        // timers), and never while someone is typing in a box (a rejection reason would be lost).
        echo '<script nonce="' . $GLOBALS['tim_nonce'] . '">(function(){var t=Date.now();function busy(){var a=document.activeElement;if(a&&(a.tagName==="INPUT"||a.tagName==="SELECT"||a.tagName==="TEXTAREA"))return true;var i=document.querySelectorAll("input[type=text]");for(var k=0;k<i.length;k++){if(i[k].value!==i[k].defaultValue)return true;}return false;}function go(){if(document.hidden||busy()||Date.now()-t<30000)return;location.reload();}setInterval(go,4000);document.addEventListener("visibilitychange",go);window.addEventListener("focus",go);})();</script>';
    }
}

function login_page(string $msg) {
    page_head('Modern TIM admin');
    echo '<div class="login"><h1>Modern TIM admin</h1><p class="mute">Players, devices and logs.</p>';
    if ($msg !== '') {
        echo '<p class="err">' . h($msg) . '</p>';
    }
    echo '<form method="post" action="admin.php"><input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '"><input type="hidden" name="view" value="' . h(preg_replace('/[^a-z]/', '', (string) ($_GET['view'] ?? 'players'))) . '">'
        . '<p><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required style="width:100%"></p>'
        . '<button type="submit" name="do" value="login">Sign in</button></form>'
        . '<p class="mute" style="font-size:12px;margin:14px 0 0">Admin build ' . h(ADMIN_BUILD) . ' &middot; <a href="admin.php?diag=1" style="color:inherit">connection check</a></p></div></body></html>';
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function read_log(int $limit, array $filter): array {
    $rows = [];
    foreach (['events.old.log', 'events.log'] as $f) {
        $p = DATA_DIR . '/' . $f;
        if (!is_file($p)) continue;
        foreach (file($p, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $e = json_decode($line, true);
            if (is_array($e)) $rows[] = $e;
        }
    }
    $rows = array_filter($rows, function ($e) use ($filter) {
        if ($filter['id'] !== '' && ($e['id'] ?? '') !== $filter['id']) return false;
        if ($filter['ev'] !== '' && ($e['ev'] ?? '') !== $filter['ev']) return false;
        if ($filter['q'] !== '' && stripos(($e['name'] ?? '') . ' ' . ($e['level'] ?? ''), $filter['q']) === false) return false;
        return true;
    });
    $rows = array_reverse(array_values($rows));
    return array_slice($rows, 0, $limit);
}

function level_label(string $id): string {
    $n = array_search($id, array_keys(LEVEL_NAMES), true);
    return $n === false ? $id : ($n + 1) . '. ' . LEVEL_NAMES[$id];
}

function format_score(string $category, $v): string {
    $n = (float) $v;
    if ($category === 'shortest') return number_format($n, 3, '.', '') . ' m';
    if ($category === 'fastest') return number_format($n, 2, '.', '') . ' s';
    return (int) $n . ' spare';
}

/** Broken-record entries written by scores.php, newest first. */
function read_records(int $limit, string $level, string $category): array {
    $rows = [];
    foreach (['records.old.log', 'records.log'] as $f) {
        $p = DATA_DIR . '/' . $f;
        if (!is_file($p)) continue;
        foreach (file($p, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $e = json_decode($line, true);
            if (!is_array($e) || !isset($e['t'], $e['level'], $e['category'], $e['name'], $e['value'])) continue;
            if ($level !== '' && $e['level'] !== $level) continue;
            if ($category !== '' && $e['category'] !== $category) continue;
            $rows[] = $e;
        }
    }
    return array_slice(array_reverse($rows), 0, $limit);
}

/** The community boards as scores.php keeps them: level => category => rows. */
function read_boards(): array {
    $d = is_file(SCORES_FILE) ? json_decode((string) @file_get_contents(SCORES_FILE), true) : [];
    return is_array($d) ? $d : [];
}

/** The clock; tests can set TIM_TEST_NOW (a web request cannot). */
function season_now(): int {
    $t = getenv('TIM_TEST_NOW');
    return ($t !== false && $t !== '' && ctype_digit($t)) ? (int) $t : time();
}

/** The secret in the preview link for a puzzle set that is not live yet (made once; scores.php checks it). */
function preview_key(): string {
    $p = DATA_DIR . '/preview.key';
    $k = is_file($p) ? trim((string) @file_get_contents($p)) : '';
    if ($k === '') {
        ensure_dir();
        $k = bin2hex(random_bytes(12));
        if (@file_put_contents($p, $k) === false) return '';
    }
    return $k;
}

/** A season is one calendar month in Vancouver. Same rule as scores.php. */
function season_info(int $ts, string $id = ''): array {
    $tz = new DateTimeZone(DISPLAY_TZ);
    if ($id !== '' && preg_match('/^\d{4}-\d{2}$/', $id)) {
        $start = new DateTime($id . '-01 00:00:00', $tz);
    } else {
        $d = new DateTime('@' . $ts);
        $d->setTimezone($tz);
        $start = new DateTime($d->format('Y-m-01') . ' 00:00:00', $tz);
    }
    $end = clone $start;
    $end->modify('+1 month');
    return ['id' => $start->format('Y-m'), 'label' => $start->format('F Y'), 'start' => $start->getTimestamp(), 'end' => $end->getTimestamp()];
}

/** Finished seasons that scores.php archived, newest first (ids like 2026-10). */
function season_ids(): array {
    $ids = [];
    foreach (glob(DATA_DIR . '/seasons/*.json') ?: [] as $f) {
        if (preg_match('/^(\d{4}-\d{2})\.json$/', basename($f), $m)) $ids[] = $m[1];
    }
    rsort($ids);
    return $ids;
}

/** One archived season, or null. */
function read_season(string $id) {
    if (!preg_match('/^\d{4}-\d{2}$/', $id)) return null;
    $p = DATA_DIR . '/seasons/' . $id . '.json';
    $d = is_file($p) ? json_decode((string) @file_get_contents($p), true) : null;
    return is_array($d) && isset($d['boards']) ? $d : null;
}

/** "3 d 5 h", "5 h 10 min" or "12 min". */
function left_text(int $secs): string {
    if ($secs <= 0) return 'ending now';
    $d = intdiv($secs, 86400);
    $h = intdiv($secs % 86400, 3600);
    $m = intdiv($secs % 3600, 60);
    return $d > 0 ? $d . ' d ' . $h . ' h' : ($h > 0 ? $h . ' h ' . $m . ' min' : max(1, $m) . ' min');
}

/** Stars per player from a set of boards: [['name' => ..., 'stars' => n], ...], most first (ties by name). */
function star_table(array $boards): array {
    $count = [];
    $shown = [];
    foreach (LEVEL_NAMES as $id => $_) {
        foreach (BOARDS as $c => $__) {
            $list = is_array($boards[$id][$c] ?? null) ? $boards[$id][$c] : [];
            $top = null;
            foreach ($list as $row) {
                if (is_array($row) && isset($row['value']) && is_numeric($row['value'])) {
                    $v = (float) $row['value'];
                    if ($top === null || ($c === 'spare' ? $v > $top : $v < $top)) $top = $v;
                }
            }
            if ($top === null) continue;
            foreach ($list as $row) {
                if (is_array($row) && isset($row['name'], $row['value']) && is_numeric($row['value']) && abs((float) $row['value'] - $top) < 0.0001) {
                    $k = mb_strtolower((string) $row['name']);
                    $count[$k] = ($count[$k] ?? 0) + 1;
                    if (!isset($shown[$k])) $shown[$k] = (string) $row['name'];
                }
            }
        }
    }
    $rows = [];
    foreach ($count as $k => $n) $rows[] = ['name' => $shown[$k], 'stars' => $n];
    usort($rows, function ($a, $b) {
        return $b['stars'] <=> $a['stars'] ?: strcasecmp($a['name'], $b['name']);
    });
    return $rows;
}

/** Where a screenshot file lives: this season's folder or a finished season's, or '' if it is gone. */
function shot_path(string $file): string {
    if (!preg_match('/^[0-9]{8}-[0-9]{6}-[a-z0-9]+-[a-f0-9]{6}\.jpg$/', $file)) return '';
    foreach (['/shots/', '/seasons/shots/'] as $d) {
        if (is_file(DATA_DIR . $d . $file)) return DATA_DIR . $d . $file;
    }
    return '';
}

/** A plain link to the screenshot (served by this page only after sign-in). */
function shot_cell($file): string {
    $file = (string) $file;
    if (shot_path($file) === '') {
        return '<span class="mute">-</span>';
    }
    $u = 'admin.php?shot=' . rawurlencode($file);
    return '<a href="' . h($u) . '" target="_blank" rel="noopener">View</a>';
}

/** One entry of a community board: '#1' (alone in first), 'Tied #1', or 'Beaten' (behind number one). */
function board_status(array $list, string $category, array $row): string {
    $top = null;
    foreach ($list as $r) {
        if (is_array($r) && isset($r['value']) && is_numeric($r['value'])) {
            $v = (float) $r['value'];
            if ($top === null || ($category === 'spare' ? $v > $top : $v < $top)) $top = $v;
        }
    }
    if ($top === null || !isset($row['value']) || !is_numeric($row['value']) || abs((float) $row['value'] - $top) >= 0.0001) return 'Beaten';
    $same = 0;
    foreach ($list as $r) {
        if (is_array($r) && isset($r['value']) && is_numeric($r['value']) && abs((float) $r['value'] - $top) < 0.0001) $same++;
    }
    return $same > 1 ? 'Tied #1' : '#1';
}

/** Does this board entry pass the Player and Now filters of the High scores page? */
function board_row_shown(array $list, string $category, $row, string $player, array $nows): bool {
    if (!is_array($row) || !isset($row['name'], $row['value'])) return false;
    if ($player !== '' && mb_strtolower((string) $row['name']) !== $player) return false;
    if (!$nows) return true;
    $s = board_status($list, $category, $row);
    return in_array($s === '#1' ? 'top' : ($s === 'Tied #1' ? 'tied' : 'beaten'), $nows, true);
}

/** The screenshot of a board's number one: kept on the row, or (older records) found in the records log. */
function board_shot(array $log, string $level, string $category, array $row): string {
    if (!empty($row['shot'])) return (string) $row['shot'];
    foreach ($log as $e) {   // newest first
        if ($e['level'] === $level && $e['category'] === $category && !empty($e['shot']) && isset($row['name'], $row['value'])
            && mb_strtolower((string) $e['name']) === mb_strtolower((string) $row['name']) && abs((float) $e['value'] - (float) $row['value']) < 0.0001) {
            return (string) $e['shot'];
        }
    }
    return '';
}

/**
 * Stars per player name (lower-case): one for every community board (level x Shortest/Fastest/Spare)
 * where the name holds or ties number one. Same rule as the game's level list.
 */
function star_counts(): array {
    $boards = read_boards();
    $stars = [];
    foreach (LEVEL_NAMES as $id => $_) {
        foreach (BOARDS as $c => $__) {
            $list = is_array($boards[$id][$c] ?? null) ? $boards[$id][$c] : [];
            $top = null;
            foreach ($list as $row) {
                if (is_array($row) && isset($row['name'], $row['value']) && is_numeric($row['value'])) {
                    $v = (float) $row['value'];
                    if ($top === null || ($c === 'spare' ? $v > $top : $v < $top)) $top = $v;
                }
            }
            if ($top === null) continue;
            foreach ($list as $row) {
                if (is_array($row) && isset($row['name'], $row['value']) && is_numeric($row['value']) && abs((float) $row['value'] - $top) < 0.0001) {
                    $k = mb_strtolower((string) $row['name']);
                    $stars[$k] = ($stars[$k] ?? 0) + 1;
                }
            }
        }
    }
    return $stars;
}

/** Where does this name stand on a community board right now? '#1', 'Tied #1', or '' (not number one any more). */
function standing(array $boards, string $level, string $category, string $name): string {
    $list = is_array($boards[$level][$category] ?? null) ? $boards[$level][$category] : [];
    $top = null;
    foreach ($list as $row) {
        if (is_array($row) && isset($row['name'], $row['value']) && is_numeric($row['value'])) {
            $v = (float) $row['value'];
            if ($top === null || ($category === 'spare' ? $v > $top : $v < $top)) $top = $v;
        }
    }
    if ($top === null) return '';
    $holders = 0;
    $mine = false;
    foreach ($list as $row) {
        if (is_array($row) && isset($row['name'], $row['value']) && is_numeric($row['value']) && abs((float) $row['value'] - $top) < 0.0001) {
            $holders++;
            if (mb_strtolower((string) $row['name']) === mb_strtolower($name)) $mine = true;
        }
    }
    if (!$mine) return '';
    return $holders > 1 ? 'Tied #1' : '#1';
}

function scores_view() {
    $level = (string) ($_GET['level'] ?? '');
    $level = isset(LEVEL_NAMES[$level]) ? $level : '';
    $cat = (string) ($_GET['cat'] ?? '');
    $cat = isset(BOARDS[$cat]) ? $cat : '';
    // Now filter: any of #1 / Tied #1 / Beaten (a single ?now=top still works); none ticked = everything.
    $nowRaw = $_GET['now'] ?? [];
    $nows = array_values(array_unique(array_filter(is_array($nowRaw) ? $nowRaw : [$nowRaw], function ($v) {
        return in_array($v, ['top', 'tied', 'beaten'], true);
    })));
    // Season: the current month, or any finished one (its boards and records are shown exactly the same way).
    $cur = season_info(season_now());
    $archived = season_ids();
    $seasonSel = (string) ($_GET['season'] ?? '');
    $archive = in_array($seasonSel, $archived, true) ? read_season($seasonSel) : null;
    if (!$archive) $seasonSel = '';
    $from = $archive ? (int) $archive['start'] : $cur['start'];
    $to = $archive ? (int) $archive['end'] : PHP_INT_MAX;
    $inSeason = function ($e) use ($from, $to) {
        return (int) $e['t'] >= $from && (int) $e['t'] < $to;
    };
    $boardsNow = $archive ? $archive['boards'] : read_boards();
    $rows = array_values(array_filter(read_records(100000, $level, $cat), $inSeason));
    $names = [];
    foreach (array_filter(read_records(100000, '', ''), $inSeason) as $e) $names[mb_strtolower((string) $e['name'])] = (string) $e['name'];
    foreach (LEVEL_NAMES as $id => $_) {
        foreach (BOARDS as $c => $__) {
            foreach (is_array($boardsNow[$id][$c] ?? null) ? $boardsNow[$id][$c] : [] as $row) {
                if (is_array($row) && isset($row['name']) && is_string($row['name'])) $names[mb_strtolower($row['name'])] = $row['name'];
            }
        }
    }
    uksort($names, 'strnatcasecmp');
    $player = mb_strtolower(trim((string) ($_GET['player'] ?? '')));
    $player = isset($names[$player]) ? $player : '';
    if ($player !== '') {
        $rows = array_values(array_filter($rows, function ($e) use ($player) {
            return mb_strtolower((string) $e['name']) === $player;
        }));
    }
    if ($nows) {
        $rows = array_values(array_filter($rows, function ($e) use ($boardsNow, $nows) {
            $s = standing($boardsNow, (string) $e['level'], (string) $e['category'], (string) $e['name']);
            return in_array($s === '#1' ? 'top' : ($s === 'Tied #1' ? 'tied' : ($s === '' ? 'beaten' : '')), $nows, true);
        }));
    }
    $rows = array_slice($rows, 0, 300);
    $all = array_values(array_filter(read_records(100000, '', ''), $inSeason));
    $weekAgo = season_now() - 7 * 86400;
    $week = count(array_filter($all, function ($e) use ($weekAgo) {
        return (int) $e['t'] >= $weekAgo;
    }));

    $intro = '<h2>Records broken</h2><p class="mute">One line each time a run beats the old number one on a board. Ties and first scores are not listed. <b>Now</b> says whether the player is still number one (or tied for it) on the community board. '
        . '<b>' . count($all) . '</b> broken in total, <b>' . $week . '</b> in the last 7 days.</p>';
    echo '<form class="inline" method="get" action="admin.php"><input type="hidden" name="view" value="scores"><select name="season"><option value="">Current season: ' . h($cur['label']) . '</option>';
    foreach ($archived as $sid) {
        $sinfo = season_info(0, $sid);
        echo '<option value="' . h($sid) . '"' . ($seasonSel === $sid ? ' selected' : '') . '>' . h($sinfo['label']) . ' (final)</option>';
    }
    echo '</select><select name="level"><option value="">All levels</option>';
    foreach (LEVEL_NAMES as $id => $label) {
        echo '<option value="' . h($id) . '"' . ($level === $id ? ' selected' : '') . '>' . h(level_label($id)) . '</option>';
    }
    echo '</select><select name="cat"><option value="">All boards</option>';
    foreach (BOARDS as $id => $label) {
        echo '<option value="' . h($id) . '"' . ($cat === $id ? ' selected' : '') . '>' . h($label) . '</option>';
    }
    echo '</select><select name="player"><option value="">All players</option>';
    foreach ($names as $key => $label) {
        echo '<option value="' . h($key) . '"' . ($player === $key ? ' selected' : '') . '>' . h($label) . '</option>';
    }
    $nowLabels = ['top' => '#1', 'tied' => 'Tied #1', 'beaten' => 'Beaten'];
    $picked = array_map(function ($k) use ($nowLabels) {
        return $nowLabels[$k];
    }, $nows);
    echo '</select><details class="multi"><summary>' . ($picked ? h(implode(' + ', $picked)) : 'Any Now') . '</summary><div class="menu">';
    foreach ($nowLabels as $v => $label) {
        echo '<label><input type="checkbox" name="now[]" value="' . h($v) . '"' . (in_array($v, $nows, true) ? ' checked' : '') . '> ' . h($label) . '</label>';
    }
    echo '</div></details>';
    echo '<button>Filter</button><a class="btn" href="admin.php?view=scores">Clear</a></form>';
    // Which season this is, and who leads it.
    if ($archive) {
        echo '<p><b>' . h($archive['label']) . '</b> <span class="mute">final results, ' . h(fmt_time((int) $archive['start'])) . ' to ' . h(fmt_time((int) $archive['end'])) . '. Boards, records and stars are exactly as that season ended.</span></p>';
        $leaders = is_array($archive['stars'] ?? null) ? $archive['stars'] : [];
    } else {
        echo '<p><b>' . h($cur['label']) . '</b> <span class="mute">season in progress: ends ' . h(fmt_time($cur['end'])) . ' (' . h(DISPLAY_TZ) . '), ' . h(left_text($cur['end'] - season_now())) . ' left. At that moment the boards are saved here as a finished season and start empty.</span></p>';
        $leaders = star_table($boardsNow);
    }
    if (!$archive) {
        // Puzzle sets that are shipped in the game but not live yet: the admin can play them from here.
        foreach (SEASON_SETS as $month => $setName) {
            if (strcmp((string) $month, $cur['id']) <= 0) continue;
            $key = preview_key();
            $info = season_info(0, (string) $month);
            echo '<p><b>' . h($info['label']) . ' puzzles</b> <span class="mute">are in the game but hidden. They go live on ' . h(fmt_time($info['start'])) . ' (' . h(DISPLAY_TZ) . '). Play them now: </span>'
                . ($key !== '' ? '<a class="btn" target="_blank" rel="noopener" href="./?preview=' . h($key) . '&amp;set=' . h($setName) . '">Preview ' . h($info['label']) . ' puzzles</a> <span class="mute">(nothing you do there is saved or sent). Keep this link private.</span>' : '<span class="mute">(the data folder is not writable, so there is no link)</span>') . '</p>';
        }
    }
    echo '<div class="wrap" style="margin-bottom:8px"><table><tr><th>Star leaders</th>';
    for ($i = 0; $i < 5; $i++) echo '<th>' . ($i + 1) . '</th>';
    echo '</tr><tr><td class="mute">' . ($archive ? 'Final' : 'Right now') . '</td>';
    for ($i = 0; $i < 5; $i++) {
        $r = $leaders[$i] ?? null;
        echo '<td>' . ($r ? ($i === 0 || ($leaders[0]['stars'] ?? -1) === $r['stars'] ? '&#127942; ' : '') . '<b>' . h($r['name']) . '</b> &#9733; ' . (int) $r['stars'] : '<span class="mute">-</span>') . '</td>';
    }
    echo '</tr></table></div>';
    ob_start();   // the three tables are built in this order but shown as: community boards, refused scores, records broken
    echo $intro;
    echo '<div class="wrap"><table><tr><th>When</th><th>Level</th><th>Board</th><th>Score</th><th>Now</th><th>Version</th><th>Screenshot</th><th>Beat</th><th>By how much</th></tr>';
    foreach ($rows as $e) {
        $c = (string) $e['category'];
        $stand = standing($boardsNow, (string) $e['level'], $c, (string) $e['name']);
        $gain = isset($e['prevValue']) ? abs((float) $e['value'] - (float) $e['prevValue']) : null;
        $same = isset($e['prevName']) && mb_strtolower((string) $e['prevName']) === mb_strtolower((string) $e['name']);
        echo '<tr><td title="' . h(fmt_time((int) $e['t'])) . '">' . h(fmt_time((int) $e['t'])) . ' <span class="mute">(' . h(ago((int) $e['t'])) . ')</span></td>'
            . '<td><b>' . h(level_label((string) $e['level'])) . '</b></td><td>' . h(BOARDS[$c] ?? $c) . '</td>'
            . '<td><b>' . h($e['name']) . '</b> ' . h(format_score($c, $e['value'])) . '</td>'
            . '<td>' . ($stand === '' ? '<span class="mute">Beaten</span>' : '<b>' . h($stand) . '</b>') . '</td>'
            . '<td class="mute">' . (!empty($e['version']) ? 'v' . h($e['version']) : '-') . '</td>'
            . '<td>' . shot_cell($e['shot'] ?? '') . '</td>'
            . '<td class="mute">' . (isset($e['prevName']) ? h($e['prevName']) . ' ' . h(format_score($c, $e['prevValue'] ?? 0)) . ($same ? ' (their own)' : '') : '-') . '</td>'
            . '<td class="mute">' . ($gain === null ? '-' : h(format_score($c, $gain))) . '</td></tr>';
    }
    if (!$rows) echo '<tr><td colspan="9" class="mute">No broken records yet.</td></tr>';
    echo '</table></div><p class="mute">Newest first, up to 300 rows. <b>Now</b> = whether the player is still number one (or tied for it) on the community board. Times are ' . h(DISPLAY_TZ) . '.</p>';

    $recordsHtml = ob_get_clean();
    ob_start();
    $rej = [];
    $rp = DATA_DIR . '/rejects.log';
    if (is_file($rp)) {
        foreach (array_reverse(file($rp, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) as $line) {
            $r = json_decode($line, true);
            if (is_array($r) && isset($r['t'], $r['reason'])) $rej[] = $r;
            if (count($rej) >= 20) break;
        }
    }
    if ($rej) {
        echo '<h2>Scores the server refused</h2><div class="wrap"><table><tr><th>When</th><th>Level</th><th>Player</th><th>Run</th><th>Version</th><th>Why</th></tr>';
        foreach ($rej as $r) {
            $run = isset($r['pathMeters'], $r['seconds'], $r['spare']) ? $r['pathMeters'] . ' m, ' . $r['seconds'] . ' s, ' . $r['spare'] . ' spare' : '-';
            echo '<tr><td>' . h(fmt_time((int) $r['t'])) . '</td><td>' . h(isset($r['level']) ? level_label((string) $r['level']) : '-') . '</td><td>' . h($r['name'] ?? '-')
                . '</td><td>' . h($run) . '</td><td class="mute">' . h(isset($r['version']) ? 'v' . $r['version'] : '-') . '</td><td>' . h((string) $r['reason']) . ' <span class="mute">(' . (int) ($r['code'] ?? 0) . ')</span></td></tr>';
        }
        echo '</table></div><p class="mute">The newest 20 runs scores.php turned away, with the reason. Empty (hidden) when none were refused.</p>';
    }

    $refusedHtml = ob_get_clean();
    ob_start();
    $boards = $boardsNow;
    $log = read_records(100000, '', '');
    echo '<h2>' . ($archive ? 'Community boards at the end of ' . h($archive['label']) : 'Current community boards') . '</h2><div class="wrap"><table><tr><th>Level</th>';
    foreach (BOARDS as $label) echo '<th>' . h($label) . '</th>';
    echo '</tr>';
    foreach (LEVEL_NAMES as $id => $label) {
        if ($level !== '' && $level !== $id) continue;
        if ($player !== '' || $nows) {
            $has = false;
            foreach (BOARDS as $c => $_) {
                $list = is_array($boards[$id][$c] ?? null) ? $boards[$id][$c] : [];
                foreach (array_slice($list, 0, 5) as $row) {
                    if (board_row_shown($list, $c, $row, $player, $nows)) $has = true;
                }
            }
            if (!$has) continue;
        }
        $rev = (string) ($boards['_revs'][$id] ?? '');
        echo '<tr><td><b>' . h(level_label($id)) . '</b>' . ($rev !== '' ? '<br><span class="mute">level v' . h($rev) . '</span>' : '') . '</td>';
        foreach (BOARDS as $c => $_) {
            $list = is_array($boards[$id][$c] ?? null) ? $boards[$id][$c] : [];
            echo '<td>';
            if (!$list) echo '<span class="mute">-</span>';
            $top = null;   // number one's score: everyone on it is bold (and holds a star)
            foreach ($list as $row) {
                if (is_array($row) && isset($row['value']) && is_numeric($row['value'])) {
                    $v = (float) $row['value'];
                    if ($top === null || ($c === 'spare' ? $v > $top : $v < $top)) $top = $v;
                }
            }
            foreach (array_slice($list, 0, 5) as $i => $row) {
                if (!board_row_shown($list, $c, $row, $player, $nows)) continue;
                $first = $top !== null && is_numeric($row['value']) && abs((float) $row['value'] - $top) < 0.0001;
                echo ($first ? '<b>' : '') . ($first ? 1 : $i + 1) . '. ' . h($row['name']) . ' ' . h(format_score($c, $row['value']))
                    . (!empty($row['v']) ? ' <span class="mute">v' . h((string) $row['v']) . '</span>' : '') . ($first ? '</b>' : '')
                    . (!empty($row['at']) ? ' <span class="mute">' . h(fmt_time((int) $row['at'])) . '</span>' : '')
                    . ($i === 0 ? ' ' . shot_cell(board_shot($log, $id, $c, $row)) : '') . '<br>';
            }
            echo '</td>';
        }
        echo '</tr>';
    }
    echo '</table></div><p class="mute">Top 5 per board, one row per name, with the game version and the date and time each entry was logged. Bold = number one, including everyone tied on it (one star each). The Player and Now filters apply here too: #1 = alone in first, Tied #1 = shared first, Beaten = behind number one. <b>View</b> on the record holder line is the screenshot of the run that set the record; it is replaced, and the old picture deleted, when someone beats it, and it stays empty (-) until a record is broken from the game. <b>Level v</b> is the game version the level was last changed in; changing it clears that level\'s boards.</p>';
    $boardsHtml = ob_get_clean();
    $hall = '';
    if ($archived) {
        $hall = '<h2>Season results</h2><div class="wrap"><table><tr><th>Season</th><th>Champion</th><th>Top five</th><th></th></tr>';
        $live = star_table(read_boards());
        $hall .= '<tr><td><b>' . h($cur['label']) . '</b> <span class="mute">in progress</span></td><td>' . ($live ? h($live[0]['name']) . ' &#9733; ' . (int) $live[0]['stars'] : '-') . '</td><td class="mute">'
            . h(implode(', ', array_map(function ($r) {
                return $r['name'] . ' ' . $r['stars'];
            }, array_slice($live, 0, 5)))) . '</td><td><a href="admin.php?view=scores">Open</a></td></tr>';
        foreach ($archived as $sid) {
            $s = read_season($sid);
            if (!$s) continue;
            $st = is_array($s['stars'] ?? null) ? $s['stars'] : [];
            $champs = [];
            foreach ($st as $r) {
                if ($r['stars'] === $st[0]['stars']) $champs[] = $r['name'];
            }
            $hall .= '<tr><td><b>' . h($s['label']) . '</b></td><td>' . ($st ? '&#127942; ' . h(implode(' + ', $champs)) . ' &#9733; ' . (int) $st[0]['stars'] : '-') . '</td><td class="mute">'
                . h(implode(', ', array_map(function ($r) {
                    return $r['name'] . ' ' . $r['stars'];
                }, array_slice($st, 0, 5)))) . '</td><td><a href="admin.php?view=scores&amp;season=' . h($sid) . '">Open</a></td></tr>';
        }
        $hall .= '</table></div><p class="mute">Every finished season stays available in full: pick it in the first filter above.</p>';
    }
    echo $boardsHtml . $refusedHtml . $recordsHtml . $hall;
}


/** Lock puzzles.json (same file and lock as share.php), run $fn(&$db), save when it returns true. */
function puzzles_edit(callable $fn): bool {
    ensure_dir();
    $fh = @fopen(PUZZLE_FILE, 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) return false;
    $raw = stream_get_contents($fh);
    $db = $raw ? json_decode($raw, true) : null;
    if (!is_array($db)) $db = [];
    $db += ['next' => 1, 'order' => [], 'puzzles' => []];
    $changed = $fn($db);
    if ($changed) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($db, JSON_UNESCAPED_UNICODE));
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return true;
}

function puzzles_read(): array {
    $db = read_json('puzzles.json');
    if (!isset($db['puzzles']) || !is_array($db['puzzles'])) $db['puzzles'] = [];
    if (!isset($db['order']) || !is_array($db['order'])) $db['order'] = [];
    return $db;
}

function puzzle_shot_file(string $name): string {
    if (!preg_match('/^p[0-9]+-[0-9]{14}-[a-f0-9]{4}\.jpg$/', $name)) return '';
    $p = PUZZLE_SHOT_DIR . '/' . $name;
    return is_file($p) ? $p : '';
}

function puzzle_drop_shot($name) {
    if (is_string($name) && puzzle_shot_file($name) !== '') @unlink(PUZZLE_SHOT_DIR . '/' . $name);
}

function puzzle_label($d): string {
    if (!is_int($d) || $d < 1) return '-';
    return $d . '/10 ' . ($d <= 3 ? 'Easy' : ($d <= 6 ? 'Medium' : ($d <= 8 ? 'Hard' : 'Expert')));
}

/** The dashboard's actions on community puzzles. */
function puzzle_action(array $post) {
    $do = (string) ($post['do'] ?? '');
    $id = (int) ($post['id'] ?? 0);
    $reason = trim(mb_substr((string) ($post['reason'] ?? ''), 0, 160));
    $diff = (int) ($post['difficulty'] ?? 0);
    $title = trim(mb_substr(trim((string) preg_replace('/[\x00-\x1f\x7f<>]+/', ' ', (string) ($post['title'] ?? ''))), 0, 28));
    puzzles_edit(function (&$db) use ($do, $id, $reason, $diff, $title) {
        $rec = $db['puzzles'][$id] ?? null;
        if (!is_array($rec)) return false;
        if ($do === 'p_rename') {
            // The puzzle keeps its number and its creator; only the name changes (for example an inappropriate one).
            if ($title === '') return false;
            foreach (['cur', 'draft'] as $k) {
                if (is_array($rec[$k] ?? null)) $db['puzzles'][$id][$k]['title'] = $title;
            }
            $db['puzzles'][$id]['title_admin'] = $title;
            return true;
        }
        if ($do === 'p_rate') {
            $db['puzzles'][$id]['difficulty'] = ($diff >= 1 && $diff <= 10) ? $diff : null;
            return true;
        }
        if ($do === 'p_approve' && is_array($rec['draft'] ?? null)) {
            puzzle_drop_shot($rec['cur']['shot'] ?? '');
            $rec['cur'] = $rec['draft'];
            if (!empty($rec['title_admin'])) $rec['cur']['title'] = $rec['title_admin'];
            $rec['draft'] = null;
            $rec['reason'] = '';
            // A new rating comes with the approval if the box was filled in.
            if ($diff >= 1 && $diff <= 10) $rec['difficulty'] = $diff;
            $db['puzzles'][$id] = $rec;
            if (!in_array($id, $db['order'], true)) $db['order'][] = $id;
            return true;
        }
        if ($do === 'p_reject' && is_array($rec['draft'] ?? null)) {
            puzzle_drop_shot($rec['draft']['shot'] ?? '');
            $rec['draft'] = null;
            $rec['reason'] = $reason !== '' ? $reason : 'Not accepted this time.';
            $db['puzzles'][$id] = $rec;
            return true;
        }
        if ($do === 'p_pull' && is_array($rec['cur'] ?? null)) {
            // Take a live puzzle out of the game; the creator sees it as rejected and can edit and resubmit.
            $rec['draft'] = is_array($rec['draft'] ?? null) ? $rec['draft'] : $rec['cur'];
            if ($rec['draft'] === $rec['cur']) {
                $rec['cur'] = null;
                $rec['draft'] = null;
                $rec['reason'] = $reason !== '' ? $reason : 'Taken out of the game.';
            } else {
                puzzle_drop_shot($rec['cur']['shot'] ?? '');
                $rec['cur'] = null;
                $rec['reason'] = '';
            }
            $db['puzzles'][$id] = $rec;
            $db['order'] = array_values(array_filter($db['order'], function ($x) use ($id) {
                return $x !== $id;
            }));
            return true;
        }
        if ($do === 'p_delete') {
            puzzle_drop_shot($rec['cur']['shot'] ?? '');
            puzzle_drop_shot($rec['draft']['shot'] ?? '');
            unset($db['puzzles'][$id]);
            $db['order'] = array_values(array_filter($db['order'], function ($x) use ($id) {
                return $x !== $id;
            }));
            return true;
        }
        if ($do === 'p_up' || $do === 'p_down' || $do === 'p_top' || $do === 'p_bottom') {
            $i = array_search($id, $db['order'], true);
            if ($i === false) return false;
            $o = $db['order'];
            array_splice($o, $i, 1);
            $to = $do === 'p_up' ? max(0, $i - 1) : ($do === 'p_down' ? min(count($o), $i + 1) : ($do === 'p_top' ? 0 : count($o)));
            array_splice($o, $to, 0, [$id]);
            $db['order'] = $o;
            return true;
        }
        return false;
    });
}

function puzzle_card(array $rec, array $v, string $kind, int $pos, int $total) {
    $id = (int) $rec['id'];
    $key = preview_key();
    $csrf = h($_SESSION['csrf']);
    $thumb = puzzle_shot_file((string) ($v['shot'] ?? '')) !== ''
        ? '<a href="admin.php?pshot=' . h($v['shot']) . '" target="_blank" rel="noopener"><img src="admin.php?pshot=' . h($v['shot']) . '" alt="Solution" style="width:240px;max-width:100%;border-radius:8px;border:1px solid var(--line)"></a>'
        : '<span class="mute">no screenshot</span>';
    $form = function ($do, $label, $extra = '') use ($id, $csrf) {
        return '<form method="post" action="admin.php" style="display:inline"><input type="hidden" name="csrf" value="' . $csrf . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . $id . '"><button name="do" value="' . $do . '">' . $label . '</button>' . $extra . '</form> ';
    };
    $rate = '<form method="post" action="admin.php" class="inline"><input type="hidden" name="csrf" value="' . $csrf . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . $id . '">'
        . '<label>Difficulty <select name="difficulty"><option value="0">-</option>';
    for ($d = 1; $d <= 10; $d++) $rate .= '<option value="' . $d . '"' . (($rec['difficulty'] ?? null) === $d ? ' selected' : '') . '>' . $d . '</option>';
    $rate .= '</select></label>';
    $actions = '';
    $ver = $kind === 'draft' ? 'draft' : 'cur';
    if ($kind === 'gone') $rate = '';
    $play = $key !== '' ? '<a class="btn" target="_blank" rel="noopener" href="./?preview=' . h($key) . '&amp;puzzle=' . $id . '&amp;version=' . $ver . '">&#9654; Play this puzzle (like a future month)</a> ' : '';
    if ($kind === 'draft') {
        $actions = $rate . ' <button name="do" value="p_approve">Approve</button></form> '
            . '<form method="post" action="admin.php" class="inline"><input type="hidden" name="csrf" value="' . $csrf . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . $id . '">'
            . '<input type="text" name="reason" maxlength="160" placeholder="Reason shown to the creator"><button name="do" value="p_reject">Reject</button></form>';
    } elseif ($kind === 'gone') {
        $actions = '<span class="mute">Removed by its creator ' . h(fmt_time((int) ($rec['gone'] ?? 0))) . '. It is no longer in the game; you keep the solution and screenshot.</span>';
    } else {
        $actions = $rate . ' <button name="do" value="p_rate">Save</button></form> '
            . $form('p_up', '&#9650;') . $form('p_down', '&#9660;') . $form('p_top', 'Top') . $form('p_bottom', 'Bottom')
            . '<form method="post" action="admin.php" class="inline"><input type="hidden" name="csrf" value="' . $csrf . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . $id . '">'
            . '<input type="text" name="reason" maxlength="160" placeholder="Reason (optional)"><button name="do" value="p_pull">Take out of game</button></form>';
    }
    $renameForm = '<form method="post" action="admin.php" class="inline" style="margin:6px 0"><input type="hidden" name="csrf" value="' . $csrf . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . $id . '">'
        . '<input type="text" name="title" maxlength="28" value="' . h($v['title'] ?? '') . '" aria-label="Puzzle name"><button name="do" value="p_rename">Rename</button></form>';
    echo '<div class="card" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px"><div>' . $thumb . '</div><div style="flex:1;min-width:260px">'
        . '<b style="font-size:17px">' . ($kind === 'cur' ? '#' . ($pos + 1) . ' ' : '') . h($v['title'] ?? '') . '</b> <span class="mute">by ' . h($rec['creator'] ?? '') . ' &middot; puzzle <b>#' . sprintf('%04X', $id) . '</b> &middot; version ' . (int) ($v['rev'] ?? 1) . '</span><br>'
        . $renameForm . '<span class="mute">' . count($v['fixed'] ?? []) . ' fixed parts, ' . count($v['solution'] ?? []) . ' parts in the tray &middot; <b>solution runs ' . (isset($v['seconds']) && $v['seconds'] > 0 ? h(number_format((float) $v['seconds'], 1)) . ' s' : 'unknown') . '</b> &middot; sent ' . h(fmt_time((int) ($v['at'] ?? 0))) . '</span>';
    if ($kind === 'cur' || $kind === 'gone') {
        $up = $down = 0;
        foreach ((array) ($rec['votes'] ?? []) as $x) { if ($x === 1) $up++; elseif ($x === -1) $down++; }
        echo '<br>Rating: ' . h(puzzle_label($rec['difficulty'] ?? null)) . ' &middot; solved by ' . count((array) ($rec['done'] ?? [])) . ' &middot; &#128077; ' . $up . ' &#128078; ' . $down;
        if (is_array($rec['draft'] ?? null)) echo '<br><b>An edit is waiting for approval below.</b> The old version stays live until then.';
    }
    echo '<div style="margin-top:8px">' . $play . '</div><div style="margin-top:8px">' . $actions . '</div>'
        . '<div style="margin-top:6px">' . $form('p_delete', 'Delete for good') . '</div></div></div>';
}

function puzzles_view() {
    $db = puzzles_read();
    $waiting = $live = $rejected = $removed = [];
    foreach ($db['puzzles'] as $rec) {
        if (!is_array($rec)) continue;
        if (!empty($rec['gone'])) {
            $removed[] = $rec;
            continue;
        }
        if (is_array($rec['draft'] ?? null)) $waiting[] = $rec;
        if (!is_array($rec['cur'] ?? null) && !is_array($rec['draft'] ?? null)) $rejected[] = $rec;
    }
    usort($waiting, function ($a, $b) {
        return ($a['draft']['at'] ?? 0) <=> ($b['draft']['at'] ?? 0);
    });
    foreach ($db['order'] as $id) {
        if (isset($db['puzzles'][$id]) && empty($db['puzzles'][$id]['gone']) && is_array($db['puzzles'][$id]['cur'] ?? null)) $live[] = $db['puzzles'][$id];
    }
    // A refresh button right here (the one in the top bar is easy to miss), with a cache-busting address.
    $autoQs = !empty($_GET['auto']) ? '&amp;auto=1' : '';
    echo '<p style="margin:12px 0 0"><a class="btn" id="pz-refresh" href="admin.php?view=puzzles' . $autoQs . '&amp;r=' . time() . '" style="font-weight:700">&#8635; Refresh puzzles</a> '
        . '<span class="mute">Loaded <span id="pz-age">just now</span> (' . h((new DateTime('now', new DateTimeZone(DISPLAY_TZ)))->format('H:i:s')) . ')</span></p>';
    echo '<script nonce="' . h($GLOBALS['tim_nonce']) . '">(function(){var t=Date.now(),e=document.getElementById("pz-age"),b=document.getElementById("pz-refresh");setInterval(function(){var s=Math.round((Date.now()-t)/1000);e.textContent=s<5?"just now":s<90?s+" s ago":Math.round(s/60)+" min ago";},2000);b.addEventListener("click",function(ev){ev.preventDefault();b.textContent="Refreshing...";location.href=b.getAttribute("href").replace(/&r=\d+/,"&r="+Date.now());});})();</script>';
    echo '<div class="cards" style="margin-top:12px"><div class="card"><b>' . count($waiting) . '</b><span>waiting for approval</span></div>'
        . '<div class="card"><b>' . count($live) . '</b><span>live in the game</span></div>'
        . '<div class="card"><b>' . count($rejected) . '</b><span>rejected or taken out</span></div></div>';
    echo '<p class="mute">Players publish up to 5 puzzles each. New puzzles and every edit wait here first. &ldquo;Play-test&rdquo; opens the puzzle in the game with the creator&rsquo;s solution available; nothing you do there is saved. Keep those links private.</p>';
    echo '<h2>Waiting for approval</h2>';
    if (!$waiting) echo '<p class="mute">Nothing is waiting.</p>';
    foreach ($waiting as $rec) puzzle_card($rec, $rec['draft'], 'draft', 0, 0);
    echo '<h2>Live (the order players see)</h2>';
    if (!$live) echo '<p class="mute">No community puzzle is live yet.</p>';
    foreach ($live as $i => $rec) puzzle_card($rec, $rec['cur'], 'cur', $i, count($live));
    if ($removed) {
        echo '<h2>Removed by their creator (solutions kept)</h2>';
        foreach ($removed as $rec) puzzle_card($rec, $rec['cur'], 'gone', 0, 0);
    }
    echo '<h2>Rejected or taken out</h2>';
    if (!$rejected) echo '<p class="mute">None.</p>';
    foreach ($rejected as $rec) {
        echo '<div class="card" style="margin-bottom:8px"><b>Puzzle #' . sprintf('%04X', (int) $rec['id']) . '</b> by ' . h($rec['creator'] ?? '') . ' <span class="mute">&mdash; ' . h($rec['reason'] ?? '') . '</span> '
            . '<form method="post" action="admin.php" style="display:inline"><input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '"><input type="hidden" name="view" value="puzzles"><input type="hidden" name="id" value="' . (int) $rec['id'] . '"><button name="do" value="p_delete">Delete for good</button></form></div>';
    }
}

function dashboard() {
    $view = in_array($_GET['view'] ?? '', ['players', 'levels', 'scores', 'puzzles', 'log'], true) ? $_GET['view'] : 'players';
    $auto = !empty($_GET['auto']);
    $players = read_json('players.json');
    $now = time();
    $online = $today = $solves = 0;
    $dayStart = strtotime('today', $now);
    foreach ($players as $p) {
        if ($now - (int) $p['last'] < ONLINE_SECONDS) $online++;
        if ((int) $p['last'] >= $dayStart) $today++;
        $solves += (int) $p['solves'];
    }
    $byNet = [];
    foreach ($players as $p) {
        $byNet[$p['ip'] ?? ''][] = $p['id'];
    }

    page_head('Modern TIM admin', $auto);
    $stamp = new DateTime('@' . $now);
    $stamp->setTimezone(new DateTimeZone(DISPLAY_TZ));
    echo '<main><header><h1>Modern TIM admin</h1><div class="stamp"><span id="clock" class="mono"></span><br><span class="mute">Page built ' . h($stamp->format('H:i:s T')) . '</span><br><span class="mute">Dashboard v' . h(ADMIN_BUILD) . '</span></div><nav>';
    echo '<a class="btn" href="' . h($_SERVER['REQUEST_URI'] ?? 'admin.php') . '" title="Load the newest data">&#8635; Refresh</a>';
    foreach (['players' => 'Players', 'levels' => 'Levels', 'scores' => 'High scores', 'puzzles' => 'Puzzles', 'log' => 'Log'] as $k => $label) {
        echo '<a class="' . ($view === $k ? 'on' : '') . '" href="admin.php?view=' . $k . ($auto ? '&amp;auto=1' : '') . '">' . $label . '</a>';
    }
    echo '<a href="admin.php?view=' . h($view) . ($auto ? '' : '&amp;auto=1') . '">' . ($auto ? 'Auto-refresh: on' : 'Auto-refresh: off') . '</a>'
        . '<a href="admin.php?api=export">Export JSON</a>'
        . '<form method="post" action="admin.php" style="display:inline"><input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '"><button name="do" value="logout">Sign out</button></form>'
        . '</nav></header>';
    echo '<script nonce="' . h($GLOBALS['tim_nonce']) . '">(function(){var c=document.getElementById("clock");function t(){c.textContent=new Date().toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});}t();setInterval(t,1000);})();</script>';

    echo '<div class="cards">'
        . '<div class="card"><b>' . $online . '</b><span>online now (last 5 min)</span></div>'
        . '<div class="card"><b>' . $today . '</b><span>players today</span></div>'
        . '<div class="card"><b>' . count($players) . '</b><span>devices ever seen</span></div>'
        . '<div class="card"><b>' . $solves . '</b><span>puzzles solved in total</span></div></div>';

    if ($view === 'players') {
        uasort($players, function ($a, $b) {
                return ($b['last'] ?? 0) <=> ($a['last'] ?? 0);
            });
        echo '<h2>Players</h2><div class="wrap"><table><tr><th>Name</th><th>Device id</th><th>Device</th><th>Visits</th><th>Plays</th><th>Solved</th><th>Stars</th><th>Version</th><th>First seen</th><th>Last seen</th></tr>';
        $starsByName = star_counts();
        $maxStars = count(LEVEL_NAMES) * count(BOARDS);
        foreach ($players as $p) {
            $on = $now - (int) $p['last'] < ONLINE_SECONDS;
            $mine = [];
            foreach (array_merge([(string) ($p['name'] ?? '')], (array) ($p['names'] ?? [])) as $nm) {
                if ($nm !== '') $mine[mb_strtolower((string) $nm)] = true;
            }
            $stars = 0;
            foreach (array_keys($mine) as $k) $stars += $starsByName[(string) $k] ?? 0;
            $others = count($byNet[$p['ip'] ?? ''] ?? []) - 1;
            $names = array_filter($p['names'] ?? [], function ($n) use ($p) {
                return $n !== ($p['name'] ?? '');
            });
            $ua = $p['ua'] ?? ['os' => '?', 'browser' => '?', 'kind' => '?'];
            echo '<tr><td><span class="dot ' . ($on ? 'on' : '') . '"></span><b>' . h($p['name'] ?: '(no name yet)') . '</b>'
                . ($names ? ' <span class="mute">also: ' . h(implode(', ', $names)) . '</span>' : '') . '</td>'
                . '<td class="mono"><a href="admin.php?view=log&amp;id=' . h($p['id']) . '">' . h(short_id($p['id'])) . '</a>'
                . ($others > 0 ? ' <span class="mute" title="Other devices seen on the same network">+' . $others . ' on same network</span>' : '') . '</td>'
                . '<td>' . h($ua['browser'] . ' / ' . $ua['os'] . ' (' . $ua['kind'] . ')') . '</td>'
                . '<td>' . (int) $p['visits'] . '</td><td>' . (int) $p['plays'] . '</td><td>' . (int) $p['solves'] . '</td>'
                . '<td title="Boards where this player holds or ties number one, out of ' . $maxStars . '">' . ($stars > 0 ? '<b>★ ' . $stars . '</b>' : '<span class="mute">0</span>') . '</td>'
                . '<td>' . h($p['version'] ?? '') . '</td><td>' . h(fmt_time((int) $p['first'])) . '</td>'
                . '<td title="' . h(fmt_time((int) $p['last'])) . '">' . h(ago((int) $p['last'])) . '</td></tr>';
        }
        if (!$players) echo '<tr><td colspan="10" class="mute">Nobody yet.</td></tr>';
        echo '</table></div><p class="mute">Times are ' . h(DISPLAY_TZ) . '. Green dot = seen in the last 5 minutes. Stars = community boards where the player holds or ties number one (counted by name, from all the names the device used).</p>';
    } elseif ($view === 'levels') {
        $lv = [];
        foreach ($players as $p) {
            foreach (($p['levels'] ?? []) as $id => $l) {
                $r = $lv[$id] ?? ['players' => 0, 'opens' => 0, 'plays' => 0, 'solved_by' => 0, 'solves' => 0, 'best' => null];
                $r['players']++;
                $r['opens'] += (int) $l['opens'];
                $r['plays'] += (int) $l['plays'];
                $r['solves'] += (int) $l['solves'];
                if ((int) $l['solves'] > 0) $r['solved_by']++;
                if ($l['best'] !== null && ($r['best'] === null || $l['best'] < $r['best'])) $r['best'] = $l['best'];
                $lv[$id] = $r;
            }
        }
        ksort($lv);
        echo '<h2>Levels</h2><div class="wrap"><table><tr><th>Level</th><th>Players</th><th>Opened</th><th>Start pressed</th><th>Players who solved</th><th>Solves</th><th>Fastest solve</th></tr>';
        foreach ($lv as $id => $r) {
            echo '<tr><td><b>' . h($id) . '</b></td><td>' . $r['players'] . '</td><td>' . $r['opens'] . '</td><td>' . $r['plays'] . '</td><td>'
                . $r['solved_by'] . ' (' . ($r['players'] ? round(100 * $r['solved_by'] / $r['players']) : 0) . '%)</td><td>' . $r['solves'] . '</td><td>'
                . ($r['best'] === null ? '-' : h($r['best']) . ' s') . '</td></tr>';
        }
        if (!$lv) echo '<tr><td colspan="7" class="mute">No level activity yet.</td></tr>';
        echo '</table></div><p class="mute">Many "Start pressed" with few solves means a level is hard or confusing.</p>';
    } elseif ($view === 'puzzles') {
        puzzles_view();
    } elseif ($view === 'scores') {
        scores_view();
    } else {
        $filter = ['id' => preg_replace('/[^a-f0-9.]/', '', (string) ($_GET['id'] ?? '')) ?? '', 'ev' => in_array($_GET['ev'] ?? '', EVENTS, true) ? $_GET['ev'] : '', 'q' => clean($_GET['q'] ?? '', 30)];
        $rows = read_log(300, $filter);
        echo '<h2>Log</h2><form class="inline" method="get" action="admin.php"><input type="hidden" name="view" value="log">'
            . '<input type="text" name="q" placeholder="Name or level" value="' . h($filter['q']) . '"><select name="ev"><option value="">All events</option>';
        foreach (array_merge(EVENTS, ['admin_login', 'admin_fail']) as $e) {
            echo '<option' . ($filter['ev'] === $e ? ' selected' : '') . '>' . h($e) . '</option>';
        }
        echo '</select><input type="text" name="id" placeholder="Device id" value="' . h($filter['id']) . '" class="mono"><button>Filter</button><a class="btn" href="admin.php?view=log">Clear</a></form>';
        echo '<div class="wrap"><table><tr><th>When</th><th>Event</th><th>Name</th><th>Device</th><th>Level</th><th>Details</th></tr>';
        foreach ($rows as $e) {
            $det = [];
            if (isset($e['seconds'])) $det[] = $e['seconds'] . ' s';
            if (!empty($e['from'])) $det[] = 'was ' . $e['from'];
            if (!empty($e['v'])) $det[] = 'v' . $e['v'];
            echo '<tr><td>' . h(fmt_time((int) $e['t'])) . '</td><td>' . h($e['ev'] ?? '') . '</td><td>' . h($e['name'] ?? '') . '</td><td class="mono">'
                . (!empty($e['id']) ? h(short_id($e['id'])) : '-') . '</td><td>' . h($e['level'] ?? '') . '</td><td class="mute">' . h(implode(', ', $det)) . '</td></tr>';
        }
        if (!$rows) echo '<tr><td colspan="6" class="mute">No matching events.</td></tr>';
        echo '</table></div><p class="mute">Newest first, up to 300 rows. The file rotates at about 1.5 MB.</p>';
    }
    echo '</main></body></html>';
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

no_cache_headers();

if (($_GET['api'] ?? '') === 'track') {
    api_track();
    exit;
}

start_session();

if (($_GET['diag'] ?? '') === '1') {
    // Open to anyone: it only reports whether this browser and the server keep a session, nothing private.
    $path = (string) session_save_path();
    $rows = [
        'Admin build' => ADMIN_BUILD,
        'PHP version' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
        'Session started' => !empty($GLOBALS['tim_session_ok']) ? 'yes' : 'NO (the server cannot start sessions)',
        'Session folder writable' => $path === '' ? 'default folder' : (is_writable($path) ? 'yes' : 'NO'),
        'Your browser sent the session cookie' => isset($_COOKIE['timadmin']) ? 'yes' : 'no (normal on the very first visit; reload this page once)',
        'Server sees HTTPS' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'yes' : 'no',
        'Page cache header sent' => 'X-LiteSpeed-Cache-Control: no-cache',
        'Server time' => (new DateTime('now', new DateTimeZone(DISPLAY_TZ)))->format('Y-m-d H:i:s T'),
    ];
    page_head('Modern TIM admin: connection check');
    echo '<div class="login" style="max-width:520px"><h1>Connection check</h1><table>';
    foreach ($rows as $k => $v) {
        echo '<tr><td>' . h($k) . '</td><td><b>' . h($v) . '</b></td></tr>';
    }
    echo '</table><p class="mute">Reload this page: the cookie line should say yes the second time. <a href="admin.php">Back to sign in</a></p></div></body></html>';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $ok = hash_equals($_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''));
    $do = $_POST['do'] ?? '';
    if ($ok && $do === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: admin.php');
        exit;
    }
    if ($ok && $do === 'login') {
        $iph = ip_hash();
        $wait = locked_out($iph);
        if ($wait > 0) {
            login_page('Too many tries. Wait ' . ceil($wait / 60) . ' minutes.');
            exit;
        }
        if (password_verify((string) ($_POST['password'] ?? ''), ADMIN_HASH)) {
            session_regenerate_id(true);
            $_SESSION['admin'] = time();
            log_event(['t' => time(), 'id' => '', 'name' => '', 'ev' => 'admin_login', 'level' => '', 'ip' => $iph]);
            // A one-off address, so no page cache can answer it with an old copy of the login page.
            header('Location: admin.php?go=' . time() . bin2hex(random_bytes(2)) . '&view=' . urlencode((string) ($_POST['view'] ?? 'players')));
            exit;
        }
        note_failure($iph);
        log_event(['t' => time(), 'id' => '', 'name' => '', 'ev' => 'admin_fail', 'level' => '', 'ip' => $iph]);
        usleep(400000);
        login_page('Wrong password.');
        exit;
    }
    if ($do === 'login' && !$ok) {
        login_page('Your session was lost before you signed in. Reload this page and try again (the connection check below shows why).');
        exit;
    }
    if ($ok && is_admin() && strncmp((string) $do, 'p_', 2) === 0) {
        puzzle_action($_POST);
        header('Location: admin.php?view=puzzles');
        exit;
    }
    header('Location: admin.php');
    exit;
}

if (!is_admin()) {
    if (isset($_GET['go'])) {
        // We only get here straight after a correct password, so the session did not survive the redirect.
        login_page('The password was right, but this server did not keep your sign-in. Open the connection check below and tell me what it says.');
    } else {
        login_page('');
    }
    exit;
}

if (isset($_GET['pshot'])) {
    $p = puzzle_shot_file((string) $_GET['pshot']);
    if ($p === '') {
        http_response_code(404);
        exit;
    }
    no_cache_headers();
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($p));
    readfile($p);
    exit;
}

if (isset($_GET['shot'])) {
    $f = (string) $_GET['shot'];
    $p = shot_path($f);
    if ($p === '') {
        http_response_code(404);
        exit;
    }
    no_cache_headers();
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($p));
    readfile($p);
    exit;
}

if (($_GET['api'] ?? '') === 'export') {
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="modern-tim-players.json"');
    echo json_encode(array_values(read_json('players.json')), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

dashboard();
