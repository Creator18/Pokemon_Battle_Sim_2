// Demo: Sucker Punch (K) against the boss's Dragon Pulse, looped, alternating grounded and mid-air: the boss fires on cue,
// you brace as its beam launches, and as it is about to hit you are gone in speed lines and back behind it, striking
// (its beam pouring on into empty air).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/counter-loop.js')).text())
// Stop: window.__counter.stop = true — its rounds' events: window.__counter.rounds
(async () => {
  const P = window.__pbw, sc = P.scene;
  window.__loop && (window.__loop.stop = true);
  window.__zip && (window.__zip.stop = true);
  window.__clashHold?.release();
  if (window.__counter) { window.__counter.stop = true; await new Promise((r) => setTimeout(r, 2000)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__counterSpecies ?? 'Charizard' });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const key = async (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); await sleep(0.05); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  // The boss: still, but for one beam when told.
  let fire = false;
  pf.ai.think = function () {
    const me = this.me, foe = this.foe, face = Math.sign(foe.x - me.x) || me.facing;
    const idle = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false, face };
    if (fire) { fire = false; return { ...idle, ranged: true }; }
    return idle;
  };
  pf.ai.paused = false;
  pf.restart(); await sleep(1.2);
  const c = window.__counter = { stop: false, air: false, rounds: [] };
  // (A mid-air round: both held aloft, level, still.)
  const keep = sc.onBeforeRenderObservable.add(() => {
    if (!c.air) return;
    for (const f of [Pl, B]) if (!f.quick && !f.down) { f.flying = true; f.vy = 0; if (!f.busy) f.vx = 0; }
  });
  while (!c.stop) {
    Pl.restore(); B.restore();
    const y = c.air ? 3.2 : 0;
    Pl.place(-4, y, 1); B.place(4, y, 1); Pl.face(1, true); B.face(-1, true);
    await sleep(0.9);
    const n0 = pf.events.length;
    fire = true;
    // Braced as its beam launches.
    for (let i = 0; i < 300 && !(B.beam && B.beam.launched); i++) await sleep(0.01);
    await key('k');
    await sleep(3.6);
    c.rounds.push({ air: c.air, events: pf.events.slice(n0).map((e) => e.text) });
    c.air = !c.air;
    // (Its cooldown run out before the next.)
    await sleep(0.6);
  }
  sc.onBeforeRenderObservable.remove(keep);
})();
