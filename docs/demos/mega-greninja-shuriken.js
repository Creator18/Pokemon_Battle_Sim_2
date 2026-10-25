// Demo: Mega Greninja's Water Shuriken — its own ranged clip, its wind-up
// slowed, its holed shuriken (its own, of vortex water) spun up 1 → 8 turns/s
// through it, thrown (its own boomerang flight), caught and spun down.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/mega-greninja-shuriken.js')).text())
// Stop: window.__mgs.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const H = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  /** Its wind-up (frames), how slow, the fps; its spin (turns/s) up through it; when it is caught (frames: spun down between); when the solid shuriken is back. */
  const WIND = [16, 40], SLOW = 0.35, FPS = 60, W0 = 1, W1 = 8, CATCH = [100, 120], BACK = 82;

  const A = P.board.standPoint(-1, 2).clone(), B = P.board.standPoint(1, 2).clone(); const V = A.constructor;
  const a = await f.createPokemon(S.getSpecies('Mega Greninja'), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  a.position.copyFrom(A); b.position.copyFrom(B); f.faceEachOther(a, b);
  const u = f.units.get(a), rig = u.model.player;

  const baked = H.bakeHandAttack(rig, ['ranged'], sampleTrack, { id: 0, species: 'Mega Greninja', clip: 'attack', hand: 'feeler_a_01', height: u.model.height, hitTime: 0 });
  const own = H.retarget(baked, rig, u.model.height), last = baked.frames - 1;
  const stretched = H.chainClips([{ clip: own, from: 0, to: WIND[0] - 1, speed: 1 }, { clip: own, from: WIND[0], to: WIND[1] - 1, speed: SLOW }, { clip: own, from: WIND[1], to: last, speed: 1 }], 1, 0);
  const windStart = WIND[0], windEnd = WIND[0] + Math.floor((WIND[1] - 1 - WIND[0]) / SLOW) + 1;
  const oldOf = (n) => (n < windStart ? n : n < windEnd ? WIND[0] + (n - windStart) * SLOW : WIND[1] + (n - windEnd));
  const ease = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  // Its spin, in real seconds: up through the wind-up, full in flight, down once caught.
  const angles = [];
  { let ang = 0; for (let n = 0; n < stretched.frames; n++) {
    const old = oldOf(n);
    const rev = n < windStart ? 0 : n < windEnd ? W0 + (W1 - W0) * ease((n - windStart) / (windEnd - windStart))
      : old < CATCH[0] ? W1 : W1 * (1 - ease((old - CATCH[0]) / (CATCH[1] - CATCH[0])));
    ang += (rev * 2 * Math.PI) / FPS; angles.push(n >= windStart ? ang : 0);
  } }
  const spun = H.spinBone(rig, stretched, 'feeler_a_01', [0, 0, 0], [1, 0, 0], angles);
  // Its shapes as its own clip has them, on the new timeline — the holed shuriken from its wind-up through its flight, the solid one back once caught.
  const orig = rig.clips.get('ranged'), names = rig.shown.map((s) => s.name);
  const iSolid = names.findIndex((n) => /_shuriken_mesh/.test(n) && !/ana|mini/.test(n)), iHole = names.findIndex((n) => /anashuriken/.test(n));
  const vis = names.map((_, i) => { const v = orig.vis && orig.vis[i]; if (!v) return null; const out = new Uint8Array(stretched.frames); for (let n = 0; n < out.length; n++) out[n] = v[Math.min(v.length - 1, Math.round(oldOf(n)))]; return out; });
  for (let n = 0; n < stretched.frames; n++) { const old = oldOf(n), holed = old >= 12 && old < BACK; vis[iHole][n] = holed ? 1 : 0; vis[iSolid][n] = holed ? 0 : 1; }
  rig.clips.set('megaShuriken', H.toClip(spun, 'megaShuriken', rig.shown, vis));

  const w = B.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, B).add(new V(0, 1.4, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(-9.5)).add(new V(0, 1.6, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(40,40,90,0.92)', color: '#fff', font: '600 15px system-ui', borderRadius: '6px', zIndex: 60, whiteSpace: 'pre' });
  label.textContent = `Mega Greninja — Water Shuriken\nwind-up ×${SLOW}, spin ${W0} → ${W1} turns/s, vortex water`;
  document.body.append(label);
  const st = (window.__mgs = { stop: false, a });
  await new Promise((r) => setTimeout(r, 800));
  while (!st.stop) {
    await rig.play('megaShuriken', { fade: 0.15 });
    void rig.play('idle', { fade: 0.25 });
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
