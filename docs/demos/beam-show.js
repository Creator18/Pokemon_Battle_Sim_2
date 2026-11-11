// Demo: one Pokémon's beam at Metagross, round and round — any species, or any model folder the roster has no entry
// for yet (window.__beamShow = { name: 'Ceruledge', model: 'pm1109_00_00', like: 'Aegislash', types: ['Fire', 'Ghost'],
// move: 'Hyper Beam' }: built from that folder, its stats borrowed from `like`).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/beam-show.js')).text())
// Stop: window.__beamShowSt.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const B = await import('/src/client/vfx/beam/beamMoves.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const o = { name: 'Ceruledge', model: 'pm1109_00_00', like: 'Aegislash', types: ['Fire', 'Ghost'], move: 'Hyper Beam', ...(window.__beamShow ?? {}) };
  const species = o.model ? { ...S.getSpecies(o.like), name: o.name, types: o.types ?? S.getSpecies(o.like).types, modelId: o.model } : S.getSpecies(o.name);
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-2, 2), Bp = T(2, 2);
  const a = await f.createPokemon(species, 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = T(0, 2).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(13)).add(new V(0, 3.5, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  label.textContent = `${o.name} — ${o.move}`;
  document.body.append(label);
  const st = (window.__beamShowSt = { stop: false, a, b });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  await sleep(0.8);
  while (!st.stop) {
    f.faceEachOther(a, b);
    const play = f.playBeam(a, b, b.position.clone(), B.beamFor(o.move));
    await (play.done ?? sleep(4));
    await sleep(1.5);
  }
  label.remove();
})();
