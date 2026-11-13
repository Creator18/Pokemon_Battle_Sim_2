/**
 * Pallet Town's story gates (the opening of FireRed's story, as a Metroidvania's gates):
 *
 *   'home'  — you wake in your bedroom: your house opens both ways; Route 1's way north is open, Prof. Oak's Lab locked
 *             (he's out). Step into Route 1's tall grass and Prof. Oak stops you — and leads you back to his lab.
 *   'lab'   — the lab open (its door gone), Route 1's gate closed behind you (not without a Pokémon): the way north
 *             shut, the way south (the lab) open — till you have your starter (later).
 *
 * Its doors are platforms pushed into (and spliced out of) the level the fighters collide with (the same array).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Platformer } from '../platformer/Platformer.ts';
import type { Platform } from '../platformer/Fighter.ts';
import type { PalletTown } from './palletTown.ts';
import { LAB, ROUTE_GATE, GRASS_FROM, HOME } from './palletTown.ts';

export type PalletStage = 'home' | 'lab' | 'starter';

export interface PalletStory {
  readonly stage: PalletStage;
  /** Jump to a stage (for testing): its gates set, you put where it begins. */
  set(stage: PalletStage): void;
  /** A line in the text box (no speaker: a thought, a sign). */
  say(text: string, secs?: number): void;
  /** Prof. Oak's line in the text box. */
  oak(text: string, secs?: number): void;
  /** Your starter chosen: Route 1 open to you. */
  starterChosen(): void;
  dispose(): void;
}

const LAB_DOOR: Platform = { x: LAB.x1 - 0.4, top: LAB.y + 1.9, w: 0.4, h: 1.9, hidden: true };
const ROUTE_DOOR: Platform = { x: ROUTE_GATE - 0.15, top: HOME.y + 3, w: 0.3, h: 3, hidden: true };

export function palletStory(scene: Scene, pf: Platformer, town: PalletTown): PalletStory {
  let stage: PalletStage = 'home';
  let busy = false, run = 0;
  const level = town.level;
  const gate = (p: Platform, shut: boolean) => {
    const i = level.indexOf(p);
    if (shut && i < 0) level.push(p);
    if (!shut && i >= 0) level.splice(i, 1);
  };

  // A text box (bottom of the screen), and the fade for the walk to the lab.
  const say = document.createElement('div');
  say.style.cssText = 'position:fixed;left:50%;bottom:6%;transform:translateX(-50%);max-width:640px;width:calc(100% - 32px);'
    + 'padding:14px 20px;border-radius:10px;background:rgba(255,255,255,.95);border:3px solid #3a5a8c;color:#1d2433;'
    + 'font:600 17px/1.4 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);display:none;z-index:30;pointer-events:none';
  const fade = document.createElement('div');
  fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .45s;pointer-events:none;z-index:29';
  document.body.append(fade, say);
  let sayUntil = 0;
  const speak = (who: string | null, text: string, secs = 3.2) => {
    say.innerHTML = '';
    if (who) { const b = document.createElement('div'); b.textContent = who; b.style.cssText = 'color:#c0392b;font-size:14px;margin-bottom:2px'; say.append(b); }
    say.append(document.createTextNode(text));
    say.style.display = 'block';
    sayUntil = performance.now() + secs * 1000;
  };
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const enter = (s: PalletStage) => {
    stage = s;
    gate(LAB_DOOR, s === 'home');
    gate(ROUTE_DOOR, s === 'lab');  // (After your starter, open again.)
    town.doors.lab.setEnabled(s === 'home');
    town.doors.route.setEnabled(s === 'lab');
  };
  enter('home');

  let lockedSaid = 0;
  let held: { x: number; y: number } | null = null;
  const tick = () => {
    if (performance.now() > sayUntil) say.style.display = 'none';
    const p = pf.player;
    // (While Prof. Oak talks you through it, you hold still.)
    if (busy) { if (held) p.place(held.x, held.y, 1); return; }
    if (stage === 'home') {
      // (At the lab's locked door — either side of it, outside.)
      if (Math.abs(p.x - LAB.x1) < 0.9 && p.y < LAB.y + 1 && performance.now() - lockedSaid > 4000) {
        lockedSaid = performance.now();
        speak(null, "It's locked. A note on the door: \"Out on an errand. — Prof. Oak\"");
      }
      // (Into Route 1's tall grass: Prof. Oak stops you.)
      if (p.x > GRASS_FROM + 0.8) void stopped();
    } else if (stage === 'lab' && Math.abs(p.x - ROUTE_GATE) < 1.2 && performance.now() > sayUntil) {
      speak(null, 'The gate is shut. Prof. Oak wants you in his lab first.', 2.4);
    }
  };
  const stopped = async () => {
    const mine = ++run;
    busy = true; held = { x: pf.player.x, y: pf.player.y };
    speak('PROF. OAK', 'Hold it! Wild Pokémon live in that tall grass — you can\'t go out there alone! Come with me.', 3.4);
    await wait(2600);
    if (mine !== run) return;
    fade.style.opacity = '1';
    await wait(600);
    if (mine !== run) return;
    enter('lab');
    held = { x: -16.5, y: LAB.y + 0.05 };
    await wait(300);
    fade.style.opacity = '0';
    speak('PROF. OAK', 'Here, in my lab. On that table — pick one of the three Poké Balls.', 3.6);
    await wait(1200);
    if (mine !== run) return;
    busy = false; held = null;
  };

  const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(tick)!;
  return {
    get stage() { return stage; },
    say(text, secs = 2.4) { speak(null, text, secs); },
    oak(text, secs = 2.6) { speak('PROF. OAK', text, secs); },
    starterChosen() { if (stage === 'lab') enter('starter'); },
    set(s) {
      run++; busy = false; held = null; fade.style.opacity = '0'; say.style.display = 'none';
      enter(s);
      if (s === 'lab') pf.player.place(-16.5, LAB.y + 0.05, 1);
      else pf.player.place(town.start.x, town.start.y, 1);
    },
    dispose() { scene.onBeforeRenderObservable.remove(obs); say.remove(); fade.remove(); gate(LAB_DOOR, false); gate(ROUTE_DOOR, false); },
  };
}
