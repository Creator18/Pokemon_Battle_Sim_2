// Demo: Stone Edge, looped — the player's pillars bursting up out of the floor in a row toward the boss: the floor
// cracking first, the wall between stepped up toward it, the one under the boss striking it and throwing it up onto its
// top; standing as platforms, shaking, then crumbling. The boss on the ground, still (no fight: the look only).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/stone-edge-loop.js')).text())
// Others first: window.__seSpecies = 'Charizard', window.__seTarget = 'Pikachu'. Stop: window.__se.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf', '__miss', '__tb', '__tb2', '__eq', '__se']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  window.__tbHold?.release();
  await new Promise((r) => setTimeout(r, 400));
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__seSpecies ?? 'Charizard', boss: window.__seTarget ?? 'Pikachu',
    moves: { ranged: 'Stone Edge', close: 'Earthquake', mobility: 'Quick Attack', control: 'Detect' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 800));
  pf.restart(); pf.ai.paused = true;
  const a = pf.player, b = pf.boss;
  // (The look only: its hits a scratch, so the loop never ends in a K.O.)
  a.damageTo = () => 1;
  const state = (window.__se = { stop: false });
  while (!state.stop) {
    a.hp = a.maxHp; b.hp = b.maxHp;
    a.place(-6, 0, 1); b.place(3.5, 0, -1); a.face(1, true); b.face(-1, true);
    await new Promise((r) => setTimeout(r, 900));
    a.readyAt?.clear?.();
    window.__se.at = performance.now();
    a.fire(window.__pf.arena);
    await new Promise((r) => setTimeout(r, 9000));
  }
})();
