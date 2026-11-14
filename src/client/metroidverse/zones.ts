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
import { Platformer, bossRoom, FLOORS } from '../platformer/Platformer.ts';
import { batchStatic } from '../render/staticBatch.ts';
import type { MoveKit } from '../platformer/Platformer.ts';
import { ControlsLegend } from '../ui/gameUi.ts';
import { grassStadium } from '../render/arenas/grassStadium.ts';
import type { Arena } from '../render/arenas/grassStadium.ts';
import { colosseum } from '../render/arenas/colosseum.ts';
import { leagueStadium } from '../render/arenas/leagueStadium.ts';
import type { LeagueStadium } from '../render/arenas/leagueStadium.ts';
import type { BackdropName } from '../render/arenas/backdrops.ts';
import { palletTown } from './palletTown.ts';
import { palletStory } from './palletStory.ts';
import { starterSelect } from './starterSelect.ts';
import { wildPokemon } from './wild.ts';
import { pushAside } from '../render/tallGrass.ts';
import { followShadows } from '../render/followShadows.ts';
import { ROUTE_GATE, SHORE } from './palletTown.ts';
import { backdrop as paintedBackdrop } from '../render/arenas/backdrops.ts';

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
  /** The rest of your party (after `species`). */
  team?: string[];
}

/** The camera as a zone needs it: no limits on how near or far it comes, its own controls off (the zone moves it). */
function readyCamera(camera: Camera): void {
  const cam = camera as unknown as { detachControl?: () => void; lowerRadiusLimit: number; upperRadiusLimit: number; maxZ: number };
  cam.detachControl?.();
  cam.lowerRadiusLimit = 0.1; cam.upperRadiusLimit = 200; cam.maxZ = Math.max(cam.maxZ, 400);
}

/** The controls, as key caps in a column bottom right (the moves are on the move bar, with their keys). */
function helpLine(_moves: MoveKit, _withBar = true): HTMLDivElement {
  document.querySelector('[data-pf-help]')?.remove();
  return new ControlsLegend([[['A', 'D'], 'run'], [['Space'], 'jump / fly'], [['U'], 'hold to aim, let go to fire'], [['W', 'S'], 'swing the aim'], [['R'], 'restart']]).el;
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
    species: species(o.species ?? 'Charizard'), moves: o.moves, backdrop: false, scenery: arena.root, team: (o.team ?? []).map(species),
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

/**
 * Pallet Town (palletTown.ts): FireRed's town side-on, south to the left — you a Pokéball until your first Pokémon,
 * rolling and hopping, waking in your bedroom upstairs. (Your Pokéball's body a small species' — its height its size.)
 */
export async function startPalletTown(d: ZoneDeps, o: { body?: string } = {}): Promise<Zone> {
  const { scene, factory, camera } = d;
  readyCamera(camera);
  scene.fogMode = 0;
  const town = palletTown(scene);
  // (Its static scenery batched — merged by chunk and material into few meshes, few draws. Not what moves, toggles,
  // fades on its own or is looked up by name: doors and gates, the starters' balls, the lab's loft, the grass fur, the
  // buildings' walls (each fades on its own), the big trees and outcrops (each fades on its own).)
  // Nor what stands in front of where you walk (it may come between you and the eye: faded alone, not with its chunk).
  batchStatic(scene, town.root, {
    chunk: 18, floors: FLOORS, frontZ: -1.2,
    exclude: /Door|Gate|gate|labBall|pokeball|labLoft|furShell|Facade|Tuft|holo|Secret|Side|Back$|Jamb|Lintel|Post|Header|Chimney|Great|Old|Outcrop|Nook|Arch|Roots|Branch|Webs|Lamp|lamp/,
  });
  let story: ReturnType<typeof palletStory> | null = null;
  let oakSaid = 0;
  const pf = await Platformer.start(scene, factory, camera, {
    species: species(o.body ?? 'Pichu'), moves: {}, level: town.level, start: town.start, backdrop: false, scenery: town.root, ball: true,
    // (Your Pokémon form locked till your starter is yours.)
    formLocked: true, onFormLocked: () => story?.say('You have no Pokémon yet.'),
    // (Only the scenery within reach of the camera drawn: the town and its route are long.)
    cullRange: 36,
    // (No attacking in town: Prof. Oak's word on it. Route 1, past its gate, is fair game.)
    attacksAllowed: (x) => x > ROUTE_GATE + 0.3,
    onNoAttack: () => {
      const now = performance.now();
      if (now - oakSaid > 2600) { oakSaid = now; story?.oak("There's a time and place for everything! But not now."); }
    },
  });
  document.querySelector('[data-pf-help]')?.remove();
  // (The controls, bottom right: what you can do as you are — rolling as a Poké Ball, running as a Pokémon; picking
  // and sending out once you've a starter.)
  let haveStarter = false;
  const box = new ControlsLegend();
  const legend = () => box.set([
    [['A', 'D'], pf.player.ball ? 'roll' : 'run'], [['Space'], 'jump'],
    ...(haveStarter ? [[['Q', 'E'], 'pick'], [['X'], pf.player.ball ? 'send out' : 'Poké Ball']] as [string[], string][] : []),
    [['R'], 'restart'],
  ]);
  legend();
  // (Its story's gates: the lab locked, Route 1 open — till Prof. Oak stops you in the tall grass.)
  story = palletStory(scene, pf, town);
  const pick = starterSelect(scene, factory, pf, town, {
    active: () => story?.stage === 'lab', say: (t, secs) => story?.say(t, secs), onChosen: () => { haveStarter = true; legend(); story?.starterChosen(); },
  });
  (window as unknown as { __starter?: unknown }).__starter = pick;
  // (Behind it all: Kanto's country — sky, clouds, three ranges of mountains, hills — the painted layers' parallax.)
  const country = paintedBackdrop(scene, 'kanto', SHORE - 40, town.routeEnd + 40);
  // (Route 1's wild Pokémon, in its tall grass: every species ever found on Route 1 that there's a model for — Pidgey
  // and its line, Spinarak, Bellsprout commonest; Charizard and Dragonite, overhead in Let's Go, very rare.)
  const wild = wildPokemon(pf, {
    grass: town.grass, say: (t, secs) => story?.say(t, secs),
    table: [{ species: 'Pidgey', weight: 40 }, { species: 'Bellsprout', weight: 20 }, { species: 'Spinarak', weight: 4 },
      { species: 'Pidgeotto', weight: 12 }, { species: 'Pidgeot', weight: 3 }, { species: 'Charizard', weight: 1.2 }, { species: 'Dragonite', weight: 0.8 }],
  });
  (window as unknown as { __wild?: unknown }).__wild = wild;
  // (The sun's shadows kept sharp all along the town and its route: its shadow box a window round the camera, moving
  // with it — not stretched over the whole long level, too coarse to see, and short of its far end.)
  const unshadow = followShadows(scene, () => pf.focusPoint);
  // (Route 1's signs read as you pass them: each once, till you've gone on and come back.)
  const read = new Set<number>();
  const signs = scene.onBeforeRenderObservable.add(() => {
    const p = pf.player;
    for (const [i, s] of town.signs.entries()) {
      const near = Math.abs(p.x - s.x) < 1.3 && Math.abs(p.y - s.y) < 1.5;
      if (near && !read.has(i)) { read.add(i); story?.sign(s.text); }
      if (!near && Math.abs(p.x - s.x) > 4) read.delete(i);
    }
  });
  // (The tall grass pushed aside round you, as you go through it.)
  const unsee = pushAside(scene, () => ({ at: pf.player.node.position.clone(), h: pf.player.H }));
  // (The buildings' front walls: faded away while you are inside one.)
  const walls = scene.onBeforeRenderObservable.add(() => { town.update(pf.player.x, pf.player.y, scene.getEngine().getDeltaTime() / 1000); legend(); });
  (window as unknown as { __pallet?: unknown }).__pallet = story;
  return { pf, arena: null, dispose: () => { scene.onBeforeRenderObservable.remove(walls); scene.onBeforeRenderObservable.remove(signs); unshadow(); country.dispose(); unsee(); wild.dispose(); pick.dispose(); story.dispose(); box.dispose(); pf.dispose(); town.dispose(); } };
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
