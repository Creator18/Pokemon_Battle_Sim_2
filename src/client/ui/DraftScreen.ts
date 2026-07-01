/**
 * DraftScreen — species picker (6 cards) then move draft (8-move pool grouped by
 * category). Enforces pick-exactly-4 with at least one terrain move before Ready.
 */

import {
  MOVE_REGISTRY,
  MoveCategory,
  type SpeciesDefinition,
  type MoveDefinition,
} from '../../shared/index.ts';
import { el, ensureStyles, clearChildren } from './dom.ts';
import { typeColor } from '../theme.ts';

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

export interface DraftCallbacks {
  onSelectSpecies: (species: string) => void;
  onSelectMoves: (moveIds: string[]) => void;
}

export class DraftScreen {
  readonly root: HTMLElement;
  private species: SpeciesDefinition[] = [];
  private chosenSpecies: SpeciesDefinition | null = null;
  private chosenMoves = new Set<string>();
  private opponentReady = false;
  private selfReady = false;

  constructor(private cb: DraftCallbacks) {
    ensureStyles();
    this.root = el('div', { class: 'pbw-modal-wrap' });
    this.root.style.display = 'none';
  }

  setSpecies(list: SpeciesDefinition[]): void {
    this.species = list;
    this.chosenSpecies = null;
    this.chosenMoves.clear();
    this.selfReady = false;
    this.renderSpecies();
  }

  setOpponentReady(): void {
    this.opponentReady = true;
    if (this.chosenSpecies) this.renderMoves();
  }

  private typeTags(types: readonly string[]): HTMLElement {
    return el(
      'div',
      {},
      types.map((t) => el('span', { class: 'pbw-tag', text: t, style: { background: typeColor(t) } })),
    );
  }

  private renderSpecies(): void {
    clearChildren(this.root);
    const cards = el('div', {
      class: 'pbw-grid',
      style: { gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: '760px' },
    });
    for (const sp of this.species) {
      const card = el('div', {
        class: 'pbw-card' + (this.chosenSpecies?.name === sp.name ? ' selected' : ''),
        onclick: () => {
          this.chosenSpecies = sp;
          this.chosenMoves.clear();
          this.cb.onSelectSpecies(sp.name);
          this.renderMoves();
        },
      });
      const img = el('img') as HTMLImageElement;
      img.src = `${SPRITE_BASE}/${sp.spriteId}.png`;
      img.alt = sp.name;
      card.append(
        img,
        el('div', { style: { fontWeight: '800', fontSize: '15px' } }, [document.createTextNode(sp.name)]),
        this.typeTags(sp.types),
        el('div', {
          style: { fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' },
          text: `HP ${sp.inflatedHp} · ATK ${sp.attack} · DEF ${sp.defense} · SPA ${sp.spAtk} · SPD ${sp.speed}`,
        }),
      );
      cards.append(card);
    }
    const panel = el('div', { class: 'pbw-panel', style: { width: '800px' } }, [
      el('div', { class: 'pbw-h1', text: 'Choose your Pokémon' }),
      el('div', { class: 'pbw-sub', text: 'Pick a species, then draft 4 of its 8 moves (at least one terrain move).' }),
      cards,
    ]);
    this.root.append(panel);
  }

  private moveCard(name: string): HTMLElement | null {
    const def = MOVE_REGISTRY.get(name);
    if (!def) return null;
    const selected = this.chosenMoves.has(name);
    const atMax = this.chosenMoves.size >= 4;
    const disabled = !selected && atMax;
    const card = el('div', {
      class: 'pbw-move' + (selected ? ' selected' : '') + (disabled ? ' disabled' : ''),
      onclick: () => {
        if (this.selfReady) return;
        if (selected) this.chosenMoves.delete(name);
        else if (this.chosenMoves.size < 4) this.chosenMoves.add(name);
        this.renderMoves();
      },
    });
    card.append(
      el('div', { class: 'mv-name', text: name }),
      el('div', {
        class: 'mv-meta',
        text: `${def.moveType} · ${categoryLabel(def.category)}${def.basePower ? ` · ${def.basePower} BP` : ''}`,
      }),
      this.tooltip(def),
    );
    return card;
  }

  private tooltip(def: MoveDefinition): HTMLElement {
    const bits: string[] = [];
    bits.push(`<b>${def.name}</b> — ${def.moveType} ${categoryLabel(def.category)}`);
    if (def.basePower) bits.push(`Power: ${def.basePower}`);
    if (def.aoeRadius) bits.push(`AOE radius: ${def.aoeRadius}`);
    bits.push(def.isRanged ? 'Ranged' : 'Melee (adjacent)');
    if (def.requiresLos) bits.push('Requires line of sight');
    if (def.bypassesLos) bits.push('Ignores line of sight');
    if (def.quickPriority) bits.push('Quick (strikes first)');
    if (def.needsMomentum) bits.push('Needs momentum');
    if (def.terrainTypePlaced) bits.push(`Places terrain: ${def.terrainTypePlaced}`);
    if (def.description) bits.push(`<span style="color:#9A9AB8">${def.description}</span>`);
    return el('div', { class: 'pbw-tooltip', html: bits.join('<br>') });
  }

  private groupSection(title: string, names: readonly string[]): HTMLElement | null {
    const cards = names.map((n) => this.moveCard(n)).filter((c): c is HTMLElement => c !== null);
    if (cards.length === 0) return null;
    return el('div', { style: { marginBottom: '10px' } }, [
      el('div', { class: 'pbw-h2', text: title }),
      el('div', { class: 'pbw-grid', style: { gridTemplateColumns: 'repeat(2, 1fr)' } }, cards),
    ]);
  }

  private hasTerrainMove(): boolean {
    if (!this.chosenSpecies) return false;
    const terrain = new Set(this.chosenSpecies.compatibleTerrain);
    for (const m of this.chosenMoves) if (terrain.has(m)) return true;
    return false;
  }

  private renderMoves(): void {
    if (!this.chosenSpecies) return;
    clearChildren(this.root);
    const sp = this.chosenSpecies;
    const sections: (HTMLElement | null)[] = [
      this.groupSection('Terrain', sp.compatibleTerrain),
      this.groupSection('Status', sp.compatibleStatus),
      this.groupSection('Ranged', sp.compatibleRanged),
      this.groupSection('Physical', sp.compatiblePhysical),
    ];

    const count = this.chosenMoves.size;
    const terrainOk = this.hasTerrainMove();
    const canReady = count === 4 && terrainOk && !this.selfReady;

    let reason = '';
    if (count !== 4) reason = `Select ${4 - count} more move(s).`;
    else if (!terrainOk) reason = 'You must include at least one terrain move.';
    else if (this.selfReady) reason = 'Ready! Waiting for opponent…';
    else reason = 'Ready to lock in.';

    const readyBtn = el('button', {
      class: 'pbw-btn',
      text: this.selfReady ? 'Locked In' : 'Ready',
      onclick: () => {
        if (!canReady) return;
        this.selfReady = true;
        this.cb.onSelectMoves([...this.chosenMoves]);
        this.renderMoves();
      },
    }) as HTMLButtonElement;
    readyBtn.disabled = !canReady;

    const backBtn = el('button', {
      class: 'pbw-btn ghost',
      text: '← Change Pokémon',
      onclick: () => {
        if (this.selfReady) return;
        this.renderSpecies();
      },
    });

    const oppTag = el('span', {
      class: 'pbw-ready-tag',
      text: this.opponentReady ? 'Opponent ready' : 'Opponent choosing…',
      style: { background: this.opponentReady ? 'var(--good)' : 'var(--panel-alt)', color: this.opponentReady ? '#0A2018' : 'var(--text-dim)' },
    });

    const panel = el('div', { class: 'pbw-panel', style: { width: '620px' } }, [
      el('div', { class: 'pbw-row', style: { justifyContent: 'space-between' } }, [
        el('div', { class: 'pbw-h1', text: `${sp.name} — Draft Moves` }),
        el('div', { text: `${count}/4`, style: { fontWeight: '800', fontSize: '20px', color: count === 4 ? 'var(--good)' : 'var(--warn)' } }),
      ]),
      el('div', { class: 'pbw-sub', text: sp.description || 'Draft 4 moves. At least one must be a terrain move.' }),
      ...sections.filter((s): s is HTMLElement => s !== null),
      el('div', { class: 'pbw-hint', text: reason, style: { color: canReady || this.selfReady ? 'var(--good)' : 'var(--warn)' } }),
      el('div', { class: 'pbw-row', style: { justifyContent: 'space-between', marginTop: '6px' } }, [
        backBtn,
        el('div', { class: 'pbw-row' }, [oppTag, readyBtn]),
      ]),
    ]);
    this.root.append(panel);
  }

  show(): void {
    this.root.style.display = 'flex';
  }
  hide(): void {
    this.root.style.display = 'none';
  }
}

function categoryLabel(c: MoveCategory): string {
  switch (c) {
    case MoveCategory.PHYSICAL:
      return 'Physical';
    case MoveCategory.SPECIAL:
      return 'Special';
    case MoveCategory.TERRAIN:
      return 'Terrain';
    case MoveCategory.STATUS:
      return 'Status';
    default:
      return String(c);
  }
}
