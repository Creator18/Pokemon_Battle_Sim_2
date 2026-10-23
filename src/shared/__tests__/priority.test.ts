import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder, TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';
import { getMove } from '../data/moves.ts';
import { executeMove } from '../moves/execute.ts';

const A: Tile = [-1, 3], B: Tile = [0, 3];

/** `p1` against `p2` side by side on open ground. */
function battle(p1: string, m1: string[], p2: string, m2: string[]): BattleSession {
  const s = BattleSession.create(7, 'priority');
  s.selectPokemon(1, p1);
  s.selectMoves(1, m1);
  s.selectPokemon(2, p2);
  s.selectMoves(2, m2);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(A);
  s.state.p2!.moveTo(B);
  return s;
}

function turn(s: BattleSession, m1: string, m2: string) {
  s.declare(1, new TurnDeclaration(m1, ActionOrder.ATTACK_FIRST, B, []));
  s.declare(2, new TurnDeclaration(m2, ActionOrder.ATTACK_FIRST, getMove(m2)!.category === 'status' ? null : A, []));
  return s.resolveTurn();
}

describe('priority moves', () => {
  it('Fake Out flinches on the first turn and fails after', () => {
    const s = battle('Lopunny', ['Fake Out'], 'Blastoise', ['Swords Dance']);
    const r1 = turn(s, 'Fake Out', 'Swords Dance');
    expect(r1.log.some((l) => l.includes('flinched'))).toBe(true);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    const r2 = turn(s, 'Fake Out', 'Swords Dance');
    expect(r2.log.some((l) => l.includes('Fake Out! But it failed'))).toBe(true);
  });

  it('Upper Hand works only against a priority attack', () => {
    const s = battle('Lucario', ['Upper Hand'], 'Scizor', ['Bullet Punch', 'Swords Dance']);
    const r1 = turn(s, 'Upper Hand', 'Swords Dance');
    expect(r1.log.some((l) => l.includes('Upper Hand! But it failed'))).toBe(true);
    const hp = s.state.p2!.currentHp;
    turn(s, 'Upper Hand', 'Bullet Punch');
    expect(s.state.p2!.currentHp).toBeLessThan(hp);
  });

  it('Grassy Glide strikes first only in Grassy Terrain', () => {
    const s = battle('Sceptile', ['Grassy Glide'], 'Blastoise', ['Swords Dance']);
    const glide = getMove('Grassy Glide')!;
    expect(s.state.terrain.hasPriority(glide)).toBe(false);
    s.state.terrain.addTerrain([0, 0], TerrainType.GRASSY_TERRAIN, 1, 5);
    expect(s.state.terrain.hasPriority(glide)).toBe(true);
    expect(s.state.terrain.hasPriority(getMove('Bullet Punch')!)).toBe(true);
  });

  it('a quick dash that hits waits beside the target, on its path', () => {
    for (const from of [[-3, 3], [0, 0], [3, 0]] as Tile[]) {
      const s = battle('Lucario', ['Extreme Speed'], 'Blastoise', ['Swords Dance']);
      s.state.p1!.moveTo(from);
      const r = executeMove(getMove('Extreme Speed')!, s.state.p1!, s.state.p2!, s.state.terrain, () => 0.5,
        { targetTile: B, straightTiles: 0 });
      if (!r.hit) continue;
      const at = s.state.p1!.tile;
      // Beside the target, on the side it came from.
      expect(Math.max(Math.abs(at[0] - B[0]), Math.abs(at[1] - B[1]), Math.abs(at[0] + at[1] - B[0] - B[1]))).toBe(1);
      const dist = (t: Tile) => Math.max(Math.abs(t[0] - from[0]), Math.abs(t[1] - from[1]), Math.abs(t[0] + t[1] - from[0] - from[1]));
      expect(dist(at)).toBeLessThan(dist(B));
    }
  });

  it('Flame Charge dashes in (no priority), waits beside the target, and raises its Speed', () => {
    const fc = getMove('Flame Charge')!;
    expect(fc.quickPriority).toBe(false);
    expect(fc.quickDash).toBe(true);
    const s = battle('Charizard', ['Flame Charge'], 'Blastoise', ['Swords Dance']);
    s.state.p1!.moveTo([-3, 3]);
    const r = executeMove(fc, s.state.p1!, s.state.p2!, s.state.terrain, () => 0.5, { targetTile: B, straightTiles: 0 });
    expect(r.hit).toBe(true);
    expect(s.state.p1!.tile).toEqual(A);
    expect(s.state.p1!.statStages.speed).toBe(1);
  });

  it('Flare Blitz rams its target back a tile (or aside, with no room behind)', () => {
    const fb = getMove('Flare Blitz')!;
    // Room behind: straight back, along the run.
    const s = battle('Charizard', ['Flare Blitz'], 'Blastoise', ['Swords Dance']);
    s.state.p1!.moveTo([-3, 3]);
    const r = executeMove(fb, s.state.p1!, s.state.p2!, s.state.terrain, () => 0.5, { targetTile: B, straightTiles: 0 });
    expect(r.hit).toBe(true);
    expect(s.state.p1!.tile).toEqual(A);
    expect(s.state.p2!.tile).toEqual([1, 3]);
    expect(r.knockback?.to).toEqual([1, 3]);
    // No room behind: to a free tile beside it.
    const t = battle('Charizard', ['Flare Blitz'], 'Blastoise', ['Swords Dance']);
    t.state.p1!.moveTo([-3, 3]);
    const grid = new Set([...HEX_GRID].filter((k) => k !== '1,3'));
    const r2 = executeMove(fb, t.state.p1!, t.state.p2!, t.state.terrain, () => 0.5, { targetTile: B, straightTiles: 0, grid });
    expect(r2.hit).toBe(true);
    const to = r2.knockback!.to;
    expect(Math.max(Math.abs(to[0] - B[0]), Math.abs(to[1] - B[1]), Math.abs(to[0] + to[1] - B[0] - B[1]))).toBe(1);
    expect(to).not.toEqual(A);
  });

  it('Zippy Zap always lands a critical hit', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = battle('Pikachu', ['Zippy Zap'], 'Blastoise', ['Swords Dance']);
      const r = executeMove(getMove('Zippy Zap')!, s.state.p1!, s.state.p2!, s.state.terrain, () => seed / 21,
        { targetTile: B, straightTiles: 0 });
      expect(r.hit && r.crit).toBe(true);
    }
  });
});
