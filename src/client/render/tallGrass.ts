/**
 * Tall grass, the wild Pokémon's — not fur, and not faceted: tufts of a few thick strands (each smooth, tapered, curving
 * over, folded down its middle, dark at its root, light at its tip, shaded soft),
 * scattered thick over a patch, each a little turned, tilted and sized its own way — all one mesh drawn many times
 * over (thin instances): one draw for a whole patch.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/**
 * The grass pushed aside round your Pokémon: each tuft near it bent away from it (along the ground, out from its middle),
 * its strands' tips bent most, their roots not at all, flattened a little as they bend — the most right at it, none
 * out past PUSH_R (× its height). Its middle and size set each frame (pushAside).
 */
const PUSH = { x: 0, y: -1e5, z: 0, r: 0 };
const PUSH_R = 1.15, PUSH_BEND = 0.9;
class PushAsidePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'PushAside', 200, { PUSHASIDE: false });
    this._enable(true);
  }
  prepareDefines(defines: Record<string, unknown>): void { defines.PUSHASIDE = true; }
  getClassName(): string { return 'PushAsidePlugin'; }
  getUniforms() {
    return { ubo: [{ name: 'pushAt', size: 4, type: 'vec4' }], vertex: '#ifdef PUSHASIDE\nuniform vec4 pushAt;\n#endif' };
  }
  bindForSubMesh(ubo: UniformBuffer): void { ubo.updateFloat4('pushAt', PUSH.x, PUSH.y, PUSH.z, PUSH.r); }
  getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef PUSHASIDE
  {
    // (How high up its strand this point is: the tuft's own height, 0 at its root.)
    float pushUp = clamp(positionUpdated.y / ${PUSH_BEND.toFixed(2)}, 0.0, 1.0);
    vec2 pushD = worldPos.xz - pushAt.xz;
    float pushL = length(pushD);
    if (pushAt.w > 0.0 && pushL < pushAt.w && abs(worldPos.y - pushAt.y) < pushAt.w * 1.5) {
      float pushK = 1.0 - pushL / pushAt.w;
      pushK = pushK * pushK * (3.0 - 2.0 * pushK);
      vec2 pushDir = pushL > 0.001 ? pushD / pushL : vec2(0.0, -1.0);
      float bend = pushK * pushUp * pushUp;
      worldPos.xz += pushDir * bend * pushAt.w * 0.75;
      worldPos.y -= bend * positionUpdated.y * 0.45;
    }
  }
#endif
`,
    };
  }
}

/** Each frame: the grass pushed aside round `target()` (its feet, its height), or nowhere. */
export function pushAside(scene: Scene, target: () => { at: Vector3; h: number } | null): () => void {
  const obs = scene.onBeforeRenderObservable.add(() => {
    const t = target();
    if (!t) { PUSH.r = 0; return; }
    PUSH.x = t.at.x; PUSH.y = t.at.y; PUSH.z = t.at.z; PUSH.r = Math.max(0.5, t.h * PUSH_R);
  });
  return () => { scene.onBeforeRenderObservable.remove(obs); PUSH.r = 0; };
}

/** How many tufts a square unit holds; how many strands a tuft, how wide each at its root, how many sections up it. */
const DENSITY = 3, BLADES = 5, WIDTH = 0.16, SEGS = 4;
const ROOT: [number, number, number] = [0.1, 0.3, 0.1], TIP: [number, number, number] = [0.46, 0.76, 0.3];

let tuftMat: StandardMaterial | null = null;
/** The material every tuft wears: its colours its vertices'. */
function material(scene: Scene): StandardMaterial {
  // (Made again once a level that wore it is gone and took it with it.)
  if (tuftMat && tuftMat.getScene() === scene && scene.materials.includes(tuftMat)) return tuftMat;
  const m = new StandardMaterial('tallGrassTuft', scene);
  m.diffuseColor = new Color3(1, 1, 1); m.emissiveColor = new Color3(0.32, 0.32, 0.32);
  m.specularColor = Color3.Black(); m.backFaceCulling = false;
  new PushAsidePlugin(m);
  tuftMat = m;
  return m;
}

/**
 * One tuft, `h` tall at its tallest: a few thick strands round its root, each smooth — SEGS sections up it, curving out
 * and over, tapering to a point, folded a little down its middle (a ridge, for some body) — shaded soft: its normals
 * half its own face's, half straight up.
 */
function tuft(scene: Scene, h: number): Mesh {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const add = (p: Vector3, t: number) => {
    positions.push(p.x, p.y, p.z);
    const c = ROOT.map((r, i) => r + (TIP[i] - r) * Math.pow(t, 0.8));
    colors.push(c[0], c[1], c[2], 1);
    return positions.length / 3 - 1;
  };
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + (b % 2) * 0.5;
    const bh = h * (0.72 + 0.28 * ((b * 37) % 7) / 7), w = WIDTH * (0.85 + ((b * 13) % 3) * 0.12);
    const out = new Vector3(Math.cos(a), 0, Math.sin(a)), side = new Vector3(-out.z, 0, out.x);
    const lean = 0.2 + ((b * 29) % 5) * 0.05;
    // (Along it: its spine leaning out and curling over; its width tapering; its middle a touch proud — the fold.)
    const spine = (t: number) => out.scale(0.03 + lean * bh * t * t).add(new Vector3(0, bh * (t - 0.14 * t * t * t), 0));
    const rows: number[][] = [];
    for (let k = 0; k <= SEGS; k++) {
      const t = k / SEGS, half = (w / 2) * Math.pow(1 - t, 0.75), c = spine(t);
      const fold = out.scale(-half * 0.45);
      if (k === SEGS) { const tip = add(c, 1); rows.push([tip, tip, tip]); continue; }
      rows.push([add(c.add(side.scale(-half)), t), add(c.add(fold), t), add(c.add(side.scale(half)), t)]);
    }
    for (let k = 0; k < SEGS; k++) {
      const [a0, m0, b0] = rows[k], [a1, m1, b1] = rows[k + 1];
      indices.push(a0, a1, m0, m0, a1, m1, m0, m1, b0, b0, m1, b1);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  // (Soft: each normal half its face's, half straight up — the tuft shading as one mass, its strands still read.)
  for (let i = 0; i < normals.length; i += 3) {
    const n = new Vector3(normals[i], Math.abs(normals[i + 1]), normals[i + 2]).scale(0.5).add(new Vector3(0, 0.5, 0)).normalize();
    normals[i] = n.x; normals[i + 1] = n.y; normals[i + 2] = n.z;
  }
  const vd = new VertexData();
  vd.positions = positions; vd.normals = normals; vd.colors = colors; vd.indices = indices;
  const mesh = new Mesh('tallGrassTuft', scene);
  vd.applyToMesh(mesh);
  mesh.material = material(scene);
  mesh.isPickable = false;
  // (Not faded whole by the camera when it stands between it and a fighter: it's pushed aside round your Pokémon instead.)
  mesh.metadata = { ...(mesh.metadata ?? {}), noOcclude: true };
  return mesh;
}

/**
 * A patch of tall grass from x0 to x1 (z0 to z1) on ground at y, its tufts about `h` tall. One mesh, its tufts its
 * thin instances.
 */
export function tallGrassPatch(scene: Scene, x0: number, x1: number, y: number, z0: number, z1: number, h: number, seed = 1): Mesh {
  const mesh = tuft(scene, h);
  let s = (Math.abs(Math.floor(seed * 7919)) % 2147483646) + 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const n = Math.max(1, Math.round((x1 - x0) * (z1 - z0) * DENSITY));
  const buf = new Float32Array(n * 16);
  const m = new Matrix(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  // (Spread evenly, then jittered: no bald patches, no rows.)
  const cols = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / (z1 - z0))));
  const rows = Math.max(1, Math.ceil(n / cols));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) + rnd(), cz = Math.floor(i / cols) + rnd();
    pos.set(x0 + (cx / cols) * (x1 - x0), y, z0 + (cz / rows) * (z1 - z0));
    Quaternion.RotationYawPitchRollToRef(rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25, q);
    const k = 0.75 + rnd() * 0.5;
    scl.set(k, k * (0.85 + rnd() * 0.3), k);
    Matrix.ComposeToRef(scl, q, pos, m);
    m.copyToArray(buf, i * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
  return mesh;
}
