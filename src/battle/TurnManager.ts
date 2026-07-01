import { GamePhase } from '../core/Enums';
import { generateGrid, tileKey, floodFill } from '../core/HexGrid';
import { GameConstants } from '../core/GameConstants';
import { DeclarationPayload, PokemonState } from '../core/PokemonState';
import { SpeciesRegistry } from '../data/SpeciesData';
import { BattleState, ResolutionResult, beginTurn, endTurn, resolveTurn } from './TurnResolver';

export class TurnManager {
  state!: BattleState;
  onTurnResolved: ((result: ResolutionResult, endLog: string[]) => void) | null = null;

  private p1Declared = false;
  private p2Declared = false;

  initBattle(p1SpeciesId: string, p2SpeciesId: string): void {
    const s1 = SpeciesRegistry.get(p1SpeciesId);
    const s2 = SpeciesRegistry.get(p2SpeciesId);
    if (!s1 || !s2) throw new Error(`Unknown species: ${p1SpeciesId}, ${p2SpeciesId}`);

    const p1StartTile = { x: -3, y: 0 };
    const p2StartTile = { x: 3, y: 0 };

    const p1 = new PokemonState(s1, 1, p1StartTile);
    const p2 = new PokemonState(s2, 2, p2StartTile);

    // Validate tiles are within grid
    const allTiles = generateGrid(GameConstants.GridRadius);
    const validSet = new Set(allTiles.map(tileKey));
    if (!validSet.has(tileKey(p1StartTile))) throw new Error('P1 start tile out of bounds');
    if (!validSet.has(tileKey(p2StartTile))) throw new Error('P2 start tile out of bounds');

    this.state = {
      turnNumber: 0,
      phase: GamePhase.Selection,
      p1,
      p2,
      terrain: new Map(),
      winner: null,
      isOver: false,
    };

    this.p1Declared = false;
    this.p2Declared = false;

    beginTurn(this.state);
  }

  submitDeclaration(playerId: number, decl: DeclarationPayload): void {
    if (this.state.isOver) return;

    if (playerId === 1) {
      this.state.p1.declaration = decl;
      this.p1Declared = true;
    } else {
      this.state.p2.declaration = decl;
      this.p2Declared = true;
    }

    if (this.p1Declared && this.p2Declared) {
      this.p1Declared = false;
      this.p2Declared = false;
      this._resolve();
    }
  }

  private _resolve(): void {
    const result = resolveTurn(this.state);
    const endLog = endTurn(this.state);

    // Check KOs from end-of-turn
    if (!this.state.p1.isAlive && !this.state.p2.isAlive) {
      this.state.isOver = true;
      this.state.winner = 0;
    } else if (!this.state.p1.isAlive) {
      this.state.isOver = true;
      this.state.winner = 2;
    } else if (!this.state.p2.isAlive) {
      this.state.isOver = true;
      this.state.winner = 1;
    }

    if (this.onTurnResolved) this.onTurnResolved(result, endLog);

    if (!this.state.isOver) {
      beginTurn(this.state);
    } else {
      this.state.phase = GamePhase.GameOver;
    }
  }

  getValidMoveTiles(playerId: number): Set<string> {
    const actor = playerId === 1 ? this.state.p1 : this.state.p2;
    const allTiles = generateGrid(GameConstants.GridRadius);
    const validSet = new Set(allTiles.map(tileKey));

    // Block tile occupied by opponent
    const opponent = playerId === 1 ? this.state.p2 : this.state.p1;
    if (!opponent.canPassThrough) {
      validSet.delete(tileKey(opponent.tile));
    }

    const range = actor.getMoveRange();
    return floodFill(actor.tile, range, validSet);
  }
}
