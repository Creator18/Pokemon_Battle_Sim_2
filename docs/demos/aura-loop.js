// Demo: every type's full-body aura on Mewtwo, one after another, round and round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/aura-loop.js')).text())
// Stop: window.__auras.stop = true; hold one: window.__auras.only = 'Fire'
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground',
    'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  const HOLD = 3000;
  const st = (window.__auras = { stop: false, only: null, at: null });

  const who = await f.createPokemon(S.getSpecies('Mewtwo'), 1);
  who.position.copyFrom(T(0, 2));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  const c = T(0, 2).add(new V(0, 1.1, 0)); cam.setTarget(c); cam.setPosition(c.add(new V(-2.5, 1.0, -6)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(16,24,28,0.85)', color: '#fff', font: '600 16px system-ui', borderRadius: '6px', zIndex: 60 });
  document.body.append(label);

  for (let i = 0; !st.stop; i = (i + 1) % TYPES.length) {
    const element = st.only || TYPES[i];
    st.at = element;
    label.textContent = `${element} aura — Mewtwo`;
    const a = f.aura(who, { element, edge: 'smooth', reach: 'body' });
    await a.lit;
    await new Promise((r) => setTimeout(r, HOLD));
    await a.release();
    await new Promise((r) => setTimeout(r, 300));
  }
  label.remove();
})();
