/**
 * Pokémon Metroidverse — its zones, ready to play: the boss battlefield (a stadium, no platforms: you against a boss
 * that fights back) and the first room (platforms, a practice target). Each builds its level, its fighters and its
 * look, wires its scoreboard and help line, and gives back what it made — dispose() takes it all down again.
 *
 *   A / D run · Space jump (in the air: fly — held, rise; let go, glide down) · W / S look up / down (aim)
 *   U ranged · I close · J mobility · K control · R a fight over: again
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { getSpecies } from '../../shared/index.ts';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import { Platformer, bossRoom } from '../platformer/Platformer.ts';
import type { MoveKit } from '../platformer/Platformer.ts';
import { keyLegend } from '../platformer/Hud.ts';
import { grassStadium } from '../render/arenas/grassStadium.ts';
import type { Arena } from '../render/arenas/grassStadium.ts';
import { colosseum } from '../render/arenas/colosseum.ts';
import { leagueStadium } from '../render/arenas/leagueStadium.ts';
import type { LeagueStadium } from '../render/arenas/leagueStadium.ts';
import type { BackdropName } from '../render/arenas/backdrops.ts';

export interface ZoneDeps { scene: Scene; factory: RecipeFactory; camera: Camera }

/** A species by name (one the roster has no entry for: an error naming it). */
function species(name: string) {
  const s = getSpecies(name);
  if (!s) throw new Error(`No species named ${name}`);
  return s;
}

export interface Zone { pf: Platformer; arena: Arena | null; dispose(): void }

/** The boss battlefield's options: who you are, who the boss is, your moves and its, its look, how wide it is (each way). */
export interface BossZoneOptions {
  species?: string; boss?: string; moves?: MoveKit; bossMoves?: MoveKit;
  look?: 'league' | 'colosseum' | 'stadium'; halfW?: number;
}

/** The camera as a zone needs it: no limits on how near or far it comes, its own controls off (the zone moves it). */
function readyCamera(camera: Camera): void {
  const cam = camera as unknown as { detachControl?: () => void; lowerRadiusLimit: number; upperRadiusLimit: number; maxZ: number };
  cam.detachControl?.();
  cam.lowerRadiusLimit = 0.1; cam.upperRadiusLimit = 200; cam.maxZ = Math.max(cam.maxZ, 400);
}

/** The controls, as key caps along the bottom right (the moves are on the move bar; with no boss, listed here too). */
function helpLine(moves: MoveKit, withBar = true): HTMLDivElement {
  document.querySelector('[data-pf-help]')?.remove();
  const items: [string[], string][] = [[['A', 'D'], 'run'], [['Space'], 'jump / fly'], [['W', 'S'], 'aim']];
  if (!withBar) items.push([['U'], moves.ranged ?? '—'], [['I'], moves.close ?? '—'], [['J'], moves.mobility ?? '—'], [['K'], moves.control ?? '—'], [['L'], 'dash (no direction: back dash)']);
  items.push([['R'], 'restart']);
  const box = document.createElement('div');
  box.className = 'mvh'; box.dataset.pfHelp = '';
  box.append(keyLegend(items));
  document.body.append(box);
  return box;
}

/** The boss battlefield: the League stadium (or the colosseum, or the 3D grass stadium), you against a boss. */
export async function startBossZone(d: ZoneDeps, o: BossZoneOptions = {}): Promise<Zone> {
  const { scene, factory, camera } = d;
  readyCamera(camera);
  const look = o.look ?? 'league';
  const arena = look === 'stadium' ? grassStadium(scene) : look === 'colosseum' ? colosseum(scene) : leagueStadium(scene);
  // Its own air: a far fog over the lawns (the painted layers keep out of it).
  scene.fogMode = 3; // linear
  scene.fogColor = arena.air.fog; scene.fogStart = arena.air.fogStart; scene.fogEnd = arena.air.fogEnd;
  scene.clearColor = new Color4(arena.air.fog.r, arena.air.fog.g, arena.air.fog.b, 1);
  const halfW = o.halfW ?? Math.min(11, arena.bounds.halfW - 1);
  const pf = await Platformer.start(scene, factory, camera, {
    species: species(o.species ?? 'Charizard'), moves: o.moves, backdrop: false, scenery: arena.root,
    level: bossRoom(halfW), start: { x: -7, y: 0 },
    enemies: [{ species: species(o.boss ?? 'Charizard'), x: 7, y: 0, boss: true,
      moves: o.bossMoves ?? { ranged: 'Dragon Pulse', close: 'Dragon Claw', mobility: 'Quick Attack' } }],
  });
  pf.restart();
  // The scoreboard (the League stadium's): its live feed on the two of them, both sides' names and HP, the clock, the result.
  const league = 'scoreboard' in arena ? (arena as LeagueStadium) : null;
  let tick = 0;
  if (league) {
    league.follow(pf.player.node, pf.boss!.node);
    const short = (n: string) => n.replace(/ \((you|boss)\)$/, '');
    tick = window.setInterval(() => {
      league.scoreboard.update({ name: short(pf.player.name), hp: pf.player.hp, max: pf.player.maxHp },
        { name: short(pf.boss!.name), hp: pf.boss!.hp, max: pf.boss!.maxHp }, pf.time,
        pf.result === 'won' ? 'YOU WIN!' : pf.result === 'lost' ? 'DEFEATED' : '');
    }, 200);
  }
  const help = helpLine(pf.moves);
  return { pf, arena, dispose: () => { clearInterval(tick); help.remove(); pf.dispose(); arena.dispose(); } };
}

/** The first room: platforms, a pit, a ledge; a practice target ahead (it stands again after fainting). */
export async function startFirstRoom(d: ZoneDeps, o: { species?: string; enemy?: string; moves?: MoveKit; backdrop?: boolean | BackdropName } = {}): Promise<Zone> {
  const { scene, factory, camera } = d;
  readyCamera(camera);
  scene.fogMode = 0;
  const pf = await Platformer.start(scene, factory, camera, {
    species: species(o.species ?? 'Charizard'), moves: o.moves, backdrop: o.backdrop ?? true,
    enemies: [{ species: species(o.enemy ?? 'Venusaur'), x: 19, y: 0 }],
  });
  const help = helpLine(pf.moves, false);
  return { pf, arena: null, dispose: () => { help.remove(); pf.dispose(); } };
}
