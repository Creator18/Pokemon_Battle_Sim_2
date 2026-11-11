/**
 * RecipeFactory — the real Pokémon, built at runtime from the Legends Z-A
 * archive data (see src/client/recipe/), skinned, coloured on the GPU and
 * animated with the game's own clips.
 *
 * Every Pokémon is scaled by SQUEEZE: displayed height = A · realHeight^K. With
 * K = 0.5 the size ORDER and feel survive (Pikachu is still clearly the
 * smallest, Gardevoir the tallest) but the spread shrinks from about 3.8x to
 * 1.9x, so all of them read on a hex tile. K = 1 is true size, K = 0 is one
 * height for all.
 *
 * Anything that fails to load (no archives, an unknown form) falls back to the
 * stylized primitive from PokemonFactory, and every call on that unit is
 * passed through to it.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { bodyFlameMaterial } from './grassFire.ts';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import type { SpeciesDefinition } from '../../shared/index.ts';
import { loadPokemon, formId } from '../recipe/loader.js';
import { buildPokemon } from '../recipe/babylon.js';
import type { PokemonFactory } from './PokemonFactory.ts';
import type { BeamPlay, CastKind, ClashPlay, UnitFactory } from './unitFactory.ts';
import { arcTo, KNOCK_TIME, KNOCK_ARC, KNOCK_MIN_ARC } from './unitFactory.ts';
import { clashBallRadius, TARGET_BODY, type BeamFx, type BeamClash } from '../vfx/beam/BeamFx.ts';
import { throwBall, evolveAura, BALL_TO_CLASH, NOISE_FIRST, ballNoiseColours } from '../vfx/beam/BallFx.ts';
import type { DashRings } from '../vfx/DashRings.ts';
import { ImpactFrame } from '../vfx/ImpactFrame.ts';
import type { PulseFx, PulseSpec } from '../vfx/PulseFx.ts';
import type { WindFx } from '../vfx/WindFx.ts';
import type { WindSpec } from '../vfx/windMoves.ts';
import { iceBlock, shatterIce, meltIce, ICE_ALPHA, type IceBlock } from './iceBlock.ts';
import { ICE_BOLT, PSY_BOLT, type LightningFx, type EarthOptions, type BoltColors } from '../vfx/LightningFx.ts';
import type { SlashFx } from '../vfx/SlashFx.ts';
import { QuickStepFx } from '../vfx/QuickStepFx.ts';
import { gaitSpeed } from './gait.ts';
import { flurryStrikes, buildFlurry, flurryShape, type FlurryStrike } from './flurry.ts';
import { toClip, bakeHandAttack, retarget, mirrorClip, type Rig } from './handAttacks.ts';
import { sampleTrack } from '../recipe/tranm.js';
import { ArcSlashFx } from '../vfx/ArcSlashFx.ts';
import { SparkleFx } from '../vfx/SparkleFx.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { ClawSpec } from '../vfx/slashMoves.ts';
import type { LightningSpec } from '../vfx/lightningMoves.ts';
import type { BeamSpec } from '../vfx/beam/beamMoves.ts';
import type { BallSpec } from '../vfx/beam/ballMoves.ts';
import { fireTone } from '../vfx/xorFire.ts';
import { RisingFire, FireSphere } from '../vfx/FireFx.ts';
import { auraReach, auraLineReach, type UnitFx, type AuraHandle, type AuraOptions } from '../vfx/UnitFx.ts';
import { elementFor, auraGlow, isFire, type RGB } from '../vfx/auraPalette.ts';
import { WaterCoat, FIRE_BURSTS, BLUE_FIRE_TOWARD, waterSurface } from '../vfx/WaterCoat.ts';
import { SkinSampler, VertexSubset } from './skinSampler.ts';
import { BODY_PARTS, BLADES, CLAW_ON_ATTACK, STRIKE_PARTS, partBones, partMeasureBone, regionFlags } from './bodyParts.ts';
import { effectStart } from '../recipe/traef.js';
import { chestOf, findStrikeRegion, type StrikeRegion, type Peeker } from './strikeRegion.ts';
import { matchBones, snapshotModel, bonePositions, pairOnto, LiveSkin, footVertices, plant, buildGraph, smoothOver, smoothScratch, tiePieces, keepTied } from './evolution.ts';
import { FOOT_CAP, FOOT_CAP_HUGE, HEX_SIZE, TILE_SCALE, worldToAxial, axialToWorld } from '../hexWorld.ts';
import { meadowPatch } from './grass.ts';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { StandardMaterial as LeafMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';

/** The Babylon classes the recipe builder uses, passed in (it reaches for no global). */
const B = {
  TransformNode, Mesh, VertexData, SubMesh, Quaternion, Vector3, Matrix, Color3, Skeleton, Bone,
  Material, MaterialPluginBase, MultiMaterial, StandardMaterial, RawTexture, Texture,
};

/** displayed height = A * realHeight^K (world units; a hex tile is ~1.7 across). */
export const SQUEEZE = { A: 1.3, K: 0.5 };
/**
 * Drawn this much bigger than the squeeze and the footprint cap make them
 * (huge ones filling their three-tile triangle): Zygarde Complete (100%) and
 * Mega Zygarde — the cannon a little past the triangle's ends.
 */
/** A move along a path eases in over its first this much (world units) and out over its last. */
const PATH_EASE = 0.9;
/** A leaping charge's pace (× a run's). */
const LEAP_SPEED = 1.15;
/**
 * A ram clash: how long the two hold, butting at the middle (s); how often the
 * contact burst goes off there (s).
 */
const RAM_CLASH_HOLD = 1.4, RAM_CLASH_EVERY = 0.22;
/** A ram clash won: the winner's burst at the clash point, this much larger than the contact bursts. */
const RAM_CLASH_WIN_BURST = 2.2;
/** A dodge's side-step: how long (s), and how often it leaves an afterimage on the way (s). */
const DODGE_TIME = 0.2, DODGE_GHOST_EVERY = 0.07;
/** A miss: how long its attacker stands, after the dodge, before it turns to look (s). */
const MISS_PAUSE = 0.3;
/**
 * Turning with its turn clip (playTurnToward): the least turn worth it (rad),
 * how much of its clip the body takes to come round, the least that takes
 * (s), and its fade in and back out to idle (s).
 */
const TURN_MIN = 0.12, TURN_CLIP_SHARE = 0.85, TURN_LEAST = 0.3, TURN_FADE = 0.18;
/** A ram clash's standoff: how far each aura streams out behind, away from the clash point (× its standoff). */
const RAM_CLASH_STRETCH = 2.3;
/** Any gap kept between two clashing bodies' aura outlines beyond their meeting (× their height). */
const RAM_CLASH_CLEAR = 0.08;
/** A ram clash: the fade into its charging pose at the clash point, and out of it (s). */
const RAM_CHARGE_FADE = 0.2;
/** A ram clash's standoff: the most its auras grow, to meet at the midpoint (× their own). */
const RAM_CLASH_GROW_MAX = 3;
/** A leap's forward reach: pitches tried, and the margin for the jump pose's limbs (× its reach). */
const LEAP_REACH_STEPS = 12, LEAP_REACH_MARGIN = 0.3;
/** A leap landing: levelling out of its pitch, and into its idle (s). */
const LEAP_LAND = 0.3;
/**
 * A leap's clips: its jump-up start slowed (× its speed), the fade from it into
 * the loop; its jump-down start's speed and fade in; the landing's fade in;
 * and the fade from the landing into its idle (s).
 */
/** A leap sets off once its snout is within LEAP_ALIGN (rad) of level along its way, or after LEAP_ALIGN_MAX s. */
const LEAP_ALIGN = 0.09, LEAP_ALIGN_MAX = 0.4;
const LEAP_START_SPEED = 0.4, LEAP_LOOP_FADE = 0.22, LEAP_DOWN_SPEED = 1, LEAP_DOWN_FADE = 0.2, LEAP_LAND_FADE = 0.12, LEAP_IDLE_FADE = 0.3;
/**
 * A Flying coat (windCoat): how quickly it reads how the body moves (/s), the
 * speed past which it counts as moving (/s), how far past the body its ends
 * reach (x the body's length along it), and how far clear of the body it stands (x).
 */
const WIND_COAT_SENSE = 10, WIND_COAT_MOVING = 0.6, WIND_COAT_PAD = 0.12, WIND_COAT_HEAD = 0.35, WIND_COAT_CLEAR = 1.1, WIND_COAT_TALL = 1.7;
/** A Flying coat's shape: a sphere round the body's middle, or the tornado's waisted funnel. */
const WIND_COAT_SHAPE: 'sphere' | 'tornado' = 'sphere';
/** Flames bursting out of a fire aura's body (risingFire): how far out each reaches (× the body's reach from its middle), and how wide round (radius, × its height). */
const RISING_FIRE_OUT = 1.7, RISING_FIRE_WIDE = 0.2;
/** A fire aura's sphere (fireSphere): how far round the body it stands (× its farthest point from its middle). */
const FIRE_SPHERE_CLEAR = 1.05;
/** …and its change between still and moving: how long its wipe (s). */
const FIRE_SPHERE_WIPE = 0.6;
/** …and how long it reads its size off the body (s), kept after; and how quickly its middle follows the body's mass (/s). */
const FIRE_SPHERE_SIZING = 0.5, FIRE_SPHERE_FOLLOW = 8, FIRE_SPHERE_LEARN = 0.5;
/** …and in the air, where its low fade starts (× its radius below its middle: 1 its very foot, less fading more of it). */
const FIRE_SPHERE_AIR_FLOOR = 1.0;
/** The Fire aura's sphere inked (FireSphere's `ink`): more cartoon, as Fire Blast's burst. */
const FIRE_AURA_INK = true;
/** The Flying coat's tornadoes cel shaded (WindFx.coat's `cel`), as the inked fire sphere. */
const WIND_COAT_CEL = true;
/**
 * A fire sphere's cel bands per element where not the Fire aura's (coolest to
 * hottest), after each aura's outline and fill: a whole-body aura of each of
 * these carries one (Dragon's purples; Fighting's red round blue; Dark's black
 * round red; Ghost's black round purple).
 */
const FIRE_SPHERE_BANDS: Record<string, [RGB, RGB, RGB]> = {
  Dragon: [[0.3, 0.05, 0.6], [0.5, 0.2, 0.88], [0.8, 0.66, 1.0]],
  Fighting: [[0.7, 0.04, 0.03], [0.92, 0.18, 0.1], [0.35, 0.58, 1.0]],
  Dark: [[0.06, 0.0, 0.03], [0.5, 0.03, 0.08], [0.88, 0.12, 0.14]],
  Ghost: [[0.08, 0.03, 0.14], [0.38, 0.15, 0.68], [0.7, 0.5, 1.0]],
  // (The crystal spheres: unused, their crystals' colour, their sheen.)
  Steel: [[0.06, 0.07, 0.09], [0.62, 0.68, 0.76], [0.85, 0.92, 1.0]],
  Rock: [[0.1, 0.08, 0.05], [0.6, 0.5, 0.36], [0.86, 0.78, 0.62]],
  Ground: [[0.1, 0.07, 0.03], [0.74, 0.56, 0.3], [0.94, 0.82, 0.56]],
  Ice: [[0.05, 0.1, 0.14], [0.58, 0.84, 1.0], [0.9, 0.98, 1.0]],
};
/** Sphere elements whose sphere is a cel-shaded crystal sphere (FireSphere's `lattice`), not flames. */
const LATTICE_SPHERES = new Set(['Steel', 'Rock', 'Ground', 'Ice']);
/** The Water aura's coat cel shaded (WaterCoat's `cel`), as the inked fire sphere. */
const WATER_CEL = true;
/**
 * Parts made of fire beyond the model's own `fire` material and those its model gives the flame noise, by species
 * (burnFlames): material names that burn too. (None needed yet: Ceruledge's plume and blades are flagged by its model.)
 */
const FLAME_PARTS: Record<string, RegExp> = {};
/** Parts of a model that are water (by their shape's name): Mega Greninja's shurikens, held, holed and small. */
const WATER_PARTS = /_(ana|mini)?shuriken_mesh_shape$/;
/** Of them, the single discs, whose water swirls in toward their centre (the small ones are several to a shape). */
const WATER_SWIRLS = /_(ana)?shuriken_mesh_shape$/;

/** A flat disc's centre and its axis (unposed): its points' middle, and its normals summed one way. */
function discOf(mesh: Mesh): { centre: [number, number, number]; axis: [number, number, number] } | null {
  const p = mesh.getVerticesData(VertexBuffer.PositionKind), n = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!p || !n || !p.length) return null;
  const c = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; }
  const k = 3 / p.length;
  const a = [0, 0, 0], first = [n[0], n[1], n[2]];
  for (let i = 0; i < n.length; i += 3) {
    const s = n[i] * first[0] + n[i + 1] * first[1] + n[i + 2] * first[2] < 0 ? -1 : 1;
    a[0] += n[i] * s; a[1] += n[i + 1] * s; a[2] += n[i + 2] * s;
  }
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return { centre: [c[0] * k, c[1] * k, c[2] * k], axis: [a[0] / l, a[1] / l, a[2] / l] };
}

/** A Water aura on the whole body a water tornado round it (WindFx.coat in the Water's tones), not the coat of water. */
const WATER_TORNADO = true;
/** An Electric aura's lightning strokes: this much thicker than the strokes earthing off other auras. */
const ELECTRIC_THICK = 1.4;
/** A rolling attack held in a clash rolls on at least this fast (world units/s), if it came in slower. */
const ROLL_HOLD_SPEED = 4;
/** A beam clash's blow: an impact frame (ImpactFrame) the moment the two fronts meet. */
const IMPACT_ON_CLASH = true;
/**
 * A Grass coat's leaves: how many, how fast they go round (rad/s, about the
 * coat's streaks), their size (× the coat's radius), their fade in and out
 * (s); a leaf's fold (its halves' rise per width), its halves' greens (deep,
 * pale), its rib and its stem.
 */
const LEAF_COUNT = 22, LEAF_SPIN = 2.4, LEAF_SIZE = 0.3, LEAF_FADE = 0.35;
const LEAF_FOLD = 0.35;
const LEAF_DEEP = [0.26, 0.68, 0.16], LEAF_PALE = [0.52, 0.88, 0.28], LEAF_RIB = [0.82, 0.98, 0.52], LEAF_STEM = [0.42, 0.58, 0.2];
/** A Grass aura's meadow: how long its tile's grows up, and sinks back (s); how far over the tile it sits (world). */
const MEADOW_GROW = 0.6, MEADOW_SINK = 0.5, MEADOW_LIFT = 0.005;
/** How many flames burst out of it, spread all round. */
const RISING_FIRE_COUNT = 10;
/** How much of the snout's tilt off level it corrects each frame, and the most it ever pitches (rad). */
const LEAP_FOLLOW = 0.35, LEAP_MAX = 1.7;
/** The snout read only when this far ahead of the middle (× the model's height); the pitch turned at most this much a frame (rad). */
const LEAP_AHEAD = 0.08, LEAP_TURN = 0.09;
/** Setting off: how long it takes to blend into the jump pose, and to tip into the pitch (s). */
const LEAP_FADE = 0.25, LEAP_BLEND = 0.22;
/**
 * Some are drawn bigger than the fit to their tiles makes them: Zygarde's
 * full forms; Mega Steelix, whose rest pose lies stretched out straight
 * (about 19 m, twice Steelix's), so the fit shrinks it to half Steelix's
 * size though it coils as big — boosted back to Steelix's.
 */
const SIZE_BOOST: Record<string, number> = { 'Zygarde Complete': 1.35, 'Mega Zygarde': 1.2, 'Mega Steelix': 2.08 };
/** A stat change's sweep stands this far out round the body (× half its widest reach). */
const STAT_CLEAR = 0.85;
export const displayHeight = (realHeight: number) => SQUEEZE.A * Math.pow(Math.max(0.05, realHeight), SQUEEZE.K);

const FLASH_PEAK = 0.85; // how much of the body the flash covers
const FLASH_HOLD = 0.07; // s at full
const FLASH_FADE = 0.22; // s back to normal

/** Seconds a beam keeps pouring after its front has struck. */
const BEAM_HOLD = 0.8;
/** A ball in a clash: how much of its way to where they meet it must have flown before its half of the clash's ball takes over. */
const CLASH_BALL_ARRIVE = 0.97;
/** A beam clash: how long the beams hold even before one pushes (s), and how long a bare win takes to push the ball back (s). */
const CLASH_STANDOFF = 0.9, CLASH_PUSH = 2.0;
/** Bones that mark the snout, best first: the beam pours from the mean of the first two found. */
const MOUTH_BONES = ['center_nose', 'nose', 'upper_jaw', 'jaw', 'lower_jaw_02', 'lower_jaw', 'root_jaw'];

const WALK_SPEED = 2.6 * TILE_SCALE; // world units / s (tiles are larger now)
const RUN_SPEED = 4.4 * TILE_SCALE;
/** How fast a hand-steered unit turns toward where it is steered (rad/s). */
const STEER_TURN = 10;

/** What buildPokemon returns, as far as this file uses it. */
interface RecipeModel {
  root: TransformNode;
  meshes: Mesh[];
  skeleton: Skeleton;
  height: number;
  restBounds: { min: number[]; max: number[] };
  player: {
    play(action: string, opts?: { loop?: boolean; fade?: number; speed?: number }): Promise<boolean>;
    has(action: string): boolean;
    /** Pose the bones as `action` stands `t` s in, call fn, put the live pose back. */
    peek(action: string, t: number, fn: () => void): void;
    active: { action: string } | null;
    /** Seconds into the active clip. */
    time: number;
    clips: Map<string, { duration: number; fps?: number; events?: ClipEvent[] }>;
    /** Its playback rate (×). */
    speed: number;
    /** Frozen solid: it holds its pose whatever is played. */
    frozen: boolean;
    /** Advance the active clip `dt` s and pose the bones there. */
    update(dt: number): void;
  };
  /** Shapes the idle hides (vines, jets, open wings…): the player draws them while a clip turns them on. */
  props: { name: string; mesh: Mesh; boneIndices: Float32Array; boneWeights: Float32Array }[];
  setFlash(rgb: [number, number, number], amount: number): void;
  setLift(y: number): void;
  dispose(): void;
}

interface Unit {
  model: RecipeModel;
  down: boolean;
  skin: SkinSampler;
  /** Hover height above the tile (world units): where it is heading, and where it is now. */
  hoverTarget: number;
  hover: number;
  /** Mid-leap (a ram's charge or its clash): its whole body, not just its feet, kept out of the ground. */
  leaping?: boolean;
  /** Its Flying coat and its fire sphere held this way (world, unit) as if moving, still or not: a ram clash. */
  coatWay?: Vector3;
  /** The ground clamp's current lift (world units). */
  clamp: number;
  /** Who it keeps facing, and whether it is walking (then it faces its path). */
  lookAt: TransformNode | null;
  /** Holding the way it faces for now (not turning to its opponent): after a miss, until it has stopped and looked. */
  lookHold?: boolean;
  /** In a rolling attack (Rollout, Ice Ball, Gyro Ball…): its crystal sphere rolls along with it. */
  rolling?: boolean;
  moving: boolean;
  /** Its types (an Electric type crackles to the ground whenever its aura is up). */
  types: readonly string[];
  /** Which body part leads each clip it has struck with (null: the whole body), worked out once. */
  strikeParts: Map<string, string | null>;
  /** Its species' name. */
  species: string;
  /** Frozen solid: its block of ice (iceBlock.ts); it neither moves nor turns. */
  ice?: IceBlock | null;
  /** What strikes in each clip when no limb leads it, to the vertex (strikeRegion.ts), worked out once. */
  strikeRegions: Map<string, StrikeRegion | null>;
  /** How many vertices each part carries (skinOn), worked out once. */
  skinCounts: Map<string, number>;
  /** Its blade's vertex region (bodyParts.BLADES), worked out once. */
  blade?: { key: string; flags: Map<AbstractMesh, Float32Array> };
  /** How it stands (stanceOf): on two legs, four, or either. */
  stance?: 'biped' | 'quadruped' | 'both';
  /** How it punches (punchPlan): its clip, and the hand that leads it. */
  punch?: { key: 'attack' | 'swipe'; part: string | null };
  /** Its flurry's strikes (flurry.ts), worked out once on the ground and once in the air. */
  flurry?: Map<'ground' | 'air', FlurryStrike[]>;
  /** Each gait's ground speed as its feet tell it (its rig's units a second; null: they can't), once asked. */
  gait?: Map<string, number | null>;
  /** Its mirrored strike (a cross's second blow: its swipe's strike, left and right swapped), once made. */
  crossStrike?: string | null;
  /** Taking off or coming down (fly): its jump's clips play, steering only moves it. */
  lofting?: boolean;
  /** Its per-frame upkeep (height, facing), removed when it is replaced. */
  upkeep: Observer<Scene> | null;
  /** The water its water parts are made of (soakWaterParts: Mega Greninja's shurikens), if it has any. */
  waterParts?: Material[];
  /** Its feet (every vertex skinned to a foot or toe bone), if its rig has any: they stand on the ground. */
  feet: VertexSubset | null;
  /** Its feet up off the ground now (something else of it lowest: FEET_UP), and the frames till that is checked again. */
  feetUp?: boolean;
  feetCheck?: number;
}

/** Evolution: seconds to glow white (and to fade it), and for the surface to flow into the new shape. */
const EVOLVE_GLOW = 0.7, EVOLVE_MORPH = 2.2;
/** How many smoothing steps a morphing surface's destinations get each frame. */
const SMOOTH_STEPS = 8;

/** How fast a unit turns to face its opponent (rad/s). */
const TURN_SPEED = 7;

/** Ground clamp: allowed sink before lifting (world units), and how fast it follows. */
const CLAMP_EPS = 0.01;
const CLAMP_DOWN = 6; //  per second, relaxing back
/** How fast feet settle onto the ground (per second, of the gap). */
const FEET_RATE = 20;
/**
 * Its feet stand it only while they are the lowest of it: when some other
 * part hangs this far below them (× its height) — Mega Greninja upside down
 * on its shuriken — its lowest point stands on the tile instead (as a body
 * with no feet). Checked every FEET_UP_EVERY frames.
 */
const FEET_UP = 0.25, FEET_UP_EVERY = 6;
/** Take-off / landing climb rate (world units per second) and the lowest cruise height. */
const CLIMB_SPEED = 2.4;
const MIN_FLIGHT = 0.9;
/** How high a hand-steered flier flies (m). */
const FLY_HEIGHT = 2.6;

/** A strike part carrying fewer vertices than this shows nothing worth a coat (its skin is elsewhere). */
const MIN_PART_VERTS = 24;
/**
 * Pokémon whose beams come out of cannons, not the mouth: by species, the
 * root bone of each cannon (the cannon is it and everything below it). Each
 * fires its own beam, CANNON_THICKNESS[count] as thick, from its muzzle (the
 * cannon's furthest-forward point), all converging on the one target or clash
 * point, and all starting level (BeamShot.twin).
 */
const CANNONS: Record<string, string[]> = {
  Blastoise: ['left_feeler_b_01', 'right_feeler_b_01'],
  // The big cannon on its back (over its head) and one on each arm.
  'Mega Blastoise': ['feeler_b_01', 'left_feeler_a_01', 'right_feeler_a_01'],
};
/** Bolts in colours of their own, by element (default: Electric's). */
const BOLT_COLORS: Record<string, BoltColors | undefined> = { Ice: ICE_BOLT, Psychic: PSY_BOLT };
/**
 * A bolt's ends on a body (surfaceToward): how much a point off the line
 * counts against it, and how far in from the surface the bolt runs (× height)
 * — sunk into the body, which hides its end: it comes out of the glowing body
 * (and goes into it) rather than stopping short in the aura.
 */
const SURFACE_SIDE = 1.5, SURFACE_IN = 0.12;
/** Thunder's bolts that miss land at least this far off the target: × the way to the next tile's middle, or × its height if more. */
const THUNDER_CLEAR = 0.5, THUNDER_CLEAR_BODY = 0.7;
/**
 * A quick step (Quick Attack): the dash's length (s; it ends on the clip's
 * moment of contact), and how often it leaves an afterimage of its pose (s).
 */
const QS_DASH = 0.16, QS_GHOST_EVERY = 0.035;
/** Its bursts' radii (× its height): small behind it as it goes, larger at the blow. */
const QS_LAUNCH_BURST = 0.6, QS_HIT_BURST = 1.15;
/** A chasing charge (chargeAt): how fast it runs (world units / s), and how long it may chase before it gives up (s). */
const CHARGE_SPEED = 9, CHARGE_MAX_TIME = 3;
/**
 * Aerial Ace (playAerialAce): how fast it goes (world units/s) and the least
 * its whole run takes (s); the loop behind its target (its reach, in tiles,
 * and its width as a share of that); the share of the run it eases to a stop
 * over; its beat before it goes (s); and how long
 * it stands, stopped, before it turns back (s).
 */
const ACE_SPEED = 34, ACE_LEAST = 0.35, ACE_LOOP = 0.8, ACE_LOOP_WIDTH = 0.75, ACE_EASE = 0.12,
  ACE_WIND_UP = 0.1, ACE_SETTLE = 0.1;
/** Aerial Ace: how far it runs on straight past its target before it loops (tiles), and how its heading lags round the bends (s). */
const ACE_RUN_ON = 0.5, ACE_TURN_LAG = 0.025;
/** Aerial Ace: how far either side of each blow it holds its attack pose (tiles). */
const ACE_STRIKE_SPAN = 0.25;
/**
 * A jumping Aerial Ace: the most a leap rises (× its height, and at least
 * this, world), the longest its spring takes (s), and the longest it stands
 * in its landing at the end before it turns back (s).
 */
const ACE_JUMP_HEIGHT = 0.45, ACE_JUMP_LEAST = 0.6, ACE_JUMP_SPRING = 0.2, ACE_LAND = 0.2;
/**
 * Its hops: how high a leap rises for its length (× length, up to the
 * height above), how far short of each blow's stretch it touches down
 * (tiles), and how far into its landing clip the pose it holds there is (s).
 */
const ACE_JUMP_STEEP = 0.25, ACE_JUMP_SETTLE = 0.2, ACE_LAND_POSE = 0.08;
/** Jumping: how far past its target it lands to turn round (tiles), and the longest that turn takes (s). */
const ACE_JUMP_PAST = 0.9, ACE_GROUND_TURN = 0.2;
/**
 * Jumping: its charge before it leaps — before the first (s, seen), before
 * each after it (s, a beat on the ground), and how far into its charge clip
 * the pose it holds for that beat is (s).
 */
const ACE_CHARGE_FIRST = 0.3, ACE_CHARGE_BEAT = 0.1, ACE_CHARGE_POSE = 0.15;
/** A clash point never closer to either attacker than this share of the way between them. */
const CLASH_MEET = 0.08;
/** Freezing: its body slows to a stop over this (s), then its ice grows over this. */
const FREEZE_SLOW = 0.35, FREEZE_GROW = 0.8;
const CANNON_THICKNESS: Record<number, number> = { 2: 0.6, 3: 0.5 };

/** A ball attack charges at least this long (s) before it is let fly. */
const BALL_CHARGE = 1.0;
/** Fire Blast's burst (fireBurst): its sphere of flame's first radius (× the attacker's height), how much it swells, over how long (s), and the share of that before it starts dying down. */
const FIRE_BURST_R = 0.3, FIRE_BURST_GROW = 2.4, FIRE_BURST_TIME = 0.45, FIRE_BURST_HOLD = 0.8;
/** Its lower part faded out: from this far below its middle (× its radius), up over half its radius. */
const FIRE_BURST_FLOOR = 0.8;
/** A beam (or a beam-bolt) charges at least this long (s) before it pours. */
const BEAM_CHARGE = 1.1;
/** An attack clip's blow lands HIT_AT of the way through it (at most HIT_CAP s in). */
const HIT_AT = 0.45, HIT_CAP = 0.7;
/** What strikes is judged on its swing up to FOLLOW s after the blow (later is follow-through). */
const FOLLOW = 0.15;
/** A swipe's hand: sampled every SWEEP_STEP s; it sweeps if it peaks at SWEEP_MIN × the model's height per second. */
const SWEEP_STEP = 0.05, SWEEP_MIN = 1;
/** …within SWEEP_AROUND s of the blow. */
const SWEEP_AROUND = 0.15;
/** A swipe's blow lands SWIPE_HIT s into its strike clip (on its first frames: EFFECTS.md, clawEnd at phase 0). */
const SWIPE_HIT = 0.03;
/**
 * A cross (playCrossSlash): how long each arm's swing is traced at most (s), how long afterimages are left along it
 * (s) and how often, how solid; how soon after the first blow the second strike comes (s), how much quicker it plays,
 * when in it its blow falls (s, at its own pace); its slash's edge past the part and its inner edge (× its height);
 * its burst's size (× its height).
 */
const CROSS_TRACE = 0.7, CROSS_GHOSTS = 0.3, CROSS_GHOST_EVERY = 0.06, CROSS_GHOST = 0.6, CROSS_NEXT = 0.15, CROSS_SPEED = 1.25;
const CROSS_SECOND_HIT = 0.1, CROSS_REACH = 0.22, CROSS_INNER = 0.2, CROSS_BURST = 0.3;
/** A cross by one with more than one arm a side (Machamp): how many frames its swing is watched before its trail locks to the arm moving most. */
const CROSS_PICK = 4;
/** Cross slashes laid on a sphere round the attacker (ArcSlashFx.trail `sphere`), not flat along the arm. */
const CROSS_SPHERE = true;
/** Its sphere's radius (× the attacker's height): about its arm's reach. */
const CROSS_SPHERE_R = 0.75;

/**
 * The motion a strike is measured on: the plain attack clip, or a swipe (its
 * wind-up and its strike, one after the other, looked at as one): how long
 * it runs, when its blow lands, and how to pose the skeleton at any time in it.
 */
/** A clip's event (traef.js): its type, its frames, its parameters. */
type ClipEvent = { type: string; start: number; end: number; params: Record<string, string | number | boolean> };
interface StrikeClip { key: 'attack' | 'swipe'; duration: number; hit: number; peek(t: number, fn: () => void): void }
/** A claw's swing: how the striking part moves from SWING_BEFORE s before the blow to SWING_AFTER after it. */
const SWING_BEFORE = 0.1, SWING_AFTER = 0.03;

/** An action's airborne twin, when the unit is in the air and has one ('idle' -> 'airIdle'). */
const airName = (action: string) => `air${action[0].toUpperCase()}${action.slice(1)}`;

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

/** A flurry: its clip's name on the player, how far it steps in (× the way to its target, unit), and its afterimages' opacity. */
const FLURRY_CLIP = 'flurry', FLURRY_STEP = 0.45, FLURRY_GHOST = 0.75;

/** A rig's feet: every vertex skinned to a foot or toe bone (or below one), or null if it has none. */
function feetOf(model: RecipeModel): VertexSubset | null {
  const sk = model.skeleton;
  const roots = sk.bones.filter((b) => /(^|_)(foot|toe)(_|$)/.test(b.name));
  if (!roots.length) return null;
  const set = new Set<number>();
  for (const b of sk.bones) for (let x: Bone | null = b; x; x = x.getParent()) if (roots.includes(x)) { set.add(b.getIndex()); break; }
  const feet = new VertexSubset(model.meshes, sk, set, 0.4);
  return feet.size ? feet : null;
}

/**
 * A part counts as leading a strike if the clip drives it this far forward of
 * the body (× the model's height). Measured on hands (2026-10-17): Machamp
 * 0.38, Gengar 0.33, Charizard 0.22 (a claw), Lucario 0.19 (a punch) — against
 * Gardevoir 0.12, Absol 0.11, Pikachu 0.05, whose attacks are the whole body's.
 */
const STRIKE_REACH = 0.17;
/** A tail leads only if its tip gets this far in front of the body's middle (× height). */
const TAIL_AHEAD = 0.25;
/** The upper limbs' ends a punch is thrown with. */
const HANDS: readonly string[] = ['left_hand', 'right_hand'];
/** On four legs: a hand within FOURS_GROUND × the height of the ground for FOURS_SHARE of the clip or more, sampled every FOURS_STEP s. */
const FOURS_GROUND = 0.08, FOURS_SHARE = 0.3, FOURS_STEP = 1 / 15;
/** What delivers a blow: looked for from IMPACT_BEFORE s before its effect starts to IMPACT_AFTER after, every IMPACT_STEP s; thrusting forward at least IMPACT_DRIVE × the height per second. */
const IMPACT_BEFORE = 0.3, IMPACT_AFTER = 0.2, IMPACT_STEP = 1 / 30, IMPACT_DRIVE = 1.5;

/**
 * Which body part leads a clip (any clip: a punch, a kick, a bite, a tail
 * swipe): looked ahead through it, the part (STRIKE_PARTS) that drives
 * furthest forward (+Z in the model's own frame) in one swing — from the
 * furthest back it had been before (a wind-up first draws it back: Garchomp's
 * claw starts the clip already forward) — up to just after the blow (what
 * swings on afterwards is follow-through, not the strike), less the most the
 * body (the hips) swings — so a lunge or a tackle, which carries everything
 * along, is led by nothing. A chain (a tail) only leads if its tip
 * swings round well in front of the body's middle (TAIL_AHEAD) at some point:
 * a tail tip whips a long way in any attack. Measured: Raichu 1.33, Gyarados
 * 0.99, Onix 0.70, Pikachu 0.38 in front — Lucario's only 0.08 (it punches).
 * Null if no part reaches STRIKE_REACH.
 */
function findStrikePart(model: RecipeModel, clip: StrikeClip | null, only?: readonly string[]): string | null {
  if (!clip) return null;
  const sk = model.skeleton;
  const parts = (only ?? STRIKE_PARTS).map((part) => ({ part, bone: partMeasureBone(sk, part) })).filter((x) => !!x.bone) as { part: string; bone: Bone }[];
  if (!parts.length) return null;
  const body = sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? null;
  const zOf = (b: Bone) => b.getAbsoluteMatrix().getTranslation().z;
  // The furthest back each has been so far, and its biggest forward swing from there.
  const back = new Map<string, number>(), reach = new Map<string, number>(), ahead = new Set<string>();
  let bodyBack = 0, bodyReach = 0;
  clip.peek(0, () => {
    sk.computeAbsoluteMatrices(true);
    bodyBack = body ? zOf(body) : 0;
    parts.forEach(({ part, bone }) => { back.set(part, zOf(bone)); reach.set(part, 0); });
  });
  const STEPS = 24;
  for (let s = 1; s <= STEPS; s++) {
    clip.peek((Math.min(clip.duration, clip.hit + FOLLOW) * s) / STEPS, () => {
      sk.computeAbsoluteMatrices(true);
      const bodyZ = body ? zOf(body) : 0;
      if (body) { bodyBack = Math.min(bodyBack, bodyZ); bodyReach = Math.max(bodyReach, bodyZ - bodyBack); }
      parts.forEach(({ part, bone }) => {
        back.set(part, Math.min(back.get(part)!, zOf(bone)));
        reach.set(part, Math.max(reach.get(part)!, zOf(bone) - back.get(part)!));
        if (zOf(bone) - bodyZ > TAIL_AHEAD * model.height) ahead.add(part);
      });
    });
  }
  let best: string | null = null;
  for (const { part } of parts) {
    if (BODY_PARTS[part]?.measure === 'tip' && !ahead.has(part)) continue;
    if (!best || reach.get(part)! > reach.get(best)!) best = part;
  }
  return best && reach.get(best)! - bodyReach > STRIKE_REACH * model.height ? best : null;
}

export class RecipeFactory implements UnitFactory {
  private readonly units = new WeakMap<TransformNode, Unit>();

  constructor(
    private readonly scene: Scene,
    private readonly fallback: PokemonFactory,
    /** Flash and aura outlines on the silhouettes (optional: the gallery has none). */
    private readonly fx: UnitFx | null = null,
    /** The beam attacks (optional, like fx). */
    private readonly beams: BeamFx | null = null,
    /** The wake rings left by a dash (optional). */
    private readonly dash: DashRings | null = null,
    /** The sonar pulse (optional). */
    private readonly pulses: PulseFx | null = null,
    /** Tornadoes and wind (optional). */
    private readonly wind: WindFx | null = null,
    /** Lightning: earthing strokes and bolts (optional). */
    private readonly lightning: LightningFx | null = null,
    /** Claw marks (optional). */
    private readonly slashes: SlashFx | null = null,
  ) {}

  /** The hand each unit last clawed with (they alternate when the strike part does not say). */
  private lastClaw = new WeakMap<TransformNode, number>();
  /** The quick step's pieces (Quick Attack), once one is played. */
  private quickStep: QuickStepFx | null = null;
  private arcSlash: ArcSlashFx | null = null;
  /** A Grass aura's meadow patch: built once, instanced. */
  private meadowSrc: Mesh | null = null;
  /** The impact frame (a beam clash's blow), once one fires. */
  private impact: ImpactFrame | null = null;
  private impactFrame(): ImpactFrame | null {
    const cam = this.scene.activeCamera;
    return cam ? (this.impact ??= new ImpactFrame(this.scene, cam)) : null;
  }

  async createPokemon(species: SpeciesDefinition, playerId: number, onProgress?: (fraction: number) => void, opts: { shiny?: boolean } = {}): Promise<TransformNode> {
    try {
      const shiny = !!opts.shiny;
      const data = await loadPokemon(species.modelId ?? formId(species.spriteId), { onProgress, shiny });
      const shadowGenerator = (this.scene.metadata as { shadowGen?: ShadowGenerator } | undefined)?.shadowGen ?? null;
      const model = buildPokemon(B, this.scene, data, { shadowGenerator }) as unknown as RecipeModel;
      // Squeezed by height; then anything longer or wider than FOOT_CAP on the
      // floor (Steelix, Onix, Kyogre…) shrinks to fit, so it fits on a tile.
      let scale = displayHeight(model.height) / model.height;
      const rb = model.restBounds;
      const foot = Math.max(rb.max[0] - rb.min[0], rb.max[2] - rb.min[2]) * scale;
      // A huge one has a three-tile triangle to fill.
      const cap = species.huge ? FOOT_CAP_HUGE : FOOT_CAP;
      if (foot > cap) scale *= cap / foot;
      // Some are drawn bigger still (SIZE_BOOST: Zygarde's full forms, Mega Steelix).
      scale *= SIZE_BOOST[species.name] ?? 1;
      model.root.scaling.setAll(scale);
      model.root.metadata = { species: species.name, playerId, facing: 0, recipe: true, shiny };
      this.burnFlames(model, species.name, shiny, displayHeight(model.height));
      const u: Unit = { model, down: false, skin: new SkinSampler(model.meshes, model.skeleton), hoverTarget: 0, hover: 0, clamp: 0, lookAt: null, moving: false, types: species.types,
        strikeParts: new Map(), strikeRegions: new Map(), skinCounts: new Map(), species: species.name, upkeep: null, feet: feetOf(model) };
      this.units.set(model.root, u);
      this.fx?.register(model.root, model.meshes, model.skeleton, model.props.map((p) => p.mesh));
      u.upkeep = this.scene.onBeforeRenderObservable.add(() => this.updateHeight(model.root, u));
      u.waterParts = this.soakWaterParts(model);
      void model.player.play('idle', { fade: 0 });
      return model.root;
    } catch (e) {
      console.warn(`[recipe] ${species.name}: ${(e as Error).message} — using the stylized model instead`);
      onProgress?.(1);
      const node = await this.fallback.createPokemon(species, playerId);
      this.fx?.register(node, node.getChildMeshes(), null);
      return node;
    }
  }

  /**
   * Its parts made of water (WATER_PARTS: Mega Greninja's shurikens — the one
   * it holds, the holed Water Shuriken it throws, the small ones): their own
   * surface is the Water auras' water (waterSurface, cel shaded) in place of
   * their texture, for good — so they are water through and through, spun
   * and thrown as ever, their hole their own. A single disc of one (not the
   * small ones, several to a shape) swirls as a vortex in toward its centre.
   */
  private soakWaterParts(model: RecipeModel): Material[] {
    const parts = [...model.meshes, ...model.props.map((p) => p.mesh)].filter((m) => WATER_PARTS.test(m.name));
    const tint = auraGlow('Water')[1];
    return parts.map((m) => {
      const water = waterSurface(this.scene, model.height, tint, WATER_CEL, WATER_SWIRLS.test(m.name) ? discOf(m) : null);
      const multi = m.material as MultiMaterial | null;
      if (multi?.subMaterials) multi.subMaterials.forEach((_, i) => { multi.subMaterials[i] = water; });
      else m.material = water;
      return water;
    });
  }

  /**
   * Its own flames (the model's `fire` material: Charizard's tail, Emboar's
   * collar, Delphox's stick) burn in the grass fires' noise (grassFire.ts,
   * bodyFlameMaterial), in its fire's colours — blue for blue flames (Mega
   * Charizard X, a shiny Emboar), the Litwick line's ghostly violet
   * (auraPalette.elementFor: the same colours its Fire moves wear).
   */
  private burnFlames(model: RecipeModel, species: string, shiny: boolean, height: number): void {
    const element = elementFor('Fire', species, shiny);
    let flame: Material | null = null;
    for (const mesh of [...model.meshes, ...model.props.map((p) => p.mesh)]) {
      const multi = mesh.material as MultiMaterial | null;
      if (!multi?.subMaterials) continue;
      multi.subMaterials.forEach((m, i) => {
        if (!m) return;
        // Fire: its own \`fire\` material, one its model gives the flame noise (a Gen 9 DLC model's fire_msk:
        // Armarouge's crest, Ceruledge's plume and blades, Charcadet's flames), or one named for it (FLAME_PARTS).
        const flagged = !!(m.metadata as { fireMask?: unknown } | null)?.fireMask;
        if (!(/_fire(_[a-z0-9]+)?$/.test(m.name) || flagged || FLAME_PARTS[species]?.test(m.name))) return;
        flame ??= bodyFlameMaterial(this.scene, element, model.height); // (the noise is in the model's own space)
        multi.subMaterials[i] = flame;
      });
    }
  }

  // ── animation ──────────────────────────────

  async playMoveTo(node: TransformNode, worldPath: Vector3[], hover: number[] = []): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playMoveTo(node, worldPath, hover);
    if (worldPath.length === 0) return;
    u.moving = true;
    try { await this.walk(u, node, worldPath, hover); } finally { u.moving = false; }
  }

  /**
   * Steered by hand, a frame at a time (real time): `dir` the way it goes on
   * the ground (its length 0..1, the stick's push) or null to stand; it turns
   * toward it at STEER_TURN, goes at its walk or run pace, and plays to match.
   * `pace` scales both (tired, it goes slower and its legs with it: its feet
   * still keep their ground).
   */
  steer(node: TransformNode, dir: Vector3 | null, run: boolean, dt: number, pace = 1): void {
    const u = this.units.get(node);
    if (!u || u.down) return;
    const push = dir ? Math.min(1, dir.length()) : 0;
    const want = push < 0.05 ? 'idle' : run && u.model.player.has(this.act(u, 'run')) ? 'run' : 'walk';
    const clip = this.act(u, want);
    if (!u.lofting && u.model.player.active?.action !== clip && u.model.player.has(clip)) void u.model.player.play(clip, { fade: 0.15 });
    u.moving = want !== 'idle';
    if (!u.lofting) u.model.player.speed = u.moving ? pace : 1;
    if (!dir || !u.moving) return;
    const yaw = Math.atan2(dir.x, dir.z), now = node.rotation.y;
    const d = Math.atan2(Math.sin(yaw - now), Math.cos(yaw - now)), step = STEER_TURN * dt;
    this.setFacing(node, now + Math.max(-step, Math.min(step, d)));
    // At the pace its feet keep (none to go by, or flying: the board's pace).
    const paced = u.hoverTarget > 0 ? null : this.gaitOf(node, u, clip);
    const v = (paced ?? (want === 'run' ? RUN_SPEED : WALK_SPEED)) * pace * push * dt / dir.length();
    node.position.x += dir.x * v;
    node.position.z += dir.z * v;
  }

  /**
   * A hand-steered flier (one with an air idle) taking to the air (`up`) or
   * landing: it springs up in its jump and climbs to FLY_HEIGHT in its jump's
   * rise, or tips into its jump's fall, comes down in it and lands. False: it
   * can't fly (or is already on its way up or down).
   */
  async fly(node: TransformNode, up: boolean): Promise<boolean> {
    const u = this.units.get(node);
    if (!u || u.down || u.lofting || !u.model.player.has('airIdle')) return false;
    if (up === u.hoverTarget > 0) return true;
    const player = u.model.player;
    // (Its own clips its own way; steering only moves it till it is up or down.)
    u.lofting = true;
    try {
      if (up) {
        // Springs up (its jump's start), climbs in its jump's rise, then hovers.
        if (player.has('jumpUpStart')) await player.play('jumpUpStart', { fade: 0.12 });
        if (player.has('jumpUpLoop')) void player.play('jumpUpLoop', { fade: 0.1 });
        await this.climbTo(u, FLY_HEIGHT);
        void player.play('airIdle', { fade: 0.3 });
      } else {
        // Tips over into its jump's fall, comes down in it, and lands.
        if (player.has('jumpDownStart')) await player.play('jumpDownStart', { fade: 0.2 });
        if (player.has('jumpDownLoop')) void player.play('jumpDownLoop', { fade: 0.1 });
        await this.climbTo(u, 0);
        if (player.has('land')) await player.play('land', { fade: 0.08 });
        if (!u.down) void player.play(u.moving ? 'walk' : 'idle', { fade: 0.25 });
      }
    } finally { u.lofting = false; }
    return true;
  }

  /** Is it in the air (or on its way up)? */
  isFlying(node: TransformNode): boolean {
    return (this.units.get(node)?.hoverTarget ?? 0) > 0;
  }

  /** How high above the ground it is now (m): its flight, and anything lifting it. */
  liftOf(node: TransformNode): number {
    const u = this.units.get(node);
    return u ? u.hover + u.clamp : 0;
  }

  /** How fast `clip` carries the unit over the ground (world units a second), as its feet tell it; null where they can't. */
  private gaitOf(node: TransformNode, u: Unit, clip: string): number | null {
    u.gait ??= new Map();
    if (!u.gait.has(clip)) u.gait.set(clip, gaitSpeed(u.model.player as unknown as Rig, u.model.height, clip, this.onFours(node, [clip])));
    const v = u.gait.get(clip);
    return v == null ? null : v * u.model.root.scaling.x;
  }

  /** `wake`: unused now (no movement leaves dash rings); kept for its callers. */
  private async walk(u: Unit, node: TransformNode, worldPath: Vector3[], hover: number[], wake = true): Promise<void> {
    // A flier crossing (or leaving, or heading for) an obstacle flies the whole
    // way, at the height of the tallest one, and lands at the end if it can.
    const canFly = u.model.player.has('airIdle');
    const end = canFly ? (hover[worldPath.length - 1] ?? 0) : 0;
    const fly = canFly && (u.hoverTarget > 0 || hover.some((h) => h > 0));
    if (fly) {
      const cruise = Math.max(MIN_FLIGHT, u.hoverTarget, ...hover);
      if (u.hoverTarget <= 0) void u.model.player.play('airIdle', { fade: 0.2 });
      await this.climbTo(u, cruise);
    }
    const running = worldPath.length > 2 && u.model.player.has(this.act(u, 'run'));
    void u.model.player.play(this.act(u, running ? 'run' : 'walk'), { fade: 0.15 });
    // (No dash rings on movement, run or walk: user.)
    // The whole path in one smooth go: easing in at its start and out at its
    // end only, at its pace in between — never stopping on a tile along it.
    await this.tweenPath(node, worldPath, running ? RUN_SPEED : WALK_SPEED);
    if (fly) {
      void u.model.player.play('airIdle', { fade: 0.25 });
      await this.climbTo(u, end);
    }
    if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.25 });
  }

  /**
   * Hover `height` above the tile the unit stands on (0 = on it). Called
   * after placing the unit on its tile; snaps there with the matching idle.
   */
  setHover(node: TransformNode, height: number): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.setHover(node, height);
    const h = u.model.player.has('airIdle') ? height : 0;
    const changed = (h > 0) !== (u.hoverTarget > 0);
    u.hoverTarget = u.hover = h;
    if (changed && !u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  async playAttackLunge(node: TransformNode, targetPos: Vector3, swipe = false): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playAttackLunge(node, targetPos, swipe);
    const start = node.position.clone();
    const dir = targetPos.subtract(start);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) {
      dir.normalize();
      this.setFacing(node, Math.atan2(dir.x, dir.z));
    }
    if (swipe && this.strikeKey(u, true) === 'swipe') {
      // A claw or a slash: the swipe — its wind-up, then straight into the
      // strike, whose first frames are the blow; the step in lands with it.
      const player = u.model.player, end = this.act(u, 'swipeEnd');
      const windUp = player.clips.get(this.act(u, 'swipeStart'))!.duration;
      void this.tween(node, start.add(dir.scale(0.45)), Math.max(0.12, windUp)).then(() => this.tween(node, start, 0.35));
      await player.play(this.act(u, 'swipeStart'), { fade: 0.12 });
      void player.play(end, { fade: 0 }).then(() => {
        if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
      });
      await sleep(SWIPE_HIT);
      return;
    }
    const hitAt = this.oneShot(u, this.act(u, 'attack'), HIT_AT, HIT_CAP);
    // A short step in and back, alongside the clip's own swing.
    void this.tween(node, start.add(dir.scale(0.45)), 0.18).then(() => this.tween(node, start, 0.3));
    // No wake rings at contact (user): a lunge is just the step in and back.
    await sleep(hitAt);
  }

  /**
   * A physical attack as a flurry (flurry.ts): its own attack and swipe cut
   * to their strikes, thrown `power`'s many blows (stronger: more, faster),
   * left and right in turn, each a random way, on the spot — a step in to
   * begin, back once done — an afterimage at each blow. Resolves on its last
   * blow (the hit); it plays on out to its idle. A unit with no strikes to
   * throw lunges instead.
   */
  async playFlurry(node: TransformNode, targetPos: Vector3, power: number): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playAttackLunge(node, targetPos);
    const strikes = this.flurryOf(node, u);
    if (!strikes.length) return this.playAttackLunge(node, targetPos);
    const start = node.position.clone();
    const dir = targetPos.subtract(start);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) {
      dir.normalize();
      this.setFacing(node, Math.atan2(dir.x, dir.z));
    }
    const player = u.model.player, rig = player as unknown as Rig;
    const { hits, tempo } = flurryShape(power);
    const made = buildFlurry(rig, strikes, hits, tempo);
    player.clips.set(FLURRY_CLIP, toClip(made.clip, FLURRY_CLIP, (player as unknown as { shown: unknown[] }).shown));
    // A step in as it begins, back as it ends.
    void this.tween(node, start.add(dir.scale(FLURRY_STEP)), 0.15);
    // An afterimage at each blow.
    const t0 = performance.now();
    let left = 0;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000;
      while (left < made.blows.length && t >= made.blows[left]) { if (!u.down) this.afterimage(node, FLURRY_GHOST); left++; }
    });
    void player.play(FLURRY_CLIP, { fade: 0.1 }).then(() => {
      this.scene.onBeforeRenderObservable.remove(obs);
      void this.tween(node, start, 0.25);
      if (!u.down && player.active?.action === FLURRY_CLIP) void player.play(this.act(u, 'idle'), { fade: 0.2 });
    });
    await sleep(made.blows[made.blows.length - 1] ?? 0);
  }

  /** Its flurry's strikes as it is now (on the ground, or in the air: its air clips), worked out once each. */
  private flurryOf(node: TransformNode, u: Unit): FlurryStrike[] {
    const where = u.hoverTarget > 0 ? 'air' : 'ground';
    u.flurry ??= new Map();
    let strikes = u.flurry.get(where);
    if (!strikes) {
      const sources = (['attack', 'swipe'] as const).flatMap((key) => {
        const clip = this.strikeClip(u, key);
        if (!clip) return [];
        const actions = key === 'attack' ? [this.act(u, 'attack')] : [this.act(u, 'swipeStart'), this.act(u, 'swipeEnd')];
        return [{ key, actions, hit: clip.hit, told: this.impactPart(node, key) }];
      });
      strikes = flurryStrikes(u.model.player as unknown as Rig, u.model.height, sources);
      u.flurry.set(where, strikes);
    }
    return strikes;
  }

  /**
   * A quick step into a strike (Quick Attack), timed to the strike: the clip
   * plays as ever (the attack clip, or the swipe's wind-up straight into its
   * strike), and the dash is anchored to its moment of contact — the user
   * vanishes QS_DASH s before it (a burst, a kick of dust), crosses to `land`
   * as speed streaks leaving afterimages of its pose every QS_GHOST_EVERY s,
   * and reappears there just as the blow lands. Bursts (the beam clash's
   * heavy noise, lighter, in the move type's colours): a small one where it
   * starts, a larger one at the end — only on contact (`contact`). Resolves
   * at the blow.
   */
  async playQuickStep(node: TransformNode, targetPos: Vector3, land: Vector3, strike: 'attack' | 'swipe' = 'attack', element = 'Normal',
    contact = true): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playAttackLunge(node, targetPos);
    const fx = (this.quickStep ??= new QuickStepFx(this.scene));
    const H = this.heightOf(node);
    const start = node.position.clone();
    const d = targetPos.subtract(start);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    // The swipe (its wind-up, then the strike as it arrives) or the attack clip.
    const player = u.model.player;
    // (In the air the swipe even for those whose claw is their plain attack,
    // CLAW_ON_ATTACK: Charizard dashes in with its air swipe.)
    const airborne0 = u.hoverTarget > 0 && !!this.strikeClip(u, 'swipe');
    const swipe = strike === 'swipe' && (airborne0 || this.strikeKey(u, true) === 'swipe');
    // The clip's moment of contact (s from now): the dash ends on it.
    let hitAt: number;
    if (swipe) {
      // The wind-up, then straight into the strike, whose first frames are the blow.
      const windUp = player.clips.get(this.act(u, 'swipeStart'))!.duration;
      const end = this.act(u, 'swipeEnd');
      void player.play(this.act(u, 'swipeStart'), { fade: 0.12 }).then(() => player.play(end, { fade: 0 })).then(() => {
        if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
      });
      hitAt = windUp + SWIPE_HIT;
    } else {
      hitAt = this.oneShot(u, this.act(u, 'attack'), HIT_AT, HIT_CAP);
    }
    const vanishAt = Math.max(0, hitAt - QS_DASH);
    await sleep(vanishAt);
    // Gone: a small burst just behind where it stood, its dome the way it goes.
    const way = land.subtract(start); way.y = 0;
    if (way.lengthSquared() < 1e-6) way.set(0, 0, 1);
    way.normalize();
    // (The beam clash's hemisphere burst, lighter, in the move type's beam colours.)
    const tone = this.hueOf(node, element);
    const burst = (at: Vector3, size: number) => {
      if (this.beams) this.beams.hemiBurst(at, way, size, tone, true);
      else fx.hemisphere(at, way, size * 2, new Color3(...auraGlow(tone)[0]));
    };
    // A flyer dashes at the height it hovers: its bursts and streaks with it,
    // and no dust kicked up off the ground below.
    const lift = new Vector3(0, u.hover + u.clamp, 0);
    const airborne = u.hover > 0.05;
    burst(start.add(lift).add(new Vector3(0, H * 0.45, 0)).subtract(way.scale(H * 0.25)), H * QS_LAUNCH_BURST);
    if (!airborne) fx.dust(start, H);

    const shown = u.model.meshes.map((m) => m.visibility);
    for (const m of u.model.meshes) m.visibility = 0;
    fx.streaks(start.add(lift), land.add(lift), H, QS_DASH);
    // Across, leaving its pose behind as it goes.
    await new Promise<void>((done) => {
      let t = 0, lastGhost = -1;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t += Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
        const k = Math.min(1, t / QS_DASH);
        node.position.copyFrom(Vector3.Lerp(start, land, k * k * (3 - 2 * k)));
        if (t - lastGhost >= QS_GHOST_EVERY && k < 1) {
          lastGhost = t;
          const g = this.frozenCopy(u);
          fx.ghost(g.meshes, g.dispose);
        }
        if (k >= 1) { this.scene.onBeforeRenderObservable.remove(obs); done(); }
      });
    });
    // There, as the blow lands: back, and — on contact (`contact`: a Pokémon
    // stands on the target tile; dashing onto an empty one, there is none) —
    // a larger burst at the contact point, its dome on into the target.
    u.model.meshes.forEach((m, i) => { m.visibility = shown[i]; });
    if (!airborne) fx.dust(land, H);
    if (contact) burst(Vector3.Lerp(land, targetPos, 0.5).add(lift.scale(0.5)).add(new Vector3(0, H * 0.45, 0)), H * QS_HIT_BURST);
  }

  /**
   * Aerial Ace: the quick step, stacked. A beat, and it is gone
   * — a burst, a kick of dust — and, a blur of afterimages throughout, slashes
   * straight through its target (the first hit), carries on past it, wheels
   * round behind it in a loop and slashes back through it from behind (the
   * second), and carries on along the way it came, pulling up at `stop` (two
   * tiles short of the target, on its line in): only there does it reappear,
   * and turns (its turn clip) back to face its target. Its bursts in
   * `element`'s colours; `target` flinches at the first hit. `hit` resolves
   * at the second, `done` once it has stopped and turned.
   *
   * Jumping (`jump`, a grounded one with its jump clips): it charges and
   * springs up (its jump-up clip) instead, and hops from blow to blow, as it
   * cannot turn in the air — jump, land, strike; charge, jump on past the
   * target, land, turn round there (its turn clip); charge, jump back, land,
   * strike from behind; charge, jump, land on `stop` (its landing clip), turn
   * back to it. Its afterimages hold its rising pose, its falling pose, its
   * landing, its charge, and catch it turning.
   */
  playAerialAce(node: TransformNode, target: TransformNode | null, targetPos: Vector3, stop: Vector3, element = 'Flying',
    jump = false): BeamPlay {
    let hit!: () => void;
    const hitP = new Promise<void>((r) => { hit = r; });
    const done = (async () => {
      const u = this.units.get(node);
      if (!u) { await this.fallback.playAttackLunge(node, targetPos); hit(); return; }
      const fx = (this.quickStep ??= new QuickStepFx(this.scene));
      const H = this.heightOf(node);
      const start = node.position.clone();
      const T = new Vector3(targetPos.x, start.y, targetPos.z);
      const end = new Vector3(stop.x, start.y, stop.z);
      const w = T.subtract(start); w.y = 0;
      if (w.lengthSquared() < 1e-6) w.set(0, 0, 1);
      w.normalize();
      const side = new Vector3(w.z, 0, -w.x);
      this.setFacing(node, Math.atan2(w.x, w.z));
      // Jumping (below): a grounded one with its jump clips.
      const player = u.model.player;
      const leaps = jump && u.hoverTarget <= 0.05 && ['jumpUpStart', 'jumpUpLoop', 'jumpDownLoop'].every((a) => player.has(this.act(u, a)));
      // The path: straight in through the target and on past it (it only
      // bends well behind it), a loop there and back onto the line, straight
      // back through the target from behind, and on to where it stops.
      // Jumping, it cannot turn in the air: no loop — it lands past the
      // target, turns round there on the ground, and comes straight back.
      const tile = Math.sqrt(3) * HEX_SIZE;
      const P = T.add(w.scale((leaps ? ACE_JUMP_PAST : ACE_RUN_ON) * tile));
      const L = ACE_LOOP * tile;
      const c1 = P.add(w.scale(L)).add(side.scale(L * ACE_LOOP_WIDTH));
      const c2 = P.add(w.scale(L)).subtract(side.scale(L * ACE_LOOP_WIDTH));
      const loopAt = (t: number) => {
        const a = 1 - t;
        return P.scale(a * a * a + t * t * t).add(c1.scale(3 * a * a * t)).add(c2.scale(3 * a * t * t));
      };
      const pts: Vector3[] = [];
      const N = 24;
      for (let i = 0; i <= N; i++) pts.push(Vector3.Lerp(start, T, i / N));
      const hit1 = pts.length - 1;
      for (let i = 1; i <= N / 2; i++) pts.push(Vector3.Lerp(T, P, i / (N / 2)));
      const turnAt = pts.length - 1;
      if (!leaps) for (let i = 1; i <= N * 2; i++) pts.push(loopAt(i / (N * 2)));
      for (let i = 1; i <= N / 2; i++) pts.push(Vector3.Lerp(P, T, i / (N / 2)));
      const hit2 = pts.length - 1;
      for (let i = 1; i <= N; i++) pts.push(Vector3.Lerp(T, end, i / N));
      const at: number[] = [0];
      for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Vector3.Distance(pts[i - 1], pts[i]));
      const total = at[at.length - 1];
      const secs = Math.max(ACE_LEAST, total / ACE_SPEED);
      const sAt = (s: number): [Vector3, Vector3] => {
        let i = 1;
        while (i < at.length - 1 && at[i] < s) i++;
        const k = (s - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]);
        const dir = pts[i].subtract(pts[i - 1]);
        return [Vector3.Lerp(pts[i - 1], pts[i], Math.max(0, Math.min(1, k))), dir];
      };
      // Full speed from the off; it eases to a stop over the last ACE_EASE of it.
      const c = 1 - ACE_EASE;
      const g = (k: number) => (k < c ? k : k - (k - c) * (k - c) / (2 * (1 - c)));
      const ease = (k: number) => g(k) / g(1);
      // Jumping, it hops from blow to blow, landing before each: a leap in
      // that comes down just short of its target, on the ground through the
      // blow, a leap on past it down to where it turns round, a leap back
      // down again just short of it, the second blow on the ground, and a
      // last leap down onto where it stops.
      const span = ACE_STRIKE_SPAN * tile, settle = ACE_JUMP_SETTLE * tile;
      const arcs: [number, number][] = leaps ? [
        [0, at[hit1] - span - settle],
        [at[hit1] + span, at[turnAt] - settle],
        [at[turnAt], at[hit2] - span - settle],
        [at[hit2] + span, total],
      ].filter(([a, b]) => b - a > 1e-3) as [number, number][] : [];
      const top = Math.max(ACE_JUMP_LEAST, H * ACE_JUMP_HEIGHT);
      /** The leap it is in at `s` (and how far through it), or null on the ground. */
      const arcAt = (s: number): { q: number; len: number } | null => {
        for (const [a, b] of arcs) if (s >= a && s < b) return { q: (s - a) / (b - a), len: b - a };
        return null;
      };
      const heightAt = (s: number) => {
        const arc = arcAt(s);
        return arc ? Math.min(top, arc.len * ACE_JUMP_STEEP) * 4 * arc.q * (1 - arc.q) : 0;
      };

      // A beat, then gone. Its afterimages are its pose as it goes: its run
      // (its air run, flying), held still the whole way (left playing, each
      // would catch it at a different point in its stride).
      // Through its target, it strikes: its attack clip's moment of contact,
      // held for a stretch either side of each blow, then its run again.
      const runClip = this.act(u, leaps ? 'jumpUpLoop' : 'run'), attackClip = this.act(u, 'attack');
      const fallClip = this.act(u, 'jumpDownLoop'), landClip = this.act(u, 'land');
      const hold = (action: string, at: number) => {
        player.frozen = false;
        void player.play(action, { fade: 0, loop: false });
        player.update(at);
        player.frozen = true;
      };
      const strikeAt = Math.min((player.clips.get(attackClip)?.duration ?? 0) * HIT_AT, HIT_CAP);
      const chargeClip = this.act(u, 'charge');
      const charges = leaps && player.has(chargeClip);
      if (leaps) {
        // (Its charge, then its spring: the jump-up clip, up to its leaving the ground.)
        if (charges) {
          void player.play(chargeClip, { fade: 0.1 });
          await sleep(ACE_CHARGE_FIRST);
        }
        const spring = this.act(u, 'jumpUpStart');
        void player.play(spring, { fade: 0.1 });
        await sleep(Math.min(ACE_JUMP_SPRING, player.clips.get(spring)?.duration ?? ACE_WIND_UP));
        hold(runClip, 0);
      } else {
        void player.play(runClip, { fade: 0.1 });
        await sleep(ACE_WIND_UP);
        hold(runClip, ACE_WIND_UP);
      }
      const tone = this.hueOf(node, element);
      const burst = (p: Vector3, way: Vector3, size: number) => {
        const d = way.clone(); d.y = 0;
        if (d.lengthSquared() < 1e-6) d.copyFrom(w);
        d.normalize();
        if (this.beams) this.beams.hemiBurst(p, d, size, tone, true);
        else fx.hemisphere(p, d, size * 2, new Color3(...auraGlow(tone)[0]));
      };
      const lift = new Vector3(0, u.hover + u.clamp, 0);
      const airborne = u.hover > 0.05;
      // (Mid-leap, its bursts go up with it.)
      const liftAt = (s: number) => lift.add(new Vector3(0, heightAt(s), 0));
      const mid = new Vector3(0, H * 0.45, 0);
      burst(start.add(lift).add(mid).subtract(w.scale(H * 0.25)), w, H * QS_LAUNCH_BURST);
      if (!airborne) fx.dust(start, H);
      const shown = u.model.meshes.map((m) => m.visibility);
      for (const m of u.model.meshes) m.visibility = 0;
      u.lookHold = true;
      const hits = [hit1, hit2];
      let next = 0, striking = false, posed = runClip;
      // Its turn round, jumping, on the ground past its target: its turn clip
      // played through (its afterimages catch it as it goes), the body
      // brought round with it.
      const turnClip = this.act(u, 'turnSoft');
      const turnSecs = Math.min(ACE_GROUND_TURN, (player.clips.get(turnClip)?.duration ?? ACE_GROUND_TURN) * TURN_CLIP_SHARE);
      let turned = !leaps, turning = -1, turnFrom = 0;
      // Before each leap off the ground after the first, a beat in its charge.
      let takeoff = 1, charging = -1;
      await new Promise<void>((resolve) => {
        let t = 0;
        // No trail: an afterimage only at its beats — where it sets off, the
        // top of each leap, each touchdown, each blow, and as it turns round.
        const ghost = () => { const gh = this.frozenCopy(u); fx.ghost(gh.meshes, gh.dispose); };
        ghost();
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
          if (turning >= 0) {
            const was = turning;
            turning = Math.min(1, turning + dt / turnSecs);
            this.setFacing(node, turnFrom + Math.PI * (turning * turning * (3 - 2 * turning)));
            if (was < 0.5 && turning >= 0.5) ghost();
            if (turning < 1) return;
            // Round: on with the leap back (its pose taken up afresh).
            turning = -1; turned = true; posed = '';
          }
          if (charging >= 0) {
            charging = Math.min(1, charging + dt / ACE_CHARGE_BEAT);
            if (charging < 1) return;
            charging = -1; posed = '';
          }
          t += dt;
          const k = Math.min(1, t / secs);
          let s = total * ease(k);
          if (!turned && s >= at[turnAt]) {
            // Landed past its target: it turns round where it stands.
            s = at[turnAt];
            node.position.copyFrom(pts[turnAt]);
            u.hover = u.hoverTarget = 0;
            if (posed === fallClip) fx.dust(new Vector3(P.x, start.y, P.z), H);
            turning = 0; turnFrom = node.rotation.y;
            player.frozen = false;
            if (player.has(turnClip)) void player.play(turnClip, { fade: 0 });
            posed = turnClip;
            return;
          }
          if (charges && takeoff < arcs.length && s >= arcs[takeoff][0]) {
            // About to leap again: it stops a beat on the ground, charging.
            s = arcs[takeoff][0];
            takeoff++;
            node.position.copyFrom(sAt(s)[0]);
            u.hover = u.hoverTarget = 0;
            hold(chargeClip, ACE_CHARGE_POSE);
            posed = chargeClip;
            ghost();
            charging = 0;
            return;
          }
          const [p, dir] = sAt(s);
          node.position.copyFrom(p);
          if (leaps) u.hover = u.hoverTarget = heightAt(s);
          // (Its heading eased round the bends, never snapped: each
          // afterimage only a little turned from the last.)
          if (Math.abs(dir.x) + Math.abs(dir.z) > 1e-4) {
            const to = Math.atan2(dir.x, dir.z), from = node.rotation.y;
            const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
            this.setFacing(node, from + diff * (1 - Math.exp(-dt / ACE_TURN_LAG)));
          }
          // Through the target: a slash burst on into it, and it flinches (the first).
          while (next < hits.length && s >= at[hits[next]]) {
            const i = hits[next];
            const way = pts[Math.min(pts.length - 1, i + 1)].subtract(pts[Math.max(0, i - 1)]);
            burst(T.add(leaps ? liftAt(s) : lift.scale(0.5)).add(mid), way, H * QS_HIT_BURST);
            if (next === 0) { if (target) void this.playHitReact(target); }
            else hit();
            next++;
          }
          const strike = player.has(attackClip) && hits.some((i) => Math.abs(s - at[i]) < span);
          // (Mid-leap: its rising pose, then its falling one once it comes
          // down; down on the ground before a blow, its landing.)
          const arc = leaps ? arcAt(s) : null;
          const landed = leaps && !arc && !strike;
          const pose = strike ? attackClip : landed ? landClip : arc && arc.q > 0.5 ? fallClip : runClip;
          if (pose !== posed) {
            // (Touching down: a kick of dust.)
            if (leaps && posed === fallClip && !arc) fx.dust(new Vector3(p.x, start.y, p.z), H);
            // (At the top of each leap, one in mid-air.)
            if (pose === fallClip) ghost();
            posed = pose;
            hold(pose, strike ? strikeAt : pose === landClip ? ACE_LAND_POSE : leaps ? 0 : ACE_WIND_UP);
            if (pose === landClip) ghost();
          }
          if (strike !== striking) {
            striking = strike;
            // (An afterimage the moment it strikes, so each blow leaves one.)
            if (strike) ghost();
          }
          if (k >= 1) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
        });
      });
      if (next < hits.length) hit();
      // Stopped: back, a kick of dust, and round to face its target. (Down
      // from a leap: on the ground, its landing.)
      player.frozen = false;
      if (leaps) {
        u.hover = u.hoverTarget = 0;
        if (player.has(this.act(u, 'land'))) {
          void player.play(this.act(u, 'land'), { fade: 0 });
          await sleep(Math.min(ACE_LAND, player.clips.get(this.act(u, 'land'))?.duration ?? 0));
        }
      }
      u.model.meshes.forEach((m, i) => { m.visibility = shown[i]; });
      u.lookHold = false;
      if (!airborne) fx.dust(end, H);
      const idle = this.act(u, 'idle');
      if (leaps && target) {
        // (Jumping: straight from its landing into its turn, and only then
        // its battle stance.)
        await this.playTurnToward(node, target);
        if (!u.down && player.active?.action !== idle) void player.play(idle, { fade: 0.2 });
      } else {
        if (!u.down) void player.play(idle, { fade: 0.2 });
        if (target) {
          await sleep(ACE_SETTLE);
          await this.playTurnToward(node, target);
        }
      }
    })();
    return { hit: hitP, contactEnds: hitP, done };
  }

  /**
   * A charge on foot (Flare Blitz): the quick step's launch burst behind it
   * and a kick of dust as it sets off, a run along `path` (run clip, its
   * wake), and the quick step's larger burst at the impact as it runs into
   * the target. Resolves at the impact (no strike: the hit is the impact).
   */
  /**
   * `pose` 'leap': instead of running, it travels in its jump-up loop, its
   * body pitched so its snout points the way it goes (a lunge through the air).
   */
  async playRunInto(node: TransformNode, path: Vector3[], targetPos: Vector3, element = 'Normal', pose: 'run' | 'leap' = 'run',
    opts: { hold?: Promise<void>; arrived?: () => void; onward?: () => Vector3 | undefined; land?: boolean;
      /** Held in this clip instead of its charge (a clash between one on the ground and one in the air). */
      holdClip?: string } = {}): Promise<void> {
    const u = this.units.get(node);
    if (!u || !path.length) return this.playMoveTo(node, path);
    const fx = (this.quickStep ??= new QuickStepFx(this.scene));
    const H = this.heightOf(node);
    const start = node.position.clone(), land = path[path.length - 1];
    const way = land.subtract(start); way.y = 0;
    if (way.lengthSquared() < 1e-6) way.set(0, 0, 1);
    way.normalize();
    const tone = this.hueOf(node, element);
    const burst = (at: Vector3, size: number) => {
      if (this.beams) this.beams.hemiBurst(at, way, size, tone, true);
      else fx.hemisphere(at, way, size * 2, new Color3(...auraGlow(tone)[0]));
    };
    // A flyer charges through the air at the height it hovers: its bursts
    // with it, no dust off the ground below.
    const lift = new Vector3(0, u.hover + u.clamp, 0);
    const airborne = u.hoverTarget > 0.05;
    burst(start.add(lift).add(new Vector3(0, H * 0.45, 0)).subtract(way.scale(H * 0.25)), H * QS_LAUNCH_BURST);
    if (!airborne) fx.dust(start, H);
    // (A run needs three points at least: the walk runs only a longer path.)
    const run = path.length > 2 ? path : [Vector3.Lerp(start, land, 0.4), Vector3.Lerp(start, land, 0.75), land];
    // (No dash rings: the bursts are its own.)
    u.moving = true;
    // (In the air it flies the charge as before: the leap is a ground Pokémon's.)
    // The impact: its burst and dust as it gets there (then whatever waits on it).
    const arrive = () => {
      burst(Vector3.Lerp(land, targetPos, 0.5).add(lift.scale(0.5)).add(new Vector3(0, H * 0.45, 0)), H * QS_HIT_BURST);
      if (!airborne) fx.dust(land, H);
      opts.arrived?.();
    };
    if (pose === 'leap' && !airborne && u.model.player.has('jumpUpLoop')) {
      // (Held in its leap's pose, its snout on, until `hold`: a ram clash.)
      try { await this.leap(u, node, run, arrive, opts.hold, opts.onward, opts.land ?? true); } finally { u.moving = false; }
    } else {
      // Its own run (in the air, its air run, at its height the whole way).
      const hover = run.map(() => u.hoverTarget);
      try {
        await this.walk(u, node, run, hover, false);
        arrive();
        if (opts.hold) {
          // Held there (a ram clash), gathering itself: its charging pose
          // (its air one, flying) until let go — or the pose it is given.
          const charge = this.act(u, opts.holdClip ?? 'charge');
          if (!u.down && u.model.player.has(charge)) void u.model.player.play(charge, { fade: RAM_CHARGE_FADE });
          await opts.hold;
          // Let go and sent on (it won): it runs on to where it is sent.
          const next = opts.onward?.();
          if (next) {
            const from = node.position.clone();
            const on = [Vector3.Lerp(from, next, 0.4), Vector3.Lerp(from, next, 0.75), next];
            await this.walk(u, node, on, on.map(() => u.hoverTarget), false);
          } else if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: RAM_CHARGE_FADE });
        }
      } finally { u.moving = false; }
    }
  }

  /** An afterimage of `node` as it is this moment (its pose held, fading from `alpha`: QuickStepFx.ghost). */
  afterimage(node: TransformNode, alpha?: number): void {
    const u = this.units.get(node);
    if (!u) return;
    const fx = (this.quickStep ??= new QuickStepFx(this.scene));
    const g = this.frozenCopy(u);
    fx.ghost(g.meshes, g.dispose, alpha);
  }

  /**
   * Copies of a unit's meshes, held in its pose of the moment, where it is
   * now: the meshes cloned (their own materials and textures), skinned by a
   * copy of its skeleton with every bone set as it is now and then left be —
   * drawn exactly as the body is (afterimages). `dispose` frees the skeleton.
   */
  private frozenCopy(u: Unit): { meshes: Mesh[]; dispose: () => void } {
    const sk = u.model.skeleton;
    const frozen = sk.clone(`${sk.name}_frozen`);
    // (A cloned skeleton starts at rest: its bones take the pose of now.)
    sk.bones.forEach((b, i) => { frozen.bones[i].getLocalMatrix().copyFrom(b.getLocalMatrix()); frozen.bones[i].markAsDirty(); });
    const meshes = u.model.meshes.filter((m) => m.isEnabled()).map((m) => {
      const c = m.clone('qsGhost', m.parent) as Mesh;
      c.skeleton = frozen;
      c.isPickable = false;
      // Left where it is as the body goes on.
      c.computeWorldMatrix(true);
      c.setParent(null);
      return c;
    });
    return { meshes, dispose: () => frozen.dispose() };
  }

  async playCast(node: TransformNode, targetPos: Vector3, kind: CastKind): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playCast(node, targetPos, kind);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    // (A self-boost's appeal: a mega form's own mega appeal where it has one.)
    const clip = kind === 'appeal' && u.model.player.has(this.act(u, 'megaAppeal')) ? 'megaAppeal' : kind;
    await sleep(this.oneShot(u, this.act(u, clip), 0.5, 0.8));
  }

  /**
   * A dodge: it side-steps to `to` (the tile beside it), quick, still facing
   * the way it was, at the height it flies — leaving an afterimage of its
   * pose where it stood (and one or two on the way), fading; a kick of dust
   * off the ground where it sets off and lands.
   */
  async playDodge(node: TransformNode, to: Vector3): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playMoveTo(node, [to]);
    const fx = (this.quickStep ??= new QuickStepFx(this.scene));
    const H = this.heightOf(node);
    const start = node.position.clone(), end = new Vector3(to.x, start.y, to.z);
    const airborne = u.hoverTarget > 0.05;
    // Its afterimage, left where it stood.
    const g0 = this.frozenCopy(u);
    fx.ghost(g0.meshes, g0.dispose);
    if (!airborne) fx.dust(start, H);
    await new Promise<void>((done) => {
      let t = 0, lastGhost = 0;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t += Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
        const k = Math.min(1, t / DODGE_TIME);
        node.position.copyFrom(Vector3.Lerp(start, end, 1 - (1 - k) * (1 - k)));
        if (t - lastGhost >= DODGE_GHOST_EVERY && k < 1) {
          lastGhost = t;
          const g = this.frozenCopy(u);
          fx.ghost(g.meshes, g.dispose);
        }
        if (k >= 1) { this.scene.onBeforeRenderObservable.remove(obs); done(); }
      });
    });
    if (!airborne) fx.dust(end, H);
  }

  /** The floor's height under (x, z) in the world (an arena's relief; null: flat, at 0): every unit stands on it. */
  groundAt: ((x: number, z: number) => number) | null = null;

  /** Where its feet are now, in the world (a four-legged one's front feet too): for its footprints. */
  feetNow(node: TransformNode): Vector3[] {
    const u = this.units.get(node);
    if (!u) return [];
    const limb = this.stanceOf(node) === 'quadruped' ? /^(left|right)_(foot|hand)$/ : /^(left|right)_foot$/;
    // (Against its skinned mesh, under its handedness flip: against its root, left and right would come out mirrored.)
    const skinned = u.model.meshes.find((m) => m.skeleton) ?? u.model.meshes[0];
    return u.model.skeleton.bones.filter((b) => limb.test(b.name)).map((b) => b.getAbsolutePosition(skinned));
  }

  /**
   * A cross (Cross Chop, Cross Poison, X-Scissor): two slashes in quick
   * succession, one from each arm. Its swipe attack (wind-up, step in,
   * strike), then straight out of its blow the same strike mirrored (its other
   * arm, no wind-up, CROSS_SPEED quicker) — each slash flowing along the arm
   * that throws it (ArcSlashFx.trail: only its swing, staying as the arm pulls
   * back, gone as it comes to rest), afterimages of the body left along both
   * swings, a burst at each blow. `onBlow(i)`: at each (0, then 1), for the
   * caller's hit. Resolves on the second blow. One with no swipe swipes once.
   */
  async playCrossSlash(node: TransformNode, targetPos: Vector3, element = 'Normal', onBlow?: (i: number) => void): Promise<void> {
    const u = this.units.get(node);
    if (!u || this.strikeKey(u, true) !== 'swipe') { await this.playAttackLunge(node, targetPos, true); onBlow?.(0); return; }
    const player = u.model.player, rig = player as unknown as Rig;
    const fx = (this.arcSlash ??= new ArcSlashFx(this.scene));
    const part = this.impactPart(node, 'swipe') ?? 'right_hand';
    const partner = part.replace(/^(left|right)/, (m) => (m === 'left' ? 'right' : 'left'));
    const end = this.act(u, 'swipeEnd');
    // Its mirrored strike, made once.
    if (u.crossStrike === undefined) {
      const baked = bakeHandAttack(rig, [end], sampleTrack, { id: 0, species: '', clip: 'swipe', hand: part, height: u.model.height, hitTime: 0 });
      u.crossStrike = baked ? 'crossStrike' : null;
      if (baked) player.clips.set('crossStrike', toClip(mirrorClip(rig, retarget(baked, rig, u.model.height)), 'crossStrike', (player as unknown as { shown: unknown[] }).shown));
    }
    const H = this.heightOf(node), hue = this.hueOf(node, element);
    // (Its parts measured against its skinned mesh, under its handedness flip: against its root, mirrored.)
    const skinned = u.model.meshes.find((m) => m.skeleton) ?? u.model.meshes[0];
    // Its part's bone — or, with no bone by that name (Machamp: right_a_hand, right_b_hand), that side's like
    // bones, followed for the swing's first frames and then locked to whichever has moved most: the arm swinging.
    const sampler = (name: string) => {
      const bones = u.model.skeleton.bones;
      const exact = bones.find((b) => b.name === name);
      const [, side, rest] = /^(left|right)_(.+)$/.exec(name) ?? [];
      const like = exact ? [exact] : side ? bones.filter((b) => new RegExp(`^${side}_([a-z]_)?${rest}(_[a-z])?$`).test(b.name)) : [];
      const moved = like.map(() => 0), last: (Vector3 | null)[] = like.map(() => null);
      let frames = 0, bone = like.length === 1 ? like[0] : null;
      return () => {
        if (!bone && like.length) {
          like.forEach((b, i) => { const q = b.getAbsolutePosition(skinned).clone(); if (last[i]) moved[i] += q.subtract(last[i]!).length(); last[i] = q; });
          const lead = like[moved.indexOf(Math.max(...moved))];
          if (++frames >= CROSS_PICK) bone = lead;
          return sampleAt(lead);
        }
        return bone ? sampleAt(bone) : null;
      };
    };
    const sampleAt = (bone: Bone) => {
      const p = bone.getAbsolutePosition(skinned).clone();
      const out = p.subtract(node.position.add(new Vector3(0, H * 0.5, 0)));
      if (out.lengthSquared() < 1e-6) return null;
      out.normalize();
      return { tip: p.add(out.scale(H * CROSS_REACH)), base: p.subtract(out.scale(H * CROSS_INNER)) };
    };
    // Laid on a sphere round its middle (the anime slash's bubble), or flat along its arm (off).
    // (Its right, across its middle; where its blows land: its two slashes cross there, on its sphere.)
    const right = new Vector3(Math.cos(node.rotation.y), 0, -Math.sin(node.rotation.y));
    const sphere = CROSS_SPHERE ? { centre: () => node.position.add(new Vector3(0, H * 0.5, 0)), radius: H * CROSS_SPHERE_R, across: right,
      contact: targetPos.add(new Vector3(0, H * 0.5, 0)) } : undefined;
    const ghosts = (secs: number) => { for (let t = 0; t < secs; t += CROSS_GHOST_EVERY) setTimeout(() => this.afterimage(node, CROSS_GHOST), t * 1000); };
    const blow = (i: number) => {
      const way = targetPos.subtract(node.position); way.y = 0;
      if (way.lengthSquared() > 1e-6 && this.beams) this.beams.hemiBurst(targetPos.add(new Vector3(0, H * 0.5, 0)), way.normalize().scale(-1), H * CROSS_BURST, hue, false);
      onBlow?.(i);
    };
    // The first: its swipe attack; traced from its strike's start.
    const struck = this.playAttackLunge(node, targetPos, true);
    await new Promise<void>((res) => {
      const o = this.scene.onBeforeRenderObservable.add(() => { if (player.active?.action === end) { this.scene.onBeforeRenderObservable.remove(o); res(); } });
    });
    const first = fx.trail({ element: hue, height: H, sample: sampler(part), trace: CROSS_TRACE, sphere });
    ghosts(CROSS_GHOSTS);
    await struck;
    blow(0);
    if (!u.crossStrike || u.down) return;
    // The second, straight out of the first's blow: the mirrored strike, quicker, its partner arm traced.
    await sleep(CROSS_NEXT);
    void player.play(u.crossStrike, { fade: 0.06, speed: CROSS_SPEED }).then(() => {
      if (!u.down && player.active?.action === u.crossStrike) void player.play(this.act(u, 'idle'), { fade: 0.25 });
    });
    // (On its sphere, the first's mirror image — left and right swapped across its middle — drawn as the other arm
    // swings: a cross, whatever its swipe is like; Scizor's is more a thrust than a sweep, its strike mirrored alone
    // all but the same as the first.)
    fx.trail({ element: hue, height: H, sample: sampler(partner), trace: CROSS_TRACE / CROSS_SPEED, sphere,
      mirror: sphere ? { of: first, across: right, speed: CROSS_SPEED } : undefined });
    ghosts(CROSS_GHOSTS / CROSS_SPEED);
    await sleep(SWIPE_HIT + CROSS_SECOND_HIT / CROSS_SPEED);
    blow(1);
  }

  /** Keep it from turning to watch what it looks at (true), or let it again (false): its facing is then the caller's. */
  holdLook(node: TransformNode, on: boolean): void {
    const u = this.units.get(node);
    if (u) u.lookHold = on;
  }

  /**
   * A charge that chases (real time): it bursts off and runs at `chase()` —
   * wherever that has got to, turning after it — until it is within `commit`
   * of it; from there on it runs straight at where that was then, stopping
   * `stop` short of it (so a dash then, just before contact, gets out of its
   * way). Its impact burst and dust as it gets there. `onStep` is told each
   * stretch it covers (m), and may stop it there (false: out of breath).
   * Resolves where it stopped, on contact (or after `maxTime`, or stopped,
   * however far it got).
   */
  async chargeAt(node: TransformNode, chase: () => Vector3,
    opts: { element?: string; stop: number; commit: number; speed?: number; maxTime?: number; onStep?: (metres: number) => boolean }): Promise<Vector3> {
    const u = this.units.get(node);
    if (!u) return node.position.clone();
    const fx = (this.quickStep ??= new QuickStepFx(this.scene));
    const H = this.heightOf(node), tone = this.hueOf(node, opts.element ?? 'Normal');
    const lift = () => new Vector3(0, u.hover + u.clamp, 0), airborne = u.hoverTarget > 0.05;
    const speed = opts.speed ?? CHARGE_SPEED, maxTime = opts.maxTime ?? CHARGE_MAX_TIME;
    const wayTo = (p: Vector3) => { const w = p.subtract(node.position); w.y = 0; return w.lengthSquared() < 1e-8 ? new Vector3(0, 0, 1) : w.normalize(); };
    const burst = (at: Vector3, way: Vector3, size: number) => {
      if (this.beams) this.beams.hemiBurst(at, way, size, tone, true);
      else fx.hemisphere(at, way, size * 2, new Color3(...auraGlow(tone)[0]));
    };
    let way = wayTo(chase());
    burst(node.position.add(lift()).add(new Vector3(0, H * 0.45, 0)).subtract(way.scale(H * 0.25)), way, H * QS_LAUNCH_BURST);
    if (!airborne) fx.dust(node.position.clone(), H);
    void u.model.player.play(this.act(u, 'run'), { fade: 0.12 });
    u.moving = true;
    let committed: Vector3 | null = null, goal = chase().clone();
    try {
      await new Promise<void>((done) => {
        let t = 0;
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
          t += dt;
          if (!committed) {
            goal = chase().clone();
            const d = goal.subtract(node.position); d.y = 0;
            if (d.length() <= opts.commit + opts.stop) committed = goal;
          }
          const aim = committed ?? goal;
          way = wayTo(aim);
          const end = aim.subtract(way.scale(opts.stop));
          const left = end.subtract(node.position); left.y = 0;
          const step = speed * dt;
          this.setFacing(node, Math.atan2(way.x, way.z));
          const arrived = left.length() <= step || Vector3.Dot(left, way) <= 0;
          const went = arrived ? Math.max(0, Vector3.Dot(left, way)) : step;
          if (arrived) { node.position.x = end.x; node.position.z = end.z; }
          else { node.position.x += way.x * step; node.position.z += way.z * step; }
          const going = opts.onStep ? opts.onStep(went) : true;
          if (arrived || !going || t >= maxTime) { this.scene.onBeforeRenderObservable.remove(obs); done(); }
        });
      });
    } finally { u.moving = false; }
    const aim = committed ?? goal;
    burst(Vector3.Lerp(node.position, aim, 0.5).add(lift().scale(0.5)).add(new Vector3(0, H * 0.45, 0)), way, H * QS_HIT_BURST);
    if (!airborne) fx.dust(node.position.clone(), H);
    return node.position.clone();
  }

  /** In a rolling attack or out of it: its crystal sphere rolls along with it while it is (Unit.rolling). */
  setRolling(node: TransformNode, on: boolean): void {
    const u = this.units.get(node);
    if (u) u.rolling = on;
  }

  /**
   * Missed (its target dodged): it stops where it is, still facing the way
   * it went, until `during` is over (the dodge) and a beat after; then it
   * turns to look at `target` where it now stands. Resolves once it faces it.
   */
  async playMissLook(node: TransformNode, target: TransformNode, during: Promise<void>): Promise<void> {
    const u = this.units.get(node);
    if (!u) { await during; return; }
    u.lookHold = true;
    try {
      await during;
      await sleep(MISS_PAUSE);
    } finally {
      u.lookHold = false;
    }
    await this.playTurnToward(node, target);
    u.lookAt = target;
  }

  /**
   * Turn to face `target` with its own turning (its soft turn clip, on the
   * ground or in the air), the body brought round smoothly over the
   * clip as it plays: never snapped round. Its usual turning to its opponent
   * is held meanwhile.
   */
  async playTurnToward(node: TransformNode, target: TransformNode): Promise<void> {
    const u = this.units.get(node);
    if (!u) return;
    const d = target.position.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) < 1e-3) return;
    const from = node.rotation.y;
    const diff = Math.atan2(Math.sin(Math.atan2(d.x, d.z) - from), Math.cos(Math.atan2(d.x, d.z) - from));
    if (Math.abs(diff) < TURN_MIN) return;
    // Its soft turn (stepping round on the spot, no turn of its own in the
    // clip — the 90° turns carry their own, and overturn): the body turned
    // to suit, either way.
    const clip = this.act(u, 'turnSoft');
    const player = u.model.player;
    const has = player.has(clip) && !u.down;
    const secs = Math.max(TURN_LEAST, has ? (player.clips.get(clip)?.duration ?? 0.5) * TURN_CLIP_SHARE : Math.abs(diff) / (Math.PI / 2) * 0.4);
    u.lookHold = true;
    try {
      if (has) void player.play(clip, { fade: TURN_FADE });
      await new Promise<void>((done) => {
        let t = 0;
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          t = Math.min(1, t + this.scene.getEngine().getDeltaTime() / 1000 / secs);
          this.setFacing(node, from + diff * (t * t * (3 - 2 * t)));
          if (t >= 1) { this.scene.onBeforeRenderObservable.remove(obs); done(); }
        });
      });
      if (has && !u.down) void player.play(this.act(u, 'idle'), { fade: TURN_FADE });
    } finally {
      u.lookHold = false;
    }
  }

  async playHitReact(node: TransformNode, flash?: [number, number, number]): Promise<void> {
    // The flash is drawn after tone mapping, so it is exactly the HP bar's colour.
    if (flash && this.fx?.has(node)) this.fx.flash(node, flash, { peak: FLASH_PEAK, hold: FLASH_HOLD, fade: FLASH_FADE });
    else if (flash) return this.fallback.playHitReact(node, flash);
    const u = this.units.get(node);
    if (!u) return this.fallback.playHitReact(node);
    await sleep(this.oneShot(u, this.act(u, 'damage'), 0.6, 0.45));
  }

  playClaw(node: TransformNode, target: TransformNode | null, spec: ClawSpec): Promise<void> {
    const u = this.units.get(node);
    if (!this.slashes || !u) return this.fallback.playClaw();
    // Cut the way the striking hand swung: the left hand's from upper left to
    // lower right (seen from behind), the right hand's the other way; hands
    // alternate when the strike is not a hand's.
    // Measured on the swipe, where it has one (the motion a claw or a slash plays).
    const key = this.strikeKey(u, true);
    const limb = this.strikePartOf(u, key);
    // A species with a blade of its own cuts with it (Absol: its horn, on its head).
    const part = this.bladeOf(node)?.bone ?? (limb && this.skinOn(u, limb) >= MIN_PART_VERTS ? limb : '');
    const side = part.startsWith('left') ? -1 : part.startsWith('right') ? 1 : -(this.lastClaw.get(node) ?? 1);
    this.lastClaw.set(node, side);
    // With no limb leading, the slash follows what does strike (its region's swing).
    const swing = part ? this.swingOf(node, u, part, key) : this.regionSwing(node, u, key);
    return this.slashes.claw({
      element: this.hueOf(node, spec.element),
      height: displayHeight(u.model.height),
      marks: spec.marks,
      swing,
      side,
      feet: () => node.position,
      facing: () => node.rotation.y,
      target: target ? () => ({ at: target.position, height: this.heightOf(target) }) : undefined,
    });
  }

  /** How many vertices are skinned mostly to `part` (and the bones below it). */
  private skinOn(u: Unit, part: string): number {
    const key = `skin:${part}`;
    if (!u.skinCounts.has(key)) {
      const bones = new Set(partBones(u.model.skeleton, part).map((b) => b.getIndex()));
      let n = 0;
      for (const m of u.model.meshes) {
        const idx = m.getVerticesData('matricesIndices'), w = m.getVerticesData('matricesWeights');
        if (!idx || !w) continue;
        for (let v = 0; v < idx.length / 4; v++) {
          let wt = 0;
          for (let k = 0; k < 4; k++) if (bones.has(idx[v * 4 + k])) wt += w[v * 4 + k];
          if (wt >= 0.5) n++;
        }
      }
      u.skinCounts.set(key, n);
    }
    return u.skinCounts.get(key)!;
  }

  /**
   * What strikes in `action` when no limb leads it, to the vertex
   * (strikeRegion.ts) — worked out once per unit and clip; null if nothing
   * moves enough.
   */
  private strikeRegionOf(u: Unit, key: StrikeClip['key']): StrikeRegion | null {
    if (!u.strikeRegions.has(key)) {
      const clip = this.strikeClip(u, key);
      const peeker: Peeker = { peek: (_action, t, fn) => clip!.peek(t, fn) };
      u.strikeRegions.set(key, clip
        ? findStrikeRegion(u.model.meshes, u.model.skeleton, peeker, key, clip.hit, SWING_BEFORE, SWING_AFTER, u.model.height,
          key === 'swipe' ? 'chest' : 'hips')
        : null);
    }
    return u.strikeRegions.get(key) ?? null;
  }

  /**
   * The limb that leads `key`'s strike, worked out once per unit. An attack:
   * the part that drives furthest forward (findStrikePart). A swipe is an
   * arm's sweep across: both arms swing hard in it, one out to strike and
   * the other drawn back against it, so the striking hand is the one out in
   * front at the blow (Garchomp, Charizard, Gengar, Absol: the left —
   * EFFECTS.md's Charizard swipe is its left hand too), if it is moving. (A
   * head or its fins turning along with the sweep can outpace a hand at
   * their tips, so whole vertices are no guide here.) None for a species
   * with no hands to sweep with.
   */
  private strikePartOf(u: Unit, key: StrikeClip['key']): string | null {
    if (!u.strikeParts.has(key)) u.strikeParts.set(key, key === 'swipe' ? this.sweepingHand(u) : findStrikePart(u.model, this.strikeClip(u, key)));
    return u.strikeParts.get(key) ?? null;
  }

  /** The hand out in front at the swipe's blow (against the hips), if it is sweeping; null if none. */
  private sweepingHand(u: Unit): string | null {
    const clip = this.strikeClip(u, 'swipe'), sk = u.model.skeleton;
    const chest = sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? chestOf(sk);
    const hands = (['left_hand', 'right_hand'] as const)
      .map((part) => ({ part, bone: partMeasureBone(sk, part) }))
      .filter((h): h is { part: 'left_hand' | 'right_hand'; bone: Bone } => !!h.bone && this.skinOn(u, h.part) >= MIN_PART_VERTS);
    if (!clip || !chest || !hands.length) return null;
    const at = (t: number) => {
      let out: Vector3[] = [];
      clip.peek(t, () => {
        sk.computeAbsoluteMatrices(true);
        const inv = chest.getAbsoluteMatrix().clone().invert();
        out = hands.map((h) => h.bone.getAbsoluteMatrix().multiply(inv).getTranslation());
      });
      return out;
    };
    // How fast each sweeps round the blow, and how far forward it is at it.
    const peak = hands.map(() => 0);
    let prev = at(clip.hit - SWEEP_AROUND - SWEEP_STEP);
    for (let t = clip.hit - SWEEP_AROUND; t <= clip.hit + SWEEP_AROUND + 1e-6; t += SWEEP_STEP) {
      const cur = at(t);
      cur.forEach((p, i) => { peak[i] = Math.max(peak[i], Vector3.Distance(p, prev[i]) / SWEEP_STEP); });
      prev = cur;
    }
    const ahead = at(clip.hit).map((p) => p.z);
    sk.prepare(true); // its live pose again
    const best = ahead.indexOf(Math.max(...ahead));
    return peak[best] >= SWEEP_MIN * u.model.height ? hands[best].part : null;
  }

  /**
   * Is `action` (or a run of clips: a swipe's two) done on four legs: a front
   * limb (a hand) down at the ground (within FOURS_GROUND × the height of the
   * lowest point) for FOURS_SHARE of it or more? Sampled every FOURS_STEP s.
   */
  onFours(node: TransformNode, actions: string[]): boolean {
    const u = this.units.get(node);
    if (!u) return false;
    const sk = u.model.skeleton, player = u.model.player as unknown as { clips: Map<string, { duration: number }>; peek: (a: string, t: number, fn: () => void) => void };
    const hands = HANDS.map((h) => partMeasureBone(sk, h)).filter((b): b is Bone => !!b);
    const feet = (['left_foot', 'right_foot'] as const).map((h) => partMeasureBone(sk, h)).filter((b): b is Bone => !!b);
    if (!hands.length) return false;
    let down = 0, all = 0;
    for (const a of actions) {
      const clip = player.clips.get(a);
      if (!clip) continue;
      for (let t = 0; t <= clip.duration + 1e-6; t += FOURS_STEP) {
        player.peek(a, t, () => {
          sk.computeAbsoluteMatrices(true);
          const ys = (bs: Bone[]) => bs.map((b) => b.getAbsoluteMatrix().getTranslation().y);
          // (The ground: its lowest foot then, or its lowest hand if it has no feet.)
          const ground = Math.min(...ys(feet.length ? feet : hands), ...ys(hands));
          if (Math.min(...ys(hands)) - ground <= FOURS_GROUND * u.model.height) down++;
          all++;
        });
      }
    }
    sk.prepare(true); // its live pose again
    return all > 0 && down / all >= FOURS_SHARE;
  }

  /**
   * How a species stands, from its own idle, walk and run: 'quadruped' if
   * all of them are on four legs, 'biped' if none are, 'both' (Pikachu) if
   * some are. Kept once worked out.
   */
  stanceOf(node: TransformNode): 'biped' | 'quadruped' | 'both' {
    const u = this.units.get(node);
    if (!u) return 'biped';
    if (u.stance) return u.stance;
    const player = u.model.player;
    const clips = ['idle', 'walk', 'run'].filter((a) => player.has(a));
    const fours = clips.map((a) => this.onFours(node, [a]));
    u.stance = !fours.length || fours.every((x) => !x) ? 'biped' : fours.every((x) => x) ? 'quadruped' : 'both';
    return u.stance;
  }

  /** May a species of `stance` take an animation done on four legs (`onFours`) or not: a biped only upright ones, a quadruped only four-legged ones, both either. */
  static fitsStance(stance: 'biped' | 'quadruped' | 'both', onFours: boolean): boolean {
    return stance === 'both' || (stance === 'quadruped') === onFours;
  }

  /**
   * What delivers a clip's blow: round its effect's start (traef.js, which
   * cues the blow), of the striking parts (STRIKE_PARTS: a hand, a foot, the
   * head, the tail's tip), the one that thrusts forward hardest into the space
   * in front of the body (its hips), at least IMPACT_DRIVE × its height a second. Null if nothing leads it so (a whole-body
   * lunge). A hand attack is one a hand delivers.
   */
  impactPart(node: TransformNode, key: StrikeClip['key']): string | null {
    const u = this.units.get(node);
    const clip = u ? this.strikeClip(u, key) : null;
    if (!u || !clip) return null;
    const sk = u.model.skeleton;
    const body = sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? null;
    const parts = STRIKE_PARTS.map((part) => ({ part, bone: partMeasureBone(sk, part) }))
      .filter((x): x is { part: string; bone: Bone } => !!x.bone && this.skinOn(u, x.part) >= MIN_PART_VERTS);
    if (!parts.length) return null;
    const at = (t: number) => {
      let out: number[] = [];
      clip.peek(Math.max(0, Math.min(clip.duration, t)), () => {
        sk.computeAbsoluteMatrices(true);
        const bz = body ? body.getAbsoluteMatrix().getTranslation().z : 0;
        out = parts.map((p) => p.bone.getAbsoluteMatrix().getTranslation().z - bz);
      });
      return out;
    };
    // Round its effect's start (which cues the blow, not always on its frame:
    // Lucario's fist lands a few frames after), each part's hardest thrust
    // forward — and whether it ends that thrust out in front of the body.
    const speed = parts.map(() => 0), out = parts.map(() => false);
    let prev = at(clip.hit - IMPACT_BEFORE - IMPACT_STEP);
    for (let t = clip.hit - IMPACT_BEFORE; t <= clip.hit + IMPACT_AFTER + 1e-6; t += IMPACT_STEP) {
      const cur = at(t);
      cur.forEach((z, i) => {
        const v = (z - prev[i]) / IMPACT_STEP;
        if (v > speed[i]) { speed[i] = v; out[i] = z > 0; }
      });
      prev = cur;
    }
    sk.prepare(true); // its live pose again
    // (The one that thrusts hardest into the front, so long as it does so hard enough.)
    let best = -1;
    parts.forEach((_, i) => { if (out[i] && speed[i] >= IMPACT_DRIVE * u.model.height && (best < 0 || speed[i] > speed[best])) best = i; });
    return best >= 0 ? parts[best].part : null;
  }

  /**
   * A punch: thrown with an arm, always. Its clip: the attack where a hand
   * leads it; else (the attack a kick: Blaziken's) the swipe where a hand
   * leads that; else the attack still. Its part: the hand that leads that clip
   * (a hand, whatever drives furthest). Kept once worked out.
   */
  punchPlan(node: TransformNode): { key: StrikeClip['key']; part: string | null } {
    const u = this.units.get(node);
    if (!u) return { key: 'attack', part: null };
    if (u.punch) return u.punch;
    const hand = (key: StrikeClip['key']) => {
      const part = findStrikePart(u.model, this.strikeClip(u, key), HANDS);
      return part && this.skinOn(u, part) >= MIN_PART_VERTS ? part : null;
    };
    const lead = this.strikePartOf(u, 'attack');
    const plan: { key: StrikeClip['key']; part: string | null } = lead && HANDS.includes(lead)
      ? { key: 'attack', part: lead }
      : this.strikeClip(u, 'swipe') && hand('swipe') ? { key: 'swipe', part: hand('swipe') }
        : { key: 'attack', part: hand('attack') ?? HANDS.find((h) => this.skinOn(u, h) >= MIN_PART_VERTS) ?? null };
    u.punch = plan;
    return plan;
  }

  /** Which strike a unit plays: its swipe for a claw or a slash, where it has one (and its species claws with it); else its attack. */
  private strikeKey(u: Unit, swipe: boolean): StrikeClip['key'] {
    return swipe && !CLAW_ON_ATTACK.has(u.species) && this.strikeClip(u, 'swipe') ? 'swipe' : 'attack';
  }

  /** The motion a strike is measured on (null if the unit has no such clip). */
  private strikeClip(u: Unit, key: StrikeClip['key']): StrikeClip | null {
    const player = u.model.player;
    if (!player.peek) return null;
    // (Its blow: where the clip's own events start its effect — Pokemon_EffectStart, traef.js — else a share of it.)
    const blow = (c: { events?: ClipEvent[]; fps?: number }) => { const f = effectStart(c.events ?? []); return f === null || !c.fps ? null : f / c.fps; };
    if (key === 'attack') {
      const action = this.act(u, 'attack'), clip = player.clips.get(action);
      return clip ? { key, duration: clip.duration, hit: Math.min(clip.duration, blow(clip) ?? Math.min(HIT_CAP, clip.duration * HIT_AT)), peek: (t, fn) => player.peek(action, Math.max(0, Math.min(clip.duration, t)), fn) } : null;
    }
    const a = this.act(u, 'swipeStart'), b = this.act(u, 'swipeEnd');
    const ca = player.clips.get(a), cb = player.clips.get(b);
    if (!ca || !cb) return null;
    return {
      key, duration: ca.duration + cb.duration, hit: ca.duration + (blow(cb) ?? SWIPE_HIT),
      peek: (t, fn) => (t < ca.duration ? player.peek(a, Math.max(0, t), fn) : player.peek(b, Math.min(cb.duration, t - ca.duration), fn)),
    };
  }

  /** The swing of what strikes in `key`'s clip (its region's motion), in `node`'s front: x right, y up. */
  private regionSwing(node: TransformNode, u: Unit, key: StrikeClip['key'] = 'attack'): [number, number] | null {
    const r = this.strikeRegionOf(u, key);
    if (!r) return null;
    // The model's own frame to the world's, then onto the unit's right and up.
    const v = Vector3.TransformNormal(r.swing, u.model.meshes[0].getWorldMatrix());
    const yaw = node.rotation.y;
    const x = v.x * Math.cos(yaw) - v.z * Math.sin(yaw), y = v.y;
    return Math.hypot(x, y) > 1e-4 ? [x, y] : null;
  }

  /** The blade `node`'s species cuts with, if it has one of its own (bodyParts.BLADES), with its vertex region. */
  private bladeOf(node: TransformNode): { bone: string; region: { key: string; flags: Map<AbstractMesh, Float32Array> } } | null {
    const u = this.units.get(node);
    const def = BLADES[(node.metadata as { species?: string } | null)?.species ?? ''];
    if (!u || !def) return null;
    if (!u.blade) u.blade = { key: `blade:${def.bone}:${JSON.stringify(def.boxes ?? null)}:${!!def.island}`, flags: regionFlags(u.model.meshes, u.model.skeleton, def, u.model.height) };
    return { bone: def.bone, region: u.blade };
  }

  /**
   * Which way `part` is moving as the attack clip's blow lands (looked ahead
   * through the clip, SWING_BEFORE s before the hit to SWING_AFTER after), in
   * the unit's front: x along its right, y up. Null if it hardly moves there.
   */
  private swingOf(node: TransformNode, u: Unit, part: string, key: StrikeClip['key'] = 'attack'): [number, number] | null {
    const sk = u.model.skeleton, mesh = u.model.meshes[0];
    const clip = this.strikeClip(u, key);
    const bone = partMeasureBone(sk, part);
    if (!clip || !bone) return null;
    const hit = clip.hit;
    const at = (time: number) => {
      const out = new Vector3();
      clip.peek(Math.max(0, Math.min(clip.duration, time)), () => {
        sk.computeAbsoluteMatrices(true);
        bone.getAbsolutePositionToRef(mesh, out);
      });
      return out;
    };
    const v = at(hit + SWING_AFTER).subtract(at(hit - SWING_BEFORE));
    sk.prepare(true); // its live pose again
    const yaw = node.rotation.y;
    const x = v.x * Math.cos(yaw) - v.z * Math.sin(yaw), y = v.y;
    return Math.hypot(x, y) > 0.02 * displayHeight(u.model.height) ? [x, y] : null;
  }

  async playKnockback(node: TransformNode, to: Vector3, flash?: [number, number, number]): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playKnockback(node, to, flash);
    if (flash && this.fx?.has(node)) this.fx.flash(node, flash, { peak: FLASH_PEAK, hold: FLASH_HOLD, fade: FLASH_FADE });
    // Flinching all the way, thrown clear of the heaving ground.
    void u.model.player.play(this.act(u, 'damage'), { fade: 0.06 });
    const h = Math.max(KNOCK_MIN_ARC, KNOCK_ARC * displayHeight(u.model.height));
    await arcTo(node, new Vector3(to.x, to.y, to.z), KNOCK_TIME, h);
    if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  playBeam(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BeamSpec, holdUntil?: Promise<void>,
    clash?: BeamClash): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.beams) return this.fallback.playBeam(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const toTarget = target ? () => this.middleOf(target) : () => targetPos;
    // In a clash it aims at the clash point — until it has won, then on into the loser.
    // (Till the clash is met, at the target: it races there until the other's front meets it.)
    const aimAt = clash ? () => (clash.over?.() ? toTarget() : clash.at() ?? toTarget()) : toTarget;
    // The charge plays through the wind-up; the launch comes with the loop.
    // From the mouth, or from each of its cannons (CANNONS): twin beams converging.
    const muzzles = this.muzzlesOf(node);
    const sources = muzzles ?? [this.mouthOf(node)];
    // Cannon beams converge on one point: the target's near side, as seen from
    // between the cannons (BeamShot.exactTarget). In a clash, the clash point.
    const meet = muzzles ? () => {
      const t = toTarget();
      const from = muzzles.reduce((acc, m) => acc.addInPlace(m()), Vector3.Zero()).scaleInPlace(1 / muzzles.length);
      const dir = t.subtract(from);
      const len = dir.length();
      const back = Math.min(len * 0.9, TARGET_BODY * (target ? this.heightOf(target) : height));
      return len > 1e-4 ? t.subtract(dir.scaleInPlace(back / len)) : t;
    } : null;
    const aimEach = meet ? (clash ? () => (clash.over?.() ? meet() : clash.at() ?? meet()) : meet) : aimAt;
    // Twins (or triplets) start level with each other (BeamShot.twin).
    const twin = muzzles ? { fwd: () => new Vector3(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y)), reach: new Map<number, number>() } : undefined;
    const handles = sources.map((from, i) => this.beams!.fire({ ...spec, height, mouth: from, target: aimEach,
      exactTarget: !!meet,
      thickness: (spec.thickness ?? 1) * (muzzles ? CANNON_THICKNESS[muzzles.length] ?? 0.5 : 1),
      twin,
      // Out of a muzzle: the ball sits at it (not a face's gap ahead); no egg: at the mouth.
      root: muzzles || spec.eggless ? 0 : undefined,
      // No dust round the feet of a unit in the air (and only once for twins).
      feet: () => (i > 0 || (u && u.hover > 0.05) ? null : node.position),
      // (Cannon beams aim straight at their meeting point, not along the gaze; and so does a beam in a clash, straight
      // from its mouth to the clash point — the two shafts one straight line, mouth to mouth, not two side by side.)
      facing: meet || clash ? undefined : () => node.rotation.y, targetSize: () => (target ? this.heightOf(target) : height),
      targetPoses: target ? (fn) => this.everyStruckPose(target, fn) : undefined,
      // A twin's second beam leaves the clash's ball to the first.
      clash: clash && i > 0 ? { ...clash, ball: false } : clash,
      // Its own body, so no part of the beam lies over it.
      bodyAhead: u ? (from, aim, radius) => {
        let best = 0;
        const v = new Vector3();
        u.skin.forEachPoint((p) => {
          p.subtractToRef(from, v);
          const along = Vector3.Dot(v, aim);
          if (along > best && v.lengthSquared() - along * along < radius * radius) best = along;
        });
        return best;
      } : undefined }));
    // One handle over them all.
    const beam = {
      open: () => handles.forEach((h) => h.open()),
      front: Promise.all(handles.map((h) => h.front)).then(() => {}),
      release: (s: number) => Promise.all(handles.map((h) => h.release(s))).then(() => {}),
      origin: () => handles.reduce((acc, h) => acc.addInPlace(h.origin()), Vector3.Zero()).scaleInPlace(1 / handles.length),
    };
    let endContact = () => {};
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    // A bolt off the body (Thunderbolt): its Electric aura, lightning earthing off
    // it to the ground, from the start of its charge until it lets go.
    if (spec.bolt && spec.eggless) {
      const aura = this.aura(node, { element: spec.element, edge: 'smooth', reach: 'tight', ignite: 0.3, die: 0.5, shiver: true, charging: true });
      void contactEnds.then(() => aura.release());
    }
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamLoop', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      // It charges at least BEAM_CHARGE (the wind-up, held at its end while the egg builds) before it pours.
      const t0 = performance.now();
      const charged = () => sleep(Math.max(0, BEAM_CHARGE - (performance.now() - t0) / 1000));
      if (u && player && chain) {
        // The wind-up draws nothing (the jaw is shut); the channel opens with the loop.
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        await charged();
        void player.play(this.act(u, 'beamLoop'), { fade: 0.06 });
      } else if (u) {
        await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
        await charged();
      }
      beam.open();
      // A bolt (Ice Beam, Thunderbolt in a clash): lightning from each egg's tip to
      // where its front is, held until the beam lets go.
      // Eggless (Thunderbolt), it leaves the body itself, as its own bolt does
      // (playLightning), in the caster's Electric aura.
      if (spec.bolt && this.lightning) {
        const W = 0.012 * TILE_SCALE * (muzzles ? CANNON_THICKNESS[muzzles.length] ?? 0.5 : 1) * (spec.thickness ?? 1);
        const colors = BOLT_COLORS[spec.element];
        // Off the body's surface facing the target (inside its aura), and, once
        // its front gets there, onto the target's surface facing back (inside
        // its zap): one with the auras, never apart from them.
        const body = this.surfaceToward(node, toTarget);
        const struck = target ? this.surfaceToward(target, () => this.middleOf(node)) : null;
        for (const h of handles) {
          const start = spec.eggless ? body : () => h.eggTip();
          const end = () => {
            const e = h.end();
            if (!struck) return e;
            const s0 = start(), sp = struck();
            return Vector3.DistanceSquared(s0, e) >= Vector3.DistanceSquared(s0, sp) * 0.97 ? sp : e;
          };
          this.lightning.bolt(start, end, { width: W * 7, strands: 2, forks: 4, hold: 0, light: 2.5,
            colors, holdUntil: contactEnds });
        }

      }
      await beam.front;
      // It pours a beat past the hit — or for as long as it is held.
      await (holdUntil ?? sleep(BEAM_HOLD));
      let endDur = 0.6;
      if (u && player && chain) {
        const end = this.act(u, 'beamEnd');
        endDur = player.clips.get(end)?.duration ?? endDur;
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      }
      endContact();
      await beam.release(endDur);
    })();
    const front = () => handles.reduce((acc, h) => acc.addInPlace(h.end()), Vector3.Zero()).scaleInPlace(1 / handles.length);
    return { hit: beam.front, contactEnds, done, origin: () => beam.origin(), front };
  }

  /**
   * A ball attack: the ball charges at the mouth as a beam's does, through
   * the beam wind-up clip (else the ranged clip's), flies at the release and
   * bursts on the target.
   */
  /**
   * A ball's burst as a sphere of flame (Fire Blast): the Fire aura's sphere
   * round where it hit, swelling from the ball's size to FIRE_BURST_GROW ×
   * over FIRE_BURST_TIME, then dying down; faded out over its lower part.
   */
  private fireBurst(at: Vector3, height: number): void {
    const r0 = height * FIRE_BURST_R, t0 = performance.now();
    const [heavy, light] = ballNoiseColours('Fire');
    const centre = at.clone();
    const sphere = new FireSphere(this.scene, () => {
      const k = Math.min(1, (performance.now() - t0) / 1000 / FIRE_BURST_TIME);
      const radius = r0 * (1 + (FIRE_BURST_GROW - 1) * (1 - (1 - k) * (1 - k)));
      // (Faded out over its lower part.)
      return { centre, radius, floor: centre.y - radius * FIRE_BURST_FLOOR };
    // (Drawn as it is, not on the additive light layer: its reds and its ink would wash out to white there.)
    }, fireTone('Fire'), undefined,
    // (In its tornadoes' reds: their dark, between, and their light.)
    [heavy, heavy.map((x, i) => (x + light[i]) / 2) as [number, number, number], light], true,
    this.fx ? (mesh: Mesh) => this.fx!.addOver(mesh) : undefined);
    void sleep(FIRE_BURST_TIME * FIRE_BURST_HOLD).then(() => sphere.release());
  }

  playBall(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BallSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.beams) return this.fallback.playBall(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const aimAt = target ? () => this.middleOf(target) : () => targetPos;
    const ball = throwBall(this.beams, { element: spec.element, colours: spec.colours, height, from: this.mouthOf(node), target: aimAt,
      targetSize: () => (target ? this.heightOf(target) : height),
      // No wind spiral round the feet of a unit in the air.
      feet: () => (u && u.hover > 0.05 ? null : node.position),
      overlay: this.fx ? (mesh, mat) => this.fx!.addOverlay(mesh, mat) : undefined,
      // A tornado ball's noise (Aeroblast, Aura Sphere, Moonblast): the Flying coat's tornado spheres, two at a slant.
      noise: spec.tornado && this.wind ? (heavy, light, free) => this.wind!.orb(heavy, light, free) : undefined,
      noiseGoesOnBurst: spec.burst === 'fire',
      // (Sorted against the units by camera distance: over their auras while nearer.)
      free: this.fx ? (mesh) => this.fx!.addFree(mesh) : undefined });
    if (spec.burst === 'fire') void ball.hit.then(() => this.fireBurst(ball.position(), height));
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      if (u && player && chain) {
        // Charged as a beam is, through the wind-up (held at its end until the
        // ball has had BALL_CHARGE to build); let fly with the release.
        const t0 = performance.now();
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        // (A ball whose tornadoes come first charges that much longer.)
        const first = spec.tornado && this.wind ? NOISE_FIRST : 0;
        await sleep(Math.max(0, BALL_CHARGE + first - (performance.now() - t0) / 1000));
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      } else {
        await sleep(u ? this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8) : 0.4);
      }
      ball.launch();
      await ball.done;
    })();
    return { hit: ball.hit, contactEnds: ball.hit, done };
  }

  playPulse(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: PulseSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.pulses) return this.fallback.playPulse(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const aimAt = target ? () => this.middleOf(target) : () => targetPos;
    const pulse = this.pulses.fire({ ...spec, height, mouth: this.mouthOf(node), target: aimAt, facing: () => node.rotation.y });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamLoop', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      // The same body as a beam: wind up, hold the pose while it pulses, let go.
      if (u && player && chain) {
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        void player.play(this.act(u, 'beamLoop'), { fade: 0.06 });
      } else if (u) {
        await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
      }
      pulse.open();
      await pulse.last;
      if (u && player && chain) {
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      }
      await pulse.done;
    })();
    return { hit: pulse.front, contactEnds: pulse.last, done };
  }

  /**
   * Fire Spin (Whirlpool, `element` Water): in its ranged pose as it lets
   * fly, rings of its element spin up round the target's tile (WindFx.spin),
   * hold, and die down.
   */
  playSpin(node: TransformNode, targetPos: Vector3, element = 'Fire'): BeamPlay {
    if (!this.wind) return this.fallback.playSpin(node, targetPos, element);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const wind = this.wind;
    const spin = (async () => {
      if (u) await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
      return wind.spin(new Vector3(targetPos.x, targetPos.y, targetPos.z), HEX_SIZE * 0.95, element);
    })();
    return {
      hit: spin.then((s) => s.hit), contactEnds: spin.then((s) => s.contactEnds), done: spin.then((s) => s.done),
    };
  }

  playWind(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: WindSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.wind) return this.fallback.playWind(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const size = u ? displayHeight(u.model.height) : 1.2;
    const where = target ? () => target.position.clone() : () => targetPos.clone();
    // The body: the ranged pose as it lets fly.
    const release = u ? sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8)) : Promise.resolve();
    let resolveHit!: () => void, resolveEnd!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const contactEnds = new Promise<void>((r) => { resolveEnd = r; });
    const done = (async () => {
      await release;
      // Both grow up out of the ground on the target's tile, sized to the target.
      const ts = Math.max(target ? this.heightOf(target) : size, 1.2);
      const w = spec.kind === 'gust' ? this.wind!.gust(where, ts, spec.element)
        : spec.kind === 'tomb' ? this.wind!.tomb(where, ts, spec.element) : this.wind!.twister(where, ts, spec.element);
      void w.hit.then(resolveHit);
      void w.contactEnds.then(resolveEnd);
      await w.done;
      resolveHit(); resolveEnd();
    })();
    return { hit, contactEnds, done };
  }

  /**
   * Every point of a unit's skin in each pose it takes while struck — as it
   * stands, through its flinch and its idle (looked ahead, not played).
   */
  private everyStruckPose(node: TransformNode, fn: (p: Vector3) => void): void {
    const u = this.units.get(node);
    if (!u) return;
    const player = u.model.player, sk = u.model.skeleton;
    const visit = () => { sk.prepare(true); u.skin.forEachPoint(fn); };
    visit();
    for (const action of [this.act(u, 'damage'), this.act(u, 'idle')]) {
      const clip = player.clips.get(action);
      if (!clip) continue;
      for (let s = 0; s <= 10; s++) player.peek(action, (clip.duration * s) / 10, visit);
    }
    sk.prepare(true); // its live pose again
  }

  /**
   * A beam clash: `a` and `b` fire beams at each other; they meet half-way
   * between their mouths, each ending in a hemisphere on its own side — the
   * two halves of one ball, each in its own beam's colours. With `holdUntil`
   * both keep pouring until it resolves.
   */
  clashBeams(a: TransformNode, b: TransformNode, specA: BeamSpec, specB: BeamSpec, holdUntil?: Promise<void>): [BeamPlay, BeamPlay] {
    const ma = this.mouthOf(a), mb = this.mouthOf(b);
    // The ball's size: the two beams' mean (as each beam sizes itself).
    const beamH = (n: TransformNode) => { const u = this.units.get(n); return u ? displayHeight(u.model.height) : 1.2; };
    const clash = { at: () => Vector3.Center(ma(), mb()), size: (beamH(a) + beamH(b)) / 2 };
    return [
      this.playBeam(a, b, b.position.clone(), specA, holdUntil, { ...clash, other: this.hueOf(b, specB.element) }),
      this.playBeam(b, a, a.position.clone(), specB, holdUntil, { ...clash, other: this.hueOf(a, specA.element) }),
    ];
  }

  /**
   * A beam clash as the battle resolved it. Both attacks race at each other,
   * each at its own pace, and meet wherever their fronts cross (CLASH_MEET),
   * holding there CLASH_STANDOFF s. A tie: the ball bursts (expands and
   * disperses, as a ball attack's on contact) and both beams fade. Otherwise the
   * winner's egg swells and its noise grows heavier as it pushes the ball
   * back toward the loser (over CLASH_PUSH s, quicker the more decisive the
   * margin): its beam extends as the loser's retracts. Pushed home, the
   * loser's half of the ball bursts (swells and disperses, as a tie's whole
   * ball does) as its beam lets go, and the winner's runs on through it into
   * the loser — the hit.
   */
  /**
   * Fire in a sphere round the body (FireFx's FireSphere, as the Flying
   * aura's tornado is): round its middle, wide enough to hold all of it,
   * riding with it. Two of them: still, its tongues rise (and, on the
   * ground, it fades out near the ground); moving, its tongues stream back
   * opposite the way it goes. On a change one wipes out from its foot to its
   * tip as the other wipes in, at the same rate. Until `release`.
   */
  fireSphere(node: TransformNode, element = 'Fire'): { release: () => Promise<void> } {
    const u = this.units.get(node);
    if (!u) return { release: () => Promise.resolve() };
    const H = this.heightOf(node);
    const lo = new Vector3(), hi = new Vector3();
    const centre = new Vector3();
    let radius = H / 2, frame = -1, sized = 0;
    // Where its middle sits off the body (where it stands, as high as it flies).
    const off = new Vector3(), sum = new Vector3(), bias = new Vector3();
    // How it moves (eased, as the Flying coat reads it), and the way it last went.
    const prev = node.position.clone(), vel = Vector3.Zero();
    const way = new Vector3(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
    let moving = false;
    // Each sphere's wipe: shown, wiping in or out (0..1), or hidden.
    type Wipe = { state: 'shown' | 'in' | 'out' | 'hidden'; u: number };
    const still: Wipe = { state: 'shown', u: 0 }, move: Wipe = { state: 'hidden', u: 0 };
    const front = (k: number) => -1.25 + 2.5 * (k * k * (3 - 2 * k));
    const bandOf = (w: Wipe): [number, number] | undefined =>
      w.state === 'in' ? [-10, front(w.u)] : w.state === 'out' ? [front(w.u), 10] : w.state === 'hidden' ? [10, 10] : undefined;
    const read = () => {
      if (this.scene.getFrameId() === frame) return;
      frame = this.scene.getFrameId();
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      if (dt > 0) Vector3.LerpToRef(vel, node.position.subtract(prev).scaleInPlace(1 / dt), 1 - Math.exp(-dt * WIND_COAT_SENSE), vel);
      prev.copyFrom(node.position);
      const speed = vel.length();
      const was = moving;
      moving = moving ? speed > WIND_COAT_MOVING * 0.5 : speed > WIND_COAT_MOVING;
      if (speed > 0.05) way.copyFrom(vel).normalize();
      // (Held as moving the way of a charge, a ram clash: its tongues streaming back from it, though it stands.)
      if (u.coatWay) { moving = true; way.copyFrom(u.coatWay); }
      if (moving !== was) {
        const [going, coming] = moving ? [still, move] : [move, still];
        if (going.state !== 'hidden') { going.state = 'out'; going.u = 0; }
        coming.state = 'in'; coming.u = 0;
      }
      for (const w of [still, move]) {
        if (w.state === 'in' || w.state === 'out') {
          w.u = Math.min(1, w.u + dt / FIRE_SPHERE_WIPE);
          if (w.u >= 1) w.state = w.state === 'in' ? 'shown' : 'hidden';
        }
      }
      lo.setAll(Infinity); hi.setAll(-Infinity);
      let n = 0;
      u.skin.forEachPoint((p) => { Vector3.CheckExtends(p, lo, hi); n++; });
      if (!n) { lo.copyFrom(node.position); hi.copyFrom(node.position).addInPlaceFromFloats(0, H, 0); }
      const mid = Vector3.Center(lo, hi);
      let far = 0;
      u.skin.forEachPoint((p) => { far = Math.max(far, Vector3.Distance(p, mid)); });
      const wantR = Math.max(H * 0.4, (far || H / 2) * FIRE_SPHERE_CLEAR);
      // Steady, as the body is (never its flapping wings): on the body's mass
      // — the mean of all its points, which a wing hardly moves (unlike its
      // bounds, which a wingtip stretches) — as it is posed now, smoothed a
      // little; held off where the body stands (as high as it flies), so with
      // the body it moves at once. Its size the most it reaches over its
      // first moments, then kept.
      const anchor = node.position.add(new Vector3(0, u.hover + u.clamp, 0));
      sum.setAll(0);
      let m = 0;
      u.skin.forEachPoint((p) => { sum.addInPlace(p); m++; });
      const mass = m ? sum.scaleInPlace(1 / m) : mid.clone();
      // (Set where the Flying sphere sits — the middle of the body's bounds —
      // by how far that lies off its mass, learnt slowly: a wingbeat's swing
      // in it averages away.)
      // (Both learnt in the body's own frame, turned with it: so as it turns —
      // to the way it goes — the sphere turns with it at once, never sliding
      // round after it.)
      const yaw = node.rotation.y;
      const turn = (v: Vector3, by: number) => new Vector3(v.x * Math.cos(by) + v.z * Math.sin(by), v.y, -v.x * Math.sin(by) + v.z * Math.cos(by));
      Vector3.LerpToRef(bias, turn(mid.subtract(mass), -yaw), sized === 0 ? 1 : 1 - Math.exp(-dt * FIRE_SPHERE_LEARN), bias);
      const wantOff = turn(mass.add(turn(bias, yaw)).subtractInPlace(anchor), -yaw);
      Vector3.LerpToRef(off, wantOff, sized === 0 ? 1 : 1 - Math.exp(-dt * FIRE_SPHERE_FOLLOW), off);
      if (sized < FIRE_SPHERE_SIZING) { radius = sized === 0 ? wantR : Math.max(radius, wantR); sized += Math.max(dt, 1e-3); }
      centre.copyFrom(anchor).addInPlace(turn(off, yaw));
    };
    // A crystal sphere rolls as it goes — in a rolling attack only (u.rolling): each frame turned about the level line
    // across its way by the ground it has covered over its radius — its
    // surface keeping pace with the ground exactly.
    const roll = Quaternion.Identity(), rollStep = new Quaternion();
    let rolledAt = node.position.clone(), rollFrame = -1;
    // (Held in a clash — standing, laid toward the other, u.coatWay — it keeps
    // rolling at the pace it came in at, its top speed on the way (not the
    // crawl it slows to as it arrives): grinding against the other there.)
    let rollSpeed = 0;
    const rolled = () => {
      if (this.scene.getFrameId() === rollFrame) return roll;
      rollFrame = this.scene.getFrameId();
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      const d = node.position.subtract(rolledAt); d.y = 0;
      rolledAt = node.position.clone();
      let dist = d.length();
      if (!u.coatWay) rollSpeed = dist > 1e-5 && dt > 0 ? Math.max(rollSpeed, dist / dt) : 0;
      else if (dist > 1e-5 && dt > 0) rollSpeed = Math.max(rollSpeed, dist / dt);
      if (u.coatWay && dist < 1e-4) {
        d.copyFrom(u.coatWay); d.y = 0;
        dist = Math.max(rollSpeed, ROLL_HOLD_SPEED) * dt;
        if (d.lengthSquared() > 1e-8) d.normalize().scaleInPlace(dist);
      }
      if (u.rolling && dist > 1e-5 && radius > 1e-3) {
        const axis = Vector3.Cross(Vector3.Up(), d.scale(1 / dist)).normalize();
        Quaternion.RotationAxisToRef(axis, dist / radius, rollStep);
        rollStep.multiplyToRef(roll, roll);
        roll.normalize();
      }
      return roll;
    };
    const light = this.fx ? (mesh: Mesh) => this.fx!.addLight(mesh) : undefined;
    const tone = fireTone(element);
    // (Inked, as Fire Blast's burst: solid bands, each tongue outlined dark, drawn off the light layer.)
    const ink = FIRE_AURA_INK;
    // (Its near side over the aura: the aura between its far side and its near.)
    // (In its unit's own layers: where two units overlap, the nearer's whole stack over the farther's.)
    const over = this.fx ? (mesh: Mesh) => this.fx!.addOver(mesh, node) : undefined;
    const back = this.fx ? (mesh: Mesh) => this.fx!.addBack(mesh, node) : undefined;
    // (In its element's own bands where it has them — a Dragon aura's purple — else the Fire aura's.)
    const bands = FIRE_SPHERE_BANDS[element];
    // (Steel's: a web lattice, not flames.)
    const lattice = LATTICE_SPHERES.has(element);
    const upright = new FireSphere(this.scene, () => {
      read();
      // (Faded low down: near the ground standing on it; in the air, a little, from its own foot.)
      const floor = u.hover <= 0.05 ? node.position.y : centre.y - radius * FIRE_SPHERE_AIR_FLOOR;
      return { centre: centre.clone(), radius, floor, band: bandOf(still), roll: lattice ? rolled() : undefined };
    }, tone, ink ? undefined : light, bands, ink, over, lattice, back);
    const trailing = new FireSphere(this.scene, () => {
      read();
      // (Its tongues streaming back: the way opposite the way it goes. On the
      // ground it fades out near the ground too, as the upright one does.)
      const floor = u.hover <= 0.05 ? node.position.y : undefined;
      return { centre: centre.clone(), radius, axis: way.scale(-1), band: bandOf(move), floor, roll: lattice ? rolled() : undefined };
    }, tone, ink ? undefined : light, bands, ink, over, lattice, back);
    return { release: () => Promise.all([upright.release(), trailing.release()]).then(() => undefined) };
  }

  /**
   * Flames bursting out of the body (FireFx): each a cone of fire with its
   * foot at the body's middle, inside it, going out one way — the ways spread
   * evenly all round (a Fibonacci sphere) — and out past the body, which hides
   * the part of each still inside it; each burning in its own time. They ride
   * with the body. Until `release`.
   */
  risingFire(node: TransformNode, element = 'Fire'): { release: () => Promise<void> } {
    const u = this.units.get(node);
    if (!u) return { release: () => Promise.resolve() };
    const H = this.heightOf(node);
    const lo = new Vector3(), hi = new Vector3(), mid = new Vector3();
    let frame = -1, reach = H * 0.5;
    // Its middle and its reach from it, once a frame.
    const read = () => {
      if (this.scene.getFrameId() === frame) return;
      frame = this.scene.getFrameId();
      lo.setAll(Infinity); hi.setAll(-Infinity);
      let n = 0;
      u.skin.forEachPoint((p) => { Vector3.CheckExtends(p, lo, hi); n++; });
      if (!n) { lo.copyFrom(node.position); hi.copyFrom(node.position).addInPlaceFromFloats(0, H, 0); }
      mid.copyFrom(lo).addInPlace(hi).scaleInPlace(0.5);
      reach = Math.max(H * 0.3, 0.5 * Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z));
    };
    // The ways out, spread evenly round a sphere.
    const ways: Vector3[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < RISING_FIRE_COUNT; i++) {
      const y = 1 - (2 * (i + 0.5)) / RISING_FIRE_COUNT, r = Math.sqrt(1 - y * y), a = i * golden;
      ways.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const light = this.fx ? (mesh: Mesh) => this.fx!.addLight(mesh) : undefined;
    const fires = ways.map((way, j) => new RisingFire(this.scene, () => {
      read();
      // (Out past the body: from its middle to RISING_FIRE_OUT × its reach that way.)
      return { base: mid.clone(), axis: way, height: reach * RISING_FIRE_OUT, radius: H * RISING_FIRE_WIDE };
    }, fireTone(element), light, j * 1.37));
    return { release: () => Promise.all(fires.map((f) => f.release())).then(() => undefined) };
  }

  /**
   * A Flying coat: a see-through outer tornado of the type's colours round the
   * Pokémon, in front of it and behind it, always rising foot to head. Still,
   * it stands upright on its tile, from the ground or (in the air) from the
   * body's lowest point; moving, it lies along the way it goes (its foot
   * behind the body, its head out in front). Between the two, one wipes out
   * as the other wipes in (WindFx.coat). Until `release`.
   */
  windCoat(node: TransformNode, element = 'Flying'): { release: () => Promise<void>; burst: () => Promise<void> } {
    const u = this.units.get(node);
    if (!this.wind || !u) return { release: () => Promise.resolve(), burst: () => Promise.resolve() };
    const prev = node.position.clone();
    const vel = Vector3.Zero();
    // The way it last went (the moving tornado keeps lying along it as it wipes out).
    const way = new Vector3(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
    let moving = false;
    const lo = new Vector3(), hi = new Vector3(), d = new Vector3();
    const H = () => this.heightOf(node);
    // Placed along `axis` round the body: still (upright on its tile) or moving.
    const place = (axis: Vector3, still: boolean, mid0: Vector3, n: number) => {
      const mid = mid0.clone();
      if (still) { mid.x = node.position.x; mid.z = node.position.z; }
      let a0 = Infinity, a1 = -Infinity, r = 0;
      u.skin.forEachPoint((p) => {
        p.subtractToRef(mid, d);
        const al = Vector3.Dot(d, axis);
        if (al < a0) a0 = al;
        if (al > a1) a1 = al;
        const px = d.x - axis.x * al, py = d.y - axis.y * al, pz = d.z - axis.z * al;
        r = Math.max(r, Math.sqrt(px * px + py * py + pz * pz));
      });
      if (!n) { a0 = -H() / 2; a1 = H() / 2; r = H() / 2; }
      // Its foot: on the ground under it, standing still on the ground; else
      // the body's lowest (rearmost) point, a little past it.
      let foot = a0 - (a1 - a0) * WIND_COAT_PAD;
      if (still && u.hover <= 0.05) foot = Vector3.Dot(node.position.subtract(mid), axis);
      // (Its head reaches well past the body: the shell fades out over its top.
      // Upright, at least WIND_COAT_TALL x its height: its soft ends need room.)
      const head = Math.max(a1 + (a1 - a0) * WIND_COAT_HEAD, still ? foot + H() * WIND_COAT_TALL : -Infinity);
      const radius = r * WIND_COAT_CLEAR;
      if (WIND_COAT_SHAPE === 'sphere') {
        // A sphere round the body's middle, wide enough to hold all of it — steady (steadyMid, steadyD: never
        // shaken by its flapping wings).
        const d = steadyD;
        mid0 = steadyMid;
        // (Standing on the ground: the ground under it, where it fades out.)
        const floor = still && u.hover <= 0.05 ? node.position.y : undefined;
        return { base: mid0.subtract(axis.scale(d / 2)), axis, height: d, radius: d / 2, floor };
      }
      return { base: mid.add(axis.scale(foot)), axis, height: Math.max(0.2, head - foot), radius };
    };
    // Its sphere steady, as the fire sphere is (never its flapping wings): on the body's mass — the mean of its points,
    // which a wing hardly moves, unlike its bounds, which a wingtip stretches — set off by where its bounds' middle
    // lies from that, learnt slowly (a wingbeat's swing averages away), both in the body's own frame (it turns with it
    // at once), held off where it stands (as high as it flies); its size the most it reaches over its first moments,
    // then kept.
    const steadyMid = node.position.clone(), bias = Vector3.Zero(), off = Vector3.Zero(), sum = Vector3.Zero();
    let steadyD = H(), sized = 0;
    const steady = (dt: number, mid: Vector3, n: number) => {
      const anchor = node.position.add(new Vector3(0, u.hover + u.clamp, 0));
      sum.setAll(0);
      u.skin.forEachPoint((p) => { sum.addInPlace(p); });
      const mass = n ? sum.scale(1 / n) : mid.clone();
      const yaw = node.rotation.y;
      const turn = (v: Vector3, by: number) => new Vector3(v.x * Math.cos(by) + v.z * Math.sin(by), v.y, -v.x * Math.sin(by) + v.z * Math.cos(by));
      Vector3.LerpToRef(bias, turn(mid.subtract(mass), -yaw), sized === 0 ? 1 : 1 - Math.exp(-dt * FIRE_SPHERE_LEARN), bias);
      const wantOff = turn(mass.add(turn(bias, yaw)).subtractInPlace(anchor), -yaw);
      Vector3.LerpToRef(off, wantOff, sized === 0 ? 1 : 1 - Math.exp(-dt * FIRE_SPHERE_FOLLOW), off);
      steadyMid.copyFrom(anchor).addInPlace(turn(off, yaw));
      if (sized < FIRE_SPHERE_SIZING) {
        let far = 0;
        u.skin.forEachPoint((p) => { far = Math.max(far, Vector3.Distance(p, steadyMid)); });
        const want = Math.max(0.4, 2 * (far || H() / 2) * WIND_COAT_CLEAR);
        steadyD = sized === 0 ? want : Math.max(steadyD, want);
        sized += Math.max(dt, 1e-3);
      }
    };
    const follow = (dt: number) => {
      // How it moves (eased, so a single frame's step never flips it).
      if (dt > 0) {
        const v = node.position.subtract(prev).scaleInPlace(1 / dt);
        Vector3.LerpToRef(vel, v, 1 - Math.exp(-dt * WIND_COAT_SENSE), vel);
      }
      prev.copyFrom(node.position);
      // (Some give either way, so it never flickers between the two.)
      const speed = vel.length();
      moving = moving ? speed > WIND_COAT_MOVING * 0.5 : speed > WIND_COAT_MOVING;
      if (speed > 0.05) way.copyFrom(vel).normalize();
      // (Held lying along a way, a ram clash: its moving tornado, though it stands still.)
      if (u.coatWay) { moving = true; way.copyFrom(u.coatWay); }
      // Its body, as posed.
      lo.setAll(Infinity); hi.setAll(-Infinity);
      let n = 0;
      u.skin.forEachPoint((p) => { Vector3.CheckExtends(p, lo, hi); n++; });
      if (!n) { lo.copyFrom(node.position); hi.copyFrom(node.position).addInPlaceFromFloats(0, H(), 0); }
      const mid = Vector3.Center(lo, hi);
      if (WIND_COAT_SHAPE === 'sphere') steady(dt, mid, n);
      // Upright, it is as tight and as small as the one along the way (its
      // width and length), standing from its foot on the tile.
      const move = place(way.clone(), false, mid, n);
      const up = place(Vector3.Up(), true, mid, n);
      const still = { ...up, height: move.height, radius: move.radius };
      sphere.centre = still.base.add(still.axis.scale(still.height / 2));
      sphere.radius = still.height / 2;
      return { moving, still, move };
    };
    const sphere = { centre: node.position.clone(), radius: H() / 2 };
    // (Cel shaded as the inked fire sphere, its near side over the aura —
    // but Grass's soft, as the plain tornado, with leaves flowing round in it.)
    // (Normal's soft too, its streaks drifting squares.)
    const grass = element === 'Grass';
    const coat = this.wind.coat(follow, element, WIND_COAT_SHAPE, WIND_COAT_CEL && !grass && element !== 'Normal',
      this.fx ? (mesh) => this.fx!.addOver(mesh, node) : undefined, this.fx ? (mesh) => this.fx!.addBack(mesh, node) : undefined);
    const leaves = grass ? this.leaves(() => sphere, node) : null;
    return {
      release: () => { void leaves?.release(); return coat.release(); },
      burst: () => { void leaves?.release(); return coat.burst(); },
    };
  }

  /**
   * A Grass coat's leaves: LEAF_COUNT of them flowing round with the coat,
   * each on its own circle round its sphere (its middle and radius, read each
   * frame) at its own height and a little in or out, going round the way the
   * coat's streaks go at about their pace — laid along their way round, rolling
   * slowly over and fluttering as they go. One draw (thin instances), lit by
   * the scene. They come in and go out with the coat.
   */
  private leaves(sphere: () => { centre: Vector3; radius: number }, owner: TransformNode): { release: () => Promise<void> } {
    const mesh = leafMesh(this.scene);
    const rand = (a: number, b: number) => a + (b - a) * Math.random();
    const leaf = Array.from({ length: LEAF_COUNT }, () => ({
      ang: rand(0, Math.PI * 2), y: rand(-0.7, 0.7), out: rand(0.85, 1.08), speed: rand(0.8, 1.2),
      roll: rand(0, Math.PI * 2), rollSpeed: rand(-2.5, 2.5), ph: rand(0, 6.28), size: rand(0.8, 1.2),
    }));
    const matrices = new Float32Array(LEAF_COUNT * 16);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    // (Over the aura, as the coat's near side: its glow would paint over them; the bodies still hide them behind.)
    const undoOver = this.fx?.addOver(mesh, owner);
    const M = new Matrix(), q = new Quaternion(), q2 = new Quaternion(), S = new Vector3(), P = new Vector3();
    let fade = 0, letGo = false, gone!: () => void;
    const over = new Promise<void>((r) => { gone = r; });
    const obs = this.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      fade = letGo ? Math.max(0, fade - dt / LEAF_FADE) : Math.min(1, fade + dt / LEAF_FADE);
      const { centre, radius } = sphere();
      const t = performance.now() / 1000;
      leaf.forEach((l, i) => {
        l.ang -= dt * LEAF_SPIN * l.speed;
        l.roll += dt * l.rollSpeed;
        const ring = radius * l.out * Math.sqrt(Math.max(0, 1 - l.y * l.y));
        P.set(centre.x + Math.cos(l.ang) * ring, centre.y + l.y * radius * l.out, centre.z + Math.sin(l.ang) * ring);
        // Laid along its way round (its tip leading), rolled about that way,
        // fluttering: pitched and yawed a little, back and forth.
        const way = new Vector3(Math.sin(l.ang), 0, -Math.cos(l.ang));
        Quaternion.FromLookDirectionLHToRef(way, Vector3.Up(), q);
        Quaternion.RotationYawPitchRollToRef(-Math.PI / 2 + Math.sin(t * 6 + l.ph) * 0.35, Math.cos(t * 4.3 + l.ph) * 0.4, l.roll, q2);
        q.multiplyInPlace(q2);
        S.setAll(radius * LEAF_SIZE * l.size * fade);
        Matrix.ComposeToRef(S, q, P, M);
        M.copyToArray(matrices, i * 16);
      });
      mesh.thinInstanceBufferUpdated('matrix');
      if (letGo && fade <= 0) {
        this.scene.onBeforeActiveMeshesEvaluationObservable.remove(obs);
        undoOver?.();
        mesh.material?.dispose();
        mesh.dispose();
        gone();
      }
    });
    return { release: () => { letGo = true; return over; } };
  }

  /**
   * Sparkles popping off a Fairy aura (SparkleFx): born at points of the body
   * just outside its outline, drifting out and popping, drawn over it.
   */
  private sparkles(node: TransformNode): { release: () => Promise<void> } {
    const u = this.units.get(node);
    const p = new Vector3();
    const fx = new SparkleFx(this.scene, () => {
      if (!u) return null;
      const n = u.skin.count();
      for (let tries = 0; tries < 6; tries++) {
        if (n > 0 && u.skin.pointAt(Math.floor(Math.random() * n), p)) {
          return { point: p.clone(), middle: this.middleOf(node), height: this.heightOf(node) };
        }
      }
      return null;
    // (In its unit's own front layer: over its aura, and stacked with it by distance.)
    }, this.fx ? (mesh: Mesh) => this.fx!.addOver(mesh, node) : undefined);
    return { release: () => fx.release() };
  }

  /**
   * A meadow under a Grass aura on the ground: wherever it stands, its tile's
   * grass grows up thick and tall with flowers in it (grass.ts meadowPatch),
   * and the moment it moves off a tile that tile's sinks back into the ground.
   * In the air, none. Let go, all of it sinks.
   */
  private meadow(node: TransformNode): { release: () => Promise<void> } {
    const inR = (HEX_SIZE * Math.sqrt(3)) / 2;
    const src = (this.meadowSrc ??= meadowPatch(this.scene, inR));
    const u = this.units.get(node);
    const patches = new Map<string, { inst: InstancedMesh; k: number; up: boolean }>();
    let letGo = false, gone!: () => void;
    const over = new Promise<void>((r) => { gone = r; });
    const obs = this.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      const onGround = !!u && u.hover <= 0.05 && !letGo;
      const [q, r] = worldToAxial(node.position.x, node.position.z);
      const here = `${q},${r}`;
      if (onGround && !patches.has(here)) {
        const inst = src.createInstance(`meadow${here}`);
        inst.isPickable = false;
        inst.position.copyFrom(axialToWorld(q, r, node.position.y + MEADOW_LIFT));
        inst.rotation.y = (((q * 7 + r * 13) % 6) * Math.PI) / 3;
        patches.set(here, { inst, k: 0, up: true });
      }
      for (const [key, p] of patches) {
        p.up = onGround && key === here;
        p.k = Math.max(0, Math.min(1, p.k + (p.up ? dt / MEADOW_GROW : -dt / MEADOW_SINK)));
        const e = p.k * p.k * (3 - 2 * p.k);
        // (Up out of the ground, and back down into it.)
        p.inst.scaling.set(0.7 + 0.3 * e, Math.max(1e-3, e), 0.7 + 0.3 * e);
        if (!p.up && p.k <= 0) { p.inst.dispose(); patches.delete(key); }
      }
      if (letGo && patches.size === 0) {
        this.scene.onBeforeActiveMeshesEvaluationObservable.remove(obs);
        gone();
      }
    });
    return { release: () => { letGo = true; return over; } };
  }

  playStatChange(node: TransformNode, up: boolean): Promise<void> {
    if (!this.wind) return this.fallback.playStatChange(node, up);
    // Round the body where it stands (off the ground it hovers above, if it flies).
    const u = this.units.get(node);
    // Clear of its body: half its widest reach on the floor, and a margin.
    let radius = this.heightOf(node) * 0.5;
    if (u) {
      const rb = u.model.restBounds, s = u.model.root.scaling.x;
      radius = Math.max(0.55, 0.5 * Math.max(rb.max[0] - rb.min[0], rb.max[2] - rb.min[2]) * s * STAT_CLEAR);
    }
    return this.wind.statChange(() => node.position.add(new Vector3(0, u ? u.hover + u.clamp : 0, 0)), this.heightOf(node), up, radius);
  }

  /** `meetAt`: where they meet, as a share of the way from a to b (0.5: the middle) — fixed, both beams running to it; none: wherever their fronts cross. */
  playClash(a: TransformNode, b: TransformNode, specA: BeamSpec, specB: BeamSpec, winner: TransformNode | null, margin: number, standUntil?: Promise<void>,
    meetAt?: number): ClashPlay {
    const ma = this.mouthOf(a), mb = this.mouthOf(b);
    const beamH = (n: TransformNode) => { const u = this.units.get(n); return u ? displayHeight(u.model.height) : 1.2; };
    const loser = winner === a ? b : winner === b ? a : null;
    // How far the ball is pushed: until its surface meets the loser's beam
    // where it leaves the loser (its ball, kept clear of its body).
    let pa: BeamPlay | null = null, pb: BeamPlay | null = null;
    const loserRoot = () => {
      const [m, o] = loser === a ? [ma(), mb()] : [mb(), ma()];
      const root = (loser === a ? pa : pb)?.origin?.() ?? m;
      return root.add(o.subtract(m).normalize().scale(clashBallRadius((beamH(a) + beamH(b)) / 2)));
    };
    let push = 0, over = false, burst = false, loserBurst = false;
    const ease = (t: number) => t * t * (3 - 2 * t);
    // Where they met, as a share of the way from a's mouth to b's (-1: not yet; fixed from the first, both beams aim there).
    let meetU = meetAt ?? -1;
    const at = () => {
      if (meetU < 0) return null;
      const met = Vector3.Lerp(ma(), mb(), meetU);
      return loser && push > 0 ? Vector3.Lerp(met, loserRoot(), ease(Math.min(1, push))) : met;
    };
    const size = (beamH(a) + beamH(b)) / 2;
    const edge = () => Math.min(1, push / 0.35);
    let endA!: () => void, endB!: () => void;
    const holdA = new Promise<void>((r) => { endA = r; }), holdB = new Promise<void>((r) => { endB = r; });
    const clashOf = (self: TransformNode, other: TransformNode, otherSpec: BeamSpec): BeamClash => ({
      at, size, other: this.hueOf(other, otherSpec.element), otherPalette: otherSpec.palette,
      // Only the winner's clash ends (it runs on into the loser); the loser's just dies away.
      over: () => over && self === winner,
      edge: self === winner ? edge : undefined,
      // A tie: both halves burst. Overpowered: only the loser's.
      burst: () => burst || (loserBurst && self === loser),
    });
    // (A ball attack flies in and becomes its half of the ball: clashBall. A
    // pulse attack pulses at the other's front, and then its half: clashPulse.)
    const otherFront = (self: TransformNode) => () => (self === a ? pb : pa)?.front?.() ?? null;
    const side = (self: TransformNode, other: TransformNode, spec: BeamSpec, hold: Promise<void>, otherSpec: BeamSpec) => spec.pulse
      ? this.clashPulse(self, other, spec, hold, clashOf(self, other, otherSpec), otherFront(self))
      : spec.ball
        ? this.clashBall(self, other, spec, hold, clashOf(self, other, otherSpec))
        : this.playBeam(self, other, other.position.clone(), spec, hold, clashOf(self, other, otherSpec));
    pa = side(a, b, specA, holdA, specB);
    pb = side(b, a, specB, holdB, specA);
    const playA = pa, playB = pb;
    // They meet where their fronts cross: each front's share of the way from
    // a to b; when a's has passed b's, the clash point is between them.
    const watch = this.scene.onBeforeRenderObservable.add(() => {
      const A = ma(), dir = mb().subtract(A), L = dir.length();
      const fa = playA.front?.(), fb = playB.front?.();
      if (L < 1e-4 || !fa || !fb) return;
      const ua = Vector3.Dot(fa.subtract(A), dir) / (L * L), ub = Vector3.Dot(fb.subtract(A), dir) / (L * L);
      if (ua < ub - (meetAt !== undefined ? 0.02 : 0)) return;
      if (meetAt === undefined) meetU = Math.min(1 - CLASH_MEET, Math.max(CLASH_MEET, (ua + ub) / 2));
      this.scene.onBeforeRenderObservable.remove(watch);
      // The blow: an impact frame, centred where they meet.
      const met = at();
      if (met && IMPACT_ON_CLASH) this.impactFrame()?.fire(met, Math.min(a.position.y, b.position.y));
    });
    let hitNow!: () => void;
    const hit = new Promise<void>((r) => { hitNow = r; });
    const met = Promise.all([playA.hit, playB.hit]).then(() => {});
    void (async () => {
      await met;
      // (They stand off a moment — or, held, until `standUntil`.)
      await (standUntil ?? sleep(CLASH_STANDOFF));
      if (!loser) {
        // Evenly matched: the ball bursts as a ball attack's does, and both beams disperse.
        burst = true;
        await sleep(0.12);
        hitNow(); endA(); endB();
        return;
      }
      const dur = CLASH_PUSH * (1 - 0.5 * Math.min(1, Math.max(0, margin)));
      await new Promise<void>((done) => {
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          push += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000) / dur;
          if (push >= 1) { push = 1; this.scene.onBeforeRenderObservable.remove(obs); done(); }
        });
      });
      // Pushed home: the loser's half of the ball bursts as its beam lets go;
      // the winner's runs on through it into the loser.
      loserBurst = true;
      over = true;
      (loser === a ? endA : endB)();
      await sleep(0.2);
      hitNow();
      await sleep(BEAM_HOLD);
      (winner === a ? endA : endB)();
    })();
    return { met, hit, done: Promise.all([playA.done, playB.done]).then(() => {}) };
  }

  /**
   * A ball attack in a clash. It charges and flies as ever (playBall), at the
   * other; where it meets the other's front, it becomes its half of the
   * clash's ball (an invisible beam of its own — no column, no egg — whose
   * front is there at once: BeamShot.instant), which holds, is pushed, bursts
   * on a tie or a loss, as a beam's half does. Winning, its half becomes the
   * whole ball, as big as the clash's (BALL_TO_CLASH), right there, and flies
   * on into the loser, bursting on it, as the loser's half bursts.
   */
  private clashBall(node: TransformNode, other: TransformNode, spec: BeamSpec, holdUntil: Promise<void>, clash: BeamClash): BeamPlay {
    const element = this.hueOf(node, spec.element);
    const colours = spec.ball && spec.ball !== true ? spec.ball : undefined;
    const u = this.units.get(node);
    const height = u ? displayHeight(u.model.height) : 1.2;
    const d = other.position.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const mouth = this.mouthOf(node);
    const toTarget = () => this.middleOf(other);
    const overlay = this.fx ? (mesh: AbstractMesh, m: Material) => this.fx!.addOverlay(mesh, m) : undefined;
    // A tornado ball (Aeroblast, Aura Sphere, Moonblast): its noise the
    // Flying coat's tornadoes — in flight its two slanted spheres, and its
    // half of the clash's ball the moving tornado's half, laid toward the clash.
    const wind = spec.tornado ? this.wind : null;
    const [heavy, light] = ballNoiseColours(element, colours);
    const noise = wind ? (h: [number, number, number], l: [number, number, number]) => wind.orb(h, l) : undefined;
    // Its half of the clash's ball (in its colours: the sphere's fill, the network's heavy noise).
    const half = this.beams!.fire({ element, palette: colours ? { skin: colours.heavy, body: colours.fill } : spec.palette,
      height, mouth, target: () => clash.at() ?? toTarget(), bolt: true, eggless: true, instant: true, root: 0, clash,
      feet: () => null, targetSize: () => height, clashNoise: wind ? () => wind.hemi(heavy, light) : undefined });
    // The ball itself, flying at the other; where the two meet, it goes (its half takes over).
    const ball = throwBall(this.beams!, { element, colours, height, from: mouth, target: toTarget, targetSize: () => this.heightOf(other),
      feet: () => (u && u.hover > 0.05 ? null : node.position), overlay, vanish: true, noise });
    // (It goes only once it has flown there: where they meet can be known from the first — a clash meeting at a
    // fixed point, `meetAt` — long before the ball has even left the hand.)
    const meets = this.scene.onBeforeRenderObservable.add(() => {
      const at = clash.at();
      if (!at) return;
      const m = mouth(), way = at.subtract(m), far = way.lengthSquared();
      if (far > 1e-6 && Vector3.Dot(ball.position().subtract(m), way) < far * CLASH_BALL_ARRIVE) return;
      this.scene.onBeforeRenderObservable.remove(meets);
      ball.vanish();
      half.open();
    });
    let endContact = () => {};
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    // Won: once it breaks through, a fresh ball flies on into the loser.
    const flyOn = new Promise<Promise<void>>((resolve) => {
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        if (!clash.over?.()) return;
        this.scene.onBeforeRenderObservable.remove(obs);
        const at = clash.at() ?? half.end();
        const on = throwBall(this.beams!, { element, colours, height, from: () => at, target: toTarget,
          targetSize: () => this.heightOf(other), feet: () => null, instant: true, scale: BALL_TO_CLASH, noise });
        on.launch();
        resolve(on.done);
      });
      void holdUntil.then(() => { this.scene.onBeforeRenderObservable.remove(obs); resolve(Promise.resolve()); });
    });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      if (u && player && chain) {
        const t0 = performance.now();
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        await sleep(Math.max(0, BALL_CHARGE - (performance.now() - t0) / 1000));
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      } else {
        await sleep(u ? this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8) : 0.4);
      }
      ball.launch();
      await half.front;
      await holdUntil;
      endContact();
      await Promise.all([half.release(0.5), flyOn.then((p) => p)]);
    })();
    // Its front: the ball, till it meets the other's.
    return { hit: half.front, contactEnds, done, origin: () => half.origin(), front: () => (clash.at() ? half.end() : ball.position()) };
  }

  /**
   * A pulse attack in a clash. It pulses as ever (playPulse) but without end,
   * at the other attack's front, and once they meet, at the clash point: each
   * pulse bursts there as it does on a hit, against the other's half of the
   * clash's ball (it has no half of its own), and follows the
   * point as it is pushed either way. A tie or a loss: it stops pulsing as the
   * ball bursts, those on their way bursting where they are. A win: it stops
   * pulsing at the clash point as the loser's half bursts, and sends PULSES
   * more (playPulse's) on into the loser.
   */
  private clashPulse(node: TransformNode, other: TransformNode, spec: BeamSpec, holdUntil: Promise<void>, clash: BeamClash,
    otherFront: () => Vector3 | null): BeamPlay {
    const element = this.hueOf(node, spec.element);
    if (!this.pulses) return this.fallback.playPulse(node, other, other.position.clone(), { element });
    const pulses = this.pulses;
    const u = this.units.get(node);
    const height = u ? displayHeight(u.model.height) : 1.2;
    const d = other.position.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const mouth = this.mouthOf(node);
    const toTarget = () => this.middleOf(other);
    const scale = spec.pulse?.scale;
    // Where each pulse bursts: the clash point, against the flat face of the
    // other's half of the ball (the half on its own side), so they touch (on
    // its front, till they meet).
    const against = () => clash.at() ?? otherFront() ?? toTarget();
    // (Straight at it: the clash point is on the line between them.)
    const stream = pulses.fire({ element, scale, height, mouth, target: against, endless: true });
    let endContact = () => {};
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    // Won: as the loser's half bursts, PULSES more go on into the loser.
    let onTo: Promise<void> = Promise.resolve();
    let finishedOn = () => {};
    const sentOn = new Promise<void>((r) => { finishedOn = r; });
    const win = this.scene.onBeforeRenderObservable.add(() => {
      if (!clash.over?.()) return;
      this.scene.onBeforeRenderObservable.remove(win);
      stream.stop();
      const on = pulses.fire({ element, scale, height, mouth, target: toTarget, facing: () => node.rotation.y });
      on.open();
      onTo = on.done;
      void on.last.then(() => finishedOn());
    });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamLoop', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      // The same body as a pulse: wind up, hold the pose while it pulses, let
      // go. It charges as long as a beam does (BEAM_CHARGE), so they go together.
      const t0 = performance.now();
      const charged = () => sleep(Math.max(0, BEAM_CHARGE - (performance.now() - t0) / 1000));
      if (u && player && chain) {
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        await charged();
        void player.play(this.act(u, 'beamLoop'), { fade: 0.06 });
      } else if (u) {
        await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
        await charged();
      }
      stream.open();
      await holdUntil;
      this.scene.onBeforeRenderObservable.remove(win);
      // Let go: lost or tied, it stops at once as the ball bursts; won, it
      // holds the pose till its last pulse is on the loser.
      if (clash.over?.()) await sentOn;
      else stream.stop(true);
      if (u && player && chain) {
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      }
      endContact();
      await Promise.all([stream.done, onTo]);
    })();
    // Its front: the leading pulse (the mouth before the first leaves) — and,
    // once the first has reached the other's front, that front: they meet there.
    // (Asked again while answering — the other a pulse asking back — it is just its leading pulse.)
    let asking = false;
    const front = () => {
      if (asking) return stream.head() ?? mouth();
      asking = true;
      try {
        return (stream.reached() ? clash.at() ?? otherFront() : null) ?? stream.head() ?? mouth();
      } finally {
        asking = false;
      }
    };
    return { hit: stream.front, contactEnds, done, origin: () => mouth(), front };
  }

  /**
   * Its cannons' muzzles (CANNONS), each the cannon's point furthest forward
   * along its facing this frame; null for a Pokémon that fires from its mouth.
   */
  private muzzlesOf(node: TransformNode): (() => Vector3)[] | null {
    const u = this.units.get(node);
    const roots = u && CANNONS[u.species];
    if (!u || !roots) return null;
    const sk = u.model.skeleton;
    const out: (() => Vector3)[] = [];
    for (const name of roots) {
      const root = sk.bones.find((b) => b.name === name);
      if (!root) return null;
      const set = new Set<number>();
      for (const b of sk.bones) for (let x: Bone | null = b; x; x = x.getParent()) if (x === root) { set.add(b.getIndex()); break; }
      const cannon = new VertexSubset(u.model.meshes, sk, set, 0.5);
      if (!cannon.size) return null;
      const fwd = new Vector3(), at = new Vector3();
      out.push(() => {
        fwd.set(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
        return cannon.furthestAlong(fwd, at) ? at.clone() : node.position.add(new Vector3(0, this.heightOf(node) * 0.8, 0));
      });
    }
    return out;
  }

  /**
   * The point of `node`'s body (its skin, as it moves) facing `toward`: the
   * one furthest out from its middle that way, near the line there (a limb
   * off to the side does not count), a little in from the surface (the body
   * hides a bolt's end there: SURFACE_IN). Worked out once a frame.
   */
  private surfaceToward(node: TransformNode, toward: () => Vector3): () => Vector3 {
    const u = this.units.get(node);
    const H = this.heightOf(node);
    const middle = () => this.middleOf(node);
    if (!u) return middle;
    const v = new Vector3(), best = new Vector3(), dir = new Vector3();
    let frame = -1;
    return () => {
      const id = this.scene.getFrameId();
      if (id === frame) return best.clone();
      frame = id;
      const o = middle();
      toward().subtractToRef(o, dir);
      const L = dir.length();
      if (L < 1e-4) { best.copyFrom(o); return best.clone(); }
      dir.scaleInPlace(1 / L);
      let score = -Infinity;
      u.skin.forEachPoint((p) => {
        p.subtractToRef(o, v);
        const along = Vector3.Dot(v, dir);
        if (along <= 0) return;
        const off = Math.sqrt(Math.max(0, v.lengthSquared() - along * along));
        const s = along - SURFACE_SIDE * off;
        if (s > score) { score = s; best.copyFrom(p); }
      });
      if (score === -Infinity) best.copyFrom(o);
      else best.subtractInPlace(dir.scale(SURFACE_IN * H));
      return best.clone();
    };
  }

  /** Where the mouth is, from the jaw and nose bones (the head, or the top, if none). */
  private mouthOf(node: TransformNode): () => Vector3 {
    const u = this.units.get(node);
    if (!u) {
      const h = this.heightOf(node);
      return () => node.position.add(new Vector3(0, h * 0.8, 0));
    }
    const bones = u.model.skeleton.bones;
    const pick = MOUTH_BONES.map((n) => bones.find((b) => b.name === n)).filter((b) => !!b);
    const use = pick.length ? pick.slice(0, 2) : bones.filter((b) => b.name === 'head');
    const mesh = u.model.meshes[0];
    const tmp = new Vector3();
    return () => {
      const out = new Vector3();
      for (const b of use) { b!.getAbsolutePositionToRef(mesh, tmp); out.addInPlace(tmp); }
      return use.length ? out.scaleInPlace(1 / use.length) : node.position.add(new Vector3(0, displayHeight(u.model.height) * 0.8, 0));
    };
  }

  /** The middle of `node`'s body: half its height up — off the ground it hovers above, if it flies. */
  private middleOf(node: TransformNode): Vector3 {
    const u = this.units.get(node);
    return node.position.add(new Vector3(0, this.heightOf(node) * 0.5 + (u ? u.hover + u.clamp : 0), 0));
  }

  /** How tall it stands, as shown (world units). */
  heightOf(node: TransformNode): number {
    const u = this.units.get(node);
    return u ? displayHeight(u.model.height) : 1.0;
  }

  faceEachOther(a: TransformNode, b: TransformNode): void {
    for (const [x, y] of [[a, b], [b, a]]) {
      const u = this.units.get(x);
      if (u) u.lookAt = y;
    }
    // Fallback (primitive) units turn through the primitive factory.
    if (!this.units.has(a) || !this.units.has(b)) this.fallback.faceEachOther(a, b);
  }

  holdHitReact(node: TransformNode, until: Promise<void>): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.holdHitReact(node, until);
    let held = true;
    void until.then(() => { held = false; });
    void (async () => {
      const player = u.model.player;
      while (held && !u.down) {
        const clip = this.act(u, 'damage');
        if (!player.has(clip)) break;
        await player.play(clip, { fade: 0.08 });
      }
      if (!u.down) void player.play(this.act(u, 'idle'), { fade: 0.25 });
    })();
  }

  /** The colours `node`'s move of `element` wears (Mega Charizard X's Fire is blue: auraPalette.elementFor). */
  hueOf(node: TransformNode, element: string): string {
    return elementFor(element, node.metadata?.species, !!node.metadata?.shiny);
  }

  aura(node: TransformNode, options: AuraOptions): AuraHandle {
    // A Fire aura on the whole body always has its fire's noise bursting off it
    // (not a hand's or a blade's, nor a struck body's fill).
    const whole = !options.strike && !options.blade && !options.focus && !options.region && !options.fill;
    const fire = options.element === 'Fire' && whole;
    options = { ...options, element: this.hueOf(node, options.element), noiseBurst: options.noiseBurst ?? fire };
    // A slash or claw from a species with a blade of its own: only the blade is coated.
    const blade = options.blade ? this.bladeOf(node) : null;
    if (blade) options = { ...options, strike: false, focus: blade.bone, region: blade.region };
    // A strike: the aura coats only the body part that leads it (a punching
    // hand, a kicking foot, a biting head…), whatever the clip.
    const su = options.strike ? this.units.get(node) : undefined;
    // A punch: always a hand (punchPlan), never a kicking foot.
    const punch = su && options.strike === 'punch' ? this.punchPlan(node) : null;
    if (punch?.part) options = { ...options, strike: false, focus: punch.part };
    else if (su && options.strike) {
      // A claw or a slash ('swipe') is measured on the swipe where it has one.
      const action = punch ? punch.key : this.strikeKey(su, options.strike === 'swipe');
      const part = this.strikePartOf(su, action);
      // A part with hardly any skin of its own (Scyther's hand bone: its scythe
      // is skinned to the forearm) would show nothing: then what strikes, to the vertex.
      if (part && this.skinOn(su, part) >= MIN_PART_VERTS) options = { ...options, focus: part };
      else {
        // No limb leads it: whatever does strike, to the vertex (a horn, a
        // scythe, a fist with no hand bone) — never the whole body.
        const region = this.strikeRegionOf(su, action);
        if (region) options = { ...options, focus: su.model.skeleton.bones.find((b) => !b.getParent())!.name, region: { key: `strike:${action}`, flags: region.flags } };
      }
    }
    // A Water aura is water itself: a shell of running water over the body
    // (WaterCoat) — or over the part that strikes (a hand, a blade), only.
    // (Not a struck body's fill: that is the lightning's.)
    const wu = this.units.get(node);
    if (wu && options.element === 'Water' && !options.fill && !(WATER_TORNADO && whole)) {
      const part = options.region ? { flags: options.region.flags }
        : options.focus ? { bone: options.focus } : undefined;
      const coat = new WaterCoat(this.scene, wu.model.meshes, wu.model.height, auraGlow('Water')[1], part, { cel: WATER_CEL });
      return { lit: coat.lit, release: () => coat.release(), burst: () => coat.burstOff() };
    }
    const plain = this.fx?.has(node) ? this.fx.aura(node, options) : this.fallback.aura(node, options);
    // A fire aura on the whole body has its fire sphere round the Pokémon
    // (FireFx, after XorDev's 3D Fire) — in place of the noise bursts it once
    // had, which nothing uses any more.
    // (Its fire in another flame's colours where it says: Brave Bird's blue, round a fire aura of the usual colours.)
    // (A Dragon, Fighting, Dark or Ghost aura on the whole body has one too, in its own colours.)
    const nb = wu && options.noiseBurst && isFire(options.element) ? this.fireSphere(node, options.noiseElement || options.element)
      : wu && whole && FIRE_SPHERE_BANDS[options.element] ? this.fireSphere(node, options.element) : null;
    // A Flying aura on the whole body comes with its outer tornado round it
    // (windCoat), lit and let go with it — a golden one (Sky Attack's), golden.
    // (A Water aura on the whole body: a water tornado — the tornado's shape, the water's colours, ripples and foam.)
    // (Psychic's and Poison's: water tornadoes too, in their own colours.)
    // (Grass's: a soft green tornado with leaves flowing round in it.)
    const windy = (options.element === 'Flying' || options.element === 'Gold' || (WATER_TORNADO && options.element === 'Water')
      || options.element === 'Psychic' || options.element === 'Poison' || options.element === 'Grass' || options.element === 'Normal' || options.element === 'Bug') && options.wind !== false;
    const wind = wu && whole && windy ? this.windCoat(node, options.element) : null;
    // (And under a Grass aura on the ground, its tile grown into a meadow.)
    const meadow = wu && whole && options.element === 'Grass' ? this.meadow(node) : null;
    // (A Fairy aura on the whole body: star sparkles popping off it.)
    const sparkles = wu && whole && options.element === 'Fairy' ? this.sparkles(node) : null;
    const extra = [nb, wind, meadow, sparkles].filter((x): x is NonNullable<typeof x> => !!x);
    const handle: AuraHandle = extra.length
      ? {
        lit: plain.lit, release: () => Promise.all([plain.release(), ...extra.map((x) => x.release())]).then(() => {}),
        // (Burst off on contact — Aqua Jet's water tornado: it swells out and is gone.)
        ...(wind ? { burst: () => Promise.all([plain.release(), wind.burst(), ...(nb ? [nb.release()] : []), ...(meadow ? [meadow.release()] : [])]).then(() => {}) } : {}),
      }
      : plain;
    // Electricity reads as such only with strokes earthing off the body
    // (EFFECTS.md Part 2 §4): an Electric aura, or any aura on an Electric type.
    const u = this.units.get(node);
    // (Struck by icy or psychic lightning — Ice Beam, Psybeam: its aura, shivering,
    // earths off it in that lightning's strokes.)
    const zapped = options.shiver ? BOLT_COLORS[options.element] : undefined;
    const icy = !!zapped;
    const electric = icy || options.element === 'Electric' || !!u?.types.includes('Electric');
    if (!this.lightning || !u || !electric) return handle;
    const t0 = performance.now(), ignite = options.ignite ?? 0.5;
    // A charge (Volt Tackle) is a body clad in electricity: more strokes,
    // thicker, and never in the flicker's dead air.
    const charge = options.element === 'Electric' && options.edge === 'tongues';
    // Charging up a Thunderbolt: more strokes, thin, never in the flicker's dead air.
    const charging = options.element === 'Electric' && !!options.charging;
    const earth = this.earthing(node, {
      power: () => Math.min(1, (performance.now() - t0) / 1000 / ignite) * (options.element === 'Electric' || icy ? 1 : 0.7),
      bolts: charge || charging ? 9 : options.element === 'Electric' || icy ? 6 : 4,
      colors: zapped,
      // (An Electric aura's own strokes a little thicker than the strokes off other auras.)
      thick: (charge ? 1.3 : charging ? 0.8 : 1) * (options.element === 'Electric' && !charging ? ELECTRIC_THICK : 1),
      steady: charge || charging,
    });
    return {
      lit: handle.lit,
      release: () => { earth?.stop(); return handle.release(); },
    };
  }

  /** Earthing strokes off a unit's body, until stopped. */
  private earthing(node: TransformNode, o: EarthOptions): { stop(): void } | null {
    const u = this.units.get(node);
    if (!this.lightning || !u) return null;
    const h = displayHeight(u.model.height);
    const mouth = this.mouthOf(node);
    const head = u.model.skeleton.bones.find((b) => b.name === 'head');
    const headAt = new Vector3();
    return this.lightning.earth({
      count: u.skin.count(),
      pointAt: (i, out) => u.skin.pointAt(i, out),
      root: () => node.position,
      height: h,
      ground: () => node.position.y,
      // (Held in a clash, its strokes thrown back and out to the sides, away from the other.)
      press: () => u.coatWay ?? null,
      // (Laid on over the aura, so a stroke out past it shows whole.)
      overAura: this.fx ? (mesh) => this.fx!.addLight(mesh) : undefined,
      // Not from the front of the face: near the snout, or on the head's
      // front half (ahead of the head bone along the way it faces).
      avoid: (p) => {
        // Every emitter, whatever its rig: a model with no 'head' bone judges the
        // face from the snout instead (a little further back, as the snout is
        // the front of the face).
        const m = mouth();
        if (Vector3.Distance(p, m) < 0.3 * h) return true;
        const face = new Vector3(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
        if (head) head.getAbsolutePositionToRef(u.model.meshes[0], headAt);
        const d = p.subtract(head ? headAt : m);
        return d.length() < 0.45 * h && Vector3.Dot(d, face) > (head ? -0.02 : -0.15) * h;
      },
    }, o);
  }

  playLightning(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: LightningSpec): BeamPlay {
    if (!this.lightning) return this.fallback.playLightning(node, target, targetPos, spec);
    const L = this.lightning;
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const chest = () => this.middleOf(node);
    // Off the attacker's surface facing the target, onto the target's facing
    // back: the bolt runs from one aura into the other (the caster's Electric
    // aura, the target's zap), one with them.
    const targetMid = target ? () => this.middleOf(target) : () => targetPos;
    const from = this.surfaceToward(node, targetMid);
    const mid = target ? this.surfaceToward(target, chest) : () => targetPos;
    const feet = target ? () => target.position : () => targetPos;
    // The body: the ranged pose; the lightning leaves at its release.
    const release = u ? this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8) : 0;
    const W = 0.012 * TILE_SCALE; // a hairline-and-a-bit; thick bolts are multiples
    const play = (() => {
      switch (spec.kind) {
        case 'thunder': { // Thunderbolts falling out of the sky: onto the target (a hit), and the tiles round it.
          // Missing, they keep well off its body.
          const ring = HEX_SIZE * Math.sqrt(3);
          const clear = Math.max(THUNDER_CLEAR * ring, target ? this.heightOf(target) * THUNDER_CLEAR_BODY : 0);
          return L.thunder(feet, { width: W * 7, hold: 1.0, ring, clear, delay: release, miss: spec.miss });
        }
        case 'discharge': { // It earths into the tiles round itself and bolts the target.
          // Reaching out to the neighbouring tiles' middles, whatever its size.
          const reach = (HEX_SIZE * Math.sqrt(3) * 0.85) / this.heightOf(node);
          const burst = this.earthing(node, { power: () => 1, bolts: 12, thick: 1.6, spread: reach, steady: true });
          const p = L.bolt(from, mid, { width: W * 3.8, strands: 2, forks: 3, hold: 1.0, delay: release });
          void p.contactEnds.then(() => burst?.stop());
          return p;
        }
        case 'spark': // Thin bolts.
          return L.bolt(from, mid, { width: W * 1.8, strands: 2, forks: 2, hold: 0.6, delay: release, light: 0.8 });
        case 'bolt':
        default: // Thunderbolt: thick — charged up as a beam is (BEAM_CHARGE) before it strikes.
          return L.bolt(from, mid, { width: W * 7, strands: 2, forks: 4, hold: 0.9, delay: Math.max(release, BEAM_CHARGE), light: 2.5 });
      }
    })();
    // (Struck, the target wears the filled Electric aura, which earths off its
    // body — ResolutionPlayback lights it on the hit.)
    return play;
  }

  async playFaint(node: TransformNode): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playFaint(node);
    // Fainting frozen: the ice shatters first.
    if (u.ice) await this.thaw(node);
    u.down = true;
    // A flier drops to the ground before it falls over.
    if (u.hoverTarget > 0) await this.climbTo(u, 0, 2);
    await u.model.player.play('faint', { fade: 0.15 });
    if (u.down) void u.model.player.play('down', { fade: 0.2 });
  }

  /**
   * Evolve: the Pokémon glows white, and its surface flows, vertex by vertex,
   * into the next form's shape — each part into its counterpart, while the
   * parts the new form adds unfold out of the old body — until the new form
   * stands there, and the white fades off it. Resolves with the new form's
   * node; the old one is gone. (See evolution.ts.)
   */
  async evolve(node: TransformNode, species: SpeciesDefinition): Promise<TransformNode> {
    const ua = this.units.get(node);
    if (!ua) return node;
    const playerId = (node.metadata as { playerId?: number } | null)?.playerId ?? 1;
    const next = await this.createPokemon(species, playerId);
    const ub = this.units.get(next);
    if (!ub) { next.dispose(); return node; }
    // The new form waits, hidden, where the old one stands.
    next.setEnabled(false);
    this.fx?.unregister(next);
    next.position.copyFrom(node.position);
    this.setFacing(next, node.rotation.y);
    // Evolving in the air: the next form (if it flies) waits at the same height
    // in its in-air battle wait, so the morph ends in that pose.
    ub.hoverTarget = ub.hover = ub.model.player.has('airIdle') ? ua.hoverTarget : 0;
    void ub.model.player.play(this.act(ub, 'idle'), { fade: 0 });
    ub.lookAt = ua.lookAt;
    const smooth = (x: number) => x * x * (3 - 2 * x);

    // 1. Both surfaces as they stand, and where each vertex goes (worked out
    // before anything shows: it takes a moment).
    const skA = ua.model.skeleton, skB = ub.model.skeleton;
    skA.prepare(true);
    next.computeWorldMatrix(true);
    skB.prepare(true);
    const sA = snapshotModel(ua.model.meshes, skA), sB = snapshotModel(ub.model.meshes, skB);
    const bA = bonePositions(skA, ua.model.meshes[0]), bB = bonePositions(skB, ub.model.meshes[0]);
    const dA = node.scaling.x * ua.model.height, dB = next.scaling.x * ub.model.height;
    const cell = Math.max(dA, dB) / 30;
    // Each vertex's partner on the other form (vertex indices).
    const aTo = pairOnto(sA, skA, bA, sB, skB, bB, matchBones(skA, skB), dB / dA, cell);
    const bFrom = pairOnto(sB, skB, bB, sA, skA, bA, matchBones(skB, skA), dA / dB, cell);
    // Both keep playing their battle-wait animation throughout: their surfaces
    // are re-skinned every frame and the morph blends between them.
    const liveA = new LiveSkin(ua.model.meshes, skA), liveB = new LiveSkin(ub.model.meshes, skB);
    const posA = new Float32Array(liveA.count * 3), posB = new Float32Array(liveB.count * 3);
    // Each surface keeps its feet on the ground as it morphs — if its form has
    // feet and stands on the ground (one in the air is left in the air).
    const none = new Int32Array(0);
    const feetA = ua.hover > 0.01 ? none : footVertices(ua.model.meshes, skA);
    const feetB = ub.hover > 0.01 ? none : footVertices(ub.model.meshes, skB);
    const ground = node.position.y;

    // Through its white glow: the ball's wind spiral round its feet (not in
    // the air), and its heavy noise bursting out of the body, light blue
    // (BallFx.evolveAura) — sized to the form it is, growing as it evolves.
    let morphK = 0;
    const hA = displayHeight(ua.model.height), hB = displayHeight(ub.model.height);
    const height = () => hA + (hB - hA) * morphK;
    const aura = this.beams ? evolveAura(this.beams, {
      height,
      // A Mega Evolution (or a Primal Reversion): the bursts in rainbow colours.
      mega: /^(Mega|Primal) /.test(species.name),
      centre: () => node.position.add(new Vector3(0, height() * 0.5 + ua.hover, 0)),
      feet: () => (ua.hover > 0.01 ? null : node.position),
      overlay: this.fx ? (mesh, m) => this.fx!.addOverlay(mesh, m) : undefined,
    }) : null;

    // 2. The model glows white.
    await this.over(EVOLVE_GLOW, (k) => this.fx?.setWhite(node, k));

    // 3. The two surfaces, glowing white, flow: the old onto the new shape,
    // the new out of the old one.
    const holder = new TransformNode('evolving', this.scene);
    const mat = new StandardMaterial('evolvingMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    // Each surface is one connected mesh the whole way (nothing ever comes
    // apart from the body).
    const surface = (name: string, s: { pos: Float32Array; idx: Uint32Array }) => {
      const m = new Mesh(name, this.scene);
      const vd = new VertexData();
      vd.positions = Array.from(s.pos);
      vd.indices = Array.from(s.idx);
      vd.applyToMesh(m, true);
      m.material = mat;
      m.parent = holder;
      m.isPickable = false;
      return m;
    };
    const mA = surface('evolvingFrom', sA), mB = surface('evolvingTo', sB);
    // Where each surface heads (its partners on the other), smoothed over it.
    const gA = buildGraph(sA), gB = buildGraph(sB);
    const scrA = smoothScratch(gA), scrB = smoothScratch(gB);
    // Every piece of each surface kept on what it is set into, every frame
    // (nothing ever drifts off the body: evolution.ts, keepTied).
    const tiesA = tiePieces(sA.pos, gA, dA), tiesB = tiePieces(sB.pos, gB, dB);
    const destA = new Float32Array(sA.pos.length), fromB = new Float32Array(sB.pos.length);
    node.setEnabled(false);
    if (this.fx) {
      this.fx.unregister(node);
      this.fx.register(holder, [mA, mB], null);
      this.fx.setWhite(holder, 1);
    }
    const pa = new Float32Array(sA.pos.length), pb = new Float32Array(sB.pos.length);
    await this.over(EVOLVE_MORPH, (x) => {
      const e = smooth(x);
      morphK = e;
      liveA.update(posA);
      liveB.update(posB);
      // The old surface heads for its partners on the new one's live pose, the
      // new surface comes out of its partners on the old one's — each
      // destination smoothed over its surface, so both stay whole: the new
      // one starts tucked just inside the old body and unfolds out of it, the
      // old one ends tucked just inside the new body.
      for (let i = 0; i < aTo.length; i++) destA.set(posB.subarray(aTo[i] * 3, aTo[i] * 3 + 3), i * 3);
      for (let j = 0; j < bFrom.length; j++) fromB.set(posA.subarray(bFrom[j] * 3, bFrom[j] * 3 + 3), j * 3);
      smoothOver(destA, gA, SMOOTH_STEPS, 0.6, scrA);
      smoothOver(fromB, gB, SMOOTH_STEPS, 0.6, scrB);
      for (let i = 0; i < pa.length; i++) pa[i] = posA[i] + (destA[i] - posA[i]) * e;
      for (let i = 0; i < pb.length; i++) pb[i] = fromB[i] + (posB[i] - fromB[i]) * e;
      plant(pa, feetA, ground);
      plant(pb, feetB, ground);
      keepTied(pa, tiesA);
      keepTied(pb, tiesB);
      mA.updateVerticesData(VertexBuffer.PositionKind, pa);
      mB.updateVerticesData(VertexBuffer.PositionKind, pb);
      mA.refreshBoundingInfo();
      mB.refreshBoundingInfo();
    });

    // 4. It has the new form's shape: the new form, still white, takes over.
    if (this.fx) {
      this.fx.unregister(holder);
      this.fx.register(next, ub.model.meshes, ub.model.skeleton, ub.model.props.map((p) => p.mesh));
      this.fx.setWhite(next, 1);
    }
    next.setEnabled(true);
    holder.dispose(false, true);
    if (ua.lookAt) { const uo = this.units.get(ua.lookAt); if (uo?.lookAt === node) uo.lookAt = next; }
    if (ua.upkeep) this.scene.onBeforeRenderObservable.remove(ua.upkeep);
    for (const m of ua.waterParts ?? []) m.dispose();
    this.units.delete(node);
    ua.model.dispose();

    // 5. The white fades off it (and the bursts and the spiral die away).
    void aura?.stop();
    await this.over(EVOLVE_GLOW, (k) => this.fx?.setWhite(next, 1 - k));
    this.fx?.setWhite(next, 0);
    return next;
  }

  /** Take a Pokémon off the field for good: its upkeep, its effects slot, its model. */
  remove(node: TransformNode): void {
    const u = this.units.get(node);
    this.fx?.unregister(node);
    if (!u) { node.dispose(); return; }
    if (u.upkeep) this.scene.onBeforeRenderObservable.remove(u.upkeep);
    for (const m of u.waterParts ?? []) m.dispose();
    this.units.delete(node);
    u.model.dispose();
  }

  /** Run fn(t) every frame for `seconds`, t going 0..1 on the render clock. */
  private over(seconds: number, fn: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      fn(0);
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        // (A long frame — work done in it — advances it by at most a normal frame's step.)
        t = Math.min(1, t + Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000) / seconds);
        fn(t);
        if (t >= 1) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
      });
    });
  }

  /**
   * Frozen solid. Its body slows to a stop over FREEZE_SLOW s (frosting over
   * pale blue as it does) and holds that pose; then a block of ice (iceBlock:
   * a boulder's facets, fitted to the body as it stands) forms on its body
   * and thickens out round it over FREEZE_GROW s, flashing white as it sets.
   */
  async freeze(node: TransformNode, instant = false): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.freeze(node, instant);
    if (u.ice) return;
    const player = u.model.player;
    u.ice = null; // (frozen from now: it stops turning)
    if (!instant) {
      if (this.fx?.has(node)) this.fx.flash(node, [0.7, 0.9, 1], { peak: 0.7, hold: FREEZE_SLOW + FREEZE_GROW, fade: 0.5 });
      const speed0 = player.speed;
      await this.over(FREEZE_SLOW, (t) => { player.speed = speed0 * (1 - t) * (1 - t); });
    }
    player.frozen = true;
    player.speed = 1;
    if (u.ice !== null) return; // (thawed meanwhile)
    // The body as it stands, in the unit's own space (the ice goes where it goes).
    node.computeWorldMatrix(true);
    const inv = node.getWorldMatrix().clone().invert();
    const pts: Vector3[] = [];
    u.skin.forEachPoint((p) => pts.push(Vector3.TransformCoordinates(p, inv)));
    const seed = (Math.imul(this.iceSerial++ + 1, 2654435761) ^ u.species.length * 40503) >>> 0;
    const block = iceBlock(`ice_${u.species}`, pts, seed, this.scene);
    block.mesh.parent = node;
    u.ice = block;
    if (instant) return;
    // It forms on the body and thickens out into the block, and sets with a white flash.
    const { mat } = block;
    const glow = mat.emissiveColor.clone();
    await this.over(FREEZE_GROW, (t) => {
      block.form(1 - Math.pow(1 - t, 3));
      mat.alpha = ICE_ALPHA * Math.min(1, t * 2.5);
      const flash = Math.max(0, 1 - Math.abs(t - 0.85) / 0.15);
      mat.emissiveColor.set(glow.r + flash * 0.6, glow.g + flash * 0.6, glow.b + flash * 0.5);
    });
    mat.emissiveColor.copyFrom(glow);
    mat.alpha = ICE_ALPHA;
  }

  /**
   * Free of the ice, back to life into its idle: the ice shatters
   * (iceBlock.shatterIce), or, `melt` (a Fire move), slumps away in steam
   * (iceBlock.meltIce).
   */
  async thaw(node: TransformNode, how: 'shatter' | 'melt' = 'shatter'): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.thaw(node, how);
    const block = u.ice;
    u.ice = undefined;
    u.model.player.frozen = false;
    if (!block) return;
    if (this.fx?.has(node)) this.fx.flash(node, [0.8, 0.95, 1], { peak: 0.8, hold: 0.05, fade: 0.4 });
    if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.25 });
    await (how === 'melt' ? meltIce(block, this.scene) : shatterIce(block, this.scene));
  }

  isFrozen(node: TransformNode): boolean {
    const u = this.units.get(node);
    return u ? u.ice !== undefined : this.fallback.isFrozen(node);
  }

  private iceSerial = 0;

  lieDown(node: TransformNode): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.lieDown(node);
    if (u.down) return;
    u.down = true;
    u.hoverTarget = u.hover = 0;
    void u.model.player.play('down', { fade: 0.3 });
  }

  isDown(node: TransformNode): boolean {
    const u = this.units.get(node);
    return u ? u.down : this.fallback.isDown(node);
  }

  revive(node: TransformNode): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.revive(node);
    u.down = false;
    void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  setFacing(node: TransformNode, dir: number): void {
    node.rotation.y = dir;
    const meta = node.metadata as { facing?: number } | null;
    if (meta) meta.facing = dir;
  }

  // ── helpers ────────────────────────────────

  /**
   * Play a one-shot clip, return to the battle idle when it ends (unless
   * something else has started meanwhile, or the unit is down), and return
   * how many seconds in its key moment falls: `fraction` of the clip, at most
   * `cap` seconds — so the battle can land the hit without waiting for the
   * whole follow-through.
   */
  private oneShot(u: Unit, action: string, fraction: number, cap: number): number {
    const player = u.model.player;
    if (!player.has(action)) return 0;
    void player.play(action, { fade: 0.12 }).then(() => {
      if (!u.down && player.active && player.active.action === action) void player.play(this.act(u, 'idle'), { fade: 0.25 });
    });
    const dur = player.clips.get(action)?.duration ?? 0.6;
    return Math.min(cap, dur * fraction);
  }

  /** The clip for `action` in the unit's current state: its air twin while it hovers. */
  private act(u: Unit, action: string): string {
    return u.hoverTarget > 0 && u.model.player.has(airName(action)) ? airName(action) : action;
  }

  /** Set the hover height and resolve once the unit has climbed or sunk to it. */
  private climbTo(u: Unit, height: number, speed = 1): Promise<void> {
    u.hoverTarget = height;
    // (Already there: no wait at all.)
    const d = Math.abs(height - u.hover);
    return d < 0.01 ? Promise.resolve() : sleep(d / (CLIMB_SPEED * speed) + 0.05);
  }

  /**
   * Every frame: ease the hover toward its target, and keep the skin out of
   * the floor. Some clips carry the body lower than the rest pose the feet
   * were placed by (a crouch, a lunge, a fall), so the lowest skinned point is
   * measured and the body lifted by whatever has sunk below the tile.
   */
  private updateHeight(root: TransformNode, u: Unit): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    // Keep facing the opponent (not while walking: then it faces its path; nor frozen).
    if (u.lookAt && !u.moving && !u.down && !u.ice && !u.lookHold) {
      const d = u.lookAt.position.subtract(root.position);
      if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) {
        const want = Math.atan2(d.x, d.z);
        let diff = want - root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // the short way round
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * dt);
        this.setFacing(root, root.rotation.y + turn);
      }
    }
    const step = CLIMB_SPEED * dt * (u.down ? 2 : 1);
    const d = u.hoverTarget - u.hover;
    u.hover += Math.abs(d) <= step ? d : Math.sign(d) * step;
    // (Its feet up: something else of it the lowest — checked now and then, the whole skin being dear to measure.)
    if (u.feet && !u.down && !u.leaping && u.hover <= 0.01 && (u.feetCheck = (u.feetCheck ?? 0) - 1) <= 0) {
      u.feetCheck = FEET_UP_EVERY;
      u.feetUp = u.feet.lowestY() - u.skin.lowestY() > FEET_UP * u.model.height * (root.scaling.y || 1);
    }
    // The floor under it (an arena's relief: a flagstone, a dune), its feet set on it — 0 on flat ground.
    const ground = this.groundAt ? this.groundAt(root.position.x, root.position.z) : 0;
    const base = root.position.y + ground;
    if (u.hover > 0.01) {
      u.clamp = ground;
    } else if (u.feet && !u.down && !u.leaping && !u.feetUp) {
      // On its feet: the lowest point of its feet stands exactly on the tile —
      // lifted if they sink, lowered if they float (some idles hold the body
      // up off the root).
      // But no part of it below the tile, whatever its feet: never lower than
      // keeps its lowest point on it (a tongue, a held shuriken, a dropped
      // tail) — both from where it stands now. (Its skeleton brought up to
      // this frame's pose first: else it is measured a frame late.)
      u.model.skeleton.prepare(true);
      const off = base - u.feet.lowestY();
      const under = base - CLAMP_EPS - u.skin.lowestY();
      const feet = Number.isFinite(off) ? u.clamp + off * Math.min(1, FEET_RATE * dt) : u.clamp;
      u.clamp = Number.isFinite(under) ? Math.max(feet, u.clamp + under) : feet;
    } else {
      // No feet (or lying down): its lowest point kept on the floor — lifted
      // if it sinks; and, with no feet at all (a snake, a fish, a blob),
      // lowered if it floats, down to its skeleton's own origin (the ground
      // its clips are made on: a snake's rest pose hangs its tail far below
      // where it lies; a true floater's idle holds it up above it).
      u.model.skeleton.prepare(true); // (this frame's pose, not the last: see above)
      const sink = base - CLAMP_EPS - u.skin.lowestY();
      const floor = ground + (u.feet && !u.feetUp ? 0 : Math.min(0, u.model.restBounds.min[1]) * (root.scaling.y || 1));
      const want = Math.max(floor, u.clamp + sink);
      // (Sinking, it is lifted at once — nothing of it ever below the ground;
      // floating, it settles back down at its own pace.)
      const rate = want > u.clamp ? Infinity : CLAMP_DOWN;
      u.clamp += (want - u.clamp) * Math.min(1, rate * dt);
    }
    u.model.setLift((u.hover + u.clamp) / (root.scaling.y || 1));
    this.fx?.setAirborne(root, u.hover > 0.05);
  }

  /** Move a node to `to` over `seconds`, eased, on the render clock. */
  /**
   * Two ram attacks meeting head-on: both leap at once to just short of the
   * middle between them, and there the ram's contact burst goes off again and
   * again, each side's in its own colours facing the other, for `hold` s (or
   * until `until` resolves). Resolves when the standoff ends.
   */
  async playRamClash(a: TransformNode, b: TransformNode, typeA: string, typeB: string, hold = RAM_CLASH_HOLD, until?: Promise<void>, at?: Vector3,
    onward?: { node: TransformNode; to: Vector3; land?: boolean }, won?: TransformNode | null): Promise<{ onward: Promise<void> }> {
    const ab = b.position.subtract(a.position); ab.y = 0;
    const L = ab.length();
    const dir = L < 1e-3 ? new Vector3(0, 0, 1) : ab.scale(1 / L);
    // Where they meet: the clash point (`at`, the engine's clash tile), or midway.
    const meet = at ? new Vector3(at.x, a.position.y + (b.position.y - a.position.y) * 0.5, at.z) : Vector3.Center(a.position, b.position);
    const H = (this.heightOf(a) + this.heightOf(b)) / 2;
    // (At the height they meet: off the ground by however high they fly.)
    const flies = (n: TransformNode) => this.units.get(n)?.hoverTarget ?? 0;
    const burstAt = meet.add(new Vector3(0, H * 0.45 + (flies(a) + flies(b)) / 2, 0));
    // Where each stops is worked out before either sets off: back from the
    // clash point by how far its body can reach forward in its leap (however
    // it pitches) plus its aura's width, so the two auras meet at the clash
    // point and nothing is corrected on the way.
    const fireA = isFire(this.hueOf(a, typeA)), fireB = isFire(this.hueOf(b, typeB));
    const stopAt = (node: TransformNode, sign: number, fire: boolean) => {
      const { ahead, height } = this.leapReach(node, false);
      const back = ahead + auraReach(height, fire) + H * RAM_CLASH_CLEAR;
      const from = (node.position.x - meet.x) * dir.x + (node.position.z - meet.z) * dir.z;
      // (Never back past where it starts.)
      const d = sign > 0 ? Math.max(from, -back) : Math.min(from, back);
      return new Vector3(meet.x + dir.x * d, node.position.y, meet.z + dir.z * d);
    };
    const stopA = stopAt(a, 1, fireA), stopB = stopAt(b, -1, fireB);
    // The standoff: held in their leaps' poses until it ends.
    let release!: () => void;
    const standoff = new Promise<void>((r) => { release = r; });
    let there = 0, bothThere!: () => void;
    const met = new Promise<void>((r) => { bothThere = r; });
    const arrived = () => { if (++there === 2) bothThere(); };
    // Through the clash a Flying coat lies along the charge (its moving tornado,
    // pointed at the other), standing or not; let go as the clash ends.
    const ua = this.units.get(a), ub = this.units.get(b);
    if (ua) ua.coatWay = dir.clone();
    if (ub) ub.coatWay = dir.scale(-1);
    // One on the ground against one in the air: held, the one on the ground
    // springing up at it (its jump-up pose), the one in the air diving down
    // at it (its jump-down pose).
    const airA = (ua?.hoverTarget ?? 0) > 0.05, airB = (ub?.hoverTarget ?? 0) > 0.05;
    const holdOf = (air: boolean) => (airA !== airB ? (air ? 'jumpDownLoop' : 'jumpUpLoop') : undefined);
    const runs = Promise.all([
      this.playRunInto(a, [stopA], meet, typeA, 'run', { hold: standoff, arrived, onward: () => (onward?.node === a ? onward.to : undefined), land: onward?.node === a ? onward.land : true, holdClip: holdOf(airA) }),
      this.playRunInto(b, [stopB], meet, typeB, 'run', { hold: standoff, arrived, onward: () => (onward?.node === b ? onward.to : undefined), land: onward?.node === b ? onward.land : true, holdClip: holdOf(airB) }),
    ]);
    // Butting from the moment both are there.
    await met;
    // Their auras grown out to meet at the midpoint between them: each to half
    // the gap between their bodies' fronts (as they stand, posed), past its
    // own outline and glow.
    const reachOf = (node: TransformNode, sign: number) => {
      const un = this.units.get(node);
      let k = -Infinity, lo = Infinity, hi = -Infinity;
      un?.skin.forEachPoint((p) => {
        const r = sign * ((p.x - meet.x) * dir.x + (p.z - meet.z) * dir.z);
        if (r > k) k = r;
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      });
      return { edge: sign * k, height: hi - lo };
    };
    const ra = reachOf(a, 1), rb = reachOf(b, -1);
    const halfGap = (rb.edge - ra.edge) / 2;
    const fx = this.fx;
    const grown = fx && isFinite(halfGap) && halfGap > 0;
    if (grown) {
      // (By its bright outline, what is seen of it: its glow past that hardly
      // shows, and a fire's tongues flick out past it only here and there.)
      for (const [node, r] of [[a, ra], [b, rb]] as const) {
        const own = auraLineReach(r.height);
        if (fx.has(node) && own > 1e-3) fx.growAura(node, Math.min(RAM_CLASH_GROW_MAX, Math.max(1, halfGap / own)));
      }
    }
    // …and streaming out behind each, away from the clash point.
    if (fx) { fx.stretchAura(a, dir.scale(-1), RAM_CLASH_STRETCH); fx.stretchAura(b, dir, RAM_CLASH_STRETCH); }
    // The bursts aimed along the line between the two bodies' middles (one
    // flying, one on the ground: slanted as they face each other).
    const middle = (n: TransformNode) => n.position.add(new Vector3(0, flies(n) + this.heightOf(n) * 0.45, 0));
    const toB = middle(b).subtract(middle(a));
    if (toB.lengthSquared() < 1e-6) toB.copyFrom(dir); else toB.normalize();
    const toA = toB.scale(-1);
    const qs = (this.quickStep ??= new QuickStepFx(this.scene));
    const burst = (d: Vector3, node: TransformNode, type: string) => {
      const tone = this.hueOf(node, type);
      if (this.beams) this.beams.hemiBurst(burstAt, d, H * QS_HIT_BURST, tone, true);
      else qs.hemisphere(burstAt, d, H * QS_HIT_BURST * 2, new Color3(...auraGlow(tone)[0]));
    };
    let over = false;
    void (until ?? sleep(hold)).then(() => { over = true; });
    while (!over) {
      burst(toB, a, typeA);
      burst(toA, b, typeB);
      await sleep(RAM_CLASH_EVERY);
    }
    if (ua) ua.coatWay = undefined;
    if (ub) ub.coatWay = undefined;
    // (Their auras back to their own size as it ends.)
    if (grown) { fx.growAura(a, 1); fx.growAura(b, 1); }
    if (fx) { fx.stretchAura(a, null); fx.stretchAura(b, null); }
    // Won: the winner's move breaks through — a larger burst at the clash
    // point, in its colours, toward the loser.
    const victor = won ?? onward?.node;
    if (victor === a || victor === b) {
      const tone = this.hueOf(victor, victor === a ? typeA : typeB);
      const toward = victor === a ? toB : toA;
      if (this.beams) this.beams.hemiBurst(burstAt, toward, H * QS_HIT_BURST * RAM_CLASH_WIN_BURST, tone, true);
      else qs.hemisphere(burstAt, toward, H * QS_HIT_BURST * RAM_CLASH_WIN_BURST * 2, new Color3(...auraGlow(tone)[0]));
    }
    release();
    // (The winner, sent on, carries on past this: its run resolves `onward`.)
    return { onward: runs.then(() => undefined) };
  }


  /**
   * How far a body can reach out in front of where it stands while leaping
   * (its skin, as posed now, pitched any way the leap may pitch it about its
   * middle, with a margin for the jump pose's limbs), and its height.
   */
  /** `pitched` false: as it stands, unpitched (a run, not a leap). */
  private leapReach(node: TransformNode, pitched = true): { ahead: number; height: number } {
    const u = this.units.get(node);
    const h = this.heightOf(node);
    if (!u) return { ahead: h * 0.6, height: h };
    const inv = node.getWorldMatrix().clone().invert();
    const sc = Math.abs(node.scaling.z) || 1;
    const mid = u.model.height * 0.5;
    const local: number[] = [];
    let lo = Infinity, hi = -Infinity;
    const q = new Vector3();
    u.skin.forEachPoint((p) => {
      Vector3.TransformCoordinatesToRef(p, inv, q);
      local.push(q.y - mid, q.z);
      if (q.y < lo) lo = q.y;
      if (q.y > hi) hi = q.y;
    });
    let ahead = 0;
    for (let k = 0; k <= (pitched ? LEAP_REACH_STEPS : 0); k++) {
      const t = pitched ? -LEAP_MAX + (2 * LEAP_MAX * k) / LEAP_REACH_STEPS : 0;
      const c = Math.cos(t), sn = Math.sin(t);
      for (let i = 0; i < local.length; i += 2) {
        const z = local[i + 1] * c + local[i] * sn;
        if (z > ahead) ahead = z;
      }
    }
    return { ahead: ahead * sc * (1 + LEAP_REACH_MARGIN), height: (hi - lo) * sc };
  }

  /**
   * Travel along `run` in the jump-up loop (its spring first), the body
   * pitched so the snout points along the way it goes — measured in the pose,
   * pitched about the body's middle so it neither sinks nor floats — then
   * level again on arrival.
   */
  /**
   * `land` false (a move with recoil): no jump-down nor landing — it ends on
   * the impact, straight into the recoil's hit (resolving there; it levels
   * out under the hit).
   */
  private async leap(u: Unit, node: TransformNode, run: Vector3[], arrived?: () => void, hold?: Promise<void>, onward?: () => Vector3 | undefined, land = true): Promise<void> {
    const player = u.model.player;
    const last = run[run.length - 1];
    this.setFacing(node, Math.atan2(last.x - node.position.x, last.z - node.position.z));
    // Pitched about the middle of its body (not its feet): it neither sinks nor floats.
    node.setPivotPoint(new Vector3(0, u.model.height * 0.5, 0));
    // From its first frame on, every frame: however the pose turns its head,
    // the body is pitched so its snout points level along the way it goes.
    // (Its snout read in its own frame — the pitch taken back out — so the
    // pitch follows the pose alone, never itself.)
    const mid = new Vector3(0, u.model.height * 0.5, 0);
    const inv = new Matrix();
    const level = () => {
      node.computeWorldMatrix(true).invertToRef(inv);
      const local = Vector3.TransformCoordinates(this.mouthOf(node)(), inv).subtract(mid);
      // (Local: the pitch is already out of it.) Its tilt above level in the
      // pose — read only while the snout is well out in front (straight over
      // or behind its middle, the angle flips about: keep the last).
      // (Straight over its middle — Emboar's head, stretched up — reads true:
      // the angle only flips about with the snout behind it and low.)
      if (local.z < u.model.height * LEAP_AHEAD && local.y < u.model.height * LEAP_AHEAD) return;
      const want = Math.max(-LEAP_MAX, Math.min(LEAP_MAX, Math.atan2(local.y, local.z)));
      // Eased into over its first LEAP_BLEND s, as it sets off: never snapped.
      blend = Math.min(1, blend + this.scene.getEngine().getDeltaTime() / 1000 / LEAP_BLEND);
      const w = blend * blend * (3 - 2 * blend);
      // Followed smoothly, never faster than LEAP_TURN a frame.
      const step = (want * w - node.rotation.x) * LEAP_FOLLOW;
      node.rotation.x += Math.max(-LEAP_TURN, Math.min(LEAP_TURN, step));
      // (Its snout level along the way: it may set off.)
      if (w >= 1 && Math.abs(want - node.rotation.x) < LEAP_ALIGN) aligned = true;
    };
    let aligned = false;
    let blend = 0;
    const obs = this.scene.onBeforeRenderObservable.add(level);
    u.leaping = true;
    // Arrived: level again, its pivot back at its feet, its feet on the ground
    // again — at the end, or (a recoil's hit, levelling under it) once level.
    let deferred = false;
    const free = () => {
      u.leaping = false;
      node.rotation.x = 0;
      node.setPivotPoint(Vector3.Zero());
    };
    try {
      // It sets off at once, easing into its spring (slowed: the clip is a
      // tenth of a second) and from that on into the loop as it goes.
      void (player.has('jumpUpStart')
        ? player.play('jumpUpStart', { fade: LEAP_FADE, speed: LEAP_START_SPEED }).then(() => player.play('jumpUpLoop', { fade: LEAP_LOOP_FADE }))
        : player.play('jumpUpLoop', { fade: LEAP_FADE }));
      // Coming down: its jump-down start, timed to end as it arrives (its
      // pitch still following its snout through it: the pose drops its head),
      // and its landing as it touches down.
      const downClip = player.has('jumpDownStart') ? player.clips.get('jumpDownStart') : undefined;
      const downFor = downClip ? downClip.duration / LEAP_DOWN_SPEED : 0;
      let coming = false;
      const comeDown = () => {
        if (coming || !downClip) return;
        coming = true;
        void player.play('jumpDownStart', { fade: LEAP_DOWN_FADE, speed: LEAP_DOWN_SPEED });
      };
      // It springs and tips into its pose where it stands, and sets off only
      // once its snout points along the way (never travelling snout-up) —
      // or after LEAP_ALIGN_MAX at most.
      await new Promise<void>((go) => {
        let t = 0;
        const o = this.scene.onBeforeRenderObservable.add(() => {
          t += this.scene.getEngine().getDeltaTime() / 1000;
          if (aligned || t >= LEAP_ALIGN_MAX) { this.scene.onBeforeRenderObservable.remove(o); go(); }
        });
      });
      // (Held at the end, a ram clash: it stays in its loop's pose, nothing to come down yet.)
      await this.tweenPath(node, run, RUN_SPEED * LEAP_SPEED, undefined, hold || !land ? undefined : { before: downFor, fn: comeDown });
      arrived?.();
      // Held there, steady, until let go: the pitch set where it is (no more
      // following the pose's every move — that set it shaking).
      this.scene.onBeforeRenderObservable.remove(obs);
      if (hold) await hold;
      // Let go and sent on (a ram clash won): it drives on in the same pose,
      // its pitch held, never dropping out of it first; it comes down at the end of that.
      const next = onward?.();
      if (next) await this.tweenPath(node, [next], RUN_SPEED * LEAP_SPEED, undefined, land ? { before: downFor, fn: comeDown } : undefined);
      // A recoil's hit ends it here and now: levelled out under the hit (its
      // clip, not an idle, carries it back to its stance), resolving at once.
      if (!land && (!hold || !!next)) {
        deferred = true;
        void this.levelOut(node).then(free);
        return;
      }
      // Touching down (not thrown off its leap, a clash's loser): its landing.
      const lands = (!hold || !!next) && !u.down && player.has('land');
      if (lands) comeDown();
      const landing = lands ? player.play('land', { fade: LEAP_LAND_FADE }) : null;
      // Levelled out smoothly as it lands (no snap).
      if (Math.abs(node.rotation.x) > 1e-3 && !u.down && !landing) void player.play(this.act(u, 'idle'), { fade: LEAP_LAND });
      await this.levelOut(node);
      // (Its landing played out, then its idle.)
      if (landing) await landing;
    } finally {
      this.scene.onBeforeRenderObservable.remove(obs);
      if (!deferred) free();
    }
    if (!u.down) void player.play(this.act(u, 'idle'), { fade: LEAP_IDLE_FADE });
  }

  /** Its leap's pitch eased back to level over LEAP_LAND (no snap). */
  private levelOut(node: TransformNode): Promise<void> {
    const from = node.rotation.x;
    if (Math.abs(from) <= 1e-3) return Promise.resolve();
    return new Promise<void>((done) => {
      let t = 0;
      const o = this.scene.onBeforeRenderObservable.add(() => {
        t = Math.min(1, t + this.scene.getEngine().getDeltaTime() / 1000 / LEAP_LAND);
        node.rotation.x = from * (1 - t * t * (3 - 2 * t));
        if (t >= 1) { this.scene.onBeforeRenderObservable.remove(o); done(); }
      });
    });
  }

  /**
   * Along `points` (keeping its height) at `speed`, as one move: eased in over
   * its first PATH_EASE and out over its last, steady between; turned to face
   * each leg as it reaches it.
   */
  /** `near`: `fn` once, `before` s ahead of its end. */
  private tweenPath(node: TransformNode, points: Vector3[], speed: number, offset?: () => Vector3,
    near?: { before: number; fn: () => void }): Promise<void> {
    const pts = [node.position.clone(), ...points.map((p) => new Vector3(p.x, node.position.y, p.z))];
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Vector3.Distance(pts[i - 1], pts[i]); lens.push(l); total += l; }
    if (total < 1e-4) { if (pts.length > 1) node.position.copyFrom(pts[pts.length - 1]); near?.fn(); return Promise.resolve(); }
    // Eased ends cost time: a steady run of the same length, plus the slower ends.
    const ease = Math.min(PATH_EASE, total / 2);
    const seconds = (total + 2 * ease) / speed;
    return new Promise((resolve) => {
      let t = 0, leg = -1;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t = Math.min(seconds, t + this.scene.getEngine().getDeltaTime() / 1000);
        if (near && seconds - t <= near.before) { near.fn(); near = undefined; }
        // Distance along: accelerating over `ease`, steady, decelerating over `ease`.
        const v = speed, ta = (2 * ease) / v, tm = (total - 2 * ease) / v;
        let s: number;
        if (t < ta) s = 0.5 * (v / ta) * t * t;
        else if (t < ta + tm) s = ease + v * (t - ta);
        else { const r = Math.max(0, seconds - t); s = total - 0.5 * (v / ta) * r * r; }
        s = Math.min(total, Math.max(0, s));
        let i = 0, acc = 0;
        while (i < lens.length - 1 && acc + lens[i] < s) { acc += lens[i]; i++; }
        if (i !== leg) { leg = i; this.setFacing(node, Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)); }
        Vector3.LerpToRef(pts[i], pts[i + 1], lens[i] > 0 ? (s - acc) / lens[i] : 1, node.position);
        if (offset) node.position.addInPlace(offset());
        if (t >= seconds) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
      });
    });
  }

  private tween(node: TransformNode, to: Vector3, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const from = node.position.clone();
      if (seconds <= 0.001) { node.position.copyFrom(to); resolve(); return; }
      let t = 0;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t = Math.min(1, t + this.scene.getEngine().getDeltaTime() / 1000 / seconds);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        Vector3.LerpToRef(from, to, e, node.position);
        if (t >= 1) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
      });
    });
  }
}

/**
 * A leaf (a Grass coat's): a pointed oval, its length along local x (its tip
 * at +0.5, a short stem out past -0.5), folded a little along its midrib
 * (its two halves raised into a shallow V) and curled a little along its
 * length; its halves two greens, its rib paler, deeper toward its stem. Lit
 * by the scene from either side.
 */
function leafMesh(scene: Scene): Mesh {
  const SEG = 8;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const v = (x: number, y: number, z: number, c: number[]) => { positions.push(x, y, z); colors.push(c[0], c[1], c[2], 1); return positions.length / 3 - 1; };
  const curl = (x: number) => -0.12 * (x + 0.5) * (x + 0.5);
  const tone = (c: number[], x: number) => { const k = 0.75 + 0.35 * (x + 0.5); return c.map((a) => Math.min(1, a * k)); };
  // Its midrib, root to tip, and each half's edge (z: either side).
  const rib: number[] = [], left: number[] = [], right: number[] = [];
  for (let k = 0; k <= SEG; k++) {
    const x = -0.5 + k / SEG;
    const w = 0.36 * Math.pow(Math.sin((Math.PI * k) / SEG), 0.8);
    rib.push(v(x, curl(x), 0, tone(LEAF_RIB, x)));
    left.push(v(x, curl(x) + w * LEAF_FOLD, w, tone(LEAF_DEEP, x)));
    right.push(v(x, curl(x) + w * LEAF_FOLD, -w, tone(LEAF_PALE, x)));
  }
  for (let k = 0; k < SEG; k++) {
    indices.push(rib[k], left[k], left[k + 1], rib[k], left[k + 1], rib[k + 1]);
    indices.push(rib[k], right[k + 1], right[k], rib[k], rib[k + 1], right[k + 1]);
  }
  // Its stem: a thin sliver back from its root.
  const s0 = v(-0.5, 0, 0.018, LEAF_STEM), s1 = v(-0.5, 0, -0.018, LEAF_STEM), s2 = v(-0.68, -0.02, 0, LEAF_STEM);
  indices.push(s0, s1, s2);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  const mesh = new Mesh('leaf', scene);
  vd.applyToMesh(mesh);
  const mat = new LeafMaterial('leafMat', scene);
  mat.diffuseColor.set(1, 1, 1);
  mat.specularColor.set(0.12, 0.14, 0.08);
  mat.specularPower = 24;
  mat.emissiveColor.set(0.22, 0.3, 0.1);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  // (Drawn over the auras on their own: without the scene's tone mapping and contrast there, which would darken them.)
  const ip = new ImageProcessingConfiguration();
  ip.isEnabled = false;
  mat.imageProcessingConfiguration = ip;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** smoothstep(a, b, x), as GLSL's. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
