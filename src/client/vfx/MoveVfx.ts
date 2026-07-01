/**
 * MoveVfx — per-move-type particle bursts fired along an arc from attacker to
 * target, camera shake on strong hits, floating GUI damage numbers, and KO puff.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { Control } from '@babylonjs/gui/2D/controls/control';

import { flareTexture } from '../render/textures.ts';
import { hexToRgb, typeColor } from '../theme.ts';

interface TypeStyle {
  color: string;
  color2: string;
  rate: number;
  gravity: number;
  spread: number;
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  Electric: { color: '#FDE047', color2: '#FACC15', rate: 300, gravity: 0, spread: 0.6 },
  Fire: { color: '#FB923C', color2: '#EF4444', rate: 280, gravity: 1, spread: 0.5 },
  Water: { color: '#60A5FA', color2: '#2563EB', rate: 260, gravity: -1, spread: 0.5 },
  Ice: { color: '#A5F3FC', color2: '#22D3EE', rate: 200, gravity: 2, spread: 0.7 },
  Ghost: { color: '#C084FC', color2: '#7E22CE', rate: 160, gravity: -0.5, spread: 0.8 },
  Fighting: { color: '#F87171', color2: '#B91C1C', rate: 220, gravity: 0, spread: 0.4 },
  Psychic: { color: '#F0ABFC', color2: '#EC4899', rate: 240, gravity: 0, spread: 0.9 },
  Dark: { color: '#6B7280', color2: '#1F2937', rate: 180, gravity: 0, spread: 0.7 },
  Steel: { color: '#CBD5E1', color2: '#64748B', rate: 220, gravity: 1, spread: 0.5 },
  Fairy: { color: '#F9A8D4', color2: '#F472B6', rate: 200, gravity: -0.5, spread: 0.7 },
  Poison: { color: '#C084FC', color2: '#7E22CE', rate: 200, gravity: 0.5, spread: 0.6 },
  Normal: { color: '#E5E7EB', color2: '#9CA3AF', rate: 200, gravity: 0, spread: 0.5 },
};

export class MoveVfx {
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private ui: AdvancedDynamicTexture;

  constructor(scene: Scene, camera: ArcRotateCamera) {
    this.scene = scene;
    this.camera = camera;
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI('vfxUI', true, scene);
    this.ui.layer && (this.ui.layer.layerMask = 0x0fffffff);
  }

  private style(moveType: string): TypeStyle {
    return TYPE_STYLES[moveType] ?? TYPE_STYLES.Normal;
  }

  /** Fire a burst of particles that travels from attacker to target. */
  async playMove(moveType: string, from: Vector3, to: Vector3, strong: boolean): Promise<void> {
    const st = this.style(moveType);
    const dir = to.subtract(from);
    const dist = dir.length();
    const steps = Math.max(1, Math.round(dist * 3));
    const dur = 240 + dist * 30;

    // Traveling projectile emitter along an arc.
    const ps = new ParticleSystem(`vfx_${moveType}_${Math.random()}`, 400, this.scene);
    ps.particleTexture = flareTexture(this.scene);
    const [r1, g1, b1] = hexToRgb(st.color);
    const [r2, g2, b2] = hexToRgb(st.color2);
    ps.color1 = new Color4(r1, g1, b1, 1);
    ps.color2 = new Color4(r2, g2, b2, 0.9);
    ps.colorDead = new Color4(r2, g2, b2, 0);
    ps.minSize = 0.12;
    ps.maxSize = 0.34;
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.4;
    ps.emitRate = st.rate;
    ps.gravity = new Vector3(0, st.gravity, 0);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.8;
    ps.direction1 = new Vector3(-st.spread, -st.spread, -st.spread);
    ps.direction2 = new Vector3(st.spread, st.spread, st.spread);
    const emitter = new Vector3(from.x, from.y + 0.6, from.z);
    ps.emitter = emitter;
    ps.start();

    await new Promise<void>((resolve) => {
      const startT = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.scene.onBeforeRenderObservable.remove(obs);
        clearTimeout(timer);
        resolve();
      };
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - startT) / dur);
        const arc = Math.sin(t * Math.PI) * Math.min(1.5, dist * 0.3);
        emitter.x = from.x + dir.x * t;
        emitter.z = from.z + dir.z * t;
        emitter.y = from.y + 0.6 + dir.y * t + arc;
        if (t >= 1) finish();
      });
      // Wall-clock fallback so playback still progresses if the render loop is
      // throttled (e.g. a backgrounded tab pauses requestAnimationFrame).
      const timer = setTimeout(finish, dur + 200);
    });

    // Impact burst at target.
    ps.emitRate = 0;
    this.impact(st, to);
    setTimeout(() => ps.dispose(), 500);
    void steps;

    if (strong) this.shake();
  }

  private impact(st: TypeStyle, at: Vector3): void {
    const ps = new ParticleSystem(`impact_${Math.random()}`, 200, this.scene);
    ps.particleTexture = flareTexture(this.scene);
    const [r1, g1, b1] = hexToRgb(st.color);
    ps.color1 = new Color4(r1, g1, b1, 1);
    ps.colorDead = new Color4(r1, g1, b1, 0);
    ps.emitter = new Vector3(at.x, at.y + 0.6, at.z);
    ps.minSize = 0.15;
    ps.maxSize = 0.5;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.direction1 = new Vector3(-1, -1, -1);
    ps.direction2 = new Vector3(1, 1, 1);
    ps.manualEmitCount = 120;
    ps.disposeOnStop = true;
    ps.start();
    setTimeout(() => ps.stop(), 60);
  }

  /** Purple/dark puff on faint. */
  koPuff(at: Vector3): void {
    const ps = new ParticleSystem('ko', 250, this.scene);
    ps.particleTexture = flareTexture(this.scene);
    ps.color1 = new Color4(0.9, 0.9, 0.95, 1);
    ps.color2 = new Color4(0.5, 0.5, 0.6, 0.8);
    ps.colorDead = new Color4(0.4, 0.4, 0.5, 0);
    ps.emitter = new Vector3(at.x, at.y + 0.5, at.z);
    ps.minSize = 0.2;
    ps.maxSize = 0.6;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.9;
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.direction1 = new Vector3(-1, 0.5, -1);
    ps.direction2 = new Vector3(1, 2, 1);
    ps.gravity = new Vector3(0, 1, 0);
    ps.manualEmitCount = 150;
    ps.disposeOnStop = true;
    ps.start();
    setTimeout(() => ps.stop(), 100);
  }

  /** Floating damage number that rises and fades over a world point. */
  floatingNumber(at: Vector3, amount: number, opts?: { crit?: boolean; heal?: boolean }): void {
    const label = new TextBlock();
    const prefix = opts?.heal ? '+' : '-';
    label.text = `${prefix}${amount}${opts?.crit ? '!' : ''}`;
    label.color = opts?.heal ? '#34D399' : opts?.crit ? '#FDE047' : '#FF6B6B';
    label.fontSize = opts?.crit ? 34 : 26;
    label.fontStyle = 'bold';
    label.outlineWidth = 4;
    label.outlineColor = '#0D0D1A';
    label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.ui.addControl(label);
    label.linkWithMesh(null);
    // Manual projection each frame.
    const startT = performance.now();
    const dur = 1100;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - startT) / dur);
      const world = new Vector3(at.x, at.y + 1.2 + t * 1.2, at.z);
      const engine = this.scene.getEngine();
      const coords = Vector3.Project(
        world,
        undefined as never,
        this.scene.getTransformMatrix(),
        this.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      label.leftInPixels = coords.x - engine.getRenderWidth() / 2;
      label.topInPixels = coords.y - engine.getRenderHeight() / 2;
      label.alpha = 1 - t;
      if (t >= 1) {
        this.scene.onBeforeRenderObservable.remove(obs);
        this.ui.removeControl(label);
        label.dispose();
      }
    });
  }

  /** Text popup (miss / status) that floats up. */
  floatingText(at: Vector3, text: string, color = '#E8E8F0'): void {
    const label = new TextBlock();
    label.text = text;
    label.color = color;
    label.fontSize = 22;
    label.fontStyle = 'bold';
    label.outlineWidth = 4;
    label.outlineColor = '#0D0D1A';
    this.ui.addControl(label);
    const startT = performance.now();
    const dur = 1000;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - startT) / dur);
      const world = new Vector3(at.x, at.y + 1.4 + t * 1.0, at.z);
      const engine = this.scene.getEngine();
      const coords = Vector3.Project(
        world,
        undefined as never,
        this.scene.getTransformMatrix(),
        this.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      label.leftInPixels = coords.x - engine.getRenderWidth() / 2;
      label.topInPixels = coords.y - engine.getRenderHeight() / 2;
      label.alpha = 1 - t;
      if (t >= 1) {
        this.scene.onBeforeRenderObservable.remove(obs);
        this.ui.removeControl(label);
        label.dispose();
      }
    });
  }

  /** Brief camera shake for strong hits. */
  shake(magnitude = 0.12, durationMs = 220): void {
    const cam = this.camera;
    const baseRadius = cam.radius;
    const startT = performance.now();
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - startT) / durationMs;
      if (t >= 1) {
        cam.radius = baseRadius;
        this.scene.onBeforeRenderObservable.remove(obs);
        return;
      }
      const decay = 1 - t;
      cam.radius = baseRadius + (Math.random() - 0.5) * magnitude * decay * 4;
    });
  }

  /** Convenience: color for a type (used by callers building auras). */
  static typeAccent(type: string): string {
    return typeColor(type);
  }
}
