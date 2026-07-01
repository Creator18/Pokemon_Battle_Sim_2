import {
  Scene,
  PointerEventTypes,
  Ray,
  PickingInfo,
} from '@babylonjs/core';
import { HighlightType } from '../core/Enums';
import { floodFill, generateGrid, hexDistance, tileKey, Vec2 } from '../core/HexGrid';
import { GameConstants } from '../core/GameConstants';
import { MoveRegistry } from '../core/MoveDefinition';
import { HexGridBuilder } from '../rendering/HexGridBuilder';
import { HexTile } from '../rendering/HexTile';

export type InputPhase = 'idle' | 'awaitingMove' | 'selectingPath' | 'selectingTarget' | 'confirmed';

export interface BattleInputCallbacks {
  onTileHovered?: (tile: HexTile | null) => void;
  onDeclarationReady?: (moveId: string, targetTile: Vec2, movePath: Vec2[]) => void;
}

export class BattleInput {
  private scene: Scene;
  private gridBuilder: HexGridBuilder;
  private phase: InputPhase = 'idle';

  private selectedMoveId: string | null = null;
  private actorTile: Vec2 | null = null;
  private movePath: Vec2[] = [];
  private selectedDestTile: Vec2 | null = null;
  private hoveredTile: HexTile | null = null;

  private reachableTiles: Set<string> = new Set();
  private attackTiles: Set<string> = new Set();

  callbacks: BattleInputCallbacks = {};

  constructor(scene: Scene, gridBuilder: HexGridBuilder) {
    this.scene = scene;
    this.gridBuilder = gridBuilder;
    this._attachEvents();
  }

  private _attachEvents(): void {
    this.scene.onPointerObservable.add(evt => {
      if (evt.type === PointerEventTypes.POINTERMOVE) {
        const hit = this._pickTile();
        const newTile = hit?.pickedMesh?.metadata?.tile as HexTile | null ?? null;
        if (newTile !== this.hoveredTile) {
          this.hoveredTile = newTile;
          this.callbacks.onTileHovered?.(newTile);
        }
      }
      if (evt.type === PointerEventTypes.POINTERDOWN && evt.event.button === 0) {
        const hit = this._pickTile();
        const tile = hit?.pickedMesh?.metadata?.tile as HexTile | null;
        if (tile) this._handleClick(tile);
      }
    });
  }

  private _pickTile(): PickingInfo | null {
    const meshes = this.gridBuilder.getAllMeshes();
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.scene.activeCamera
    );
    let closest: PickingInfo | null = null;
    for (const mesh of meshes) {
      const info = mesh.intersects(ray, false);
      if (info.hit) {
        if (!closest || (info.distance < (closest.distance ?? Infinity))) {
          closest = info;
        }
      }
    }
    return closest;
  }

  private _handleClick(tile: HexTile): void {
    const coords = tile.coords;
    const key = tileKey(coords);

    if (this.phase === 'selectingPath') {
      // First click after move selection: choose destination
      if (this.reachableTiles.has(key)) {
        this.selectedDestTile = coords;
        this.movePath = [coords];
        this.gridBuilder.clearAllHighlights();
        // Now show attack range from destination
        this._showAttackRangeFrom(coords);
        this.phase = 'selectingTarget';
      }
      return;
    }

    if (this.phase === 'selectingTarget') {
      if (this.attackTiles.has(key)) {
        // Fire declaration
        const dest = this.selectedDestTile!;
        this.callbacks.onDeclarationReady?.(
          this.selectedMoveId!,
          coords,
          dest.x === this.actorTile!.x && dest.y === this.actorTile!.y ? [] : [dest]
        );
        this.gridBuilder.clearAllHighlights();
        this.phase = 'confirmed';
      } else if (this.reachableTiles.has(key)) {
        // Reselect destination
        this.selectedDestTile = coords;
        this.movePath = [coords];
        this.gridBuilder.clearAllHighlights();
        this._showAttackRangeFrom(coords);
      }
      return;
    }
  }

  beginMoveSelection(actorTile: Vec2, moveId: string, opponentTile: Vec2): void {
    this.selectedMoveId = moveId;
    this.actorTile = actorTile;
    this.movePath = [];
    this.selectedDestTile = actorTile;
    this.phase = 'selectingPath';

    const move = MoveRegistry.get(moveId);
    if (!move) return;

    const allTiles = generateGrid(GameConstants.GridRadius);
    const validSet = new Set(allTiles.map(tileKey));
    validSet.delete(tileKey(opponentTile));

    const moveRange = GameConstants.BaseRange(50); // approximate
    this.reachableTiles = floodFill(actorTile, Math.max(moveRange, 3), validSet);

    this.gridBuilder.clearAllHighlights();
    for (const key of this.reachableTiles) {
      const parts = key.split(',').map(Number);
      const t = this.gridBuilder.getTileAt(parts[0], parts[1]);
      if (t) t.setHighlight(HighlightType.MoveRange);
    }

    // Also show attack range from current position
    this._showAttackRangeFrom(actorTile);
  }

  beginMoveSelectionWithRange(actorTile: Vec2, moveId: string, opponentTile: Vec2, moveRange: number): void {
    this.selectedMoveId = moveId;
    this.actorTile = actorTile;
    this.movePath = [];
    this.selectedDestTile = actorTile;
    this.phase = 'selectingPath';

    const move = MoveRegistry.get(moveId);
    if (!move) return;

    const allTiles = generateGrid(GameConstants.GridRadius);
    const validSet = new Set(allTiles.map(tileKey));
    validSet.delete(tileKey(opponentTile));

    this.reachableTiles = floodFill(actorTile, moveRange, validSet);

    this.gridBuilder.clearAllHighlights();
    for (const key of this.reachableTiles) {
      const parts = key.split(',').map(Number);
      const t = this.gridBuilder.getTileAt(parts[0], parts[1]);
      if (t) t.setHighlight(HighlightType.MoveRange);
    }
    this._showAttackRangeFrom(actorTile);
  }

  private _showAttackRangeFrom(origin: Vec2): void {
    const move = MoveRegistry.get(this.selectedMoveId!);
    if (!move) return;

    this.attackTiles.clear();
    const allTiles = generateGrid(GameConstants.GridRadius);
    for (const tile of allTiles) {
      const dist = hexDistance(origin, tile);
      if (dist >= move.minRange && dist <= move.maxRange) {
        this.attackTiles.add(tileKey(tile));
        const t = this.gridBuilder.getTileAt(tile.x, tile.y);
        if (t) t.setHighlight(HighlightType.AttackRange);
      }
    }
    // Re-mark reachable over attack range (attack takes priority visually)
    // highlight destination
    if (this.selectedDestTile) {
      const t = this.gridBuilder.getTileAt(this.selectedDestTile.x, this.selectedDestTile.y);
      if (t) t.setHighlight(HighlightType.Path);
    }
  }

  reset(): void {
    this.phase = 'idle';
    this.selectedMoveId = null;
    this.actorTile = null;
    this.movePath = [];
    this.selectedDestTile = null;
    this.reachableTiles.clear();
    this.attackTiles.clear();
    this.gridBuilder.clearAllHighlights();
  }

  get currentPhase(): InputPhase {
    return this.phase;
  }
}
