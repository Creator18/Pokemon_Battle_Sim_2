/**
 * SlashFx — claw marks (EFFECTS.md Part 5 §1, `slash.rs` / `dragon_claw.rs`),
 * from the slash in a Shadertoy screen effect: only the slash itself (its
 * glow, its core and its length fade), three side by side for a claw, one
 * longer one for a blade (user).
 *
 * Three straight, parallel gashes hang in the air at the near side of what
 * was struck, cut the way the striking part was moving as it landed (user):
 * each draws itself along its length in that direction, over FORM s. (With
 * no part to follow, 45° across the striker's front: the left hand's from
 * upper left to lower right, seen from behind, the right hand's the other
 * way.) The middle one is the longest, so the set reads as a rake of claws,
 * and they bow forward — hollow towards the striker, bulging towards what
 * was hit. They fade in about half a second, lavender running to white at
 * the core.
 *
 * Each gash wears its own coat of the type's aura (user): round the core,
 * the aura's fill, then its outline colour, then its glow — and sparks fly
 * off each gash's front as it draws. (The source's smoke was dropped, by the user.)
 *
 * The source sampled the marks into points (its renderer had no full-screen
 * pass); here they are 3D: each gash a tapering tube along its bowed line,
 * its coat inverted-hull shells round it, so the set reads from any side.
 * Lengths are in units of the striker's height (H). The marks keep to the
 * striker's frame and travel with it.
 */

import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Camera } from '@babylonjs/core/Cameras/camera';

import { auraGlow, type RGB } from './auraPalette.ts';
import { GlowSparks } from './beam/GlowSparks.ts';

// ── the cut (units of the striker's height H) ───────────────────────
/** The middle gash's length; the outer two are 13% shorter. */
const LEN = 1.8;
/** Gap between neighbouring gashes, across the cut. */
const GAP = 0.28;
/** A blade's single cut is this much longer than a claw's middle mark. */
const SINGLE_LEN = 1.4;
/** How far the cut bows forward at its middle (0 at its ends). */
const BOW = 0.22;
/**
 * Where it hangs: at what was struck's near side (TARGET_BODY × its height
 * short of its middle, less the bow), at TARGET_UP of its height — but never
 * nearer the striker than MIN_AHEAD × H, so it never cuts through the striker.
 * With nothing struck, AT_AHEAD × H in front, at AT_UP × H.
 */
const TARGET_BODY = 0.3, TARGET_UP = 0.5, MIN_AHEAD = 0.55, AT_AHEAD = 0.9, AT_UP = 0.55;

// ── a gash and its coat ─────────────────────────────────────────────
/** Its core's radius (× H) at the middle, tapering to TIP_R of it at the ends. */
const GASH_R = 0.01, TIP_R = 0.2;
/** Its aura coat, as multiples of the core's radius: the fill, the outline round it, the glow round that. */
const FILL_R = 1.6, LINE_R = 4.6, GLOW_R = 10.4;
/**
 * The outline border ripples (user): its thickness swings by WAVE_AMP, in
 * WAVES waves along the gash, travelling back along it — against the way it
 * was drawn — at WAVE_SPEED rad/s.
 */
const WAVE_AMP = 0.35, WAVES = 3, WAVE_SPEED = 18;
/** How strong the glow is at its brightest (it fades to its rim). */
const GLOW_GAIN = 0.85;
/** The slash's own light: an added bloom in its core colour, BLOOM_R × the core's radius, BLOOM_GAIN strong. */
const BLOOM_R = 14.4, BLOOM_GAIN = 0.7;
/** Below this brightness a gash is not drawn. */
const CUT = 0.13;

// ── sparks ──────────────────────────────────────────────────────────
/** Off each gash as it lands: how many, how fast (× H per s) and how long they live (s). */
const SPARKS = 26, SPARK_SPEED: [number, number] = [2.2, 4.6], SPARK_LIFE: [number, number] = [0.3, 0.6];

// ── timeline (s from the blow) ──────────────────────────────────────
/** The marks: snap on over the first 3% of MARK_WINDOW, fade out by 80% of it. */
const MARK_WINDOW = 0.7, MARK_FADE = 0.8;
/** How long a gash takes to draw itself along its length, in the swing's direction (s). */
const FORM = 0.12;
/** How long after the blow the sparks are still flying (s). */
const SPARK_TAIL = SPARK_LIFE[1] + 0.1;

const ss = (e0: number, e1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

// ── shaders ─────────────────────────────────────────────────────────
// A tube along one gash: uv.x runs along it, uv.y round it. The line:
// origin + (dir·l + nrm·off + fwd·bow(l))·H, with dir and nrm at 45° across
// the striker's front (side: which hand) and fwd its facing.
Effect.ShadersStore.slashGashVertexShader = /* glsl */ `
precision highp float;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 origin, dirv, nrmv, fwd;
uniform float H, len, off, radius, tip, inner, wave, time;
varying vec3 vPos, vNrm;
varying float vFade, vU;
void main(void) {
  vec3 dir = dirv, nrm = nrmv;
  float l = (uv.x - 0.5) * len;
  vU = uv.x;
  float e = abs(l) / (len * 0.5);
  float fade = smoothstep(0.0, 1.0, clamp((0.9 - e) / 0.9, 0.0, 1.0));
  float k = clamp(2.0 * l / len, -1.0, 1.0);
  vec3 c = origin + (dir * l + nrm * off + fwd * ${BOW.toFixed(3)} * (1.0 - k * k)) * H;
  float th = uv.y * 6.2831853;
  vec3 n = cos(th) * nrm + sin(th) * fwd;
  // The outline's border (from inner out to radius) ripples back along the gash.
  float r = inner + (radius - inner) * (1.0 + wave * sin((l / len) * ${(2 * Math.PI).toFixed(4)} * ${WAVES.toFixed(1)} + time * ${WAVE_SPEED.toFixed(1)}));
  vPos = c + n * r * H * mix(tip, 1.0, fade);
  vNrm = n;
  vFade = fade;
  gl_Position = viewProjection * vec4(vPos, 1.0);
}`;

Effect.ShadersStore.slashGashFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vPos, vNrm;
varying float vFade, vU;
uniform vec3 eye, core, tint;
uniform float power, layer, drawn;
// colour(c): the core colour toward white only at the very top (c^3).
vec3 colour(float c) { float w = c * c * c; return core * c + (vec3(1.0) - core) * w; }
void main(void) {
  float top = vFade * power;
  // Drawn so far: from its start, along the swing.
  if (top <= ${CUT.toFixed(2)} || vU > drawn) discard;
  float facing = abs(dot(normalize(vNrm), normalize(eye - vPos)));
  if (layer < 0.5) {
    // The gash: brightest where it faces the eye, white only at that plateau.
    float b = top * (0.45 + 0.55 * pow(facing, 0.6));
    gl_FragColor = vec4(colour(0.52 + 0.48 * b), 1.0);
  } else if (layer < 1.5) {
    // A band of its aura coat (an inverted hull: only its back faces show, round what is inside it).
    gl_FragColor = vec4(tint, 1.0);
  } else if (layer < 2.5) {
    // The coat's glow: strongest against the coat, fading to its rim.
    float a = pow(facing, 1.8) * ${GLOW_GAIN.toFixed(2)} * top;
    if (a < 0.01) discard;
    gl_FragColor = vec4(tint, a);
  } else {
    // Its light (added): a bloom in the core's colour round the whole coat.
    float a = pow(facing, 2.2) * ${BLOOM_GAIN.toFixed(2)} * top;
    if (a < 0.01) discard;
    gl_FragColor = vec4(colour(0.8) * a, a);
  }
}`;

// ── colours ─────────────────────────────────────────────────────────
/** Dragon's core, as the source set it: lavender, white only at the top. */
const DRAGON_CORE: RGB = [0.72, 0.55, 1.0];

interface SlashColours { core: RGB; fill: RGB; line: RGB; glow: RGB }

/** A claw in its type's aura colours (auraPalette.auraGlow): its coat the aura's fill, outline and glow. */
function coloursFor(element: string): SlashColours {
  const [outer, , line, fill] = auraGlow(element);
  return { core: element === 'Dragon' ? DRAGON_CORE : fill, fill, line, glow: outer };
}

// ── API ─────────────────────────────────────────────────────────────
export interface ClawShot {
  /** The type whose colours it wears. */
  element: string;
  /** The striker's height (H): the marks are sized to it. */
  height: number;
  /** 3: a claw's rake (the default); 1: a blade's single, longer cut. */
  marks?: 1 | 3;
  /**
   * Which way the striking part was moving as it landed, in the striker's
   * front: x along its right, y up (any length). Without it, 45° by `side`.
   */
  swing?: [number, number] | null;
  /** −1: the left hand's cut (upper left to lower right, seen from behind); +1: the right hand's. */
  side: number;
  /** Where the striker stands this frame, and which way it faces (yaw, 0 = +Z). */
  feet(): Vector3;
  facing(): number;
  /** What it struck: where it stands, and its height (the cut hangs at its near side). */
  target?(): { at: Vector3; height: number } | null;
}

interface Part { mesh: Mesh; mat: ShaderMaterial }

export class SlashFx {
  constructor(private readonly scene: Scene, private readonly camera: Camera) {}

  /** Slash marks (a claw's three, a blade's one) from a blow landing now; resolves when they and their sparks have gone. */
  claw(shot: ClawShot): Promise<void> {
    const scene = this.scene;
    const col = coloursFor(shot.element);
    const H = shot.height;
    const parts: Part[] = [];
    const tube = (name: string, len: number, off: number, radius: number, layer: number, tint: RGB, hull: boolean, index: number, add = false) => {
      const mesh = MeshBuilder.CreateGround(name, { width: 1, height: 1, subdivisions: 48 }, scene);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // placed in its shader
      const mat = new ShaderMaterial(`${name}Mat`, scene, { vertex: 'slashGash', fragment: 'slashGash' }, {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'origin', 'dirv', 'nrmv', 'fwd', 'H', 'len', 'off', 'radius', 'tip', 'inner', 'wave', 'time', 'eye', 'core', 'tint', 'power', 'layer', 'drawn'],
        needAlphaBlending: true,
      });
      // A coat band is an inverted hull (its back faces only); the gash and its glow show their front faces.
      mat.backFaceCulling = true;
      mat.sideOrientation = hull ? Constants.MATERIAL_CounterClockWiseSideOrientation : Constants.MATERIAL_ClockWiseSideOrientation;
      mat.alphaMode = add ? Constants.ALPHA_ONEONE : Constants.ALPHA_COMBINE; // the bloom adds light
      mat.disableDepthWrite = true;
      mat.setFloat('H', H);
      mat.setFloat('len', len);
      mat.setFloat('off', off);
      mat.setFloat('radius', radius);
      mat.setFloat('tip', TIP_R);
      mat.setFloat('layer', layer);
      mat.setFloat('inner', 0);
      mat.setFloat('wave', 0);
      mat.setColor3('core', new Color3(...col.core));
      mat.setColor3('tint', new Color3(...tint));
      mesh.material = mat;
      mesh.alphaIndex = index;
      parts.push({ mesh, mat });
    };

    // Each gash in its coat, drawn outside in: its light, the glow, the outline, the fill, the core.
    const lines: { len: number; off: number }[] = [];
    const marks = shot.marks ?? 3;
    for (let i = 0; i < marks; i++) {
      // A claw's rake: the middle mark longest; a blade: one long cut.
      const k = marks === 1 ? 0 : i - 1;
      const len = marks === 1 ? LEN * SINGLE_LEN : LEN * (1 - 0.13 * Math.abs(k)), off = k * GAP;
      lines.push({ len, off });
      tube(`slashBloom${i}`, len, off, GASH_R * BLOOM_R, 3, col.core, false, 19, true);
      tube(`slashGlow${i}`, len, off, GASH_R * GLOW_R, 2, col.glow, false, 20);
      tube(`slashLine${i}`, len, off, GASH_R * LINE_R, 1, col.line, true, 21);
      // Its border ripples, from the fill out.
      parts[parts.length - 1].mat.setFloat('inner', GASH_R * FILL_R);
      parts[parts.length - 1].mat.setFloat('wave', WAVE_AMP);
      tube(`slashFill${i}`, len, off, GASH_R * FILL_R, 1, col.fill, true, 22);
      tube(`slashCore${i}`, len, off, GASH_R, 0, col.core, false, 23);
    }

    // Sparks off every gash, in its colours.
    const sparks = new GlowSparks(scene, this.camera, SPARKS * 3 + 8, {
      size: 0.014 * H, lengthPerSpeed: 0.035, tint: col.fill, tintMix: 0.7, gravity: 2.5 * H, drag: 2.2,
      turbulence: 0.6 * H, splitChance: 0.25, splitCount: 2, secondary: col.core, intensity: 1.3,
    });

    // The cut's direction in the striker's front (x: its right, y: up), and across it.
    const [sx, sy] = (() => {
      const s = shot.swing;
      const n = s ? Math.hypot(s[0], s[1]) : 0;
      return s && n > 1e-6 ? [s[0] / n, s[1] / n] : [-shot.side * Math.SQRT1_2, -Math.SQRT1_2]; // the left hand's: right and down
    })();
    const t0 = performance.now();
    let last = t0, drawnBefore = 0;
    return new Promise((resolve) => {
      let obs: Observer<Scene> | null = null;
      const place = () => {
        const now = performance.now();
        const t = (now - t0) / 1000;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const yaw = shot.facing();
        const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const feet = shot.feet();
        // At the near side of what was struck, clear of the striker.
        let ahead = AT_AHEAD * H, up = AT_UP * H;
        const tgt = shot.target?.();
        if (tgt) {
          const d = tgt.at.subtract(feet);
          d.y = 0;
          ahead = Math.max(MIN_AHEAD * H, d.length() - TARGET_BODY * tgt.height - BOW * H);
          up = TARGET_UP * tgt.height;
        }
        const origin = feet.add(new Vector3(0, up, 0)).add(fwd.scale(ahead));
        const tm = t / MARK_WINDOW;
        const power = ss(0, 0.03, tm) * (1 - ss(0.03, MARK_FADE, tm));
        // Each gash draws itself along the swing, fast at first.
        const drawn = 1 - Math.pow(1 - Math.min(1, t / FORM), 2);
        const dir = right.scale(sx).add(Vector3.Up().scale(sy));
        const nrm = right.scale(-sy).add(Vector3.Up().scale(sx));
        const eye = this.camera.globalPosition;
        for (const { mesh, mat } of parts) {
          mat.setVector3('origin', origin);
          mat.setVector3('dirv', dir);
          mat.setVector3('nrmv', nrm);
          mat.setVector3('fwd', fwd);
          mat.setVector3('eye', eye);
          mat.setFloat('power', power);
          mat.setFloat('drawn', drawn);
          mat.setFloat('time', t);
          mesh.setEnabled(power > CUT);
        }
        // Sparks fly off each gash's front as it draws: outward from it, and on toward what was hit.
        if (drawn > drawnBefore) {
          const from = drawnBefore;
          drawnBefore = drawn;
          for (const { len, off } of lines) {
            for (let n = Math.round(SPARKS * (drawn - from)); n > 0; n--) {
              const l = (from + Math.random() * (drawn - from) - 0.5) * len;
              const k = (2 * l) / len;
              const at = origin.add(dir.scale(l * H)).add(nrm.scale(off * H)).add(fwd.scale(BOW * (1 - k * k) * H));
              const th = Math.random() * Math.PI * 2;
              const out = nrm.scale(Math.cos(th)).add(fwd.scale(Math.sin(th) * 0.6 + 0.5)).add(dir.scale((Math.random() - 0.5) * 0.8));
              const speed = (SPARK_SPEED[0] + Math.random() * (SPARK_SPEED[1] - SPARK_SPEED[0])) * H;
              sparks.spawn(at, out.normalize().scale(speed), SPARK_LIFE[0] + Math.random() * (SPARK_LIFE[1] - SPARK_LIFE[0]));
            }
          }
        }
        sparks.update(dt);
        if (t >= Math.max(MARK_WINDOW, SPARK_TAIL)) {
          if (obs) scene.onBeforeRenderObservable.remove(obs);
          for (const { mesh, mat } of parts) { mat.dispose(); mesh.dispose(); }
          sparks.dispose();
          resolve();
        }
      };
      place();
      obs = scene.onBeforeRenderObservable.add(place);
    });
  }
}
