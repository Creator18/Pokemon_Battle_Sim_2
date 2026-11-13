import { typeColor } from '../theme.ts';
import { RingGauge, HP_COLORS } from '../ui/RingGauge.ts';

/**
 * Your team, top left: six circles in a column, each in its HP ring (RingGauge: its value an arc from the top,
 * clockwise, a gradient along it, glowing; what's left a fainter arc a gap away). Empty at first — their rings empty
 * too, all "what's left". Each Pokémon you get takes the topmost empty one: its icon pops in, and its ring fills round it
 * on a spring, from nothing to its HP — green, amber below half, red below a quarter. Minimal: no numbers. The one you
 * are now marked; one fainted, greyed.
 */
/** Its icon: Pokémon HOME's render of it (smooth, lit, stylized — not a pixel sprite). */
const ICONS = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
const SIZE = 60;
/** Its ring: how wide (of a 100-unit box), the gap at its ends (percent). */
const RING = 9, GAP = 4;
/** What's left of a ring: faint. */
const REST = 'rgba(255,255,255,.16)';

let styled = false;
function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
.tmh { position: fixed; left: 16px; top: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 20; pointer-events: none; color: #fff; }
.tmh.r { left: auto; right: 16px; }
.tmh.enter { animation: tmh-in .45s cubic-bezier(.2,1.2,.4,1) both; }
.tmh.r.enter { animation-name: tmh-in-r; }
.tmh.leave { animation: tmh-out .45s ease-in both; }
.tmh.r.leave { animation-name: tmh-out-r; }
@keyframes tmh-in { from { transform: translateX(-120%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tmh-in-r { from { transform: translateX(120%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tmh-out { to { transform: translateX(-120%); opacity: 0; } }
@keyframes tmh-out-r { to { transform: translateX(120%); opacity: 0; } }
.tmh-slot { position: relative; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; }
.tmh-slot > div:first-child { position: absolute; inset: 0; }
.tmh-face { position: absolute; inset: ${Math.round(SIZE * 0.13)}px; border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 50% 38%, rgba(40,56,80,.6), rgba(10,16,28,.75));
  box-shadow: inset 0 -5px 9px rgba(0,0,0,.35), inset 0 2px 5px rgba(255,255,255,.12), 0 2px 6px rgba(0,0,0,.35); }
.tmh-slot.full .tmh-face { background: radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--t1) 70%, #fff) 0%, var(--t1) 45%, color-mix(in srgb, var(--t2) 75%, #000) 100%);
  box-shadow: inset 0 -6px 10px rgba(0,0,0,.35), inset 0 3px 6px rgba(255,255,255,.35); }
.tmh-slot.full .tmh-face::after { content: ''; position: absolute; left: 14%; top: 7%; width: 72%; height: 34%; border-radius: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.4), rgba(255,255,255,0)); }
.tmh-face img { position: absolute; left: 50%; top: 50%; width: 104%; height: 104%; transform: translate(-50%, -46%);
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.45)); }
.tmh-slot.new img { animation: tmh-pop .55s cubic-bezier(.2,1.6,.4,1) both; }
.tmh-slot.new .tmh-face { animation: tmh-flash .7s ease-out both; }
.tmh-slot { transition: transform .18s cubic-bezier(.2,1.4,.4,1); }
.tmh-slot.selected { transform: scale(1.16); z-index: 1; }
.tmh-slot.active::after { content: ''; position: absolute; inset: 2px; border-radius: 50%; pointer-events: none;
  box-shadow: 0 0 10px 2px rgba(255,255,255,.28), 0 0 18px 4px rgba(150,220,255,.22); animation: tmh-breathe 2.2s ease-in-out infinite; }
@keyframes tmh-breathe { 50% { box-shadow: 0 0 12px 3px rgba(255,255,255,.38), 0 0 24px 6px rgba(150,220,255,.3); } }
.tmh-slot.down img { filter: grayscale(1) brightness(.6) drop-shadow(0 2px 2px rgba(0,0,0,.5)); }
@keyframes tmh-pop { 0% { transform: translate(-50%, -46%) scale(.2); opacity: 0; } 100% { transform: translate(-50%, -46%) scale(1); opacity: 1; } }
@keyframes tmh-flash { 0% { filter: brightness(2.2); } 100% { filter: none; } }
`;
  document.head.append(st);
}

interface Slot { el: HTMLDivElement; gauge: RingGauge; face: HTMLDivElement; member: { name: string; hp: () => number } | null }

export class TeamHud {
  readonly root: HTMLDivElement;
  private slots: Slot[] = [];
  private active = -1;
  private sel = -1;

  /** `side`: yours top left; a foe's (the boss's team) top right. */
  constructor(side: 'left' | 'right' = 'left', enter = false) {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = `tmh${side === 'right' ? ' r' : ''}${enter ? ' enter' : ''}`;
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'tmh-slot';
      // (Its ring — empty: all of it "what's left".)
      const gauge = new RingGauge({ size: SIZE, stroke: RING, gap: GAP, gradient: true, glow: true, spring: true, color: HP_COLORS, rest: () => REST });
      gauge.set(0);
      const face = document.createElement('div'); face.className = 'tmh-face';
      el.append(gauge.el, face);
      this.root.append(el);
      this.slots.push({ el, gauge, face, member: null });
    }
    document.body.append(this.root);
  }

  /**
   * A Pokémon gained: into the topmost empty circle — its icon (`spriteId`) popping in, its window tinted by its
   * types, its ring filling round it. `hp` its HP as a fraction (read each frame). Its slot, or -1 (the team full).
   */
  add(name: string, spriteId: number, hp: () => number, types: readonly string[] = []): number {
    const i = this.slots.findIndex((s) => !s.member);
    if (i < 0) return -1;
    const s = this.slots[i];
    s.member = { name, hp };
    const img = document.createElement('img');
    img.src = `${ICONS}/${spriteId}.png`; img.alt = name; img.draggable = false;
    // (Its window tinted by its types: its first type's colour at its heart, its second's — or its first's — at its rim.)
    s.face.style.setProperty('--t1', typeColor(types[0] ?? 'Normal')); s.face.style.setProperty('--t2', typeColor(types[1] ?? types[0] ?? 'Normal'));
    s.face.append(img);
    s.el.classList.add('full', 'new');
    setTimeout(() => s.el.classList.remove('new'), 900);
    if (this.slots.filter((x) => x.member).length === 1) { this.setActive(i); this.select(i); }
    return i;
  }

  /** The one you are now (its circle glowing). */
  setActive(i: number): void {
    this.active = i;
    for (const [k, s] of this.slots.entries()) s.el.classList.toggle('active', k === i && !!s.member);
  }
  /** The one picked (Q / E): its circle a little bigger. */
  select(i: number): void {
    this.sel = i;
    for (const [k, s] of this.slots.entries()) s.el.classList.toggle('selected', k === i && !!s.member);
  }
  /** How many it holds. */
  get count(): number { return this.slots.filter((s) => s.member).length; }

  /** Each frame: every ring easing to its Pokémon's HP. */
  update(dt: number): void {
    for (const s of this.slots) {
      if (s.member) {
        const hp = Math.max(0, Math.min(1, s.member.hp()));
        s.gauge.set(hp * 100);
        s.el.classList.toggle('down', hp <= 0);
      }
      s.gauge.update(dt);
    }
  }

  /** Slid away off its side, then gone. */
  leave(): void {
    this.root.classList.remove('enter'); this.root.classList.add('leave');
    setTimeout(() => this.dispose(), 480);
  }

  dispose(): void { this.root.remove(); }
}
