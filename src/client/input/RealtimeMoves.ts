/**
 * Moves in real time, and whether they land.
 *
 * A beam (Flamethrower, Dragon Pulse, Hydro Pump) is aimed as it is fired —
 * at where the target stands then — and never moves after: it pours along
 * that line. Its front getting there is the contact: the target in its line
 * then is hit, and flinches for as long as it pours (and one that steps into
 * it while it pours is hit then). A dash at the contact (begun within
 * DODGE_WINDOW of it, or still going) dodges it: harmless for the rest of
 * its pour. Held (its button kept down), it pours on past its first moment
 * for as long as the user's stamina lasts.
 *
 * A ram (Flare Blitz, Acrobatics) runs at the target in its aura, chasing it
 * till it is nearly there and then straight on (chargeAt) — walking away is
 * no escape, only a dash just before contact. Its rush past its first few
 * metres costs stamina by the metre; none left, it stops short. Caught, the
 * target is thrown back and the ram recoils. A rampage (Outrage): the same
 * rush, then its flurry; caught, the target is held in it till the last blow.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { getMove, moveType } from '../../shared/index.ts';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import type { MoveVfx } from '../vfx/MoveVfx.ts';
import { beamFor } from '../vfx/beam/beamMoves.ts';
import { elementFor } from '../vfx/auraPalette.ts';
import { POUR_COST, RUSH_COST, RUSH_FREE, type Stamina } from './Stamina.ts';

/** Moves the move data doesn't carry yet: their type and power, and how they play. */
const OWN_MOVES: Record<string, { type: string; power: number; kind: 'rampage' | 'cross' | 'slash' }> = {
  Outrage: { type: 'Dragon', power: 120, kind: 'rampage' },
  // Crosses: one slash from each arm in quick succession (RecipeFactory.playCrossSlash).
  'Cross Chop': { type: 'Fighting', power: 100, kind: 'cross' },
  'Cross Poison': { type: 'Poison', power: 70, kind: 'cross' },
  'X-Scissor': { type: 'Bug', power: 80, kind: 'cross' },
  // A single slash: the cross's first blow alone — its swipe, its sphere slash.
  'Dragon Claw': { type: 'Dragon', power: 80, kind: 'slash' },
};
/** A dash dodges a move whose contact comes within this long of its start (s). */
const DODGE_WINDOW = 0.35;
/** A ram or a rampage stops this far short of its target (× the two heights added), and stops chasing this far off (m). */
const STOP_SHORT = 0.35, COMMIT = 2.2;
/** A ram throws its target back so far (m). */
const THROWN = 2.6;
/** A body's radius (× its height); a blow reaches this far round where it stopped (× the two heights added, past their bodies). */
const BODY = 0.3, REACH = 0.45;
/** A beam's own half-width (m), how far past its aim it still reaches (m). */
const BEAM_HALF = 0.35, BEAM_PAST = 2;
/** A beam pours this long past its contact for free; held, on as long as its stamina lasts, never past POUR_MAX (s). */
const POUR_MIN = 0.8, POUR_MAX = 6;
/** How long after a word over it another may not show on the same one (s). */
const TEXT_GAP = 0.6;

export interface RealtimeHooks {
  /** When its last dash began (performance.now, s), and is it still dashing? */
  dashOf?: (node: TransformNode) => { startedAt: number; going: boolean } | null;
  /** Its stamina (none: its charge is unlimited). */
  staminaOf?: (node: TransformNode) => Stamina | null;
  /** It was struck: `until`, the flinch (the player is held still through it). */
  onStruck?: (node: TransformNode, until: Promise<unknown>) => void;
  /** Where a throw may land (inside the arena). */
  clamp?: (p: Vector3) => Vector3;
}

export class RealtimeMoves {
  private lastText = new WeakMap<TransformNode, number>();

  constructor(private readonly scene: Scene, private readonly factory: RecipeFactory, private readonly vfx: MoveVfx | null,
    private readonly hooks: RealtimeHooks = {}) {}

  /** Is `name` one this plays (a beam, a ram, a rampage)? */
  plays(name: string): boolean {
    return !!beamFor(name) || !!getMove(name)?.isRam || !!OWN_MOVES[name];

  }

  /**
   * `node` uses `name` on `target`. `holding`: is it being held (a beam pours
   * on while it is, on its stamina). Resolves when it is over; true if it landed.
   */
  async use(node: TransformNode, target: TransformNode, name: string, holding?: () => boolean): Promise<boolean> {
    const f = this.factory, own = OWN_MOVES[name], move = getMove(name);
    const type = own?.type ?? moveType(name), power = own?.power ?? move?.basePower ?? 60;
    const beam = beamFor(name);
    if (beam) return this.pour(node, target, name, holding);
    if (own?.kind === 'cross' || own?.kind === 'slash') return this.cross(node, target, type, own.kind === 'slash');
    if (!move?.isRam && own?.kind !== 'rampage') return false;
    // In its aura, after it — as far as its breath takes it.
    const aura = f.aura(node, { element: type, edge: 'tongues', reach: 'body' });
    await aura.lit;
    const stop = STOP_SHORT * (f.heightOf(node) + f.heightOf(target));
    const stamina = this.hooks.staminaOf?.(node) ?? null;
    let rushed = 0, winded = false;
    const at = await f.chargeAt(node, () => target.position, { element: type, stop, commit: COMMIT, onStep: (m) => {
      rushed += m;
      if (!stamina || rushed <= RUSH_FREE) return true;
      stamina.drain(Math.min(m, rushed - RUSH_FREE) * RUSH_COST);
      winded = stamina.empty;
      return !winded;
    } });
    const reached = this.within(node, target, at);
    const caught = !this.evaded(target) && reached;
    const missed = () => (winded && !reached ? this.say(node, 'Out of breath!', '#FCD34D') : this.dodged(target));
    if (move?.isRam) {
      // A ram: no strike at its end; the impact throws the target back (and recoils on the ram).
      void aura.release();
      if (!caught) return missed();
      void f.playHitReact(node);
      const way = target.position.subtract(at); way.y = 0;
      if (way.lengthSquared() < 1e-6) way.set(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
      const thrown = f.playKnockback(target, this.clampOf(target.position.add(way.normalize().scale(THROWN))));
      this.hooks.onStruck?.(target, thrown);
      await thrown;
      return true;
    }
    // A rampage: its flurry let loose where it stopped; its aura goes as the blows begin.
    void aura.release();
    if (!caught) { missed(); await f.playFlurry(node, target.position.clone(), power); return false; }
    // Caught: held in it, flinching, till the last blow.
    const flurry = f.playFlurry(node, target.position.clone(), power);
    void f.playHitReact(target);
    const held = flurry.then(() => f.playHitReact(target));
    this.hooks.onStruck?.(target, held);
    await flurry;
    this.vfx?.playMove(elementFor(type, node.metadata?.species, !!node.metadata?.shiny), node.position.clone(), target.position.clone(), power >= 100);
    await held;
    return true;
  }

  /**
   * A cross: charged in (as a rampage, but no aura), then its two slashes —
   * each blow asked on its own whether it landed (a dash at either dodges it).
   * True if either did.
   */
  private async cross(node: TransformNode, target: TransformNode, type: string, single = false): Promise<boolean> {
    const f = this.factory;
    // A single slash (Dragon Claw): no rush — let loose where it stands, at the target; it lands if the target is in reach.
    if (single) {
      let hit = false;
      await f.playCrossSlash(node, target.position.clone(), type, () => {
        // (Out of reach: it just misses — no burst, nothing said. Dodged: said so.)
        if (!this.within(node, target, node.position)) return false;
        if (this.evaded(target)) { this.dodged(target); return false; }
        hit = true;
        const flinch = f.playHitReact(target);
        this.hooks.onStruck?.(target, flinch);
        return true;
      }, true);
      return hit;
    }
    const stop = STOP_SHORT * (f.heightOf(node) + f.heightOf(target));
    const stamina = this.hooks.staminaOf?.(node) ?? null;
    let rushed = 0;
    const at = await f.chargeAt(node, () => target.position, { element: type, stop, commit: COMMIT, onStep: (m) => {
      rushed += m;
      if (!stamina || rushed <= RUSH_FREE) return true;
      stamina.drain(Math.min(m, rushed - RUSH_FREE) * RUSH_COST);
      return !stamina.empty;
    } });
    if (!this.within(node, target, at)) { this.say(node, 'Out of breath!', '#FCD34D'); return false; }
    let landed = false;
    await f.playCrossSlash(node, target.position.clone(), type, () => {
      if (this.evaded(target) || !this.within(node, target, node.position)) { this.dodged(target); return false; }
      landed = true;
      const flinch = f.playHitReact(target);
      this.hooks.onStruck?.(target, flinch);
      return true;
    }, single);
    return landed;
  }

  /**
   * A beam, aimed at where the target stands as it is fired and fixed there.
   * From its contact till it stops pouring, the target is hit whenever it is
   * in its line (unless it dodged the contact): flinching while it stays.
   */
  private async pour(node: TransformNode, target: TransformNode, name: string, holding?: () => boolean): Promise<boolean> {
    const f = this.factory;
    const aim = this.middle(target), from = node.position.clone();
    const d = aim.subtract(from);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) f.setFacing(node, Math.atan2(d.x, d.z));
    // (It doesn't turn after anything while it pours: its line is fixed.)
    f.holdLook(node, true);
    const stamina = this.hooks.staminaOf?.(node) ?? null;
    // How long it pours past its contact: POUR_MIN, or on as long as it is held and has stamina for (to POUR_MAX).
    let contactAt = -1;
    const pours = new Promise<void>((resolve) => {
      const o = this.scene.onBeforeRenderObservable.add(() => {
        if (contactAt < 0) return;
        const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
        const since = performance.now() / 1000 - contactAt;
        let on = since < POUR_MIN;
        if (!on && holding?.() && since < POUR_MAX) on = !stamina || stamina.drain(POUR_COST * dt) > 0;
        if (!on) { this.scene.onBeforeRenderObservable.remove(o); resolve(); }
      });
    });
    try {
      const play = f.playBeam(node, null, aim, beamFor(name)!, pours);
      await play.hit;
      contactAt = performance.now() / 1000;
      if (this.evaded(target)) {
        this.dodged(target);
        await play.done;
        return false;
      }
      // Its line, on the ground: from the user to its aim, and a little past.
      const end = aim.add(new Vector3(d.x, 0, d.z).normalize().scale(BEAM_PAST));
      const half = BEAM_HALF + BODY * f.heightOf(target);
      let pouring = true, landed = false, inIt = false, release: (() => void) | null = null;
      void play.contactEnds.then(() => { pouring = false; });
      await new Promise<void>((resolve) => {
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          const now = pouring && !this.hooks.dashOf?.(target)?.going && distToSegment(target.position, from, end) <= half;
          if (now && !inIt) {
            // In it: it flinches, and keeps flinching till it is out of it (or it stops).
            landed = true;
            const out = new Promise<void>((r) => { release = r; });
            void f.playHitReact(target);
            f.holdHitReact(target, out);
            this.hooks.onStruck?.(target, out);
          } else if (!now && inIt) { release?.(); release = null; }
          inIt = now;
          if (!pouring) { release?.(); this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
        });
      });
      if (!landed) this.dodged(target);
      await play.done;
      return landed;
    } finally {
      f.holdLook(node, false);
    }
  }

  /** Where a beam meets it: its middle, at the height it flies. */
  private middle(node: TransformNode): Vector3 {
    return node.position.add(new Vector3(0, this.factory.heightOf(node) * 0.5 + this.factory.liftOf(node), 0));
  }

  /** Did it dash just now (begun within DODGE_WINDOW, or still going)? */
  private evaded(node: TransformNode): boolean {
    const d = this.hooks.dashOf?.(node);
    return !!d && (d.going || performance.now() / 1000 - d.startedAt <= DODGE_WINDOW);
  }

  /** Is `target` within the reach of `node`'s blow, landed at `at`? */
  private within(node: TransformNode, target: TransformNode, at: Vector3): boolean {
    const reach = (BODY + REACH) * (this.factory.heightOf(node) + this.factory.heightOf(target));
    const d = target.position.subtract(at); d.y = 0;
    return d.length() <= reach;
  }

  private dodged(target: TransformNode): false {
    return this.say(target, 'Dodged!', '#E5E7EB');
  }

  /** A word over it (not twice within TEXT_GAP). */
  private say(node: TransformNode, text: string, color: string): false {
    const now = performance.now() / 1000;
    if (now - (this.lastText.get(node) ?? -1e9) > TEXT_GAP) {
      this.lastText.set(node, now);
      this.vfx?.floatingText(node.position.add(new Vector3(0, this.factory.heightOf(node) * 0.9, 0)), text, color);
    }
    return false;
  }

  private clampOf(p: Vector3): Vector3 {
    return this.hooks.clamp ? this.hooks.clamp(p) : p;
  }
}

/** How far `p` lies from the segment `a`–`b`, on the ground. */
function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x, abz = b.z - a.z, apx = p.x - a.x, apz = p.z - a.z;
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / Math.max(1e-6, abx * abx + abz * abz)));
  return Math.hypot(apx - abx * t, apz - abz * t);
}
