// Beam-clash stopper tests in the boss zone: the boss fires on cue and stops its needle within `bossBand` of the
// middle; you fire a moment later and stop within `youBand` (null: never press).
//   (0, eval)(await (await fetch('/docs/demos/clash-stopper-test.js')).text())
//   await __setupDuel({ species: 'Mega Charizard Y' });  // startBossZone options
//   await __duel({ gap: 10, youBand: 0.1, bossBand: 0.4 }) // → { events, hp }
(() => {
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const key = (k, d) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { key: k }));
  const tap = async (k) => { key(k, true); await sleep(0.04); key(k, false); };
  window.__setupDuel = async (zoneOpts = {}) => {
    window.__zip && (window.__zip.stop = true);
    window.__zone?.dispose();
    window.__zone = await window.__pbw.startBossZone(zoneOpts);
    window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
    const ai = window.__pf.ai;
    ai.think = function () {
      const me = this.me, foe = this.foe, face = Math.sign(foe.x - me.x) || me.facing;
      const idle = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false, face };
      if (me.clashing) { const n = me.clashing.needle(); return { ...idle, ranged: n !== null && me.clashing.stopped() === null && Math.abs(n) <= window.__bossBand }; }
      if (window.__bossFire) { window.__bossFire = false; return { ...idle, ranged: true }; }
      return idle;
    };
  };
  window.__duel = async ({ gap = 10, youBand = 0.1, bossBand = 0.4, youDelay = 0.3 } = {}) => {
    const pf = window.__pf, P = pf.player, B = pf.boss;
    pf.restart(); pf.ai.paused = false; await sleep(0.4);
    P.place(-gap / 2, 0, 1); B.place(gap / 2, 0, 1); P.face(1, true); B.face(-1, true); await sleep(0.6);
    window.__bossBand = bossBand;
    const n0 = pf.events.length;
    window.__bossFire = true; await sleep(youDelay);
    await tap('u');
    const t0 = performance.now(); let pressed = false;
    while (performance.now() - t0 < 10000) {
      const c = P.clashing;
      if (c && !pressed && youBand != null) { const n = c.needle(); if (n !== null && Math.abs(n) <= youBand) { await tap('u'); pressed = true; } }
      if (!P.clashing && !B.clashing && !P.firing && !B.firing && performance.now() - t0 > 2500) break;
      await frame();
    }
    await sleep(0.5);
    return { events: pf.events.slice(n0).map((e) => `${e.t} ${e.text}`), hp: { you: P.hp, boss: B.hp } };
  };
})();
