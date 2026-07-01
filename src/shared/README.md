# `src/shared` — pure deterministic hex-battle engine

A faithful TypeScript port of `hex_battle.py`. **Zero** dependencies on Babylon.js,
Node, the DOM, or a database. Importable by both the browser client and a Node
server. All randomness is threaded through an injectable RNG (`() => number`), so a
server can replay/verify a battle from a seed. **Nothing here calls `Math.random()`.**

```ts
import { BattleSession, TurnDeclaration, ActionOrder } from './shared/index.ts';
```

## Determinism & replay

`BattleSession.create(seed)` builds a `mulberry32` PRNG from the seed. Map
generation, crit rolls, secondary-effect procs (burn/paralyze/flinch/stat-drop),
Focus Blast accuracy, and queue tiebreaks all draw from this one RNG in a fixed
order. To replay/verify on the server: recreate the session with the **same seed**
and apply the **same declarations in the same order**. Given identical seed +
declarations, `getState()` is byte-for-byte identical (see `session.test.ts`).

> The internal PRNG position is not snapshotted into `BattleStateJSON`
> (`meta.rngState` holds the initial seed only). Replay from turn 0, or persist
> the seed alongside the ordered declaration history.

## Public API — `BattleSession`

```ts
class BattleSession {
  static create(rngSeed: number | string, sessionId?: string): BattleSession;
  static fromJSON(j: BattleStateJSON): BattleSession;

  // Selection phase
  selectPokemon(playerId: number, species: string): void;
  selectMoves(playerId: number, moveIds: string[]): void;
  bothReady(): boolean;

  // Start: generates terrain (rocks + trees via RNG), places pokemon, begins turn 1
  startBattle(): void;

  // Declaration phase
  declare(playerId: number, decl: TurnDeclaration): void;
  bothDeclared(): boolean;

  // Resolution: runs beginTurn (already done at start) → resolveTurn → endTurn,
  // then beginTurn for the next turn if the battle continues.
  resolveTurn(): TurnResolution; // { log, resolvedActions, aoeTiles }

  // Queries
  getState(): BattleStateJSON;   // fully serializable snapshot
  isOver(): boolean;
  get winner(): number | null;   // 1 | 2 | null(draw)

  // Client validation helpers
  getReachableTiles(playerId: number): string[];              // tile keys "q,r"
  getAttackableTiles(playerId: number, moveId: string, fromTile?: [number, number]): string[];
  validateDeclaration(playerId: number, decl: TurnDeclaration): { ok: boolean; reason: string };
}
```

`TurnResolution`:

```ts
interface TurnResolution {
  log: string[];
  resolvedActions: ResolvedAction[];       // ordered move/attack outcomes
  aoeTiles: Record<number, string[]>;      // playerId → tile keys hit by that attack
}
```

`TurnDeclaration`:

```ts
new TurnDeclaration(
  moveName: string,
  actionOrder: ActionOrder,          // 'ATTACK_FIRST' | 'MOVE_FIRST'
  targetTile: [number, number] | null,
  plannedPath: [number, number][],   // includes the start tile; [] or 1-tile = stay
);
```

## Also exported (lower-level, for tooling/UI)

- **RNG**: `mulberry32`, `makeRng`, `seedFromString`, `shuffle`, type `RNG`.
- **Core**: all enums, all constants, hex math (`hexDistance`, `hexNeighbors`,
  `hexLineTiles`, `hasLineOfSight`, `getHexArea`, `getReachableTiles`,
  `getAttackableTiles`, `HEX_GRID`, `tileKey`/`keyToTile`), `getTypeEffectiveness`,
  `statStageMultiplier`, `clampStatStage`, `defaultStatStages`.
- **Terrain**: `TerrainManager`, `TerrainEntity`, `TERRAIN_PROPS`.
- **Moves**: `MOVE_REGISTRY`, `MOVE_TYPE_MAP`, `getMove`, `calculateDamage`,
  `getHexPower`, `momentumMultiplier`, `voltTackleRecoilMultiplier`, `executeMove`.
- **Data**: `SPECIES_LIST`, `getSpecies`, `POKEMON_TYPES`, `SpeciesDefinition`.
- **Model**: `Pokemon`.
- **State**: `BattleState`, `BattleStateJSON`, `serializeState`, `deserializeState`.

## Coordinates

Tiles are axial `[q, r]`. Sets/maps key tiles by the string `"q,r"` (`tileKey`).
`getReachableTiles` / `getAttackableTiles` / `aoeTiles` all return these string keys.

## Wire protocol — `protocol/messages.ts`

Discriminated unions keyed by `type`.

### Client → Server (`ClientMessage`)

| `type`          | fields                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `join`          | `sessionId?: string`                                                                       |
| `selectPokemon` | `species: string`                                                                          |
| `selectMoves`   | `moveIds: string[]`                                                                         |
| `declare`       | `moveId: string`, `targetTile: [q,r] \| null`, `movePath: [q,r][]`, `actionOrder: ActionOrder` |
| `ping`          | —                                                                                          |
| `forfeit`       | —                                                                                          |

### Server → Client (`ServerMessage`)

| `type`            | fields                                                             |
| ----------------- | ----------------------------------------------------------------- |
| `joined`          | `playerId: number`, `sessionId: string`                           |
| `waiting`         | —                                                                 |
| `selectionStart`  | `species: SpeciesDefinition[]`                                    |
| `selectionUpdate` | `playerId: number`                                                |
| `selectionDone`   | —                                                                 |
| `state`           | `battleState: BattleStateJSON`                                    |
| `declared`        | `playerId: number`                                                |
| `resolution`      | `log: string[]`, `resolvedActions: ResolvedActionWire[]`, `aoeTiles: Record<number,string[]>`, `newState: BattleStateJSON` |
| `turnStart`       | `turnNumber: number`                                              |
| `gameOver`        | `winner: number \| null`                                          |
| `error`           | `message: string`                                                 |
| `pong`            | —                                                                 |

## Tests

`npx vitest run` — covers damage formula (hand-computed), type-chart immunities,
hex geometry, stat stages, momentum, Hex doubling, Sucker Punch conditional, type
immunity, and a full end-to-end turn resolution + determinism + serialization
round-trip.
```

## Notes / judgment calls

See the porting report; the Python `Pokemon` and `TurnDeclaration` classes were
absent from the assembled source and were reconstructed from the state schema and
all engine call sites.
