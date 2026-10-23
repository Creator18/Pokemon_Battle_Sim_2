// Demo: a loop of beam clashes, each played out in full (meet, impact frame,
// stand-off, then a win or a tie), one after another, round and round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/clash-loop.js')).text())
// Stop with: window.__stopClashLoop = true
(async () => {
  window.__built = true;
  window.__stopClashLoop = false;
  const S = await import('/src/shared/index.ts');
  const B = await import('/src/client/vfx/beam/beamMoves.ts');
  const BL = await import('/src/client/vfx/beam/ballMoves.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

  // (A beam's spec, or a ball's as it clashes: its half of the ball.)
  const spec = (move) => {
    const beam = B.beamFor(move);
    if (beam) return beam;
    const ball = BL.ballFor(move);
    return ball ? { element: ball.element, ball: ball.colours ?? true, tornado: ball.tornado } : { element: 'Normal' };
  };
  // [left species, its move, right species, its move, who wins: 'a' | 'b' | null (a tie), the margin]
  const CLASHES = [
    ['Charizard', 'Flamethrower', 'Feraligatr', 'Hydro Pump', 'b', 0.6],
    ['Garchomp', 'Dragon Pulse', 'Delphox', 'Mystical Fire', null, 0],
    ['Delphox', 'Mystical Fire', 'Lucario', 'Aura Sphere', 'a', 0.4],
    ['Feraligatr', 'Hydro Cannon', 'Greninja', 'Hydro Pump', 'a', 0.8],
    ['Garchomp', 'Dragon Rage', 'Charizard', 'Flamethrower', null, 0],
    ['Dragonite', 'Hyper Beam', 'Metagross', 'Flash Cannon', 'a', 0.5],
    ['Venusaur', 'Solar Beam', 'Charizard', 'Flamethrower', 'b', 0.7],
    ['Lucario', 'Aura Sphere', 'Garchomp', 'Dragon Pulse', 'b', 0.3],
  ].filter(([sa, , sb]) => S.getSpecies(sa) && S.getSpecies(sb));

  // Each species built once, kept hidden till its turn.
  const made = new Map();
  const unit = async (name, pid) => {
    const key = `${name}#${pid}`;
    if (!made.has(key)) { const n = await f.createPokemon(S.getSpecies(name), pid); made.set(key, n); }
    return made.get(key);
  };
  const A = T(-2, 2), Bp = T(2, 2);
  const w = Bp.subtract(A).normalize(); const side = new V(w.z, 0, -w.x);
  const c = T(0, 2).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(12)).add(new V(0, 3.5, 0)));

  for (let i = 0; !window.__stopClashLoop; i = (i + 1) % CLASHES.length) {
    const [sa, ma, sb, mb, win, margin] = CLASHES[i];
    const a = await unit(sa, 1), b = await unit(sb, 2);
    for (const n of made.values()) n.setEnabled(n === a || n === b);
    a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
    console.log(`clash ${i + 1}/${CLASHES.length}: ${sa} ${ma} vs ${sb} ${mb} — ${win ? (win === 'a' ? sa : sb) + ' wins' : 'a tie'}`);
    await sleep(0.6);
    const play = f.playClash(a, b, spec(ma), spec(mb), win === 'a' ? a : win === 'b' ? b : null, margin);
    await play.done;
    await sleep(1.0);
  }
})();
