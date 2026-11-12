// Demo: the metroidvania prototype (src/client/platformer/Platformer.ts) — Charizard, side on, in its first room:
// a floor with a pit, steps up to a high ledge, floating platforms, a wall to jump.
//   A / D or ← / →: run      Space: jump (hold for higher)      W / S or ↑ / ↓: look up / down (aim)
//   Space in the air: fly (held: rise; let go: glide down onto a platform)
//   Moves: U ranged (Flamethrower)   I close (Dragon Claw)   J mobility (Quick Attack)   K control (none yet)
//   (At Venusaur ahead: three hits and it faints, then stands again.)
// Backdrop: window.__platformer = { backdrop: 'forest' | 'volcano' | 'snowfield' } (default: plain hills).
// Species and moves: window.__platformer = { species: 'Garchomp', enemy: 'Snorlax', moves: { ranged: 'Dragon Pulse', close: 'Dragon Claw', mobility: 'Quick Attack' } } first.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/platformer.js')).text())
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { Platformer } = await import('/src/client/platformer/Platformer.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  // The board and its surroundings away; no fog over the level.
  for (const m of sc.meshes) m.setEnabled(false);
  sc.fogMode = 0;
  const cam = sc.activeCamera;
  cam.detachControl?.();
  cam.lowerRadiusLimit = 0.1; cam.upperRadiusLimit = 200; cam.maxZ = Math.max(cam.maxZ, 400);
  window.__pf?.dispose();
  const o = { species: 'Charizard', ...(window.__platformer ?? {}) };
  // A practice target ahead, on the floor under the high step.
  const enemies = [{ species: S.getSpecies(o.enemy ?? 'Venusaur'), x: 19, y: 0 }];
  window.__pf = await Platformer.start(sc, f, cam, { species: S.getSpecies(o.species), enemies, moves: o.moves, backdrop: o.backdrop ?? true });
  const help = document.createElement('div');
  Object.assign(help.style, { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 14px system-ui', borderRadius: '8px', zIndex: 60 });
  const m = window.__pf.moves;
  help.textContent = `A / D: run    Space: jump · in the air: fly    W / S: aim    U ${m.ranged ?? '—'} · I ${m.close ?? '—'} · J ${m.mobility ?? '—'} · K ${m.control ?? '—'}`;
  document.body.append(help);
  document.querySelector('canvas').focus();
})();
