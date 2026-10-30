<?php
/**
 * Modern TIM community high scores.
 *
 * Put this file in the same web folder as index.html (public_html/ocr/).
 * It keeps one small JSON file next to itself (scores-data.json).
 *
 *   GET  scores.php?level=ramps      -> { "board": { shortest: [...], ... } }
 *   POST scores.php  (JSON body)     -> { level, name, pathMeters, seconds, spare }
 *                                       answers { "board": ..., "results": { category: {rank, record, improved} } }
 *
 * Rules match src/game/profile.ts: top 5 per category, one row per name
 * (case-insensitive), a run only replaces a row if it is strictly better,
 * ties keep the earlier row, and 0 spare tools is not a score.
 * Names are not passwords: anyone can type any name.
 *
 * Each row also remembers the game version ("version" in the POST), and a record-breaking run may send a
 * board screenshot ("shot", a JPEG data URL) that is saved in tim-data/shots for the admin page.
 *
 * Every time a run BREAKS a record (a new number one that is strictly better than the
 * old number one; a tie does not count, and neither does the very first score on an
 * empty board), one line is added to tim-data/records.log for the admin dashboard
 * (admin.php, "High scores" page).
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

const LEVELS = ['ramps', 'conveyor', 'springs', 'levers', 'dominoes', 'gears', 'spin', 'pulleys2', 'machine', 'overtop', 'bridge', 'chain', 'reach', 'tackle2', 'tradeoff2', 'double', 'crane3', 'skyhigh', 'slalom', 'maze', 'energy'];
const CATEGORIES = ['shortest', 'fastest', 'spare'];
const LOWER_IS_BETTER = ['shortest' => true, 'fastest' => true];
const BOARD_SIZE = 5;
const MAX_NAME = 16;
const DATA_FILE = __DIR__ . '/scores-data.json';
const RECORD_DIR = __DIR__ . '/tim-data';
const RECORD_LOG_MAX_BYTES = 1500000;
const MAX_BODY_BYTES = 400000;   // a score is tiny; the rest is room for one record-breaking screenshot
const MAX_SHOT_BYTES = 250000;
const MAX_SHOTS_KEPT = 150;

function fail(int $code, string $message) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

function cleanName(string $raw): string {
    $s = preg_replace('/[\x00-\x1f\x7f]/u', ' ', $raw) ?? '';
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    $s = trim(mb_substr($s, 0, MAX_NAME));
    return $s;
}

function emptyBoard(): array {
    return ['shortest' => [], 'fastest' => [], 'spare' => []];
}

function sameName(string $a, string $b): bool {
    return mb_strtolower($a) === mb_strtolower($b);
}

function better(string $category, float $a, float $b): bool {
    return isset(LOWER_IS_BETTER[$category]) ? $a < $b : $a > $b;
}

function sortBoard(string $category, array &$list) {
    $dir = isset(LOWER_IS_BETTER[$category]) ? 1 : -1;
    usort($list, function ($x, $y) use ($dir) {
        return ($dir * ($x['value'] <=> $y['value'])) ?: ($x['at'] <=> $y['at']);
    });
}

/** One board row; the game version it was achieved on is kept when the game sent it. */
function rowFor(string $name, float $value, int $now, string $version): array {
    $row = ['name' => $name, 'value' => $value, 'at' => $now];
    if ($version !== '') $row['v'] = $version;
    return $row;
}

/** Add one run to $board (in place). Returns results per category. */
function recordRun(array &$board, string $name, array $values, int $now, string $version = ''): array {
    $results = [];
    foreach (CATEGORIES as $category) {
        $value = $values[$category];
        $eligible = $value > 0;
        $improved = false;
        $found = null;
        foreach ($board[$category] as $i => $row) {
            if (sameName($row['name'], $name)) { $found = $i; break; }
        }
        if ($eligible) {
            if ($found === null) {
                $board[$category][] = rowFor($name, $value, $now, $version);
                $improved = true;
            } elseif (better($category, $value, (float)$board[$category][$found]['value'])) {
                $board[$category][$found] = rowFor($name, $value, $now, $version);
                $improved = true;
            }
            sortBoard($category, $board[$category]);
            $board[$category] = array_slice($board[$category], 0, BOARD_SIZE);
        }
        $rank = null;
        foreach ($board[$category] as $i => $row) {
            if (sameName($row['name'], $name)) { $rank = $i + 1; break; }
        }
        $results[$category] = [
            'rank' => $rank,
            'improved' => $improved && $rank !== null,
            'record' => $improved && $rank === 1,
        ];
    }
    return $results;
}

/** Best effort: a record that cannot be logged must never stop the score from being saved. */
function logRecord(array $entry) {
    if (!is_dir(RECORD_DIR)) {
        @mkdir(RECORD_DIR, 0750, true);
    }
    foreach (['.htaccess' => "Require all denied\nDeny from all\n", 'index.html' => ''] as $f => $c) {
        if (!file_exists(RECORD_DIR . '/' . $f)) {
            @file_put_contents(RECORD_DIR . '/' . $f, $c);
        }
    }
    $p = RECORD_DIR . '/records.log';
    if (is_file($p) && filesize($p) > RECORD_LOG_MAX_BYTES) {
        @rename($p, RECORD_DIR . '/records.old.log');
    }
    @file_put_contents($p, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

/**
 * Keep the screenshot the game sent with a record-breaking run (a JPEG data URL), so the admin can see
 * how the level was beaten. Best effort: returns the file name, or '' if there is no usable picture.
 */
function saveShot(string $dataUrl, string $level): string {
    if (strncmp($dataUrl, 'data:image/jpeg;base64,', 23) !== 0) return '';
    $bin = base64_decode(substr($dataUrl, 23), true);
    if ($bin === false || strlen($bin) < 200 || strlen($bin) > MAX_SHOT_BYTES || strncmp($bin, "\xFF\xD8\xFF", 3) !== 0) return '';
    $dir = RECORD_DIR . '/shots';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    $name = gmdate('Ymd-His') . '-' . $level . '-' . bin2hex(random_bytes(3)) . '.jpg';
    if (@file_put_contents($dir . '/' . $name, $bin) === false) return '';
    $all = glob($dir . '/*.jpg') ?: [];
    if (count($all) > MAX_SHOTS_KEPT) {
        sort($all);
        foreach (array_slice($all, 0, count($all) - MAX_SHOTS_KEPT) as $old) {
            @unlink($old);
        }
    }
    return $name;
}

/** The records that this run broke: category => the old number one (name, value, at). */
function brokenRecords(array $before, array $after, array $results): array {
    $broken = [];
    foreach (CATEGORIES as $category) {
        $old = $before[$category][0] ?? null;
        $new = $after[$category][0] ?? null;
        if ($old === null || $new === null || empty($results[$category]['record'])) continue;
        if (better($category, (float)$new['value'], (float)$old['value'])) {
            $broken[$category] = ['old' => $old, 'new' => $new];
        }
    }
    return $broken;
}

function readAll($handle): array {
    rewind($handle);
    $raw = stream_get_contents($handle);
    $data = json_decode($raw === false || $raw === '' ? '{}' : $raw, true);
    return is_array($data) ? $data : [];
}

function boardFor(array $all, string $level): array {
    $board = emptyBoard();
    foreach (CATEGORIES as $category) {
        $rows = $all[$level][$category] ?? [];
        if (is_array($rows)) {
            foreach ($rows as $row) {
                if (isset($row['name'], $row['value']) && is_string($row['name']) && is_numeric($row['value'])) {
                    $entry = ['name' => $row['name'], 'value' => (float)$row['value'], 'at' => (int)($row['at'] ?? 0)];
                    if (isset($row['v']) && is_string($row['v']) && $row['v'] !== '') $entry['v'] = $row['v'];
                    $board[$category][] = $entry;
                }
            }
        }
    }
    return $board;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $level = (string)($_GET['level'] ?? '');
    if (!in_array($level, LEVELS, true)) fail(400, 'Unknown level.');
    $handle = @fopen(DATA_FILE, 'c+');
    if (!$handle) fail(500, 'Scores cannot be read here.');
    flock($handle, LOCK_SH);
    $all = readAll($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    echo json_encode(['board' => boardFor($all, $level)]);
    exit;
}

if ($method !== 'POST') fail(405, 'Use GET or POST.');

$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES);
$in = json_decode($body === false ? '' : $body, true);
if (!is_array($in)) fail(400, 'Bad request.');

$level = (string)($in['level'] ?? '');
if (!in_array($level, LEVELS, true)) fail(400, 'Unknown level.');
$name = cleanName((string)($in['name'] ?? ''));
if ($name === '') fail(400, 'A name is needed.');

$path = $in['pathMeters'] ?? null;
$seconds = $in['seconds'] ?? null;
$spare = $in['spare'] ?? null;
if (!is_numeric($path) || !is_numeric($seconds) || !is_numeric($spare)) fail(400, 'Bad numbers.');
$path = round((float)$path, 2);
$seconds = round((float)$seconds, 2);
$spare = (int)$spare;
// Plausible limits for this game: a level is 10 m wide and solves within 30 s.
if ($path <= 0 || $path > 500 || $seconds <= 0 || $seconds > 120 || $spare < 0 || $spare > 30) fail(400, 'Those numbers do not look right.');

$version = (string)($in['version'] ?? '');
if (!preg_match('/^[0-9A-Za-z.\-]{1,12}$/', $version)) $version = '';

$values = ['shortest' => $path, 'fastest' => $seconds, 'spare' => (float)$spare];

$handle = @fopen(DATA_FILE, 'c+');
if (!$handle || !flock($handle, LOCK_EX)) fail(500, 'Scores cannot be saved here.');
$all = readAll($handle);
$board = boardFor($all, $level);
$before = $board;
$results = recordRun($board, $name, $values, time(), $version);
$broken = brokenRecords($before, $board, $results);
$all[$level] = $board;
rewind($handle);
ftruncate($handle, 0);
fwrite($handle, json_encode($all, JSON_UNESCAPED_UNICODE));
fflush($handle);
flock($handle, LOCK_UN);
fclose($handle);

$shotFile = $broken ? saveShot((string)($in['shot'] ?? ''), $level) : '';
foreach ($broken as $category => $b) {
    logRecord([
        't' => time(),
        'level' => $level,
        'category' => $category,
        'name' => $b['new']['name'],
        'value' => $b['new']['value'],
        'prevName' => $b['old']['name'],
        'prevValue' => $b['old']['value'],
        'version' => $version,
        'shot' => $shotFile,
    ]);
}

echo json_encode(['board' => $board, 'results' => $results]);
