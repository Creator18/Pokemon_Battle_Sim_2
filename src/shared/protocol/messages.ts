/** Wire protocol types (client <-> server). Discriminated unions keyed by `type`. */

import { SpeciesDefinition } from '../data/species.ts';
import { BattleStateJSON } from '../engine/battleState.ts';
import { ActionOrder } from '../core/enums.ts';

// ── Client → Server ──────────────────────────
export interface JoinMsg {
  type: 'join';
  sessionId?: string;
}
export interface SelectPokemonMsg {
  type: 'selectPokemon';
  species: string;
}
export interface SelectMovesMsg {
  type: 'selectMoves';
  moveIds: string[];
}
export interface DeclareMsg {
  type: 'declare';
  moveId: string;
  targetTile: [number, number] | null;
  movePath: [number, number][];
  actionOrder: ActionOrder;
}
export interface PingMsg {
  type: 'ping';
}
export interface ForfeitMsg {
  type: 'forfeit';
}

export type ClientMessage =
  | JoinMsg
  | SelectPokemonMsg
  | SelectMovesMsg
  | DeclareMsg
  | PingMsg
  | ForfeitMsg;

// ── Server → Client ──────────────────────────
export interface JoinedMsg {
  type: 'joined';
  playerId: number;
  sessionId: string;
}
export interface WaitingMsg {
  type: 'waiting';
}
export interface SelectionStartMsg {
  type: 'selectionStart';
  species: SpeciesDefinition[];
}
export interface SelectionUpdateMsg {
  type: 'selectionUpdate';
  playerId: number;
}
export interface SelectionDoneMsg {
  type: 'selectionDone';
}
export interface StateMsg {
  type: 'state';
  battleState: BattleStateJSON;
}
export interface DeclaredMsg {
  type: 'declared';
  playerId: number;
}
export interface ResolvedActionWire {
  playerId: number;
  actionType: string;
  moveName: string | null;
  actionOrder: string | null;
  fromTile: [number, number] | null;
  toTile: [number, number] | null;
  path: [number, number][];
  qaLandedAt: [number, number] | null;
  skippedMovement: boolean;
  skippedAttack: boolean;
}
export interface ResolutionMsg {
  type: 'resolution';
  log: string[];
  resolvedActions: ResolvedActionWire[];
  /** playerId → array of tile keys ("q,r"). */
  aoeTiles: Record<number, string[]>;
  newState: BattleStateJSON;
}
export interface TurnStartMsg {
  type: 'turnStart';
  turnNumber: number;
}
export interface GameOverMsg {
  type: 'gameOver';
  winner: number | null;
}
export interface ErrorMsg {
  type: 'error';
  message: string;
}
export interface PongMsg {
  type: 'pong';
}

export type ServerMessage =
  | JoinedMsg
  | WaitingMsg
  | SelectionStartMsg
  | SelectionUpdateMsg
  | SelectionDoneMsg
  | StateMsg
  | DeclaredMsg
  | ResolutionMsg
  | TurnStartMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg;
