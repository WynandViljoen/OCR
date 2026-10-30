/**
 * UI layer: palette, level chips, buttons, science corner, the floating part
 * toolbar and the "Solved!" card. It only touches the DOM shell in index.html
 * and reports user intent through `UIHandlers`; game state lives in main.ts.
 */
import { PALETTE_GROUPS, PALETTE_ORDER, PART_DEFS, type PartType } from './parts';
import { feelOf, type PropSpec } from './props';
import type { Level } from './levels';
import { drawThumbnail } from './draw';
import { BOARD_SIZE, CATEGORIES, CATEGORY_INFO, emptyBoard, formatValue, sanitizeName, type Board } from './profile';
import type { StarsView } from './community';

/** Time left as "3 d 5 h", "5 h 10 min" or "12 min". */
export function leftText(secs: number): string {
  if (secs <= 0) return 'no time';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
}

export interface UIHandlers {
  onPaletteClick(type: PartType): void;
  onPaletteDragStart(type: PartType, e: PointerEvent): void;
  onToggleRun(): void;
  onReset(): void;
  onUndo(): void;
  onRotate(direction: 1 | -1): void;
  onFlip(): void;
  /** A slider in the Tinker lab: grab it, move it, let go. */
  onPropStart(): void;
  onProp(key: string, value: number): void;
  onPropEnd(): void;
  onPower(level: number): void;
  onDelete(): void;
  onSelectLevel(index: number): void;
  onNext(): void;
  onBackToEdit(): void;
  /** The ★ Stars tab was opened: fetch the top star earners. */
  onStarsTab(): void;
  onTogglePaths(show: boolean): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  /** The player typed a valid name in the name dialog. */
  onNameChosen(name: string): void;
}

/** One line on the Solved card: how this run did in one score category. */
/** What the Tinker lab card shows for the selected part. */
export interface PropsModel {
  id: number;
  title: string;
  items: { spec: PropSpec; value: number }[];
  /** Live facts such as "Turns 0.5 times a second". */
  facts: string[];
}

export interface ScoresView {
  level: Level;
  /** This browser's boards for the level, or null for levels without a goal. */
  mine: Board | null;
  /** The shared board from the server, if it has been fetched. */
  community: Board | null;
  status: 'loading' | 'ok' | 'offline';
  player: string;
}

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

  private runBtn = $('btn-run') as HTMLButtonElement;
  private undoBtn = $('btn-undo') as HTMLButtonElement;
  private statusEl = $('status');
  private solvedEl = $('solved');
  private failedEl = $('failed');
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
    this.setupScoresTabs();
    this.runBtn.addEventListener('click', () => handlers.onToggleRun());
    $('btn-reset').addEventListener('click', () => handlers.onReset());
    this.undoBtn.addEventListener('click', () => handlers.onUndo());
    $('btn-next').addEventListener('click', () => handlers.onNext());
    $('btn-replay').addEventListener('click', () => handlers.onBackToEdit());
    $('btn-edit').addEventListener('click', () => handlers.onBackToEdit());
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

  /** The top bar names the current level (a dropdown lists them all) and lights the Sandbox button. */
  setLevels(levels: Level[], current: number, _solved: Set<string>) {
    const l = levels[current];
    const sandbox = !l.hasGoal;
    $('level-now-text').textContent = sandbox ? 'Campaign levels' : `Level ${current + 1} · ${l.name}`;
    $('btn-campaign').classList.toggle('dim', sandbox);
    $('btn-sandbox').classList.toggle('active', sandbox);
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
  private lastRemaining: Remaining = {};
  private searchWired = false;
  private closedGroups(): Set<string> {
    try {
      return new Set(JSON.parse(window.localStorage.getItem('modern-tim:groups') || '[]') as string[]);
    } catch {
      return new Set();
    }
  }

  setPalette(remaining: Remaining) {
    this.paletteEl.innerHTML = '';
    this.partButtons.clear();
    this.lastRemaining = remaining;
    const types = PALETTE_ORDER.filter((t) => t in remaining);
    // A long list (the sandbox) is sorted into collapsible categories with a search box.
    const grouped = types.length > 7;
    const search = document.getElementById('palette-search') as HTMLInputElement | null;
    if (search) {
      search.hidden = !grouped;
      if (!this.searchWired) {
        this.searchWired = true;
        search.addEventListener('input', () => this.setPalette(this.lastRemaining));
      }
      if (!grouped) search.value = '';
    }
    const q = grouped && search ? search.value.trim().toLowerCase() : '';
    const makeButton = (type: PartType, into: HTMLElement) => {
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
      into.appendChild(btn);
      this.partButtons.set(type, btn);
      drawThumbnail(btn.querySelector('canvas')!, type);
    };
    if (!grouped) {
      this.paletteEl.classList.remove('grouped');
      for (const type of types) makeButton(type, this.paletteEl);
    } else {
      this.paletteEl.classList.add('grouped');
      const closed = this.closedGroups();
      for (const g of PALETTE_GROUPS) {
        const inGroup = g.types.filter((t) => types.includes(t) && (!q || PART_DEFS[t].label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)));
        if (!inGroup.length) continue;
        const open = q ? true : !closed.has(g.id);
        const box = document.createElement('section');
        box.className = 'palette-group' + (open ? '' : ' closed');
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'group-head';
        head.setAttribute('aria-expanded', String(open));
        head.innerHTML = `<span>${g.icon} ${g.label}</span><span class="group-count">${inGroup.length}</span><span class="chev" aria-hidden="true">▾</span>`;
        const grid = document.createElement('div');
        grid.className = 'group-grid';
        head.addEventListener('click', () => {
          const now = new Set(this.closedGroups());
          if (box.classList.contains('closed')) now.delete(g.id);
          else now.add(g.id);
          try {
            window.localStorage.setItem('modern-tim:groups', JSON.stringify([...now]));
          } catch {
            /* ignore */
          }
          this.setPalette(this.lastRemaining);
        });
        box.append(head, grid);
        this.paletteEl.appendChild(box);
        for (const type of inGroup) makeButton(type, grid);
      }
      if (!this.paletteEl.children.length) this.paletteEl.innerHTML = '<p class="palette-empty">No part matches that.</p>';
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

  /** Set by main.ts: what this level fixes about a part ("Heavy: 15 kg"), or ''. */
  presetNote: (type: PartType) => string = () => '';

  showPartInfo(type: PartType | null) {
    if (!type) return;
    const def = PART_DEFS[type];
    this.infoEl.innerHTML = '';
    const h = document.createElement('strong');
    h.textContent = def.label;
    const p = document.createElement('span');
    p.textContent = def.blurb;
    this.infoEl.append(h, p);
    const note = this.presetNote(type);
    if (note) {
      const n = document.createElement('em');
      n.className = 'preset-note';
      n.textContent = note;
      this.infoEl.append(n);
    }
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
    ($('zoom-out') as HTMLButtonElement).disabled = z <= 0.401;
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
    this.failedEl.hidden = true;
  }

  showFailed(text: string) {
    $('failed-why').textContent = text;
    this.failedEl.hidden = false;
  }

  setStatus(text: string, kind: 'edit' | 'running' | 'solved' | 'failed' = 'edit') {
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

  private propsId: number | null = null;
  private propsBusy = false;

  /** Show sliders for the selected part, or hide the card. Left alone while a slider is being dragged. */
  showProps(model: PropsModel | null) {
    const card = $('props-card');
    if (!model || (!model.items.length && !model.facts.length)) {
      card.hidden = true;
      this.propsId = null;
      return;
    }
    if (this.propsBusy && this.propsId === model.id) return;
    card.hidden = false;
    this.propsId = model.id;
    $('props-title').textContent = model.title;
    const body = $('props-body');
    body.innerHTML = '';
    for (const { spec, value } of model.items) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      const head = document.createElement('label');
      head.className = 'prop-head';
      const name = document.createElement('span');
      name.textContent = `${spec.icon} ${spec.label}`;
      const val = document.createElement('strong');
      val.textContent = spec.show(value);
      head.append(name, val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(value);
      input.setAttribute('aria-label', spec.label);
      const feel = document.createElement('p');
      feel.className = 'prop-feel';
      feel.textContent = feelOf(spec, value);
      const sci = document.createElement('p');
      sci.className = 'prop-sci';
      sci.textContent = spec.science;
      const begin = () => {
        if (!this.propsBusy) {
          this.propsBusy = true;
          this.handlers.onPropStart();
        }
      };
      const end = () => {
        if (this.propsBusy) {
          this.propsBusy = false;
          this.handlers.onPropEnd();
        }
      };
      input.addEventListener('pointerdown', begin);
      input.addEventListener('keydown', begin);
      input.addEventListener('input', () => {
        begin();
        const v = Number(input.value);
        val.textContent = spec.show(v);
        feel.textContent = feelOf(spec, v);
        this.handlers.onProp(spec.key, v);
      });
      input.addEventListener('change', end);
      input.addEventListener('pointerup', end);
      input.addEventListener('keyup', end);
      row.append(head, input, feel, sci);
      body.appendChild(row);
    }
    for (const fact of model.facts) {
      const p = document.createElement('p');
      p.className = 'prop-fact';
      p.textContent = fact;
      body.appendChild(p);
    }
  }

  private scoresView: ScoresView | null = null;
  private scoresTab: 'community' | 'mine' | 'stars' = 'community';
  private starsView: StarsView | 'loading' | 'offline' = 'loading';
  private starsAt = 0;

  /** Fill the High scores card for the current level. `view.mine` is null for levels without a goal. */
  setScores(view: ScoresView) {
    this.scoresView = view;
    this.renderScores();
  }

  private setupScoresTabs() {
    for (const tab of ['community', 'mine', 'stars'] as const) {
      $(`tab-${tab}`).addEventListener('click', () => {
        this.scoresTab = tab;
        if (tab === 'stars') {
          this.starsView = 'loading';
          this.handlers.onStarsTab();
        }
        this.renderScores();
      });
    }
  }

  /** The answer for the ★ Stars tab (null = the server could not be reached). */
  setStars(view: StarsView | null) {
    this.starsView = view ?? 'offline';
    this.starsAt = Date.now();
    if (this.scoresTab === 'stars') this.renderScores();
  }

  private renderScores() {
    const view = this.scoresView;
    if (!view) return;
    const { level, mine, community, status, player } = view;
    $('scores-level').textContent = level.hasGoal ? level.name : 'Sandbox';
    for (const tab of ['community', 'mine', 'stars'] as const) {
      const btn = $(`tab-${tab}`);
      const on = this.scoresTab === tab;
      btn.setAttribute('aria-selected', String(on));
      btn.classList.toggle('on', on);
    }
    $('scores-tabs').hidden = !mine;
    const body = $('scores-body');
    body.innerHTML = '';
    const note = (text: string) => {
      const p = document.createElement('p');
      p.className = 'scores-empty';
      p.textContent = text;
      body.appendChild(p);
    };
    if (!mine) {
      note('The sandbox has no goal, so there are no scores here. Build anything you like.');
      return;
    }

    if (this.scoresTab === 'stars') {
      $('scores-level').textContent = 'Star leaders';
      const v = this.starsView;
      if (v === 'loading') return note('Counting stars...');
      if (v === 'offline') return note('The star table is not reachable right now.');
      const champs = new Set((v.previous?.rows ?? []).filter((r) => r.stars === v.previous?.rows[0]?.stars).map((r) => r.name.toLowerCase()));
      const list = (rows: StarsView['rows'], crownFirst: boolean) => {
        const ol = document.createElement('ol');
        ol.className = 'star-list';
        rows.forEach((r, i) => {
          const li = document.createElement('li');
          if (r.name.toLowerCase() === player.toLowerCase()) li.className = 'me';
          const who = document.createElement('span');
          who.className = 'who';
          const crowned = crownFirst ? r.stars === rows[0].stars : champs.has(r.name.toLowerCase());
          who.textContent = `${i + 1}. ${r.name}${crowned ? ' \u{1F3C6}' : ''}`;
          who.title = crowned && !crownFirst ? 'Won last season' : '';
          const val = document.createElement('span');
          val.className = 'val';
          val.textContent = `\u2605 ${r.stars}`;
          li.append(who, val);
          ol.appendChild(li);
        });
        return ol;
      };
      const heading = (text: string) => {
        const p = document.createElement('p');
        p.className = 'season-head';
        p.textContent = text;
        body.appendChild(p);
      };
      if (v.season) {
        const left = v.season.end - (v.season.now + (Date.now() - this.starsAt) / 1000);
        heading(`${v.season.label} season \u00B7 ${leftText(left)} left`);
      }
      if (v.rows.length) body.appendChild(list(v.rows, false));
      else note('No stars yet this season. Be number one on a board to earn the first one!');
      if (v.previous) {
        heading(`Last season \u00B7 ${v.previous.label}`);
        if (v.previous.rows.length) body.appendChild(list(v.previous.rows, true));
        else note('Nobody held a star.');
      }
      note(`A star = number one (or tied) on one board. Each level has 3 boards, so the most anyone can hold is ${v.max}. Every month starts fresh.`);
      return;
    }

    if (this.scoresTab === 'mine') {
      for (const category of CATEGORIES) {
        const best = mine[category].find((e) => e.name.toLowerCase() === player.toLowerCase());
        const row = document.createElement('div');
        row.className = 'mine-row';
        const lab = document.createElement('span');
        lab.textContent = CATEGORY_INFO[category].label;
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = best ? formatValue(category, best.value) : 'not yet';
        if (!best) val.classList.add('none');
        row.append(lab, val);
        body.appendChild(row);
      }
      note(player ? `Your best on this level, ${player}. Stored in this browser.` : 'Enter a name to start keeping scores.');
      return;
    }

    if (status === 'loading' && !community) note('Loading community scores...');
    if (status === 'offline' && !community) {
      note('Community scores are not reachable right now. Your own scores still count and will be sent when the connection is back.');
      return;
    }
    const board = community ?? emptyBoard();
    for (const category of CATEGORIES) {
      const info = CATEGORY_INFO[category];
      const section = document.createElement('section');
      section.className = 'board-group';
      const h = document.createElement('h3');
      h.textContent = info.label;
      h.title = info.blurb;
      section.appendChild(h);
      const rows = board[category].slice(0, BOARD_SIZE);
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
    if (status === 'offline') note('Showing the last community scores. The server could not be reached just now.');
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
