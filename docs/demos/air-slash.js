// Demo: Air Slash (Talonflame at Metagross) — a thrown C (ArcSlashFx.throwArc): Talonflame, in the air, beats its
// wing in its air ranged attack (or its appeal, where that hardly flaps) and, its wind-up done, throws six crescents back to back at Metagross,
// each its blade leading, its hollow toward Talonflame, its flames coming out of its hollow as a trail, faded in as it
// sets off, leaning in turn — its Flying aura (its tornado coat) lit for it; each lands: a burst and a flinch. Round and round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/air-slash.js')).text())
// Stop: window.__airSlash.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { ArcSlashFx } = await import('/src/client/vfx/ArcSlashFx.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-1, 2), Bp = T(1, 2);
  const who = window.__airSpecies ?? 'Talonflame'; // (window.__airSpecies = 'Charizard': another thrower)
  const a = await f.createPokemon(S.getSpecies(who), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, Bp).add(new V(0, 1.2, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(9)).add(w.scale(-0.5)).add(new V(0, 2.2, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  document.body.append(label);
  const st = (window.__airSlash = { stop: false });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const fx = (f.arcSlash ??= new ArcSlashFx(sc));
  const ua = f.units.get(a), player = ua.model.player;
  const skinned = ua.model.meshes.find((m) => m.skeleton) ?? ua.model.meshes[0];
  const bone = (n) => ua.model.skeleton.bones.find((x) => x.name === n);
  // Up into the air.
  await sleep(0.6);
  await f.fly(a, true);
  await sleep(0.6);
  const H = f.heightOf(a);
  // Its body's middle: between its shoulders (in the air, its body is lifted off where it stands).
  const middle = () => V.Center(bone('left_shoulder').getAbsolutePosition(skinned), bone('right_shoulder').getAbsolutePosition(skinned));
  const sampler = (tipBone) => () => {
    const p = tipBone.getAbsolutePosition(skinned).clone(), out = p.subtract(middle());
    if (out.lengthSquared() < 1e-6) return null;
    out.normalize();
    return { tip: p.add(out.scale(H * 0.22)), base: p.subtract(out.scale(H * 0.2)) };
  };
  /** How many it throws, how soon after each other (s), and how fast they fly. */
  const VOLLEY = 6, EVERY = 0.13, SPEED = 13;
  // Its throwing pose: its (air) ranged attack — or, where that hardly beats its wings through the volley (under
  // FLAP_MIN: how far its wing bones turn per second, each, on average, from its clip), its (air) appeal — if that
  // flaps more through it.
  const HA = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const bakeOf = (name) => HA.bakeHandAttack(player, [name], sampleTrack, { id: 0, species: '', clip: 'attack', hand: '', height: ua.model.height, hitTime: 0 });
  const turnAt = (bn, k) => 2 * Math.acos(Math.min(1, Math.abs(bn.rot[k * 4] * bn.rot[k * 4 - 4] + bn.rot[k * 4 + 1] * bn.rot[k * 4 - 3] + bn.rot[k * 4 + 2] * bn.rot[k * 4 - 2] + bn.rot[k * 4 + 3] * bn.rot[k * 4 - 1])));
  // Its wind-up's end, its launch: the peak of its wings' and body's motion (over RELEASE_SMOOTH s) in its first
  // RELEASE_WITHIN of it, past its first RELEASE_AFTER s — the burst its wind-up ends in. The volley starts there.
  const RELEASE_AFTER = 0.2, RELEASE_WITHIN = 0.6, RELEASE_SMOOTH = 0.1;
  const releaseOf = (name) => {
    const baked = player.has(name) && bakeOf(name);
    if (!baked) return 0.25;
    const sp = [0];
    for (let k = 1; k < baked.frames; k++) {
      let s2 = 0;
      for (const bn of baked.bones) if ((/wing/i.test(bn.name) && !/sub|roll/i.test(bn.name)) || /^(head|neck_01|spine_02|waist)$/.test(bn.name)) s2 += turnAt(bn, k);
      sp.push(s2);
    }
    const win = Math.max(1, Math.round(RELEASE_SMOOTH * baked.fps));
    let best = -1, at = Math.round(0.25 * baked.fps);
    for (let k = Math.round(RELEASE_AFTER * baked.fps); k < baked.frames * RELEASE_WITHIN; k++) {
      let s2 = 0;
      for (let j = Math.max(0, k - win); j <= Math.min(sp.length - 1, k + win); j++) s2 += sp[j];
      if (s2 > best) { best = s2; at = k; }
    }
    return at / baked.fps;
  };
  const flapOf = (name, t0, t1) => {
    if (!player.has(name)) return -1;
    const baked = bakeOf(name);
    if (!baked) return 0;
    const k0 = Math.round(t0 * baked.fps), k1 = Math.min(baked.frames - 1, Math.round(t1 * baked.fps));
    let turn = 0, count = 0;
    for (const bn of baked.bones) {
      if (!/wing/i.test(bn.name) || /sub|roll/i.test(bn.name)) continue;
      count++;
      for (let k = k0 + 1; k <= k1; k++) {
        const d = Math.abs(bn.rot[k * 4] * bn.rot[k * 4 - 4] + bn.rot[k * 4 + 1] * bn.rot[k * 4 - 3] + bn.rot[k * 4 + 2] * bn.rot[k * 4 - 2] + bn.rot[k * 4 + 3] * bn.rot[k * 4 - 1]);
        turn += 2 * Math.acos(Math.min(1, d));
      }
    }
    return count && k1 > k0 ? turn / count / ((k1 - k0) / baked.fps) : 0;
  };
  const FLAP_MIN = 3;
  const ranged = player.has('airRanged') ? 'airRanged' : 'ranged', appeal = player.has('airAppeal') ? 'airAppeal' : 'appeal';
  const relR = releaseOf(ranged), relA = releaseOf(appeal);
  const flapR = flapOf(ranged, relR, relR + VOLLEY * EVERY), flapA = flapOf(appeal, relA, relA + VOLLEY * EVERY);
  const clip = flapR < FLAP_MIN && flapA > flapR ? appeal : ranged, THROW_AT = clip === ranged ? relR : relA;
  st.flap = { [ranged]: +flapR.toFixed(2), [appeal]: +flapA.toFixed(2), using: clip, release: +THROW_AT.toFixed(2) };
  for (let i = 0; !st.stop; i++) {
    label.textContent = `${who} — Air Slash (${VOLLEY} slashes, ${clip})`;
    f.faceEachOther(a, b);
    // Its pose: its wind-up, then the volley from its launch on (held at its end if the volley outlasts it).
    void player.play(clip, { fade: 0.1 });
    // Its Flying aura (its tornado coat, as every whole-body Flying aura): lit through its wind-up, up as it launches,
    // gone once its volley is away.
    const aura = f.aura(a, { element: 'Flying', edge: 'smooth', reach: 'tight', ignite: Math.min(0.4, THROW_AT), die: 0.5 });
    const th = f.heightOf(b), mark = b.position.add(new V(0, th * 0.55, 0));
    await sleep(THROW_AT);  // (its wind-up: no slash till it is done)
    // Back to back: each a C, its blade at Metagross, its flames trailing back from its hollow, leaning in turn.
    const plays = [];
    for (let k = 0; k < VOLLEY && !st.stop; k++) {
      const play = fx.throwArc({ element: f.hueOf(a, 'Flying'), height: H, from: middle(), to: mark, speed: SPEED, appear: 0.08,
        lean: (k % 2 ? -1 : 1) * (0.25 + 0.1 * Math.random()) });
      void play.hit.then(() => { f.beams?.hemiBurst(mark, w.scale(-1), th * 0.3, f.hueOf(a, 'Flying'), false); void f.playHitReact(b); });
      plays.push(play.done);
      await sleep(EVERY);
    }
    void player.play('airIdle', { fade: 0.25 });
    void aura.release();
    await Promise.all(plays);
    await sleep(1.0);
  }
  label.remove();
})();
