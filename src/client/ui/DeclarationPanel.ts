/**
 * DeclarationPanel — drives the local player's turn declaration.
 *
 * Flow: pick move → choose action order (ATTACK_FIRST | MOVE_FIRST) →
 *  - MOVE_FIRST: click reachable tiles to build a path (budget shown),
 *  - ATTACK_FIRST: skip pathing,
 * then click a target tile within attack range → Confirm → onDeclare.
 *
 * All legality (reachable/attackable/validate) is driven by the injected local
 * BattleSession mirror so illegal declarations are blocked before sending.
 */

import {
  ActionOrder,
  MOVE_REGISTRY,
  tileKey,
  hexDistance,
  getHexArea,
  MoveCategory,
  TurnDeclaration,
  type BattleSession,
  type MoveDefinition,
} from '../../shared/index.ts';
import { el, ensureStyles, clearChildren } from './dom.ts';

export type HighlightSetter = (keys: string[], type: 'move' | 'attack' | 'path' | 'aoe' | 'target') => void;

export interface DeclarationCallbacks {
  onDeclare: (moveId: string, targetTile: [number, number] | null, movePath: [number, number][], order: ActionOrder) => void;
  setHighlights: (fn: (setter: HighlightSetter) => void) => void; // apply highlight batch
  clearHighlights: () => void;
}

type Phase = 'idle' | 'pickOrder' | 'buildPath' | 'pickTarget' | 'confirm';

export class DeclarationPanel {
  readonly root: HTMLElement;
  private movesRow: HTMLElement;
  private controls: HTMLElement;
  private hint: HTMLElement;

  private session: BattleSession | null = null;
  private localPlayerId = 1;
  private locked = false;

  private phase: Phase = 'idle';
  private move: MoveDefinition | null = null;
  private order: ActionOrder = ActionOrder.ATTACK_FIRST;
  private path: [number, number][] = [];
  private target: [number, number] | null = null;

  constructor(private cb: DeclarationCallbacks) {
    ensureStyles();
    this.root = el('div', { id: 'pbw-decl' });
    this.movesRow = el('div', { class: 'pbw-moves-row' });
    this.controls = el('div', { class: 'pbw-row', style: { justifyContent: 'center', gap: '8px', minHeight: '38px' } });
    this.hint = el('div', { class: 'pbw-hint' });
    this.root.append(this.hint, this.movesRow, this.controls);
    this.root.style.display = 'none';
  }

  setLocalPlayer(id: number): void {
    this.localPlayerId = id;
  }

  /** Called at the start of each declaration phase. */
  beginTurn(session: BattleSession): void {
    this.session = session;
    this.locked = false;
    this.reset();
    this.render();
    this.show();
  }

  private reset(): void {
    this.phase = 'idle';
    this.move = null;
    this.path = [];
    this.target = null;
    this.order = ActionOrder.ATTACK_FIRST;
    this.cb.clearHighlights();
  }

  private myPokemon() {
    const s = this.session!.getState();
    return this.localPlayerId === 1 ? s.pokemon.p1 : s.pokemon.p2;
  }

  private startTile(): [number, number] {
    const p = this.myPokemon();
    return p ? [p.tile[0], p.tile[1]] : [0, 0];
  }

  // ── Board interaction, called by GameController on tile pick ──
  handleTilePick(tile: [number, number]): void {
    if (this.locked || !this.session) return;
    if (this.phase === 'buildPath') this.extendPath(tile);
    else if (this.phase === 'pickTarget') this.chooseTarget(tile);
  }

  private extendPath(tile: [number, number]): void {
    const key = tileKey(tile[0], tile[1]);
    const start = this.startTile();
    if (tile[0] === start[0] && tile[1] === start[1]) {
      // reset to stay-in-place
      this.path = [start];
      this.refreshPathHighlights();
      return;
    }
    const reachable = new Set(this.session!.getReachableTiles(this.localPlayerId));
    if (!reachable.has(key)) {
      this.setHint('That tile is out of movement range.', true);
      return;
    }
    // Build path: if adjacent to current tail, append; else recompute a simple path.
    const last = this.path.length ? this.path[this.path.length - 1] : start;
    if (this.path.length === 0) this.path = [start];
    if (hexDistance(last[0], last[1], tile[0], tile[1]) === 1 && !this.containsTile(tile)) {
      this.path.push(tile);
    } else {
      this.path = this.computePath(start, tile) ?? this.path;
    }
    this.refreshPathHighlights();
  }

  private containsTile(t: [number, number]): boolean {
    return this.path.some((p) => p[0] === t[0] && p[1] === t[1]);
  }

  /** Greedy BFS path over reachable tiles (cosmetic; server truncates/validates). */
  private computePath(start: [number, number], goal: [number, number]): [number, number][] | null {
    const reachable = new Set(this.session!.getReachableTiles(this.localPlayerId));
    reachable.add(tileKey(start[0], start[1]));
    const q: [number, number][][] = [[start]];
    const seen = new Set([tileKey(start[0], start[1])]);
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    while (q.length) {
      const p = q.shift()!;
      const cur = p[p.length - 1];
      if (cur[0] === goal[0] && cur[1] === goal[1]) return p;
      for (const [dq, dr] of dirs) {
        const nq = cur[0] + dq;
        const nr = cur[1] + dr;
        const k = tileKey(nq, nr);
        if (seen.has(k)) continue;
        if (k !== tileKey(goal[0], goal[1]) && !reachable.has(k)) continue;
        seen.add(k);
        q.push([...p, [nq, nr]]);
      }
    }
    return null;
  }

  private refreshPathHighlights(): void {
    this.cb.clearHighlights();
    this.cb.setHighlights((set) => {
      const reachable = this.session!.getReachableTiles(this.localPlayerId);
      set(reachable, 'move');
      if (this.path.length > 1) set(this.path.map((t) => tileKey(t[0], t[1])), 'path');
    });
    const budget = this.myPokemon()?.stat_stages ? this.moveBudget() : 0;
    const used = Math.max(0, this.path.length - 1);
    this.setHint(`Building path: ${used} tile(s). Budget ~${budget}. Click adjacent tiles, then Continue → target. Click your own tile to reset.`);
    this.renderControls();
  }

  private moveBudget(): number {
    const p = this.myPokemon();
    if (!p) return 0;
    // effective move range ≈ floor(effectiveSpeed / 20); approximate from base speed + speed stage.
    return Math.max(1, Math.floor(p.base_speed / 20));
  }

  private chooseTarget(tile: [number, number]): void {
    const key = tileKey(tile[0], tile[1]);
    const from = this.order === ActionOrder.MOVE_FIRST && this.path.length ? this.path[this.path.length - 1] : this.startTile();
    const attackable = new Set(this.session!.getAttackableTiles(this.localPlayerId, this.move!.name, from));
    // Melee/self-target status moves may target own tile; allow attackable set + own.
    const allowSelf = this.move!.category === MoveCategory.STATUS && (this.move!.target === 'self');
    if (!attackable.has(key) && !(allowSelf && key === tileKey(from[0], from[1]))) {
      this.setHint('Target out of range or blocked by line of sight.', true);
      return;
    }
    this.target = tile;
    this.phase = 'confirm';
    this.refreshTargetHighlights(from);
    this.setHint('Target locked. Confirm to send, or pick another tile.');
    this.renderControls();
  }

  private refreshTargetHighlights(from: [number, number]): void {
    this.cb.clearHighlights();
    this.cb.setHighlights((set) => {
      if (this.order === ActionOrder.MOVE_FIRST && this.path.length > 1) {
        set(this.path.map((t) => tileKey(t[0], t[1])), 'path');
      }
      const attackable = this.session!.getAttackableTiles(this.localPlayerId, this.move!.name, from);
      set(attackable, 'attack');
      if (this.target) {
        set([tileKey(this.target[0], this.target[1])], 'target');
        // AOE preview
        if (this.move!.aoeRadius > 0) {
          const area = getHexArea(this.target[0], this.target[1], this.move!.aoeRadius);
          set([...area], 'aoe');
        }
      }
    });
  }

  // ── Rendering ─────────────────────────────
  private render(): void {
    this.renderMoves();
    this.renderControls();
    this.setHint('Select a move to declare your turn.');
  }

  private renderMoves(): void {
    clearChildren(this.movesRow);
    const p = this.myPokemon();
    if (!p) return;
    for (const name of p.moves) {
      const def = MOVE_REGISTRY.get(name);
      const cd = p.cooldowns[name] ?? 0;
      const onCd = cd > 0;
      const selected = this.move?.name === name;
      const card = el('div', {
        class: 'pbw-move' + (selected ? ' selected' : '') + (onCd ? ' disabled' : ''),
        onclick: () => {
          if (onCd || this.locked) return;
          this.selectMove(name);
        },
      });
      card.append(
        el('div', { class: 'mv-name', text: name }),
        el('div', {
          class: 'mv-meta',
          text: def ? `${def.moveType} · ${def.basePower ? def.basePower + ' BP' : cat(def.category)}${def.isRanged ? ' · ranged' : ''}` : '',
        }),
        this.cdPips(cd),
      );
      this.movesRow.append(card);
    }
  }

  private cdPips(cd: number): HTMLElement {
    const wrap = el('div', { class: 'pbw-cd-pips' });
    for (let i = 0; i < 2; i++) {
      wrap.append(el('span', { class: 'pbw-cd-pip' + (i < cd ? ' hot' : '') }));
    }
    return wrap;
  }

  private selectMove(name: string): void {
    this.move = MOVE_REGISTRY.get(name) ?? null;
    this.path = [];
    this.target = null;
    this.order = ActionOrder.ATTACK_FIRST;
    this.phase = 'pickOrder';
    this.cb.clearHighlights();
    this.renderMoves();
    this.renderControls();
    this.setHint(`Chosen ${name}. Pick an action order.`);
  }

  private beginPathing(): void {
    this.phase = 'buildPath';
    this.path = [this.startTile()];
    this.refreshPathHighlights();
  }

  private beginTargeting(): void {
    this.phase = 'pickTarget';
    const from = this.order === ActionOrder.MOVE_FIRST && this.path.length ? this.path[this.path.length - 1] : this.startTile();
    this.cb.clearHighlights();
    this.cb.setHighlights((set) => {
      if (this.order === ActionOrder.MOVE_FIRST && this.path.length > 1) set(this.path.map((t) => tileKey(t[0], t[1])), 'path');
      const attackable = this.session!.getAttackableTiles(this.localPlayerId, this.move!.name, from);
      set(attackable, 'attack');
    });
    this.setHint('Click a target tile within attack range (red).');
    this.renderControls();
  }

  private renderControls(): void {
    clearChildren(this.controls);
    if (this.locked) {
      this.controls.append(el('span', { class: 'pbw-ready-tag', text: 'Turn declared — waiting…', style: { background: 'var(--good)', color: '#0A2018' } }));
      return;
    }
    if (this.phase === 'idle') return;

    if (this.phase === 'pickOrder') {
      const af = el('button', {
        class: 'pbw-btn ' + (this.order === ActionOrder.ATTACK_FIRST ? 'toggle-on' : 'toggle-off'),
        text: 'Attack First',
        title: 'Fire from your current tile; higher cooldown.',
        onclick: () => {
          this.order = ActionOrder.ATTACK_FIRST;
          this.renderControls();
        },
      });
      const mf = el('button', {
        class: 'pbw-btn ' + (this.order === ActionOrder.MOVE_FIRST ? 'toggle-on' : 'toggle-off'),
        text: 'Move First',
        title: 'Reposition then attack; enables momentum.',
        onclick: () => {
          this.order = ActionOrder.MOVE_FIRST;
          this.renderControls();
        },
      });
      const next = el('button', {
        class: 'pbw-btn',
        text: 'Continue',
        onclick: () => {
          if (this.order === ActionOrder.MOVE_FIRST) this.beginPathing();
          else this.beginTargeting();
        },
      });
      this.controls.append(af, mf, next);
    } else if (this.phase === 'buildPath') {
      this.controls.append(
        el('button', { class: 'pbw-btn ghost', text: 'Clear path', onclick: () => { this.path = [this.startTile()]; this.refreshPathHighlights(); } }),
        el('button', { class: 'pbw-btn', text: 'Continue → Target', onclick: () => this.beginTargeting() }),
        el('button', { class: 'pbw-btn ghost', text: 'Back', onclick: () => { this.phase = 'pickOrder'; this.cb.clearHighlights(); this.renderControls(); } }),
      );
    } else if (this.phase === 'pickTarget') {
      this.controls.append(
        el('button', { class: 'pbw-btn ghost', text: 'Back', onclick: () => { this.phase = this.order === ActionOrder.MOVE_FIRST ? 'buildPath' : 'pickOrder'; if (this.phase === 'buildPath') this.refreshPathHighlights(); else this.cb.clearHighlights(); this.renderControls(); } }),
      );
    } else if (this.phase === 'confirm') {
      this.controls.append(
        el('button', { class: 'pbw-btn', text: 'Confirm Declaration', onclick: () => this.confirm() }),
        el('button', { class: 'pbw-btn ghost', text: 'Re-pick target', onclick: () => { this.target = null; this.beginTargeting(); } }),
      );
    }
  }

  private confirm(): void {
    if (!this.move || !this.session) return;
    const path = this.order === ActionOrder.MOVE_FIRST ? this.path : [];
    const targetTile = this.target;
    // Client-side validation via the mirror before sending.
    const decl = new TurnDeclaration(this.move.name, this.order, targetTile, path.map((t) => [t[0], t[1]]));
    const check = this.session.validateDeclaration(this.localPlayerId, decl);
    if (!check.ok) {
      this.setHint(`Illegal: ${check.reason}`, true);
      return;
    }
    this.locked = true;
    this.cb.clearHighlights();
    this.cb.onDeclare(this.move.name, targetTile, path, this.order);
    this.setHint('Declaration sent. Waiting for opponent…');
    this.renderControls();
  }

  private setHint(text: string, warn = false): void {
    this.hint.textContent = text;
    this.hint.style.color = warn ? 'var(--bad)' : 'var(--text-dim)';
  }

  lockForResolution(): void {
    this.locked = true;
    this.cb.clearHighlights();
    this.renderControls();
  }

  show(): void {
    this.root.style.display = 'flex';
  }
  hide(): void {
    this.root.style.display = 'none';
  }
}

function cat(c: MoveCategory): string {
  return c === MoveCategory.STATUS ? 'status' : c === MoveCategory.TERRAIN ? 'terrain' : String(c);
}
