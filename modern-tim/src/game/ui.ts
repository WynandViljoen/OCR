/**
 * UI layer: palette, level chips, buttons, science corner, the floating part
 * toolbar and the "Solved!" card. It only touches the DOM shell in index.html
 * and reports user intent through `UIHandlers`; game state lives in main.ts.
 */
import { PALETTE_ORDER, PART_DEFS, type PartType } from './parts';
import type { Level } from './levels';
import { drawThumbnail } from './draw';
import { CATEGORIES, CATEGORY_INFO, formatValue, sanitizeName, type Board } from './profile';

export interface UIHandlers {
  onPaletteClick(type: PartType): void;
  onPaletteDragStart(type: PartType, e: PointerEvent): void;
  onToggleRun(): void;
  onReset(): void;
  onUndo(): void;
  onRotate(direction: 1 | -1): void;
  onFlip(): void;
  onPower(level: number): void;
  onDelete(): void;
  onSelectLevel(index: number): void;
  onNext(): void;
  onBackToEdit(): void;
  onTogglePaths(show: boolean): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  /** The player typed a valid name in the name dialog. */
  onNameChosen(name: string): void;
}

/** One line on the Solved card: how this run did in one score category. */
export interface SolvedRow {
  label: string;
  value: string;
  note: string;
  kind: 'record' | 'board' | 'plain';
}

export type Remaining = Partial<Record<PartType, number | null>>;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

export interface ToolbarOptions {
  rotatable: boolean;
  flippable: boolean;
  power: number | null;
}

export class UI {
  private paletteEl = $('palette');
  private levelsEl = $('levels');
  private runBtn = $('btn-run') as HTMLButtonElement;
  private undoBtn = $('btn-undo') as HTMLButtonElement;
  private statusEl = $('status');
  private solvedEl = $('solved');
  private nextBtn = $('btn-next') as HTMLButtonElement;
  private toolbar = $('part-toolbar');
  private toastEl = $('toast');
  private infoEl = $('part-info');
  private partButtons = new Map<PartType, HTMLButtonElement>();
  private toastTimer = 0;
  private selectedTool: PartType | null = null;
  private gateEl = $('gate');
  private gateInput = $('gate-name') as HTMLInputElement;
  private currentName = '';

  constructor(private handlers: UIHandlers) {
    this.setupGate();
    this.runBtn.addEventListener('click', () => handlers.onToggleRun());
    $('btn-reset').addEventListener('click', () => handlers.onReset());
    this.undoBtn.addEventListener('click', () => handlers.onUndo());
    $('btn-next').addEventListener('click', () => handlers.onNext());
    $('btn-replay').addEventListener('click', () => handlers.onBackToEdit());
    $('tb-rot-l').addEventListener('click', () => handlers.onRotate(-1));
    $('tb-rot-r').addEventListener('click', () => handlers.onRotate(1));
    $('tb-flip').addEventListener('click', () => handlers.onFlip());
    $('tb-delete').addEventListener('click', () => handlers.onDelete());
    this.toolbar.querySelectorAll<HTMLButtonElement>('[data-power]').forEach((b) =>
      b.addEventListener('click', () => handlers.onPower(Number(b.dataset.power))),
    );
    $('zoom-in').addEventListener('click', () => handlers.onZoomIn());
    $('zoom-out').addEventListener('click', () => handlers.onZoomOut());
    $('zoom-reset').addEventListener('click', () => handlers.onZoomReset());
    $('zoom-controls').addEventListener('pointerdown', (e) => e.stopPropagation());
    const paths = $('show-paths') as HTMLInputElement;
    paths.addEventListener('change', () => handlers.onTogglePaths(paths.checked));

    // Keep the toolbar's own pointer events away from the board underneath.
    this.toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Buttons keep focus after a click, which would make Space "click" them
    // again. Blur so Space always means start/stop.
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b) b.blur();
    });
  }

  setLevels(levels: Level[], current: number, solved: Set<string>) {
    this.levelsEl.innerHTML = '';
    levels.forEach((l, i) => {
      const b = document.createElement('button');
      b.className = 'level-chip';
      b.type = 'button';
      if (i === current) b.classList.add('current');
      if (solved.has(l.id)) b.classList.add('done');
      const label = l.hasGoal ? String(i + 1) : '★';
      b.innerHTML = `<span class="num">${label}</span><span class="name">${l.name}</span>`;
      b.title = `${l.name}: ${l.science.topic}`;
      b.setAttribute('aria-label', `Level ${label}: ${l.name}${solved.has(l.id) ? ' (solved)' : ''}`);
      b.addEventListener('click', () => this.handlers.onSelectLevel(i));
      this.levelsEl.appendChild(b);
    });
  }

  setLevelInfo(level: Level, hasNext: boolean) {
    $('goal-text').textContent = level.goal;
    $('sci-topic').textContent = level.science.topic;
    $('sci-text').textContent = level.science.text;
    $('sci-try').textContent = level.science.tryThis;
    $('solved-learned').textContent = level.science.learned;
    this.nextBtn.hidden = !hasNext;
  }

  /** Rebuild the palette. Only part types listed in `remaining` appear. */
  setPalette(remaining: Remaining) {
    this.paletteEl.innerHTML = '';
    this.partButtons.clear();
    for (const type of PALETTE_ORDER) {
      if (!(type in remaining)) continue;
      const def = PART_DEFS[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'part-btn';
      btn.title = def.blurb;
      btn.innerHTML = `<canvas class="thumb" aria-hidden="true"></canvas><span class="part-name">${def.label}</span><span class="count"></span>`;
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.handlers.onPaletteDragStart(type, e);
      });
      btn.addEventListener('click', () => this.handlers.onPaletteClick(type));
      btn.addEventListener('pointerenter', () => this.showPartInfo(type));
      this.paletteEl.appendChild(btn);
      this.partButtons.set(type, btn);
      drawThumbnail(btn.querySelector('canvas')!, type);
    }
    this.updateCounts(remaining);
  }

  updateCounts(remaining: Remaining) {
    for (const [type, btn] of this.partButtons) {
      const left = remaining[type];
      const count = btn.querySelector('.count')!;
      count.textContent = left === null || left === undefined ? '∞' : `×${left}`;
      btn.classList.toggle('empty', left === 0);
      btn.classList.toggle('selected', type === this.selectedTool);
    }
  }

  setSelectedTool(type: PartType | null) {
    this.selectedTool = type;
    for (const [t, btn] of this.partButtons) btn.classList.toggle('selected', t === type);
  }

  showPartInfo(type: PartType | null) {
    if (!type) return;
    const def = PART_DEFS[type];
    this.infoEl.innerHTML = '';
    const h = document.createElement('strong');
    h.textContent = def.label;
    const p = document.createElement('span');
    p.textContent = def.blurb;
    this.infoEl.append(h, p);
  }

  /** Show the floating toolbar above (or below) a part, in % of the board, or hide it. */
  showToolbar(pos: { left: number; top: number; below: boolean } | null, opts?: ToolbarOptions) {
    if (!pos || !opts) {
      this.toolbar.hidden = true;
      return;
    }
    this.toolbar.hidden = false;
    this.toolbar.style.left = `${pos.left}%`;
    this.toolbar.style.top = `${pos.top}%`;
    this.toolbar.classList.toggle('below', pos.below);
    $('tb-rot-l').hidden = !opts.rotatable;
    $('tb-rot-r').hidden = !opts.rotatable;
    $('tb-flip').hidden = !opts.flippable;
    const powerRow = $('tb-power');
    powerRow.hidden = opts.power === null;
    powerRow.querySelectorAll<HTMLButtonElement>('[data-power]').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.power) === opts.power),
    );
  }

  setZoom(z: number) {
    $('zoom-reset').textContent = `${Math.round(z * 100)}%`;
    ($('zoom-out') as HTMLButtonElement).disabled = z <= 1.001;
    ($('zoom-in') as HTMLButtonElement).disabled = z >= 2.999;
  }

  setUndoEnabled(enabled: boolean) {
    this.undoBtn.disabled = !enabled;
  }

  setRunning(running: boolean) {
    this.runBtn.innerHTML = running
      ? '<span class="btn-icon">■</span> Stop'
      : '<span class="btn-icon">▶</span> Start';
    this.runBtn.classList.toggle('running', running);
    document.body.classList.toggle('is-running', running);
    this.paletteEl.classList.toggle('disabled', running);
  }

  setStatus(text: string, kind: 'edit' | 'running' | 'solved' = 'edit') {
    this.statusEl.textContent = text;
    this.statusEl.dataset.kind = kind;
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  showSolved(show: boolean) {
    this.solvedEl.hidden = !show;
  }

  // -------------------------------------------------------------------------
  // Player name
  // -------------------------------------------------------------------------

  private setupGate() {
    const error = $('gate-error');
    const clearError = () => (error.hidden = true);
    this.gateInput.addEventListener('input', clearError);
    $('gate-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sanitizeName(this.gateInput.value);
      if (!name) {
        error.textContent = 'Enter a name to continue.';
        error.hidden = false;
        this.gateInput.focus();
        return;
      }
      this.handlers.onNameChosen(name);
    });
    $('gate-cancel').addEventListener('click', () => this.closeGate());
    // Keys typed in the dialog must never reach the game shortcuts (Space starts the machine).
    this.gateEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !($('gate-cancel') as HTMLButtonElement).hidden) this.closeGate();
      e.stopPropagation();
    });
    $('player-chip').addEventListener('click', () => this.openGate());
  }

  /** Show the player's name in the top bar. */
  setPlayer(name: string) {
    this.currentName = name;
    $('player-name').textContent = name || 'Player';
  }

  /** Ask for a name. First visit: no way to skip. Changing player: can be cancelled. */
  openGate() {
    const changing = this.currentName !== '';
    $('gate-title').textContent = changing ? 'Change player' : 'Welcome to Modern TIM!';
    $('gate-text').textContent = changing
      ? 'Who is playing now? Scores go under this name.'
      : 'What is your name? It goes on the high score board.';
    ($('gate-cancel') as HTMLButtonElement).hidden = !changing;
    $('gate-error').hidden = true;
    this.gateInput.value = this.currentName;
    this.gateEl.hidden = false;
    $('app').setAttribute('inert', '');
    window.setTimeout(() => {
      this.gateInput.focus();
      this.gateInput.select();
    }, 0);
  }

  closeGate() {
    this.gateEl.hidden = true;
    $('app').removeAttribute('inert');
  }

  // -------------------------------------------------------------------------
  // High scores
  // -------------------------------------------------------------------------

  /** Fill the High scores card for the current level. `board` is null for levels without a goal. */
  setScores(level: Level, board: Board | null, player: string) {
    $('scores-level').textContent = level.hasGoal ? level.name : 'Sandbox';
    const body = $('scores-body');
    body.innerHTML = '';
    if (!board) {
      const p = document.createElement('p');
      p.className = 'scores-empty';
      p.textContent = 'The sandbox has no goal, so there are no scores here. Build anything you like.';
      body.appendChild(p);
      return;
    }
    for (const category of CATEGORIES) {
      const info = CATEGORY_INFO[category];
      const section = document.createElement('section');
      section.className = 'board-group';
      const h = document.createElement('h3');
      h.textContent = info.label;
      h.title = info.blurb;
      section.appendChild(h);
      const rows = board[category].slice(0, 3);
      if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'scores-empty';
        p.textContent = 'No score yet. Be the first!';
        section.appendChild(p);
      } else {
        const ol = document.createElement('ol');
        rows.forEach((entry) => {
          const li = document.createElement('li');
          if (entry.name.toLowerCase() === player.toLowerCase()) li.className = 'me';
          const who = document.createElement('span');
          who.className = 'who';
          who.textContent = entry.name;
          const val = document.createElement('span');
          val.className = 'val';
          val.textContent = formatValue(category, entry.value);
          li.append(who, val);
          ol.appendChild(li);
        });
        section.appendChild(ol);
      }
      body.appendChild(section);
    }
  }

  /** The three score lines on the Solved card. */
  setSolvedScores(rows: SolvedRow[]) {
    const list = $('solved-scores');
    list.innerHTML = '';
    for (const row of rows) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'lab';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'val';
      value.textContent = row.value;
      li.append(label, value);
      if (row.note) {
        const badge = document.createElement('span');
        badge.className = `badge ${row.kind}`;
        badge.textContent = row.note;
        li.appendChild(badge);
      }
      list.appendChild(li);
    }
    list.hidden = rows.length === 0;
  }
}
