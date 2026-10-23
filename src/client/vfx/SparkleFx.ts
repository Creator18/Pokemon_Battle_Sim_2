/**
 * Sparkles popping off a Fairy aura: stars after Arthur Stammet's "Starfield
 * Flight" (Shadertoy) — a bright core, a thin four-point flare across it and
 * a fainter one turned 45°, all falling off into a soft halo, each in its own
 * tint (his Colorize: a little red, green and blue, some yellow, some white,
 * the bigger the bluer), shifted toward the Fairy's pinks and whites.
 *
 * They are emitted from points of the body just outside its aura's outline,
 * drift outward, twinkle and turn a little, and pop as they go — a quick
 * swell, then gone. All of them one mesh, rebuilt each frame (billboards
 * facing the camera), drawn over the aura in its unit's front layer (UnitFx.addOver).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';

/** At most this many at once; this many born a second; each lives this long (s), a share of it more or less. */
const MAX = 48, RATE = 22, LIFE = 0.8, LIFE_SPREAD = 0.35;
/** Their sizes (× the body's height, the quad's half width), how far out they start (past the skin) and drift over their life (× height). */
const SIZE: [number, number] = [0.07, 0.17], START_OUT = 0.12, DRIFT = 0.35;
/** The pop: over the last share of its life it swells this much more and goes. */
const POP_AT = 0.78, POP_SWELL = 0.9;
/** His star: its halo's inner edge, its rays' thinness, its brightness and saturation, its warmth and coldness. */
const HALO = 0.4, THIN = 500, BRIGHT = 0.8, SAT = 0.9, WARM = 0.2, COLD = 0.3;
/** Shifted toward the Fairy: how far each tint is drawn toward pink or white. */
const PINK = [1.0, 0.55, 0.82], TOWARD = 0.55;

Effect.ShadersStore.sparkleVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec2 vUV;
varying vec4 vCol;
void main(void) {
  vUV = uv;
  vCol = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;
Effect.ShadersStore.sparkleFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec4 vCol;
mat2 Rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
// His Star(): the core, the cross, the turned cross, the halo.
float star(vec2 uv, float flare) {
  float d = length(uv);
  float m = 0.05 / max(d, 1e-3);
  float rays = max(0.0, 1.0 - abs(uv.x * uv.y * ${THIN.toFixed(1)}));
  m += rays * flare;
  uv *= Rot(3.1415 / 4.0);
  rays = max(0.0, 1.0 - abs(uv.x * uv.y * ${THIN.toFixed(1)}));
  m += rays * 0.3 * flare;
  m *= smoothstep(1.0, ${HALO.toFixed(2)}, d * 2.0);
  return m;
}
void main(void) {
  // (The quad spans -0.5..0.5; its star a little turned, its colour's alpha its life.)
  float m = star(vUV - 0.5, 1.0) * vCol.a;
  if (m < 0.004) discard;
  vec3 c = vCol.rgb * m;
  // (Premultiplied, added together: its layer lays it on over the aura.)
  gl_FragColor = vec4(c, min(1.0, m));
}`;

/** His Colorize, for one star's random r: its tint before the Fairy's shift. */
function colorize(r: number): [number, number, number] {
  const f = (k: number) => Math.sin(r * k) * 0.5 + 0.5;
  const rR = r * 0.4 * f(123.456), rG = r * 0.4 * f(234.567), rB = r * 0.2 * f(345.678);
  const rY = r * WARM * f(456.78), rW = r * BRIGHT * f(567.89);
  return [rR * SAT + rW + rY, rG * SAT + rW + rY, rB * SAT + rW];
}

type Spark = { at: Vector3; out: Vector3; age: number; life: number; size: number; spin: number; tw: number; col: [number, number, number] };

export class SparkleFx {
  private readonly mesh: Mesh;
  private readonly pos = new Float32Array(MAX * 4 * 3);
  private readonly col = new Float32Array(MAX * 4 * 4);
  private sparks: Spark[] = [];
  private owed = 0;
  private letGo = false;
  private gone!: () => void;
  private readonly over = new Promise<void>((r) => { this.gone = r; });
  private readonly stop: () => void;

  /**
   * `skin`: a point of the body (world) picked at random, and the body's
   * middle and height now; `light`: how it is laid over the aura (UnitFx.addOver),
   * returning its undo.
   */
  constructor(private readonly scene: Scene,
    private readonly skin: () => { point: Vector3; middle: Vector3; height: number } | null,
    light?: (mesh: Mesh) => () => void) {
    this.mesh = new Mesh('sparkles', scene);
    const uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i < MAX; i++) {
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const vd = new VertexData();
    vd.positions = Array.from(this.pos);
    vd.uvs = uvs;
    vd.colors = Array.from(this.col);
    vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    const mat = new ShaderMaterial('sparkleMat', scene, { vertex: 'sparkle', fragment: 'sparkle' }, {
      attributes: ['position', 'uv', 'color'], uniforms: ['viewProjection'], needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    // (Premultiplied, so it writes its alpha too: its layer is laid on by its alpha — additive leaves that at nothing.)
    mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    this.mesh.material = mat;
    const undo = light?.(this.mesh);
    const obs = scene.onBeforeActiveMeshesEvaluationObservable.add(() => this.update());
    this.stop = () => { scene.onBeforeActiveMeshesEvaluationObservable.remove(obs); undo?.(); mat.dispose(); this.mesh.dispose(); };
  }

  private update(): void {
    const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
    // Born off the body, outside its aura.
    if (!this.letGo) {
      this.owed += RATE * dt;
      for (; this.owed >= 1; this.owed -= 1) {
        if (this.sparks.length >= MAX) break;
        const s = this.skin();
        if (!s) break;
        const out = s.point.subtract(s.middle);
        if (out.lengthSquared() < 1e-6) out.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5);
        out.normalize();
        const r = Math.random();
        const tint = colorize(0.6 + 0.4 * r);
        const toward = Math.random() < 0.5 ? PINK : [1, 1, 1];
        const big = Math.random();
        const col = tint.map((c, k) => (c + (toward[k] - c) * TOWARD) * (k === 2 ? 1 + big * COLD : 1)) as [number, number, number];
        this.sparks.push({
          at: s.point.add(out.scale(START_OUT * s.height)), out: out.scale(DRIFT * s.height),
          age: 0, life: LIFE * (1 - LIFE_SPREAD / 2 + LIFE_SPREAD * Math.random()),
          size: s.height * (SIZE[0] + (SIZE[1] - SIZE[0]) * big), spin: (Math.random() - 0.5) * 2, tw: Math.random() * 6.28, col,
        });
      }
    }
    for (const s of this.sparks) s.age += dt;
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    // Billboards: each a quad facing the camera.
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const right = cam.getDirection(Vector3.Right()), up = cam.getDirection(Vector3.Up());
    this.pos.fill(0); this.col.fill(0);
    this.sparks.forEach((s, i) => {
      const k = s.age / s.life;
      // In fast, twinkling, then the pop: a quick swell and gone.
      const grow = Math.min(1, k / 0.15);
      const pop = k > POP_AT ? (k - POP_AT) / (1 - POP_AT) : 0;
      const scale = s.size * grow * grow * (1 + POP_SWELL * pop * pop);
      const bright = grow * (0.75 + 0.25 * Math.sin(s.tw + s.age * 18)) * (1 - pop * pop);
      const c = s.at.add(s.out.scale(1 - (1 - k) * (1 - k)));
      const a = s.spin * s.age;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = right.scale(ca).add(up.scale(sa)), ry = up.scale(ca).subtract(right.scale(sa));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(([x, y], v) => {
        const p = c.add(rx.scale(x * scale)).add(ry.scale(y * scale));
        this.pos.set([p.x, p.y, p.z], (i * 4 + v) * 3);
        this.col.set([s.col[0], s.col[1], s.col[2], bright], (i * 4 + v) * 4);
      });
    });
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.pos);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.col);
    // (Its bounds follow its stars: culled by them, it would not show at all.)
    this.mesh.refreshBoundingInfo();
    if (this.letGo && this.sparks.length === 0) { this.stop(); this.gone(); }
  }

  /** Stop emitting; resolves once the last of them has popped. */
  release(): Promise<void> {
    this.letGo = true;
    return this.over;
  }
}
