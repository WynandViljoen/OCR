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
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const LEVELS = ['ramps', 'conveyor', 'springs', 'levers', 'dominoes', 'gears', 'spin', 'pulleys', 'machine'];
const CATEGORIES = ['shortest', 'longest', 'fastest', 'slowest', 'spare'];
const LOWER_IS_BETTER = ['shortest' => true, 'fastest' => true];
const BOARD_SIZE = 5;
const MAX_NAME = 16;
const DATA_FILE = __DIR__ . '/scores-data.json';

function fail(int $code, string $message): void {
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
    return ['shortest' => [], 'longest' => [], 'fastest' => [], 'slowest' => [], 'spare' => []];
}

function sameName(string $a, string $b): bool {
    return mb_strtolower($a) === mb_strtolower($b);
}

function better(string $category, float $a, float $b): bool {
    return isset(LOWER_IS_BETTER[$category]) ? $a < $b : $a > $b;
}

function sortBoard(string $category, array &$list): void {
    $dir = isset(LOWER_IS_BETTER[$category]) ? 1 : -1;
    usort($list, fn($x, $y) => ($dir * ($x['value'] <=> $y['value'])) ?: ($x['at'] <=> $y['at']));
}

/** Add one run to $board (in place). Returns results per category. */
function recordRun(array &$board, string $name, array $values, int $now): array {
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
                $board[$category][] = ['name' => $name, 'value' => $value, 'at' => $now];
                $improved = true;
            } elseif (better($category, $value, (float)$board[$category][$found]['value'])) {
                $board[$category][$found] = ['name' => $name, 'value' => $value, 'at' => $now];
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
                    $board[$category][] = ['name' => $row['name'], 'value' => (float)$row['value'], 'at' => (int)($row['at'] ?? 0)];
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

$body = file_get_contents('php://input', false, null, 0, 4096);
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

$values = ['shortest' => $path, 'longest' => $path, 'fastest' => $seconds, 'slowest' => $seconds, 'spare' => (float)$spare];

$handle = @fopen(DATA_FILE, 'c+');
if (!$handle || !flock($handle, LOCK_EX)) fail(500, 'Scores cannot be saved here.');
$all = readAll($handle);
$board = boardFor($all, $level);
$results = recordRun($board, $name, $values, time());
$all[$level] = $board;
rewind($handle);
ftruncate($handle, 0);
fwrite($handle, json_encode($all, JSON_UNESCAPED_UNICODE));
fflush($handle);
flock($handle, LOCK_UN);
fclose($handle);

echo json_encode(['board' => $board, 'results' => $results]);
