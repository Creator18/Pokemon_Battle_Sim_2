// Mockup demo: Metagross vs Charizard on the board, with the overlay over it.
// Run in the page: (0, eval)(await (await fetch('/docs/ui-mockup/demo.js')).text())
(async () => {
  if (!window.__built) {
    window.__built = true;
    const S = await import('/src/shared/index.ts');
    const P = window.__pbw, f = P.factory, sc = P.scene;
    for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
    P.camera.tick = () => {};
    const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
    const m = await f.createPokemon(S.getSpecies('Metagross'), 1), z = await f.createPokemon(S.getSpecies('Charizard'), 2);
    m.position.copyFrom(T(-2, 2)); z.position.copyFrom(T(1, 2)); f.faceEachOther(m, z);
    const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
    const c = T(-0.5, 2).add(new V(0, 1, 0)); cam.setTarget(c);
    const w = T(1, 2).subtract(T(-2, 2)).normalize(); const side = new V(w.z, 0, -w.x);
    cam.setPosition(c.add(side.scale(-10)).add(new V(0, 5, 0)));
    f.aura(m, { element: 'Psychic', edge: 'tongues', reach: 'body' });
    (await import('/src/client/ui/dom.ts')).ensureStyles();
  }
  document.getElementById('dexui')?.remove();
  const html = await (await fetch('/docs/ui-mockup/overlay.html?' + Date.now())).text();
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  const scripts = [...wrap.querySelectorAll('script')]; scripts.forEach((s) => s.remove());
  document.body.append(...wrap.childNodes);
  for (const s of scripts) (0, eval)(s.textContent);
})();
