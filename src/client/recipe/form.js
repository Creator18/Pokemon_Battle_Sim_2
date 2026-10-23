// Parse one form's raw Trinity files into engine-agnostic typed arrays.
// Browser/worker port of the reading half of tools/pokekit/model.mjs.
//
// Output is plain data so it can cross a worker boundary as transferables:
//   bones     [{ name, parent, rig, scale[3], rot[4] (quaternion), pos[3] }]
//   shapes    [{ name, positions, normals, uvs, boneIndices, boneWeights,
//                indices, ranges:[{ first, count, material }] }]
//   materials [{ name, layers:[5 x [r,g,b]|null], albedo, mask, alpha }]
//
// Two things are done here once, so the GPU never has to:
//   - blend indices are RIG indices; they are remapped to bone-array positions
//     (byRig), because about a fifth of skeleton entries are not bones and have
//     no rig index (doc §6 trap 1).
//   - each material's own UV transform is baked into its vertices, then V is
//     flipped (traps 7–9). No vertex is shared between materials in these
//     models (checked across all six), so per-material baking is exact. The
//     texture's wrap modes then do the rest: U mirrors past 1, V wraps.

import { openFb, half } from './fb.js';
import { quatFromEuler } from './quat.js';
import { readTrmtr, uvTransform, layerColors, emissionColors } from './trmtr.js';

/** @param files Map<string, Uint8Array> of `<id>.trskl|.trmsh|.trmbf|.trmtr` */
export function parseForm(id, files) {
  const get = (ext) => {
    const b = files.get(id + ext);
    if (!b) throw new Error(`${id}: missing ${id}${ext}`);
    return b;
  };

  // --- skeleton: root[1] bones; bone [0] name, [1] transform {scale, euler, pos},
  //     [4] parent ARRAY index, [5] RIG index.
  const SK = openFb(get('.trskl'));
  const bones = [];
  const bv = SK.fvec(SK.root, 1);
  for (let i = 0; i < bv.n; i++) {
    const t = SK.ent(bv, i);
    const tr = t.fields[1] ? SK.table(t.fields[1] + SK.u32(t.fields[1])) : null;
    const e = tr ? SK.fstruct(tr, 1, 3) || [0, 0, 0] : [0, 0, 0];
    bones.push({
      name: SK.fstr(t, 0) || `bone_${i}`,
      parent: t.fields[4] ? SK.i32(t.fields[4]) : -1,
      rig: t.fields[5] ? SK.i32(t.fields[5]) : -1,
      scale: tr ? SK.fstruct(tr, 0, 3) || [1, 1, 1] : [1, 1, 1],
      rot: quatFromEuler(e[0], e[1], e[2]),
      pos: tr ? SK.fstruct(tr, 2, 3) || [0, 0, 0] : [0, 0, 0],
    });
  }
  const byRig = [];
  bones.forEach((b, i) => { if (b.rig >= 0) byRig[b.rig] = i; });

  // --- materials (needed before the mesh, for the per-material UV bake)
  const materials = readTrmtr(get('.trmtr')).map((m) => ({
    name: m.name,
    layers: layerColors(m),
    uv: uvTransform(m),
    albedo: m.textures.BaseColorMap ? basename(m.textures.BaseColorMap) : null,
    mask: m.textures.LayerMaskMap ? basename(m.textures.LayerMaskMap) : null,
    alpha: m.alpha,
    // What it lights by itself (an eye's catchlight), and the mask the highlight follows.
    emission: emissionColors(m),
    highlight: m.textures.HighlightMaskMap ? basename(m.textures.HighlightMaskMap) : null,
  }));
  const matByName = new Map(materials.map((m) => [m.name, m]));

  // --- mesh layout: root[1] shapes; [0] name, [3] layouts ([0] attributes
  //     {[1] kind, [3] type, [4] offset}), [4] ranges {[0] count, [1] first, [3] material}
  const MS = openFb(get('.trmsh'));
  const shapes = [];
  const sv = MS.fvec(MS.root, 1);
  const SIZE = { 51: 12, 48: 8, 43: 8, 39: 8, 22: 4, 20: 4 };
  for (let e = 0; e < sv.n; e++) {
    const s = MS.ent(sv, e);
    const lay = MS.ent(MS.fvec(s, 3), 0);
    const av = MS.fvec(lay, 0);
    const attrs = [];
    for (let i = 0; i < av.n; i++) {
      const a = MS.ent(av, i);
      attrs.push({ kind: MS.fint(a, 1), type: MS.fint(a, 3), off: MS.fint(a, 4) });
    }
    const stride = attrs.reduce((m, a) => Math.max(m, a.off + (SIZE[a.type] || 4)), 0);
    const mv = MS.fvec(s, 4);
    const ranges = [];
    for (let i = 0; i < mv.n; i++) {
      const m = MS.ent(mv, i);
      ranges.push({ count: MS.fint(m, 0), first: MS.fint(m, 1), material: MS.fstr(m, 3) });
    }
    shapes.push({ name: MS.fstr(s, 0), attrs, stride, ranges });
  }

  // --- buffers: root[1], one entry per shape: [0] -> [{[0] index bytes}], [1] -> [{[0] vertex bytes}]
  const BF = openFb(get('.trmbf'));
  const bfv = BF.fvec(BF.root, 1);
  const out = [];
  shapes.forEach((s, e) => {
    const t = e < bfv.n ? BF.ent(bfv, e) : null;
    const one = (fi) => {
      const v = t && BF.fvec(t, fi);
      return v && v.n ? BF.fbytes(BF.ent(v, 0), 0) : null;
    };
    const idx = one(0), vtx = one(1);
    if (!idx || !vtx) return;
    const indices = new Uint16Array(idx.length >> 1);
    const idv = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
    for (let i = 0; i < indices.length; i++) indices[i] = idv.getUint16(i * 2, true);

    const V = Math.floor(vtx.length / s.stride);
    const dv = new DataView(vtx.buffer, vtx.byteOffset, vtx.byteLength);
    const A = {};
    for (const a of s.attrs) A[a.kind] = a;
    const positions = new Float32Array(V * 3);
    const normals = new Float32Array(V * 3);
    const uvs = new Float32Array(V * 2);
    const boneIndices = new Float32Array(V * 4); // floats: what the engine's vertex buffer wants
    const boneWeights = new Float32Array(V * 4);
    for (let v = 0; v < V; v++) {
      const o = v * s.stride;
      for (let k = 0; k < 3; k++) {
        if (A[1]) positions[v * 3 + k] = dv.getFloat32(o + A[1].off + k * 4, true);
        if (A[2]) normals[v * 3 + k] = half(dv.getUint16(o + A[2].off + k * 2, true));
      }
      if (A[6]) for (let k = 0; k < 2; k++) uvs[v * 2 + k] = dv.getFloat32(o + A[6].off + k * 4, true);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const rig = A[7] ? vtx[o + A[7].off + k] : 0;
        const bone = byRig[rig];
        boneIndices[v * 4 + k] = bone === undefined ? 0 : bone;
        const w = A[8] ? dv.getUint16(o + A[8].off + k * 2, true) / 65535 : (k === 0 ? 1 : 0);
        boneWeights[v * 4 + k] = bone === undefined ? 0 : w;
        sum += boneWeights[v * 4 + k];
      }
      // Normalise, or a limb collapses or bloats when skinned.
      for (let k = 0; k < 4; k++) boneWeights[v * 4 + k] = sum > 0 ? boneWeights[v * 4 + k] / sum : (k === 0 ? 1 : 0);
    }

    // Bake each material's UV transform into the vertices it owns, then flip V.
    const done = new Uint8Array(V);
    for (const r of s.ranges) {
      const u = (matByName.get(r.material) || { uv: { sx: 1, sy: 1, ox: 0, oy: 0, cx: 0, cy: 0 } }).uv;
      for (let i = r.first; i < r.first + r.count && i < indices.length; i++) {
        const v = indices[i];
        if (v >= V || done[v]) continue;
        done[v] = 1;
        const tu = (uvs[v * 2] - u.cx) * u.sx + u.cx + u.ox;
        const tv = (uvs[v * 2 + 1] - u.cy) * u.sy + u.cy + u.oy;
        uvs[v * 2] = tu;
        uvs[v * 2 + 1] = 1 - tv;
      }
    }
    out.push({ name: s.name, positions, normals, uvs, boneIndices, boneWeights, indices,
      ranges: s.ranges.map((r) => ({ first: r.first, count: r.count, material: r.material })) });
  });

  return { id, bones, shapes: out, materials };
}

/** Texture names a parsed form needs: every material's albedo and mask (and its highlight mask, if it lights one). */
export function textureNames(form) {
  const s = new Set();
  for (const m of form.materials) {
    if (m.albedo) s.add(m.albedo);
    if (m.mask) s.add(m.mask);
    if (m.highlight && m.emission?.highlight) s.add(m.highlight);
  }
  return [...s];
}

function basename(p) { return p.slice(p.lastIndexOf('/') + 1); }
