// Worker: fetch one form's raw files from the recipe server and decode them —
// mesh, skeleton, materials, BC7 textures, the requested animation clips — so
// the main thread (and the loading screen) never stalls. Everything comes back
// as typed arrays moved, not copied, across the boundary.
//
// in:  { id, base, clips: { action: [clip name candidates...] }, shiny }
// out: { type: 'progress', loaded, total }  …then
//      { type: 'done', form, textures, clips, stats }  or  { type: 'error', message }

import { parseForm, textureNames } from './form.js';
import { readBntx } from './bntx.js';
import { decodeSurface } from './bcn.js';
import { readTranm } from './tranm.js';
import { readTracm } from './tracm.js';
import { readTraef } from './traef.js';

// Ground performances only: 000xx–006xx is "on the ground" (the doc's §1.3).
const GROUND = /^00[0-6]\d\d_/;
// In the air (legs hanging, wings beating): 200xx–206xx. A candidate written
// "air:<name>" takes only these, so species without an air set skip it.
const AIR = /^20[0-6]\d\d_/;

self.onmessage = async ({ data: { id, base = '', clips = {}, shiny = false } }) => {
  const t0 = performance.now();
  let bytes = 0, loaded = 0, total = 0;
  const progress = () => self.postMessage({ type: 'progress', loaded, total });
  const fetchBytes = async (name) => {
    const r = await fetch(`${base}/recipe/${id}/file/${name}`);
    if (!r.ok) throw new Error(`${id}/${name}: HTTP ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    bytes += b.length;
    loaded++;
    progress();
    return b;
  };
  try {
    const mr = await fetch(`${base}/recipe/${id}/manifest`);
    if (!mr.ok) throw new Error(`${id}: no such form (HTTP ${mr.status})`);
    const manifest = await mr.json();
    const have = new Set(manifest.files);

    // Resolve each action to one clip file: the first candidate that exists,
    // preferring the ground performance.
    const prefix = `${id}_`;
    const clipFiles = {};
    for (const [action, names] of Object.entries(clips)) {
      for (const cand of names) {
        const air = cand.startsWith('air:');
        const want = air ? cand.slice(4) : cand;
        const keys = manifest.files.filter((f) => f.endsWith('.tranm'))
          .map((f) => f.slice(prefix.length, -'.tranm'.length))
          .filter((k) => k.replace(/^\d{5}_/, '') === want);
        const key = air ? keys.find((k) => AIR.test(k)) : keys.find((k) => GROUND.test(k)) || keys[0];
        if (key) {
          const vis = `${prefix}${key}.tracm`;
          const ev = `${prefix}${key}.traef`;
          clipFiles[action] = { key, file: `${prefix}${key}.tranm`, vis: have.has(vis) ? vis : null, events: have.has(ev) ? ev : null, loop: /_loop$/.test(want) };
          break;
        }
      }
    }

    // A shiny wears its own material file (the same textures, recoloured), in place of the usual one.
    const rare = `${id}_rare.trmtr`;
    const useRare = shiny && have.has(rare);
    const modelNames = ['.trskl', '.trmsh', '.trmbf', '.trmtr'].map((e) => (useRare && e === '.trmtr' ? rare : id + e));
    const clipCount = Object.values(clipFiles).reduce((n, c) => n + 1 + (c.vis ? 1 : 0) + (c.events ? 1 : 0), 0);
    total = modelNames.length + clipCount; // textures added once known
    progress();

    // Model files and clips in parallel; textures as soon as materials are read.
    // Each clip brings its shapes' visibility (tracm.js) when it has one.
    const modelP = Promise.all(modelNames.map((n) => fetchBytes(n).then((b) => [n, b])));
    const clipP = Promise.all(Object.entries(clipFiles).map(async ([action, c]) => {
      const [anim, vis, ev] = await Promise.all([fetchBytes(c.file), c.vis ? fetchBytes(c.vis) : null, c.events ? fetchBytes(c.events) : null]);
      // (Its events — sounds, triggers, the joints they follow — when it has them: traef.js.)
      let events = [];
      try { events = ev ? readTraef(ev).events : []; } catch { events = []; }
      return [action, { name: c.key, loop: c.loop, ...readTranm(anim), vis: vis ? readTracm(vis).shapes : {}, events }];
    }));

    const form = parseForm(id, new Map((await modelP).map(([n, b]) => [n === rare ? `${id}.trmtr` : n, b])));
    const texNames = textureNames(form).filter((n) => have.has(n));
    total += texNames.length;
    progress();
    const textures = {};
    await Promise.all(texNames.map(async (n) => {
      const t = readBntx(await fetchBytes(n));
      if (!t.data) return;
      const img = decodeSurface(t);
      textures[n] = { width: img.width, height: img.height, rgba: img.rgba };
    }));
    const clipList = Object.fromEntries(await clipP);

    // Move every typed array's buffer, once each.
    const transfer = new Set();
    for (const s of form.shapes) for (const k of ['positions', 'normals', 'uvs', 'boneIndices', 'boneWeights', 'indices']) transfer.add(s[k].buffer);
    for (const t of Object.values(textures)) transfer.add(t.rgba.buffer);
    for (const c of Object.values(clipList)) {
      for (const tr of c.tracks) for (const k of ['rot', 'pos', 'scale']) {
        if (tr[k]) { transfer.add(tr[k].values.buffer); if (tr[k].keys) transfer.add(tr[k].keys.buffer); }
      }
      for (const v of Object.values(c.vis)) transfer.add(v.buffer);
    }
    self.postMessage({ type: 'done', form, textures, clips: clipList,
      stats: { bytes, ms: Math.round(performance.now() - t0), files: loaded } }, [...transfer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
