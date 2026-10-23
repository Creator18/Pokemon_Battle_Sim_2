/**
 * SlashFx — a follow-through slash, built the way animators build one:
 *
 *  1. Anticipation — the body's wind-up (its swipe clip); nothing drawn yet.
 *  2. The smear — a crescent arc tracing the striking edge's path: its
 *     leading edge (the head) fast and thick, hot white on its outer rim,
 *     the trail behind it tapering to nothing. It shows where the edge has
 *     just been, not a shape set down at once.
 *  3. Contact — the head tears through what was struck early in the arc
 *     (CONTACT of the way along it): sparks off that point.
 *  4. Follow-through — the head carries on well past what was struck,
 *     slowing as it goes (an ease-out): most of the arc lies after contact.
 *  5. Dissipation — the tail catches up with the head, so the trail erodes
 *     from its oldest end forward, thinning and drifting a little outward as
 *     it goes — one whole piece throughout; gone in about LIFE s.
 *
 * The arc runs in the plane of the swing: through the near side of what was
 * struck, its tangent there the way the striking part was moving as it landed
 * (`swing`, in the striker's front; 45° across by the hand without it), its
 * centre back toward the striker (the shoulder the edge swings about). Its
 * flat face is turned toward the striker all along it: its width laid across
 * the path, square to the way back to the striker. A
 * claw rakes three side by side (the middle reaching furthest), a blade cuts
 * one, wider. Each is shaped as a tornado stripe — the tornado's voronoi
 * streak, a random one each time, laid through the arc's crescent — cel
 * shaded as the tornado is, in its type's aura colours (inked, its outline
 * colour, its fill, a white-hot core), over a soft glow of its own light. Lengths are in units of the striker's height (H); the
 * arcs keep to the striker's frame.
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
import { randomStripe, STRIPE_SLICES, type Stripe } from './stripeShape.ts';

// ── the arc (units of the striker's height H) ───────────────────────
/** Its radius (the edge's reach about the shoulder it swings round), at most the distance to what was struck. */
const RADIUS = 0.75;
/** How far it sweeps before contact and after it (rad): the follow-through the longer. */
const BEFORE = 1.25, AFTER = 1.75;
/** Where on the arc it strikes (its share of the way along). */
const CONTACT = BEFORE / (BEFORE + AFTER);
/** Its crescent's widest (radially, inward from its rim): a claw's arcs, and a blade's one. */
const WIDTH = 0.16, BLADE_WIDTH = 0.26;
/** A claw's rake: the gap between its arcs (across the swing's plane), and how much shorter the outer two reach. */
const GAP = 0.2, OUTER_REACH = 0.9;
/** Where it hangs, as the old claw marks did: at the near side of what was struck, at its height × TARGET_UP; never nearer the striker than MIN_AHEAD. */
const TARGET_BODY = 0.3, TARGET_UP = 0.5, MIN_AHEAD = 0.55, AT_AHEAD = 0.9, AT_UP = 0.55;

// ── timeline (s from the blow) ──────────────────────────────────────
/** The head's sweep: the whole arc in HEAD_T s, eased out — fast through contact, slowing in the follow-through. */
const HEAD_T = 0.2;
/** The tail: setting off TAIL_DELAY s in, catching the head over TAIL_T s. */
const TAIL_DELAY = 0.05, TAIL_T = 0.34;
/** Its whole life (s), and how far it drifts outward over it (× its radius). */
const LIFE = TAIL_DELAY + TAIL_T + 0.02, DRIFT = 0.08;

// ── its look ────────────────────────────────────────────────────────
/**
 * Its shape: a tornado stripe, taken whole off the tornado (stripeShape.ts:
 * the coat's own stripe field, its separate stripes found, a long one picked
 * at random for each arc), its outline traced along its length and laid along
 * the slash — its jagged edges the stripe's own, one piece along its length.
 */
/** Its cel bands, nested inside its outline, from its edge (0) in to its middle line (1): inked to INK_W, its outline colour to LINE_W, its fill to FILL_W, then its white-hot core. */
const STRIPE_INK_W = 0.1, STRIPE_LINE_W = 0.34, STRIPE_FILL_W = 0.8;
/** The band it is drawn in: this much wider than a plain crescent, the jagged oval filling it. */
const STRIPE_ROOM = 1.6;
/**
 * Its volume: two sheets bowed apart across the swing's plane, meeting at its
 * edges (a blade's lens-shaped section), THICK × its width at its fullest; lit
 * by the scene's key light (LIGHT) in cel steps — its shadowed side a band
 * darker (below SHADE), its lit top catching a white highlight (above GLINT).
 */
const THICK = 0.32, SHADE = 0.15, GLINT = 0.78;
/** With volume (its two bowed sheets, lit), or flat: one sheet, its cel bands alone. */
const VOLUME = false;
const LIGHT = [0.3, 0.8, -0.5];
/** Its glow: this much wider than the crescent, this strong at its brightest (added light). */
const GLOW_WIDE = 1.9, GLOW_GAIN = 0.45;

// ── sparks ──────────────────────────────────────────────────────────
/** Off the contact point as the head tears through: how many (per arc), how fast (× H per s), how long they live (s). */
const SPARKS = 18, SPARK_SPEED: [number, number] = [2.2, 4.6], SPARK_LIFE: [number, number] = [0.25, 0.5];

// ── shaders ─────────────────────────────────────────────────────────
// One arc as a strip: uv.x along it (its start before contact to its end
// after), uv.y across it (0 its inner edge, 1 its rim). Its crescent spans
// only between the tail and the head: fullest between them, tapering alike to
// a point at each.
const PROFILE = /* glsl */ `
float profile(float s) {
  // (s: 0 at the tail, 1 at the head.) The room its stripe is drawn in: full
  // nearly all along, eased off only at the very ends — the stripe's own
  // outline (its tips included) is the slash's shape.
  float k = clamp(s, 0.0, 1.0);
  return pow(4.0 * k * (1.0 - k), 0.2);
}`;

Effect.ShadersStore.slashArcVertexShader = /* glsl */ `
precision highp float;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 centre, ax, ay, across, toward;
uniform float H, radius, width, off, head, tail, drift, wide, sheet;
varying float vS, vV, vU;
varying vec3 vN;
${PROFILE}
void main(void) {
  float phi = mix(${(-BEFORE).toFixed(3)}, ${AFTER.toFixed(3)}, uv.x);
  float s = (uv.x - tail) / max(head - tail, 1e-4);
  float w = width * ${STRIPE_ROOM.toFixed(2)} * profile(s) * H;
  float R = radius * H * (1.0 + drift);
  vec3 radial = cos(phi) * ax + sin(phi) * ay;
  // Its path: the arc in the swing's plane (its rim's line), a claw's arcs side by side across it.
  vec3 rimAt = centre + R * radial + across * off * H;
  // Its flat face turned toward the striker: its width laid across the path,
  // square to the way back to the striker (and toward the arc's inside).
  vec3 tang = -sin(phi) * ax + cos(phi) * ay;
  vec3 wd = normalize(cross(tang, normalize(toward - rimAt)));
  if (dot(wd, radial) > 0.0) wd = -wd;
  vec3 face = normalize(cross(wd, tang));
  // (Its rim on the path; inward by its width. The glow reaches out past the rim too.)
  float k = wide > 1.0 ? -(uv.y - 0.5) * wide : 1.0 - uv.y;
  // Its volume: this sheet bowed out from its face (sheet: +1 or -1), the two meeting at its edges.
  float bulge = ${(VOLUME ? THICK : 0).toFixed(2)} * w * sin(3.14159265 * uv.y);
  vec3 p = rimAt + wd * k * w + face * sheet * bulge;
  // (Its surface's normal: its face, leaning toward its rim or its inner edge as the bow falls away.)
  float slope = ${THICK.toFixed(2)} * 3.14159265 * cos(3.14159265 * uv.y);
  vN = normalize(face * sheet + wd * sheet * slope);
  vS = s; vV = uv.y; vU = uv.x;
  gl_Position = viewProjection * vec4(p, 1.0);
}`;

Effect.ShadersStore.slashArcFragmentShader = /* glsl */ `
precision highp float;
varying float vS, vV, vU;
uniform vec3 rim, fill, line;
uniform float age, glow;
uniform float sTop[${STRIPE_SLICES}], sBot[${STRIPE_SLICES}];
varying vec3 vN;
void main(void) {
  if (vS < 0.0 || vS > 1.0) discard;
  if (glow > 0.5) {
    // Its light: soft, strongest along its middle, fading with it.
    float a = (1.0 - abs(vV - 0.5) * 2.0) * ${GLOW_GAIN.toFixed(2)} * clamp(vS * 1.5, 0.0, 1.0) * (1.0 - age);
    if (a < 0.01) discard;
    gl_FragColor = vec4(fill * a, a);
    return;
  }
  // Its shape: a tornado stripe, taken whole off the tornado (stripeShape.ts):
  // its top and bottom edge in each slice along it, pinned along the arc (its
  // whole sweep) — so it holds still while the head reveals it and the tail
  // takes it away, never stretching or squirming; one piece along its length,
  // its edges the stripe's own.
  float x = clamp(vU, 0.0, 1.0) * ${(STRIPE_SLICES - 1).toFixed(1)};
  int i0 = int(floor(x));
  int i1 = min(i0 + 1, ${STRIPE_SLICES - 1});
  float fr = x - float(i0);
  float top = mix(sTop[i0], sTop[i1], fr), bot = mix(sBot[i0], sBot[i1], fr);
  float y = (vV - 0.5) * 2.0;
  if (y > top || y < bot) discard;
  // Cel bands, as the tornado's, nested inside its outline: inked at its edge,
  // its outline colour, its fill, its white-hot core along its middle.
  // (Lit by the key light in cel steps when it has volume — a band darker on
  // its shadowed side, a white glint on its lit top.)
  float inward = min(top - y, y - bot) / max(0.5 * (top - bot), 1e-3);
  float band = inward < ${STRIPE_INK_W.toFixed(2)} ? 0.0 : inward < ${STRIPE_LINE_W.toFixed(2)} ? 1.0 : inward < ${STRIPE_FILL_W.toFixed(2)} ? 2.0 : 3.0;
  float lit = dot(normalize(vN), normalize(vec3(${LIGHT.map((x) => x.toFixed(2)).join(', ')})));
  if (${VOLUME ? 'true' : 'false'} && band > 0.5 && lit < ${SHADE.toFixed(2)}) band -= 1.0;
  vec3 c = band < 0.5 ? line * 0.3 : band < 1.5 ? line : band < 2.5 ? fill : rim;
  if (${VOLUME ? 'true' : 'false'} && band > 1.5 && lit > ${GLINT.toFixed(2)}) c = vec3(1.0);
  gl_FragColor = vec4(c, 1.0);
}`;

// ── colours ─────────────────────────────────────────────────────────
interface SlashColours { rim: RGB; fill: RGB; line: RGB }

/** A slash in its type's aura colours (auraPalette.auraGlow): a white-hot rim over the aura's fill, its outline colour inside. */
function coloursFor(element: string): SlashColours {
  const [, , line, fill] = auraGlow(element);
  const rim = fill.map((x) => 0.25 * x + 0.75) as RGB;
  return { rim, fill, line };
}

// ── API ─────────────────────────────────────────────────────────────
export interface ClawShot {
  /** The type whose colours it wears. */
  element: string;
  /** The striker's height (H): the slash is sized to it. */
  height: number;
  /** 3: a claw's rake (the default); 1: a blade's single, wider cut. */
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
  /** What it struck: where it stands, and its height (the slash tears through its near side). */
  target?(): { at: Vector3; height: number } | null;
}

interface Part { mesh: Mesh; mat: ShaderMaterial; reach: number }

const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInOut = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

export class SlashFx {
  constructor(private readonly scene: Scene, private readonly camera: Camera) {}

  /** A follow-through slash (a claw's three arcs, a blade's one) from a blow landing now; resolves when it and its sparks have gone. */
  claw(shot: ClawShot): Promise<void> {
    const scene = this.scene;
    const col = coloursFor(shot.element);
    const H = shot.height;
    const marks = shot.marks ?? 3;
    const parts: Part[] = [];
    const arc = (name: string, off: number, reach: number, width: number, glow: boolean, stripe: Stripe, sheet = 1) => {
      const mesh = MeshBuilder.CreateGround(name, { width: 1, height: 1, subdivisions: 64 }, scene);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // placed in its shader
      const mat = new ShaderMaterial(`${name}Mat`, scene, { vertex: 'slashArc', fragment: 'slashArc' }, {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'centre', 'ax', 'ay', 'across', 'toward', 'H', 'radius', 'width', 'off', 'head', 'tail', 'drift', 'wide',
          'rim', 'fill', 'line', 'age', 'glow', 'sTop', 'sBot', 'sheet'],
        needAlphaBlending: glow,
      });
      mat.backFaceCulling = false;
      // (Its sheets solid, sorted by depth between themselves; its glow added over, not hiding them.)
      mat.disableDepthWrite = glow;
      mat.alphaMode = glow ? Constants.ALPHA_ONEONE : Constants.ALPHA_DISABLE;
      mat.setFloat('H', H);
      mat.setFloat('width', width);
      mat.setFloat('off', off);
      mat.setFloat('wide', glow ? GLOW_WIDE : 1);
      mat.setFloat('glow', glow ? 1 : 0);
      // (Its stripe: its own, off the tornado.)
      mat.setFloats('sTop', Array.from(stripe.top));
      mat.setFloats('sBot', Array.from(stripe.bottom));
      // (Which of its two sheets: bowed out one way across the plane or the other.)
      mat.setFloat('sheet', glow ? 0 : sheet);
      mat.setColor3('rim', new Color3(...col.rim));
      mat.setColor3('fill', new Color3(...col.fill));
      mat.setColor3('line', new Color3(...col.line));
      mesh.material = mat;
      mesh.alphaIndex = glow ? 19 : 20;
      parts.push({ mesh, mat, reach });
    };
    // A claw's rake (the middle reaching furthest) or a blade's one wide cut: each over its own glow.
    const rake: { off: number; reach: number }[] = marks === 1 ? [{ off: 0, reach: 1 }]
      : [-1, 0, 1].map((k) => ({ off: k * GAP, reach: k === 0 ? 1 : OUTER_REACH }));
    const width = marks === 1 ? BLADE_WIDTH : WIDTH;
    rake.forEach(({ off, reach }, i) => {
      // (Each arc a stripe of its own, off the tornado.)
      const stripe = randomStripe();
      arc(`slashGlow${i}`, off, reach, width, true, stripe);
      // (Its two sheets, bowed apart: its volume.)
      arc(`slashArc${i}`, off, reach, width, false, stripe, 1);
      if (VOLUME) arc(`slashArcB${i}`, off, reach, width, false, stripe, -1);
    });

    const sparks = new GlowSparks(scene, this.camera, SPARKS * rake.length + 8, {
      size: 0.014 * H, lengthPerSpeed: 0.035, tint: col.fill, tintMix: 0.7, gravity: 2.5 * H, drag: 2.2,
      turbulence: 0.6 * H, splitChance: 0.25, splitCount: 2, secondary: col.rim, intensity: 1.3,
    });

    // The swing's direction in the striker's front (x: its right, y: up).
    const [sx, sy] = (() => {
      const s = shot.swing;
      const n = s ? Math.hypot(s[0], s[1]) : 0;
      return s && n > 1e-6 ? [s[0] / n, s[1] / n] : [-shot.side * Math.SQRT1_2, -Math.SQRT1_2]; // the left hand's: right and down
    })();
    const t0 = performance.now();
    let last = t0, struck = false;
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
        // Contact at the near side of what was struck, clear of the striker.
        let ahead = AT_AHEAD * H, up = AT_UP * H;
        const tgt = shot.target?.();
        if (tgt) {
          const d = tgt.at.subtract(feet);
          d.y = 0;
          ahead = Math.max(MIN_AHEAD * H, d.length() - TARGET_BODY * tgt.height);
          up = TARGET_UP * tgt.height;
        }
        const contact = feet.add(new Vector3(0, up, 0)).add(fwd.scale(ahead));
        // The swing's plane: forward (out to the contact) and the swing's way; its centre back toward the shoulder.
        const dir = right.scale(sx).add(Vector3.Up().scale(sy)).normalize();
        const across = Vector3.Cross(fwd, dir).normalize();
        const R = Math.min(RADIUS, ahead / H);
        const centre = contact.subtract(fwd.scale(R * H));
        // (Its flat face turned toward the striker's chest.)
        const toward = feet.add(new Vector3(0, 0.55 * H, 0));
        // The head sweeps out fast and slows (the follow-through); the tail catches it up.
        const head = easeOutCubic(t / HEAD_T);
        const tail = easeInOut((t - TAIL_DELAY) / TAIL_T);
        const age = Math.min(1, t / LIFE);
        for (const { mesh, mat, reach } of parts) {
          mat.setVector3('centre', centre);
          mat.setVector3('ax', fwd);
          mat.setVector3('ay', dir);
          mat.setVector3('across', across);
          mat.setVector3('toward', toward);
          mat.setFloat('radius', R * reach);
          mat.setFloat('head', head);
          mat.setFloat('tail', tail);
          mat.setFloat('drift', DRIFT * easeInOut(age));
          mat.setFloat('age', age);
          mesh.setEnabled(t < LIFE && head > tail + 1e-3);
        }
        // Contact: as the head tears through, sparks off the point it hit — out along the swing, and back off the target.
        if (!struck && head >= CONTACT) {
          struck = true;
          for (const { off, reach } of rake) {
            const at = centre.add(fwd.scale(R * reach * H)).add(across.scale(off * H));
            for (let n = 0; n < SPARKS; n++) {
              const th = Math.random() * Math.PI * 2;
              const out = dir.scale(0.9 + Math.random() * 0.6).add(across.scale(Math.cos(th) * 0.6)).add(fwd.scale(Math.sin(th) * 0.4 - 0.2));
              const speed = (SPARK_SPEED[0] + Math.random() * (SPARK_SPEED[1] - SPARK_SPEED[0])) * H;
              sparks.spawn(at, out.normalize().scale(speed), SPARK_LIFE[0] + Math.random() * (SPARK_LIFE[1] - SPARK_LIFE[0]));
            }
          }
        }
        sparks.update(dt);
        if (t >= LIFE + SPARK_LIFE[1] + 0.1) {
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
