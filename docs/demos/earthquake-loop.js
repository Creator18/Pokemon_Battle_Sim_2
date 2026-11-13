// Demo: Earthquake, looped — the player stamps and its wave runs out round it, a ring over its area, rocks bursting up behind
// it, dust, cracks; the boss (on the ground) struck and thrown up as it reaches it. Pikachu by default: a Flying boss
// would take nothing (Ground can't touch it).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/earthquake-loop.js')).text())
// Others first: window.__eqSpecies = 'Charizard', window.__eqTarget = 'Pikachu'; from the air: window.__eqAir = true.
// Stop: window.__eq.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf', '__miss', '__tb', '__tb2', '__eq']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  window.__tbHold?.release();
  await new Promise((r) => setTimeout(r, 400));
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__eqSpecies ?? 'Charizard', boss: window.__eqTarget ?? 'Pikachu',
    moves: { ranged: 'Flamethrower', close: 'Earthquake', mobility: 'Quick Attack', control: 'Detect' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 800));
  pf.restart(); pf.ai.paused = true;
  const a = pf.player, b = pf.boss;
  // (The look only: its hits a scratch, so the loop never ends in a K.O.)
  a.damageTo = () => 1;
  const state = (window.__eq = { stop: false });
  while (!state.stop) {
    a.hp = a.maxHp; b.hp = b.maxHp;
    a.place(-3, 0, 1); b.place(2, 0, -1); a.face(1, true); b.face(-1, true);
    await new Promise((r) => setTimeout(r, 900));
    // (From the air: up there as it stamps — gone straight up, back in on the ground under it.)
    if (window.__eqAir) { a.place(-3, 3.2, 1); await new Promise((r) => setTimeout(r, 30)); }
    a.readyAt?.clear?.();
    window.__eq.at = performance.now();
    a.slash(window.__pf.arena);
    await new Promise((r) => setTimeout(r, 2800));
  }
})();
