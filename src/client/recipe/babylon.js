// Build a live Babylon Pokémon from decoded recipe data (see loader.js), and
// play its animations.
//
//   const model = buildPokemon(BABYLON, scene, data, { shadowGenerator });
//   model.root.position.set(x, y, z);
//   await model.player.play('attack');      // resolves when a one-shot ends
//   model.player.play('idle');              // loops, crossfading in
//
// `B` is the Babylon namespace — the CDN global in the test page, or an object
// of the classes the game imports. Nothing here reaches for a global.
//
// COLOUR ON THE GPU. The albedo is only a brightness; the colour is up to five
// constants per material, picked per texel by the _lym mask. A material plugin
// composites them in the fragment shader at full texture resolution — the same
// stack the toolkit runs on the CPU (layer 0 under, R/G/B/A paint layers 1–4
// over it IN ORDER, the linear constant converted to sRGB, times the albedo).
// Babylon's own lighting, shadows, fog and skinning then apply on top.

import { sampleTrack as sample } from './tranm.js';

// --- the colour-layer material plugin ---------------------------------------------
const pluginClasses = new WeakMap();

function layerPluginClass(B) {
  if (pluginClasses.has(B)) return pluginClasses.get(B);
  class LayerCompositePlugin extends B.MaterialPluginBase {
    /**
     * @param layers five [r,g,b] linear constants or null (a null layer keeps what is under it)
     * @param flash  [r,g,b,amount], shared by every material of one Pokémon: the
     *               finished pixel is mixed toward that colour by `amount` (hit flash)
     */
    constructor(material, mask, layers, flash) {
      super(material, 'LayerComposite', 200, { LAYERCOMPOSITE: false });
      this.mask = mask;
      this.flash = flash;
      this.layers = layers.map((c) => (c ? [c[0], c[1], c[2], 1] : [0, 0, 0, 0]));
      if (!layers[0]) this.layers[0] = [1, 1, 1, 1];
      // `_isEnabled` is the plugin's own flag (the base class does not keep
      // it); `_enable` registers the shader hooks with the material — and
      // hardBindForSubMesh only if registerForExtraEvents is already set.
      this._isEnabled = true;
      this.registerForExtraEvents = true;
      this._enable(true);
    }
    getClassName() { return 'LayerCompositePlugin'; }
    prepareDefines(defines) { defines.LAYERCOMPOSITE = this._isEnabled; }
    getSamplers(samplers) { samplers.push('lymSampler'); }
    getActiveTextures(list) { if (this.mask) list.push(this.mask); }
    hasTexture(t) { return t === this.mask; }
    getUniforms() {
      return {
        ubo: [...[0, 1, 2, 3, 4].map((i) => ({ name: `lcLayer${i}`, size: 4, type: 'vec4' })),
          { name: 'lcFlash', size: 4, type: 'vec4' }],
        fragment: `#ifdef LAYERCOMPOSITE
          uniform vec4 lcLayer0; uniform vec4 lcLayer1; uniform vec4 lcLayer2; uniform vec4 lcLayer3; uniform vec4 lcLayer4;
          uniform vec4 lcFlash;
        #endif`,
      };
    }
    bindForSubMesh(ubo) {
      if (!this._isEnabled) return;
      ubo.setTexture('lymSampler', this.mask);
    }
    // Called on every draw, even when Babylon decides the material needn't
    // rebind. Many materials share one compiled shader, so without this a
    // draw can read the mask left bound by the previous material. The layer
    // and flash constants go here too, so live changes always reach the GPU
    // (the material's uniform buffer is uploaded after this, every draw).
    hardBindForSubMesh(ubo, scene, engine, subMesh) {
      if (!this._isEnabled) return;
      this.layers.forEach((c, i) => ubo.updateFloat4(`lcLayer${i}`, c[0], c[1], c[2], c[3]));
      const f = this.flash;
      ubo.updateFloat4('lcFlash', f[0], f[1], f[2], f[3]);
      const effect = subMesh.effect;
      if (effect) effect.setTexture('lymSampler', this.mask);
    }
    getCustomCode(shaderType) {
      if (shaderType !== 'fragment') return null;
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef LAYERCOMPOSITE
          uniform sampler2D lymSampler;
          vec3 lcToSRGB(vec3 v) {
            return mix(v * 12.92, 1.055 * pow(max(v, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), v));
          }
        #endif`,
        // baseColor holds the albedo sample here (DIFFUSE is on: the albedo is the diffuse texture).
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef LAYERCOMPOSITE
          {
            float lcLum = baseColor.r;
            vec4 lcMask = texture2D(lymSampler, vDiffuseUV);
            vec3 lcLin = lcLayer0.rgb;
            lcLin = mix(lcLin, lcLayer1.rgb, lcMask.r * lcLayer1.a);
            lcLin = mix(lcLin, lcLayer2.rgb, lcMask.g * lcLayer2.a);
            lcLin = mix(lcLin, lcLayer3.rgb, lcMask.b * lcLayer3.a);
            lcLin = mix(lcLin, lcLayer4.rgb, lcMask.a * lcLayer4.a);
            baseColor.rgb = lcToSRGB(lcLin) * lcLum;
          }
        #endif`,
        // After lighting and fog: the flash covers the shading, like a hit
        // flash in a sprite game, but keeps a little of the form.
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef LAYERCOMPOSITE
          color.rgb = mix(color.rgb, lcFlash.rgb * (0.82 + 0.18 * dot(color.rgb, vec3(0.333))), lcFlash.a);
        #endif`,
      };
    }
  }
  pluginClasses.set(B, LayerCompositePlugin);
  return LayerCompositePlugin;
}

// --- textures ----------------------------------------------------------------------
function makeTexture(B, scene, name, img) {
  const t = B.RawTexture.CreateRGBATexture(img.rgba, img.width, img.height, scene,
    true /* mipmaps */, false /* invertY: V is already flipped in the vertices */,
    B.Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  // The game samples U mirrored (a U scale of 2 folds one half of the atlas
  // over both sides of the animal) and V wrapped (V's integer part picks a band).
  t.wrapU = B.Texture.MIRROR_ADDRESSMODE;
  t.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return t;
}

// --- the model ---------------------------------------------------------------------
// Which shapes are drawn is animated: each clip's .tracm (tracm.js) switches
// them on and off per frame — Blastoise's water jets, the vine whips
// (Bulbasaur's "tuta", Venusaur's vine, Chikorita's), alternate eyes, mouths,
// eyelids, open and folded wings, Mega Blastoise's cannons vs its closed shell.
// The player applies that every frame. A shape the idle hides is a PROP: kept
// out of the model's meshes and bounds (drawn, Blastoise floated on its jets)
// and off until a clip turns it on.
//
// A shape no idle track covers falls back to its name: these are hidden.
const HIDDEN_PROP = /_(jet|vine|left_vine|right_vine|left_tuta|right_tuta|thread|longtongue|openmouth|left_wingclose|right_wingclose)_mesh/;

/**
 * @param {any} B  the Babylon classes (namespace or an object of imports)
 * @param {any} scene
 * @param {any} data  what loadPokemon resolved to
 * @param {{ shadowGenerator?: any }} [opts]
 */
export function buildPokemon(B, scene, data, { shadowGenerator = null } = {}) {
  const { form } = data;
  const id = form.id;
  const Plugin = layerPluginClass(B);

  const root = new B.TransformNode(`pokemon_${id}`, scene);
  // The data is right-handed, Y-up (like glTF); Babylon is left-handed. Same
  // conversion the glTF loader uses: turn about Y and mirror Z.
  const conv = new B.TransformNode(`${id}_handedness`, scene);
  conv.parent = root;
  conv.rotationQuaternion = B.Quaternion.FromEulerAngles(0, Math.PI, 0);
  conv.scaling = new B.Vector3(1, 1, -1);

  // Skeleton: every entry in array order (parents come first), so a vertex's
  // remapped bone index is its position here.
  const skeleton = new B.Skeleton(`${id}_skeleton`, `${id}_skeleton`, scene);
  const bones = [];
  for (const b of form.bones) {
    const local = B.Matrix.Compose(new B.Vector3(...b.scale), new B.Quaternion(...b.rot), new B.Vector3(...b.pos));
    bones.push(new B.Bone(b.name, skeleton, b.parent >= 0 ? bones[b.parent] : null, local, local.clone()));
  }

  // Textures and materials.
  const textures = new Map();
  const tex = (name) => {
    if (!name || !data.textures[name]) return null;
    if (!textures.has(name)) textures.set(name, makeTexture(B, scene, name, data.textures[name]));
    return textures.get(name);
  };
  const white = B.RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false);
  const black = B.RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 0]), 1, 1, scene, false);
  const materials = new Map();
  const flash = [1, 1, 1, 0];
  for (const m of form.materials) {
    const mat = new B.StandardMaterial(`${id}_${m.name}`, scene);
    mat.diffuseTexture = tex(m.albedo) || white;
    mat.specularColor = new B.Color3(0.08, 0.08, 0.08);
    mat.specularPower = 24;
    new Plugin(mat, tex(m.mask) || black, m.layers, flash);
    materials.set(m.name, mat);
  }

  // Meshes: one per shape, a sub-mesh per material range.
  const meshes = [];
  const props = [];
  const shown = []; // every shape the clips switch on and off: { name, mesh, base }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const clipList = Object.values(data.clips || {});
  const idleVis = (data.clips.idle || data.clips.airIdle || {}).vis || {};
  for (const s of form.shapes) {
    const switched = clipList.some((c) => c.vis && c.vis[s.name]);
    // Drawn when no clip says otherwise: as the idle has it, else by name.
    const base = idleVis[s.name] ? idleVis[s.name][0] === 1 : !HIDDEN_PROP.test(s.name);
    const prop = !base;
    const mesh = new B.Mesh(`${id}_${s.name}`, scene);
    if (switched || prop) shown.push({ name: s.name, mesh, base });
    const vd = new B.VertexData();
    vd.positions = s.positions;
    vd.normals = s.normals;
    vd.uvs = s.uvs;
    vd.indices = s.indices;
    vd.matricesIndices = s.boneIndices;
    vd.matricesWeights = s.boneWeights;
    vd.applyToMesh(mesh);
    mesh.parent = conv;
    mesh.skeleton = skeleton;
    mesh.numBoneInfluencers = 4;
    // Front faces. Trinity winds them counter-clockwise (like glTF), and the
    // handedness node's Z mirror reverses that once more, so they arrive
    // clockwise. It must be set on the MESH: with a MultiMaterial Babylon reads
    // the orientation from the mesh, not the sub-materials. Wrong, it culls the
    // outside and you see the model from within — Gardevoir's green gown
    // lining, the back of Charizard's belly, its wings' orange outer side.
    mesh.overrideMaterialSideOrientation = B.Material.ClockWiseSideOrientation;
    // Skinned meshes keep their rest-pose bounds; an attack can reach past
    // them, so never let the camera cull the animal mid-move.
    mesh.alwaysSelectAsActiveMesh = true;
    const multi = new B.MultiMaterial(`${id}_${s.name}_mats`, scene);
    mesh.subMeshes = [];
    const V = s.positions.length / 3;
    s.ranges.forEach((r, i) => {
      multi.subMaterials.push(materials.get(r.material) || null);
      new B.SubMesh(i, 0, V, r.first, r.count, mesh);
    });
    mesh.material = multi;
    if (prop) {
      // Off until a clip turns it on; not part of the body's bounds or meshes.
      mesh.setEnabled(false);
      if (shadowGenerator) shadowGenerator.addShadowCaster(mesh);
      mesh.receiveShadows = true;
      props.push({ name: s.name, mesh, boneIndices: s.boneIndices, boneWeights: s.boneWeights });
      continue;
    }
    for (let i = 0; i < s.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], s.positions[i + k]); hi[k] = Math.max(hi[k], s.positions[i + k]);
    }
    if (shadowGenerator) shadowGenerator.addShadowCaster(mesh);
    mesh.receiveShadows = true;
    meshes.push(mesh);
  }

  const player = new AnimationPlayer(B, scene, bones, form.bones, data.clips, shown);
  const height = hi[1] - lo[1];
  // Put the lowest point of the rest pose on the root's origin, so placing
  // the root on a surface stands the Pokémon on it.
  conv.position.y = -lo[1];

  return {
    id, root, meshes, skeleton, player, height,
    /** Shapes the idle hides (vines, jets, open wings, an open mouth…): drawn only while a clip turns them on. */
    props,
    /** rest-pose bounds in the model's own (right-handed) space, metres */
    restBounds: { min: lo, max: hi },
    /** Recolour a layer live — shinies, tints, status flashes. */
    setLayer(materialName, layer, rgb) {
      const mat = materials.get(materialName);
      const p = mat && mat.pluginManager && mat.pluginManager.getPlugin('LayerComposite');
      if (p) p.layers[layer] = [rgb[0], rgb[1], rgb[2], 1];
    },
    materialNames: [...materials.keys()],
    /**
     * Raise the body above the root by `y` (in the root's units, metres of the
     * model) — the game's ground clamp lifts a clip that would sink the skin
     * into the floor. 0 = the rest pose's feet on the root.
     */
    setLift(y) { conv.position.y = -lo[1] + y; },
    /** Mix the whole Pokémon toward `rgb` by `amount` (0 = off). */
    setFlash(rgb, amount) {
      flash[0] = rgb[0]; flash[1] = rgb[1]; flash[2] = rgb[2]; flash[3] = amount;
    },
    dispose() {
      player.dispose();
      meshes.forEach((m) => m.dispose());
      props.forEach((p) => p.mesh.dispose());
      skeleton.dispose();
      materials.forEach((m) => m.dispose(true, true));
      textures.forEach((t) => t.dispose());
      white.dispose(); black.dispose();
      root.dispose();
    },
  };
}

// --- animation -------------------------------------------------------------------
// Drives the bones from the decoded tracks directly: no Babylon Animation
// objects, so a clip costs nothing until it plays. Each frame starts from the
// rest pose, applies the clip, blends from the previous pose during a
// crossfade, and writes the bones.
const STRIDE = 10; // pos 3, rot 4, scale 3 per bone

export class AnimationPlayer {
  constructor(B, scene, babylonBones, restBones, clips, shown = []) {
    this.B = B;
    this.scene = scene;
    this.bones = babylonBones;
    this.shown = shown;
    this.hideAll = false;
    this.N = restBones.length;
    this.rest = new Float32Array(this.N * STRIDE);
    restBones.forEach((b, i) => this.rest.set([...b.pos, ...b.rot, ...b.scale], i * STRIDE));
    this.pose = this.rest.slice();
    this.from = this.rest.slice();
    const byName = new Map(restBones.map((b, i) => [b.name, i]));

    this.clips = new Map();
    for (const [action, c] of Object.entries(clips)) {
      const bind = [];
      for (const t of c.tracks) {
        const bone = byName.get(t.bone);
        if (bone === undefined) continue;
        // Root motion: `origin` carries the clip's travel. The game moves the
        // animal itself, so drop it and keep the rest offset.
        const pos = restBones[bone].name === 'origin' ? null : t.pos;
        bind.push({ bone, rot: t.rot, pos, scale: t.scale, cr: { k: 0 }, cp: { k: 0 }, cs: { k: 0 } });
      }
      // Per switched shape, its on/off by frame in this clip (null: as at rest).
      const vis = shown.map((s) => (c.vis && c.vis[s.name]) || null);
      this.clips.set(action, { action, name: c.name, frames: c.frames, fps: c.fps, loop: c.loop,
        duration: Math.max(1, c.frames - 1) / c.fps, bind, vis });
    }

    this.active = null;
    this.time = 0;
    this.speed = 1;
    this.fade = 0;
    this.fadeDur = 0;
    this._done = null;
    this._v = new B.Vector3(); this._q = new B.Quaternion(); this._s = new B.Vector3();
    this._tmp = new Float32Array(4);
    this._obs = scene.onBeforeAnimationsObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000));
  }

  has(action) { return this.clips.has(action); }

  /**
   * Play an action. Loops by default if the clip is a `_loop` clip. Resolves
   * when a one-shot reaches its last frame (it then holds that frame), or
   * when a looping clip is replaced.
   */
  play(action, { loop, fade = 0.18, speed = 1 } = {}) {
    const clip = this.clips.get(action);
    if (!clip) return Promise.resolve(false);
    if (this._done) { this._done(true); this._done = null; }
    this.from.set(this.pose);
    this.active = clip;
    this.loop = loop === undefined ? clip.loop : loop;
    this.time = 0;
    this.speed = speed;
    this.fadeDur = fade;
    this.fade = fade > 0 ? 0 : 1;
    for (const b of clip.bind) { b.cr.k = 0; b.cp.k = 0; b.cs.k = 0; }
    return new Promise((res) => { this._done = res; });
  }

  update(dt) {
    const clip = this.active;
    if (!clip) return;
    this.time += dt * this.speed;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / Math.max(1e-3, this.fadeDur));
    let t = this.time;
    if (this.loop) {
      if (t >= clip.duration) { t %= clip.duration; this.time = t; for (const b of clip.bind) { b.cr.k = 0; b.cp.k = 0; b.cs.k = 0; } }
    } else if (t >= clip.duration) {
      t = clip.duration;
      if (this._done) { const d = this._done; this._done = null; d(true); }
    }
    const frame = t * clip.fps;

    const P = this.pose, R = this.rest, tmp = this._tmp;
    P.set(R);
    for (const b of clip.bind) {
      const o = b.bone * STRIDE;
      if (b.pos) { sample(b.pos, frame, 3, tmp, b.cp); P[o] = tmp[0]; P[o + 1] = tmp[1]; P[o + 2] = tmp[2]; }
      if (b.rot) { sample(b.rot, frame, 4, tmp, b.cr); P[o + 3] = tmp[0]; P[o + 4] = tmp[1]; P[o + 5] = tmp[2]; P[o + 6] = tmp[3]; }
      if (b.scale) { sample(b.scale, frame, 3, tmp, b.cs); P[o + 7] = tmp[0]; P[o + 8] = tmp[1]; P[o + 9] = tmp[2]; }
    }
    if (this.fade < 1) blendPose(P, this.from, smooth(this.fade), this.N);
    this._apply(P);
    this._show(clip, frame);
  }

  /** Which shapes are drawn at this frame of the clip. */
  _show(clip, frame) {
    const k = Math.round(frame);
    this.shown.forEach((s, i) => {
      const v = clip.vis[i];
      const on = !this.hideAll && (v ? v[Math.min(k, v.length - 1)] === 1 : s.base);
      if (s.mesh.isEnabled(false) !== on) s.mesh.setEnabled(on);
    });
  }

  /** Is shape `name` drawn `t` s into `action`? (Unswitched shapes always are.) */
  shownAt(action, t, name) {
    const clip = this.clips.get(action);
    const i = this.shown.findIndex((s) => s.name === name);
    if (i < 0) return true;
    const v = clip && clip.vis[i];
    if (!v) return this.shown[i].base;
    return v[Math.min(Math.round(Math.max(0, Math.min(t, clip.duration)) * clip.fps), v.length - 1)] === 1;
  }

  /** Put pose P on the bones. */
  _apply(P) {
    for (let i = 0; i < this.N; i++) {
      const o = i * STRIDE, bone = this.bones[i];
      this._v.set(P[o], P[o + 1], P[o + 2]);
      this._q.set(P[o + 3], P[o + 4], P[o + 5], P[o + 6]);
      this._s.set(P[o + 7], P[o + 8], P[o + 9]);
      bone.position = this._v;
      bone.rotationQuaternion = this._q;
      bone.scaling = this._s;
    }
  }

  /**
   * Look ahead: pose the bones as `action` stands `t` s in, call fn (which can
   * read the bones), then put the live pose back. Nothing is played.
   */
  peek(action, t, fn) {
    const clip = this.clips.get(action);
    if (!clip) return;
    const P = this.rest.slice(), tmp = this._tmp;
    const frame = Math.max(0, Math.min(t, clip.duration)) * clip.fps;
    for (const b of clip.bind) {
      const o = b.bone * STRIDE;
      if (b.pos) { sample(b.pos, frame, 3, tmp); P[o] = tmp[0]; P[o + 1] = tmp[1]; P[o + 2] = tmp[2]; }
      if (b.rot) { sample(b.rot, frame, 4, tmp); P[o + 3] = tmp[0]; P[o + 4] = tmp[1]; P[o + 5] = tmp[2]; P[o + 6] = tmp[3]; }
      if (b.scale) { sample(b.scale, frame, 3, tmp); P[o + 7] = tmp[0]; P[o + 8] = tmp[1]; P[o + 9] = tmp[2]; }
    }
    this._apply(P);
    try { fn(); } finally { this._apply(this.pose); }
  }

  dispose() {
    if (this._obs) this.scene.onBeforeAnimationsObservable.remove(this._obs);
    this._obs = null;
    this.active = null;
  }
}

const smooth = (x) => x * x * (3 - 2 * x);

/** P = lerp(from, P, w), with quaternions taken the short way and renormalised. */
function blendPose(P, from, w, N) {
  for (let i = 0; i < N; i++) {
    const o = i * STRIDE;
    for (const k of [0, 1, 2, 7, 8, 9]) P[o + k] = from[o + k] + (P[o + k] - from[o + k]) * w;
    const d = from[o + 3] * P[o + 3] + from[o + 4] * P[o + 4] + from[o + 5] * P[o + 5] + from[o + 6] * P[o + 6];
    const s = d < 0 ? -1 : 1;
    let L = 0;
    for (let k = 3; k <= 6; k++) { P[o + k] = from[o + k] + (P[o + k] * s - from[o + k]) * w; L += P[o + k] * P[o + k]; }
    L = Math.sqrt(L) || 1;
    for (let k = 3; k <= 6; k++) P[o + k] /= L;
  }
}
