// Reading a Trinity material animation (.tracm) — for its per-shape VISIBILITY.
//
// Every clip ships one beside its .tranm. Besides the eyes' UV tracks it says,
// per mesh shape, whether that shape is drawn: Mega Blastoise's idle shows its
// cannons and hides the closed shell standing in for them, Bulbasaur's attack
// turns its vines on, Pidgey's swipe swaps the folded wings for the open ones.
//
//   root [0] -> info: [1] frame count, [2] fps
//   root [1] -> vector of ShapeNode
//   ShapeNode [0] shape name, [5] -> { [2] -> track }
//   track [0] u8 union type, [1] -> values
//     1 Fixed:   values [0] bool (absent = false)
//     2 Dynamic: values [0] bit vector, frame i = bit i (LSB first); frames
//                past its end hold the last bit
//     4 Framed:  values [0] u8 key frames, [1] bit vector, one bit per key;
//                each key holds until the next
//     3 Framed16: the same with u16 key frames
//
// Each shape comes back as one byte per frame (1 drawn, 0 hidden).

import { openFb } from './fb.js';

const FIXED = 1, DYNAMIC = 2, FRAMED16 = 3, FRAMED = 4;

/** @returns {{ frames:number, shapes: Record<string, Uint8Array> }} */
export function readTracm(bytes) {
  const f = openFb(bytes);
  const r = f.root;
  const shapes = {};
  if (!r || !r.fields[0] || !r.fields[1]) return { frames: 0, shapes };
  const deref = (fp) => (fp ? f.table(fp + f.u32(fp)) : null);
  const info = deref(r.fields[0]);
  const frames = Math.max(1, f.fint(info, 1, 1));
  const v = f.fvec(r, 1);
  if (!v || frames > 100000) return { frames, shapes };
  const bit = (vec, i) => (f.u8(vec.at + (i >> 3)) >> (i & 7)) & 1;

  for (let e = 0; e < v.n; e++) {
    const node = f.ent(v, e);
    const name = f.fstr(node, 0);
    const holder = deref(node && node.fields[5]);
    const track = deref(holder && holder.fields[2]);
    if (!name || !track || !track.fields[0]) continue;
    const kind = f.u8(track.fields[0]);
    const val = deref(track.fields[1]);
    const out = new Uint8Array(frames);
    if (kind === FIXED) {
      out.fill(val && val.fields[0] ? f.u8(val.fields[0]) & 1 : 0);
    } else if (kind === DYNAMIC) {
      const bits = f.fvec(val, 0);
      if (!bits || !bits.n) continue;
      const last = bits.n * 8 - 1;
      for (let i = 0; i < frames; i++) out[i] = bit(bits, Math.min(i, last));
    } else if (kind === FRAMED || kind === FRAMED16) {
      const keys = f.fvec(val, 0), bits = f.fvec(val, 1);
      if (!keys || !keys.n || !bits) continue;
      const keyAt = (k) => (kind === FRAMED ? f.u8(keys.at + k) : f.u16(keys.at + k * 2));
      for (let k = 0; k < keys.n; k++) {
        const from = keyAt(k), to = k + 1 < keys.n ? keyAt(k + 1) : frames;
        out.fill(bit(bits, k), Math.min(from, frames), Math.min(Math.max(to, from), frames));
      }
      // A clip whose first key is late starts as that key.
      out.fill(bit(bits, 0), 0, Math.min(keyAt(0), frames));
    } else continue;
    shapes[name] = out;
  }
  return { frames, shapes };
}
