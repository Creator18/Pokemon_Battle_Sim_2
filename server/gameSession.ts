/**
 * GameSession — per-match orchestration and protocol handling.
 *
 * Owns exactly one BattleSession from the shared engine plus the two connected
 * client sockets. Drives the full state machine (join -> selection ->
 * declaration -> resolution -> game over) by translating wire ClientMessages
 * into engine calls and engine results into wire ServerMessages.
 */

import type { WebSocket } from 'ws';
import {
  BattleSession,
  TurnDeclaration,
  SPECIES_LIST,
  GamePhase,
  type ClientMessage,
  type ServerMessage,
  type ResolvedActionWire,
  type ResolvedAction,
} from '../src/shared/index.ts';

/** A connected player slot within a game session. */
interface Player {
  ws: WebSocket;
  playerId: number; // 1 | 2
  hasSpecies: boolean;
  hasMoves: boolean;
}

export class GameSession {
  readonly sessionId: string;
  readonly seed: number;
  readonly battle: BattleSession;

  /** playerId -> Player. */
  private players = new Map<number, Player>();
  private started = false;
  private ended = false;

  /** Called when the session becomes empty / finished so the manager can drop it. */
  onEnded?: (session: GameSession) => void;

  constructor(sessionId: string, seed: number) {
    this.sessionId = sessionId;
    this.seed = seed;
    this.battle = BattleSession.create(seed, sessionId);
  }

  // ── Introspection used by the manager for matchmaking ──
  get playerCount(): number {
    return this.players.size;
  }

  /** Eligible to accept a second joiner (still open, not started/ended). */
  get isJoinable(): boolean {
    return !this.started && !this.ended && this.players.size < 2;
  }

  hasSocket(ws: WebSocket): boolean {
    for (const p of this.players.values()) if (p.ws === ws) return true;
    return false;
  }

  // ── Connection lifecycle ──
  /** Add a socket as the next free player slot (1 then 2). Returns the assigned playerId. */
  addPlayer(ws: WebSocket): number {
    const playerId = this.players.has(1) ? 2 : 1;
    this.players.set(playerId, { ws, playerId, hasSpecies: false, hasMoves: false });
    this.log(`player ${playerId} connected (${this.players.size}/2)`);

    this.send(ws, { type: 'joined', playerId, sessionId: this.sessionId });

    if (this.players.size < 2) {
      this.send(ws, { type: 'waiting' });
    } else {
      // Second player arrived — begin selection for both.
      this.broadcast({ type: 'selectionStart', species: [...SPECIES_LIST] });
      this.log('both players present — selection started');
    }
    return playerId;
  }

  private playerBySocket(ws: WebSocket): Player | undefined {
    for (const p of this.players.values()) if (p.ws === ws) return p;
    return undefined;
  }

  // ── Message dispatch ──
  handleMessage(ws: WebSocket, raw: string): void {
    const player = this.playerBySocket(ws);
    if (!player) return; // socket not part of this session

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { type: 'error', message: 'Malformed JSON.' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      this.send(ws, { type: 'error', message: 'Missing message type.' });
      return;
    }

    try {
      switch (msg.type) {
        case 'join':
          // Re-join / already joined: just re-confirm identity.
          this.send(ws, { type: 'joined', playerId: player.playerId, sessionId: this.sessionId });
          break;
        case 'selectPokemon':
          this.handleSelectPokemon(player, msg.species);
          break;
        case 'selectMoves':
          this.handleSelectMoves(player, msg.moveIds);
          break;
        case 'declare':
          this.handleDeclare(player, msg);
          break;
        case 'forfeit':
          this.handleForfeit(player);
          break;
        case 'ping':
          this.send(ws, { type: 'pong' });
          break;
        default:
          this.send(ws, { type: 'error', message: `Unknown message type '${(msg as { type: string }).type}'.` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`error handling '${msg.type}' from P${player.playerId}: ${message}`);
      this.send(ws, { type: 'error', message });
    }
  }

  // ── Selection phase ──
  private inSelection(): boolean {
    return this.players.size === 2 && !this.started && !this.ended;
  }

  private handleSelectPokemon(player: Player, species: string): void {
    if (!this.inSelection()) {
      this.send(player.ws, { type: 'error', message: 'Not in selection phase.' });
      return;
    }
    if (typeof species !== 'string' || species.length === 0) {
      this.send(player.ws, { type: 'error', message: 'Invalid species.' });
      return;
    }
    this.battle.selectPokemon(player.playerId, species);
    player.hasSpecies = true;
    player.hasMoves = false; // moves must be (re)chosen for the new species
    this.log(`P${player.playerId} selected species ${species}`);
    this.broadcast({ type: 'selectionUpdate', playerId: player.playerId });
    this.maybeStart();
  }

  private handleSelectMoves(player: Player, moveIds: string[]): void {
    if (!this.inSelection()) {
      this.send(player.ws, { type: 'error', message: 'Not in selection phase.' });
      return;
    }
    if (!player.hasSpecies) {
      this.send(player.ws, { type: 'error', message: 'Select a species before moves.' });
      return;
    }
    if (!Array.isArray(moveIds) || moveIds.length !== 4) {
      this.send(player.ws, { type: 'error', message: 'Exactly 4 moves must be selected.' });
      return;
    }
    this.battle.selectMoves(player.playerId, moveIds);
    player.hasMoves = true;
    this.log(`P${player.playerId} selected moves [${moveIds.join(', ')}]`);
    this.broadcast({ type: 'selectionUpdate', playerId: player.playerId });
    this.maybeStart();
  }

  /** A player is ready once they have a species AND 4 moves. */
  private bothPlayersReady(): boolean {
    if (this.players.size !== 2) return false;
    for (const p of this.players.values()) {
      if (!p.hasSpecies || !p.hasMoves) return false;
    }
    return this.battle.bothReady();
  }

  private maybeStart(): void {
    if (this.started || this.ended || !this.bothPlayersReady()) return;
    this.battle.startBattle();
    this.started = true;
    this.log('both ready — battle started');
    this.broadcast({ type: 'selectionDone' });
    this.broadcast({ type: 'state', battleState: this.battle.getState() });
    this.broadcast({ type: 'turnStart', turnNumber: this.battle.getState().meta.turnNumber });
  }

  // ── Declaration phase ──
  private inDeclaration(): boolean {
    return this.started && !this.ended && !this.battle.isOver();
  }

  private handleDeclare(
    player: Player,
    msg: { moveId: string; targetTile: [number, number] | null; movePath: [number, number][]; actionOrder: string },
  ): void {
    if (!this.inDeclaration()) {
      this.send(player.ws, { type: 'error', message: 'Not in declaration phase.' });
      return;
    }
    const decl = new TurnDeclaration(
      msg.moveId,
      msg.actionOrder as TurnDeclaration['actionOrder'],
      msg.targetTile ?? null,
      Array.isArray(msg.movePath) ? msg.movePath : [],
    );

    const { ok, reason } = this.battle.validateDeclaration(player.playerId, decl);
    if (!ok) {
      this.send(player.ws, { type: 'error', message: reason });
      return;
    }

    this.battle.declare(player.playerId, decl);
    this.log(`P${player.playerId} declared ${msg.moveId} (${msg.actionOrder})`);
    this.broadcast({ type: 'declared', playerId: player.playerId });

    if (this.battle.bothDeclared()) this.resolve();
  }

  private resolve(): void {
    const { log, resolvedActions, aoeTiles } = this.battle.resolveTurn();
    const newState = this.battle.getState();
    this.log(`turn resolved (${log.length} log lines)`);
    this.broadcast({
      type: 'resolution',
      log,
      resolvedActions: resolvedActions.map(toWire),
      aoeTiles,
      newState,
    });

    if (this.battle.isOver()) {
      this.log(`game over — winner: ${this.battle.winner}`);
      this.broadcast({ type: 'gameOver', winner: this.battle.winner });
      this.end();
    } else {
      this.broadcast({ type: 'turnStart', turnNumber: newState.meta.turnNumber });
    }
  }

  // ── Forfeit / disconnect ──
  private handleForfeit(player: Player): void {
    if (this.ended) return;
    const other = player.playerId === 1 ? 2 : 1;
    this.log(`P${player.playerId} forfeited — P${other} wins`);
    this.broadcast({ type: 'gameOver', winner: other });
    this.end();
  }

  /** A socket dropped. If mid-game, remaining player wins by forfeit. */
  handleDisconnect(ws: WebSocket): void {
    const player = this.playerBySocket(ws);
    if (!player) return;
    this.players.delete(player.playerId);
    this.log(`P${player.playerId} disconnected (${this.players.size} remaining)`);

    if (this.ended) {
      if (this.players.size === 0) this.end();
      return;
    }

    if (this.started && this.players.size === 1) {
      // Treat as forfeit — the remaining player wins.
      const [remaining] = [...this.players.values()];
      this.log(`P${remaining.playerId} wins by disconnect-forfeit`);
      this.broadcast({ type: 'gameOver', winner: remaining.playerId });
      this.end();
    } else if (this.players.size === 0) {
      this.end();
    }
    // else: pre-start with one player left — keep the session open for a new joiner.
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.log('session ended');
    this.onEnded?.(this);
  }

  // ── Transport helpers ──
  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      this.log(`send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) this.send(p.ws, msg);
  }

  private log(m: string): void {
    console.log(`[session ${this.sessionId}] ${m}`);
  }
}

/** Map the engine's internal ResolvedAction to the protocol wire shape. */
function toWire(a: ResolvedAction): ResolvedActionWire {
  const tile = (t: readonly [number, number] | null): [number, number] | null =>
    t ? [t[0], t[1]] : null;
  return {
    playerId: a.playerId,
    actionType: String(a.actionType),
    moveName: a.moveName ?? null,
    actionOrder: a.actionOrder ? String(a.actionOrder) : null,
    fromTile: tile(a.fromTile),
    toTile: tile(a.toTile),
    path: (a.path ?? []).map((t) => [t[0], t[1]] as [number, number]),
    qaLandedAt: tile(a.qaLandedAt),
    skippedMovement: a.skippedMovement,
    skippedAttack: a.skippedAttack,
  };
}

// Re-export so tooling can reference the phase enum alongside the session.
export { GamePhase };
