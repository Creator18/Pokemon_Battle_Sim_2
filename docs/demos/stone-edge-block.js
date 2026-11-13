// Demo: a beam obstructed by Stone Edge — the player raises its pillars, then fires a beam (Dragon Pulse by default) at
// the boss standing behind them: the beam stops at the first pillar in its line, the boss untouched. Looped.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/stone-edge-block.js')).text())
// Others first: window.__sbBeam = 'Dragon Pulse' (any beam: 'Flamethrower', 'Thunderbolt'…). Stop: window.__sb.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf', '__miss', '__tb', '__tb2', '__eq', '__se', '__sb']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  window.__tbHold?.release();
  await new Promise((r) => setTimeout(r, 400));
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: 'Charizard', boss: 'Pikachu',
    moves: { ranged: 'Stone Edge', close: 'Earthquake', mobility: 'Quick Attack', control: 'Detect' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 800));
  pf.restart(); pf.ai.paused = true;
  const a = pf.player, b = pf.boss;
  a.damageTo = () => 1;
  // (The camera still, side-on, the whole row in view.)
  pf.follow = () => {};
  const cam = P.scene.activeCamera, V = a.node.position.constructor;
  cam.setTarget(new V(-1.5, 1.8, 0)); cam.setPosition(new V(-1.5, 3.4, -17));
  const state = (window.__sb = { stop: false });
  while (!state.stop) {
    a.hp = a.maxHp; b.hp = b.maxHp;
    a.moves.ranged = 'Stone Edge';
    a.place(-6, 0, 1); b.place(3.5, 0, -1); a.face(1, true); b.face(-1, true);
    await new Promise((r) => setTimeout(r, 900));
    a.readyAt?.clear?.();
    a.fire(pf.arena);
    // (Up, all of them — the boss off its pillar, back on the floor behind the wall.)
    await new Promise((r) => setTimeout(r, 2200));
    b.place(6.5, 0, -1); b.face(-1, true);
    // (It steps back from its wall, for the beam's length to show.)
    a.place(-9.5, 0, 1); a.face(1, true);
    await new Promise((r) => setTimeout(r, 500));
    a.moves.ranged = window.__sbBeam ?? 'Dragon Pulse';
    a.readyAt?.clear?.();
    a.face(1, true);
    a.fire(pf.arena);
    await new Promise((r) => setTimeout(r, 5200));
  }
})();
