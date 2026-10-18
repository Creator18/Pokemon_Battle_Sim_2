/**
 * ResolutionPlayback — animates a `resolution` message: replays resolvedActions
 * in order (movement tweens, attack lunges, VFX, floating damage, faints), then
 * applies newState to board/HUD.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import {
  moveType,
  getMove,
  isSelfArea,
  tileKey,
  type ResolutionMsg,
  type ResolvedActionWire,
  type BattleStateJSON,
} from '../../shared/index.ts';
import type { HexBoard } from '../render/HexBoard.ts';
import { castKindFor, type UnitFactory } from '../render/unitFactory.ts';
import type { AuraHandle } from '../vfx/UnitFx.ts';
import { beamFor } from '../vfx/beam/beamMoves.ts';
import { pulseFor } from '../vfx/PulseFx.ts';
import { windFor } from '../vfx/windMoves.ts';
import { lightningFor } from '../vfx/lightningMoves.ts';
import { clawFor } from '../vfx/slashMoves.ts';
import { elementFor } from '../vfx/auraPalette.ts';
import type { MoveVfx } from '../vfx/MoveVfx.ts';
import type { BattleCamera } from '../camera/BattleCamera.ts';
import { hpColor } from '../theme.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const STRONG_HIT = 45;

export class ResolutionPlayback {
  /** The state before the turn being played (what was on the board as it started). */
  private prevState: BattleStateJSON | null = null;

  constructor(
    private board: HexBoard,
    private factory: UnitFactory,
    private vfx: MoveVfx,
    private camera: BattleCamera,
    /** Called as each hit lands, so the HUD bar drops with the flash. */
    private onHp?: (pid: number, hp: number, maxHp: number) => void,
  ) {}

  /**
   * @param nodes  playerId → unit TransformNode
   * @param prevState state before resolution (for HP deltas / positions)
   */
  async play(
    msg: ResolutionMsg,
    nodes: Map<number, TransformNode>,
    prevState: BattleStateJSON,
  ): Promise<void> {
    this.prevState = prevState;
    const hpBefore = new Map<number, number>();
    for (const pid of [1, 2]) {
      const p = pid === 1 ? prevState.pokemon.p1 : prevState.pokemon.p2;
      if (p) hpBefore.set(pid, p.current_hp);
    }

    for (const action of msg.resolvedActions) {
      await this.playAction(action, nodes, msg, hpBefore);
      await sleep(180);
    }

    // Apply faints from the resulting state.
    for (const pid of [1, 2]) {
      const p = pid === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      const node = nodes.get(pid);
      if (p && node && p.status === 'fainted' && !this.factory.isDown(node)) {
        this.vfx.koPuff(node.position.clone());
        await this.factory.playFaint(node);
      }
    }
    await sleep(200);
  }

  private worldFromTile(tile: [number, number]): Vector3 {
    return this.board.tileTop(tile[0], tile[1]);
  }

  private async playAction(
    action: ResolvedActionWire,
    nodes: Map<number, TransformNode>,
    msg: ResolutionMsg,
    hpBefore: Map<number, number>,
  ): Promise<void> {
    const node = nodes.get(action.playerId);
    if (!node) return;

    if (action.actionType === 'move') {
      if (action.skippedMovement) return;
      const path = action.path ?? [];
      if (path.length <= 1) return;
      this.camera.focusOn(path[path.length - 1]);
      const mover = action.playerId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      const huge = mover?.huge === true;
      const worldPath = path.slice(1).map((t) => this.board.standPoint(t[0], t[1], huge));
      const hover = path.slice(1).map((t) => this.board.hoverOver(t[0], t[1], huge));
      await this.factory.playMoveTo(node, worldPath, hover);
      return;
    }

    // attack
    // A beam clash: played whole with its first side; the other side's action is part of it.
    if (action.clash) {
      if (action.playerId === action.clash.players[0]) await this.playClash(action, nodes, msg, hpBefore);
      return;
    }
    if (action.skippedAttack) {
      this.vfx.floatingText(node.position.clone(), 'Blocked!', '#EF4444');
      return;
    }
    const defenderId = action.playerId === 1 ? 2 : 1;
    const defenderNode = nodes.get(defenderId);
    const move = action.moveName ? getMove(action.moveName) : undefined;
    const mtype = action.moveName ? moveType(action.moveName) : 'Normal';

    const targetTile = action.toTile ?? (defenderNode ? undefined : undefined);
    const targetPos = defenderNode ? defenderNode.position.clone() : targetTile ? this.worldFromTile(targetTile) : node.position.clone();

    this.camera.focusOn(action.toTile ?? action.fromTile ?? [0, 0]);

    // Body animation: a contact move lunges and strikes; a special attack
    // plays the ranged attack; status and terrain moves roar or appeal. Each
    // resolves at its moment of impact or release, so the effect lands on it.
    //
    // The aura outline (EFFECTS.md Part 2 §1) in the move's type colour: a
    // contact move powers up a charge aura first and spends it on contact; a
    // special attack hugs the body with a calm outline while it fires; a move
    // on itself glows while it calls.
    const cast = castKindFor(move);
    const beamSpec = beamFor(action.moveName);
    const pulseSpec = beamSpec ? null : pulseFor(action.moveName);
    const windSpec = beamSpec || pulseSpec ? null : windFor(action.moveName);
    const boltSpec = beamSpec || pulseSpec || windSpec ? null : lightningFor(action.moveName);
    let aura: AuraHandle | null = null;
    let beamDone: Promise<void> | null = null;
    let beamContactEnds: Promise<void> | null = null;
    // Earthquake: thrown off its tile (the hit plays in the throw).
    let thrown: Promise<void> | null = null;
    // Claw marks: in place of the plain particle burst.
    let clawMarks: Promise<void> | null = null;
    if (move && isSelfArea(move)) {
      // Earthquake: the user stamps (no lunge — it hits where it stands) in its
      // Ground aura; the ground heaves round it, ring by ring, and settles tilted
      // in; anything caught there is flung out as its tile heaves.
      aura = this.factory.aura(node, { element: mtype, edge: 'tongues', reach: 'body' });
      await aura.lit;
      await this.factory.playAttackLunge(node, node.position.clone());
      this.vfx.shake(0.3, 520);
      const from = action.fromTile ?? [0, 0];
      const zone = msg.aoeTiles[action.playerId] ?? [];
      // What it brings down: rocks and trees in the zone before, gone after.
      const standing = (s: BattleStateJSON | null, type: string) => new Set((s?.terrain ?? [])
        .filter((t) => t.terrain_type === type).map((t) => tileKey(t.tile[0], t.tile[1])));
      const downed = (type: string) => {
        const before = standing(this.prevState, type), after = standing(msg.newState, type);
        return zone.filter((k) => before.has(k) && !after.has(k));
      };
      const rocks = downed('rock');
      const quake = this.board.quake(from, zone, new Set([...rocks, ...downed('tree')]));
      for (const k of rocks) {
        const [q, r] = k.split(',').map(Number);
        const at = this.board.tileTop(q, r);
        setTimeout(() => this.vfx.koPuff(at), (quake.heaves(k) + 0.2) * 1000);
      }
      beamDone = quake.done;
      const kb = action.knockback;
      if (kb && defenderNode) {
        const def = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
        const to = this.board.standPoint(kb.to[0], kb.to[1], def?.huge === true);
        const maxHp = def?.max_hp ?? 1;
        const hp = def?.current_hp ?? 0;
        await sleep(quake.heaves(tileKey(kb.from[0], kb.from[1])) * 1000);
        this.onHp?.(defenderId, hp, maxHp);
        thrown = this.factory.playKnockback(defenderNode, to, hpColor(hp / maxHp));
      }
      await quake.landed;
    } else if (beamSpec) {
      // A beam: its own effect from wind-up to release; the hit lands when its
      // front reaches the defender, while it is still pouring. No aura on the
      // caster during a beam.
      const beam = this.factory.playBeam(node, defenderNode ?? null, targetPos, beamSpec);
      beamDone = beam.done;
      beamContactEnds = beam.contactEnds;
      await beam.hit;
    } else if (windSpec) {
      // Gust / Twister: the tornado effect; contact lasts while it holds the target.
      const wind = this.factory.playWind(node, defenderNode ?? null, targetPos, windSpec);
      beamDone = wind.done;
      beamContactEnds = wind.contactEnds;
      await wind.hit;
    } else if (boltSpec) {
      // Lightning: the caster's Electric aura (which earths off its body) while
      // the bolt is on the target.
      aura = this.factory.aura(node, { element: 'Electric', edge: 'smooth', reach: 'tight', ignite: 0.3, die: 0.5, shiver: true });
      const bolt = this.factory.playLightning(node, defenderNode ?? null, targetPos, boltSpec);
      beamDone = bolt.done;
      beamContactEnds = bolt.contactEnds;
      await bolt.hit;
    } else if (pulseSpec) {
      // A sonar pulse: rings sent along the gaze; contact lasts from the
      // first ring's arrival to the last's.
      aura = this.factory.aura(node, { element: pulseSpec.element, edge: 'smooth', reach: 'tight', ignite: 0.35, die: 0.6 });
      const pulse = this.factory.playPulse(node, defenderNode ?? null, targetPos, pulseSpec);
      beamDone = pulse.done;
      beamContactEnds = pulse.contactEnds;
      await pulse.hit;
    } else if (!cast && move) {
      // An attack move: a puncher's aura is on its striking hand only (a
      // slash's on the blade it cuts with, if it has one: Absol's horn). A
      // claw or a slash plays the swipe, where the species has one.
      const claw = clawFor(action.moveName);
      aura = this.factory.aura(node, { element: mtype, edge: 'tongues', reach: 'body', strike: claw ? 'swipe' : true, blade: !!claw });
      await aura.lit;
      await this.factory.playAttackLunge(node, targetPos, !!claw);
      // Its marks hang in the air as the blow lands.
      if (claw) clawMarks = this.factory.playClaw(node, defenderNode ?? null, claw);
    } else if (cast) {
      aura = cast === 'ranged'
        ? this.factory.aura(node, { element: mtype, edge: 'smooth', reach: 'tight', ignite: 0.35, die: 0.6 })
        : cast === 'appeal'
          ? this.factory.aura(node, { element: mtype, edge: 'smooth', reach: 'body', ignite: 0.5 })
          : null;
      await this.factory.playCast(node, targetPos, cast);
    }

    // Damage/HP delta for this defender from newState.
    const defAfter = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
    const before = hpBefore.get(defenderId) ?? defAfter?.current_hp ?? 0;
    const after = defAfter?.current_hp ?? before;
    const dmg = Math.max(0, before - after);
    hpBefore.set(defenderId, after);

    const strong = dmg >= STRONG_HIT;
    if (!beamSpec && !pulseSpec && !windSpec && !boltSpec && !(move && isSelfArea(move)) && !clawMarks) await this.vfx.playMove(elementFor(mtype, node.metadata?.species), node.position.clone(), targetPos, strong);

    if (thrown) {
      // Flinched in the throw; it lands outside the zone.
      await thrown;
    } else if (dmg > 0 && defenderNode) {
      // No damage numbers: the defender flashes the colour its HP bar turns
      // to, and the bar drops at the same moment.
      const maxHp = defAfter?.max_hp ?? 1;
      this.onHp?.(defenderId, after, maxHp);
      // Struck by electricity: it lights up in the Electric aura, filled (the
      // whole shape in the outline's colour and glow, the body over it), and
      // then flinches; it goes out once the strike is over.
      let struck: AuraHandle | null = null;
      if (mtype === 'Electric') {
        struck = this.factory.aura(defenderNode, { element: 'Electric', edge: 'smooth', reach: 'body', fill: true, ignite: 0.08, die: 0.35, shiver: true });
        await struck.lit;
      }
      if (beamContactEnds) {
        // A beam keeps it flinching for as long as the beam is on it.
        void this.factory.playHitReact(defenderNode, hpColor(after / maxHp));
        this.factory.holdHitReact(defenderNode, beamContactEnds);
        if (struck) { const s = struck; void beamContactEnds.then(() => s.release()); }
      } else {
        await this.factory.playHitReact(defenderNode, hpColor(after / maxHp));
        if (struck) void struck.release();
      }
    } else if (move && move.basePower > 0 && defenderNode) {
      this.vfx.floatingText(defenderNode.position.clone(), 'Miss', '#9CA3AF');
    } else if (move && move.terrainTypePlaced) {
      this.vfx.floatingText(targetPos, move.terrainTypePlaced.replace('_', ' '), '#A855F7');
    }
    // The aura holds through the whole strike (or pour) and the hit, then goes out.
    if (beamDone) await beamDone;
    if (aura) void aura.release();
  }

  /**
   * Two beams met head-on (the engine's clash): they hold, then the winner
   * pushes the ball back into the loser and its beam lands — or, evenly
   * matched, both disperse.
   */
  private async playClash(
    action: ResolvedActionWire,
    nodes: Map<number, TransformNode>,
    msg: ResolutionMsg,
    hpBefore: Map<number, number>,
  ): Promise<void> {
    const clash = action.clash!;
    const [ia, ib] = clash.players;
    const other = msg.resolvedActions.find((x) => x !== action && x.clash && x.playerId === ib);
    const a = nodes.get(ia), b = nodes.get(ib);
    if (!a || !b) return;
    const specOf = (name: string | null | undefined) => beamFor(name) ?? { element: name ? moveType(name) : 'Normal' };
    const winner = clash.winner === null ? null : clash.winner === ia ? a : b;
    this.camera.focusOn(action.fromTile ?? [0, 0]);
    const mid = Vector3.Center(a.position, b.position);
    this.vfx.floatingText(mid.add(new Vector3(0, 1.4, 0)), 'Clash!', '#FDE68A');
    const play = this.factory.playClash(a, b, specOf(action.moveName), specOf(other?.moveName), winner, clash.margin);
    await play.hit;
    if (clash.winner === null) {
      this.vfx.floatingText(mid.add(new Vector3(0, 1.0, 0)), 'Dispersed', '#9CA3AF');
      await play.done;
      return;
    }
    const loserId = clash.winner === ia ? ib : ia;
    const loserNode = loserId === ia ? a : b;
    const winAction = clash.winner === ia ? action : other;
    const after = (loserId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2);
    const before = hpBefore.get(loserId) ?? after?.current_hp ?? 0;
    const hp = after?.current_hp ?? before;
    hpBefore.set(loserId, hp);
    if (before - hp > 0 && after) {
      this.onHp?.(loserId, hp, after.max_hp);
      let struck: AuraHandle | null = null;
      if (winAction?.moveName && moveType(winAction.moveName) === 'Electric') {
        struck = this.factory.aura(loserNode, { element: 'Electric', edge: 'smooth', reach: 'body', fill: true, ignite: 0.08, die: 0.35, shiver: true });
        await struck.lit;
      }
      void this.factory.playHitReact(loserNode, hpColor(hp / after.max_hp));
      this.factory.holdHitReact(loserNode, play.done);
      if (struck) { const s = struck; void play.done.then(() => s.release()); }
    }
    await play.done;
  }
}
