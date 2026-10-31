/**
 * Entry point: wires the Simulation (physics), the UI and pointer/keyboard input.
 *
 * Model: the game state is a list of PlacedPart records (`parts`).
 * Both modes come from `sim.load(parts, play)`:
 *   - Edit mode -> everything frozen; the player places, drags, rotates, deletes
 *   - Play mode -> dynamic parts fall, conveyors push, springs bounce, gears turn
 * Stop rebuilds edit mode with the player's parts intact; Reset clears them.
 */
import { VERSION } from './game/version';
import './styles.css';
import { LEVELS, levelToParts, solutionToParts, withPreset, describePreset, type Level } from './game/levels';
import { PART_DEFS, isGear, type PartType, type PlacedPart } from './game/parts';
import { Simulation, WORLD_H, WORLD_W, FLOOR_TOP, STEP_MS, type Trail } from './game/world';
import { HUB_RADIUS, snapGear } from './game/mechanics';
import { PROP_SPECS, nominalMass, partProp, propValue } from './game/props';
import { findFreeSpot, overlapsAny } from './game/space';
import { drawBelt, drawBodies, drawRope, drawDecoration, drawPaper, drawUnderlay, traceBodies, type DrawState, drawFixedMark } from './game/draw';
import { UI, type PropsModel, type Remaining, type SolvedRow } from './game/ui';
import { track, disableTracking, deviceId } from './game/tracker';
import { MAX_PUZZLES, puzzleTag, checkPuzzle, completePuzzle, getPuzzle, listPuzzles, myPuzzles, puzzleToLevel, splitBoard, submitPuzzle, votePuzzle, withdrawPuzzle, type MyPuzzle, type PuzzleSummary, type WirePart } from './game/puzzles';
import { isMuted, playSound, setMuted } from './game/sound';
import { burst } from './game/confetti';
import { CATEGORIES, CATEGORY_INFO, holdsBest, scrubChangedLevels } from './game/profile';
import { MAX_BUILDS, MAX_PARTS, addBuild, deleteBuild, fetchShared, loadBuilds, renameBuild, replaceBuild, linkBuildPuzzle, saveBuilds, shareBuild, shareCodeFromSearch, shareUrl, defaultBuildName, type Build, type SharedBuild } from './game/builds';
import { applyLevelSet, currentSet, rememberSet, rememberedSet } from './game/seasons';
import { checkPreview, fetchCommunity, fetchRevs, fetchStars, flushPending, scrubPending, syncLocalBests, loadPending, mayBreakRecord, savePending, trySubmit, type Submission } from './game/community';
import {
  CATEGORY_INFO,
  stepsToSeconds,
  emptyBoard,
  formatValue,
  loadPlayer,
  loadScores,
  pathMeters,
  recordRun,
  saveScores,
  savePlayer,
  type AllScores,
  type Board,
  type RunResult,
} from './game/profile';

const GRID = 10;
const ROTATE_STEP = Math.PI / 12; // 15 degrees
const SOLVED_KEY = 'modern-tim:solved';
const SANDBOX_KEY = 'modern-tim:sandbox';
const MAX_UNDO = 60;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sim = new Simulation();

let levelIndex = 0;
let level: Level = LEVELS[0];
let parts: PlacedPart[] = [];
let idCounter = 1;
const nextId = () => idCounter++;

let playing = false;
let tool: PartType | null = null;
let toolAngle = 0;
let selectedId: number | null = null;
/** Several parts selected at once (drag a box on the empty board, Shift+click, Ctrl+A). selectedId is null while this has 2 or more. */
let multi = new Set<number>();
let selectMode: 'select' | 'pan' = 'select';
let marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
let groupDrag: { start: { x: number; y: number }; origins: Map<number, { x: number; y: number }>; dx: number; dy: number; moved: boolean; before: PlacedPart[] } | null = null;
let hover: { x: number; y: number } | null = null;
let hoverId: number | undefined;
let drag: { id: number; dx: number; dy: number; moved: boolean; before: PlacedPart[] } | null = null;
let paletteDrag: { type: PartType; x0: number; y0: number; active: boolean } | null = null;
let suppressPaletteClick = false;
let undoStack: PlacedPart[][] = [];
let lastTrails: Trail[] = [];
let showPaths = true;
// Preview: the admin dashboard links here to play a puzzle set before it goes live. Nothing is saved or sent.
const previewParams = new URLSearchParams(window.location.search);
const previewKey = previewParams.get('preview') ?? '';
const previewSet = previewParams.get('set') ?? '';
const previewPuzzle = Number(previewParams.get('puzzle') ?? 0) || 0;
const previewSetOk = previewKey !== '' && previewSet !== '' && applyLevelSet(previewSet);
const previewing = previewSetOk || (previewKey !== '' && previewPuzzle > 0);
if (previewing) disableTracking();
if (!previewSetOk) applyLevelSet(rememberedSet());
let solvedLevels = previewing ? new Set<string>() : loadSolved();
/** Who is playing (asked on the first visit, then remembered) and everyone's best runs on this device. */
let player = loadPlayer();
const allScores: AllScores = previewing ? {} : loadScores();

// Camera: `z` is the zoom factor, (cx, cy) the world point at the top-left of the view.
const MIN_ZOOM = 0.4;
/** Button and key steps below 100%: 80, 60, 50, 40. */
const ZOOM_OUT_STOPS = [0.4, 0.5, 0.6, 0.8, 1];
const MAX_ZOOM = 3;
const view = { z: 1, cx: 0, cy: 0 };
let pan: { x0: number; y0: number; cx0: number; cy0: number; moved: boolean; lockedHit: boolean; select: boolean; shift: boolean } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; midX: number; midY: number } | null = null;

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const board = document.getElementById('board') as HTMLElement;
const stageArea = document.getElementById('stage-area') as HTMLElement;

function fitBoard() {
  const r = stageArea.getBoundingClientRect();
  const stacked = window.matchMedia('(max-width: 860px)').matches;
  const maxH = stacked ? Infinity : r.height - 52; // room for the row of board controls under the board
  const w = Math.max(200, Math.min(r.width, (maxH * WORLD_W) / WORLD_H));
  board.style.width = `${w}px`;
  board.style.height = `${(w * WORLD_H) / WORLD_W}px`;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(((w * WORLD_H) / WORLD_W) * dpr);
}
new ResizeObserver(fitBoard).observe(stageArea);
fitBoard();

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const ui = new UI({
  onPaletteClick: (type) => {
    if (suppressPaletteClick) {
      suppressPaletteClick = false;
      return;
    }
    selectTool(tool === type ? null : type);
  },
  onPaletteDragStart: (type, e) => {
    if (playing) return;
    suppressPaletteClick = false;
    paletteDrag = { type, x0: e.clientX, y0: e.clientY, active: false };
    // Let the board receive the finger/mouse when a drag crosses onto it.
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  },
  onToggleRun: () => (playing ? stop() : start()),
  onReset: () => loadLevel(levelIndex, false, level.community ? level : undefined),
  onUndo: () => undo(),
  onRotate: (dir) => rotate(dir),
  onFlip: () => flip(),
  onFix: () => toggleFixed(),
  onPropStart: () => pushUndo(),
  onProp: (key, value) => setProp(key, value),
  onPropEnd: () => {
    persistSandbox();
    refreshUI();
  },
  onPower: (p) => setPower(p),
  onDelete: () => deleteSelected(),
  onSelectLevel: (i) => loadLevel(i, true),
  onNext: () => loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1), true),
  onBackToEdit: () => stop(),
  onStarsTab: () => void fetchStars().then((s) => ui.setStars(s)),
  onTogglePaths: (show) => (showPaths = show),
  onZoomIn: () => zoomStep(1.25),
  onZoomOut: () => zoomStep(1 / 1.25),
  onZoomReset: () => resetZoom(),
  onNameChosen: (name) => {
    const first = player === '';
    const before = player;
    player = name;
    savePlayer(name);
    ui.setPlayer(name);
    ui.closeGate();
    refreshScores();
    track('name', name, '', before && before !== name ? { from: before } : {});
    ui.toast(first ? `Hi, ${name}! Let's build a machine.` : `Now playing as ${name}.`);
  },
});
ui.presetNote = (type) => describePreset(level, type);

/** A small JPEG of the board (for the admin page when a community record is broken), or '' if it cannot be made. */
function captureBoardShot(): string {
  try {
    const w = 640;
    const h = Math.round((w * canvas.height) / Math.max(1, canvas.width));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const g = small.getContext('2d');
    if (!g) return '';
    g.drawImage(canvas, 0, 0, w, h);
    for (const q of [0.6, 0.45, 0.3]) {
      const url = small.toDataURL('image/jpeg', q);
      if (url.length < 180000) return url;
    }
  } catch {
    /* a screenshot is a bonus; never block the score */
  }
  return '';
}

sim.onSolved = (info) => {
  if (level.id === 'sandbox') {
    onSandboxSolved();
    return;
  }
  if (level.community) {
    onCommunitySolved();
    return;
  }
  solvedLevels.add(level.id);
  saveSolved();
  ui.setLevels(LEVELS, levelIndex, solvedLevels);
  ui.setStatus('Solved!', 'solved');

  // Score this run: how far the ball went, and how many parts were not needed.
  const run = { pathMeters: pathMeters(info.pathPx), seconds: stepsToSeconds(info.steps), spare: spareTools() };
  const results = player ? recordRun(allScores, level.id, player, run) : [];
  if (results.length) {
    if (!previewing) saveScores(allScores);
    try {
      refreshScores();
    } catch (err) {
      console.error(err);
    }
  }
  // Send it to the community board. If that fails, keep it and try again next visit.
  if (player && level.hasGoal && !previewing) {
    const id = level.id;
    const name = player;
    let shot = '';
    try {
      shot = mayBreakRecord(community[id], run) ? captureBoardShot() : '';
    } catch (err) {
      console.error(err);
    }
    void trySubmit(id, name, run, undefined, { version: VERSION, shot }).then((sub) => {
      if (sub === 'rejected') {
        // The server will never take it, so do not queue it, but say so instead of failing silently.
        ui.toast('The community board did not accept this run.');
        return;
      }
      if (sub === 'retry') {
        savePending([...loadPending(), { levelId: id, name, run, version: VERSION }]);
        if (level.id === id) {
          communityStatus = 'offline';
          refreshScores();
        }
        return;
      }
      community[id] = sub.board;
      if (level.id === id) {
        communityStatus = 'ok';
        refreshScores();
        if (sim.solved) ui.setSolvedScores(describeRun(run, results, sub.results, sub.board));
      }
    });
  }

  // Nothing cosmetic may stop the score from being sent, so each of these is guarded.
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  };
  safely(() => ui.setSolvedScores(describeRun(run, results, null)));
  safely(() => track('solve', player, level.id, { seconds: run.seconds }));
  safely(() => playSound('success'));
  safely(() => burst(document.getElementById('confetti') as HTMLCanvasElement));

  window.setTimeout(() => {
    if (playing && sim.solved) ui.showSolved(true);
  }, 700);
};

// A run that cannot succeed any more stops by itself, frozen as it ended, with a message and a way to try again.
sim.onFailed = (reason) => {
  playSound('fail');
  ui.setStatus("Didn't work", 'failed');
  ui.showFailed(reason === 'lost' ? 'The ball left the play area before it reached the goal.' : 'Everything came to rest and the ball never reached the goal.');
};

/** Parts from this level's inventory that the player did not use (the sandbox has no inventory limit). */
function spareTools(): number {
  let total = 0;
  for (const left of Object.values(remaining())) if (typeof left === 'number') total += left;
  return total;
}

/** The lines shown on the Solved card, one per score category: your own best, then the community board. */
function describeRun(
  run: { pathMeters: number; seconds: number; spare: number },
  results: RunResult[],
  shared: Submission['results'] | null,
  board: Board | null = null,
): SolvedRow[] {
  return results.map((r) => {
    const notes: string[] = [];
    let kind: SolvedRow['kind'] = 'plain';
    if (r.improved) {
      notes.push('New personal best!');
      kind = 'board';
    } else if (r.category === 'spare' && run.spare === 0) {
      notes.push('Try solving it with a part to spare');
    }
    const c = shared?.[r.category];
    if (c?.record) {
      notes.push('New community record!');
      kind = 'record';
    } else if (board && holdsBest(board, r.category, player) === 'tied') {
      notes.push('Tied for #1 in the community!');
      kind = 'record';
    } else if (c?.rank) {
      notes.push(`#${c.rank} in the community`);
      if (kind === 'plain') kind = 'board';
    }
    return { label: CATEGORY_INFO[r.category].label, value: formatValue(r.category, r.value), note: notes.join(' · '), kind };
  });
}

/** Shared boards fetched from the server this visit, and whether the last try worked. */
const community: Record<string, Board> = {};
let communityStatus: 'loading' | 'ok' | 'offline' = 'loading';

function refreshScores() {
  ui.setScores({
    level,
    mine: level.hasGoal ? (allScores[level.id] ?? emptyBoard()) : null,
    community: community[level.id] ?? null,
    status: communityStatus,
    player,
  });
}

/** Fetch the shared board for the level on screen. */
function loadCommunity() {
  if (!level.hasGoal || level.community) return;
  const id = level.id;
  if (previewing) {
    community[id] = emptyBoard();
    communityStatus = 'ok';
    return;
  }
  communityStatus = 'loading';
  void flushPending().then(() => fetchCommunity(id)).then((board) => {
    if (board) community[id] = board;
    if (level.id !== id) return;
    communityStatus = board ? 'ok' : 'offline';
    refreshScores();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clone = (list: PlacedPart[]) => list.map((p) => ({ ...p }));

function loadSolved(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveSolved() {
  if (previewing) return;
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...solvedLevels]));
  } catch {
    /* storage unavailable */
  }
}

function persistSandbox() {
  if (level.id !== 'sandbox') return;
  try {
    localStorage.setItem(SANDBOX_KEY, JSON.stringify(parts.filter((p) => !p.locked)));
  } catch {
    /* storage unavailable */
  }
}

/** Keep only known, in-range numbers from saved data. */
function cleanProps(type: PartType, raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const spec of PROP_SPECS[type] ?? []) {
    const v = (raw as Record<string, unknown>)[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Turn saved or shared data into safe parts: known types, bounded numbers, fresh ids, valid strings. */
function importParts(raw: unknown): PlacedPart[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);
  const ids = new Map<number, number>();
  const fresh: PlacedPart[] = [];
  for (const item of raw.slice(0, MAX_PARTS)) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.type !== 'string' || !Object.prototype.hasOwnProperty.call(PART_DEFS, p.type)) continue;
    const type = p.type as PartType;
    const x = num(p.x, -200, 1200);
    const y = num(p.y, -200, 900);
    if (x === undefined || y === undefined) continue;
    const id = nextId();
    if (typeof p.id === 'number') ids.set(p.id, id);
    // Attributes are the same for everyone now: saved tinkered numbers (weight, strength...) are not brought back.
    const part: PlacedPart = { id, type, x, y, angle: num(p.angle, -100, 100) ?? 0, locked: false };
    const w = num(p.w, 1, 1200);
    const h = num(p.h, 1, 1200);
    if (w !== undefined) part.w = w;
    if (h !== undefined) part.h = h;
    if (p.flip === true) part.flip = true;
    if (p.fixed === true) part.fixed = true;
    const l = p.link as Record<string, unknown> | undefined;
    if (l && typeof l === 'object' && typeof l.a === 'number' && typeof l.b === 'number') {
      part.link = { a: l.a, b: l.b, via: typeof l.via === 'number' ? l.via : undefined };
    }
    fresh.push(part);
  }
  // Strings point at gears by id, and every part got a new id.
  for (const p of fresh) {
    if (p.link) p.link = { a: ids.get(p.link.a) ?? -1, b: ids.get(p.link.b) ?? -1, via: p.link.via === undefined ? undefined : (ids.get(p.link.via) ?? -1) };
  }
  return fresh.filter((p) => {
    if (p.type === 'string') return !!p.link && p.link.a > 0 && p.link.b > 0;
    if (p.type === 'rope') return !!p.link && p.link.a > 0 && p.link.b > 0 && (p.link.via ?? -1) > 0;
    return true;
  });
}

function restoreSandbox(): PlacedPart[] {
  try {
    return importParts(JSON.parse(localStorage.getItem(SANDBOX_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

/** The player's own parts as plain data, for saving or sharing. */
function exportParts(): PlacedPart[] {
  return clone(parts.filter((p) => !p.locked)).map((p) => {
    delete p.belt;
    return p;
  });
}

/** Parts left to place per type (null = unlimited). Only listed types appear in the palette. */
function remaining(): Remaining {
  const out: Remaining = {};
  if (level.inventory === null) {
    for (const type of Object.keys(PART_DEFS) as PartType[]) out[type] = null;
    // A puzzle has exactly one ball and one basket.
    if (level.id === 'sandbox') {
      for (const type of ['ball', 'basket'] as PartType[]) out[type] = Math.max(0, 1 - parts.filter((p) => !p.locked && p.type === type).length);
    }
    return out;
  }
  for (const [type, count] of Object.entries(level.inventory) as [PartType, number][]) {
    const used = parts.filter((p) => !p.locked && p.type === type).length;
    out[type] = Math.max(0, count - used);
  }
  return out;
}

const selectedPart = () => parts.find((p) => p.id === selectedId);

function clearSelection() {
  selectedId = null;
  multi.clear();
}

/** Select these parts: none, one (the usual way, with toolbar and Tinker lab), or a group. */
function setSelection(ids: number[]) {
  if (ids.length <= 1) {
    multi.clear();
    selectedId = ids[0] ?? null;
  } else {
    selectedId = null;
    multi = new Set(ids);
  }
}

const currentSelection = (): number[] => (selectedId !== null ? [selectedId] : [...multi]);

/** Parts the player may pick up and move (not the puzzle's own pieces, not strings). */
const movable = (p: PlacedPart) => !p.locked && !PART_DEFS[p.type].anchored;

function boundsOf(id: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of sim.bodiesOf(id)) {
    x0 = Math.min(x0, b.bounds.min.x);
    y0 = Math.min(y0, b.bounds.min.y);
    x1 = Math.max(x1, b.bounds.max.x);
    y1 = Math.max(y1, b.bounds.max.y);
  }
  return { x0, y0, x1, y1 };
}

/** Would moving the group by (dx, dy) keep every part on the board and out of everything that is not moving? */
function groupFits(ids: Set<number>, origins: Map<number, { x: number; y: number }>, dx: number, dy: number): boolean {
  const others = parts.filter((q) => !ids.has(q.id));
  for (const id of ids) {
    const q = parts.find((r) => r.id === id);
    const o = origins.get(id);
    if (!q || !o) return false;
    const nx = o.x + dx;
    const ny = o.y + dy;
    if (nx < 10 || nx > WORLD_W - 10 || ny < 10 || ny > FLOOR_TOP - 10) return false;
    if (overlapsAny({ ...q, x: nx, y: ny }, others)) return false;
  }
  return true;
}

function moveGroup(ids: Set<number>, origins: Map<number, { x: number; y: number }>, dx: number, dy: number) {
  for (const id of ids) {
    const q = parts.find((r) => r.id === id);
    const o = origins.get(id);
    if (q && o) {
      q.x = o.x + dx;
      q.y = o.y + dy;
    }
  }
}

function worldPoint(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: view.cx + ((clientX - rect.left) / rect.width) * (WORLD_W / view.z),
    y: view.cy + ((clientY - rect.top) / rect.height) * (WORLD_H / view.z),
    inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
  };
}

function clampView() {
  view.z = clamp(view.z, MIN_ZOOM, MAX_ZOOM);
  // Zoomed out, the whole world fits with room to spare, so keep it centred.
  view.cx = view.z < 1 ? (WORLD_W - WORLD_W / view.z) / 2 : clamp(view.cx, 0, WORLD_W - WORLD_W / view.z);
  view.cy = view.z < 1 ? (WORLD_H - WORLD_H / view.z) / 2 : clamp(view.cy, 0, WORLD_H - WORLD_H / view.z);
}

/** Zoom by `factor`, keeping the world point (px, py) under the same spot on screen. */
function zoomAt(factor: number, px: number, py: number) {
  const z = clamp(view.z * factor, MIN_ZOOM, MAX_ZOOM);
  view.cx = px - ((px - view.cx) * view.z) / z;
  view.cy = py - ((py - view.cy) * view.z) / z;
  view.z = z;
  clampView();
  ui.setZoom(view.z);
  updateToolbar();
}

/** Zoom around the middle of what is visible (buttons and keys). */
function zoomStep(factor: number) {
  // Around and below 100% the steps are tidy numbers (80%, 60%, 50%, 40%).
  if (factor < 1 && view.z <= 1.001 + 0) {
    const lower = [...ZOOM_OUT_STOPS].reverse().find((s) => s < view.z - 0.001);
    if (lower !== undefined) {
      zoomAt(lower / view.z, view.cx + WORLD_W / view.z / 2, view.cy + WORLD_H / view.z / 2);
      return;
    }
  }
  if (factor > 1 && view.z < 0.999) {
    const higher = ZOOM_OUT_STOPS.find((s) => s > view.z + 0.001);
    if (higher !== undefined) {
      zoomAt(higher / view.z, view.cx + WORLD_W / view.z / 2, view.cy + WORLD_H / view.z / 2);
      return;
    }
  }
  zoomAt(factor, view.cx + WORLD_W / view.z / 2, view.cy + WORLD_H / view.z / 2);
}

function resetZoom() {
  view.z = 1;
  view.cx = 0;
  view.cy = 0;
  ui.setZoom(1);
  updateToolbar();
}

/**
 * Strings follow their gears: keep each one's line, pulley sizes and clickable strip up to date,
 * and drop any string whose gear has been deleted.
 */
function syncStrings() {
  const gearOf = (id: number) => parts.find((q) => q.id === id && isGear(q.type));
  parts = parts.filter((p) => p.type !== 'string' || (p.link && p.link.a !== p.link.b && gearOf(p.link.a) && gearOf(p.link.b)));
  for (const s of parts) {
    if (s.type !== 'string' || !s.link) continue;
    const a = gearOf(s.link.a)!;
    const b = gearOf(s.link.b)!;
    const ar = HUB_RADIUS;
    const br = HUB_RADIUS * propValue('string', s.props, 'pulley');
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    s.belt = { ax: a.x, ay: a.y, ar, bx: b.x, by: b.y, br, crossed: !!s.flip };
    s.x = (a.x + b.x) / 2;
    s.y = (a.y + b.y) / 2;
    s.angle = Math.atan2(b.y - a.y, b.x - a.x);
    s.w = Math.max(10, d - ar - br);
  }
}

/** What a rope can be tied to: a weight that is free to hang. */
const ropeable = (type: PartType) => type === 'crate' || type === 'ball' || type === 'heavyBall';

/** Ropes follow the weights and pulley they join; a rope loses an end when that part is deleted. */
function syncRopes() {
  const find = (id: number | undefined) => parts.find((q) => q.id === id);
  parts = parts.filter((p) => {
    if (p.type !== 'rope') return true;
    const l = p.link;
    const a = find(l?.a);
    const b = find(l?.b);
    const via = find(l?.via);
    return !!l && !!a && !!b && !!via && a !== b && ropeable(a.type) && ropeable(b.type) && via.type === 'pulley';
  });
  for (const r of parts) {
    if (r.type !== 'rope' || !r.link) continue;
    const a = find(r.link.a)!;
    const via = find(r.link.via)!;
    r.x = (a.x + via.x) / 2;
    r.y = (a.y + via.y) / 2;
    r.angle = Math.atan2(via.y - a.y, via.x - a.x);
    r.w = Math.max(10, Math.hypot(via.x - a.x, via.y - a.y) - 20);
  }
}

/** In the Sandbox, once a fixed ball and a fixed basket are on the board the run stops by itself when the ball is home. */
function sandboxPuzzleReady(): boolean {
  return level.id === 'sandbox' && parts.some((p) => p.type === 'ball' && p.fixed) && parts.some((p) => p.type === 'basket' && p.fixed);
}

function rebuild() {
  syncStrings();
  syncRopes();
  sim.goalEnabled = level.hasGoal || sandboxPuzzleReady();
  sim.goalTargets = level.goalTargets ?? ['ball'];
  sim.load(parts, playing);
}

function pushUndo(snapshot = clone(parts)) {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  ui.setUndoEnabled(true);
}

function changed() {
  rebuild();
  persistSandbox();
  refreshUI();
}

// A short guide on the very first level for a brand-new player: drag a ramp, then press Start. Skippable, shown once.
const COACH_KEY = 'modern-tim:coach';
let coachDone = (() => {
  try {
    return window.localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return false;
  }
})();
function endCoach() {
  coachDone = true;
  try {
    window.localStorage.setItem(COACH_KEY, '1');
  } catch {
    /* it just shows again next visit */
  }
  updateCoach();
}
function updateCoach() {
  const el = document.getElementById('coach') as HTMLElement | null;
  if (!el) return;
  const first = !coachDone && level.id === LEVELS[0].id && solvedLevels.size === 0 && !playing;
  el.hidden = !first;
  if (!first) return;
  const placed = parts.some((p) => !p.locked);
  const text = placed
    ? 'Nice! Now press Start \u25B6 (or Space) and watch the ball.'
    : 'Welcome! Drag the Ramp from the Parts panel onto the board so the ball rolls into the basket.';
  (document.getElementById('coach-text') as HTMLElement).textContent = text;
}
document.getElementById('coach-skip')?.addEventListener('click', endCoach);

function refreshUI() {
  updateCoach();
  if (tool !== 'string') stringFrom = null;
  if (tool !== 'rope') ropePicks = [];
  ui.showProps(propsModel());
  ui.updateCounts(remaining());
  ui.setSelectedTool(tool);
  ui.setUndoEnabled(undoStack.length > 0 && !playing);
  updateToolbar();
}

function updateToolbar() {
  const sel = selectedPart();
  if (!sel || playing || drag?.moved) {
    ui.showToolbar(null);
    return;
  }
  const def = PART_DEFS[sel.type];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of sim.bodiesOf(sel.id)) {
    minY = Math.min(minY, b.bounds.min.y);
    maxY = Math.max(maxY, b.bounds.max.y);
  }
  // Convert to % of the visible board, then keep it on screen.
  const sx = ((sel.x - view.cx) * view.z) / WORLD_W;
  const top = ((minY - view.cy) * view.z) / WORLD_H;
  const bottom = ((maxY - view.cy) * view.z) / WORLD_H;
  if (sx < 0 || sx > 1 || bottom < 0 || top > 1) {
    ui.showToolbar(null);
    return;
  }
  const below = top < 0.2;
  ui.showToolbar(
    {
      left: clamp(sx, 0.08, 0.92) * 100,
      top: clamp(below ? bottom : top, 0, 1) * 100,
      below,
    },
    { rotatable: def.rotatable, flippable: def.flippable, power: def.hasPower && canTinker() ? sel.power ?? 2 : null, fix: level.id === 'sandbox' && sel.type !== 'string' && sel.type !== 'rope' ? (sel.fixed ? 'unfix' : 'fix') : null },
  );
}

// ---------------------------------------------------------------------------
// Mode / level control
// ---------------------------------------------------------------------------

/** `restore` brings back a saved sandbox build; Reset passes false to clear it. */
function loadLevel(index: number, restore: boolean, custom?: Level) {
  const buildsDialog = document.getElementById('builds');
  if (buildsDialog) buildsDialog.hidden = true;
  levelIndex = index;
  level = custom ?? LEVELS[index];
  if (booted) track('level', player, level.id);
  resetHints();
  idCounter = 1;
  parts = levelToParts(level, nextId);
  if (level.id === 'sandbox' && restore) parts.push(...restoreSandbox());

  playing = false;
  tool = null;
  toolAngle = 0;
  clearSelection();
  drag = null;
  undoStack = [];
  lastTrails = [];
  view.z = 1;
  view.cx = 0;
  view.cy = 0;
  ui.setZoom(1);
  rebuild();
  persistSandbox();

  ui.setLevels(custom ? [custom] : LEVELS, custom ? 0 : levelIndex, solvedLevels);
  const buildsButton = document.getElementById('btn-builds');
  if (buildsButton) buildsButton.hidden = level.id !== 'sandbox';
  const pubButton = document.getElementById('btn-publish');
  if (pubButton) pubButton.hidden = level.id !== 'sandbox';
  ui.setLevelInfo(level, !custom && levelIndex < LEVELS.length - 1);
  setCommunityBits(!!custom);
  ui.setSolvedScores([]);
  refreshScores();
  loadCommunity();
  ui.setPalette(remaining());
  ui.setRunning(false);
  ui.showSolved(false);
  ui.setStatus('Building');
  const first = Object.keys(remaining())[0] as PartType | undefined;
  ui.showPartInfo(first ?? null);
  refreshUI();
}

// --- Hint: one general tip per level, never the answer ---------------------------------------------
let hintShown = false;
let hintGhost: ReturnType<(typeof PART_DEFS)['ball']['build']> | null = null; // kept null: no solution outlines
const hintBox = document.getElementById('hint-box') as HTMLElement;
const hintBtn = document.getElementById('hint-btn') as HTMLButtonElement;

function hideHintGhost() {
  hintGhost = null;
}

function resetHints() {
  hintShown = false;
  hintGhost = null;
  hintBox.hidden = true;
  hintBtn.textContent = '💡 Hint';
  hintBtn.disabled = !level.hint;
}

function showHint() {
  if (playing) return;
  if (!level.hint) {
    ui.toast('The sandbox has no puzzle, so no hints. Build anything!');
    return;
  }
  hintBox.textContent = `💡 Hint: ${level.hint}`;
  hintBox.hidden = false;
  if (!hintShown) track('hint', player, level.id, { step: 1 });
  hintShown = true;
}
hintBtn.addEventListener('click', showHint);

function start() {
  if (playing) return;
  playing = true;
  hideHintGhost();
  playSound('start');
  if (!coachDone && level.id === LEVELS[0].id) endCoach();
  track('play', player, level.id);
  tool = null;
  clearSelection();
  drag = null;
  paletteDrag = null;
  rebuild();
  ui.setRunning(true);
  ui.setStatus('Running…', 'running');
  refreshUI();
}

function stop() {
  if (!playing) {
    ui.showSolved(false);
    return;
  }
  lastTrails = [...sim.trails.values()];
  playing = false;
  rebuild();
  ui.setRunning(false);
  ui.showSolved(false);
  ui.setStatus('Building');
  refreshUI();
}

/** The gear a string has been started from (first click done, second still to come). */
let stringFrom: number | null = null;

/** Parts picked so far with the Rope tool: weight, then pulley, then the second weight. */
let ropePicks: number[] = [];

/** One click of the Rope tool: weight, pulley, weight. */
function ropeClick(x: number, y: number, touch = false) {
  const stage = ropePicks.length;
  const wantPulley = stage === 1;
  const id = sim.partNear(x, y, (touch ? 24 : 12) / view.z, (q) => (wantPulley ? q.type === 'pulley' : ropeable(q.type)));
  if (id === undefined) {
    ui.toast(stage === 0 ? 'Click a crate or ball to tie the rope to.' : wantPulley ? 'Now click a pulley for the rope to go over.' : 'Now click the second weight.');
    return;
  }
  if (stage === 0) {
    ropePicks = [id];
    ui.toast('Now click a pulley.');
    return;
  }
  if (stage === 1) {
    ropePicks.push(id);
    ui.toast('Now click the second weight (the load).');
    return;
  }
  const [a, via] = ropePicks;
  ropePicks = [];
  if (id === a) {
    ui.toast('Rope cancelled: pick a different second weight.');
    return;
  }
  if (remaining().rope === 0) {
    ui.toast('No ropes left.');
    return;
  }
  pushUndo();
  const part: PlacedPart = withPreset(level, { id: nextId(), type: 'rope', x: 0, y: 0, angle: 0, link: { a, via, b: id } });
  parts.push(part);
  tool = null;
  setSelection([part.id]);
  ui.showPartInfo('rope');
  changed();
}

/** One click of the String tool: pick the first gear, then the second, then tie them. */
function stringClick(x: number, y: number, touch = false) {
  const id = sim.partNear(x, y, (touch ? 24 : 14) / view.z, (q) => isGear(q.type));
  if (id === undefined) {
    ui.toast('Click a gear to tie the string to its centre.');
    return;
  }
  if (stringFrom === null) {
    stringFrom = id;
    ui.toast('Now click a second gear.');
    return;
  }
  if (id === stringFrom) {
    stringFrom = null;
    ui.toast('String cancelled.');
    return;
  }
  const a = stringFrom;
  stringFrom = null;
  if (parts.some((q) => q.type === 'string' && q.link && ((q.link.a === a && q.link.b === id) || (q.link.a === id && q.link.b === a)))) {
    ui.toast('Those two gears are already joined.');
    return;
  }
  if (remaining().string === 0) {
    ui.toast('No strings left.');
    return;
  }
  pushUndo();
  const part: PlacedPart = { id: nextId(), type: 'string', x: 0, y: 0, angle: 0, link: { a, b: id } };
  parts.push(part);
  tool = null;
  selectedId = part.id;
  ui.showPartInfo('string');
  changed();
}

/**
 * Attributes (weight, power, strands, speed...) cannot be changed anywhere any more: every part has the same
 * fixed numbers for every player, in the Sandbox and in puzzles alike. (The Tinker lab code stays for later.)
 */
function canTinker(): boolean {
  return false;
}

/** In the Sandbox, mark the selected parts as part of the puzzle (fixed) or take the mark off again. */
function toggleFixed() {
  if (playing || level.id !== 'sandbox') return;
  const ids = selectedId !== null ? [selectedId] : [...multi];
  const chosen = parts.filter((p) => ids.includes(p.id) && !p.locked && p.type !== 'string' && p.type !== 'rope');
  if (!chosen.length) return;
  pushUndo();
  const to = !chosen.every((p) => p.fixed);
  for (const p of chosen) p.fixed = to || undefined;
  ui.toast(to ? (chosen.length === 1 ? 'Fixed: this part will be part of the puzzle and players cannot move it.' : `Fixed ${chosen.length} parts.`) : (chosen.length === 1 ? 'Not fixed any more: this part is yours to build with.' : `Unfixed ${chosen.length} parts.`));
  changed();
}

/** The Tinker lab card for the selected part. */
function propsModel(): PropsModel | null {
  const sel = selectedPart();
  if (!sel || playing || !canTinker()) return null;
  const def = PART_DEFS[sel.type];
  const items = (PROP_SPECS[sel.type] ?? []).map((spec) => ({ spec, value: partProp(sel, spec.key) }));
  const facts: string[] = [];
  if (def.gear) {
    facts.push(`Teeth: ${def.gear.teeth}`);
    const speed = sim.gearTrain.speeds.get(sel.id);
    if (sim.gearTrain.jammed.has(sel.id)) facts.push('Jammed! These gears fight each other, so nothing can turn.');
    else if (speed) facts.push(`Turns ${((Math.abs(speed) * 60) / (2 * Math.PI)).toFixed(2)} times a second, ${speed > 0 ? 'clockwise' : 'anticlockwise'}.`);
    else if (!def.gear.motor) facts.push('Not turning. Join it to a motor gear with teeth or a string.');
  }
  if (sel.type === 'rope' && sel.link) {
    const effort = parts.find((q) => q.id === sel.link!.a);
    const load = parts.find((q) => q.id === sel.link!.b);
    if (effort && load) {
      const n = propValue('rope', sel.props, 'strands');
      const e = nominalMass(effort.type, effort.props);
      const l = nominalMass(load.type, load.props) / n;
      facts.push(`Effort side pulls with ${Math.round(e * 100) / 100}. The load needs ${Math.round(l * 100) / 100}${n > 1 ? ` (its weight shared by ${n} strands)` : ''}.`);
      facts.push(Math.abs(e - l) < 0.05 * Math.max(e, l) ? 'Balanced: nothing moves.' : e > l ? 'The effort side wins: the load goes up.' : 'The load side wins: the effort side is hauled up.');
    }
  }
  if (sel.type === 'string') facts.push(sel.flip ? 'Crossed: the second gear turns the opposite way.' : 'Straight: both gears turn the same way. Press F to cross it.');
  return { id: sel.id, title: def.label, items, facts };
}

/** A Tinker lab slider moved: change the selected part and rebuild so the preview matches. */
function setProp(key: string, value: number) {
  const sel = selectedPart();
  if (!sel || sel.locked || playing || !canTinker()) return;
  const spec = PROP_SPECS[sel.type]?.find((p) => p.key === key);
  if (!spec) return;
  const v = clamp(value, spec.min, spec.max);
  if (key === 'power') sel.power = Math.round(v);
  else (sel.props ??= {})[key] = v;
  rebuild();
  updateToolbar();
}

function selectTool(type: PartType | null) {
  if (playing) return;
  if (type && remaining()[type] === 0) {
    ui.toast(`No ${PART_DEFS[type].label.toLowerCase()}s left. Drag one you placed, or delete one.`);
    return;
  }
  tool = type;
  if (type) {
    clearSelection();
    ui.showPartInfo(type);
    if (!PART_DEFS[type].rotatable) toolAngle = 0;
  }
  refreshUI();
}

function rotate(dir: 1 | -1) {
  if (playing) return;
  if (tool) {
    if (PART_DEFS[tool].rotatable) toolAngle += dir * ROTATE_STEP;
    return;
  }
  const sel = selectedPart();
  if (sel && !sel.locked && PART_DEFS[sel.type].rotatable) {
    // Turn a copy first: the turned part may now need more room.
    const turned = { ...sel, angle: sel.angle + dir * ROTATE_STEP };
    if (!positionPart(turned, sel.x, sel.y)) {
      ui.toast(NO_ROOM);
      return;
    }
    pushUndo();
    sel.x = turned.x;
    sel.y = turned.y;
    sel.angle = turned.angle;
    changed();
  }
}

function flip() {
  const sel = selectedPart();
  if (playing || !sel || sel.locked || !PART_DEFS[sel.type].flippable) return;
  pushUndo();
  sel.flip = !sel.flip;
  changed();
}

function setPower(power: number) {
  const sel = selectedPart();
  if (playing || !sel || sel.locked || !PART_DEFS[sel.type].hasPower || !canTinker()) return;
  pushUndo();
  sel.power = clamp(power, 1, 3);
  changed();
}

function deleteById(id: number) {
  const part = parts.find((p) => p.id === id);
  if (!part || part.locked) return;
  pushUndo();
  parts = parts.filter((p) => p.id !== id);
  if (selectedId === id) clearSelection();
  changed();
}

function deleteSelected() {
  if (playing) return;
  if (selectedId !== null) {
    deleteById(selectedId);
    return;
  }
  const doomed = [...multi].filter((id) => parts.some((p) => p.id === id && !p.locked));
  if (!doomed.length) return;
  pushUndo();
  parts = parts.filter((p) => !doomed.includes(p.id));
  clearSelection();
  ui.toast(`Removed ${doomed.length} parts.`);
  changed();
}

function undo() {
  if (playing) return;
  const prev = undoStack.pop();
  if (!prev) return;
  parts = prev;
  clearSelection();
  changed();
}

/**
 * Put a part at (x, y), grid-snapped. Gears also click into mesh with a nearby gear.
 * Two parts cannot share space: if the spot is taken, the part goes to the closest
 * free spot instead. Returns false (and leaves the part alone) when there is no room.
 */
function positionPart(p: PlacedPart, x: number, y: number): boolean {
  const others = parts.filter((q) => q.id !== p.id);
  const spot = findFreeSpot(p, others, x, y, {
    grid: GRID,
    minX: 10,
    maxX: WORLD_W - 10,
    minY: 10,
    maxY: FLOOR_TOP - 10,
    adjust: isGear(p.type)
      ? (cx, cy) => {
          const snapped = snapGear({ ...p, x: cx, y: cy }, others);
          return snapped ?? { x: cx, y: cy };
        }
      : undefined,
  });
  if (!spot) return false;
  p.x = spot.x;
  p.y = spot.y;
  if (spot.angle !== undefined) p.angle = spot.angle;
  return true;
}

const NO_ROOM = 'No room for that here. Parts cannot overlap.';

function placeAt(type: PartType, x: number, y: number) {
  if (type === 'rope') {
    ropeClick(x, y);
    return;
  }
  if (type === 'string') {
    stringClick(x, y);
    return;
  }
  if (remaining()[type] === 0) return;
  const def = PART_DEFS[type];
  const part: PlacedPart = withPreset(level, {
    id: nextId(),
    type,
    x: 0,
    y: 0,
    angle: def.rotatable ? toolAngle : 0,
    power: def.hasPower ? 2 : undefined,
  });
  if (!positionPart(part, x, y)) {
    ui.toast(NO_ROOM);
    return;
  }
  pushUndo();
  parts.push(part);
  selectedId = part.id;
  playSound('place');
  ui.showPartInfo(type);
  changed();
}

// ---------------------------------------------------------------------------
// Pointer input on the board (mouse, pen and touch)
// ---------------------------------------------------------------------------

const ownParts = (p: PlacedPart) => !p.locked;

function updateCursor() {
  let cursor = 'default';
  if (!playing) {
    if (drag) cursor = 'grabbing';
    else if (hoverId !== undefined) cursor = parts.find((p) => p.id === hoverId)?.locked ? 'not-allowed' : 'grab';
    else if (tool) cursor = 'copy';
    else if (selectMode === 'pan' || view.z > 1) cursor = 'grab';
    else cursor = 'crosshair';
  }
  if (pan?.moved && !pan.select && view.z > 1) cursor = 'grabbing';
  canvas.style.cursor = cursor;
}

/** Cancel a part drag (used when a second finger turns it into a pinch). */
function cancelDrag() {
  if (groupDrag) {
    if (groupDrag.moved) {
      parts = groupDrag.before;
      rebuild();
    }
    groupDrag = null;
  }
  if (!drag) return;
  if (drag.moved) {
    parts = drag.before;
    rebuild();
  }
  drag = null;
}

function setSelectMode(mode: 'select' | 'pan') {
  selectMode = mode;
  document.getElementById('mode-select')?.classList.toggle('on', mode === 'select');
  document.getElementById('mode-pan')?.classList.toggle('on', mode === 'pan');
  updateCursor();
}
document.getElementById('mode-select')?.addEventListener('click', () => setSelectMode('select'));
document.getElementById('mode-pan')?.addEventListener('click', () => setSelectMode('pan'));

/** What the last press on the board was made with. A finger held on a part also fires "contextmenu" (the right-click event), which must never delete. */
let lastPointerType = 'mouse';

canvas.addEventListener('pointerdown', (e) => {
  lastPointerType = e.pointerType || 'mouse';
  if (e.button === 1) {
    // Middle mouse button always pans the view.
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pan = { x0: e.clientX, y0: e.clientY, cx0: view.cx, cy0: view.cy, moved: false, lockedHit: false, select: false, shift: false };
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // Two fingers: pinch to zoom and pan. Drop whatever the first finger was doing.
      cancelDrag();
      pan = null;
      const [a, b] = [...touches.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      refreshUI();
      return;
    }
    if (touches.size > 2) return;
  }

  const p = worldPoint(e.clientX, e.clientY);
  const startPan = (lockedHit: boolean, select = false) => {
    pan = { x0: e.clientX, y0: e.clientY, cx0: view.cx, cy0: view.cy, moved: false, lockedHit, select, shift: e.shiftKey };
    marquee = select ? { x0: p.x, y0: p.y, x1: p.x, y1: p.y } : null;
  };

  // While the machine runs you can still look around.
  if (playing) {
    startPan(false);
    updateCursor();
    return;
  }

  const touch = e.pointerType === 'touch';
  if (tool === 'rope') {
    ropeClick(p.x, p.y, touch);
    refreshUI();
    updateCursor();
    return;
  }
  if (tool === 'string') {
    stringClick(p.x, p.y, touch);
    refreshUI();
    updateCursor();
    return;
  }
  // Tolerances are screen pixels, so divide by zoom to get world units.
  // With a part in hand, only a click right on another part picks that one up instead.
  const tolerance = (tool ? (touch ? 8 : 3) : touch ? 26 : 16) / view.z;
  const ownId = sim.partNear(p.x, p.y, tolerance, ownParts);

  if (ownId !== undefined && e.shiftKey && !tool) {
    // Shift+click adds a part to the selection, or takes it out again.
    const part = parts.find((q) => q.id === ownId)!;
    if (movable(part)) {
      const now = new Set(currentSelection());
      if (now.has(ownId)) now.delete(ownId);
      else now.add(ownId);
      setSelection([...now]);
      if (now.size > 1) ui.toast(`${now.size} parts selected. Drag one to move them all, Delete to remove.`);
    }
  } else if (ownId !== undefined && multi.size > 1 && multi.has(ownId)) {
    // Grab any part of a selected group and the whole group moves.
    const origins = new Map<number, { x: number; y: number }>();
    for (const id of multi) {
      const q = parts.find((r) => r.id === id);
      if (q) origins.set(id, { x: q.x, y: q.y });
    }
    groupDrag = { start: { x: p.x, y: p.y }, origins, dx: 0, dy: 0, moved: false, before: clone(parts) };
  } else if (ownId !== undefined) {
    const part = parts.find((q) => q.id === ownId)!;
    tool = null;
    setSelection([part.id]);
    // Strings follow their gears, so they can be selected but not dragged.
    if (!PART_DEFS[part.type].anchored) drag = { id: part.id, dx: part.x - p.x, dy: part.y - p.y, moved: false, before: clone(parts) };
    ui.showPartInfo(part.type);
  } else if (tool) {
    const t = tool;
    placeAt(t, p.x, p.y);
    // Keep the tool if Shift is held (quick way to place a row of dominoes).
    if (!e.shiftKey || remaining()[t] === 0) tool = null;
  } else {
    // Empty space (or a puzzle part): drag to pan the view, tap to deselect.
    const lockedId = sim.partNear(p.x, p.y, tolerance, (q) => !!q.locked);
    startPan(lockedId !== undefined, selectMode === 'select');
  }
  refreshUI();
  updateCursor();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Pan with the midpoint, then zoom around it.
      const rect = canvas.getBoundingClientRect();
      view.cx -= ((midX - pinch.midX) / rect.width) * (WORLD_W / view.z);
      view.cy -= ((midY - pinch.midY) / rect.height) * (WORLD_H / view.z);
      clampView();
      const m = worldPoint(midX, midY);
      zoomAt(dist / (pinch.dist || dist), m.x, m.y);
      pinch = { dist, midX, midY };
      return;
    }
  }

  const p = worldPoint(e.clientX, e.clientY);
  hover = p;

  if (pan) {
    const dx = e.clientX - pan.x0;
    const dy = e.clientY - pan.y0;
    if (!pan.moved && Math.hypot(dx, dy) > 5) pan.moved = true;
    if (pan.select) {
      if (marquee) {
        marquee.x1 = p.x;
        marquee.y1 = p.y;
      }
    } else if (pan.moved && view.z > 1) {
      const rect = canvas.getBoundingClientRect();
      view.cx = pan.cx0 - (dx / rect.width) * (WORLD_W / view.z);
      view.cy = pan.cy0 - (dy / rect.height) * (WORLD_H / view.z);
      clampView();
      updateToolbar();
    }
    updateCursor();
    return;
  }

  if (playing) return;
  if (groupDrag) {
    const g = groupDrag;
    const dx = snap(p.x - g.start.x);
    const dy = snap(p.y - g.start.y);
    if ((dx !== g.dx || dy !== g.dy) && groupFits(multi, g.origins, dx, dy)) {
      if (!g.moved) updateToolbarHidden();
      g.dx = dx;
      g.dy = dy;
      g.moved = true;
      moveGroup(multi, g.origins, dx, dy);
      rebuild();
    }
  } else if (drag) {
    const part = parts.find((q) => q.id === drag!.id);
    if (!part) return;
    const oldX = part.x;
    const oldY = part.y;
    positionPart(part, p.x + drag.dx, p.y + drag.dy);
    if (part.x !== oldX || part.y !== oldY) {
      if (!drag.moved) updateToolbarHidden();
      drag.moved = true;
      rebuild();
    }
  } else {
    hoverId = sim.partNear(p.x, p.y, (e.pointerType === 'touch' ? 26 : 16) / view.z, () => true);
  }
  updateCursor();
});

function updateToolbarHidden() {
  ui.showToolbar(null);
}

function endPointer(e: PointerEvent) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (pan) {
    const p = pan;
    pan = null;
    const box = marquee;
    marquee = null;
    if (p.select && p.moved && box && !playing) {
      // A box was dragged over the empty board: select every part of yours it touches.
      const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
      const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
      const hit = parts.filter((q) => {
        if (!movable(q)) return false;
        const b = boundsOf(q.id);
        return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
      }).map((q) => q.id);
      const ids = p.shift ? [...new Set([...currentSelection(), ...hit])] : hit;
      setSelection(ids);
      if (ids.length > 1) ui.toast(`${ids.length} parts selected. Drag one to move them all, Delete to remove.`);
      refreshUI();
    } else if (!p.moved && playing) ui.toast('Press Stop to change your machine.');
    else if (!p.moved) {
      clearSelection();
      if (p.lockedHit) ui.toast('That part belongs to the puzzle, so it stays put.');
      refreshUI();
    }
    updateCursor();
  }
  endDrag();
}

function endDrag() {
  if (groupDrag) {
    if (groupDrag.moved) {
      pushUndo(groupDrag.before);
      persistSandbox();
    }
    groupDrag = null;
    refreshUI();
    updateCursor();
    return;
  }
  if (!drag) return;
  if (drag.moved) {
    pushUndo(drag.before);
    persistSandbox();
  }
  drag = null;
  refreshUI();
  updateCursor();
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!drag && !paletteDrag) hover = null;
  hoverId = undefined;
});

// Dragging a part straight out of the palette onto the board.
window.addEventListener('pointermove', (e) => {
  if (!paletteDrag || playing) return;
  if (!paletteDrag.active && Math.hypot(e.clientX - paletteDrag.x0, e.clientY - paletteDrag.y0) > 6) {
    paletteDrag.active = true;
    tool = paletteDrag.type;
    clearSelection();
    refreshUI();
  }
  if (paletteDrag.active) {
    const p = worldPoint(e.clientX, e.clientY);
    hover = p.inside ? p : null;
  }
});

window.addEventListener('pointerup', (e) => {
  if (!paletteDrag) return;
  const pd = paletteDrag;
  paletteDrag = null;
  if (!pd.active) return;
  suppressPaletteClick = true;
  const p = worldPoint(e.clientX, e.clientY);
  if (p.inside && !playing) {
    placeAt(pd.type, p.x, p.y);
    if (!((pd.type === 'string' && stringFrom !== null) || (pd.type === 'rope' && ropePicks.length > 0))) tool = null;
  }
  refreshUI();
});

// Mouse wheel / trackpad pinch zooms around the pointer. Shift+wheel rotates.
let wheelAccum = 0;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.shiftKey && !playing) {
      wheelAccum += e.deltaY || e.deltaX;
      if (Math.abs(wheelAccum) >= 60) {
        rotate(wheelAccum > 0 ? 1 : -1);
        wheelAccum = 0;
      }
      return;
    }
    const p = worldPoint(e.clientX, e.clientY);
    const speed = e.ctrlKey ? 0.01 : 0.0015; // trackpad pinch arrives as ctrl+wheel with small deltas
    zoomAt(Math.exp(-e.deltaY * speed), p.x, p.y);
  },
  { passive: false },
);

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Touch and pen: a long press is not a right-click. On a touch screen a part is removed with the ✕ button only.
  const type = (e as PointerEvent).pointerType || lastPointerType;
  if (type === 'touch' || type === 'pen') return;
  if (playing) return;
  const p = worldPoint(e.clientX, e.clientY);
  const id = sim.partNear(p.x, p.y, 16 / view.z, ownParts);
  if (id !== undefined) deleteById(id);
  else if (tool) selectTool(null);
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  // Typing in a text box (the name dialog) never triggers shortcuts, Space included.
  if (target && (target.tagName === 'TEXTAREA' || (target as HTMLInputElement).type === 'text')) return;
  if (target && /^(INPUT|SELECT)$/.test(target.tagName) && e.code !== 'Space') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !playing) {
    e.preventDefault();
    const all = parts.filter(movable).map((q) => q.id);
    setSelection(all);
    if (all.length > 1) ui.toast(`${all.length} parts selected. Drag one to move them all, Delete to remove.`);
    refreshUI();
    return;
  }

  if (e.key === 'h' || e.key === 'H') {
    showHint();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (playing) stop();
    else start();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'r' || e.key === 'R') {
    rotate(e.shiftKey ? -1 : 1);
  } else if (e.key === 'f' || e.key === 'F') {
    flip();
  } else if (e.key === 'l' || e.key === 'L') {
    toggleFixed();
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    setPower(Number(e.key));
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === '+' || e.key === '=') {
    zoomStep(1.25);
  } else if (e.key === '-' || e.key === '_') {
    zoomStep(1 / 1.25);
  } else if (e.key === '0') {
    resetZoom();
  } else if (e.key === 'Escape') {
    tool = null;
    clearSelection();
    refreshUI();
  } else if (e.key.startsWith('Arrow') && multi.size > 1 && !playing) {
    e.preventDefault();
    const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key] ?? [0, 0];
    const origins = new Map<number, { x: number; y: number }>();
    for (const id of multi) {
      const q = parts.find((r) => r.id === id);
      if (q) origins.set(id, { x: q.x, y: q.y });
    }
    if (groupFits(multi, origins, d[0], d[1])) {
      const before = clone(parts);
      moveGroup(multi, origins, d[0], d[1]);
      pushUndo(before);
      changed();
    }
  } else if (e.key.startsWith('Arrow')) {
    const sel = selectedPart();
    if (!sel || sel.locked || playing || PART_DEFS[sel.type].anchored) return;
    e.preventDefault();
    const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key] ?? [0, 0];
    const before = clone(parts);
    const [ox, oy] = [sel.x, sel.y];
    positionPart(sel, sel.x + d[0], sel.y + d[1]);
    if (sel.x !== ox || sel.y !== oy) pushUndo(before);
    changed();
  }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrails(trails: Trail[], faded: boolean) {
  ctx.save();
  ctx.lineWidth = faded ? 2 : 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (faded) ctx.setLineDash([2, 7]);
  for (const t of trails) {
    if (t.points.length < 2) continue;
    ctx.strokeStyle = t.label === 'heavyBall' ? 'rgba(91,74,158,0.5)' : 'rgba(47,125,246,0.5)';
    ctx.beginPath();
    ctx.moveTo(t.points[0].x, t.points[0].y);
    for (const pt of t.points) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGearLinks() {
  ctx.save();
  for (const link of sim.gearTrain.links) {
    const a = parts.find((p) => p.id === link.a);
    const b = parts.find((p) => p.id === link.b);
    if (!a || !b) continue;
    const ra = PART_DEFS[a.type].gear!.radius;
    const t = ra / (ra + PART_DEFS[b.type].gear!.radius);
    const mx = a.x + (b.x - a.x) * t;
    const my = a.y + (b.y - a.y) * t;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#1fae6a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const scale = (canvas.width / WORLD_W) * view.z;
  if (view.z < 1) {
    // Zoomed out: the world is a sheet of paper with a margin around it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#c9d3e3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, -view.cx * scale, -view.cy * scale);
  drawPaper(ctx, WORLD_W, WORLD_H, FLOOR_TOP);
  ctx.save();
  if (view.z < 1) {
    // Keep the invisible boundary walls out of the margin.
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
  }

  const state: DrawState = { steps: sim.steps, playing, train: sim.gearTrain };
  const bodies = sim.allBodies();

  if (showPaths) {
    if (playing) drawTrails([...sim.trails.values()], false);
    else drawTrails(lastTrails, true);
  }

  // Ghost of the part being placed: show where it will go (and gear snapping).
  const ghostBodies = (() => {
    if (playing || !tool || tool === 'string' || tool === 'rope' || !hover) return null;
    const def = PART_DEFS[tool];
    const ghost: PlacedPart = { id: -1, type: tool, x: 0, y: 0, angle: def.rotatable ? toolAngle : 0, power: 2 };
    if (!positionPart(ghost, hover.x, hover.y)) return null;
    return def.build(ghost, false);
  })();

  const sensors = bodies.filter((b) => b.isSensor);
  const solids = bodies.filter((b) => !b.isSensor);
  for (const b of solids) drawUnderlay(ctx, b, state);
  drawBodies(ctx, sensors, state);
  drawBodies(ctx, solids, state);
  for (const b of solids) drawDecoration(ctx, b, state);
  for (const f of parts) if (f.fixed && !f.locked) drawFixedMark(ctx, sim.bodiesOf(f.id), view.z);
  if (hintGhost && !playing) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    drawBodies(ctx, hintGhost, state);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2 / view.z;
    ctx.setLineDash([6 / view.z, 5 / view.z]);
    ctx.strokeStyle = '#f6a21a';
    traceBodies(ctx, hintGhost);
    ctx.stroke();
    ctx.restore();
  }
  for (const s of parts) if (s.type === 'string') drawBelt(ctx, s, state, !playing && s.id === selectedId);
  for (const r of parts) {
    if (r.type !== 'rope' || !r.link) continue;
    const pa = parts.find((q) => q.id === r.link!.a);
    const pb = parts.find((q) => q.id === r.link!.b);
    const pv = parts.find((q) => q.id === r.link!.via);
    const ba = sim.bodiesOf(r.link.a)[0];
    const bb = sim.bodiesOf(r.link.b)[0];
    if (!pa || !pb || !pv || !ba || !bb) continue;
    const bp = sim.bodiesOf(pv.id)[0];
    drawRope(
      ctx,
      { x: ba.position.x, top: ba.bounds.min.y },
      { x: bb.position.x, top: bb.bounds.min.y },
      bp ? { ...pv, x: bp.position.x, y: bp.position.y } : pv,
      pa.x <= pb.x,
      propValue('rope', r.props, 'strands'),
      !playing && r.id === selectedId,
    );
  }

  if (!playing) {
    drawGearLinks();

    // Rope tool: ring the parts picked so far and follow the pointer.
    if (tool === 'rope') {
      ctx.save();
      ctx.lineWidth = 4 / view.z;
      ctx.strokeStyle = '#2f7df6';
      let tip: PlacedPart | undefined;
      for (const id of ropePicks) {
        const g = parts.find((q) => q.id === id);
        if (!g) continue;
        tip = g;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (tip && hover) {
        ctx.setLineDash([7 / view.z, 6 / view.z]);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(hover.x, hover.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // String tool: show the first gear and a line following the pointer.
    if (tool === 'string' && hover) {
      const near = sim.partNear(hover.x, hover.y, 14 / view.z, (q) => isGear(q.type));
      const first = parts.find((q) => q.id === stringFrom);
      ctx.save();
      ctx.lineWidth = 4 / view.z;
      ctx.strokeStyle = '#2f7df6';
      for (const g of [first, parts.find((q) => q.id === near)]) {
        if (!g) continue;
        ctx.beginPath();
        ctx.arc(g.x, g.y, HUB_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (first) {
        ctx.setLineDash([7 / view.z, 6 / view.z]);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(hover.x, hover.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Hover hint: a soft outline on parts you can pick up.
    if (hoverId !== undefined && hoverId !== selectedId && !drag) {
      const hp = parts.find((p) => p.id === hoverId);
      if (hp && !hp.locked) {
        ctx.save();
        ctx.lineWidth = 6 / view.z;
        ctx.strokeStyle = 'rgba(47,125,246,0.35)';
        traceBodies(ctx, sim.bodiesOf(hoverId));
        ctx.stroke();
        ctx.restore();
      }
    }

    if (marquee && pan?.select && pan.moved) {
      ctx.save();
      ctx.fillStyle = 'rgba(47,125,246,0.12)';
      ctx.strokeStyle = '#2f7df6';
      ctx.lineWidth = 2 / view.z;
      ctx.setLineDash([6 / view.z, 5 / view.z]);
      const rx = Math.min(marquee.x0, marquee.x1), ry = Math.min(marquee.y0, marquee.y1);
      ctx.fillRect(rx, ry, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(rx, ry, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.restore();
    }

    for (const id of multi) {
      ctx.save();
      ctx.lineWidth = 3 / view.z;
      ctx.setLineDash([7 / view.z, 5 / view.z]);
      ctx.lineDashOffset = -performance.now() / 40;
      ctx.strokeStyle = '#2f7df6';
      traceBodies(ctx, sim.bodiesOf(id));
      ctx.stroke();
      ctx.restore();
    }

    if (selectedId !== null) {
      ctx.save();
      ctx.lineWidth = 3 / view.z;
      ctx.setLineDash([7 / view.z, 5 / view.z]);
      ctx.lineDashOffset = -performance.now() / 40;
      ctx.strokeStyle = '#2f7df6';
      traceBodies(ctx, sim.bodiesOf(selectedId));
      ctx.stroke();
      ctx.restore();
    }

    if (ghostBodies) {
      const ok = remaining()[tool!] !== 0;
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawBodies(ctx, ghostBodies, state);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = ok ? '#2f7df6' : '#e63946';
      traceBodies(ctx, ghostBodies);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fixed-timestep game loop (physics only advances while playing)
// ---------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(now - last, 100);
  last = now;
  if (playing && !sim.failed) {
    acc += dt;
    let n = 0;
    while (acc >= STEP_MS && n < 4) {
      sim.step();
      acc -= STEP_MS;
      n++;
    }
    if (n === 4) acc = 0;
  } else {
    acc = 0;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

sim.onImpact = (speed, a, b) => {
  if (!playing) return;
  playSound(a === 'ball' || b === 'ball' || a === 'heavyBall' || b === 'heavyBall' ? 'bounce' : 'thud', speed / 12);
};

// Portrait-phone tip (CSS only shows it on narrow portrait screens).
const rotateTip = document.getElementById('rotate-tip') as HTMLElement;
try {
  rotateTip.hidden = window.localStorage.getItem('modern-tim:rotatetip') === '1';
} catch {
  rotateTip.hidden = false;
}
document.getElementById('rotate-tip-close')?.addEventListener('click', () => {
  rotateTip.hidden = true;
  try {
    window.localStorage.setItem('modern-tim:rotatetip', '1');
  } catch {
    /* ignore */
  }
});

// Sound button.
const soundBtn = document.getElementById('btn-sound') as HTMLButtonElement;
const paintSound = () => {
  soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-pressed', String(isMuted()));
};
paintSound();
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  paintSound();
  playSound('click');
});

let booted = false;
loadLevel(Math.max(0, LEVELS.findIndex((l) => l.hasGoal && !solvedLevels.has(l.id))), true);
booted = true;
track('visit', player, level.id);
track('level', player, level.id);

// First visit: ask for a name. Returning visit: it was stored, so just say hello.
const versionTag = document.getElementById('version-tag');
if (versionTag) versionTag.textContent = VERSION;
let seasonStartMs = 0;
// Levels that were changed since this browser last looked lose their scores (the server cleared its boards).
/** The server says which puzzle set is live this month. A different set than the one on screen replaces it. */
function switchToLiveSet(set: string) {
  if (set === currentSet() || !applyLevelSet(set)) return;
  rememberSet(set);
  loadLevel(Math.max(0, LEVELS.findIndex((l) => l.hasGoal && !solvedLevels.has(l.id))), true);
}

if (previewing && previewPuzzle > 0) {
  // The admin plays a community puzzle from the dashboard, with the creator's solution on demand.
  const bar = document.createElement('div');
  bar.id = 'preview-bar';
  bar.textContent = `PREVIEW: community puzzle ${previewPuzzle}. Nothing you do here is saved or sent.`;
  const showSol = document.createElement('button');
  showSol.className = 'btn';
  showSol.type = 'button';
  showSol.textContent = 'Show the creator\'s solution';
  showSol.addEventListener('click', () => {
    if (playing || !level.community) return;
    parts.push(...solutionToParts(level, nextId));
    rebuild();
    refreshUI();
  });
  bar.appendChild(showSol);
  document.body.prepend(bar);
  void getPuzzle(previewPuzzle, { key: previewKey, version: previewParams.get('version') === 'draft' ? 'draft' : 'cur' }).then((r) => {
    if (!r.ok) {
      window.location.replace(window.location.pathname);
      return;
    }
    loadLevel(levelIndex, false, puzzleToLevel(r.value));
  });
} else if (previewing) {
  // Show a banner at once; if the server does not recognise the link, go back to the normal game.
  const bar = document.createElement('div');
  bar.id = 'preview-bar';
  bar.textContent = `PREVIEW: next month's puzzles. Nothing you do here is saved or sent.`;
  document.body.prepend(bar);
  void checkPreview(previewKey, previewSet).then((ok) => {
    if (!ok) window.location.replace(window.location.pathname);
  });
} else void fetchRevs()
  .then((info) => {
    seasonStartMs = info?.season ? info.season.start * 1000 : 0;
    const gone = info ? scrubChangedLevels(info.revs, allScores) : [];
    const newSet = !!info && info.set !== currentSet();
    if (info) {
      // A new puzzle set is a new challenge: its levels start unsolved.
      if (newSet && gone.length) {
        for (const id of gone) solvedLevels.delete(id);
        saveSolved();
      }
      switchToLiveSet(info.set);
    }
    if (gone.length) {
      scrubPending(gone);
      for (const id of gone) delete community[id];
      refreshScores();
      ui.toast(newSet ? 'New puzzles this month! Every level has changed, and the scores start fresh.' : gone.length === 1 ? 'A level was updated, so its high scores were reset.' : `${gone.length} levels were updated, so their high scores were reset.`);
    }
  })
  .then(() => flushPending())
  .then(async (n) => {
    // Every start: anything this player has on this device that belongs on a community board but is not there yet is added.
    const added = player ? await syncLocalBests(allScores, player, undefined, seasonStartMs) : 0;
    if (added > 0) ui.toast(added === 1 ? 'Added one of your scores to the community boards.' : `Added your scores for ${added} levels to the community boards.`);
    if (n > 0 || added > 0) loadCommunity();
  });
ui.setPlayer(player);
if (player) ui.toast(`Welcome back, ${player}!`);
else ui.openGate();


// ---------------------------------------------------------------------------
// Sandbox builds: 10 saves per player in this browser, and short share links.
// ---------------------------------------------------------------------------
const buildsEl = document.getElementById('builds') as HTMLElement;
const buildsBtn = document.getElementById('btn-builds') as HTMLButtonElement;
const buildsList = document.getElementById('builds-list') as HTMLElement;
const buildsCount = document.getElementById('builds-count') as HTMLElement;
const buildsName = document.getElementById('builds-name') as HTMLInputElement;
const buildsSave = document.getElementById('builds-save') as HTMLButtonElement;
const buildsMsg = document.getElementById('builds-msg') as HTMLElement;
const sharedEl = document.getElementById('shared') as HTMLElement;
const sharedText = document.getElementById('shared-text') as HTMLElement;
const sharedOpen = document.getElementById('shared-open') as HTMLButtonElement;
let buildList: Build[] = [];
let renamingId: string | null = null;
let sharedLinkFor: string | null = null;
let sharedLink = '';
let pendingShared: SharedBuild | null = null;

function sandboxIndex(): number {
  return LEVELS.findIndex((l) => l.id === 'sandbox');
}

function buildsSay(text: string, bad = false) {
  buildsMsg.textContent = text;
  buildsMsg.classList.toggle('bad', bad);
  buildsMsg.hidden = !text;
}

function persistBuilds(list: Build[]): boolean {
  if (!saveBuilds(player, list)) {
    buildsSay('Your browser would not save this. Is private browsing on?', true);
    return false;
  }
  buildList = list;
  return true;
}

function renderBuilds() {
  buildList = loadBuilds(player);
  buildsCount.textContent = `${buildList.length} of ${MAX_BUILDS} used`;
  buildsSave.disabled = buildList.length >= MAX_BUILDS;
  buildsName.placeholder = defaultBuildName(buildList);
  buildsList.innerHTML = '';
  if (!buildList.length) {
    const li = document.createElement('li');
    li.className = 'builds-empty';
    li.textContent = 'Nothing saved yet. Build something, then press Save.';
    buildsList.appendChild(li);
  }
  for (const b of buildList) {
    const li = document.createElement('li');
    li.className = 'build-row';
    li.dataset.id = b.id;
    const top = document.createElement('div');
    top.className = 'build-top';
    if (renamingId === b.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 24;
      input.value = b.name;
      input.className = 'build-rename';
      input.setAttribute('aria-label', 'New name');
      const done = (save: boolean) => {
        if (save) persistBuilds(renameBuild(buildList, b.id, input.value));
        renamingId = null;
        renderBuilds();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
      });
      top.appendChild(input);
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn btn-small btn-go';
      ok.textContent = 'Done';
      ok.addEventListener('click', () => done(true));
      top.appendChild(ok);
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    } else {
      const name = document.createElement('strong');
      name.className = 'build-name';
      name.textContent = b.name;
      const meta = document.createElement('span');
      meta.className = 'build-meta';
      const n = b.parts.length;
      meta.textContent = `${n} part${n === 1 ? '' : 's'}${b.savedAt ? ' · ' + new Date(b.savedAt).toLocaleDateString() : ''}`;
      top.append(name, meta);
    }
    li.appendChild(top);
    if (b.puzzle) {
      const tag = document.createElement('div');
      tag.className = 'build-pz';
      tag.dataset.pz = String(b.puzzle);
      tag.textContent = `🌍 Sent as puzzle ${puzzleTag(b.puzzle)}: checking…`;
      li.appendChild(tag);
    }
    if (renamingId !== b.id) {
      const row = document.createElement('div');
      row.className = 'build-actions';
      const mk = (label: string, act: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-small' + (act === 'load' ? ' btn-go' : act === 'delete' ? ' btn-danger' : '');
        btn.dataset.act = act;
        btn.textContent = label;
        btn.addEventListener('click', () => buildAction(act, b.id));
        row.appendChild(btn);
      };
      mk('Load', 'load');
      mk('Replace with current', 'replace');
      mk('Rename', 'rename');
      mk('Share', 'share');
      mk('Delete', 'delete');
      li.appendChild(row);
    }
    if (sharedLinkFor === b.id && sharedLink) {
      const box = document.createElement('div');
      box.className = 'build-link';
      const field = document.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = sharedLink;
      field.setAttribute('aria-label', 'Share link');
      field.addEventListener('focus', () => field.select());
      field.addEventListener('keydown', (e) => e.stopPropagation());
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-small btn-go';
      copy.textContent = 'Copy link';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(sharedLink);
          copy.textContent = 'Copied ✓';
        } catch {
          field.focus();
          field.select();
          copy.textContent = 'Press Ctrl+C';
        }
      });
      box.append(field, copy);
      li.appendChild(box);
    }
    buildsList.appendChild(li);
  }
  if (buildList.some((x) => x.puzzle)) void showPuzzleStates();
}

/** Say, on each build that was sent as a community puzzle, where that puzzle stands now. */
async function showPuzzleStates() {
  const r = await myPuzzles(deviceId());
  for (const el of Array.from(buildsList.querySelectorAll<HTMLElement>('.build-pz'))) {
    const id = Number(el.dataset.pz);
    const p = r.ok ? r.value.find((x) => x.id === id) : undefined;
    const what = !r.ok ? 'cannot check right now' : !p ? 'no longer on the server' : p.status === 'pending' ? 'waiting for the admin to approve it' : p.status === 'live' ? 'approved and live' : p.status === 'live-edit' ? 'live, your newer version is waiting for approval' : `not accepted${p.reason ? `: ${p.reason}` : ''}`;
    el.textContent = `🌍 Puzzle ${puzzleTag(id)}: ${what}`;
    el.classList.toggle('bad', !!p && p.status === 'rejected');
  }
}


async function shareParts(title: string, partsToShare: PlacedPart[], forId: string | null) {
  if (!partsToShare.length) {
    buildsSay('There is nothing on the board to share yet.', true);
    return;
  }
  buildsSay('Making a link…');
  const r = await shareBuild({ title, author: player, version: VERSION, parts: partsToShare });
  if (!r.ok) {
    buildsSay(r.error, true);
    return;
  }
  sharedLinkFor = forId;
  sharedLink = shareUrl(r.value, window.location);
  buildsSay('Link ready! Copy it and send it to a friend.');
  renderBuilds();
}

function buildAction(act: string, id: string) {
  const b = buildList.find((x) => x.id === id);
  if (!b) return;
  buildsSay('');
  if (act === 'load') {
    const mine = importParts(b.parts);
    loadLevel(sandboxIndex(), true);
    pushUndo();
    parts = [...parts.filter((p) => p.locked), ...mine];
    changed();
    closeBuilds();
    ui.toast(`Loaded “${b.name}”. Undo brings your last board back.`);
  } else if (act === 'replace') {
    if (!exportParts().length) {
      buildsSay('The board is empty, so there is nothing to put in this slot.', true);
      return;
    }
    if (persistBuilds(replaceBuild(buildList, id, exportParts(), Date.now()))) {
      renderBuilds();
      buildsSay(`“${b.name}” now holds what is on the board.`);
    }
  } else if (act === 'rename') {
    renamingId = id;
    renderBuilds();
  } else if (act === 'delete') {
    if (persistBuilds(deleteBuild(buildList, id))) {
      if (sharedLinkFor === id) sharedLinkFor = null;
      renderBuilds();
      buildsSay(`Deleted “${b.name}”.`);
    }
  } else if (act === 'share') {
    void shareParts(b.name, importParts(b.parts), id);
  }
}

function openBuilds() {
  if (level.id !== 'sandbox') return;
  renamingId = null;
  sharedLinkFor = null;
  sharedLink = '';
  buildsName.value = '';
  buildsSay('');
  renderBuilds();
  buildsEl.hidden = false;
  buildsName.focus();
}
function closeBuilds() {
  buildsEl.hidden = true;
}

buildsEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeBuilds();
});

// ---------------------------------------------------------------------------
// Community puzzles: publish from the Sandbox, play, rate.
// ---------------------------------------------------------------------------
const cmEl = document.getElementById('community') as HTMLElement;
const cmList = document.getElementById('cm-list') as HTMLElement;
const cmMine = document.getElementById('cm-mine') as HTMLElement;
const cmCount = document.getElementById('cm-count') as HTMLElement;
const cmMsg = document.getElementById('cm-msg') as HTMLElement;
let editingPuzzle: { id: number; title: string } | null = null;
let withdrawAsk = 0;

function cmSay(text: string, bad = false) {
  cmMsg.textContent = text;
  cmMsg.classList.toggle('bad', bad);
  cmMsg.hidden = !text;
}

/** Community levels have no "Next level"; they get a way back to the list and a rating row instead. */
function setCommunityBits(custom: boolean) {
  const more = document.getElementById('btn-more');
  const rate = document.getElementById('solved-rate');
  if (more) more.hidden = !custom;
  if (rate) rate.hidden = true;
}

function cmRow(main: string, meta: string): { li: HTMLElement; acts: HTMLElement } {
  const li = document.createElement('li');
  li.className = 'cm-row';
  const left = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = main;
  const m = document.createElement('div');
  m.className = 'cm-meta';
  m.textContent = meta;
  left.append(b, m);
  const acts = document.createElement('div');
  acts.className = 'cm-acts';
  li.append(left, acts);
  return { li, acts };
}

function cmButton(label: string, fn: () => void, go = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = go ? 'btn btn-go' : 'btn';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for approval', live: 'Live', 'live-edit': 'Live (your edit is waiting)', rejected: 'Not accepted' };

async function renderCommunity() {
  const dev = deviceId();
  cmList.innerHTML = '';
  cmMine.innerHTML = '';
  const loading = document.createElement('li');
  loading.className = 'builds-empty';
  loading.textContent = 'Loading…';
  cmList.appendChild(loading);
  const [all, mine] = await Promise.all([listPuzzles(dev), myPuzzles(dev)]);
  cmList.innerHTML = '';
  if (!all.ok) {
    cmSay(all.error, true);
  } else if (!all.value.length) {
    const li = document.createElement('li');
    li.className = 'builds-empty';
    li.textContent = 'No community puzzles yet. Be the first: build one in the Sandbox!';
    cmList.appendChild(li);
  } else {
    for (const p of all.value as PuzzleSummary[]) {
      const meta = `by ${p.creator}${p.label ? ` · ${p.label}` : ''} · 👍 ${p.up} 👎 ${p.down}${p.completed ? ' · ✅ solved' : ''}`;
      const { li, acts } = cmRow(p.title, meta);
      acts.appendChild(cmButton('Play', () => void playCommunityPuzzle(p.id), true));
      cmList.appendChild(li);
    }
  }
  const list: MyPuzzle[] = mine.ok ? mine.value : [];
  cmCount.textContent = `(${list.filter((x) => x.status !== 'rejected').length} of ${MAX_PUZZLES} used)`;
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'builds-empty';
    li.textContent = 'You have not published a puzzle yet.';
    cmMine.appendChild(li);
  }
  for (const m of list) {
    const { li, acts } = cmRow(`${m.title || 'Puzzle'} ${puzzleTag(m.id)}`, `${STATUS_TEXT[m.status] ?? m.status}${m.status === 'rejected' && m.reason ? `: ${m.reason}` : ''}`);
    acts.appendChild(cmButton('Edit', () => editMyPuzzle(m)));
    const w = cmButton(withdrawAsk === m.id ? 'Sure? Remove it' : 'Remove', () => {
      if (withdrawAsk !== m.id) {
        withdrawAsk = m.id;
        void renderCommunity();
        return;
      }
      withdrawAsk = 0;
      void withdrawPuzzle(dev, m.id).then((r) => {
        cmSay(r.ok ? 'Removed.' : r.error, !r.ok);
        void renderCommunity();
      });
    });
    acts.appendChild(w);
    cmMine.appendChild(li);
  }
}

function openCommunity() {
  withdrawAsk = 0;
  cmSay('');
  cmEl.hidden = false;
  void renderCommunity();
}

function closeCommunity() {
  cmEl.hidden = true;
}

async function playCommunityPuzzle(id: number) {
  cmSay('Opening…');
  const r = await getPuzzle(id);
  if (!r.ok) {
    cmSay(r.error, true);
    return;
  }
  closeCommunity();
  loadLevel(levelIndex, false, puzzleToLevel(r.value));
}

/** Bring one of your puzzles back into the Sandbox: the fixed parts keep their pin, the rest is your solution. */
function editMyPuzzle(m: MyPuzzle) {
  const raw = [...m.fixed.map((p: WirePart) => ({ ...p, fixed: true })), ...m.solution];
  const mineParts = importParts(raw);
  loadLevel(sandboxIndex(), true);
  pushUndo();
  parts = [...parts.filter((p) => p.locked), ...mineParts];
  changed();
  editingPuzzle = { id: m.id, title: m.title };
  closeCommunity();
  ui.toast(`“${m.title}” is on the Sandbox board. Change it, then press 🚀 Publish puzzle.`);
}

/** Check, then send the Sandbox board as a puzzle. Returns the sentence to show, and whether it worked. */
async function doPublish(titleIn: string): Promise<{ ok: boolean; text: string; id?: number }> {
  if (!player) return { ok: false, text: 'Choose a player name first (top right).' };
  const dev = deviceId();
  if (!dev) return { ok: false, text: 'This browser has no id yet. Reload the game and try again in a moment.' };
  const { fixed, solution } = splitBoard(parts);
  const check = checkPuzzle(fixed, solution);
  if (!check.ok) return { ok: false, text: check.problem };
  const title = titleIn.trim().slice(0, 28) || editingPuzzle?.title || '';
  if (!title) return { ok: false, text: 'Give your puzzle a name.' };
  const r = await submitPuzzle({ device: dev, creator: player, title, fixed, solution, shot: captureBoardShot(), seconds: check.seconds, id: editingPuzzle?.id });
  if (!r.ok) return { ok: false, text: r.error };
  editingPuzzle = null;
  return { ok: true, text: 'Sent! Your puzzle shows up for players once it has been approved.', id: Number(r.value.id) || undefined };
}

// When a Sandbox puzzle is solved (a fixed ball reached a fixed basket) the run stops and we offer to save and publish it.
const askEl = document.getElementById('pubask') as HTMLElement;
const askName = document.getElementById('pubask-name') as HTMLInputElement;
const askMsg = document.getElementById('pubask-msg') as HTMLElement;
const askYes = document.getElementById('pubask-yes') as HTMLButtonElement;

function onSandboxSolved() {
  ui.setStatus('Solved!', 'solved');
  playSound('success');
  window.setTimeout(() => {
    if (!playing || !sim.solved || level.id !== 'sandbox' || previewing) return;
    askName.value = editingPuzzle?.title ?? askName.value;
    askMsg.hidden = true;
    askYes.disabled = false;
    askEl.hidden = false;
    askName.focus();
  }, 500);
}

function closeAsk() {
  askEl.hidden = true;
  if (playing) stop();
}

async function saveAndPublish() {
  askYes.disabled = true;
  askMsg.hidden = false;
  askMsg.classList.remove('bad');
  askMsg.textContent = 'Saving and sending…';
  const name = askName.value.trim();
  // A puzzle must be saved in My builds before it can be published.
  const list = loadBuilds(player);
  const mine = exportParts();
  const sig = (l: unknown[]) => JSON.stringify((l as { type?: string; x?: number; y?: number; angle?: number; w?: number; h?: number; flip?: boolean; fixed?: boolean }[]).map((p) => [p.type, p.x, p.y, p.angle, p.w, p.h, !!p.flip, !!p.fixed]));
  let build = list.find((x) => sig(x.parts) === sig(mine));
  let all = list;
  if (!build) {
    const added = addBuild(list, name || 'My puzzle', mine, Date.now());
    if (!added) {
      askYes.disabled = false;
      askMsg.classList.add('bad');
      askMsg.textContent = 'A puzzle must be saved first, but all 10 My builds slots are used. Delete or replace one, then publish again.';
      return;
    }
    if (!saveBuilds(player, added)) {
      askYes.disabled = false;
      askMsg.classList.add('bad');
      askMsg.textContent = 'Your browser would not save this build, so it cannot be published. Is private browsing on?';
      return;
    }
    all = added;
    build = added[added.length - 1];
  }
  const r = await doPublish(name);
  if (r.ok && r.id) saveBuilds(player, linkBuildPuzzle(all, build.id, r.id));
  askYes.disabled = false;
  askMsg.classList.toggle('bad', !r.ok);
  askMsg.textContent = r.ok ? `Saved in My builds. ${r.text}` : r.text;
  if (r.ok) window.setTimeout(closeAsk, 2200);
}

document.getElementById('btn-publish')?.addEventListener('click', () => {
  const { fixed, solution } = splitBoard(parts);
  const check = checkPuzzle(fixed, solution);
  if (!check.ok) {
    ui.toast(check.problem);
    return;
  }
  askName.value = editingPuzzle?.title ?? askName.value;
  askMsg.hidden = true;
  askYes.disabled = false;
  askEl.hidden = false;
  askName.focus();
});
askYes.addEventListener('click', () => void saveAndPublish());
document.getElementById('pubask-no')?.addEventListener('click', closeAsk);

function onCommunitySolved() {
  ui.setStatus('Solved!', 'solved');
  ui.setSolvedScores([]);
  const c = level.community!;
  const rate = document.getElementById('solved-rate') as HTMLElement;
  const msg = document.getElementById('rate-msg') as HTMLElement;
  const up = document.getElementById('rate-up') as HTMLButtonElement;
  const down = document.getElementById('rate-down') as HTMLButtonElement;
  up.classList.remove('on');
  down.classList.remove('on');
  msg.textContent = '';
  const dev = deviceId();
  rate.hidden = previewing || !dev;
  if (!previewing && dev) {
    void completePuzzle(dev, c.id, c.rev).then((r) => {
      if (r.ok && level.community?.id === c.id) {
        const v = Number(r.value.vote ?? 0);
        up.classList.toggle('on', v === 1);
        down.classList.toggle('on', v === -1);
      } else if (!r.ok) {
        msg.textContent = r.error;
      }
    });
  }
  playSound('success');
  try {
    burst(document.getElementById('confetti') as HTMLCanvasElement);
  } catch {
    /* cosmetic */
  }
  window.setTimeout(() => {
    if (playing && sim.solved) ui.showSolved(true);
  }, 700);
}

function castVote(v: 1 | -1) {
  const c = level.community;
  const dev = deviceId();
  if (!c || !dev || previewing) return;
  const msg = document.getElementById('rate-msg') as HTMLElement;
  void votePuzzle(dev, c.id, v).then((r) => {
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    msg.textContent = 'Thanks!';
    document.getElementById('rate-up')?.classList.toggle('on', v === 1);
    document.getElementById('rate-down')?.classList.toggle('on', v === -1);
  });
}

document.getElementById('btn-community')?.addEventListener('click', openCommunity);
document.getElementById('cm-close')?.addEventListener('click', closeCommunity);
document.getElementById('btn-more')?.addEventListener('click', openCommunity);
document.getElementById('rate-up')?.addEventListener('click', () => castVote(1));
document.getElementById('rate-down')?.addEventListener('click', () => castVote(-1));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cmEl.hidden) closeCommunity();
});

buildsBtn.addEventListener('click', openBuilds);
document.getElementById('builds-close')?.addEventListener('click', closeBuilds);
document.getElementById('builds-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  buildsSay('');
  if (!exportParts().length) {
    buildsSay('The board is empty. Add some parts first.', true);
    return;
  }
  const next = addBuild(buildList, buildsName.value, exportParts(), Date.now());
  if (!next) {
    buildsSay('All 10 slots are used. Delete one, or use “Replace with current”.', true);
    return;
  }
  if (persistBuilds(next)) {
    const saved = next[next.length - 1].name;
    buildsName.value = '';
    renderBuilds();
    buildsSay(`Saved as “${saved}”.`);
  }
});
document.getElementById('builds-share-current')?.addEventListener('click', () => {
  void shareParts('Sandbox build', exportParts(), null).then(() => {
    // A link made from the board itself has no row, so show it in the message instead.
    if (!sharedLinkFor && sharedLink) buildsSay(`Link ready: ${sharedLink}`);
  });
});

// A friend's link (?s=CODE): ask first, then load into the Sandbox as an unsaved copy.
function showShared() {
  if (!pendingShared) return;
  const who = pendingShared.author ? `${pendingShared.author} shared` : 'Someone shared';
  sharedText.textContent = `${who} a build called “${pendingShared.title}” (${pendingShared.parts.length} parts). Open it in the Sandbox? Your own board stays safe: Undo brings it back.`;
  sharedEl.hidden = false;
  sharedOpen.focus();
}
function closeShared() {
  sharedEl.hidden = true;
  pendingShared = null;
}
sharedEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeShared();
});
document.getElementById('shared-no')?.addEventListener('click', closeShared);
sharedOpen.addEventListener('click', () => {
  if (!pendingShared) return;
  const incoming = importParts(pendingShared.parts);
  const title = pendingShared.title;
  loadLevel(sandboxIndex(), true);
  pushUndo();
  parts = [...parts.filter((p) => p.locked), ...incoming];
  changed();
  closeShared();
  ui.toast(`Opened “${title}”. Press 📁 My builds to save it.`);
});
async function openSharedFromAddress() {
  const code = shareCodeFromSearch(window.location.search);
  if (!code) return;
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    /* ignore */
  }
  const r = await fetchShared(code);
  if (!r.ok) {
    ui.toast(r.error);
    return;
  }
  pendingShared = r.value;
  const gate = document.getElementById('gate') as HTMLElement;
  if (!gate.hidden) {
    // Wait until the name box has been dealt with.
    const watch = new MutationObserver(() => {
      if (gate.hidden) {
        watch.disconnect();
        showShared();
      }
    });
    watch.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  } else {
    showShared();
  }
}

void openSharedFromAddress();


// ---------------------------------------------------------------------------
// Level dropdown (campaign) and Sandbox button
// ---------------------------------------------------------------------------
const menuBtn = document.getElementById('btn-campaign') as HTMLButtonElement;
const menuEl = document.getElementById('level-menu') as HTMLElement;
const menuList = document.getElementById('level-menu-list') as HTMLElement;
const menuNote = document.getElementById('level-menu-note') as HTMLElement;
const menuSummary = document.getElementById('level-menu-summary') as HTMLElement;

/** How many of the 3 community boards (shortest, fastest, spare) this player leads or ties on a level. */
/** Boards (in the order of CATEGORIES) on which this player is number one or tied, using only boards fetched from the server just now. */
function starsFor(levelId: string): boolean[] | null {
  const board = starBoards[levelId];
  if (!board || !player) return null;
  return CATEGORIES.map((c) => holdsBest(board, c, player) !== null);
}
/** Community boards fetched for the level list; emptied each time the list is opened so an old board can never show a star. */
let starBoards: Record<string, Board> = {};

function campaignLevels(): { level: Level; index: number }[] {
  return LEVELS.map((l, index) => ({ level: l, index })).filter((x) => x.level.hasGoal);
}

function renderMenu() {
  const list = campaignLevels();
  menuList.innerHTML = '';
  let stars = 0;
  let known = 0;
  for (const { level: l, index } of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    btn.setAttribute('role', 'option');
    const done = solvedLevels.has(l.id);
    const here = l.id === level.id;
    if (done) btn.classList.add('done');
    if (here) btn.classList.add('current');
    btn.setAttribute('aria-selected', String(here));
    const marks = starsFor(l.id);
    const st = marks === null ? null : marks.filter(Boolean).length;
    if (st !== null) {
      stars += st;
      known++;
    }
    const num = document.createElement('span');
    num.className = 'menu-num';
    num.textContent = done ? '✓' : String(index + 1);
    const name = document.createElement('span');
    name.className = 'menu-name';
    name.textContent = l.name;
    const star = document.createElement('span');
    star.className = 'menu-stars';
    star.replaceChildren();
    if (marks !== null) {
      // One mark per board, always in the same order: shortest path, fastest solve, most spare tools.
      // A gold star = you hold (or tie) number one there; a grey dot = not yet.
      CATEGORIES.forEach((c, i) => {
        const mark = document.createElement('span');
        mark.className = marks[i] ? 'star-on' : 'star-off';
        mark.textContent = marks[i] ? '★' : '•';
        mark.title = `${CATEGORY_INFO[c].label}: ${marks[i] ? 'you hold the community best' : 'not yet'}`;
        star.appendChild(mark);
      });
    }
    btn.append(num, name, star);
    btn.setAttribute('aria-label', `Level ${index + 1}: ${l.name}${done ? ', solved' : ''}${st === null ? '' : `, ${st} of 3 stars`}`);
    btn.addEventListener('click', () => {
      closeMenu();
      loadLevel(index, true);
    });
    li.appendChild(btn);
    menuList.appendChild(li);
  }
  const solved = list.filter((x) => solvedLevels.has(x.level.id)).length;
  menuSummary.textContent = `${solved} of ${list.length} solved` + (known ? ` · ★ ${stars} of ${list.length * 3}` : '');
  menuNote.hidden = !(communityLoaded && known === 0);
  menuNote.textContent = 'Stars need the score server, which could not be reached.';
}

let communityLoaded = false;
/** Fetch every level's community board, then redraw the menu if it is open. */
async function loadAllCommunity() {
  communityLoaded = false;
  const mine = (starBoards = {});
  await Promise.all(
    campaignLevels().map(async ({ level: l }) => {
      const b = await fetchCommunity(l.id);
      if (b) {
        community[l.id] = b;
        mine[l.id] = b;
      }
    }),
  );
  communityLoaded = true;
  if (!menuEl.hidden) renderMenu();
}

function closeMenu() {
  menuEl.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
function openMenu() {
  starBoards = {};
  renderMenu();
  menuEl.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  menuEl.querySelector<HTMLElement>('.menu-item.current')?.scrollIntoView({ block: 'nearest' });
  void loadAllCommunity();
}
menuBtn.addEventListener('click', () => (menuEl.hidden ? openMenu() : closeMenu()));
menuEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    closeMenu();
    menuBtn.focus();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!menuEl.hidden && !(e.target as HTMLElement).closest('.level-pick')) closeMenu();
});
document.getElementById('btn-sandbox')?.addEventListener('click', () => {
  closeMenu();
  if (level.id !== 'sandbox') loadLevel(sandboxIndex(), true);
});

if (player) void loadAllCommunity();

// Other players keep setting records while this page is open: refresh the board when the tab comes back into view.
let lastBoardRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - lastBoardRefresh < 15000) return;
  lastBoardRefresh = Date.now();
  loadCommunity();
  if (!menuEl.hidden) void loadAllCommunity();
});

// Small hook for automated tests and for curious engineers in the console.
(window as unknown as { tim: unknown }).tim = {
  sim,
  levels: LEVELS,
  get parts() {
    return parts;
  },
  get tool() {
    return tool;
  },
  view,
  get player() {
    return player;
  },
  scores: allScores,
  loadLevel: (i: number) => loadLevel(i, false),
  addSolution: () => {
    parts.push(...solutionToParts(level, nextId));
    rebuild();
    refreshUI();
  },
  start,
  stop,
  place: (type: PartType, x: number, y: number) => placeAt(type, x, y),
  rotateSelected: (dir: 1 | -1) => rotate(dir),
};
