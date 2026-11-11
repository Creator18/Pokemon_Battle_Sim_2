// Demo: the arc slash (ArcSlashFx) — a crescent wiped out round the attacker as it swings, held, eroded and torn
// away, two thinner arcs riding with it; a burst and a flinch on the target as the sweep reaches it. Garchomp at
// Metagross, round and round, each swing the other way and tilt, through a few types.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/arc-slash.js')).text())
// Stop: window.__arcSlash.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { ArcSlashFx } = await import('/src/client/vfx/ArcSlashFx.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-1, 2), Bp = T(1, 2);
  const a = await f.createPokemon(S.getSpecies('Garchomp'), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, Bp).add(new V(0, 1.0, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(6.5)).add(w.scale(-1.5)).add(new V(0, 1.6, 0)));
  const fx = new ArcSlashFx(sc);
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  document.body.append(label);
  const TYPES = ['Dragon', 'Fire', 'Water', 'Electric', 'Grass', 'Dark', 'Steel', 'Psychic', 'Fighting', 'Ice'];
  const st = (window.__arcSlash = { stop: false, fx });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const ua = f.units.get(a);
  await sleep(0.8);
  for (let i = 0; !st.stop; i++) {
    const element = TYPES[i % TYPES.length], dir = i % 2 ? -1 : 1;
    label.textContent = `Arc slash — ${element}`;
    const H = f.heightOf(a);
    const fwd = new V(Math.sin(a.rotation.y), 0, Math.cos(a.rotation.y));
    void ua.model.player.play(ua.model.player.has('swipeEnd') ? 'swipeEnd' : 'attack', { fade: 0.08 }).then(() => ua.model.player.play('idle', { fade: 0.2 }));
    const play = fx.play({ element: f.hueOf(a, element), at: a.position.add(new V(0, H * 0.55, 0)).add(fwd.scale(H * 0.1)), yaw: a.rotation.y, height: H,
      tilt: dir * -0.45, dir });
    await play.hit;
    const th = f.heightOf(b);
    f.beams?.hemiBurst(b.position.add(new V(0, th * 0.55, 0)), fwd.scale(-1), th * 0.35, f.hueOf(a, element), false);
    void f.playHitReact(b);
    await play.done;
    await sleep(0.7);
  }
  label.remove();
})();
