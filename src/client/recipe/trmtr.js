// Trinity materials (.trmtr) — browser port of tools/pokekit/trmtr.mjs.
//
// The albedo is only a luminance; the COLOUR lives here as constants, and the
// _lym mask beside the albedo says which constant each texel takes. The
// compositing itself happens on the GPU (see babylon.js); this only reads.
//
// A material's fields:
//   [0]  name     [2] texture bindings  [4] scalar floats
//   [7]  Vec4 colours (BaseColor, BaseColorLayer1..8, UVScaleOffset, UVCenter0)
//   [9]  switches [15] alpha mode
// Vec4 is a STRUCT, inline at its field — four consecutive floats.

import { openFb } from './fb.js';

export function readTrmtr(bytes) {
  const f = openFb(bytes);
  const root = f.root;
  if (!root) throw new Error('unreadable trmtr');
  const mv = f.fvec(root, 1);
  if (!mv) throw new Error('no materials vector');

  const materials = [];
  for (let e = 0; e < mv.n; e++) {
    const m = f.ent(mv, e);
    if (!m) continue;
    const mat = { name: f.fstr(m, 0), textures: {}, floats: {}, colors: {}, switches: {}, alpha: f.fstr(m, 15) };
    const tv = f.fvec(m, 2);
    if (tv) for (let i = 0; i < tv.n; i++) {
      const t = f.ent(tv, i);
      const k = f.fstr(t, 0), val = f.fstr(t, 1);
      if (k && val) mat.textures[k] = val;
    }
    const sv = f.fvec(m, 4);
    if (sv) for (let i = 0; i < sv.n; i++) {
      const t = f.ent(sv, i);
      const k = f.fstr(t, 0);
      if (k) mat.floats[k] = t.fields[1] ? f.f32(t.fields[1]) : 0;
    }
    const cv = f.fvec(m, 7);
    if (cv) for (let i = 0; i < cv.n; i++) {
      const t = f.ent(cv, i);
      const k = f.fstr(t, 0);
      if (!k) continue;
      mat.colors[k] = t.fields[1] ? [0, 1, 2, 3].map((j) => f.f32(t.fields[1] + j * 4)) : [0, 0, 0, 0];
    }
    const wv = f.fvec(m, 9);
    if (wv) for (let i = 0; i < wv.n; i++) {
      const t = f.ent(wv, i);
      const k = f.fstr(t, 0);
      if (k) mat.switches[k] = t.fields[1] ? f.u32(t.fields[1]) : 0;
    }
    materials.push(mat);
  }
  return materials;
}

/** The material's own UV transform: [scaleU, scaleV, offsetU, offsetV] about a centre. Not optional. */
export function uvTransform(mat) {
  const s = mat.colors.UVScaleOffset || [1, 1, 0, 0];
  const c = mat.colors.UVCenter0 || [0, 0, 0, 0];
  return { sx: s[0], sy: s[1], ox: s[2], oy: s[3], cx: c[0], cy: c[1] };
}

/**
 * Layers 0..4 as linear [r, g, b] or null. Layer 0 is the unmasked base; 1..4
 * are selected by the mask's R, G, B, A. BY THEIR OWN NUMBER — an eye material
 * declares 1, 2, 3, 4 and 6 — and only 1..4 are reachable from a 4-channel mask.
 */
/**
 * What a material lights by itself (unlit, added over the shading): the base
 * and each paint layer's EmissionColor × EmissionIntensity (layer 0 the base,
 * 1–4 the _lym mask's R/G/B/A), and the highlight — EmissionColorLayer5 ×
 * EmissionIntensityLayer5 where the HighlightMaskMap says (an eye's catchlight).
 * null where it gives no light.
 */
export function emissionColors(mat) {
  const lit = (c, k) => {
    const v = mat.floats[k] ?? 0;
    return c && v > 0 ? c.slice(0, 3).map((x) => x * v) : null;
  };
  const layers = [lit(mat.colors.EmissionColor, 'EmissionIntensity')];
  for (let i = 1; i <= 4; i++) layers[i] = lit(mat.colors[`EmissionColorLayer${i}`], `EmissionIntensityLayer${i}`);
  return { layers, highlight: lit(mat.colors.EmissionColorLayer5, 'EmissionIntensityLayer5') };
}

export function layerColors(mat) {
  const out = [(mat.colors.BaseColor || [1, 1, 1, 1]).slice(0, 3)];
  for (let i = 1; i <= 4; i++) {
    const c = mat.colors[`BaseColorLayer${i}`];
    out[i] = c ? c.slice(0, 3) : null;
  }
  return out;
}
