// Demo: Lucario's Aura Sphere against Charizard's Dragon Pulse — a ball against a beam (beam 2), as battles play it
// (ResolutionPlayback.playClash: the ball flies in and becomes its half of the clash's ball): they meet in the middle
// and hold there HOLD s (or, hold: Infinity, for good), then let go (a tie: the ball bursts), and again. Species and moves: window.__clashBB =
// { a: 'Lucario', moveA: 'Aura Sphere', b: 'Charizard', moveB: 'Dragon Pulse' } first.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/ball-beam-clash.js')).text())
// Stop: window.__ballBeam.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const B = await import('/src/client/vfx/beam/beamMoves.ts');
  const Ba = await import('/src/client/vfx/beam/ballMoves.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const o = { a: 'Lucario', moveA: 'Aura Sphere', b: 'Charizard', moveB: 'Dragon Pulse', ...(window.__clashBB ?? {}) };
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-2, 2), Bp = T(2, 2);
  const a = await f.createPokemon(S.getSpecies(o.a), 1), b = await f.createPokemon(S.getSpecies(o.b), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = T(0, 2).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(15)).add(new V(0, 4, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  label.textContent = `${o.a} — ${o.moveA}  vs  ${o.b} — ${o.moveB}`;
  document.body.append(label);
  // A move's clash spec, as battles make it: a beam's own, or a ball's (it flies in and becomes its half of the ball).
  const specOf = (name) => {
    const beam = B.beamFor(name);
    if (beam) return beam;
    const ball = Ba.ballFor(name);
    return ball ? { element: ball.element, ball: ball.colours ?? true, tornado: ball.tornado } : { element: 'Normal' };
  };
  // How long each clash holds (s): `hold: Infinity` in window.__clashBB for one held for good (persisted) — let it go
  // with window.__ballBeam.release().
  const HOLD = o.hold ?? 4, GAP = 2.5;
  const st = (window.__ballBeam = { stop: false });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  await sleep(0.8);
  while (!st.stop) {
    let release; const held = new Promise((r) => { release = r; });
    const play = f.playClash(a, b, specOf(o.moveA), specOf(o.moveB), null, 0, held, 0.5);
    st.release = release;
    await (play.met ?? sleep(1.5));
    await (Number.isFinite(HOLD) ? Promise.race([sleep(HOLD), held]) : held);
    release();
    await (play.done ?? sleep(2));
    await sleep(GAP);
  }
  label.remove();
})();
