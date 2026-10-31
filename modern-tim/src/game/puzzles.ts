/**
 * Community puzzles: a player builds a puzzle in the Sandbox (fixed parts + the parts of their own solution),
 * publishes it, the admin approves it on the dashboard, and then everyone can play it.
 * The server side lives in share.php (GET ?puzzle=..., POST {action}). No DOM here, so it can be tested alone.
 */
import { PART_DEFS } from './parts';
import type { PartType, PlacedPart } from './parts';
import type { Level, LevelPart } from './levels';
import { levelToParts, solutionToParts } from './levels';
import { Simulation } from './world';

export const PUZZLE_ENDPOINT = 'share.php';
export const MAX_PUZZLES = 5;
export const MAX_PUZZLE_TITLE = 28;
const PZ_TIMEOUT = 8000;
const PZ_STEPS = 60 * 30;

export interface WirePart {
  id: number;
  type: PartType;
  x: number;
  y: number;
  angle: number;
  w?: number;
  h?: number;
  flip?: boolean;
  link?: { a: number; b: number; via?: number };
}

export interface PuzzleSummary {
  id: number;
  title: string;
  creator: string;
  rev: number;
  difficulty: number | null;
  label: string;
  parts: number;
  up: number;
  down: number;
  done: number;
  mine?: boolean;
  completed?: boolean;
  vote?: number;
}

export interface PuzzlePlay {
  id: number;
  title: string;
  creator: string;
  rev: number;
  difficulty: number | null;
  label: string;
  fixed: WirePart[];
  inventory: Partial<Record<PartType, number>>;
  /** Only sent for the admin's preview. */
  solution?: WirePart[];
}

export type MyStatus = 'pending' | 'live' | 'live-edit' | 'rejected';
export interface MyPuzzle {
  id: number;
  status: MyStatus;
  reason: string;
  title: string;
  fixed: WirePart[];
  solution: WirePart[];
  difficulty: number | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
const PZ_OFFLINE = 'Cannot reach the server right now. Try again in a moment.';

async function pzCall(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> | null; status: number; text: string } | null> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), PZ_TIMEOUT) : 0;
  try {
    const res = await fetchFn(url, { ...init, signal: ctl?.signal, cache: 'no-store' });
    let data: Record<string, unknown> | null = null;
    let text = '';
    try {
      text = await res.text();
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }
    return { ok: res.ok, data, status: res.status, text: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const pzErr = (d: Record<string, unknown> | null, fallback: string) => (d && typeof d.error === 'string' ? d.error : fallback);
const pzQ = (device: string) => (device ? `&device=${encodeURIComponent(device)}` : '');

export async function listPuzzles(device: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Reply<PuzzleSummary[]>> {
  const r = await pzCall(fetchFn, `${PUZZLE_ENDPOINT}?puzzle=list${pzQ(device)}`);
  if (!r) return { ok: false, error: PZ_OFFLINE };
  if (!r.ok || !Array.isArray(r.data?.puzzles)) return { ok: false, error: pzErr(r.data, 'Community puzzles are not available right now.') };
  return { ok: true, value: r.data!.puzzles as PuzzleSummary[] };
}

export async function myPuzzles(device: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Reply<MyPuzzle[]>> {
  if (!device) return { ok: true, value: [] };
  const r = await pzCall(fetchFn, `${PUZZLE_ENDPOINT}?puzzle=mine${pzQ(device)}`);
  if (!r) return { ok: false, error: PZ_OFFLINE };
  if (!r.ok || !Array.isArray(r.data?.puzzles)) return { ok: false, error: pzErr(r.data, 'Your puzzles cannot be shown right now.') };
  return { ok: true, value: r.data!.puzzles as MyPuzzle[] };
}

/** One puzzle to play. With the admin's preview key (and `version`) the solution comes too. */
export async function getPuzzle(id: number, preview?: { key: string; version: string }, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Reply<PuzzlePlay>> {
  const extra = preview ? `&preview=${encodeURIComponent(preview.key)}&version=${encodeURIComponent(preview.version)}` : '';
  const r = await pzCall(fetchFn, `${PUZZLE_ENDPOINT}?puzzle=get&id=${id}${extra}`);
  if (!r) return { ok: false, error: PZ_OFFLINE };
  if (!r.ok || !Array.isArray(r.data?.fixed)) return { ok: false, error: pzErr(r.data, 'That puzzle is not available.') };
  return { ok: true, value: r.data as unknown as PuzzlePlay };
}

async function pzPost(body: Record<string, unknown>, fetchFn: FetchLike): Promise<Reply<Record<string, unknown>>> {
  const r = await pzCall(fetchFn, PUZZLE_ENDPOINT, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  if (!r) return { ok: false, error: PZ_OFFLINE };
  if (!r.ok) return { ok: false, error: pzErr(r.data, `That did not work (server answered ${r.status}${r.text ? `: ${r.text}` : ''}).`) };
  if (!r.data) return { ok: false, error: `The server sent something odd${r.text ? `: ${r.text}` : ''}. Please tell the admin.` };
  return { ok: true, value: r.data };
}

export interface SubmitInput {
  device: string;
  creator: string;
  title: string;
  fixed: WirePart[];
  solution: WirePart[];
  shot: string;
  seconds?: number;
  /** Set when editing one of your own puzzles. */
  id?: number;
}

export const submitPuzzle = (i: SubmitInput, fetchFn: FetchLike = (u, x) => fetch(u, x)) =>
  pzPost({ action: 'submit', device: i.device, creator: i.creator, title: i.title, fixed: i.fixed, solution: i.solution, shot: i.shot, seconds: i.seconds ?? 0, id: i.id ?? 0 }, fetchFn);
export const withdrawPuzzle = (device: string, id: number, fetchFn: FetchLike = (u, x) => fetch(u, x)) => pzPost({ action: 'withdraw', device, id }, fetchFn);
export const completePuzzle = (device: string, id: number, rev: number, fetchFn: FetchLike = (u, x) => fetch(u, x)) => pzPost({ action: 'complete', device, id, rev }, fetchFn);
export const votePuzzle = (device: string, id: number, vote: 1 | -1, fetchFn: FetchLike = (u, x) => fetch(u, x)) => pzPost({ action: 'vote', device, id, vote }, fetchFn);

// ---------------------------------------------------------------------------
// Sandbox board <-> puzzle
// ---------------------------------------------------------------------------

/** Split the Sandbox board into the puzzle's fixed parts and the solution parts. Attributes never travel. */
export function splitBoard(parts: PlacedPart[]): { fixed: WirePart[]; solution: WirePart[] } {
  const wire = (p: PlacedPart): WirePart => {
    const w: WirePart = { id: p.id, type: p.type, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, angle: Math.round(p.angle * 10000) / 10000 };
    if (p.w !== undefined) w.w = p.w;
    if (p.h !== undefined) w.h = p.h;
    if (p.flip) w.flip = true;
    if (p.link) w.link = p.link.via !== undefined ? { a: p.link.a, b: p.link.b, via: p.link.via } : { a: p.link.a, b: p.link.b };
    return w;
  };
  const own = parts.filter((p) => !p.locked);
  return { fixed: own.filter((p) => p.fixed).map(wire), solution: own.filter((p) => !p.fixed).map(wire) };
}

function pzLevelPart(p: WirePart): LevelPart {
  const out: LevelPart = { type: p.type, x: p.x, y: p.y, key: String(p.id) };
  if (p.angle) out.angle = (p.angle * 180) / Math.PI;
  if (p.w !== undefined) out.w = p.w;
  if (p.h !== undefined) out.h = p.h;
  if (p.flip) out.flip = true;
  if (p.link) out.link = { a: String(p.link.a), b: String(p.link.b), ...(p.link.via !== undefined ? { via: String(p.link.via) } : {}) };
  return out;
}

export function inventoryOf(solution: WirePart[]): Partial<Record<PartType, number>> {
  const inv: Partial<Record<PartType, number>> = {};
  for (const p of solution) inv[p.type] = (inv[p.type] ?? 0) + 1;
  return inv;
}

export const communityId = (id: number) => `community-${id}`;

/** The playable level for a community puzzle. */
export function puzzleToLevel(p: { id: number; title: string; creator: string; rev: number; label?: string; difficulty?: number | null; fixed: WirePart[]; solution?: WirePart[]; inventory?: Partial<Record<PartType, number>> }): Level {
  const fixed = p.fixed.filter((w) => Object.prototype.hasOwnProperty.call(PART_DEFS, w.type)).map(pzLevelPart);
  const solution = p.solution?.filter((w) => Object.prototype.hasOwnProperty.call(PART_DEFS, w.type)).map(pzLevelPart);
  const rating = p.label ? ` Rated ${p.label}.` : '';
  return {
    id: communityId(p.id),
    name: p.title,
    goal: `Get the ball into the basket! A puzzle by ${p.creator}.${rating}`,
    hasGoal: true,
    fixed,
    inventory: p.inventory ?? inventoryOf(p.solution ?? []),
    solution,
    science: {
      topic: 'A community puzzle',
      text: `${p.creator} made this puzzle. Look at what is fixed in place, then work out how to use the parts in your tray.`,
      tryThis: 'Not sure where to start? Look at where the ball begins and where the basket is, then work backwards.',
      learned: 'Another puzzle solved. Tell the maker what you thought with the thumbs below.',
    },
    community: { id: p.id, rev: p.rev, creator: p.creator, label: p.label ?? '' },
  };
}

function pzSimulate(parts: PlacedPart[]) {
  const sim = new Simulation();
  sim.goalEnabled = true;
  sim.goalTargets = ['ball'];
  sim.load(parts, true);
  let steps = 0;
  while (!sim.solved && !sim.failed && steps < PZ_STEPS) {
    sim.step();
    steps++;
  }
  return { solved: sim.solved, seconds: steps / 60 };
}

export interface PuzzleCheck {
  ok: boolean;
  /** What to tell the player when ok is false. */
  problem: string;
  /** How long the creator's solution takes to reach the basket, in simulated seconds. */
  seconds?: number;
}

/** Does the puzzle solve with its solution and not solve without? Runs on its own simulation. */
export function checkPuzzle(fixed: WirePart[], solution: WirePart[]): PuzzleCheck {
  const all = [...fixed, ...solution];
  if (all.filter((p) => p.type === 'ball').length !== 1 || !fixed.some((p) => p.type === 'ball')) return { ok: false, problem: 'A puzzle needs exactly one ball, and it must be fixed (select it and press 🔒 Fix).' };
  if (all.filter((p) => p.type === 'basket').length !== 1 || !fixed.some((p) => p.type === 'basket')) return { ok: false, problem: 'A puzzle needs exactly one basket, and it must be fixed (select it and press 🔒 Fix).' };
  if (solution.length === 0) return { ok: false, problem: 'Players need parts to build with. Leave some parts un-fixed: they become the tray.' };
  if (fixed.some((p) => p.type === 'string' || p.type === 'rope')) return { ok: false, problem: 'Strings and ropes cannot be fixed. Players add them themselves.' };
  const level = puzzleToLevel({ id: 0, title: 'x', creator: 'x', rev: 1, fixed, solution });
  let id = 1;
  const nextId = () => id++;
  const alone = pzSimulate(levelToParts(level, nextId));
  if (alone.solved) return { ok: false, problem: 'The puzzle solves itself with nothing added. Make it need the parts.' };
  id = 1;
  const withSolution = pzSimulate([...levelToParts(level, nextId), ...solutionToParts(level, nextId)]);
  if (!withSolution.solved) return { ok: false, problem: 'Your own parts do not get the ball into the basket within 30 seconds. Press Start and make it work first.' };
  return { ok: true, problem: '', seconds: Math.round(withSolution.seconds * 10) / 10 };
}

/** The short hex tag shown to players and on the dashboard, like #00A3. */
export const puzzleTag = (id: number) => `#${id.toString(16).toUpperCase().padStart(4, '0')}`;
