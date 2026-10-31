/**
 * Sandbox builds: up to 10 named saves per player, kept in this browser, plus short share
 * links made by share.php. No DOM and no Matter here, so it can be tested on its own.
 *
 * A save is a plain list of parts (what main.ts calls `exportParts()`); it is checked again
 * by main.ts when it is loaded, so damaged or hand-edited data can never break the game.
 * Everything about the server fails soft: with no share.php, or offline, sharing just says so.
 */

export const MAX_BUILDS = 10;
export const MAX_BUILD_NAME = 24;
export const MAX_PARTS = 300;
export const SHARE_ENDPOINT = 'share.php';
export const SHARE_CODE = /^[A-Za-z0-9]{8}$/;
const TIMEOUT_MS = 8000;

export interface Build {
  id: string;
  name: string;
  savedAt: number;
  parts: unknown[];
  /** The community puzzle this build was sent in as (see puzzles.ts), if any. */
  puzzle?: number;
}

export interface StoreLike {
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

/** One list per player name, so kids who share a computer keep their own 10. */
export function buildsKey(player: string): string {
  const who = player.trim().toLowerCase().slice(0, 16);
  return `modern-tim:builds:${who || '_'}`;
}

export function cleanBuildName(raw: string): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, MAX_BUILD_NAME).trim();
}

/** "Build 1", "Build 2"... the first number not used by a save of that name. */
export function defaultBuildName(builds: Build[]): string {
  const used = new Set(builds.map((b) => b.name.toLowerCase()));
  for (let n = 1; n <= MAX_BUILDS + 1; n++) {
    if (!used.has(`build ${n}`)) return `Build ${n}`;
  }
  return 'Build';
}

/** True when another build already has this name (capitals do not matter). `exceptId` is the build being renamed or saved over. */
export function nameTaken(builds: Build[], name: string, exceptId = ''): boolean {
  const n = cleanBuildName(name).toLowerCase();
  return !!n && builds.some((x) => x.id !== exceptId && x.name.toLowerCase() === n);
}

export function loadBuilds(player: string, store: StoreLike | null = browserStore()): Build[] {
  try {
    const raw = JSON.parse(store?.getItem(buildsKey(player)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const out: Build[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (out.length >= MAX_BUILDS) break;
      if (!item || typeof item !== 'object') continue;
      const b = item as Record<string, unknown>;
      const name = cleanBuildName(typeof b.name === 'string' ? b.name : '');
      if (typeof b.id !== 'string' || !b.id || seen.has(b.id) || !name || !Array.isArray(b.parts) || b.parts.length > MAX_PARTS) continue;
      seen.add(b.id);
      out.push({ id: b.id.slice(0, 40), name, savedAt: typeof b.savedAt === 'number' && Number.isFinite(b.savedAt) ? b.savedAt : 0, parts: b.parts, ...(typeof b.puzzle === 'number' && Number.isInteger(b.puzzle) && b.puzzle > 0 ? { puzzle: b.puzzle } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

/** False if the browser would not store it (private mode, full storage). */
export function saveBuilds(player: string, builds: Build[], store: StoreLike | null = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(buildsKey(player), JSON.stringify(builds.slice(0, MAX_BUILDS)));
    return true;
  } catch {
    return false;
  }
}

let counter = 0;
export function newBuildId(now: number): string {
  counter = (counter + 1) % 1000;
  return `${now.toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`;
}

/** Add a save. Returns null when all 10 are used (the player must replace or delete one). */
export function addBuild(builds: Build[], name: string, parts: unknown[], now: number): Build[] | null {
  if (builds.length >= MAX_BUILDS) return null;
  const clean = cleanBuildName(name) || defaultBuildName(builds);
  if (nameTaken(builds, clean)) return null;
  return [...builds, { id: newBuildId(now), name: clean, savedAt: now, parts }];
}

/** Remember which community puzzle a build was sent in as. */
export function linkBuildPuzzle(builds: Build[], id: string, puzzle: number): Build[] {
  return builds.map((x) => (x.id === id ? { ...x, puzzle } : x));
}

/** Keep the save's name, put the current parts into it. */
export function replaceBuild(builds: Build[], id: string, parts: unknown[], now: number): Build[] {
  return builds.map((b) => (b.id === id ? { ...b, parts, savedAt: now } : b));
}

/** Rename. An empty name keeps the old one. */
export function renameBuild(builds: Build[], id: string, name: string): Build[] {
  const clean = cleanBuildName(name);
  if (!clean || nameTaken(builds, clean, id)) return builds;
  return builds.map((b) => (b.id === id ? { ...b, name: clean } : b));
}

export function deleteBuild(builds: Build[], id: string): Build[] {
  return builds.filter((b) => b.id !== id);
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface SharedBuild {
  title: string;
  author: string;
  parts: unknown[];
}

type FetchLike = (url: string, init?: { method?: string; body?: string; signal?: AbortSignal; headers?: Record<string, string>; cache?: 'no-store' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

async function call(fetchFn: FetchLike, url: string, init?: Parameters<FetchLike>[1]): Promise<{ ok: boolean; data: Record<string, unknown> | null } | null> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, { ...init, cache: 'no-store', signal: ctl?.signal });
    let data: Record<string, unknown> | null = null;
    try {
      const j = await res.json();
      data = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, data };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const OFFLINE = 'Sharing needs the internet. Check your connection and try again.';

/** Send a build to the server and get its short code. */
export async function shareBuild(payload: { title: string; author: string; version: string; parts: unknown[] }, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Reply<string>> {
  const r = await call(fetchFn, SHARE_ENDPOINT, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  if (!r) return { ok: false, error: OFFLINE };
  const code = r.data?.code;
  if (r.ok && typeof code === 'string' && SHARE_CODE.test(code)) return { ok: true, value: code };
  const msg = typeof r.data?.error === 'string' ? r.data.error : 'Sharing is not available on this site right now.';
  return { ok: false, error: msg };
}

/** Fetch a shared build by its code. The parts still need checking by the caller. */
export async function fetchShared(code: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Reply<SharedBuild>> {
  if (!SHARE_CODE.test(code)) return { ok: false, error: 'That link does not look right.' };
  const r = await call(fetchFn, `${SHARE_ENDPOINT}?c=${encodeURIComponent(code)}`);
  if (!r) return { ok: false, error: OFFLINE };
  const d = r.data;
  if (!r.ok || !d || !Array.isArray(d.parts)) {
    return { ok: false, error: typeof d?.error === 'string' ? d.error : 'This build could not be opened.' };
  }
  return {
    ok: true,
    value: {
      title: cleanBuildName(typeof d.title === 'string' ? d.title : '') || 'A shared build',
      author: cleanBuildName(typeof d.author === 'string' ? d.author : '').slice(0, 16),
      parts: d.parts.slice(0, MAX_PARTS),
    },
  };
}

/** The share code in a page address like "?s=K7xP2mQa", or null. */
export function shareCodeFromSearch(search: string): string | null {
  const m = /[?&]s=([^&#]*)/.exec(search);
  const code = m ? decodeURIComponent(m[1]) : '';
  return SHARE_CODE.test(code) ? code : null;
}

/** The link to give a friend: this page's address with ?s=CODE and nothing else. */
export function shareUrl(code: string, loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}?s=${code}`;
}
