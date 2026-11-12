// Demo: Counter (K) — physical blows only. Braced, the boss's blow about to land sets it off: gone backwards as a
// back dash (facing it, its jump-down pose), back in at its front striking for twice the blow. Looped over the boss's
// Quick Attack, Dragon Claw (physical: countered) and Dragon Pulse (special: it lands, the brace broken).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/counter-front-loop.js')).text())
// Only some first: window.__cfOnly = ['Quick Attack']. Stop: window.__cf.stop = true — its rounds: window.__cf.rounds
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  if (window.__cf) { window.__cf.stop = true; await new Promise((r) => setTimeout(r, 2000)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__cfSpecies ?? 'Charizard',
    moves: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Agility', control: 'Counter' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const key = async (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); await sleep(0.05); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  // The boss: still, but for one move when told.
  let act = null;
  pf.ai.think = function () {
    const me = this.me, foe = this.foe, face = Math.sign(foe.x - me.x) || me.facing;
    const idle = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false, face };
    if (act) { const a = act; act = null; return { ...idle, [a]: true }; }
    return idle;
  };
  pf.ai.paused = false;
  pf.restart(); await sleep(1.2);
  const c = window.__cf = { stop: false, rounds: [] };
  // (Only some of them first: window.__cfOnly = ['Quick Attack'].)
  const tries = [{ move: 'Quick Attack', act: 'mobility', gap: 5 }, { move: 'Dragon Claw', act: 'close', gap: 2.6 }, { move: 'Dragon Pulse', act: 'ranged', gap: 8 }]
    .filter((t) => !window.__cfOnly || window.__cfOnly.includes(t.move));
  for (let r = 0; !c.stop; r++) {
    const t = tries[r % tries.length];
    Pl.restore(); B.restore();
    Pl.place(-t.gap / 2 - 1, 0, 1); B.place(t.gap / 2 - 1, 0, -1); Pl.face(1, true); B.face(-1, true);
    await sleep(1.0);
    const n0 = pf.events.length;
    // Braced, then its move.
    await key('k'); await sleep(t.act === 'ranged' ? 0.05 : 0.12);
    act = t.act;
    await sleep(3.2);
    c.rounds.push({ move: t.move, events: pf.events.slice(n0).map((e) => e.text) });
    await sleep(0.4);
  }
})();
