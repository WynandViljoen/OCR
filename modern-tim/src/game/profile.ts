/**
 * Player name and per-level high scores, kept in the browser (localStorage).
 * No DOM and no Matter.js in here, so the rules can be tested on their own.
 *
 * Every solved run is measured three ways:
 *   - shortest : how far the winning ball travelled (lower is better)
 *   - fastest  : seconds from Start to the goal (lower is better)
 *   - spare    : parts from the inventory left unused (higher is better)
 *
 * Each level keeps a top-5 board per category, one row per player name
 * (a player's best only), so one kid cannot fill the whole board.
 */

export const NAME_KEY = 'modern-tim:player';
export const SCORES_KEY = 'modern-tim:scores';
export const REVS_KEY = 'modern-tim:level-revs';
export const MAX_NAME = 16;
export const BOARD_SIZE = 5;
/** The playfield is 1000 px wide; scores are shown in metres at 100 px per metre. */
export const PX_PER_METER = 100;

export type Category = 'shortest' | 'fastest' | 'spare';
export const CATEGORIES: Category[] = ['shortest', 'fastest', 'spare'];

export interface CategoryInfo {
  label: string;
  blurb: string;
  lowerIsBetter: boolean;
}

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  shortest: { label: 'Shortest path', blurb: 'The ball went straight to the goal.', lowerIsBetter: true },
  fastest: { label: 'Fastest solve', blurb: 'Start to goal in the least time.', lowerIsBetter: true },
  spare: { label: 'Most spare tools', blurb: 'Parts you did not need.', lowerIsBetter: false },
};

export interface ScoreEntry {
  name: string;
  value: number;
  at: number;
}
export type Board = Record<Category, ScoreEntry[]>;
export type AllScores = Record<string, Board>;

export interface Run {
  /** Distance the winning ball travelled, in metres. */
  pathMeters: number;
  /** Time from Start to the goal, in seconds of simulated time. */
  seconds: number;
  /** Inventory parts left unused. */
  spare: number;
}

export interface RunResult {
  category: Category;
  value: number;
  /** 1-based place of this player's best on the board, or null if it is not on the board. */
  rank: number | null;
  /** True when this run beat the player's previous best (or was their first). */
  improved: boolean;
  /** True when this run is now first place. */
  record: boolean;
}

interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStore(): StoreLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Trim, collapse spaces, drop control characters, cap the length. */
export function sanitizeName(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

export const emptyBoard = (): Board => ({ shortest: [], fastest: [], spare: [] });

/** Simulation steps (60 per second) to seconds, two decimals. */
export function stepsToSeconds(steps: number): number {
  return Math.round((steps / 60) * 100) / 100;
}

/** Pixels to metres, two decimals. */
export function pathMeters(px: number): number {
  return Math.round((px / PX_PER_METER) * 100) / 100;
}

export function formatValue(category: Category, value: number): string {
  if (category === 'fastest') return `${value.toFixed(1)} s`;
  if (category === 'spare') return value === 1 ? '1 spare' : `${value} spare`;
  return `${value.toFixed(1)} m`;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function better(category: Category, a: number, b: number): boolean {
  return CATEGORY_INFO[category].lowerIsBetter ? a < b : a > b;
}

function sortBoard(category: Category, list: ScoreEntry[]) {
  const dir = CATEGORY_INFO[category].lowerIsBetter ? 1 : -1;
  list.sort((x, y) => dir * (x.value - y.value) || x.at - y.at);
}

/**
 * Add one finished run to `scores` (changes it in place) and report how it did
 * in each category. A run only replaces a player's earlier row if it is strictly better.
 */
export function recordRun(scores: AllScores, levelId: string, rawName: string, run: Run, now = Date.now()): RunResult[] {
  const name = sanitizeName(rawName);
  const board = (scores[levelId] ??= emptyBoard());
  const values: Record<Category, number> = {
    shortest: run.pathMeters,
    fastest: run.seconds,
    spare: run.spare,
  };

  return CATEGORIES.map((category) => {
    const value = values[category];
    const list = board[category];
    const eligible = Number.isFinite(value) && value > 0; // 0 spare tools is not a score
    const existing = list.find((e) => sameName(e.name, name));
    let improved = false;

    if (eligible && name) {
      if (!existing) {
        list.push({ name, value, at: now });
        improved = true;
      } else if (better(category, value, existing.value)) {
        existing.value = value;
        existing.at = now;
        existing.name = name;
        improved = true;
      }
      sortBoard(category, list);
      if (list.length > BOARD_SIZE) list.length = BOARD_SIZE;
    }

    const place = list.findIndex((e) => sameName(e.name, name));
    const rank = place >= 0 ? place + 1 : null;
    return { category, value, rank, improved: improved && rank !== null, record: improved && rank === 1 };
  });
}

/**
 * Does this player hold the best score on a board? 'first' = they are number one (they got there first),
 * 'tied' = their score equals number one's but someone reached it earlier (the board keeps the earlier
 * player on top), null = they are behind or not on the board.
 */
export function holdsBest(board: Board, category: Category, rawName: string): 'first' | 'tied' | null {
  const list = board[category];
  const top = list[0];
  if (!top || !rawName) return null;
  const mine = list.find((e) => sameName(e.name, rawName));
  if (!mine) return null;
  if (mine === top) return 'first';
  return Math.abs(mine.value - top.value) < 1e-9 ? 'tied' : null;
}

// ---------------------------------------------------------------------------
// Saving and loading
// ---------------------------------------------------------------------------

export function loadPlayer(store: StoreLike | null = browserStore()): string {
  try {
    return sanitizeName(store?.getItem(NAME_KEY) ?? '');
  } catch {
    return '';
  }
}

export function savePlayer(name: string, store: StoreLike | null = browserStore()) {
  try {
    store?.setItem(NAME_KEY, sanitizeName(name));
  } catch {
    /* private mode or full storage: the name just lasts for this visit */
  }
}

/** Turn untrusted data (storage or the server) into a clean board: bad rows dropped, sorted, capped. */
export function parseBoard(b: unknown): Board {
  const board = emptyBoard();
  const src = (b && typeof b === 'object' ? b : {}) as Partial<Record<Category, unknown>>;
  for (const category of CATEGORIES) {
    const rows = Array.isArray(src[category]) ? (src[category] as unknown[]) : [];
    const seen = new Set<string>();
    for (const row of rows) {
      const e = row as Partial<ScoreEntry> | null;
      const name = sanitizeName(typeof e?.name === 'string' ? e.name : '');
      const value = typeof e?.value === 'number' ? e.value : NaN;
      if (!name || !Number.isFinite(value) || value < 0 || value > 100000 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      board[category].push({ name, value, at: Number.isFinite(e?.at) ? (e!.at as number) : 0 });
    }
    sortBoard(category, board[category]);
    board[category].length = Math.min(board[category].length, BOARD_SIZE);
  }
  return board;
}

/** Read the boards back, dropping anything that does not look like a real score. */
export function loadScores(store: StoreLike | null = browserStore()): AllScores {
  const out: AllScores = {};
  try {
    const raw = JSON.parse(store?.getItem(SCORES_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return out;
    for (const [levelId, b] of Object.entries(raw as Record<string, unknown>)) out[levelId] = parseBoard(b);
  } catch {
    return {};
  }
  return out;
}

export function saveScores(scores: AllScores, store: StoreLike | null = browserStore()) {
  try {
    store?.setItem(SCORES_KEY, JSON.stringify(scores));
  } catch {
    /* scores last for this visit only */
  }
}

/**
 * The server says which game version each level was last changed in. When that differs from what this browser
 * last saw for a level, the level was changed and its scores here are removed (the server already cleared the
 * community board). A level seen for the first time is only noted. Returns the ids that were scrubbed.
 */
export function scrubChangedLevels(serverRevs: Record<string, string>, scores: AllScores, store: StoreLike | null = browserStore()): string[] {
  let seen: Record<string, string> = {};
  try {
    const raw = JSON.parse(store?.getItem(REVS_KEY) ?? '{}');
    if (raw && typeof raw === 'object') seen = raw as Record<string, string>;
  } catch {
    seen = {};
  }
  const scrubbed: string[] = [];
  for (const [id, rev] of Object.entries(serverRevs)) {
    if (typeof rev !== 'string') continue;
    if (seen[id] !== undefined && seen[id] !== rev && scores[id]) {
      delete scores[id];
      scrubbed.push(id);
    } else if (seen[id] !== undefined && seen[id] !== rev) {
      scrubbed.push(id);
    }
    seen[id] = rev;
  }
  try {
    store?.setItem(REVS_KEY, JSON.stringify(seen));
  } catch {
    /* next visit will try again */
  }
  if (scrubbed.length) saveScores(scores, store);
  return scrubbed;
}
