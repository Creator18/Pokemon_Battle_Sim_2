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
import type { AuraHandle, AuraOptions } from '../vfx/UnitFx.ts';
import { beamFor, type BeamSpec } from '../vfx/beam/beamMoves.ts';
import { ballFor } from '../vfx/beam/ballMoves.ts';
import { pulseFor, terrainPulseElement, type PulseSpec } from '../vfx/PulseFx.ts';
import { getSpecies } from '../../shared/index.ts';
import { hexLineTiles } from '../../shared/core/hex.ts';
import { ramClashPoint } from '../../shared/engine/turnEngine.ts';
import { windFor } from '../vfx/windMoves.ts';
import { lightningFor } from '../vfx/lightningMoves.ts';
import { clawFor } from '../vfx/slashMoves.ts';
import { elementFor } from '../vfx/auraPalette.ts';
import type { MoveVfx } from '../vfx/MoveVfx.ts';
import type { BattleCamera } from '../camera/BattleCamera.ts';
import { hpColor } from '../theme.ts';
import { HEX_SIZE } from '../hexWorld.ts';

/** Priority strikes whose user dashes coated head to toe in the move's element. */
const QUICK_COATED = new Set(['Zippy Zap', 'Aqua Jet', 'Grassy Glide', 'Flame Charge', 'Aerial Ace']);
/** A punching move (Mach Punch, Bullet Punch, Fire Punch, Hammer Arm…): thrown with an arm, never a kick. */
const isPunch = (name: string): boolean => /Punch|Fist|Hammer Arm|Uppercut/.test(name);
/** Moves whose coat is not their type's own colours: Brave Bird's Flying aura (and tornado) in gold. */
/**
 * Moves whose coat is not their type's plain aura: Sky Attack's Flying aura
 * (and its sphere) in gold; Brave Bird's is Flare Blitz's fire aura, in its
 * usual colours, with its fire sphere in blue flame.
 */
const MOVE_AURA: Record<string, Partial<AuraOptions> & { element: string }> = {
  'Sky Attack': { element: 'Gold' },
  'Brave Bird': { element: 'Fire', noiseElement: 'BlueFire' },
};
/** The aura a move coats its user in (whole body): its own (MOVE_AURA), or its type's. */
const auraOf = (moveName: string | null | undefined, type: string): AuraOptions =>
  ({ element: type, edge: 'tongues', reach: 'body', ...(moveName ? MOVE_AURA[moveName] : undefined) });
/** A move's recoil (a fraction of the damage it deals; 0 for none). */
const recoilOf = (moveName: string | null | undefined): number => (moveName ? getMove(moveName)?.recoilFraction ?? 0 : 0);

/** A quick step with no landing tile stops this far short of its target (world). */
const QUICK_GAP = 1.6 * HEX_SIZE;

/** The aura a move's lightning leaves its target in (Electric's; Ice Beam's icy one, Psybeam's psychic one), or null. */
function zapOf(moveName: string, type: string): string | null {
  return moveName === 'Ice Beam' ? 'Ice' : moveName === 'Psybeam' ? 'Psychic' : type === 'Electric' ? 'Electric' : null;
}

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

    // Broke free as the turn began (not by a hit, nor fainting): the ice shatters first.
    const thawedByHit = new Set(msg.resolvedActions.flatMap((a) => (a.statuses ?? []).filter((s) => s.status !== 'frozen').map((s) => s.playerId)));
    const thaws: Promise<void>[] = [];
    for (const pid of [1, 2]) {
      const was = pid === 1 ? prevState.pokemon.p1 : prevState.pokemon.p2;
      const now = pid === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      const node = nodes.get(pid);
      if (node && was?.status === 'frozen' && now?.status !== 'frozen' && now?.status !== 'fainted' && !thawedByHit.has(pid)) {
        this.vfx.floatingText(node.position.clone().add(new Vector3(0, 1.2, 0)), 'Broke free!', '#BAE6FD');
        thaws.push(this.factory.thaw(node));
      }
    }
    if (thaws.length) await Promise.all(thaws);

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
      if (this.factory.isFrozen(node)) this.vfx.floatingText(node.position.clone().add(new Vector3(0, 1.2, 0)), 'Frozen solid!', '#7DD3FC');
      else this.vfx.floatingText(node.position.clone(), 'Blocked!', '#EF4444');
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
    const ballSpec = beamSpec ? null : ballFor(action.moveName);
    const pulseSpec = beamSpec || ballSpec ? null : this.pulseOf(action.moveName, node, msg);
    const windSpec = beamSpec || pulseSpec ? null : windFor(action.moveName);
    const boltSpec = beamSpec || pulseSpec || windSpec ? null : lightningFor(action.moveName);
    let aura: AuraHandle | null = null;
    // (Its stat changes already played — a self-boost plays them with its appeal.)
    let staged = false;
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
      // The grass under it catches as it lands (not at the turn's end).
      if (action.moveName === 'Flamethrower') this.board.lightGrassFires(msg.newState);
    } else if (ballSpec) {
      // A ball attack: it charges at the mouth and flies; the hit lands as it bursts on the target.
      const ball = this.factory.playBall(node, defenderNode ?? null, targetPos, ballSpec);
      beamDone = ball.done;
      beamContactEnds = ball.contactEnds;
      await ball.hit;
    } else if (action.moveName === 'Fire Spin' || action.moveName === 'Whirlpool') {
      // Fire Spin: rings of fire spin up round the target's tile, and its grass
      // catches. Whirlpool: the same, in water.
      const spin = this.factory.playSpin(node, targetPos, action.moveName === 'Whirlpool' ? 'Water' : 'Fire');
      beamDone = spin.done;
      beamContactEnds = spin.contactEnds;
      await spin.hit;
      if (action.moveName === 'Fire Spin') this.board.lightGrassFires(msg.newState);
    } else if (windSpec) {
      // Gust / Twister: the tornado effect; contact lasts while it holds the target.
      const wind = this.factory.playWind(node, defenderNode ?? null, targetPos, windSpec);
      beamDone = wind.done;
      beamContactEnds = wind.contactEnds;
      await wind.hit;
    } else if (boltSpec) {
      // Lightning: the caster's Electric aura (which earths off its body) while
      // the bolt is on the target.
      aura = this.factory.aura(node, { element: 'Electric', edge: 'smooth', reach: 'tight', ignite: 0.3, die: 0.5, shiver: true, charging: true });
      // Thunder that missed (it did the target no harm): its bolts fall all round it, none on it.
      const defNow = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      const missed = boltSpec.kind === 'thunder' && (defNow?.current_hp ?? 0) >= (hpBefore.get(defenderId) ?? defNow?.current_hp ?? 0);
      const bolt = this.factory.playLightning(node, defenderNode ?? null, targetPos, missed ? { ...boltSpec, miss: true } : boltSpec);
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
      const quick = move.quickDash;
      // A punch (Mach Punch, Bullet Punch…): thrown with an arm, always — its
      // fist coated, its arm's clip played (a species whose attack is a kick
      // punches with its swipe).
      const punch = isPunch(move.name);
      // A plain contact attack (not a priority dash, not a ram's charge): a
      // flurry of its own blows, more and faster the stronger it is — no
      // aura (the blows change hands).
      const flurry = !quick && !move.isRam && !!this.factory.playFlurry;
      if (punch && !flurry) {
        aura = this.factory.aura(node, { element: mtype, edge: 'tongues', reach: 'body', strike: 'punch' });
        await aura.lit;
      } else if (!quick && !flurry) {
        aura = this.factory.aura(node, { element: mtype, edge: 'tongues', reach: 'body', strike: claw ? 'swipe' : true, blade: !!claw });
        await aura.lit;
      } else if (QUICK_COATED.has(move.name) || move.isRam) {
        // Zippy Zap, Aqua Jet, Grassy Glide, Flame Charge: the whole body
        // coated in the move's element (a fire's with its noise bursting off it).
        aura = this.factory.aura(node, auraOf(move.name, mtype));
        await aura.lit;
      }
      if (move.isRam) {
        // A ram attack (Flare Blitz, Take Down, Head Smash…): it runs straight
        // in, coated in its type's aura, into the target — no strike at the
        // end: the impact knocks it back a tile.
        const land = this.quickLanding(action, node, targetPos, defenderNode ?? null);
        const from = action.fromTile, to = action.qaLandedAt;
        const path = from && to
          ? hexLineTiles(from[0], from[1], to[0], to[1]).slice(1).map((t) => this.board.standPoint(t[0], t[1]))
          : [land];
        // (Its own run: in the air, its air run.)
        await this.factory.playRunInto(node, path, targetPos, mtype, 'run');
        if (aura) { void aura.release(); aura = null; }
        // At the impact, together: the target thrown back (or aside) a tile,
        // and the recoil on the user — both flash at once.
        const def = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
        const me = action.playerId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
        if (me) {
          this.onHp?.(action.playerId, me.current_hp, me.max_hp);
          void this.factory.playHitReact(node, hpColor(me.current_hp / Math.max(1, me.max_hp)));
        }
        const kb = action.knockback;
        if (kb && defenderNode) {
          const maxHp = def?.max_hp ?? 1, hp = def?.current_hp ?? 0;
          this.onHp?.(defenderId, hp, maxHp);
          thrown = this.factory.playKnockback(defenderNode, this.board.standPoint(kb.to[0], kb.to[1], def?.huge === true), hpColor(hp / maxHp));
        }
      } else if (quick && move.doublePass) {
        // Aerial Ace: through the target, round behind it and back through,
        // on to its stop two tiles short on the way it came — a blur of
        // afterimages, in its Flying coat, all the way. The hit is the second
        // blow; its coat holds until it has stopped and turned back. One on
        // the ground hops it (it cannot turn in the air): jump, land, strike,
        // jump past, land, turn round, and back the same way.
        const stop = this.quickLanding(action, node, targetPos, defenderNode ?? null);
        const ace = this.factory.playAerialAce(node, defenderNode ?? null, targetPos, stop, mtype, true);
        beamDone = ace.done;
        await ace.hit;
      } else if (quick) {
        // A priority strike (Quick Attack, Bullet Punch, Sucker Punch...): the
        // quick step, auraless unless coated (QUICK_COATED), its bursts in the
        // move's type colours. It lands where the engine put it (Quick
        // Attack's landing tile), or in front of the target; the end burst
        // only if a Pokémon is on the target tile.
        const land = this.quickLanding(action, node, targetPos, defenderNode ?? null);
        const was = defenderId === 1 ? this.prevState?.pokemon.p1 : this.prevState?.pokemon.p2;
        const contact = !!defenderNode && (!action.toTile || !was || (was.tile[0] === action.toTile[0] && was.tile[1] === action.toTile[1]));
        const strike = punch ? (this.factory.punchPlan?.(node).key === 'swipe' ? 'swipe' : 'attack') : 'swipe';
        await this.factory.playQuickStep(node, targetPos, land, strike, mtype, contact);
        // A coat drops off it as the blow lands — Aqua Jet's water bursts off.
        if (contact && aura) { void (aura.burst ? aura.burst() : aura.release()); aura = null; }
      } else if (flurry) {
        await this.factory.playFlurry!(node, targetPos, move.basePower);
      } else {
        await this.factory.playAttackLunge(node, targetPos, punch ? this.factory.punchPlan?.(node).key === 'swipe' : !!claw);
      }
      // Its marks hang in the air as the blow lands.
      if (claw) clawMarks = this.factory.playClaw(node, defenderNode ?? null, claw);
    } else if (cast === 'appeal') {
      // A self-boost (Agility, Swords Dance…): its appeal (a mega form's mega
      // appeal) with the stat change's tornado round it at once — no aura.
      await Promise.all([this.factory.playCast(node, targetPos, cast), this.stageFx(action, nodes)]);
      staged = true;
    } else if (cast) {
      aura = cast === 'ranged'
        ? this.factory.aura(node, { element: mtype, edge: 'smooth', reach: 'tight', ignite: 0.35, die: 0.6 })
        : null;
      await this.factory.playCast(node, targetPos, cast);
    }

    // Dodged (an accuracy miss): as the attack comes, the defender side-steps
    // to the tile beside it, leaving its afterimage where it stood.
    if (action.dodge) {
      const dn = nodes.get(action.dodge.playerId);
      const ds = action.dodge.playerId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      if (dn) {
        const dodged = this.factory.playDodge(dn, this.board.standPoint(action.dodge.to[0], action.dodge.to[1], ds?.huge === true));
        // Its attacker stops, missed, and only then turns to look where it went.
        await this.factory.playMissLook(node, dn, dodged);
      }
    }

    // Damage/HP delta for this defender from newState.
    const defAfter = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
    const before = hpBefore.get(defenderId) ?? defAfter?.current_hp ?? 0;
    const after = defAfter?.current_hp ?? before;
    const dmg = Math.max(0, before - after);
    hpBefore.set(defenderId, after);

    const strong = dmg >= STRONG_HIT;
    if (!beamSpec && !ballSpec && !pulseSpec && !windSpec && !boltSpec && action.moveName !== 'Fire Spin' && action.moveName !== 'Whirlpool' && !(move && isSelfArea(move)) && !clawMarks) await this.vfx.playMove(elementFor(mtype, node.metadata?.species, !!node.metadata?.shiny), node.position.clone(), targetPos, strong);

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
      // (Ice Beam's icy lightning: the same, in the Ice aura.)
      let struck: AuraHandle | null = null;
      const zap = zapOf(action.moveName ?? '', mtype);
      if (zap) {
        struck = this.factory.aura(defenderNode, { element: zap, edge: 'smooth', reach: 'body', fill: true, ignite: 0.08, die: 0.35, shiver: true });
        await struck.lit;
      }
      // Frozen solid by it (or thawed out): mid-flinch.
      const iced = this.statusFx(action, defenderId, defenderNode);
      if (beamContactEnds) {
        // A beam keeps it flinching for as long as the beam is on it.
        void this.factory.playHitReact(defenderNode, hpColor(after / maxHp));
        this.factory.holdHitReact(defenderNode, beamContactEnds);
        if (struck) { const s = struck; void beamContactEnds.then(() => s.release()); }
      } else {
        await this.factory.playHitReact(defenderNode, hpColor(after / maxHp));
        if (struck) void struck.release();
      }
      await iced;
    } else if (move && move.basePower > 0 && defenderNode) {
      this.vfx.floatingText(defenderNode.position.clone(), 'Miss', '#9CA3AF');
    } else if (move && move.terrainTypePlaced) {
      this.vfx.floatingText(targetPos, move.terrainTypePlaced.replace('_', ' '), '#A855F7');
    }
    // The aura holds through the whole strike (or pour) and the hit, then goes out.
    if (beamDone) await beamDone;
    if (aura) void aura.release();
    // Its stat changes, on whoever they fell on: a rise or a fall (a self-boost's already played with its appeal).
    if (!staged) await this.stageFx(action, nodes);
  }

  /**
   * The stat stages `action` moved: on each Pokémon changed, a momentary
   * sweep round it — rising (red, orange) if they went up on the whole,
   * sinking (blue, light blue) if down. Both at once where both changed.
   */
  private async stageFx(action: ResolvedActionWire, nodes: Map<number, TransformNode>): Promise<void> {
    const net = new Map<number, number>();
    for (const s of action.stages ?? []) net.set(s.playerId, (net.get(s.playerId) ?? 0) + Math.sign(s.delta));
    await Promise.all([...net].filter(([, n]) => n !== 0).map(([pid, n]) => {
      const node = nodes.get(pid);
      return node ? this.factory.playStatChange(node, n > 0) : Promise.resolve();
    }));
  }

  /**
   * A freeze or its end by `action` on `who`: a beat into its flinch, the body
   * stops and the ice forms on it (the floating word over it); or the hit
   * shatters the ice (or a Fire move melts it, in steam). Resolves when it is
   * done (at once if neither).
   */
  private async statusFx(action: ResolvedActionWire | undefined, who: number, node: TransformNode): Promise<void> {
    const s = action?.statuses?.find((x) => x.playerId === who);
    if (!s) return;
    const above = node.position.clone().add(new Vector3(0, 1.2, 0));
    if (s.status === 'thawed' || s.status === 'shattered') {
      const melt = s.status === 'thawed';
      this.vfx.floatingText(above, melt ? 'Melted!' : 'Shattered!', melt ? '#FDBA74' : '#BAE6FD');
      await this.factory.thaw(node, melt ? 'melt' : 'shatter');
      return;
    }
    await sleep(220);
    this.vfx.floatingText(above, 'Frozen solid!', '#7DD3FC');
    await this.factory.freeze(node);
  }

  /**
   * Two beams met head-on (the engine's clash): they hold, then the winner
   * pushes the ball back into the loser and its beam lands — or, evenly
   * matched, both disperse.
   */
  /**
   * A pulse move's look (pulseFor) — Terrain Pulse in the colour of the
   * terrain it takes the type of, if its user is on the ground.
   */
  private pulseOf(name: string | null | undefined, user: TransformNode | null, msg: ResolutionMsg): PulseSpec | null {
    const p = pulseFor(name);
    if (!p || name !== 'Terrain Pulse') return p;
    const species = user?.metadata?.species as string | undefined;
    const types = (species && getSpecies(species)?.types) || [];
    // The terrain up as it was used (it may have run out by the turn's end).
    const terrain = [...msg.newState.terrain, ...(this.prevState?.terrain ?? [])];
    return { ...p, element: terrainPulseElement(terrain, types) };
  }

  /** Where a quick step lands: the engine's landing tile (Quick Attack), or just in front of the target. */
  private quickLanding(action: ResolvedActionWire, node: TransformNode, targetPos: Vector3, defender: TransformNode | null): Vector3 {
    if (action.qaLandedAt) return this.board.standPoint(action.qaLandedAt[0], action.qaLandedAt[1]);
    const to = defender ? defender.position : targetPos;
    const d = to.subtract(node.position); d.y = 0;
    const L = d.length();
    if (L < 1e-3) return to.clone();
    return to.subtract(d.scale(Math.min(L * 0.9, QUICK_GAP) / L));
  }

  /**
   * A ram clash: both coated in their types' auras leap into each other and
   * butt at the middle, the contact burst looping. A tie: both rebound a tile
   * (the engine's knockbacks). A win: the winner drives into the loser's tile
   * and the loser is thrown back (three tiles, or aside), struck — and the
   * winner feels its recoil at the same moment.
   */
  private async playRamClash(
    action: ResolvedActionWire, other: ResolvedActionWire, a: TransformNode, b: TransformNode,
    msg: ResolutionMsg, hpBefore: Map<number, number>,
  ): Promise<void> {
    const clash = action.clash!;
    const [ia, ib] = clash.players;
    const typeA = moveType(action.moveName!), typeB = moveType(other.moveName!);
    this.camera.focusOn(action.fromTile ?? [0, 0]);
    const auraA = this.factory.aura(a, auraOf(action.moveName, typeA));
    const auraB = this.factory.aura(b, auraOf(other.moveName, typeB));
    await Promise.all([auraA.lit, auraB.lit]);
    // They meet at the engine's clash point (the tile midway between them).
    const point = action.fromTile && other.fromTile ? ramClashPoint(action.fromTile, other.fromTile).tile : null;
    const mid = point ? this.board.standPoint(point[0], point[1]) : Vector3.Center(a.position, b.position);
    this.vfx.floatingText(mid.add(new Vector3(0, 1.4, 0)), 'Clash!', '#FDE68A');
    // A win: the winner drives on to its tile straight out of the clash, its pose held.
    const won = clash.winner === null ? null : clash.winner === ia ? action : other;
    const winTo = won?.qaLandedAt ? this.board.standPoint(won.qaLandedAt[0], won.qaLandedAt[1]) : null;
    const { onward } = await this.factory.playRamClash(a, b, typeA, typeB, undefined, undefined, mid,
      winTo && won ? { node: clash.winner === ia ? a : b, to: winTo, land: !(recoilOf(won.moveName) > 0) } : undefined,
      clash.winner === null ? null : clash.winner === ia ? a : b);
    void auraA.release(); void auraB.release();
    const state = (pid: number) => (pid === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2);
    const flashHp = (pid: number, node: TransformNode) => {
      const s = state(pid);
      if (!s) return;
      const before = hpBefore.get(pid) ?? s.current_hp;
      hpBefore.set(pid, s.current_hp);
      this.onHp?.(pid, s.current_hp, s.max_hp);
      return { color: hpColor(s.current_hp / Math.max(1, s.max_hp)), hurt: before > s.current_hp };
    };
    const throwTo = (kb: ResolvedActionWire['knockback'], node: TransformNode, pid: number) => {
      if (!kb) return Promise.resolve();
      const f = flashHp(pid, node);
      return this.factory.playKnockback(node, this.board.standPoint(kb.to[0], kb.to[1], state(pid)?.huge === true), f?.color ?? [0.9, 0.6, 0.2]);
    };
    if (clash.winner === null) {
      this.vfx.floatingText(mid.add(new Vector3(0, 1.0, 0)), 'Rebound!', '#9CA3AF');
      // Both rebound at once, a tile back from each other.
      await Promise.all([throwTo(action.knockback, a, ia), throwTo(other.knockback, b, ib)]);
      return;
    }
    const [winAct, winNode, winId, loseNode, loseId] = clash.winner === ia ? [action, a, ia, b, ib] : [other, b, ib, a, ia];
    const moves: Promise<void>[] = [throwTo(winAct.knockback, loseNode, loseId)];
    // The recoil, the same moment.
    const w = flashHp(winId, winNode);
    if (w?.hurt) void this.factory.playHitReact(winNode, w.color);
    moves.push(onward);
    await Promise.all(moves);
  }

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
    const ramA = action.moveName ? getMove(action.moveName) : undefined, ramB = other?.moveName ? getMove(other.moveName) : undefined;
    if (ramA?.isRam && ramB?.isRam && other) { await this.playRamClash(action, other, a, b, msg, hpBefore); return; }
    // (A bolt, Thunderbolt, clashes as a beam does: lightning straight off its body, no egg.)
    const bolt = (name: string | null | undefined) => lightningFor(name ?? '')?.kind === 'bolt';
    // (A ball attack: it flies in and becomes its half of the ball.)
    const ballOf = (name: string | null | undefined): BeamSpec | null => {
      const b = ballFor(name);
      return b ? { element: b.element, ball: b.colours ?? true, tornado: b.tornado } : null;
    };
    // (A pulse attack: it keeps pulsing at the clash point, against the other's half.)
    const pulseOf = (name: string | null | undefined): BeamSpec | null => {
      const p = this.pulseOf(name, nodes.get(name === action.moveName ? ia : ib) ?? null, msg);
      return p ? { element: p.element, pulse: { scale: p.scale } } : null;
    };
    const specOf = (name: string | null | undefined): BeamSpec => beamFor(name) ?? ballOf(name) ?? pulseOf(name)
      ?? { element: name ? moveType(name) : 'Normal', bolt: bolt(name), eggless: bolt(name) };
    const winner = clash.winner === null ? null : clash.winner === ia ? a : b;
    this.camera.focusOn(action.fromTile ?? [0, 0]);
    const mid = Vector3.Center(a.position, b.position);
    this.vfx.floatingText(mid.add(new Vector3(0, 1.4, 0)), 'Clash!', '#FDE68A');
    const play = this.factory.playClash(a, b, specOf(action.moveName), specOf(other?.moveName), winner, clash.margin);
    // As the beams meet, a Flamethrower burns the grass under its own beam, each half in its own fire.
    void play.met.then(() => {
      if (!action.fromTile || !other?.fromTile) return;
      this.board.lightClashFires(this.prevState ?? msg.newState,
        { tile: action.fromTile, pid: ia, fire: action.moveName === 'Flamethrower' },
        { tile: other.fromTile, pid: ib, fire: other.moveName === 'Flamethrower' });
    });
    await play.hit;
    // Resolved: the fires take their final look (a fire winning takes the line; a tie keeps its halves).
    this.board.lightGrassFires(msg.newState);
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
      const zap = winAction?.moveName ? zapOf(winAction.moveName, moveType(winAction.moveName)) : null;
      if (zap) {
        struck = this.factory.aura(loserNode, { element: zap, edge: 'smooth', reach: 'body', fill: true, ignite: 0.08, die: 0.35, shiver: true });
        await struck.lit;
      }
      void this.factory.playHitReact(loserNode, hpColor(hp / after.max_hp));
      this.factory.holdHitReact(loserNode, play.done);
      if (struck) { const s = struck; void play.done.then(() => s.release()); }
      // Frozen solid by the winner's beam (or thawed out by its fire).
      const iced = this.statusFx(winAction, loserId, loserNode);
      await play.done;
      await iced;
      return;
    }
    await play.done;
  }
}
