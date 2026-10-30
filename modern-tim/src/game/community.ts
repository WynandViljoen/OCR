/**
 * Community high scores: one board per level shared by everyone who plays on this
 * server, kept by scores.php next to index.html. No DOM and no Matter here.
 *
 * Everything fails soft. If the server script is missing or the player is offline,
 * `fetchCommunity` and `submitRun` return null and the game carries on with the
 * scores stored in this browser. Runs that could not be sent are kept and retried.
 */
import { LEVEL_REVS } from './level-revs';
import { BOARD_SIZE, CATEGORIES, better, parseBoard, sameName, sanitizeName, type AllScores, type Board, type Category, type Run } from './profile';

export const ENDPOINT = 'scores.php';
export const PENDING_KEY = 'modern-tim:pending';
const MAX_PENDING = 20;
const TIMEOUT_MS = 12000;

export interface CommunityResult {
  rank: number | null;
  improved: boolean;
  record: boolean;
}
export interface Submission {
  board: Board;
  results: Record<Category, CommunityResult>;
}
export interface PendingRun {
  levelId: string;
  name: string;
  run: Run;
  /** The game version the run was made on (so a retry still reports the right one). */
  version?: string;
}
/** Sent along with a score: the game version, and (only for a likely record) a small JPEG of the board. */
export interface SubmitExtras {
  version?: string;
  shot?: string;
}

type FetchLike = (url: string, init?: { method?: string; body?: string; signal?: AbortSignal; headers?: Record<string, string>; cache?: 'no-store' }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
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

/** 'rejected' = the server understood and said no (a 4xx such as an unknown level): retrying cannot help. */
const REJECTED = Symbol('rejected');

async function call(fetchFn: FetchLike, url: string, init?: Parameters<FetchLike>[1]): Promise<unknown | null | typeof REJECTED> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, { ...init, cache: 'no-store', signal: ctl?.signal });
    if (!res.ok) {
      const st = res.status ?? 0;
      return st >= 400 && st < 500 && st !== 408 && st !== 429 ? REJECTED : null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The version each level was last changed in, as the server has it (null if it cannot be reached). */
export async function fetchRevs(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Record<string, string> | null> {
  const raw = await call(fetchFn, `${ENDPOINT}?revs=1&_=${Date.now()}`);
  const revs = raw === REJECTED ? null : (raw as { revs?: unknown } | null)?.revs;
  if (!revs || typeof revs !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(revs as Record<string, unknown>)) if (typeof v === 'string') out[id] = v;
  return out;
}

/** Forget runs still waiting to be sent for levels that were changed (they were made on the old level). */
export function scrubPending(levelIds: string[], store: StoreLike | null = browserStore()) {
  if (!levelIds.length) return;
  savePending(loadPending(store).filter((r) => !levelIds.includes(r.levelId)), store);
}

export interface StarRow {
  name: string;
  stars: number;
}
/** The five players holding the most stars (boards where they are number one or tied), and the most anyone could hold. */
export async function fetchStars(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<{ rows: StarRow[]; max: number } | null> {
  const raw = await call(fetchFn, `${ENDPOINT}?stars=1&_=${Date.now()}`);
  const data = raw === REJECTED ? null : (raw as { stars?: unknown; max?: unknown } | null);
  if (!data || !Array.isArray(data.stars)) return null;
  const rows: StarRow[] = [];
  for (const r of data.stars as Partial<StarRow>[]) {
    const name = sanitizeName(typeof r?.name === 'string' ? r.name : '');
    if (name && typeof r?.stars === 'number' && r.stars > 0) rows.push({ name, stars: Math.floor(r.stars) });
  }
  return { rows: rows.slice(0, 5), max: typeof data.max === 'number' ? data.max : 0 };
}

export async function fetchCommunity(levelId: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Board | null> {
  const raw = await call(fetchFn, `${ENDPOINT}?level=${encodeURIComponent(levelId)}&_=${Date.now()}`);
  const data = raw === REJECTED ? null : (raw as { board?: unknown } | null);
  return data && data.board ? parseBoard(data.board) : null;
}

function parseResults(raw: unknown): Record<Category, CommunityResult> {
  const out = {} as Record<Category, CommunityResult>;
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<CommunityResult>>;
  for (const category of CATEGORIES) {
    const r = src[category] ?? {};
    out[category] = {
      rank: typeof r.rank === 'number' && r.rank >= 1 ? r.rank : null,
      improved: r.improved === true,
      record: r.record === true,
    };
  }
  return out;
}

/** 'retry' = could not reach the server (or it errored): keep the run and try later. 'rejected' = never going to be accepted. */
export async function trySubmit(levelId: string, name: string, run: Run, fetchFn: FetchLike = (u, i) => fetch(u, i), extras: SubmitExtras = {}): Promise<Submission | 'retry' | 'rejected'> {
  const body = JSON.stringify({
    level: levelId,
    name: sanitizeName(name),
    pathMeters: run.pathMeters,
    seconds: run.seconds,
    spare: run.spare,
    ...(LEVEL_REVS[levelId] ? { rev: LEVEL_REVS[levelId] } : {}),
    ...(extras.version ? { version: extras.version } : {}),
    ...(extras.shot ? { shot: extras.shot } : {}),
  });
  const raw = await call(fetchFn, ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  if (raw === REJECTED) return 'rejected';
  const data = raw as { board?: unknown; results?: unknown } | null;
  if (!data || !data.board) return 'retry';
  return { board: parseBoard(data.board), results: parseResults(data.results) };
}

export async function submitRun(levelId: string, name: string, run: Run, fetchFn?: FetchLike): Promise<Submission | null> {
  const r = await trySubmit(levelId, name, run, fetchFn);
  return typeof r === 'string' ? null : r;
}

// --- this player's best scores on this device ----------------------------

/** Would this score earn (or improve) the player's place on the community board? */
function earnsPlace(board: Board, category: Category, name: string, value: number): boolean {
  const list = board[category];
  const mine = list.find((e) => sameName(e.name, name));
  if (mine) return better(category, value, mine.value);
  if (list.length < BOARD_SIZE) return true;
  return better(category, value, list[list.length - 1].value);
}

/**
 * Compare this player's best scores kept on this device with the community boards and send every level where
 * one of them belongs on the board but is not there yet (for example a run that was made offline, or on
 * another browser before the board existed). The server only ever improves a board, so sending is harmless.
 * Returns how many levels were sent. Quiet when offline.
 */
export async function syncLocalBests(scores: AllScores, player: string, fetchFn?: FetchLike): Promise<number> {
  const name = sanitizeName(player);
  if (!name) return 0;
  const jobs = Object.entries(scores)
    .filter(([id]) => id in LEVEL_REVS)
    .map(async ([id, mine]) => {
      const best = {} as Record<Category, number>;
      for (const c of CATEGORIES) best[c] = mine[c].find((e) => sameName(e.name, name))?.value ?? 0;
      if (!(best.shortest > 0 && best.fastest > 0)) return 0;
      const board = await fetchCommunity(id, fetchFn);
      if (!board) return 0;
      const needed = CATEGORIES.some((c) => (c === 'spare' && best.spare <= 0 ? false : earnsPlace(board, c, name, best[c])));
      if (!needed) return 0;
      // No version and no screenshot: the game that made these runs is not known any more.
      const sent = await trySubmit(id, name, { pathMeters: best.shortest, seconds: best.fastest, spare: best.spare }, fetchFn);
      return typeof sent === 'string' ? 0 : 1;
    });
  return (await Promise.all(jobs)).reduce<number>((a, b) => a + b, 0);
}

// --- runs waiting for a connection ------------------------------------------

export function loadPending(store: StoreLike | null = browserStore()): PendingRun[] {
  try {
    const raw = JSON.parse(store?.getItem(PENDING_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.levelId === 'string' && typeof r.name === 'string' && r.run && [r.run.pathMeters, r.run.seconds, r.run.spare].every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))
      .slice(-MAX_PENDING);
  } catch {
    return [];
  }
}

export function savePending(list: PendingRun[], store: StoreLike | null = browserStore()) {
  try {
    store?.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    /* nothing more to do */
  }
}

/** Send every waiting run. Stops at the first run that could not be delivered (to retry later) and keeps the rest;
 *  a run the server refuses for good is dropped so it cannot block the ones behind it. Returns how many were sent. */
export async function flushPending(store: StoreLike | null = browserStore(), fetchFn?: FetchLike): Promise<number> {
  const list = loadPending(store);
  let sent = 0;
  while (list.length) {
    const next = list[0];
    const r = await trySubmit(next.levelId, next.name, next.run, fetchFn, { version: next.version });
    if (r === 'retry') break;
    list.shift();
    if (r !== 'rejected') sent++;
  }
  savePending(list, store);
  return sent;
}

/**
 * Could this run break a community record (be strictly better than the current number one on a board)?
 * Only then does the game attach a screenshot. The server makes the real decision; this just avoids
 * sending a picture with every solve. An empty or unknown board is not a record to break.
 */
export function mayBreakRecord(board: Board | null | undefined, run: Run): boolean {
  if (!board) return false;
  const top = (c: Category) => board[c]?.[0]?.value;
  const shortest = top('shortest');
  const fastest = top('fastest');
  const spare = top('spare');
  return (
    (shortest !== undefined && run.pathMeters < shortest) ||
    (fastest !== undefined && run.seconds < fastest) ||
    (spare !== undefined && run.spare > spare)
  );
}
