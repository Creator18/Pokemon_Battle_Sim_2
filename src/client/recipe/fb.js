// Reading FlatBuffers without a schema — the browser port of tools/pokekit/fb.mjs.
//
// Same walker, over a Uint8Array instead of a Node Buffer, so it runs in a page
// or a worker. A table carries a vtable saying where its fields are, so the
// structure is self-describing; what each field MEANS is documented in the
// readers that use this. Remember the one trap: a STRUCT is stored inline at its
// field, while a table, string or vector is stored behind a uoffset.

export function openFb(bytes) {
  const b = bytes;
  const N = b.length;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const inb = (o, n = 4) => o >= 0 && o + n <= N;
  const u32 = (o) => (inb(o) ? dv.getUint32(o, true) : -1);
  const i32 = (o) => (inb(o) ? dv.getInt32(o, true) : 0);
  const u16 = (o) => (inb(o, 2) ? dv.getUint16(o, true) : 0);
  const u8 = (o) => (inb(o, 1) ? b[o] : 0);
  const f32 = (o) => (inb(o) ? dv.getFloat32(o, true) : NaN);

  function strAt(o) {
    if (!inb(o)) return null;
    const n = u32(o);
    if (n < 1 || n > 512 || !inb(o + 4 + n, 1) || b[o + 4 + n] !== 0) return null;
    let s = '';
    for (let k = 0; k < n; k++) {
      const c = b[o + 4 + k];
      if (c < 32 || c > 126) return null;
      s += String.fromCharCode(c);
    }
    return s;
  }
  function table(pos) {
    if (!inb(pos)) return null;
    const vt = pos - i32(pos);
    if (!inb(vt, 4)) return null;
    const vlen = u16(vt);
    if (vlen < 4 || vlen > 512 || !inb(vt + vlen, 0)) return null;
    const fields = [];
    for (let i = 4; i < vlen; i += 2) { const off = u16(vt + i); fields.push(off ? pos + off : 0); }
    return { pos, fields };
  }
  const vec = (fp) => {
    if (!fp) return null;
    const o = fp + u32(fp);
    const n = u32(o);
    return (n >= 0 && n < 2000000) ? { at: o + 4, n } : null;
  };
  const ent = (v, e) => { const p = v.at + e * 4; return table(p + u32(p)); };
  const fstr = (t, i) => (t && t.fields[i] ? strAt(t.fields[i] + u32(t.fields[i])) : null);
  const fvec = (t, i) => (t ? vec(t.fields[i]) : null);
  const fint = (t, i, d = 0) => (t && t.fields[i] ? u32(t.fields[i]) : d);
  const fsint = (t, i, d = 0) => (t && t.fields[i] ? i32(t.fields[i]) : d);
  const fflt = (t, i, d = 0) => (t && t.fields[i] ? f32(t.fields[i]) : d);
  const fstruct = (t, i, n) => (t && t.fields[i]
    ? Array.from({ length: n }, (_, k) => f32(t.fields[i] + k * 4)) : null);
  const fbytes = (t, i) => {
    const v = fvec(t, i);
    return v ? b.subarray(v.at, v.at + v.n) : null;
  };

  return { buf: b, dv, u32, i32, u16, u8, f32, strAt, table, vec, ent, fstr, fvec, fint, fsint, fflt, fstruct, fbytes,
    root: table(u32(0)) };
}

// IEEE half precision, for the packed normals.
export function half(u) {
  const s = (u & 0x8000) ? -1 : 1;
  const e = (u >> 10) & 0x1f;
  const m = u & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (m + 1024) * Math.pow(2, e - 25);
}
