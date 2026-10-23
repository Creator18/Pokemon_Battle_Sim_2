/**
 * Fire after XorDev's "3D Fire" (Shadertoy; the turbulence technique:
 * https://mini.gmshaders.com/p/turbulence) — its turbulence loop (waves of
 * ever higher frequency, each shifting the point, racing on in time), its
 * palette (sin(z / 3 + (7, 2, 3)) + 1.1: deep red through orange to yellow
 * with depth), its glow (each sample adding its colour over its distance to
 * the flame) and its tanh tone mapping.
 *
 * Laid on a surface instead of a free volume: at each pixel it marches a short
 * way on into the body along the view (a skin of fire some depth deep), and
 * its flame is a field of upright sheets the turbulence tears into tongues —
 * twisted round the upright axis and climbing, as the source's cone is.
 *
 *   xorFire(q, v, t)   q: the point in the body's own frame (units of its
 *                      height, 0 at the feet); v: the way on into it (unit);
 *                      t: seconds. Returns display RGB and how strongly it shows.
 */

/** Samples marched into the body, and how far apart (× the body's height). */
const XF_STEPS = 8, XF_STEP = 0.025;
/** How many of the source's units to the body's height; how fast its flames climb (/s). */
const XF_SCALE = 7.0, XF_RISE = 1.6;
/** How far its colour turns per sample down (the source's z / 3), and up the body (× its height). */
const XF_PHASE = 0.9, XF_UP = 2.2;
/** The glow's sum brought into tanh's range (the source's 1e3, for its 50 samples). */
const XF_NORM = 140.0;

export const XOR_FIRE = /* glsl */ `
vec3 xfTanh(vec3 x) { vec3 e = exp(-2.0 * clamp(x, 0.0, 20.0)); return (1.0 - e) / (1.0 + e); }
vec4 xorFire(vec3 q, vec3 v, float t) {
  vec3 O = vec3(0.0);
  for (int i = 0; i < ${XF_STEPS}; i++) {
    float z = float(i);
    vec3 p = (q + v * z * ${XF_STEP.toFixed(3)}) * ${XF_SCALE.toFixed(2)};
    p.y -= t * ${(XF_RISE * XF_SCALE).toFixed(2)};
    // Twist round the upright axis, as the source's cone turns.
    float a = p.y * 0.5;
    p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
    // The turbulence: waves of rising frequency, racing on.
    float d = 2.0;
    for (int k = 0; k < 6; k++) {
      p += cos((p.yzx - vec3(t / 0.1, t, d)) * d) / d;
      d /= 0.6;
    }
    // Its distance to the flame: a field of upright sheets, torn into tongues.
    float dist = 0.01 + abs(sin(p.x) + sin(p.z)) / 7.0;
    O += (sin(z * ${XF_PHASE.toFixed(2)} + q.y * ${XF_UP.toFixed(2)} + vec3(7.0, 2.0, 3.0)) + 1.1) / dist;
  }
  vec3 c = xfTanh(O / ${XF_NORM.toFixed(1)});
  return vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}
// Its colour for flames not of the ordinary kind: 0 as it is, 1 blue (Mega
// Charizard X's), 2 ghostly violet (the Litwick line's).
vec3 xfTone(vec3 c, float tone) {
  if (tone > 1.5) return vec3(c.r * 0.7 + c.b * 0.3, c.b * 0.5 + c.g * 0.2, c.r);
  if (tone > 0.5) return c.bgr;
  return c;
}`;

/** Which tone (xfTone) an element's flames wear. */
export function fireTone(element: string): number {
  return element === 'BlueFire' ? 1 : element === 'GhostFire' ? 2 : 0;
}
