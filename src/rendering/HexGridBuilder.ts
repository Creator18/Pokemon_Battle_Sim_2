import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from '@babylonjs/core';
import { HighlightType, TerrainType } from '../core/Enums';
import { GameConstants } from '../core/GameConstants';
import { generateGrid, hexToWorld, tileKey, Vec2 } from '../core/HexGrid';
import { HexTile } from './HexTile';

const BASE_COLORS = [
  new Color3(0.22, 0.32, 0.22),
  new Color3(0.18, 0.28, 0.18),
  new Color3(0.20, 0.30, 0.20),
];

export class HexGridBuilder {
  private tiles: Map<string, HexTile> = new Map();
  private scene: Scene;
  private size: number;

  constructor(scene: Scene, radius = GameConstants.GridRadius, size = GameConstants.HexSize) {
    this.scene = scene;
    this.size = size;
    this._build(radius, size);
  }

  private _build(radius: number, size: number): void {
    const allCoords = generateGrid(radius);
    let idx = 0;
    for (const coord of allCoords) {
      const { x: wx, z: wz } = hexToWorld(coord.x, coord.y, size);
      const key = tileKey(coord);

      const mesh = MeshBuilder.CreateCylinder(
        `hex_${key}`,
        { diameter: size * 2 * 0.96, height: 0.15, tessellation: 6 },
        this.scene
      );
      mesh.position = new Vector3(wx, 0, wz);
      mesh.rotation.y = Math.PI / 6; // flat-top orientation

      const mat = new StandardMaterial(`mat_${key}`, this.scene);
      const baseColor = BASE_COLORS[idx % BASE_COLORS.length];
      mat.diffuseColor = baseColor;
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mesh.material = mat;

      const tile = new HexTile(coord, mesh, mat, baseColor.clone());
      this.tiles.set(key, tile);
      idx++;
    }
  }

  getTileAt(q: number, r: number): HexTile | undefined {
    return this.tiles.get(`${q},${r}`);
  }

  getTileByKey(key: string): HexTile | undefined {
    return this.tiles.get(key);
  }

  setHighlight(tile: Vec2, type: HighlightType): void {
    const t = this.getTileAt(tile.x, tile.y);
    if (t) t.setHighlight(type);
  }

  clearAllHighlights(): void {
    for (const tile of this.tiles.values()) {
      tile.setHighlight(HighlightType.None);
    }
  }

  updateTerrain(terrain: Map<string, { type: TerrainType; turnsLeft: number }>): void {
    // Reset all terrain display first
    for (const tile of this.tiles.values()) {
      tile.clearTerrain();
    }
    // Apply current terrain
    for (const [key, t] of terrain) {
      const tile = this.tiles.get(key);
      if (tile) tile.setTerrain(t.type, t.turnsLeft);
    }
  }

  getAllMeshes() {
    return Array.from(this.tiles.values()).map(t => t.mesh);
  }

  get allTiles(): Map<string, HexTile> {
    return this.tiles;
  }
}
