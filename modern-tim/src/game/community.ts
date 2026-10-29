/**
 * Community high scores: one board per level shared by everyone who plays on this
 * server, kept by scores.php next to index.html. No DOM and no Matter here.
 *
 * Everything fails soft. If the server script is missing or the player is offline,
 * `fetchCommunity` and `submitRun` return null and the game carries on with the
 * scores stored in this browser. Runs that could not be sent are kept and retried.
 */
import { CATEGORIES, parseBoard, sanitizeName, type Board, type Category, type Run } from './profile';

export const ENDPOINT = 'scores.php';
export const PENDING_KEY = 'modern-tim:pending';
const MAX_PENDING = 20;
const TIMEOUT_MS = 6000;

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
export async function trySubmit(levelId: string, name: string, run: Run, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Submission | 'retry' | 'rejected'> {
  const body = JSON.stringify({ level: levelId, name: sanitizeName(name), pathMeters: run.pathMeters, seconds: run.seconds, spare: run.spare });
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
    const r = await trySubmit(next.levelId, next.name, next.run, fetchFn);
    if (r === 'retry') break;
    list.shift();
    if (r !== 'rejected') sent++;
  }
  savePending(list, store);
  return sent;
}
