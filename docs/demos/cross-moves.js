// Demo: the cross moves (RecipeFactory.playCrossSlash) — Cross Chop (Machamp), Cross Poison (Gengar), X-Scissor
// (Scizor): two slashes in quick succession, one from each arm, each flowing along its arm, afterimages along both;
// a flinch on Metagross at each blow. Round and round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/cross-moves.js')).text())
// Stop: window.__crossMoves.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-1, 2), Bp = T(1, 2);
  const MOVES = [['Machamp', 'Cross Chop', 'Fighting'], ['Gengar', 'Cross Poison', 'Poison'], ['Scizor', 'X-Scissor', 'Bug']]
    .filter(([n]) => !window.__crossOnly || n === window.__crossOnly); // (window.__crossOnly = 'Scizor': that one alone)
  const users = [];
  for (const [n] of MOVES) { const u = await f.createPokemon(S.getSpecies(n), 1); u.position.copyFrom(A); u.setEnabled(false); users.push(u); }
  const b = await f.createPokemon(S.getSpecies('Metagross'), 2); b.position.copyFrom(Bp);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, Bp).add(new V(0, 1.0, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(9)).add(w.scale(-0.5)).add(new V(0, 1.8, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  document.body.append(label);
  const st = (window.__crossMoves = { stop: false });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  await sleep(0.8);
  for (let i = 0; !st.stop; i = (i + 1) % MOVES.length) {
    const [name, move, type] = MOVES[i], a = users[i];
    for (const u of users) u.setEnabled(u === a);
    a.position.copyFrom(A); f.faceEachOther(a, b);
    label.textContent = `${name} — ${move}`;
    await sleep(0.4);
    await f.playCrossSlash(a, b.position.clone(), window.__crossType ?? type, () => void f.playHitReact(b));
    await sleep(1.4);
  }
  label.remove();
})();
