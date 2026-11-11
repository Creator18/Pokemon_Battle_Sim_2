// BC1/BC7 block decoding — copied from tools/pokekit/bcn.mjs with its only two
// Node-specific calls (Buffer.readUInt*LE, Buffer.alloc) replaced by plain
// Uint8Array access, so it runs in a browser or worker. Tables are verbatim.

// Decode BC-compressed texture blocks to RGBA.
//
// BC7 is the one that matters: Legends Z-A stores every albedo in it. Windows
// has no DDS codec registered here and WIC refused the file, so this is written
// rather than delegated — which is the right trade anyway, since it removes a
// dependency from a pipeline that has to run over six hundred models.
//
// BC7 is a 16-byte block describing 4x4 pixels under one of EIGHT modes. The
// mode decides how many colour subsets the block is split into, how many bits
// each endpoint gets, whether alpha is separate, and how wide the indices are.
// The two big tables below are the partitionings: which of the sixteen pixels
// belongs to which subset. They are fixed constants from the format, and being
// wrong in them is the failure this file is most exposed to — so it is checked
// against an independent conversion of the same texture rather than trusted.

// --- BC7 mode table ---------------------------------------------------------
// ns   subsets            pb  partition bits      rb  rotation bits
// isb  index-selection    cb  colour bits         ab  alpha bits
// epb  endpoint p-bits    spb shared p-bits       ib  index bits   ib2 second
const MODES = [
  { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: 1, spb: 0, ib: 3, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: 0, spb: 1, ib: 3, ib2: 0 },
  { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: 0, spb: 0, ib: 2, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: 1, spb: 0, ib: 2, ib2: 0 },
  { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: 0, spb: 0, ib: 2, ib2: 3 },
  { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: 0, spb: 0, ib: 2, ib2: 2 },
  { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: 1, spb: 0, ib: 4, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: 1, spb: 0, ib: 2, ib2: 0 },
];

// Interpolation weights, indexed by index width.
const W = { 2: [0, 21, 43, 64], 3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64] };

// The partitionings, one nibble-free bitmap per pattern. Two subsets is one bit
// a pixel; three subsets needs two, so it is stored as a 32-bit word.
const PART2 = [
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80,
  0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
  0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce,
  0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a,
  0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
  0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c,
  0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
];
const PART3 = [
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050,
  0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250,
  0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040, 0xa4a45000, 0x1a1a0500,
  0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200,
  0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424, 0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50,
  0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600,
  0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000,
  0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
];

// Which pixel is the implicit anchor for each subset — its top index bit is
// omitted from the stream, because the endpoints can always be ordered so it
// is zero. Subset 0's anchor is always pixel 0.
const ANCHOR2 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
  6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
];
const ANCHOR3A = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3,
  3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15,
  3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];
const ANCHOR3B = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8,
  15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8,
  15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
];

const subsetOf = (ns, part, i) =>
  ns === 1 ? 0 : ns === 2 ? (PART2[part] >>> i) & 1 : (PART3[part] >>> (2 * i)) & 3;

// A bit reader over one block, least significant bit of byte 0 first.
function reader(b, o) {
  let bit = 0;
  return (n) => {
    let v = 0;
    for (let k = 0; k < n; k++) {
      v |= ((b[o + (bit >> 3)] >> (bit & 7)) & 1) << k;
      bit++;
    }
    return v;
  };
}
const lerp = (a, c, w) => (a * (64 - w) + c * w + 32) >> 6;

// Decode one BC7 block into `out` at (bx*4, by*4).
export function bc7Block(src, o, out, stride, bx, by, width, height) {
  // The mode is unary: however many zero bits come first.
  let mode = -1;
  for (let i = 0; i < 8; i++) if ((src[o] >> i) & 1) { mode = i; break; }
  if (mode < 0) {                                   // reserved: the spec says black
    for (let p = 0; p < 16; p++) {
      const x = bx * 4 + (p & 3), y = by * 4 + (p >> 2);
      if (x < width && y < height) { const d = y * stride + x * 4; out[d] = out[d+1] = out[d+2] = 0; out[d+3] = 255; }
    }
    return;
  }
  const M = MODES[mode];
  const r = reader(src, o);
  r(mode + 1);                                      // consume the mode marker

  const part = M.pb ? r(M.pb) : 0;
  const rot = M.rb ? r(M.rb) : 0;
  const idxSel = M.isb ? r(M.isb) : 0;

  const n = M.ns * 2;                               // endpoints
  const R = [], G = [], B = [], A = [];
  for (let i = 0; i < n; i++) R.push(r(M.cb));
  for (let i = 0; i < n; i++) G.push(r(M.cb));
  for (let i = 0; i < n; i++) B.push(r(M.cb));
  for (let i = 0; i < n; i++) A.push(M.ab ? r(M.ab) : 255);

  // P-bits extend each endpoint by one low bit: either one per endpoint, or one
  // shared by the pair.
  const pb = [];
  if (M.epb) for (let i = 0; i < n; i++) pb.push(r(1));
  else if (M.spb) for (let i = 0; i < M.ns; i++) { const v = r(1); pb.push(v, v); }

  const cb = M.cb + (pb.length ? 1 : 0);
  const ab = M.ab ? M.ab + (pb.length ? 1 : 0) : 0;
  for (let i = 0; i < n; i++) {
    if (pb.length) {
      R[i] = (R[i] << 1) | pb[i]; G[i] = (G[i] << 1) | pb[i];
      B[i] = (B[i] << 1) | pb[i]; if (M.ab) A[i] = (A[i] << 1) | pb[i];
    }
    // Left-justify into 8 bits and replicate the top bits into the gap.
    const up = (v, bits) => bits >= 8 ? v : ((v << (8 - bits)) | (v >> (2 * bits - 8))) & 0xff;
    R[i] = up(R[i], cb); G[i] = up(G[i], cb); B[i] = up(B[i], cb);
    A[i] = M.ab ? up(A[i], ab) : 255;
  }

  // Anchors: one pixel per subset spends one bit fewer.
  const anchors = M.ns === 1 ? [0]
    : M.ns === 2 ? [0, ANCHOR2[part]]
    : [0, ANCHOR3A[part], ANCHOR3B[part]];
  const isAnchor = (p) => anchors.indexOf(p) >= 0;

  const idx = new Uint8Array(16), idx2 = new Uint8Array(16);
  for (let p = 0; p < 16; p++) idx[p] = r(M.ib - (isAnchor(p) ? 1 : 0));
  if (M.ib2) for (let p = 0; p < 16; p++) idx2[p] = r(M.ib2 - (p === 0 ? 1 : 0));

  const wc = W[M.ib], wa = M.ib2 ? W[M.ib2] : W[M.ib];
  for (let p = 0; p < 16; p++) {
    const s = subsetOf(M.ns, part, p);
    const e0 = s * 2, e1 = s * 2 + 1;
    // Mode 4 can swap which index set drives colour and which drives alpha.
    const ci = M.ib2 ? (idxSel ? idx2[p] : idx[p]) : idx[p];
    const ai = M.ib2 ? (idxSel ? idx[p] : idx2[p]) : idx[p];
    const cw = (M.ib2 && idxSel) ? wa[ci] : wc[ci];
    const aw = M.ib2 ? ((idxSel ? wc[ai] : wa[ai])) : wc[ai];
    let cr = lerp(R[e0], R[e1], cw), cg = lerp(G[e0], G[e1], cw), cbv = lerp(B[e0], B[e1], cw);
    let ca = M.ab ? lerp(A[e0], A[e1], aw) : 255;
    // Rotation moves alpha into one of the colour channels and back.
    if (rot === 1) { const t = cr; cr = ca; ca = t; }
    else if (rot === 2) { const t = cg; cg = ca; ca = t; }
    else if (rot === 3) { const t = cbv; cbv = ca; ca = t; }
    const x = bx * 4 + (p & 3), y = by * 4 + (p >> 2);
    if (x >= width || y >= height) continue;
    const d = y * stride + x * 4;
    out[d] = cr; out[d + 1] = cg; out[d + 2] = cbv; out[d + 3] = ca;
  }
}

// BC1: two 565 endpoints and 2-bit indices.
export function bc1Block(src, o, out, stride, bx, by, width, height) {
  const c0 = src[o] | (src[o + 1] << 8), c1 = src[o + 2] | (src[o + 3] << 8);
  const un = (c) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
  const a = un(c0), b = un(c1);
  const pal = [a, b, [], []];
  if (c0 > c1) {
    for (let k = 0; k < 3; k++) { pal[2][k] = (2 * a[k] + b[k]) / 3 | 0; pal[3][k] = (a[k] + 2 * b[k]) / 3 | 0; }
  } else {
    for (let k = 0; k < 3; k++) { pal[2][k] = (a[k] + b[k]) / 2 | 0; pal[3][k] = 0; }
  }
  const bits = (src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] << 24)) >>> 0;
  for (let p = 0; p < 16; p++) {
    const x = bx * 4 + (p & 3), y = by * 4 + (p >> 2);
    if (x >= width || y >= height) continue;
    const c = pal[(bits >>> (2 * p)) & 3];
    const d = y * stride + x * 4;
    out[d] = c[0]; out[d + 1] = c[1]; out[d + 2] = c[2];
    out[d + 3] = (c0 <= c1 && ((bits >>> (2 * p)) & 3) === 3) ? 0 : 255;
  }
}

// BC4: one channel — two 8-bit endpoints and 3-bit indices (the alpha block
// of BC3). Written to R, G and B (a grey mask or luminance), alpha opaque.
export function bc4Block(src, o, out, stride, bx, by, width, height) {
  bc4Channel(src, o, out, stride, bx, by, width, height, -1);
}

// One BC4 channel (8 bytes) into channel \`ch\` of the output (0 R, 1 G), or into R, G and B (-1, a grey).
function bc4Channel(src, o, out, stride, bx, by, width, height, ch) {
  const e0 = src[o], e1 = src[o + 1];
  const pal = [e0, e1];
  if (e0 > e1) for (let k = 1; k < 7; k++) pal.push(((7 - k) * e0 + k * e1) / 7 | 0);
  else { for (let k = 1; k < 5; k++) pal.push(((5 - k) * e0 + k * e1) / 5 | 0); pal.push(0, 255); }
  // 48 bits of indices, little-endian, from byte 2.
  let lo = (src[o + 2] | (src[o + 3] << 8) | (src[o + 4] << 16)) >>> 0;
  let hi = (src[o + 5] | (src[o + 6] << 8) | (src[o + 7] << 16)) >>> 0;
  for (let p = 0; p < 16; p++) {
    const idx = p < 8 ? (lo >>> (3 * p)) & 7 : (hi >>> (3 * (p - 8))) & 7;
    const x = bx * 4 + (p & 3), y = by * 4 + (p >> 2);
    if (x >= width || y >= height) continue;
    const v = pal[idx];
    const d = y * stride + x * 4;
    if (ch < 0) { out[d] = v; out[d + 1] = v; out[d + 2] = v; } else out[d + ch] = v;
    out[d + 3] = 255;
  }
}

// BC5: two BC4 channels (a normal map's X and Y) — R, then G; B left full (the surface's Z, near enough).
export function bc5Block(src, o, out, stride, bx, by, width, height) {
  bc4Channel(src, o, out, stride, bx, by, width, height, 0);
  bc4Channel(src, o + 8, out, stride, bx, by, width, height, 1);
}

// Decode a whole deswizzled surface.
export function decodeSurface(tex) {
  const { width, height, format, data } = tex;
  const stride = width * 4;
  const out = new Uint8Array(stride * height).fill(255);
  const wb = Math.ceil(width / 4), hb = Math.ceil(height / 4);
  const step = tex.bytesPerBlock;
  const fn = format === 'BC7' ? bc7Block : format === 'BC1' ? bc1Block : format === 'BC4' ? bc4Block : format === 'BC5' ? bc5Block : null;
  if (!fn) throw new Error('no decoder for ' + format);
  for (let by = 0; by < hb; by++) {
    for (let bx = 0; bx < wb; bx++) {
      fn(data, (by * wb + bx) * step, out, stride, bx, by, width, height);
    }
  }
  return { width, height, rgba: out };
}
