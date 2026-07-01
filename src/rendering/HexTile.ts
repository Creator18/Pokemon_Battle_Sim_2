import { Mesh, StandardMaterial, Color3 } from '@babylonjs/core';
import { HighlightType, TerrainType } from '../core/Enums';

const HIGHLIGHT_COLORS: Record<HighlightType, Color3> = {
  [HighlightType.None]: new Color3(0, 0, 0),
  [HighlightType.MoveRange]: new Color3(0.1, 0.3, 0.9),
  [HighlightType.AttackRange]: new Color3(0.9, 0.1, 0.1),
  [HighlightType.Path]: new Color3(0.9, 0.9, 0.9),
  [HighlightType.AoE]: new Color3(0.9, 0.5, 0.1),
};

const TERRAIN_COLORS: Partial<Record<TerrainType, Color3>> = {
  [TerrainType.BurnZone]: new Color3(0.6, 0.1, 0),
  [TerrainType.SlowZone]: new Color3(0.3, 0, 0.5),
  [TerrainType.PoisonTrap]: new Color3(0.4, 0, 0.4),
  [TerrainType.IceZone]: new Color3(0.4, 0.7, 0.9),
  [TerrainType.ElectricZone]: new Color3(0.8, 0.8, 0),
  [TerrainType.ResonanceField]: new Color3(0.5, 0.2, 0.8),
  [TerrainType.PerishTrap]: new Color3(0.1, 0.1, 0.1),
  [TerrainType.MistVeil]: new Color3(0.7, 0.85, 0.9),
  [TerrainType.SunnyZone]: new Color3(0.9, 0.8, 0.1),
  [TerrainType.RainZone]: new Color3(0.2, 0.4, 0.8),
  [TerrainType.PsychicZone]: new Color3(0.8, 0.3, 0.7),
  [TerrainType.SteelZone]: new Color3(0.5, 0.5, 0.6),
};

export class HexTile {
  coords: { x: number; y: number };
  mesh: Mesh;
  currentTerrain: TerrainType = TerrainType.None;
  highlight: HighlightType = HighlightType.None;
  private mat: StandardMaterial;
  private baseColor: Color3;
  private terrainTurns: number = 0;

  constructor(coords: { x: number; y: number }, mesh: Mesh, mat: StandardMaterial, baseColor: Color3) {
    this.coords = coords;
    this.mesh = mesh;
    this.mat = mat;
    this.baseColor = baseColor;
    this.mesh.metadata = { tile: this };
  }

  setHighlight(type: HighlightType): void {
    this.highlight = type;
    this._updateMaterial();
  }

  setTerrain(type: TerrainType, turns: number): void {
    this.currentTerrain = type;
    this.terrainTurns = turns;
    this._updateMaterial();
  }

  clearTerrain(): void {
    this.currentTerrain = TerrainType.None;
    this.terrainTurns = 0;
    this._updateMaterial();
  }

  private _updateMaterial(): void {
    const terrainColor = TERRAIN_COLORS[this.currentTerrain];
    const diffuse = terrainColor ?? this.baseColor;
    this.mat.diffuseColor = diffuse;

    if (this.highlight !== HighlightType.None) {
      this.mat.emissiveColor = HIGHLIGHT_COLORS[this.highlight];
    } else {
      this.mat.emissiveColor = terrainColor
        ? terrainColor.scale(0.3)
        : new Color3(0, 0, 0);
    }
  }

  getTooltipText(): string {
    let text = `Tile (${this.coords.x},${this.coords.y})`;
    if (this.currentTerrain !== TerrainType.None) {
      text += `\n${TerrainType[this.currentTerrain]} (${this.terrainTurns} turns)`;
    }
    return text;
  }
}
