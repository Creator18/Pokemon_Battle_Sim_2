/** TurnDeclaration — a player's chosen action for a turn. */

import { ActionOrder } from '../core/enums.ts';
import { Tile } from '../core/hex.ts';

export interface TurnDeclarationJSON {
  move_name: string;
  action_order: string;
  target_tile: [number, number] | null;
  planned_path: [number, number][];
}

export class TurnDeclaration {
  moveName: string;
  actionOrder: ActionOrder;
  targetTile: Tile | null;
  plannedPath: Tile[];

  constructor(
    moveName: string,
    actionOrder: ActionOrder,
    targetTile: Tile | null,
    plannedPath: Tile[],
  ) {
    this.moveName = moveName;
    this.actionOrder = actionOrder;
    this.targetTile = targetTile;
    this.plannedPath = plannedPath;
  }

  /** Number of tiles the declared path would move (hops, not step-cost). */
  tilesToMove(): number {
    return Math.max(0, this.plannedPath.length - 1);
  }

  toJSON(): TurnDeclarationJSON {
    return {
      move_name: this.moveName,
      action_order: this.actionOrder,
      target_tile: this.targetTile ? [this.targetTile[0], this.targetTile[1]] : null,
      planned_path: this.plannedPath.map((t) => [t[0], t[1]] as [number, number]),
    };
  }

  static fromJSON(d: TurnDeclarationJSON): TurnDeclaration {
    return new TurnDeclaration(
      d.move_name,
      d.action_order as ActionOrder,
      d.target_tile ? [d.target_tile[0], d.target_tile[1]] : null,
      (d.planned_path ?? []).map((t) => [t[0], t[1]] as Tile),
    );
  }
}
