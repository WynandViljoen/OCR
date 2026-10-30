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
const LEVEL_REVS = ['ramps' => '0.4g', 'conveyor' => '0.4g', 'springs' => '0.4g', 'levers' => '0.4g', 'dominoes' => '0.4g', 'gears' => '0.4g', 'spin' => '0.4g', 'pulleys2' => '0.4g', 'machine' => '0.4g', 'overtop' => '0.4g', 'bridge' => '0.4g', 'chain' => '0.4g', 'reach' => '0.4g', 'tackle2' => '0.4g', 'tradeoff2' => '0.4g', 'double' => '0.4g', 'crane3' => '0.4g', 'skyhigh' => '0.4g', 'slalom' => '0.4g', 'maze' => '0.4g', 'energy' => '0.4g'];   // see modern-tim/src/game/level-revs.ts
const CATEGORIES = ['shortest', 'fastest', 'spare'];
const LOWER_IS_BETTER = ['shortest' => true, 'fastest' => true];
const BOARD_SIZE = 5;
const MAX_NAME = 16;
const DATA_FILE = __DIR__ . '/scores-data.json';
const RECORD_DIR = __DIR__ . '/tim-data';
const SEASON_TZ = 'America/Vancouver';   // a season is one calendar month here, from midnight to midnight
const RECORD_LOG_MAX_BYTES = 1500000;
const MAX_BODY_BYTES = 400000;   // a score is tiny; the rest is room for one record-breaking screenshot
const MAX_SHOT_BYTES = 250000;
const MAX_SHOTS_KEPT = 150;

/** A refused score is written down (who, which level, why) so a missing score can be explained afterwards. */
function logReject(int $code, string $message) {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') return;
    $in = $GLOBALS['in'] ?? null;
    $entry = ['t' => nowTs(), 'code' => $code, 'reason' => $message];
    if (is_array($in)) {
        foreach (['level', 'name', 'version', 'rev'] as $k) {
            if (isset($in[$k]) && is_string($in[$k])) $entry[$k] = mb_substr($in[$k], 0, 40);
        }
        foreach (['pathMeters', 'seconds', 'spare'] as $k) {
            if (isset($in[$k]) && is_numeric($in[$k])) $entry[$k] = $in[$k] + 0;
        }
    }
    if (!is_dir(RECORD_DIR)) @mkdir(RECORD_DIR, 0750, true);
    $p = RECORD_DIR . '/rejects.log';
    if (is_file($p) && filesize($p) > 200000) @rename($p, RECORD_DIR . '/rejects.old.log');
    @file_put_contents($p, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

function fail(int $code, string $message) {
    logReject($code, $message);
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

const SHOT_PATTERN = '/^[0-9]{8}-[0-9]{6}-[a-z0-9]+-[a-f0-9]{6}\.jpg$/';

/**
 * The screenshot of a board's number one: the file name kept on the row, or, for a record set before rows kept
 * it, the newest matching entry in the records log. '' when there is none.
 */
function shotOf(string $level, string $category, array $row): string {
    if (isset($row['shot']) && is_string($row['shot']) && preg_match(SHOT_PATTERN, $row['shot'])) return $row['shot'];
    if (!isset($row['name'], $row['value'])) return '';
    $best = '';
    foreach (['records.old.log', 'records.log'] as $f) {
        $p = RECORD_DIR . '/' . $f;
        if (!is_file($p)) continue;
        foreach (file($p, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $e = json_decode($line, true);
            if (is_array($e) && ($e['level'] ?? '') === $level && ($e['category'] ?? '') === $category && isset($e['name'], $e['value'], $e['shot'])
                && sameName((string)$e['name'], (string)$row['name']) && abs((float)$e['value'] - (float)$row['value']) < 0.0001
                && is_string($e['shot']) && preg_match(SHOT_PATTERN, $e['shot'])) {
                $best = $e['shot'];
            }
        }
    }
    return $best;
}

/** The screenshots of a level's three number-one spots (file names). */
function topShots(array $board, string $level): array {
    $out = [];
    foreach (CATEGORIES as $category) {
        $row = $board[$category][0] ?? null;
        if (is_array($row)) {
            $s = shotOf($level, $category, $row);
            if ($s !== '') $out[$s] = true;
        }
    }
    return array_keys($out);
}

function deleteShots(array $files) {
    foreach ($files as $f) {
        if (is_string($f) && preg_match(SHOT_PATTERN, $f)) @unlink(RECORD_DIR . '/shots/' . $f);
    }
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

/** The clock. Tests can set the environment variable TIM_TEST_NOW (a Unix time); a web request cannot. */
function nowTs(): int {
    $t = getenv('TIM_TEST_NOW');
    return ($t !== false && $t !== '' && ctype_digit($t)) ? (int)$t : time();
}

/** The season (calendar month in SEASON_TZ) that contains the moment $ts, or the season named by $id ('2026-10'). */
function seasonInfo(int $ts, string $id = ''): array {
    $tz = new DateTimeZone(SEASON_TZ);
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

function ensureRecordDir() {
    if (!is_dir(RECORD_DIR)) @mkdir(RECORD_DIR, 0750, true);
    foreach (['.htaccess' => "Require all denied\nDeny from all\n", 'index.html' => ''] as $f => $c) {
        if (!file_exists(RECORD_DIR . '/' . $f)) @file_put_contents(RECORD_DIR . '/' . $f, $c);
    }
}

/** Newest finished season's archive (the file kept by archiveSeason), or null. */
function latestSeason() {
    $files = glob(RECORD_DIR . '/seasons/*.json') ?: [];
    if (!$files) return null;
    rsort($files);
    $d = json_decode((string)@file_get_contents($files[0]), true);
    return is_array($d) && isset($d['id']) ? $d : null;
}

/**
 * Save the finished season for good: every board as it ended (with the screenshots of the number ones, which move
 * to seasons/shots so they are never deleted), and the star table. Returns false if it could not be written.
 */
function archiveSeason(array $all, string $id): bool {
    ensureRecordDir();
    $dir = RECORD_DIR . '/seasons';
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    if (!is_dir($dir . '/shots')) @mkdir($dir . '/shots', 0750, true);
    $info = seasonInfo(0, $id);
    $boards = [];
    foreach (LEVELS as $level) {
        $board = boardFor($all, $level);
        foreach (CATEGORIES as $category) {
            $row = $board[$category][0] ?? null;
            if (is_array($row)) {
                $shot = shotOf($level, $category, $row);
                if ($shot !== '') {
                    $board[$category][0]['shot'] = $shot;
                    $from = RECORD_DIR . '/shots/' . $shot;
                    if (is_file($from)) @rename($from, $dir . '/shots/' . $shot);
                }
            }
        }
        if ($board['shortest'] || $board['fastest'] || $board['spare']) $boards[$level] = $board;
    }
    $data = ['id' => $info['id'], 'label' => $info['label'], 'start' => $info['start'], 'end' => $info['end'], 'boards' => $boards, 'stars' => topStars($all, 1000)];
    $tmp = $dir . '/' . $info['id'] . '.json.tmp';
    if (@file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE)) === false) return false;
    return @rename($tmp, $dir . '/' . $info['id'] . '.json');
}

/**
 * New month in Vancouver: archive the finished season and start the new one with empty boards.
 * The first time ever, the boards that exist simply belong to the current season. Returns true when $all changed.
 */
function syncSeason(array &$all): bool {
    $cur = seasonInfo(nowTs());
    $stored = $all['_season'] ?? null;
    if (!is_string($stored) || !preg_match('/^\d{4}-\d{2}$/', $stored)) {
        $all['_season'] = $cur['id'];
        return true;
    }
    if ($stored === $cur['id']) return false;
    if (!archiveSeason($all, $stored)) return false;   // keep everything and try again on the next request
    foreach (LEVELS as $level) unset($all[$level]);
    $all['_season'] = $cur['id'];
    return true;
}

/**
 * Compare each level's version in scores.php (LEVEL_REVS, the version it was last changed in) with the one the
 * data file remembers. A level seen for the first time just gets its version recorded; a level whose version
 * changed has its community boards cleared. Returns true when the data changed and needs saving.
 */
function syncRevs(array &$all): bool {
    $changed = false;
    $stored = is_array($all['_revs'] ?? null) ? $all['_revs'] : [];
    foreach (LEVEL_REVS as $id => $rev) {
        if (!isset($stored[$id])) {
            $stored[$id] = $rev;
            $changed = true;
        } elseif ($stored[$id] !== $rev) {
            deleteShots(topShots(boardFor($all, $id), $id));
            unset($all[$id]);
            $stored[$id] = $rev;
            $changed = true;
        }
    }
    if ($changed) $all['_revs'] = $stored;
    return $changed;
}

/** What players get to see: the same board without the screenshot names (those are for the admin only). */
function publicBoard(array $board): array {
    foreach ($board as $category => $rows) {
        foreach ($rows as $i => $row) unset($board[$category][$i]['shot']);
    }
    return $board;
}

/**
 * Stars per player: one for every board (level x Shortest/Fastest/Spare) on which the name is number one or tied
 * for it. Returns the top five, most stars first (ties by name), as [['name' => ..., 'stars' => n], ...].
 */
function topStars(array $all, int $limit = 5): array {
    $count = [];
    $shown = [];
    foreach (LEVELS as $level) {
        $board = boardFor($all, $level);
        foreach (CATEGORIES as $category) {
            $list = $board[$category];
            if (!$list) continue;
            $top = (float)$list[0]['value'];
            foreach ($list as $row) {
                if (abs((float)$row['value'] - $top) >= 0.0001) continue;
                $key = mb_strtolower($row['name']);
                $count[$key] = ($count[$key] ?? 0) + 1;
                if (!isset($shown[$key])) $shown[$key] = $row['name'];
            }
        }
    }
    $rows = [];
    foreach ($count as $key => $n) $rows[] = ['name' => $shown[$key], 'stars' => $n];
    usort($rows, function ($a, $b) {
        return $b['stars'] <=> $a['stars'] ?: strcasecmp($a['name'], $b['name']);
    });
    return array_slice($rows, 0, $limit);
}

function saveAll($handle, array $all) {
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($all, JSON_UNESCAPED_UNICODE));
    fflush($handle);
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
                    if (isset($row['shot']) && is_string($row['shot']) && preg_match(SHOT_PATTERN, $row['shot'])) $entry['shot'] = $row['shot'];
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
    $wantRevs = isset($_GET['revs']);
    $wantStars = isset($_GET['stars']);
    if (!$wantRevs && !$wantStars && !in_array($level, LEVELS, true)) fail(400, 'Unknown level.');
    $handle = @fopen(DATA_FILE, 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) fail(500, 'Scores cannot be read here.');
    $all = readAll($handle);
    $c1 = syncSeason($all);
    $c2 = syncRevs($all);
    if ($c1 || $c2) saveAll($handle, $all);
    flock($handle, LOCK_UN);
    fclose($handle);
    $season = seasonInfo(nowTs());
    $season['now'] = nowTs();
    if ($wantRevs) {
        echo json_encode(['revs' => LEVEL_REVS, 'season' => $season]);
        exit;
    }
    if ($wantStars) {
        $prev = latestSeason();
        echo json_encode([
            'stars' => topStars($all),
            'max' => count(LEVELS) * count(CATEGORIES),
            'season' => $season,
            'previous' => $prev ? ['id' => $prev['id'], 'label' => $prev['label'], 'stars' => array_slice($prev['stars'] ?? [], 0, 5)] : null,
        ]);
        exit;
    }
    echo json_encode(['board' => publicBoard(boardFor($all, $level)), 'rev' => LEVEL_REVS[$level]]);
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
$path = round((float)$path, 3);
$seconds = round((float)$seconds, 2);
$spare = (int)$spare;
// Plausible limits for this game: a level is 10 m wide and solves within 30 s.
if ($path <= 0 || $path > 500 || $seconds <= 0 || $seconds > 120 || $spare < 0 || $spare > 30) fail(400, 'Those numbers do not look right.');

// A game that still has an older copy of this level must not put scores on the new board.
$rev = $in['rev'] ?? null;
if (is_string($rev) && $rev !== LEVEL_REVS[$level]) fail(409, 'This level has changed. Reload the game to get the new version.');

$version = (string)($in['version'] ?? '');
if (!preg_match('/^[0-9A-Za-z.\-]{1,12}$/', $version)) $version = '';

$values = ['shortest' => $path, 'fastest' => $seconds, 'spare' => (float)$spare];

// The game only sends a picture when the run might break a record. It is kept only if it does.
$shotFile = saveShot((string)($in['shot'] ?? ''), $level);

$handle = @fopen(DATA_FILE, 'c+');
if (!$handle || !flock($handle, LOCK_EX)) fail(500, 'Scores cannot be saved here.');
$all = readAll($handle);
syncSeason($all);
syncRevs($all);
$board = boardFor($all, $level);
$before = $board;
$results = recordRun($board, $name, $values, nowTs(), $version);
$broken = brokenRecords($before, $board, $results);
// Only a board's number one keeps a screenshot: the new record's picture goes on its row, and the pictures of
// whoever was number one before (and of anyone no longer first) are deleted.
if ($broken && $shotFile !== '') {
    foreach ($broken as $category => $b) $board[$category][0]['shot'] = $shotFile;
}
foreach (CATEGORIES as $category) {
    foreach ($board[$category] as $i => $row) {
        if ($i > 0) unset($board[$category][$i]['shot']);
    }
}
$oldShots = topShots($before, $level);
$newShots = topShots($board, $level);
$all[$level] = $board;
saveAll($handle, $all);
flock($handle, LOCK_UN);
fclose($handle);

deleteShots(array_diff($oldShots, $newShots));
if ($shotFile !== '' && !in_array($shotFile, $newShots, true)) deleteShots([$shotFile]);   // the run broke nothing
foreach ($broken as $category => $b) {
    logRecord([
        't' => nowTs(),
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

echo json_encode(['board' => publicBoard($board), 'results' => $results]);
