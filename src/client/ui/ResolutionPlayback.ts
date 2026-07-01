/**
 * ResolutionPlayback — animates a `resolution` message: replays resolvedActions
 * in order (movement tweens, attack lunges, VFX, floating damage, faints), then
 * applies newState to board/HUD.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import {
  moveType,
  getMove,
  type ResolutionMsg,
  type ResolvedActionWire,
  type BattleStateJSON,
} from '../../shared/index.ts';
import type { HexBoard } from '../render/HexBoard.ts';
import type { PokemonFactory } from '../render/PokemonFactory.ts';
import type { MoveVfx } from '../vfx/MoveVfx.ts';
import type { BattleCamera } from '../camera/BattleCamera.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const STRONG_HIT = 45;

export class ResolutionPlayback {
  constructor(
    private board: HexBoard,
    private factory: PokemonFactory,
    private vfx: MoveVfx,
    private camera: BattleCamera,
  ) {}

  /**
   * @param nodes  playerId → unit TransformNode
   * @param prevState state before resolution (for HP deltas / positions)
   */
  async play(
    msg: ResolutionMsg,
    nodes: Map<number, TransformNode>,
    prevState: BattleStateJSON,
  ): Promise<void> {
    const hpBefore = new Map<number, number>();
    for (const pid of [1, 2]) {
      const p = pid === 1 ? prevState.pokemon.p1 : prevState.pokemon.p2;
      if (p) hpBefore.set(pid, p.current_hp);
    }

    for (const action of msg.resolvedActions) {
      await this.playAction(action, nodes, msg, hpBefore);
      await sleep(180);
    }

    // Apply faints from the resulting state.
    for (const pid of [1, 2]) {
      const p = pid === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
      const node = nodes.get(pid);
      if (p && node && p.status === 'fainted' && node.isEnabled()) {
        this.vfx.koPuff(node.position.clone());
        await this.factory.playFaint(node);
      }
    }
    await sleep(200);
  }

  private worldFromTile(tile: [number, number]): Vector3 {
    return this.board.tileTop(tile[0], tile[1]);
  }

  private async playAction(
    action: ResolvedActionWire,
    nodes: Map<number, TransformNode>,
    msg: ResolutionMsg,
    hpBefore: Map<number, number>,
  ): Promise<void> {
    const node = nodes.get(action.playerId);
    if (!node) return;

    if (action.actionType === 'move') {
      if (action.skippedMovement) return;
      const path = action.path ?? [];
      if (path.length <= 1) return;
      this.camera.focusOn(path[path.length - 1]);
      const worldPath = path.slice(1).map((t) => this.worldFromTile([t[0], t[1]]));
      await this.factory.playMoveTo(node, worldPath);
      return;
    }

    // attack
    if (action.skippedAttack) {
      this.vfx.floatingText(node.position.clone(), 'Blocked!', '#EF4444');
      return;
    }
    const defenderId = action.playerId === 1 ? 2 : 1;
    const defenderNode = nodes.get(defenderId);
    const move = action.moveName ? getMove(action.moveName) : undefined;
    const mtype = action.moveName ? moveType(action.moveName) : 'Normal';

    const targetTile = action.toTile ?? (defenderNode ? undefined : undefined);
    const targetPos = defenderNode ? defenderNode.position.clone() : targetTile ? this.worldFromTile(targetTile) : node.position.clone();

    this.camera.focusOn(action.toTile ?? action.fromTile ?? [0, 0]);

    // Melee lunge for non-ranged moves.
    if (move && !move.isRanged) {
      await this.factory.playAttackLunge(node, targetPos);
    }

    // Damage/HP delta for this defender from newState.
    const defAfter = defenderId === 1 ? msg.newState.pokemon.p1 : msg.newState.pokemon.p2;
    const before = hpBefore.get(defenderId) ?? defAfter?.current_hp ?? 0;
    const after = defAfter?.current_hp ?? before;
    const dmg = Math.max(0, before - after);
    hpBefore.set(defenderId, after);

    const strong = dmg >= STRONG_HIT;
    await this.vfx.playMove(mtype, node.position.clone(), targetPos, strong);

    if (dmg > 0 && defenderNode) {
      this.vfx.floatingNumber(defenderNode.position.clone(), dmg);
      await this.factory.playHitReact(defenderNode);
    } else if (move && move.basePower > 0 && defenderNode) {
      this.vfx.floatingText(defenderNode.position.clone(), 'Miss', '#9CA3AF');
    } else if (move && move.terrainTypePlaced) {
      this.vfx.floatingText(targetPos, move.terrainTypePlaced.replace('_', ' '), '#A855F7');
    }
  }
}
