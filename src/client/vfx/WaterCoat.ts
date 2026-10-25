/**
 * A coat of water over a Pokémon's whole body (Aqua Jet): a shell of the
 * body's own meshes, puffed out along their normals and skinned to the same
 * skeleton (so it moves with every pose), shaded as P_Malin's "Spout" shades
 * its water — ripples running down it, the sky reflected off it by Fresnel,
 * the sun's glint on its crests, and what shows through it soaked blue (the
 * water drinks red first). It rises from the feet as it comes up and fades
 * as it goes.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { RGB } from './auraPalette.ts';
import { NOISE, coloursFor } from './beam/BeamFx.ts';
import { XOR_FIRE } from './xorFire.ts';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Bone } from '@babylonjs/core/Bones/bone';

/** Only part of the body coated: a bone and all below it (a hand), or vertex flags per mesh (a blade, a fist's verts). */
export type CoatPart = { bone: string } | { flags: Map<AbstractMesh, Float32Array> };

/** How far the water stands off the skin (share of the model's height). */
const COAT_THICK = 0.07;
/** Ripples: how many across the body, and how fast they run down it (body heights/s). */
const COAT_FREQ = 26.0, COAT_RUN = 0.55;
/** How hard the ripples bend the surface (its normal). */
const COAT_BUMP = 0.85;
/** The vortex: how fast the water swirls round the body (rad/s), and how much it winds as it runs down (rad per body height). */
const COAT_SPIN = 1.6, COAT_TWIST = 5.0;
/**
 * A vortex (WaterSkin's `vortex`: a disc of water, a shuriken): its pattern
 * laid out round its centre in its own plane — how tightly its arms wind
 * (radians per e-fold in toward the middle), how wide round it reads, how
 * stretched along the way in, and how fast it drains in toward the centre.
 */
const VORTEX_WIND = 2.2, VORTEX_ROUND = 1.0, VORTEX_IN = 1.1, VORTEX_DRAIN = 0.55;
/** How much of what is behind still shows through where the water faces you (0..1). */
const COAT_CLEAR = 0.6;
/** How deep the water reads (its blue extinction). */
const COAT_DEPTH = 1.4;
/**
 * Cel shaded (WaterSkin's `cel`): past how much edge-on its silhouette is
 * inked, and how dark (× its dark); past how much it is the deeper blue, and
 * how deep (× its blue); how high a ripple's crest goes white; how solid.
 */
const CEL_INK = 0.72, CEL_INK_DARK = 0.4, CEL_EDGE = 0.42, CEL_DEEP = 0.62, CEL_CREST = 0.66, CEL_ALPHA = 0.88;
/** Rising up the body, and fading away (s). */
const COAT_RISE = 0.35, COAT_FADE = 0.4;
/** Let go, it drops off the body: drained from the top down to the feet in this long (s), fading as it goes. */
const COAT_DROP = 0.3;
/** Let go, a coat of noise alone (a fire aura's): it fades out smoothly over this long (s), still bursting as it goes. */
const NOISE_FADE = 0.7;
/** Burst off on a hit (Aqua Jet): it swells this much more of the model's height off the skin as it tears apart, over SWELL_TIME s. */
const SWELL_GROW = 0.22, SWELL_TIME = 0.35;
/**
 * A little of the Water beam's heavy noise over it (BeamFx: its torn dark
 * skin): how sparse (its dissolve cutoff: higher, less of it), how coarse
 * (per body height), how fast it runs down the body, and how solid it lies.
 */
const SKIN_CUT = 0.66, SKIN_SCALE = 5.0, SKIN_PAN = 1.4, SKIN_ALPHA = 0.85;
/**
 * The heavy noise bursting out of the coat: a shell of it alone swelling off
 * the water (BURST_GROW more of the model's height off the skin at its
 * widest) as it tears away to nothing, over BURST_TIME s, every BURST_EVERY s
 * while the coat is up. Its tear starts at BURST_CUT and dissolves to BURST_END.
 */
/**
 * And a little of its light noise (the beam's bright layer: its body colour
 * posterized up to the hot core): how sparse on the coat and in the burst,
 * how coarse, how fast it runs, how solid.
 */
const LIGHT_CUT = 0.7, LIGHT_BURST_CUT = 0.66, LIGHT_SCALE = 7.0, LIGHT_PAN = 2.2, LIGHT_ALPHA = 0.6;
const BURST_GROW = 0.16, BURST_TIME = 0.55, BURST_EVERY = 1.1, BURST_CUT = 0.58, BURST_END = 0.9;
/** How a coat's noise bursts (the defaults above: the Water coat's). */
export interface BurstStyle {
  grow: number; time: number; every: number; cut: number;
  /**
   * Bursts under way at once: more than one, and they follow each other with
   * no gap (each starting `time / layers` after the last; `every` unused).
   */
  layers?: number;
  /** The noise glows: a hot rim on its torn edges and a soft glow round them, fully solid. */
  glow?: boolean;
  /** Left bare: this bone and all below it (the face: 'head'). */
  spare?: string;
  /** Bursting from this far off the skin (share of the height: out at the aura's outline). */
  base?: number;
  /** Rising this far as it goes (share of the height): it bursts upward. */
  lift?: number;
  /** How solid it lies (× the noise's own; default 1). */
  alpha?: number;
  /** Its noise's colours pushed toward red (0 .. 1). */
  redden?: number;
  /**
   * As bright as the aura it rises off (0 .. 1): each of its colours kept in
   * its own hue, raised to full brightness.
   */
  bright?: number;
  /**
   * In the outer tornado's strands (WindFx's shell) rather than the beam's
   * noise: streaks winding up round the body's upright axis, torn away as
   * each burst ages — behaving just as the noise does.
   */
  strands?: boolean;
  /** A second colour set, its noise's colours mixed this far toward this colour: the noise in patches of the two. */
  toward?: { color: RGB; amount: number };
}
/**
 * Strand noise (BurstStyle.strands), after the outer tornado's shell: how
 * tall its frame stands on the body (× the body's height: the tornado's 3.4
 * units), how far its streaks wind round per unit up, how fast they turn and
 * rise, where its heavy streaks and its light ones start (its value past
 * this), and where a burst's are torn away to by its end.
 */
const STRAND_SPAN = 3.4, STRAND_TWIST = 2.5, STRAND_SPIN = 1.8, STRAND_RISE = 2.0;
const STRAND_CUT = 0.45, STRAND_LIGHT_CUT = 0.5, STRAND_END = 0.8;
const WATER_BURSTS: BurstStyle = { grow: BURST_GROW, time: BURST_TIME, every: BURST_EVERY, cut: BURST_CUT };
/** A fire's (Flame Charge): continuous — three at once, staggered, fast, far out and heavy. */
/**
 * A fire's (Flame Charge): from the aura's outline, rising — bursts of the
 * Fire beam's own noise going up off the outline, two at a time staggered
 * (one rising as the last tears away), over the face as well.
 */
export const FIRE_BURSTS: BurstStyle = { grow: 0.08, base: 0.2, lift: 0.6, time: 0.6, every: 0.6, cut: 0.42, layers: 2, alpha: 0.75, redden: 0.7, bright: 1, strands: true };
/** Blue flames' noise (Mega Charizard X): in patches of its own deep blue and a lighter blue (this far toward light blue). */
export const BLUE_FIRE_TOWARD = { color: [0.55, 0.85, 1.0] as RGB, amount: 0.55 };
/** Two colour sets' patches: how many across the body. */
const PATCH_SCALE = 3.2;
/** A glowing burst's halo: how far off a torn edge it reaches (in noise), and how strong. */
const GLOW_W = 0.09, GLOW_A = 0.75;
/** The face kept clear: × the head's own reach, at least this share of the model's height. */
const SPARE_REACH = 1.15, SPARE_MIN = 0.12;
/** The noise coming in: over this long once the coat is up (s), and each burst over this share of its life. */
const BURST_RAMP = 0.8, BURST_FADE_IN = 0.2;
/** A rising burst: how edge-on the shell must be seen to burst there (0 facing you .. 1 edge on): the outline. */
const RISE_RIM = 0.35;

class WaterSkin extends MaterialPluginBase {
  private readonly start = performance.now();
  rise = 0;
  /** The top of the body (its own units, unposed): the rise goes past it. */
  top = 1;
  fade = 1;
  /** A burst shell's progress (0..1), or -1: the coat itself. */
  burst = -1;
  /** Bursting off (0..1): swelling out as it tears apart. */
  swell = 0;
  /** Its bursts' reach and tear (BurstStyle). */
  grow = BURST_GROW;
  /** Where its bursts start off the skin, and how far they rise (shares of the height: BurstStyle). */
  base = 0;
  /** How solid its bursts lie (× their noise's own: BurstStyle.alpha). */
  alpha = 1;
  lift = 0;
  cut = BURST_CUT;
  /** Drawn into the auras' mask only (an overlay over the aura: wsMask). */
  maskOnly = false;
  /** Its noise glows (BurstStyle.glow). */
  glow = false;
  /** As bright as its aura (BurstStyle.bright). */
  bright = 0;
  /** In the outer tornado's strands (BurstStyle.strands). */
  strands = false;
  /** Cel shaded (the coat): flat bands of its blues, white crests, inked round its silhouette — as the inked fire sphere. */
  cel = false;
  /** How thick it stands off the skin (× COAT_THICK of its size): its ripples keep its size, so a thin coat flows as calmly as a thick one. */
  thick = 1;
  /** Swirling in toward a centre in its own plane (a disc's), instead of running down the body: its centre and its axis, in its own unposed space. */
  vortex: { centre: [number, number, number]; axis: [number, number, number] } | null = null;
  /** The coat is fire (xorFire), not water: its tone (xfTone), and drawn into the auras' mask only. */
  fire = false;
  fireTone = 0;
  /** Kept clear (the face): a sphere in the unposed body, xyz r (r 0: none). */
  spare: [number, number, number, number] = [0, 0, 0, 0];
  private readonly col: ReturnType<typeof coloursFor>;
  private readonly dark: RGB;
  private readonly alt: { dark: RGB; main: RGB; hot: RGB };
  private readonly patch: boolean;
  /** `element`: whose beam's noise it wears (its heavy and light noise's colours). */
  /** `redden`: its noise's colours pushed toward red (0 none .. 1 all red: BurstStyle.redden). */
  /** `toward`: its noise's colours mixed this far toward a colour (BurstStyle.toward). */
  /**
   * `aura`: the aura's own colours (display RGB) to wear instead of its beam's
   * — its heavy noise in the aura's fill, its light noise's hot specks in its
   * line — exactly as the aura shows them (no reddening).
   */
  constructor(material: Material, private readonly size: number, private readonly tint: RGB, element = 'Water', redden = 0,
    toward?: { color: RGB; amount: number }, aura?: { fill: RGB; line: RGB }) {
    super(material, 'WaterSkin', 215, { WATERSKIN: false });
    const c = coloursFor(element);
    const red = (x: RGB): RGB => [x[0], x[1] * (1 - 0.55 * redden), x[2] * (1 - 0.7 * redden)];
    // (Display colours to linear: drawn after tone mapping, they are given back
    // the scene's gamma — so they land on screen exactly as the aura's.)
    const lin = (x: RGB): RGB => x.map((v) => Math.pow(v, 2.2)) as RGB;
    this.col = aura ? { ...c, dark: lin(aura.fill), main: lin(aura.fill), hot: lin(aura.line) }
      : redden > 0 ? { ...c, dark: red(c.dark), main: red(c.main), hot: red(c.hot) } : c;
    // A second set, toward the other colour: its noise in patches of the one
    // and of the other (some of it the darker blue, some the lighter).
    const to = (x: RGB): RGB => (toward ? x.map((v, i) => v + (toward.color[i] - v) * toward.amount) as RGB : x);
    this.alt = { dark: to(this.col.dark), main: to(this.col.main), hot: to(this.col.hot) };
    this.patch = !!toward;
    this.dark = this.col.dark;
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName(): string { return 'WaterSkin'; }
  prepareDefines(defines: Record<string, unknown>): void { defines.WATERSKIN = true; }
  getUniforms() {
    return {
      ubo: [
        { name: 'wsTime', size: 1, type: 'float' }, { name: 'wsSize', size: 1, type: 'float' }, { name: 'wsThick', size: 1, type: 'float' },
        { name: 'wsRise', size: 1, type: 'float' }, { name: 'wsFade', size: 1, type: 'float' },
        { name: 'wsTint', size: 3, type: 'vec3' }, { name: 'wsTop', size: 1, type: 'float' }, { name: 'wsDark', size: 3, type: 'vec3' },
        { name: 'wsBurst', size: 1, type: 'float' }, { name: 'wsSwell', size: 1, type: 'float' },
        { name: 'wsGrow', size: 1, type: 'float' }, { name: 'wsCut', size: 1, type: 'float' }, { name: 'wsMask', size: 1, type: 'float' }, { name: 'wsGlow', size: 1, type: 'float' }, { name: 'wsSpare', size: 4, type: 'vec4' },
        { name: 'wsBase', size: 1, type: 'float' }, { name: 'wsAlpha', size: 1, type: 'float' }, { name: 'wsLift', size: 1, type: 'float' }, { name: 'wsBright', size: 1, type: 'float' }, { name: 'wsStrands', size: 1, type: 'float' }, { name: 'wsCel', size: 1, type: 'float' }, { name: 'wsFire', size: 1, type: 'float' }, { name: 'wsFireTone', size: 1, type: 'float' },
        { name: 'wsMain', size: 3, type: 'vec3' }, { name: 'wsHot', size: 3, type: 'vec3' },
        { name: 'wsDark2', size: 3, type: 'vec3' }, { name: 'wsMain2', size: 3, type: 'vec3' }, { name: 'wsHot2', size: 3, type: 'vec3' }, { name: 'wsPatch', size: 1, type: 'float' },
        { name: 'wsVortex', size: 4, type: 'vec4' }, { name: 'wsVAxis', size: 3, type: 'vec3' },
      ],
      vertex: `#ifdef WATERSKIN
        uniform float wsSize; uniform float wsBurst; uniform float wsSwell; uniform float wsGrow; uniform float wsBase; uniform float wsLift;
      #endif`,
      fragment: `#ifdef WATERSKIN
        uniform float wsTime; uniform float wsSize; uniform float wsThick; uniform float wsRise; uniform float wsFade; uniform vec3 wsTint; uniform float wsTop; uniform vec3 wsDark; uniform float wsBurst; uniform float wsSwell; uniform float wsGrow; uniform float wsCut; uniform float wsMask; uniform float wsGlow; uniform vec4 wsSpare; uniform float wsAlpha; uniform float wsBright; uniform float wsStrands; uniform float wsCel; uniform float wsFire; uniform float wsFireTone; uniform vec3 wsMain; uniform vec3 wsHot; uniform vec3 wsDark2; uniform vec3 wsMain2; uniform vec3 wsHot2; uniform float wsPatch; uniform vec4 wsVortex; uniform vec3 wsVAxis;
      #endif`,
    };
  }
  private bindAll(ubo: UniformBuffer): void {
    ubo.updateFloat('wsTime', (performance.now() - this.start) / 1000);
    ubo.updateFloat('wsSize', this.size);
    ubo.updateFloat('wsThick', this.thick);
    const v = this.vortex;
    ubo.updateFloat4('wsVortex', v ? v.centre[0] : 0, v ? v.centre[1] : 0, v ? v.centre[2] : 0, v ? 1 : 0);
    ubo.updateFloat3('wsVAxis', v ? v.axis[0] : 0, v ? v.axis[1] : 1, v ? v.axis[2] : 0);
    ubo.updateFloat('wsRise', this.rise);
    ubo.updateFloat('wsFade', this.fade);
    ubo.updateFloat3('wsTint', ...this.tint);
    ubo.updateFloat('wsTop', this.top);
    ubo.updateFloat3('wsDark', ...this.dark);
    ubo.updateFloat('wsBurst', this.burst);
    ubo.updateFloat('wsSwell', this.swell);
    ubo.updateFloat('wsGrow', this.grow);
    ubo.updateFloat('wsBase', this.base);
    ubo.updateFloat('wsAlpha', this.alpha);
    ubo.updateFloat('wsBright', this.bright);
    ubo.updateFloat('wsStrands', this.strands ? 1 : 0);
    ubo.updateFloat('wsCel', this.cel ? 1 : 0);
    ubo.updateFloat('wsFire', this.fire ? 1 : 0);
    ubo.updateFloat('wsFireTone', this.fireTone);
    ubo.updateFloat('wsLift', this.lift);
    ubo.updateFloat('wsCut', this.cut);
    ubo.updateFloat('wsMask', this.maskOnly ? 1 : 0);
    ubo.updateFloat('wsGlow', this.glow ? 1 : 0);
    ubo.updateFloat4('wsSpare', ...this.spare);
    ubo.updateFloat3('wsMain', ...this.col.main);
    ubo.updateFloat3('wsHot', ...this.col.hot);
    ubo.updateFloat3('wsDark2', ...this.alt.dark);
    ubo.updateFloat3('wsMain2', ...this.alt.main);
    ubo.updateFloat3('wsHot2', ...this.alt.hot);
    ubo.updateFloat('wsPatch', this.patch ? 1 : 0);
  }
  bindForSubMesh(ubo: UniformBuffer): void { this.bindAll(ubo); }
  hardBindForSubMesh(ubo: UniformBuffer): void { this.bindAll(ubo); }
  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef WATERSKIN
          varying vec3 wsLocal;
        #endif`,
        // Puffed out off the skin, before skinning: it keeps to the body in every pose.
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef WATERSKIN
          // (A burst shell swells on out, fast at first.)
          float wsOut = ${COAT_THICK.toFixed(3)} * wsThick + (wsBurst >= 0.0 ? wsBase + wsGrow * (1.0 - (1.0 - wsBurst) * (1.0 - wsBurst)) : 0.0);

          // (Bursting off on a hit: it swells on out, fast at first.)
          wsOut += ${SWELL_GROW.toFixed(3)} * (1.0 - (1.0 - wsSwell) * (1.0 - wsSwell));
          positionUpdated += normalize(normal) * wsSize * wsOut;
        #endif`,
        // A rising burst goes on straight up as it swells, faster and faster
        // (flames off the outline): in the world, whatever its bone's turn.
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WATERSKIN
          if (wsBurst >= 0.0) worldPos.y += wsLift * wsSize * length(world[1].xyz) * pow(wsBurst, 1.4);
        #endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef WATERSKIN
          wsLocal = position;
        #endif`,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef WATERSKIN
        varying vec3 wsLocal;
        ${NOISE}
        ${XOR_FIRE}
        // Spout's ripple: sums of sines, 0..1.
        float wsNoise(vec2 p) { vec2 s = sin(p * 0.6345) + sin(p * 1.62423); return dot(s, vec2(0.125)) + 0.5; }
        // A vortex's place for the patterns: round its centre in its plane, in
        // spiral arms winding in, and draining in toward it as time runs (a
        // log of the radius, so it flows in for ever without a seam).
        vec3 wsVortexQ(vec3 p, float size, float t) {
          vec3 n = normalize(wsVAxis);
          vec3 d = p - wsVortex.xyz;
          vec3 f = d - n * dot(d, n);
          vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 e2 = cross(n, e1);
          float r = max(length(f) / max(size, 1e-3), 1e-3);
          float l = log(r);
          float a = atan(dot(f, e2), dot(f, e1)) + l * ${VORTEX_WIND.toFixed(2)};
          return vec3(cos(a) * ${VORTEX_ROUND.toFixed(2)}, sin(a) * ${VORTEX_ROUND.toFixed(2)}, l * ${VORTEX_IN.toFixed(2)} + t * ${VORTEX_DRAIN.toFixed(2)});
        }
        // Three sheets running down the body at different angles and speeds,
        // swirled round it as a vortex about its upright axis, winding
        // tighter as they run down.
        float wsRipple(vec3 q, float t) {
          float ang = t * ${COAT_SPIN.toFixed(2)} + q.y * ${COAT_TWIST.toFixed(2)};
          float cs = cos(ang), sn = sin(ang);
          vec3 r = vec3(cs * q.x - sn * q.z, q.y, sn * q.x + cs * q.z);
          vec2 a = vec2(r.x + 0.7 * r.z, q.y + t * ${COAT_RUN.toFixed(2)}) * ${COAT_FREQ.toFixed(1)};
          vec2 b = vec2(r.z - 0.6 * r.x, 1.3 * q.y + t * ${(COAT_RUN * 1.6).toFixed(2)}) * ${(COAT_FREQ * 1.4).toFixed(1)};
          vec2 c = vec2(0.5 * r.x - r.z, 0.8 * q.y - t * ${(COAT_RUN * 0.7).toFixed(2)}) * ${(COAT_FREQ * 2.3).toFixed(1)};
          return 0.5 * wsNoise(a) + 0.32 * wsNoise(b) + 0.18 * wsNoise(c);
        }
        // The beam's light noise at q: its weight (0: none) past \`cut\`, and how hot (0 body .. 1 core).
        float wsLightN(vec3 q, float t) {
          vec3 k = q * ${LIGHT_SCALE.toFixed(1)} + vec3(3.1, t * ${LIGHT_PAN.toFixed(2)}, t * 0.5 + 7.7);
          vec3 w = vec3(vn(k * 0.55 + vec3(2.3, 4.0, 0.0)), vn(k * 0.55 + vec3(6.7, 1.1, 0.0)), 0.0) - 0.5;
          k += vec3(w.x * 2.0, w.y * 1.0, 0.0);
          return fbm(k);
        }
        // The outer tornado's strands (WindFx's shell): a cell field laid out
        // round the body's upright axis (angle, height), sheared so its
        // streaks wind up round it, drifting up as it turns. 0 .. about 0.6,
        // the streaks where it is high.
        vec2 wsH2(vec2 p) {
          p = mod(p, 4.0);
          return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
        }
        float wsCell(vec2 x, float t) {
          vec2 n = floor(x), f = fract(x);
          float md = 5.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = 0.5 + 0.5 * sin(t + 6.2831 * wsH2(n + g));
            vec2 r = g + o - f;
            md = min(md, dot(r, r));
          }
          return md;
        }
        float wsStrand(vec3 q, float t, float dens, float off) {
          float ang = atan(q.x, q.z);
          float y = q.y * ${STRAND_SPAN.toFixed(2)};
          vec2 c = vec2(ang - y * ${STRAND_TWIST.toFixed(2)} - t * ${STRAND_SPIN.toFixed(2)}, y - t * ${STRAND_RISE.toFixed(2)}) * (4.0 * dens / 6.2831) + vec2(off, off * 0.6);
          return pow(wsCell(c, t * 0.1), 0.75);
        }
        vec2 wsLight(vec3 q, float t, float cut) {
          float n = wsLightN(q, t);
          if (n < cut) return vec2(0.0);
          float h = clamp((n - cut) / max(1.0 - cut, 1e-3), 0.0, 1.0);
          return vec2(1.0, h > 0.45 ? 1.0 : 0.0);
        }
        vec3 wsSky(vec3 d) { vec3 top = vec3(0.7, 0.8, 1.0); return mix(top * 0.5, top, clamp(d.y, 0.0, 1.0)); }
      #endif`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef WATERSKIN
        {
          vec3 q = wsVortex.w > 0.5 ? wsVortexQ(wsLocal, wsSize, wsTime) : wsLocal / max(wsSize, 1e-3);
          // Rising from the feet to past the top of the body (the spikes too):
          // a soft front a little above the line.
          float front = wsRise * (wsTop * 1.15 + 0.1 * wsSize) - wsLocal.y;
          front /= max(wsSize, 1e-3);
          if (wsBurst >= 0.0) {
            // (Nothing over the face: its sphere kept clear.)
            if (wsSpare.w > 0.0 && length(wsLocal - wsSpare.xyz) < wsSpare.w) discard;
            // A burst: the beam's heavy noise alone, tearing away as it swells.
            vec3 k = q * ${SKIN_SCALE.toFixed(1)} + vec3(0.0, wsTime * ${SKIN_PAN.toFixed(2)}, wsTime * 0.3);
            vec3 w = vec3(vn(k * 0.55 + vec3(5.3, 0.0, 0.0)), vn(k * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
            k += vec3(w.x * 2.6, w.y * 1.3, 0.0);
            // A rising burst comes off the outline: only where the shell is
            // seen edge on (its silhouette, from wherever it is seen).
            if (wsLift > 0.0) {
              float edgeOn = 1.0 - abs(dot(normalize(vNormalW), normalize(vEyePosition.xyz - vPositionW)));
              if (edgeOn < ${RISE_RIM.toFixed(2)}) discard;
            }
            // (A rising burst holds together as it climbs and tears away near the top.)
            float kt = wsLift > 0.0 ? wsBurst * wsBurst * wsBurst : wsBurst;
            float tear = mix(wsCut, ${BURST_END.toFixed(2)}, kt);
            float life = (1.0 - (wsLift > 0.0 ? kt * wsBurst : wsBurst * wsBurst)) * wsFade * visibility * wsAlpha;
            // (Each burst fades in as it starts, not there at once.)
            life *= smoothstep(0.0, ${BURST_FADE_IN.toFixed(2)}, wsBurst);
            float hn = fbm(k);
            float ln = wsLightN(q, wsTime);
            float ltear = mix(${LIGHT_BURST_CUT.toFixed(2)}, ${BURST_END.toFixed(2)}, kt);
            // (In the outer tornado's strands: its streaks, coarse for the
            // heavy noise and finer for the light, torn away as it ages.)
            if (wsStrands > 0.5) {
              hn = wsStrand(q, wsTime, 1.0, 0.0);
              ln = wsStrand(q, wsTime, 2.0, 1.7);
              tear = mix(${STRAND_CUT.toFixed(2)}, ${STRAND_END.toFixed(2)}, kt);
              ltear = mix(${STRAND_LIGHT_CUT.toFixed(2)}, ${STRAND_END.toFixed(2)}, kt);
            }
            // (In patches of its two colour sets, where it has two: drifting up with it.)
            float pm = wsPatch * step(0.5, vn(q * ${PATCH_SCALE.toFixed(1)} + vec3(11.0, -wsTime * 0.8, 7.0)));
            vec3 cDark = mix(wsDark, wsDark2, pm), cMain = mix(wsMain, wsMain2, pm), cHot = mix(wsHot, wsHot2, pm);
            // (As bright as its aura: each colour its own hue, at full brightness.)
            cDark = mix(cDark, cDark / max(max(cDark.r, max(cDark.g, cDark.b)), 1e-3), wsBright);
            cMain = mix(cMain, cMain / max(max(cMain.r, max(cMain.g, cMain.b)), 1e-3), wsBright);
            cHot = mix(cHot, cHot / max(max(cHot.r, max(cHot.g, cHot.b)), 1e-3), wsBright);
            if (hn >= tear) {
              // The heavy tatters (glowing: a hot rim along their torn edges, solid).
              float rim = 1.0 - smoothstep(tear, tear + 0.07, hn);
              color = vec4(mix(cDark, mix(cMain, cHot, 0.5), rim * wsGlow), mix(${SKIN_ALPHA.toFixed(2)}, 1.0, wsGlow) * life);
            } else if (ln >= ltear) {
              // Between them, a little of the light noise bursting with them (glowing: brighter).
              float lh = clamp((ln - ltear) / max(1.0 - ltear, 1e-3), 0.0, 1.0);
              color = vec4(mix(cMain, cHot, lh > 0.45 ? 1.0 : 0.0), mix(${LIGHT_ALPHA.toFixed(2)}, 0.95, wsGlow) * life);
            } else {
              // Glowing: a soft glow round the tatters, fading off their torn edges.
              float halo = wsGlow * max(smoothstep(tear - ${GLOW_W.toFixed(2)}, tear, hn), smoothstep(ltear - ${GLOW_W.toFixed(2)}, ltear, ln));
              if (halo <= 0.02) discard;
              color = vec4(cMain, ${GLOW_A.toFixed(2)} * halo * halo * life);
            }
            // (Into the auras' mask: here is an overlay, drawn over the aura.)
            if (wsMask > 0.5) color = vec4(0.0, 0.0, 1.0, 1.0);
          } else if (wsFire > 0.5) {
            if (front < 0.0) discard;
            // A coat of fire (xorFire): marched a little way on into the body
            // along the view, a skin of fire over all of it.
            vec3 Vf = normalize(vEyePosition.xyz - vPositionW);
            vec4 F = xorFire(q, -Vf, wsTime);
            vec3 fc = xfTone(F.rgb, wsFireTone);
            float fa = F.a * wsFade * smoothstep(0.0, 0.06, front) * visibility;
            if (fa < 0.01) discard;
            color = vec4(fc, fa);
            // (Into the auras' mask: here is an overlay, drawn over the aura.)
            if (wsMask > 0.5) color = vec4(0.0, 0.0, 1.0, 1.0);
          } else {
          if (front < 0.0) discard;
          // Bursting off: torn apart by its heavy noise as it swells.
          if (wsSwell > 0.0) {
            float tn = fbm(q * ${(SKIN_SCALE * 0.8).toFixed(1)} + vec3(0.0, wsTime * ${SKIN_PAN.toFixed(2)}, 0.0));
            if (tn < wsSwell * 1.05 - 0.05) discard;
          }
          vec3 V = normalize(vEyePosition.xyz - vPositionW);
          vec3 N = normalize(vNormalW);
          if (dot(N, V) < 0.0) N = -N;
          // The ripples bend the surface.
          float e = 0.004;
          float n = wsRipple(q, wsTime);
          float gx = (wsRipple(q + vec3(e, 0.0, 0.0), wsTime) - n) / e;
          float gy = (wsRipple(q + vec3(0.0, e, 0.0), wsTime) - n) / e;
          vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          vec3 B = cross(T, N);
          N = normalize(N + (T * gx + B * gy) * ${(COAT_BUMP * 0.04).toFixed(4)});
          float ndv = max(dot(N, V), 0.0);
          // Spout's lighting: Schlick Fresnel off a smooth surface (R0 0.02),
          // the sky reflected, the sun's sharp glint.
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          vec3 L = normalize(vec3(0.2, 0.3, -0.5) * -1.0 + vec3(0.0, 0.6, 0.0));
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 512.0) * 64.0 + pow(max(dot(N, H), 0.0), 48.0) * 0.6;
          vec3 refl = wsSky(reflect(-V, N));
          // What comes through: soaked blue (extinction 1 - (0.3, 0.7, 0.9)),
          // deeper where the coat is seen edge on — kept to the type's blue.
          float path = 1.0 / max(ndv, 0.25);
          vec3 ext = 1.0 / (1.0 + vec3(1.4, 0.6, 0.2) * ${COAT_DEPTH.toFixed(2)} * path);
          vec3 water = mix(ext * vec3(0.55, 0.8, 1.0), wsTint, 0.55);
          vec3 c = mix(water, refl, fres) + vec3(1.0, 0.97, 0.92) * spec;
          c = 1.0 - exp2(-c * 1.5);
          float a = clamp(1.0 - ${COAT_CLEAR.toFixed(2)} * ndv + fres * 0.5 + spec, 0.0, 1.0);
          // The Water beam's heavy noise: its torn dark skin, a little of it,
          // running down the coat (warped and dissolved as the beam's is).
          {
            vec3 k = q * ${SKIN_SCALE.toFixed(1)} + vec3(0.0, wsTime * ${SKIN_PAN.toFixed(2)}, wsTime * 0.3);
            vec3 w = vec3(vn(k * 0.55 + vec3(5.3, 0.0, 0.0)), vn(k * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
            k += vec3(w.x * 2.6, w.y * 1.3, 0.0);
            float sn = fbm(k);
            if (sn > ${SKIN_CUT.toFixed(2)}) {
              c = mix(c, wsDark, ${SKIN_ALPHA.toFixed(2)});
              a = max(a, ${SKIN_ALPHA.toFixed(2)});
            } else {
              // And a little of its light noise.
              vec2 lt = wsLight(q, wsTime, ${LIGHT_CUT.toFixed(2)});
              if (lt.x > 0.0) {
                c = mix(c, mix(wsMain, wsHot, lt.y), ${LIGHT_ALPHA.toFixed(2)});
                a = max(a, ${LIGHT_ALPHA.toFixed(2)});
              }
            }
          }
          if (wsCel > 0.5) {
            // Cel shaded: flat bands, solid — inked dark round its silhouette,
            // white on its crests and glints, a deeper blue toward its edges,
            // its own blue facing you, its heavy noise in solid dark patches.
            vec3 deep = wsTint * ${CEL_DEEP.toFixed(2)}, crest = mix(wsHot, vec3(1.0), 0.6);
            vec3 k2 = q * ${SKIN_SCALE.toFixed(1)} + vec3(0.0, wsTime * ${SKIN_PAN.toFixed(2)}, wsTime * 0.3);
            vec3 w2 = vec3(vn(k2 * 0.55 + vec3(5.3, 0.0, 0.0)), vn(k2 * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
            k2 += vec3(w2.x * 2.6, w2.y * 1.3, 0.0);
            float edge = 1.0 - max(dot(normalize(vNormalW) * (dot(normalize(vNormalW), V) < 0.0 ? -1.0 : 1.0), V), 0.0);
            c = edge > ${CEL_INK.toFixed(2)} ? wsDark * ${CEL_INK_DARK.toFixed(2)}
              : spec > 0.3 || n > ${CEL_CREST.toFixed(2)} ? crest
              : fbm(k2) > ${SKIN_CUT.toFixed(2)} ? wsDark
              : edge > ${CEL_EDGE.toFixed(2)} ? deep : wsTint;
            a = ${CEL_ALPHA.toFixed(2)};
          }
          a *= wsFade * smoothstep(0.0, 0.06, front) * visibility * (1.0 - wsSwell * wsSwell);
          color = vec4(c, a);
          }
        }
      #endif`,
    };
  }
}

/**
 * The shell's own normals, smoothed: every copy of a point (split per face at
 * sharp edges — a spike's ridge, a claw's tip) takes the average of them all,
 * so puffing out along them closes over the edge instead of cracking it open.
 * Where the faces there cancel out (both sides of a thin plate), it goes out
 * away from the middle of the mesh instead.
 */
function smoothNormals(mesh: Mesh): void {
  mesh.makeGeometryUnique();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nrm) return;
  const n = pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  const key = (i: number) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const sum = new Map<string, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const s = sum.get(k) ?? [0, 0, 0];
    s[0] += nrm[i * 3]; s[1] += nrm[i * 3 + 1]; s[2] += nrm[i * 3 + 2];
    sum.set(k, s);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let [x, y, z] = sum.get(key(i))!;
    let L = Math.hypot(x, y, z);
    if (L < 0.3) { x = pos[i * 3] - cx; y = pos[i * 3 + 1] - cy; z = pos[i * 3 + 2] - cz; L = Math.hypot(x, y, z) || 1; }
    out[i * 3] = x / L; out[i * 3 + 1] = y / L; out[i * 3 + 2] = z / L;
  }
  mesh.setVerticesData(VertexBuffer.NormalKind, out, false);
}

/** Cut `shell` (a unique copy of `src`) down to the triangles on `part` (`invert`: off it); false if none are left. */
function keepPart(shell: Mesh, src: Mesh, part: CoatPart, invert = false): boolean {
  const n = shell.getTotalVertices();
  const on = new Uint8Array(n);
  if ('flags' in part) {
    const f = part.flags.get(src);
    if (!f) return false;
    for (let i = 0; i < n; i++) on[i] = f[i] > 0.5 ? 1 : 0;
  } else {
    const bones = shell.skeleton?.bones ?? [];
    const root = bones.find((b) => b.name === part.bone);
    if (!root) return false;
    const mine = new Set<number>();
    const walk = (b: Bone) => { mine.add(bones.indexOf(b)); b.getChildren().forEach(walk); };
    walk(root);
    const idx = shell.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const wts = shell.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (!idx || !wts) return false;
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (mine.has(idx[i * 4 + j])) w += wts[i * 4 + j];
      on[i] = w > 0.5 ? 1 : 0;
    }
  }
  const tri = shell.getIndices();
  if (!tri) return false;
  const kept: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const hit = !!(on[tri[t]] || on[tri[t + 1]] || on[tri[t + 2]]);
    if (hit !== invert) kept.push(tri[t], tri[t + 1], tri[t + 2]);
  }
  if (!kept.length) return false;
  shell.setIndices(kept);
  shell.releaseSubMeshes();
  SubMesh.AddToMesh(0, 0, n, 0, kept.length, shell);
  return true;
}

/**
 * Where a part rests in the unposed body (its skinned vertices' middle) and
 * how far round it to keep clear (SPARE_REACH × its reach, at least SPARE_MIN
 * of the height, past the swell of a burst).
 */
function spareSphere(meshes: Mesh[], bone: string, size: number): [number, number, number, number] {
  const pts: number[][] = [];
  for (const m of meshes) {
    const bones = m.skeleton?.bones ?? [];
    const root = bones.find((b) => b.name === bone);
    if (!root) continue;
    const mine = new Set<number>();
    const walk = (b: Bone) => { mine.add(bones.indexOf(b)); b.getChildren().forEach(walk); };
    walk(root);
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const idx = m.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const wts = m.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (!pos || !idx || !wts) continue;
    for (let i = 0; i < pos.length / 3; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (mine.has(idx[i * 4 + j])) w += wts[i * 4 + j];
      if (w > 0.5) pts.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    }
  }
  if (!pts.length) return [0, 0, 0, 0];
  const c = [0, 1, 2].map((j) => pts.reduce((a, p) => a + p[j], 0) / pts.length);
  const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
  return [c[0], c[1], c[2], Math.max(r * SPARE_REACH, size * SPARE_MIN)];
}

export class WaterCoat {
  readonly lit: Promise<void>;
  private readonly shells: Mesh[];
  private readonly skin: WaterSkin;
  private readonly mat: StandardMaterial;
  /** The noise's bursts: each its own shells, material and plugin (and, over an aura, its mask's). */
  private readonly layers: { shells: Mesh[]; skin: WaterSkin; mat: StandardMaterial; maskSkin: WaterSkin | null; maskMat: StandardMaterial | null }[] = [];
  private readonly style: BurstStyle;
  private undoOverlays: (() => void)[] = [];
  private setBurstFade(f: number): void { for (const l of this.layers) { l.skin.fade = f; if (l.maskSkin) l.maskSkin.fade = f; } }
  private readonly obs: Observer<Scene>;
  private released = false;
  /** A water shell over the body (not its noise alone). */
  private hasCoat = true;
  /** A coat of fire's copy in the auras' mask (kept rising and fading with it). */
  private fireMask: { mat: StandardMaterial; skin: WaterSkin } | null = null;
  private syncFireMask(): void { if (this.fireMask) { this.fireMask.skin.rise = this.skin.rise; this.fireMask.skin.fade = this.skin.fade; } }

  /** `size`: the model's height in its own units; `tint`: the water's blue (0..1 display RGB). */
  /**
   * `opts.element`: whose beam's noise bursts off it (default Water);
   * `opts.coat`: false for the noise bursting alone, with no water (a Fire
   * aura's: Flame Charge).
   */
  constructor(private readonly scene: Scene, body: Mesh[], size: number, tint: RGB, part?: CoatPart,
    opts: { element?: string; coat?: boolean; bursts?: BurstStyle; overlay?: (mesh: Mesh, mask: Material) => () => void;
      /** Its bursts in the aura's own colours (WaterSkin's `aura`). */
      aura?: { fill: RGB; line: RGB };
      /** A coat of fire (xorFire) over all the body, not water — its tone (xfTone) — and no bursts of noise off it. */
      fire?: { tone: number };
      /** Cel shaded (WaterSkin's `cel`). */
      cel?: boolean;
      /** How thick the coat stands off (WaterSkin's `thick`: × the usual; its ripples unchanged). */
      thick?: number } = {}) {
    const element = opts.element ?? 'Water', coat = opts.coat ?? true;
    this.hasCoat = coat;
    this.mat = new StandardMaterial('waterCoat', scene);
    // (Lit, so the mesh's normals come through to the shader: the plugin
    // writes the colour itself.)
    this.mat.diffuseColor.set(0, 0, 0);
    this.mat.specularColor.set(0, 0, 0);
    this.mat.alpha = 0.99; // (blended)
    this.mat.disableDepthWrite = true;
    this.skin = new WaterSkin(this.mat, size, tint, element);
    if (opts.fire) { this.skin.fire = true; this.skin.fireTone = opts.fire.tone; }
    this.skin.cel = !!opts.cel;
    this.skin.thick = opts.thick ?? 1;
    const all = body.filter((m) => m.isEnabled());
    const shells: Mesh[] = [], live: Mesh[] = [];
    for (const m of all) {
      const c = m.clone('waterCoat', m.parent) as Mesh;
      c.material = this.mat;
      c.isPickable = false;
      smoothNormals(c);
      c.receiveShadows = false;
      // Only the part: the shell keeps the triangles on it.
      if (part && !keepPart(c, m, part)) { c.dispose(false, false); continue; }
      shells.push(c);
      live.push(m);
    }
    this.shells = shells;
    // (The top of the unposed body, whatever its units: where the rise ends.)
    this.skin.top = Math.max(size, ...live.map((m) => m.getBoundingInfo().boundingBox.maximum.y));
    const style = this.style = opts.fire ? { ...WATER_BURSTS, layers: 0 } : opts.bursts ?? WATER_BURSTS;
    // A coat of fire is drawn as the auras' noise is (over the aura, its own
    // colours, after tone mapping): its shells through \`overlay\`, with a mask copy.
    if (opts.fire && opts.overlay) {
      const fm = new StandardMaterial('fireCoatMask', scene);
      fm.diffuseColor.set(0, 0, 0); fm.specularColor.set(0, 0, 0); fm.alpha = 0.99; fm.disableDepthWrite = true;
      fm.alphaMode = Constants.ALPHA_MAXIMIZED;
      const mk = new WaterSkin(fm, size, tint, element);
      mk.fire = true; mk.maskOnly = true; mk.top = this.skin.top;
      this.fireMask = { mat: fm, skin: mk };
      this.undoOverlays.push(...shells.map((c) => opts.overlay!(c, fm)));
    }
    const blank = (name: string) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor.set(0, 0, 0);
      m.specularColor.set(0, 0, 0);
      m.alpha = 0.99;
      m.disableDepthWrite = true;
      return m;
    };
    const spare = style.spare ? spareSphere(live, style.spare, size) : [0, 0, 0, 0] as [number, number, number, number];
    const skinFor = (m: StandardMaterial, maskOnly: boolean) => {
      const k = new WaterSkin(m, size, tint, element, style.redden ?? 0, style.toward, opts.aura);
      k.top = this.skin.top; k.rise = 1; k.burst = 0; k.grow = style.grow; k.cut = style.cut; k.maskOnly = maskOnly; k.glow = !!style.glow; k.bright = style.bright ?? 0; k.strands = !!style.strands; k.spare = spare; k.base = style.base ?? 0; k.lift = style.lift ?? 0; k.alpha = style.alpha ?? 1;
      return k;
    };
    for (let n = 0; n < (style.layers ?? 1); n++) {
      const mat = blank('waterCoatBurst');
      const skin = skinFor(mat, false);
      // Drawn over an aura (its fill would hide them): into the auras' mask as overlays.
      let maskMat: StandardMaterial | null = null, maskSkin: WaterSkin | null = null;
      if (opts.overlay) {
        maskMat = blank('waterCoatBurstMask');
        maskMat.alphaMode = Constants.ALPHA_MAXIMIZED;
        maskSkin = skinFor(maskMat, true);
      }
      const layerShells = this.shells.map((c, i) => {
        const b = c.clone('waterCoatBurst', c.parent) as Mesh;
        b.material = mat;
        b.isPickable = false;
        b.setEnabled(false);
        // The face (style.spare) left bare: its triangles cut away.
        if (style.spare) { b.makeGeometryUnique(); keepPart(b, live[i], { bone: style.spare }, true); }
        return b;
      });
      if (opts.overlay && maskMat) this.undoOverlays.push(...layerShells.map((b) => opts.overlay!(b, maskMat!)));
      this.layers.push({ shells: layerShells, skin, mat, maskSkin, maskMat });
    }
    let t = 0;
    let done!: () => void;
    this.lit = new Promise<void>((r) => { done = r; });
    this.obs = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      t += dt;
      if (!this.released && this.skin.rise < 1) {
        this.skin.rise = Math.min(1, t / COAT_RISE);
        if (this.skin.rise >= 1) done();
      }
      this.syncFireMask();
      // Once it is up, the noise bursts off it, again and again — several
      // layers staggered, one after another with no gap, where it has them.
      const since = t - COAT_RISE;
      const n = this.layers.length;
      // It shows wherever the body does (gone in a quick step's dash).
      this.shells.forEach((c, i) => { c.visibility = live[i].visibility; c.setEnabled(coat && live[i].isEnabled()); });
      this.layers.forEach((l, k) => {
        const period = n > 1 ? this.style.time : this.style.every;
        const phase = since >= 0 ? (since + (k * this.style.time) / n) % period : -1;
        const bursting = phase >= 0 && phase < this.style.time;
        l.skin.burst = bursting ? phase / this.style.time : 0;
        // The noise comes in over BURST_RAMP s once the coat is up, not all at once.
        l.skin.alpha = (this.style.alpha ?? 1) * Math.min(1, Math.max(0, since / BURST_RAMP));
        if (l.maskSkin) l.maskSkin.burst = l.skin.burst;
        l.shells.forEach((b, i) => { b.visibility = live[i].visibility; b.setEnabled(bursting && live[i].isEnabled()); });
      });
    });
  }

  release(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.released = true;
    return new Promise<void>((resolve) => {
      let t = 0;
      const o = this.scene.onBeforeRenderObservable.add(() => {
        t += Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
        if (!this.hasCoat) {
          // Noise alone: it fades out smoothly to nothing, bursting on as it goes.
          const u = Math.min(1, t / NOISE_FADE);
          this.setBurstFade(1 - u * u * (3 - 2 * u));
          if (u >= 1) {
            this.scene.onBeforeRenderObservable.remove(o);
            this.dispose();
            resolve();
          }
          return;
        }
        this.skin.fade = Math.max(0, 1 - t / COAT_FADE);
        this.setBurstFade(this.skin.fade);
        // Draining off from the top down.
        this.skin.rise = Math.max(0, 1 - t / COAT_DROP);
        for (const l of this.layers) { l.skin.rise = this.skin.rise; if (l.maskSkin) l.maskSkin.rise = this.skin.rise; }
        this.syncFireMask();
        if (this.skin.fade <= 0 || this.skin.rise <= 0) {
          this.scene.onBeforeRenderObservable.remove(o);
          this.dispose();
          resolve();
        }
      });
    });
  }

  /**
   * Burst off (an Aqua Jet's hit): the water swells out off the body as it
   * tears apart and is gone; resolves when it is.
   */
  burstOff(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.released = true;
    return new Promise<void>((resolve) => {
      let t = 0;
      const o = this.scene.onBeforeRenderObservable.add(() => {
        t += Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
        this.skin.swell = Math.min(1, t / SWELL_TIME);
        this.setBurstFade(Math.max(0, 1 - t / SWELL_TIME));
        if (this.skin.swell >= 1) {
          this.scene.onBeforeRenderObservable.remove(o);
          this.dispose();
          resolve();
        }
      });
    });
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.obs);
    this.undoOverlays.forEach((u) => u());
    for (const c of [...this.shells, ...this.layers.flatMap((l) => l.shells)]) c.dispose(false, false);
    this.mat.dispose();
    this.fireMask?.mat.dispose();
    for (const l of this.layers) { l.mat.dispose(); l.maskMat?.dispose(); }
  }
}

/**
 * A surface that is water itself (not a coat over one): the coat's water —
 * Spout's ripples, the sky off it, its glints, soaked blue, cel shaded where
 * `cel` — laid straight on a mesh's own skin, nothing puffed out, all of it
 * shown at once (no rise). For parts made of water: Mega Greninja's shurikens.
 * `size`: the model's height in its own units (the ripples' scale).
 */
export function waterSurface(scene: Scene, size: number, tint: RGB, cel = true,
  vortex: { centre: [number, number, number]; axis: [number, number, number] } | null = null): StandardMaterial {
  const mat = new StandardMaterial('waterSurface', scene);
  // (Lit, so the mesh's normals come through to the shader: the plugin writes the colour itself.)
  mat.diffuseColor.set(0, 0, 0);
  mat.specularColor.set(0, 0, 0);
  mat.alpha = 0.99; // (blended: what is behind shows through it, soaked)
  // (No depth of its own, as the coat's: written, the water draws nothing.)
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  const skin = new WaterSkin(mat, size, tint, 'Water');
  skin.cel = cel;
  skin.thick = 0;
  skin.vortex = vortex;
  // (All of it up at once: its rise's front far above anything of it.)
  skin.rise = 1;
  skin.top = size * 100;
  return mat;
}
