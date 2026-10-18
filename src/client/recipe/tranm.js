// Reading a Trinity animation (.tranm) — browser port of tools/pokekit/tranm.mjs.
//
//   root [0] -> info:   [1] frame count, [2] fps
//   root [1] -> holder: [0] vector of TrackNode
//   TrackNode [0] bone name, [1]/[2] scale union, [3]/[4] rotation union,
//             [5]/[6] translation union
//
// Union types: 1 Fixed (one value, a struct INLINE at field [0]), 2 Dynamic
// (one value per frame), 4 Framed (u8 key frame numbers + values), 3 Framed16
// (the same with u16 key numbers, for clips longer than 255 frames).
//
// The Node version returns lazy samplers that unpack a 48-bit quaternion on
// every call. Here each track is decoded ONCE into typed arrays — the clip is
// small, and the per-frame player then does nothing but interpolate floats. The
// arrays are transferable, so a worker can decode and hand them over for free.
//
// Framed tracks start and end with a doubled key (0,0,1,…,96,96). That is in
// the data, not a parse error; the sampler handles it by construction.

import { openFb } from './fb.js';
import { unpackQuatInto } from './quat.js';

const FIXED = 1, DYNAMIC = 2, FRAMED16 = 3, FRAMED = 4;

/**
 * Track: { kind: 'fixed'|'dynamic'|'framed', n: key count, keys: Uint16Array|null
 * (frame per key, framed only), values: Float32Array (n*4 for rotation, n*3 else) }
 *
 * @returns {{ frames:number, fps:number, tracks:Array<{bone:string, rot, pos, scale}> }}
 */
export function readTranm(bytes) {
  const f = openFb(bytes);
  const r = f.root;
  if (!r || !r.fields[0] || !r.fields[1]) throw new Error('not a tranm: no root fields');
  const info = f.table(r.fields[0] + f.u32(r.fields[0]));
  const frames = f.u32(info.fields[1]);
  const fps = f.u32(info.fields[2]) || 30;
  if (!(frames > 0 && frames < 100000)) throw new Error(`implausible frame count ${frames}`);
  const holder = f.table(r.fields[1] + f.u32(r.fields[1]));
  const tv = f.fvec(holder, 0);
  if (!tv) throw new Error('no track vector');

  const tracks = [];
  for (let e = 0; e < tv.n; e++) {
    const et = f.ent(tv, e);
    const bone = f.fstr(et, 0);
    if (!bone) continue;
    const scale = readTrack(f, et, 1, 2, 3);
    const rot = readTrack(f, et, 3, 4, 4);
    const pos = readTrack(f, et, 5, 6, 3);
    if (scale || rot || pos) tracks.push({ bone, rot, pos, scale });
  }
  return { frames, fps, tracks };
}

// One bone's track. `width` 4 = packed quaternion (6 bytes a value), 3 = Vec3 of floats.
function readTrack(f, et, kindField, valField, width) {
  const kind = et.fields[kindField] ? f.u8(et.fields[kindField]) : 0;
  const vp = et.fields[valField];
  if (!kind || !vp) return null;
  const sub = f.table(vp + f.u32(vp));
  if (!sub) return null;

  const stride = width === 4 ? 6 : 12;
  const decode = (at, n) => {
    const out = new Float32Array(n * width);
    for (let i = 0; i < n; i++) {
      const o = at + i * stride;
      if (width === 4) unpackQuatInto(f.u16(o), f.u16(o + 2), f.u16(o + 4), out, i * 4);
      else { out[i * 3] = f.f32(o); out[i * 3 + 1] = f.f32(o + 4); out[i * 3 + 2] = f.f32(o + 8); }
    }
    return out;
  };

  if (kind === FIXED) {
    // A Fixed value is a struct INLINE at the field, not behind an offset.
    return { kind: 'fixed', n: 1, keys: null, values: decode(sub.fields[0], 1) };
  }
  if (kind === DYNAMIC) {
    const v = f.vec(sub.fields[0]);
    if (!v) return null;
    return { kind: 'dynamic', n: v.n, keys: null, values: decode(v.at, v.n) };
  }
  if (kind === FRAMED || kind === FRAMED16) {
    const idx = f.vec(sub.fields[0]);
    const val = f.vec(sub.fields[1]);
    if (!idx || !val) return null;
    const n = Math.min(idx.n, val.n);
    const keys = new Uint16Array(n);
    for (let k = 0; k < n; k++) keys[k] = kind === FRAMED16 ? f.u16(idx.at + k * 2) : f.u8(idx.at + k);
    return { kind: 'framed', n, keys, values: decode(val.at, n) };
  }
  throw new Error(`unknown track type ${kind}`);
}

/**
 * Sample a track at a fractional frame into out[0..width). Quaternions use
 * shortest-arc nlerp, Vec3s linear. `cursor` is an optional {k} kept between
 * calls so playing forward scans from where it left off instead of from 0.
 */
export function sampleTrack(track, frame, width, out, cursor) {
  const v = track.values;
  if (track.kind === 'fixed' || track.n === 1) {
    for (let c = 0; c < width; c++) out[c] = v[c];
    return;
  }
  let i0, i1, t;
  if (track.kind === 'dynamic') {
    const last = track.n - 1;
    const fr = Math.max(0, Math.min(last, frame));
    i0 = Math.floor(fr);
    i1 = Math.min(last, i0 + 1);
    t = fr - i0;
  } else {
    const keys = track.keys;
    let k = cursor && cursor.k < track.n && keys[cursor.k] <= frame ? cursor.k : 0;
    while (k + 1 < track.n && keys[k + 1] <= frame) k++;
    if (cursor) cursor.k = k;
    i0 = k;
    i1 = Math.min(track.n - 1, k + 1);
    const f0 = keys[i0], f1 = keys[i1];
    t = (i1 === i0 || f1 <= f0) ? 0 : Math.max(0, Math.min(1, (frame - f0) / (f1 - f0)));
  }
  const a = i0 * width, b = i1 * width;
  if (width === 4) {
    const d = v[a] * v[b] + v[a + 1] * v[b + 1] + v[a + 2] * v[b + 2] + v[a + 3] * v[b + 3];
    const s = d < 0 ? -1 : 1;
    let L = 0;
    for (let c = 0; c < 4; c++) { out[c] = v[a + c] + (v[b + c] * s - v[a + c]) * t; L += out[c] * out[c]; }
    L = Math.sqrt(L) || 1;
    for (let c = 0; c < 4; c++) out[c] /= L;
  } else {
    for (let c = 0; c < width; c++) out[c] = v[a + c] + (v[b + c] - v[a + c]) * t;
  }
}
