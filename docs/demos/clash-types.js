// Demo: beam 2 (the aura beam) clashing, round and round through all eighteen
// types — each round one type against another, meeting in the middle, held a
// while, then a tie (the ball bursts, both fade) and on to the next pair.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/clash-types.js')).text())
// Stop: window.__clashTypes.stop = true. Beam 1 instead: window.__beamStyle = 1 first; beam 1 against beam 2: window.__beamMix = true first; beam 2's soft outline: window.__beamOutline = 'soft' first.
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  /** The types, and how long each clash holds (s), the pause between (s). */
  const TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground',
    'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  const HOLD = 4, PAUSE = 1.2;
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-2, 2), B = T(2, 2);
  const a = await f.createPokemon(S.getSpecies('Dragonite'), 1), b = await f.createPokemon(S.getSpecies('Garchomp'), 2);
  a.position.copyFrom(A); b.position.copyFrom(B); f.faceEachOther(a, b);
  const w = B.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = T(0, 2).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(10)).add(new V(0, 2, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  document.body.append(label);
  const st = (window.__clashTypes = { stop: false });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const style = window.__beamStyle ?? 2;
  // Beam 1 against beam 2: window.__beamMix = true first — which side fires which swapping every round.
  const mix = !!window.__beamMix;
  await sleep(0.8);
  // Each type in turn on the left, against the one half the list round on the right: every type meets a different one.
  for (let i = 0; !st.stop; i = (i + 1) % TYPES.length) {
    const left = TYPES[i], right = TYPES[(i + 7) % TYPES.length];
    const [sl, sr] = mix ? (i % 2 ? [2, 1] : [1, 2]) : [style, style];
    label.textContent = mix ? `${left} (beam ${sl})  vs  ${right} (beam ${sr})` : `${left}  vs  ${right}   (beam ${style})`;
    let release; const held = new Promise((r) => { release = r; });
    const outline = window.__beamOutline; // beam 2's outline: 'cel' (default) or 'soft'
    const play = f.playClash(a, b, { element: left, style: sl, outline }, { element: right, style: sr, outline }, null, 0, held, 0.5);
    await play.met;
    await sleep(HOLD);
    release();
    await play.done;
    await sleep(PAUSE);
  }
  label.remove();
})();
