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
import { LEVELS, levelToParts, solutionToParts, type Level } from './game/levels';
import { PART_DEFS, isGear, type PartType, type PlacedPart } from './game/parts';
import { Simulation, WORLD_H, WORLD_W, FLOOR_TOP, STEP_MS, type Trail } from './game/world';
import { snapGear } from './game/mechanics';
import { drawBodies, drawDecoration, drawPaper, drawUnderlay, traceBodies, type DrawState } from './game/draw';
import { UI, type Remaining, type SolvedRow } from './game/ui';
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
let hover: { x: number; y: number } | null = null;
let hoverId: number | undefined;
let drag: { id: number; dx: number; dy: number; moved: boolean; before: PlacedPart[] } | null = null;
let paletteDrag: { type: PartType; x0: number; y0: number; active: boolean } | null = null;
let suppressPaletteClick = false;
let undoStack: PlacedPart[][] = [];
let lastTrails: Trail[] = [];
let showPaths = true;
let solvedLevels = loadSolved();
/** Who is playing (asked on the first visit, then remembered) and everyone's best runs on this device. */
let player = loadPlayer();
const allScores: AllScores = loadScores();

// Camera: `z` is the zoom factor, (cx, cy) the world point at the top-left of the view.
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const view = { z: 1, cx: 0, cy: 0 };
let pan: { x0: number; y0: number; cx0: number; cy0: number; moved: boolean; lockedHit: boolean } | null = null;
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
  const maxH = stacked ? Infinity : r.height;
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
  onReset: () => loadLevel(levelIndex, false),
  onUndo: () => undo(),
  onRotate: (dir) => rotate(dir),
  onFlip: () => flip(),
  onPower: (p) => setPower(p),
  onDelete: () => deleteSelected(),
  onSelectLevel: (i) => loadLevel(i, true),
  onNext: () => loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1), true),
  onBackToEdit: () => stop(),
  onTogglePaths: (show) => (showPaths = show),
  onZoomIn: () => zoomStep(1.25),
  onZoomOut: () => zoomStep(1 / 1.25),
  onZoomReset: () => resetZoom(),
  onNameChosen: (name) => {
    const first = player === '';
    player = name;
    savePlayer(name);
    ui.setPlayer(name);
    ui.closeGate();
    refreshScores();
    ui.toast(first ? `Hi, ${name}! Let's build a machine.` : `Now playing as ${name}.`);
  },
});

sim.onSolved = (info) => {
  solvedLevels.add(level.id);
  saveSolved();
  ui.setLevels(LEVELS, levelIndex, solvedLevels);
  ui.setStatus('Solved!', 'solved');

  // Score this run: how far the ball went, and how many parts were not needed.
  const run = { pathMeters: pathMeters(info.pathPx), seconds: stepsToSeconds(info.steps), spare: spareTools() };
  const results = player ? recordRun(allScores, level.id, player, run) : [];
  if (results.length) {
    saveScores(allScores);
    refreshScores();
  }
  ui.setSolvedScores(describeRun(run, results));

  window.setTimeout(() => {
    if (playing && sim.solved) ui.showSolved(true);
  }, 700);
};

/** Parts from this level's inventory that the player did not use (the sandbox has no inventory limit). */
function spareTools(): number {
  let total = 0;
  for (const left of Object.values(remaining())) if (typeof left === 'number') total += left;
  return total;
}

/** The lines shown on the Solved card, one per score category. */
function describeRun(run: { pathMeters: number; seconds: number; spare: number }, results: RunResult[]): SolvedRow[] {
  return results.map((r) => {
    let note = '';
    let kind: SolvedRow['kind'] = 'plain';
    if (r.record) {
      note = 'New record!';
      kind = 'record';
    } else if (r.improved && r.rank !== null) {
      note = `New personal best, #${r.rank} on the board`;
      kind = 'board';
    } else if (r.rank !== null) {
      note = `Your best is #${r.rank} on the board`;
    } else if (r.category === 'spare' && run.spare === 0) {
      note = 'Try solving it with a part to spare';
    }
    return { label: CATEGORY_INFO[r.category].label, value: formatValue(r.category, r.value), note, kind };
  });
}

function refreshScores() {
  ui.setScores(level, level.hasGoal ? (allScores[level.id] ?? emptyBoard()) : null, player);
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

function restoreSandbox(): PlacedPart[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SANDBOX_KEY) ?? '[]') as PlacedPart[];
    return saved.filter((p) => p && p.type in PART_DEFS).map((p) => ({ ...p, id: nextId(), locked: false }));
  } catch {
    return [];
  }
}

/** Parts left to place per type (null = unlimited). Only listed types appear in the palette. */
function remaining(): Remaining {
  const out: Remaining = {};
  if (level.inventory === null) {
    for (const type of Object.keys(PART_DEFS) as PartType[]) out[type] = null;
    return out;
  }
  for (const [type, count] of Object.entries(level.inventory) as [PartType, number][]) {
    const used = parts.filter((p) => !p.locked && p.type === type).length;
    out[type] = Math.max(0, count - used);
  }
  return out;
}

const selectedPart = () => parts.find((p) => p.id === selectedId);

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
  view.cx = clamp(view.cx, 0, WORLD_W - WORLD_W / view.z);
  view.cy = clamp(view.cy, 0, WORLD_H - WORLD_H / view.z);
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
  zoomAt(factor, view.cx + WORLD_W / view.z / 2, view.cy + WORLD_H / view.z / 2);
}

function resetZoom() {
  view.z = 1;
  view.cx = 0;
  view.cy = 0;
  ui.setZoom(1);
  updateToolbar();
}

function rebuild() {
  sim.goalEnabled = level.hasGoal;
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

function refreshUI() {
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
    { rotatable: def.rotatable, flippable: def.flippable, power: def.hasPower ? sel.power ?? 2 : null },
  );
}

// ---------------------------------------------------------------------------
// Mode / level control
// ---------------------------------------------------------------------------

/** `restore` brings back a saved sandbox build; Reset passes false to clear it. */
function loadLevel(index: number, restore: boolean) {
  levelIndex = index;
  level = LEVELS[index];
  idCounter = 1;
  parts = levelToParts(level, nextId);
  if (level.id === 'sandbox' && restore) parts.push(...restoreSandbox());

  playing = false;
  tool = null;
  toolAngle = 0;
  selectedId = null;
  drag = null;
  undoStack = [];
  lastTrails = [];
  view.z = 1;
  view.cx = 0;
  view.cy = 0;
  ui.setZoom(1);
  rebuild();
  persistSandbox();

  ui.setLevels(LEVELS, levelIndex, solvedLevels);
  ui.setLevelInfo(level, levelIndex < LEVELS.length - 1);
  ui.setSolvedScores([]);
  refreshScores();
  ui.setPalette(remaining());
  ui.setRunning(false);
  ui.showSolved(false);
  ui.setStatus('Building');
  const first = Object.keys(remaining())[0] as PartType | undefined;
  ui.showPartInfo(first ?? null);
  refreshUI();
}

function start() {
  if (playing) return;
  playing = true;
  tool = null;
  selectedId = null;
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

function selectTool(type: PartType | null) {
  if (playing) return;
  if (type && remaining()[type] === 0) {
    ui.toast(`No ${PART_DEFS[type].label.toLowerCase()}s left. Drag one you placed, or delete one.`);
    return;
  }
  tool = type;
  if (type) {
    selectedId = null;
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
    pushUndo();
    sel.angle += dir * ROTATE_STEP;
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
  if (playing || !sel || sel.locked || !PART_DEFS[sel.type].hasPower) return;
  pushUndo();
  sel.power = clamp(power, 1, 3);
  changed();
}

function deleteById(id: number) {
  const part = parts.find((p) => p.id === id);
  if (!part || part.locked) return;
  pushUndo();
  parts = parts.filter((p) => p.id !== id);
  if (selectedId === id) selectedId = null;
  changed();
}

function deleteSelected() {
  if (!playing && selectedId !== null) deleteById(selectedId);
}

function undo() {
  if (playing) return;
  const prev = undoStack.pop();
  if (!prev) return;
  parts = prev;
  selectedId = null;
  changed();
}

/** Grid-snap a part to (x, y); gears also click into mesh with a nearby gear. */
function positionPart(p: PlacedPart, x: number, y: number) {
  p.x = clamp(snap(x), 10, WORLD_W - 10);
  p.y = clamp(snap(y), 10, FLOOR_TOP - 10);
  if (isGear(p.type)) {
    const raw = { ...p, x: clamp(x, 10, WORLD_W - 10), y: clamp(y, 10, FLOOR_TOP - 10) };
    const snapped = snapGear(raw, parts);
    if (snapped) {
      p.x = snapped.x;
      p.y = snapped.y;
      p.angle = snapped.angle;
    }
  }
}

function placeAt(type: PartType, x: number, y: number) {
  if (remaining()[type] === 0) return;
  const def = PART_DEFS[type];
  pushUndo();
  const part: PlacedPart = {
    id: nextId(),
    type,
    x: 0,
    y: 0,
    angle: def.rotatable ? toolAngle : 0,
    power: def.hasPower ? 2 : undefined,
  };
  positionPart(part, x, y);
  parts.push(part);
  selectedId = part.id;
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
    else if (view.z > 1) cursor = 'grab';
  }
  if (pan?.moved && view.z > 1) cursor = 'grabbing';
  canvas.style.cursor = cursor;
}

/** Cancel a part drag (used when a second finger turns it into a pinch). */
function cancelDrag() {
  if (!drag) return;
  if (drag.moved) {
    parts = drag.before;
    rebuild();
  }
  drag = null;
}

canvas.addEventListener('pointerdown', (e) => {
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
  const startPan = (lockedHit: boolean) => {
    pan = { x0: e.clientX, y0: e.clientY, cx0: view.cx, cy0: view.cy, moved: false, lockedHit };
  };

  // While the machine runs you can still look around.
  if (playing) {
    startPan(false);
    updateCursor();
    return;
  }

  const touch = e.pointerType === 'touch';
  // Tolerances are screen pixels, so divide by zoom to get world units.
  // With a part in hand, only a click right on another part picks that one up instead.
  const tolerance = (tool ? (touch ? 8 : 3) : touch ? 26 : 16) / view.z;
  const ownId = sim.partNear(p.x, p.y, tolerance, ownParts);

  if (ownId !== undefined) {
    const part = parts.find((q) => q.id === ownId)!;
    tool = null;
    selectedId = part.id;
    drag = { id: part.id, dx: part.x - p.x, dy: part.y - p.y, moved: false, before: clone(parts) };
    ui.showPartInfo(part.type);
  } else if (tool) {
    const t = tool;
    placeAt(t, p.x, p.y);
    // Keep the tool if Shift is held (quick way to place a row of dominoes).
    if (!e.shiftKey || remaining()[t] === 0) tool = null;
  } else {
    // Empty space (or a puzzle part): drag to pan the view, tap to deselect.
    const lockedId = sim.partNear(p.x, p.y, tolerance, (q) => !!q.locked);
    startPan(lockedId !== undefined);
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
    if (pan.moved && view.z > 1) {
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
  if (drag) {
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
    if (!p.moved && playing) ui.toast('Press Stop to change your machine.');
    else if (!p.moved) {
      selectedId = null;
      if (p.lockedHit) ui.toast('That part belongs to the puzzle, so it stays put.');
      refreshUI();
    }
    updateCursor();
  }
  endDrag();
}

function endDrag() {
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
    selectedId = null;
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
    tool = null;
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
    selectedId = null;
    refreshUI();
  } else if (e.key.startsWith('Arrow')) {
    const sel = selectedPart();
    if (!sel || sel.locked || playing) return;
    e.preventDefault();
    pushUndo();
    const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key] ?? [0, 0];
    positionPart(sel, sel.x + d[0], sel.y + d[1]);
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
  ctx.setTransform(scale, 0, 0, scale, -view.cx * scale, -view.cy * scale);
  drawPaper(ctx, WORLD_W, WORLD_H, FLOOR_TOP);

  const state: DrawState = { steps: sim.steps, playing, train: sim.gearTrain };
  const bodies = sim.allBodies();

  if (showPaths) {
    if (playing) drawTrails([...sim.trails.values()], false);
    else drawTrails(lastTrails, true);
  }

  // Ghost of the part being placed: show where it will go (and gear snapping).
  const ghostBodies = (() => {
    if (playing || !tool || !hover) return null;
    const def = PART_DEFS[tool];
    const ghost: PlacedPart = { id: -1, type: tool, x: 0, y: 0, angle: def.rotatable ? toolAngle : 0, power: 2 };
    positionPart(ghost, hover.x, hover.y);
    return def.build(ghost, false);
  })();

  const sensors = bodies.filter((b) => b.isSensor);
  const solids = bodies.filter((b) => !b.isSensor);
  for (const b of solids) drawUnderlay(ctx, b, state);
  drawBodies(ctx, sensors, state);
  drawBodies(ctx, solids, state);
  for (const b of solids) drawDecoration(ctx, b, state);

  if (!playing) {
    drawGearLinks();

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
}

// ---------------------------------------------------------------------------
// Fixed-timestep game loop (physics only advances while playing)
// ---------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(now - last, 100);
  last = now;
  if (playing) {
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

loadLevel(0, true);

// First visit: ask for a name. Returning visit: it was stored, so just say hello.
for (const id of ['version-tag', 'version-badge']) {
  const el = document.getElementById(id);
  if (el) el.textContent = id === 'version-badge' ? `Modern TIM v${VERSION}` : VERSION;
}
ui.setPlayer(player);
if (player) ui.toast(`Welcome back, ${player}!`);
else ui.openGate();

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
};
