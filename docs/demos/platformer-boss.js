// Demo: a boss zone for the metroidvania — the colosseum (render/arenas/colosseum.ts): the grass stadium's lawns, and
// behind them painted layers (podium wall, tiers of benches packed with a crowd, the arched outer wall, hills, sky)
// that shift against each other as the camera moves; nothing on the camera's side. No platforms: a flat floor along
// the pitch, walled at its ends. Charizard (you) against a boss Charizard (BossAI) with the same moves.
// (look in window.__boss: 'league' — the default, a modern League stadium with its scoreboard — 'colosseum', or
// 'stadium' for the 3D grass stadium.)
//   A / D: run    Space: jump · Space in the air: fly (held: rise; let go: glide down)    W / S: look up / down (aim)
//   U ranged (Flamethrower)   I close (Dragon Claw)   J mobility (Quick Attack)   K control (none yet)
//   R: fight again once it is over.
// Who: window.__boss = { species: 'Charizard', boss: 'Charizard', moves: {...}, bossMoves: {...}, halfW: 14 } first.
// Read a fight back: window.__pf.events (blows, faints), window.__pf.ai.log (what the boss saw and chose).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/platformer-boss.js')).text())
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { Platformer, bossRoom } = await import('/src/client/platformer/Platformer.ts');
  const { grassStadium } = await import('/src/client/render/arenas/grassStadium.ts');
  const { colosseum } = await import('/src/client/render/arenas/colosseum.ts');
  const { leagueStadium } = await import('/src/client/render/arenas/leagueStadium.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  for (const m of sc.meshes) m.setEnabled(false);
  window.__pf?.dispose();
  window.__arena?.dispose?.();
  // (The boss's ranged move Dragon Pulse, yours Flamethrower: their clashes not a mirror.)
  const o = { species: 'Charizard', boss: 'Charizard', look: 'league',
    bossMoves: { ranged: 'Dragon Pulse', close: 'Dragon Claw', mobility: 'Quick Attack' }, ...(window.__boss ?? {}) };
  // The arena: its own air (a far fog), the pitch its floor.
  const arena = (window.__arena = o.look === 'stadium' ? grassStadium(sc) : o.look === 'colosseum' ? colosseum(sc) : leagueStadium(sc));
  P.field.setAir(arena.air); sc.clearColor = arena.air.fog.toColor4(1);
  const cam = sc.activeCamera;
  cam.detachControl?.();
  cam.lowerRadiusLimit = 0.1; cam.upperRadiusLimit = 200; cam.maxZ = Math.max(cam.maxZ, 400);
  // The zone: a fighting width along the pitch (`halfW` each way of the middle), so the camera never has to pull back
  // out of the stadium to frame both.
  const halfW = o.halfW ?? Math.min(11, arena.bounds.halfW - 1);
  window.__pf = await Platformer.start(sc, f, cam, {
    species: S.getSpecies(o.species), moves: o.moves, backdrop: false, scenery: arena.root,
    level: bossRoom(halfW), start: { x: -7, y: 0 },
    enemies: [{ species: S.getSpecies(o.boss), x: 7, y: 0, boss: true, moves: o.bossMoves }],
  });
  window.__pf.restart();
  // The scoreboard (the League stadium's): both sides' names and HP, the fight's clock, its result.
  clearInterval(window.__boardTick);
  if (arena.scoreboard) {
    const pf = window.__pf;
    arena.follow?.(pf.player.node, pf.boss.node);
    const short = (n) => n.replace(/ \((you|boss)\)$/, '');
    window.__boardTick = setInterval(() => {
      arena.scoreboard.update({ name: short(pf.player.name), hp: pf.player.hp, max: pf.player.maxHp },
        { name: short(pf.boss.name), hp: pf.boss.hp, max: pf.boss.maxHp }, pf.time,
        pf.result === 'won' ? 'YOU WIN!' : pf.result === 'lost' ? 'DEFEATED' : '');
    }, 200);
  }
  document.querySelector('[data-pf-help]')?.remove();
  const help = document.createElement('div');
  help.dataset.pfHelp = '';
  Object.assign(help.style, { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 14px system-ui', borderRadius: '8px', zIndex: 60, whiteSpace: 'nowrap' });
  const m = window.__pf.moves;
  help.textContent = `A / D run · Space jump / fly · W / S aim · U ${m.ranged ?? '—'} · I ${m.close ?? '—'} · J ${m.mobility ?? '—'} · K ${m.control ?? '—'}`;
  document.body.append(help);
  document.querySelector('canvas').focus();
})();
