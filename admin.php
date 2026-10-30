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
const DISPLAY_TZ = 'America/Vancouver';
/** Shown on the login page so you can tell which copy of this file the server is running. */
// Keep this equal to VERSION in modern-tim/src/game/version.ts (npm run check-versions fails when they differ).
const ADMIN_BUILD = '0.4q';
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
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" . $GLOBALS['tim_nonce'] . "'; form-action 'self'; frame-ancestors 'none'");
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">';
    if ($refresh) {
        echo '<meta http-equiv="refresh" content="30">';
    }
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
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--line);margin-right:6px}.dot.on{background:var(--ok)}
.mute{color:var(--mute)}.mono{font-family:ui-monospace,monospace;font-size:13px}a{color:var(--acc)}
input[type=password],input[type=text],select{padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
.login{max-width:340px;margin:12vh auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.err{color:var(--bad)}form.inline{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
</style></head><body>';
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
    if ($category === 'shortest') return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.') . ' m';
    if ($category === 'fastest') return number_format($n, 1, '.', '') . ' s';
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

/** A plain link to the screenshot (served by this page only after sign-in). */
function shot_cell($file): string {
    $file = (string) $file;
    if (!preg_match('/^[0-9]{8}-[0-9]{6}-[a-z0-9]+-[a-f0-9]{6}\.jpg$/', $file) || !is_file(DATA_DIR . '/shots/' . $file)) {
        return '<span class="mute">-</span>';
    }
    $u = 'admin.php?shot=' . rawurlencode($file);
    return '<a href="' . h($u) . '" target="_blank" rel="noopener">View</a>';
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
    $now = (string) ($_GET['now'] ?? '');
    $now = in_array($now, ['top', 'tied', 'beaten'], true) ? $now : '';
    $boardsNow = read_boards();
    $rows = read_records(100000, $level, $cat);
    $names = [];
    foreach (read_records(100000, '', '') as $e) $names[mb_strtolower((string) $e['name'])] = (string) $e['name'];
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
    if ($now !== '') {
        $rows = array_values(array_filter($rows, function ($e) use ($boardsNow, $now) {
            $s = standing($boardsNow, (string) $e['level'], (string) $e['category'], (string) $e['name']);
            return $now === 'top' ? $s === '#1' : ($now === 'tied' ? $s === 'Tied #1' : $s === '');
        }));
    }
    $rows = array_slice($rows, 0, 300);
    $all = read_records(100000, '', '');
    $weekAgo = time() - 7 * 86400;
    $week = count(array_filter($all, function ($e) use ($weekAgo) {
        return (int) $e['t'] >= $weekAgo;
    }));

    $intro = '<h2>Records broken</h2><p class="mute">One line each time a run beats the old number one on a board. Ties and first scores are not listed. <b>Now</b> says whether the player is still number one (or tied for it) on the community board. '
        . '<b>' . count($all) . '</b> broken in total, <b>' . $week . '</b> in the last 7 days.</p>';
    echo '<form class="inline" method="get" action="admin.php"><input type="hidden" name="view" value="scores"><select name="level"><option value="">All levels</option>';
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
    echo '</select><select name="now">';
    foreach (['' => 'Any Now', 'top' => '#1', 'tied' => 'Tied #1', 'beaten' => 'Beaten'] as $v => $label) {
        echo '<option value="' . h($v) . '"' . ($now === $v ? ' selected' : '') . '>' . h($label) . '</option>';
    }
    echo '</select><button>Filter</button><a class="btn" href="admin.php?view=scores">Clear</a></form>';
    ob_start();   // the three tables are built in this order but shown as: community boards, refused scores, records broken
    echo $intro;
    echo '<div class="wrap"><table><tr><th>When</th><th>Level</th><th>Board</th><th>Score</th><th>Now</th><th>Version</th><th>Screenshot</th><th>Beat</th><th>By how much</th></tr>';
    foreach ($rows as $e) {
        $c = (string) $e['category'];
        $now = standing($boardsNow, (string) $e['level'], $c, (string) $e['name']);
        $gain = isset($e['prevValue']) ? abs((float) $e['value'] - (float) $e['prevValue']) : null;
        $same = isset($e['prevName']) && mb_strtolower((string) $e['prevName']) === mb_strtolower((string) $e['name']);
        echo '<tr><td title="' . h(fmt_time((int) $e['t'])) . '">' . h(fmt_time((int) $e['t'])) . ' <span class="mute">(' . h(ago((int) $e['t'])) . ')</span></td>'
            . '<td><b>' . h(level_label((string) $e['level'])) . '</b></td><td>' . h(BOARDS[$c] ?? $c) . '</td>'
            . '<td><b>' . h($e['name']) . '</b> ' . h(format_score($c, $e['value'])) . '</td>'
            . '<td>' . ($now === '' ? '<span class="mute">Beaten</span>' : '<b>' . h($now) . '</b>') . '</td>'
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
    $boards = read_boards();
    $log = read_records(100000, '', '');
    echo '<h2>Current community boards</h2><div class="wrap"><table><tr><th>Level</th>';
    foreach (BOARDS as $label) echo '<th>' . h($label) . '</th>';
    echo '</tr>';
    foreach (LEVEL_NAMES as $id => $label) {
        if ($level !== '' && $level !== $id) continue;
        if ($player !== '') {
            $has = false;
            foreach (BOARDS as $c => $_) {
                foreach (is_array($boards[$id][$c] ?? null) ? $boards[$id][$c] : [] as $row) {
                    if (is_array($row) && isset($row['name']) && mb_strtolower((string) $row['name']) === $player) $has = true;
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
                if (!is_array($row) || !isset($row['name'], $row['value'])) continue;
                if ($player !== '' && mb_strtolower((string) $row['name']) !== $player) continue;
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
    echo '</table></div><p class="mute">Top 5 per board, one row per name, with the game version and the date and time each entry was logged. Bold = number one, including everyone tied on it (one star each). <b>View</b> on the record holder line is the screenshot of the run that set the record; it is replaced, and the old picture deleted, when someone beats it, and it stays empty (-) until a record is broken from the game. <b>Level v</b> is the game version the level was last changed in; changing it clears that level\'s boards.</p>';
    echo ob_get_clean() . $refusedHtml . $recordsHtml;
}

function dashboard() {
    $view = in_array($_GET['view'] ?? '', ['players', 'levels', 'scores', 'log'], true) ? $_GET['view'] : 'players';
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
    foreach (['players' => 'Players', 'levels' => 'Levels', 'scores' => 'High scores', 'log' => 'Log'] as $k => $label) {
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

if (isset($_GET['shot'])) {
    $f = (string) $_GET['shot'];
    $p = DATA_DIR . '/shots/' . $f;
    if (!preg_match('/^[0-9]{8}-[0-9]{6}-[a-z0-9]+-[a-f0-9]{6}\.jpg$/', $f) || !is_file($p)) {
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
