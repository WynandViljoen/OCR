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

export interface SeasonInfo {
  id: string;
  label: string;
  /** Unix seconds: when this season began and ends (midnight Vancouver time), and what the server's clock said. */
  start: number;
  end: number;
  now: number;
}
function parseSeason(raw: unknown): SeasonInfo | null {
  const s = raw as Partial<SeasonInfo> | null;
  if (!s || typeof s.id !== 'string' || typeof s.label !== 'string' || ![s.start, s.end, s.now].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { id: s.id, label: s.label, start: s.start as number, end: s.end as number, now: s.now as number };
}

/** The version each level was last changed in, and the season now running, as the server has them (null if it cannot be reached). */
export async function fetchRevs(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<{ revs: Record<string, string>; season: SeasonInfo | null } | null> {
  const raw = await call(fetchFn, `${ENDPOINT}?revs=1&_=${Date.now()}`);
  const data = raw === REJECTED ? null : (raw as { revs?: unknown; season?: unknown } | null);
  const revs = data?.revs;
  if (!revs || typeof revs !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(revs as Record<string, unknown>)) if (typeof v === 'string') out[id] = v;
  return { revs: out, season: parseSeason(data?.season) };
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
export interface StarsView {
  rows: StarRow[];
  max: number;
  season: SeasonInfo | null;
  /** The season that just finished: its name and final top five. */
  previous: { label: string; rows: StarRow[] } | null;
}
function parseStarRows(list: unknown): StarRow[] {
  const rows: StarRow[] = [];
  for (const r of Array.isArray(list) ? (list as Partial<StarRow>[]) : []) {
    const name = sanitizeName(typeof r?.name === 'string' ? r.name : '');
    if (name && typeof r?.stars === 'number' && r.stars > 0) rows.push({ name, stars: Math.floor(r.stars) });
  }
  return rows.slice(0, 5);
}
/** The five players holding the most stars (boards where they are number one or tied), the most anyone could hold,
 *  the season now running and last season's final top five. */
export async function fetchStars(fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<StarsView | null> {
  const raw = await call(fetchFn, `${ENDPOINT}?stars=1&_=${Date.now()}`);
  const data = raw === REJECTED ? null : (raw as { stars?: unknown; max?: unknown; season?: unknown; previous?: { label?: unknown; stars?: unknown } | null } | null);
  if (!data || !Array.isArray(data.stars)) return null;
  const prev = data.previous && typeof data.previous.label === 'string' ? { label: data.previous.label, rows: parseStarRows(data.previous.stars) } : null;
  return { rows: parseStarRows(data.stars), max: typeof data.max === 'number' ? data.max : 0, season: parseSeason(data.season), previous: prev };
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
 * another browser before the board existed). Only runs made in the current season count. The server only ever improves a board, so sending is harmless.
 * Returns how many levels were sent. Quiet when offline.
 */
export async function syncLocalBests(scores: AllScores, player: string, fetchFn?: FetchLike, sinceMs = 0): Promise<number> {
  const name = sanitizeName(player);
  if (!name) return 0;
  const jobs = Object.entries(scores)
    .filter(([id]) => id in LEVEL_REVS)
    .map(async ([id, mine]) => {
      const best = {} as Record<Category, number>;
      // Only runs from the season now running: an older best belongs to a season that is over.
      for (const c of CATEGORIES) {
        const e = mine[c].find((x) => sameName(x.name, name));
        best[c] = e && e.at >= sinceMs ? e.value : 0;
      }
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
