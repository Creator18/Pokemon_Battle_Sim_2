// Demo: one Quick Attack (J) into the boss braced for Sucker Punch — and then a chain of counters that never lands: each
// time one goes off, the one it is coming for braces as its striker reappears and turns it back, on and on.
// (Its cooldown waived for this: each braces again the moment its turn comes.) A broken chain starts a new round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/counter-counter-loop.js')).text())
// Counter's chain instead (physical blows only; gone backwards, back in at the front): window.__ccBrace = 'Counter'.
// Mid-air (both held aloft, level): window.__ccAir = true.
// Stop: window.__cc.stop = true — window.__cc.links: counters in the current chain; window.__cc.rounds: past chains
(async () => {
  // (Boot's own zone made first — else it lives on under this one.)
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  window.__loop && (window.__loop.stop = true);
  window.__zip && (window.__zip.stop = true);
  window.__counter && (window.__counter.stop = true);
  window.__clashHold?.release();
  if (window.__cc) { window.__cc.stop = true; await new Promise((r) => setTimeout(r, 2000)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  const brace0 = window.__ccBrace ?? 'Sucker Punch';
  window.__zone = await P.startBossZone({ species: window.__ccSpecies ?? 'Charizard',
    moves: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Quick Attack', control: brace0 } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  // (The boss's kit has no control move: Sucker Punch, for this.)
  B.moves.control = brace0;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const key = async (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); await sleep(0.05); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  // The boss: still — its braces are the chain's.
  pf.ai.think = function () {
    const me = this.me, foe = this.foe, face = Math.sign(foe.x - me.x) || me.facing;
    return { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false, face };
  };
  pf.ai.paused = false;
  pf.restart(); await sleep(1.2);
  const c = window.__cc = { stop: false, links: 0, rounds: [] };
  const air = !!window.__ccAir, y = air ? 3.2 : 0;
  // (Aloft: both held up, level, still — but for their moves.)
  const keep = air ? sc.onBeforeRenderObservable.add(() => {
    for (const f of [Pl, B]) if (!f.quick && !f.down) { f.flying = true; f.vy = 0; if (!f.busy) f.vx = 0; if (Math.abs(f.y - y) > 0.01 && !f.busy) f.node.position.y = y; }
  }) : null;
  const brace = (f) => { f.counterReady = 0; f.brace(); };
  const byName = (name) => (name === Pl.name ? Pl : B);
  while (!c.stop) {
    Pl.restore(); B.restore();
    Pl.place(-3, y, 1); B.place(3, y, -1); Pl.face(1, true); B.face(-1, true);
    await sleep(1.0);
    let n = pf.events.length;
    c.links = 0;
    brace(B);
    await sleep(0.15);
    // The opener: one Quick Attack into its brace.
    await key('j');
    // The chain: a counter going off on X's blow — X braces as its striker reappears behind it.
    let broken = false;
    while (!c.stop && !broken) {
      let went = null;
      const t0 = performance.now();
      while (!went && performance.now() - t0 < 3000) {
        for (; n < pf.events.length; n++) {
          const e = pf.events[n].text;
          const m = /^(?:sucker punch|counter): (.+?) on (.+?)'s /.exec(e);
          if (m) { went = { striker: byName(m[1]), on: byName(m[2]) }; n++; break; }
          if (!/^(sucker punch|counter):/.test(e) && e.includes('→')) broken = true;
        }
        if (broken) break;
        await frame();
      }
      if (!went) { broken = true; break; }
      c.links++;
      const { striker, on } = went;
      // (Sucker Punch: it vanishes, then reappears behind its target — brace then. Counter's comes in already swinging,
      // its blow landing before it is quite done: brace as it vanishes.)
      for (let i = 0; i < 120 && !striker.quick; i++) await frame();
      if (brace0 !== 'Counter') for (let i = 0; i < 120 && striker.quick; i++) await frame();
      brace(on);
    }
    c.rounds.push({ links: c.links, last: pf.events.slice(-2).map((e) => e.text) });
    await sleep(2);
  }
  if (keep) sc.onBeforeRenderObservable.remove(keep);
})();
