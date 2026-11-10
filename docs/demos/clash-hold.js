// Demo: Dragonite's Hyper Beam against Garchomp's Dragon Pulse — a clash held
// at its stand-off: the two beams meet exactly in the middle and stay locked there,
// pouring, for as long as it runs. Beam 2 (the aura beam) by default; window.__beamStyle = 1 first for beam 1.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/clash-hold.js')).text())
// Let it go (a tie: the ball bursts, both fade): window.__clashHold.release()
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const B = await import('/src/client/vfx/beam/beamMoves.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-2, 2), Bp = T(2, 2);
  const a = await f.createPokemon(S.getSpecies('Dragonite'), 1), b = await f.createPokemon(S.getSpecies('Garchomp'), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = T(0, 2).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(12)).add(new V(0, 3.5, 0)));
  await new Promise((r) => setTimeout(r, 800));
  // The stand-off held till let go: never, unless asked.
  let release; const held = new Promise((r) => { release = r; });
  window.__clashHold = { release, a, b };
  // Beam 2 (the aura beam) — or, with window.__beamStyle = 1 first, beam 1 (the layered beam), as before.
  const style = window.__beamStyle ?? 2;
  f.playClash(a, b, { ...B.beamFor('Hyper Beam'), style }, { ...B.beamFor('Dragon Pulse'), style }, null, 0, held, 0.5);
})();
