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
 * and numbers only, so a link can never carry script or odd data. Limits: 64 KB per build,
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

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

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

$body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($body === false || strlen($body) > MAX_BODY) fail(413, 'That build is too big to share.');
$in = json_decode($body, true);
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
