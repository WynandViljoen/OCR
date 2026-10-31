<?php
/**
 * Modern TIM: share a Sandbox build by a short link.
 *
 * Put this file in the same web folder as index.html (public_html/ocr/).
 *
 *   POST share.php   (JSON body)  { title, author, version, parts: [...] }
 *                                 -> { code }            e.g. index.html?s=K7xP2mQa
 *   GET  share.php?c=K7xP2mQa     -> { title, author, version, at, parts: [...] }
 *
 * Builds are kept as small JSON files in tim-data/shares/ (closed to the web by .htaccess).
 * Nothing the player sends is stored as is: the part list is rebuilt from known part types
 * and numbers only, so a link can never carry script or odd data.
 *
 * The same file also serves the community puzzles (so the cron job needs no new file): see the "Community
 * puzzles" section below. GET share.php?puzzle=list|get|mine, and POST bodies with an `action`. Limits: 64 KB per build,
 * 300 parts, 20 new links per hour per visitor (a salted hash of the address, never the
 * address itself), and 20000 links in total.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
// Some hosts and CDNs keep their own copy; these tell them (LiteSpeed, Cloudflare, Varnish) not to.
header('X-LiteSpeed-Cache-Control: no-cache');
header('CDN-Cache-Control: no-store');
header('Surrogate-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PART_TYPES = ['ball', 'heavyBall', 'plank', 'wall', 'basket', 'conveyor', 'spring', 'domino', 'seesaw', 'wheel', 'motorGear', 'gear', 'bigGear', 'paddleGear', 'mouse', 'string', 'crate', 'pulley', 'rope'];
const MAX_BODY = 65536;
const MAX_PARTS = 300;
const MAX_TITLE = 24;
const MAX_AUTHOR = 16;
const MAX_PER_HOUR = 20;
const MAX_SHARES = 20000;
const CODE_LENGTH = 8;
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DATA_DIR = __DIR__ . '/tim-data';
const SHARE_DIR = DATA_DIR . '/shares';
const MAX_PUZZLE_BODY = 400000;
const MAX_PUZZLE_TITLE = 28;
const MAX_PUZZLE_PARTS = 120;
const MAX_PUZZLES_PER_DEVICE = 5;
const MAX_PUZZLES_TOTAL = 3000;
const MAX_PUZZLE_SHOT = 250000;
const PUZZLE_FILE = DATA_DIR . '/puzzles.json';
const PUZZLE_SHOT_DIR = DATA_DIR . '/puzzle-shots';

function fail(int $code, string $message) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

function ensure_dirs() {
    foreach ([DATA_DIR, SHARE_DIR] as $d) {
        if (!is_dir($d)) {
            @mkdir($d, 0750, true);
        }
    }
    foreach (['.htaccess' => "Require all denied\nDeny from all\n", 'index.html' => ''] as $f => $c) {
        if (!file_exists(DATA_DIR . '/' . $f)) {
            @file_put_contents(DATA_DIR . '/' . $f, $c);
        }
    }
}

function clean_text($raw, int $max): string {
    $s = is_string($raw) || is_numeric($raw) ? (string) $raw : '';
    $s = preg_replace('/[\x00-\x1f\x7f<>]/u', ' ', $s) ?? '';
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    return trim(mb_substr($s, 0, $max));
}

function num($v, float $min, float $max) {
    if (!is_int($v) && !is_float($v)) return null;
    $f = (float) $v;
    if (!is_finite($f) || $f < $min || $f > $max) return null;
    return round($f, 3);
}

/** Rebuild one part from known fields only. Returns null if it is not a usable part. */
function clean_part($p) {
    if (!is_array($p) || !isset($p['type']) || !in_array($p['type'], PART_TYPES, true)) return null;
    $id = isset($p['id']) && is_int($p['id']) && $p['id'] >= 0 && $p['id'] < 100000 ? $p['id'] : null;
    if ($id === null) return null;
    $x = num($p['x'] ?? null, -200, 1200);
    $y = num($p['y'] ?? null, -200, 900);
    $angle = num($p['angle'] ?? 0, -100, 100);
    if ($x === null || $y === null || $angle === null) return null;
    $out = ['id' => $id, 'type' => $p['type'], 'x' => $x, 'y' => $y, 'angle' => $angle];
    foreach (['w' => 1200, 'h' => 1200] as $k => $max) {
        if (isset($p[$k])) {
            $v = num($p[$k], 1, $max);
            if ($v === null) return null;
            $out[$k] = $v;
        }
    }
    if (isset($p['power'])) {
        $v = num($p['power'], 1, 3);
        if ($v === null) return null;
        $out['power'] = (int) round($v);
    }
    if (!empty($p['flip'])) {
        $out['flip'] = true;
    }
    if (!empty($p['fixed'])) {
        $out['fixed'] = true;
    }
    if (isset($p['props'])) {
        if (!is_array($p['props']) || count($p['props']) > 12) return null;
        $props = [];
        foreach ($p['props'] as $k => $v) {
            $n = is_string($k) && preg_match('/^[A-Za-z]{1,16}$/', $k) ? num($v, -1000000, 1000000) : null;
            if ($n === null) return null;
            $props[$k] = $n;
        }
        if ($props) $out['props'] = $props;
    }
    if (isset($p['link'])) {
        $l = $p['link'];
        if (!is_array($l) || !isset($l['a'], $l['b']) || !is_int($l['a']) || !is_int($l['b'])) return null;
        $link = ['a' => $l['a'], 'b' => $l['b']];
        if (isset($l['via'])) {
            if (!is_int($l['via'])) return null;
            $link['via'] = $l['via'];
        }
        $out['link'] = $link;
    }
    return $out;
}

function new_code(): string {
    $n = strlen(CODE_ALPHABET);
    for ($try = 0; $try < 20; $try++) {
        $code = '';
        for ($i = 0; $i < CODE_LENGTH; $i++) {
            $code .= CODE_ALPHABET[random_int(0, $n - 1)];
        }
        if (!file_exists(SHARE_DIR . '/' . $code . '.json')) return $code;
    }
    fail(500, 'Could not make a link. Try again.');
    return '';
}

function secret(): string {
    $p = DATA_DIR . '/secret.key';
    if (!file_exists($p)) {
        @file_put_contents($p, bin2hex(random_bytes(32)), LOCK_EX);
    }
    return (string) @file_get_contents($p);
}

/** True when this visitor has made too many links in the last hour. Counts this call. */
function rate_limited(): bool {
    $key = substr(hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''), secret()), 0, 12);
    $fh = @fopen(DATA_DIR . '/share-rate.json', 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) return false;
    $raw = stream_get_contents($fh);
    $all = $raw ? json_decode($raw, true) : [];
    $all = is_array($all) ? $all : [];
    $now = time();
    foreach ($all as $k => $times) {
        $all[$k] = array_values(array_filter(is_array($times) ? $times : [], function ($t) use ($now) {
            return is_int($t) && $now - $t < 3600;
        }));
        if (!$all[$k]) unset($all[$k]);
    }
    $limited = count($all[$key] ?? []) >= MAX_PER_HOUR;
    if (!$limited) $all[$key][] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($all));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $limited;
}


// ---------------------------------------------------------------------------
// Community puzzles
//
// A player builds a puzzle in the Sandbox (fixed parts + the parts of their own solution) and publishes it. It
// waits in the admin dashboard (admin.php?view=puzzles) until it is approved. Players then see the puzzle's fixed
// parts and a tray made from the solution's parts; the solution itself never leaves the server except to the
// creator and to the admin's preview. One browser (its device id, not the name) has at most 5 puzzles that are
// waiting or live; a rejected one does not count. Everything is kept in tim-data/puzzles.json:
//   { next, order: [live ids, in the order players see them], puzzles: { id: record } }
//   record: { id, device, creator, cur: version|null (live), draft: version|null (waiting), reason, difficulty,
//             at, done: {device: time}, votes: {device: 1|-1} }
//   version: { title, fixed: [part], solution: [part], shot, rev, at }
// admin.php reads and writes the same file under the same lock.
// ---------------------------------------------------------------------------

function valid_device($d): bool {
    return is_string($d) && preg_match('/^[a-f0-9]{16}\.[a-f0-9]{12}$/', $d) === 1;
}

/** Run $fn(&$db) with the puzzle file locked; the file is rewritten when $fn returns true. Returns $fn's result. */
function puzzle_db(callable $fn, bool $write) {
    ensure_dirs();
    $fh = @fopen(PUZZLE_FILE, 'c+');
    if (!$fh || !flock($fh, $write ? LOCK_EX : LOCK_SH)) fail(500, 'Puzzles cannot be read here.');
    $raw = stream_get_contents($fh);
    $db = $raw ? json_decode($raw, true) : null;
    if (!is_array($db)) $db = [];
    $db += ['next' => 1, 'order' => [], 'puzzles' => []];
    if (!is_array($db['puzzles'])) $db['puzzles'] = [];
    if (!is_array($db['order'])) $db['order'] = [];
    $result = $fn($db);
    if ($write && $result !== false && $result !== null && !(is_array($result) && isset($result['error']))) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($db, JSON_UNESCAPED_UNICODE));
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $result;
}

function difficulty_label($d): string {
    if (!is_int($d) || $d < 1) return '';
    if ($d <= 3) return 'Easy';
    if ($d <= 6) return 'Medium';
    if ($d <= 8) return 'Hard';
    return 'Expert';
}

/** How many of each part type the player's tray holds: the creator's solution. */
function puzzle_inventory(array $solution): array {
    $inv = [];
    foreach ($solution as $p) {
        $t = (string) $p['type'];
        $inv[$t] = ($inv[$t] ?? 0) + 1;
    }
    return $inv;
}

function puzzle_public(array $rec, string $device = ''): array {
    $v = $rec['cur'];
    $up = $down = 0;
    foreach ((array) ($rec['votes'] ?? []) as $vote) {
        if ($vote === 1) $up++;
        elseif ($vote === -1) $down++;
    }
    $out = [
        'id' => (int) $rec['id'],
        'title' => (string) $v['title'],
        'creator' => (string) $rec['creator'],
        'rev' => (int) $v['rev'],
        'difficulty' => is_int($rec['difficulty'] ?? null) ? $rec['difficulty'] : null,
        'label' => difficulty_label($rec['difficulty'] ?? null),
        'parts' => count($v['fixed']) + count($v['solution']),
        'up' => $up,
        'down' => $down,
        'done' => count((array) ($rec['done'] ?? [])),
    ];
    if ($device !== '') {
        $out['mine'] = isset($rec['device']) && $rec['device'] === $device;
        $out['completed'] = isset($rec['done'][$device]);
        $out['vote'] = (int) ($rec['votes'][$device] ?? 0);
    }
    return $out;
}

/** Everything a game needs to play one version (no solution, unless $withSolution). */
function puzzle_play(array $rec, array $v, bool $withSolution): array {
    $out = [
        'id' => (int) $rec['id'],
        'title' => (string) $v['title'],
        'creator' => (string) $rec['creator'],
        'rev' => (int) $v['rev'],
        'difficulty' => is_int($rec['difficulty'] ?? null) ? $rec['difficulty'] : null,
        'label' => difficulty_label($rec['difficulty'] ?? null),
        'fixed' => $v['fixed'],
        'inventory' => puzzle_inventory($v['solution']),
    ];
    if ($withSolution) $out['solution'] = $v['solution'];
    return $out;
}

/** Check and rebuild the parts of a submitted puzzle. Returns [fixed, solution] or an error string. */
function clean_puzzle_parts($fixedIn, $solutionIn) {
    if (!is_array($fixedIn) || !is_array($solutionIn)) return 'The puzzle has no parts.';
    if (count($fixedIn) < 1) return 'Fix at least one part: the ball and the basket are part of the puzzle.';
    if (count($solutionIn) < 1) return 'The puzzle needs a solution: place the parts that solve it.';
    if (count($fixedIn) + count($solutionIn) > MAX_PUZZLE_PARTS) return 'That is too many parts for one puzzle.';
    $fixed = [];
    $solution = [];
    $ids = [];
    foreach ([[$fixedIn, 'fixed'], [$solutionIn, 'solution']] as $pair) {
        foreach ($pair[0] as $p) {
            $c = clean_part($p);
            if ($c === null) return 'The puzzle has a part that cannot be used.';
            if (isset($ids[$c['id']])) return 'The puzzle has two parts with the same number.';
            $ids[$c['id']] = true;
            unset($c['fixed']);
            if ($pair[1] === 'fixed') {
                if ($c['type'] === 'string' || $c['type'] === 'rope') return 'Strings and ropes cannot be fixed: players add them themselves.';
                $fixed[] = $c;
            } else {
                $solution[] = $c;
            }
        }
    }
    foreach (array_merge($fixed, $solution) as $c) {
        if (isset($c['link'])) {
            foreach (['a', 'b', 'via'] as $k) {
                if (isset($c['link'][$k]) && !isset($ids[$c['link'][$k]])) return 'A string or rope joins a part that is not in the puzzle.';
            }
        }
    }
    $balls = 0;
    $baskets = 0;
    $fixedBall = false;
    $fixedBasket = false;
    foreach ($fixed as $c) {
        if ($c['type'] === 'ball') { $balls++; $fixedBall = true; }
        if ($c['type'] === 'basket') { $baskets++; $fixedBasket = true; }
    }
    foreach ($solution as $c) {
        if ($c['type'] === 'ball') $balls++;
        if ($c['type'] === 'basket') $baskets++;
    }
    if ($balls !== 1 || !$fixedBall) return 'A puzzle needs exactly one ball, and it must be fixed.';
    if ($baskets !== 1 || !$fixedBasket) return 'A puzzle needs exactly one basket, and it must be fixed.';
    return [$fixed, $solution];
}

/** A fingerprint of a puzzle's parts (not their ids), to refuse the very same puzzle being sent twice. */
function puzzle_sig(array $fixed, array $solution): string {
    $one = function ($list) {
        $rows = [];
        foreach ($list as $p) {
            $rows[] = implode(',', [$p['type'], round((float) $p['x'], 1), round((float) $p['y'], 1), round((float) $p['angle'], 3), $p['w'] ?? '', $p['h'] ?? '', !empty($p['flip']) ? 1 : 0]);
        }
        sort($rows);
        return $rows;
    };
    return md5(json_encode([$one($fixed), $one($solution)]));
}

function save_puzzle_shot(string $dataUrl, int $id): string {
    if (strncmp($dataUrl, 'data:image/jpeg;base64,', 23) !== 0) return '';
    $bin = base64_decode(substr($dataUrl, 23), true);
    if ($bin === false || strlen($bin) < 200 || strlen($bin) > MAX_PUZZLE_SHOT || strncmp($bin, "\xFF\xD8\xFF", 3) !== 0) return '';
    if (!is_dir(PUZZLE_SHOT_DIR)) @mkdir(PUZZLE_SHOT_DIR, 0750, true);
    $name = 'p' . $id . '-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(2)) . '.jpg';
    if (@file_put_contents(PUZZLE_SHOT_DIR . '/' . $name, $bin) === false) return '';
    return $name;
}

function drop_puzzle_shot($name) {
    if (is_string($name) && preg_match('/^p[0-9]+-[0-9]{14}-[a-f0-9]{4}\.jpg$/', $name)) @unlink(PUZZLE_SHOT_DIR . '/' . $name);
}

function puzzle_preview_ok(): bool {
    $p = DATA_DIR . '/preview.key';
    $k = is_file($p) ? trim((string) @file_get_contents($p)) : '';
    return $k !== '' && isset($_GET['preview']) && hash_equals($k, (string) $_GET['preview']);
}

function puzzle_get_api() {
    $what = (string) $_GET['puzzle'];
    $device = isset($_GET['device']) && valid_device($_GET['device']) ? (string) $_GET['device'] : '';
    if ($what === 'list') {
        $list = puzzle_db(function (&$db) use ($device) {
            $out = [];
            foreach ($db['order'] as $id) {
                $rec = $db['puzzles'][$id] ?? null;
                if (is_array($rec) && is_array($rec['cur'] ?? null)) $out[] = puzzle_public($rec, $device);
            }
            return $out;
        }, false);
        echo json_encode(['puzzles' => $list]);
        exit;
    }
    if ($what === 'get') {
        $id = (int) ($_GET['id'] ?? 0);
        $preview = puzzle_preview_ok();
        if (isset($_GET['preview']) && !$preview) fail(403, 'That preview link is not valid.');
        $version = (string) ($_GET['version'] ?? 'cur');
        $res = puzzle_db(function (&$db) use ($id, $preview, $version) {
            $rec = $db['puzzles'][$id] ?? null;
            if (!is_array($rec)) return null;
            if ($preview) {
                $v = $version === 'draft' ? ($rec['draft'] ?? null) : ($rec['cur'] ?? null);
                return is_array($v) ? puzzle_play($rec, $v, true) : null;
            }
            return (is_array($rec['cur'] ?? null) && empty($rec['gone'])) ? puzzle_play($rec, $rec['cur'], false) : null;
        }, false);
        if ($res === null) fail(404, 'That puzzle is not available.');
        echo json_encode($res);
        exit;
    }
    if ($what === 'mine') {
        if ($device === '') fail(400, 'No device id yet.');
        $res = puzzle_db(function (&$db) use ($device) {
            $out = [];
            foreach ($db['puzzles'] as $rec) {
                if (!is_array($rec) || !empty($rec['gone']) || ($rec['device'] ?? '') !== $device) continue;
                $v = is_array($rec['draft'] ?? null) ? $rec['draft'] : $rec['cur'];
                if (!is_array($v)) {
                    $v = ['title' => '', 'fixed' => [], 'solution' => []];
                }
                $status = is_array($rec['draft'] ?? null) ? (is_array($rec['cur'] ?? null) ? 'live-edit' : 'pending') : (is_array($rec['cur'] ?? null) ? 'live' : 'rejected');
                $out[] = ['id' => (int) $rec['id'], 'status' => $status, 'reason' => (string) ($rec['reason'] ?? ''), 'title' => (string) $v['title'], 'fixed' => $v['fixed'], 'solution' => $v['solution'], 'difficulty' => $rec['difficulty'] ?? null];
            }
            return $out;
        }, false);
        echo json_encode(['puzzles' => $res, 'slots' => MAX_PUZZLES_PER_DEVICE]);
        exit;
    }
    fail(400, 'Unknown request.');
}

function puzzle_post_api(array $in) {
    // A crash must come back as a readable sentence, not an empty page.
    @ini_set('display_errors', '0');
    register_shutdown_function(function () {
        $e = error_get_last();
        if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR], true)) {
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
            }
            echo json_encode(['error' => 'Server problem: ' . substr((string) $e['message'], 0, 140) . ' (' . basename((string) $e['file']) . ':' . (int) $e['line'] . ')']);
        }
    });
    $action = (string) $in['action'];
    $device = $in['device'] ?? '';
    if (!valid_device($device)) fail(400, 'This browser has no id yet. Reload the game and try again.');
    $device = (string) $device;
    $id = isset($in['id']) && is_int($in['id']) ? $in['id'] : 0;

    if ($action === 'submit') {
        $creator = clean_text($in['creator'] ?? '', MAX_AUTHOR);
        if ($creator === '') fail(400, 'A player name is needed to publish.');
        $title = clean_text($in['title'] ?? '', MAX_PUZZLE_TITLE);
        if ($title === '') fail(400, 'Give the puzzle a name.');
        $clean = clean_puzzle_parts($in['fixed'] ?? null, $in['solution'] ?? null);
        if (is_string($clean)) fail(400, $clean);
        if (rate_limited()) fail(429, 'You have sent a lot just now. Please wait a little and try again.');
        $shotIn = is_string($in['shot'] ?? null) ? $in['shot'] : '';
        $seconds = isset($in['seconds']) && is_numeric($in['seconds']) ? max(0.0, min(30.0, round((float) $in['seconds'], 1))) : 0.0;
        $res = puzzle_db(function (&$db) use ($device, $creator, $title, $clean, $shotIn, $seconds, $id) {
            $mineCount = 0;
            foreach ($db['puzzles'] as $rec) {
                if (is_array($rec) && empty($rec['gone']) && ($rec['device'] ?? '') === $device && $rec['id'] !== $id && (is_array($rec['cur'] ?? null) || is_array($rec['draft'] ?? null))) $mineCount++;
            }
            $rec = null;
            if ($id > 0) {
                $rec = $db['puzzles'][$id] ?? null;
                if (!is_array($rec) || !empty($rec['gone']) || ($rec['device'] ?? '') !== $device) return ['error' => 'That puzzle is not yours or was removed.', 'code' => 403];
            }
            $sig = puzzle_sig($clean[0], $clean[1]);
            foreach ($db['puzzles'] as $other) {
                if (!is_array($other) || !empty($other['gone']) || ($other['device'] ?? '') !== $device) continue;
                foreach (['cur', 'draft'] as $k) {
                    if (is_array($other[$k] ?? null) && puzzle_sig($other[$k]['fixed'], $other[$k]['solution']) === $sig) {
                        return ['error' => 'You already sent this puzzle. Change something before sending it again.', 'code' => 409, 'dup' => (int) $other['id']];
                    }
                }
            }
            if ($mineCount >= MAX_PUZZLES_PER_DEVICE) return ['error' => 'You already have ' . MAX_PUZZLES_PER_DEVICE . ' puzzles waiting or live. Withdraw one to make room.', 'code' => 409];
            if ($rec === null) {
                if (count($db['puzzles']) >= MAX_PUZZLES_TOTAL) return ['error' => 'There is no room for more puzzles right now.', 'code' => 503];
                $newId = (int) $db['next'];
                $db['next'] = $newId + 1;
                $rec = ['id' => $newId, 'device' => $device, 'creator' => $creator, 'cur' => null, 'draft' => null, 'reason' => '', 'difficulty' => null, 'at' => time(), 'done' => [], 'votes' => []];
            } else {
                drop_puzzle_shot($rec['draft']['shot'] ?? '');
                $rec['creator'] = $creator;
            }
            $shot = save_puzzle_shot($shotIn, (int) $rec['id']);
            $rev = (int) ($rec['cur']['rev'] ?? 0) + 1;
            if (is_array($rec['draft'] ?? null)) $rev = max($rev, (int) $rec['draft']['rev']);
            $rec['draft'] = ['title' => $title, 'fixed' => $clean[0], 'solution' => $clean[1], 'shot' => $shot, 'seconds' => $seconds, 'rev' => $rev, 'at' => time()];
            $rec['reason'] = '';
            $db['puzzles'][$rec['id']] = $rec;
            return ['id' => (int) $rec['id'], 'status' => is_array($rec['cur'] ?? null) ? 'live-edit' : 'pending'];
        }, true);
        if (isset($res['error'])) {
            if (isset($res['dup'])) {
                http_response_code(409);
                echo json_encode(['error' => (string) $res['error'], 'dup' => (int) $res['dup']]);
                exit;
            }
            fail((int) $res['code'], (string) $res['error']);
        }
        echo json_encode($res);
        exit;
    }

    if ($action === 'withdraw') {
        $res = puzzle_db(function (&$db) use ($device, $id) {
            $rec = $db['puzzles'][$id] ?? null;
            if (!is_array($rec) || !empty($rec['gone'])) return ['error' => 'That puzzle no longer exists on the server. Close this window and open it again.', 'code' => 404];
            if (($rec['device'] ?? '') !== $device) return ['error' => 'That puzzle was sent from another browser (its id ends ' . substr((string) ($rec['device'] ?? ''), -4) . ', this browser ends ' . substr($device, -4) . ').', 'code' => 403];
            drop_puzzle_shot($rec['draft']['shot'] ?? '');
            if (is_array($rec['cur'] ?? null)) {
                // It was approved once: the player takes it out of the game, but the admin keeps the puzzle, its
                // solution and its screenshot (the dashboard lists it as removed by its creator).
                $rec['draft'] = null;
                $rec['gone'] = time();
                $db['puzzles'][$id] = $rec;
            } else {
                drop_puzzle_shot($rec['cur']['shot'] ?? '');
                unset($db['puzzles'][$id]);
            }
            $db['order'] = array_values(array_filter($db['order'], function ($x) use ($id) {
                return $x !== $id;
            }));
            return ['ok' => true];
        }, true);
        if (isset($res['error'])) fail((int) $res['code'], (string) $res['error']);
        echo json_encode($res);
        exit;
    }

    if ($action === 'complete' || $action === 'vote') {
        $rev = isset($in['rev']) && is_int($in['rev']) ? $in['rev'] : -1;
        $vote = isset($in['vote']) && is_int($in['vote']) ? $in['vote'] : 0;
        $res = puzzle_db(function (&$db) use ($device, $id, $action, $rev, $vote) {
            $rec = $db['puzzles'][$id] ?? null;
            if (!is_array($rec) || !empty($rec['gone']) || !is_array($rec['cur'] ?? null)) return ['error' => 'That puzzle is not available.', 'code' => 404];
            if ($action === 'complete') {
                if ($rev !== (int) $rec['cur']['rev']) return ['error' => 'This puzzle was changed. Reload it.', 'code' => 409];
                if (count((array) $rec['done']) < 5000) $rec['done'][$device] = time();
            } else {
                if (!isset($rec['done'][$device])) return ['error' => 'Solve the puzzle first, then you can rate it.', 'code' => 403];
                if ($vote !== 1 && $vote !== -1) return ['error' => 'Bad vote.', 'code' => 400];
                $rec['votes'][$device] = $vote;
            }
            $db['puzzles'][$id] = $rec;
            return puzzle_public($rec, $device);
        }, true);
        if (isset($res['error'])) fail((int) $res['code'], (string) $res['error']);
        echo json_encode($res);
        exit;
    }
    fail(400, 'Unknown request.');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && isset($_GET['puzzle'])) puzzle_get_api();

if ($method === 'GET') {
    $code = (string) ($_GET['c'] ?? '');
    if (!preg_match('/^[A-Za-z0-9]{' . CODE_LENGTH . '}$/', $code)) fail(400, 'That link does not look right.');
    $path = SHARE_DIR . '/' . $code . '.json';
    $raw = is_file($path) ? @file_get_contents($path) : false;
    if ($raw === false) fail(404, 'This build was not found. The link may be wrong or old.');
    echo $raw;
    exit;
}

if ($method !== 'POST') fail(405, 'Use GET or POST.');

$body = file_get_contents('php://input', false, null, 0, MAX_PUZZLE_BODY + 1);
if ($body === false || strlen($body) > MAX_PUZZLE_BODY) fail(413, 'That is too big to send.');
$in = json_decode($body, true);
if (is_array($in) && isset($in['action']) && is_string($in['action'])) puzzle_post_api($in);
if (strlen($body) > MAX_BODY) fail(413, 'That build is too big to share.');
if (!is_array($in) || !isset($in['parts']) || !is_array($in['parts'])) fail(400, 'Bad request.');
if (count($in['parts']) < 1) fail(400, 'There is nothing on the board to share yet.');
if (count($in['parts']) > MAX_PARTS) fail(400, 'Too many parts to share.');

$parts = [];
foreach ($in['parts'] as $p) {
    $c = clean_part($p);
    if ($c === null) fail(400, 'This build has a part that cannot be shared.');
    $parts[] = $c;
}

ensure_dirs();
if (rate_limited()) fail(429, 'You have shared a lot just now. Please wait a little and try again.');
if (count(glob(SHARE_DIR . '/*.json') ?: []) >= MAX_SHARES) fail(503, 'Sharing is full right now.');

$title = clean_text($in['title'] ?? '', MAX_TITLE);
$build = [
    'title' => $title !== '' ? $title : 'A shared build',
    'author' => clean_text($in['author'] ?? '', MAX_AUTHOR),
    'version' => clean_text($in['version'] ?? '', 12),
    'at' => time(),
    'parts' => $parts,
];
$code = new_code();
if (@file_put_contents(SHARE_DIR . '/' . $code . '.json', json_encode($build, JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
    fail(500, 'Sharing cannot save here.');
}
echo json_encode(['code' => $code]);
