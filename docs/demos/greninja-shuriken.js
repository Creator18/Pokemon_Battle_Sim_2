// Demo: regular Greninja throws Mega Greninja's Water Shuriken — it jumps,
// winds up in the air (Mega's upright wind-up, retargeted, slowed) with
// Mega's holed shuriken held in its hand (borrowed: its mesh, scaled to it,
// of vortex water, growing in), spinning up 1 → 8 turns/s; throws it
// straight at its target from where it leaves the hand, still spinning — a
// Water noise burst where it hits, the target flinching; then backflips down
// straight into its battle stance.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/greninja-shuriken.js')).text())
// Stop: window.__gs.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const H = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const { waterSurface } = await import('/src/client/vfx/WaterCoat.ts');
  const { auraGlow } = await import('/src/client/vfx/auraPalette.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  /** Mega's clip: its wind-up's start and its release (frames), the throw's follow-through after it, how slow the wind-up, the fps. */
  const FROM = 16, RELEASE = 40, FOLLOW = 12, SLOW = 0.35, FPS = 60;
  /** The jump: how high (× its height), and how long it takes to get there (s). */
  const JUMP = 0.9, RISE = 0.35;
  /** The backflip down: how long (s). */
  const FLIP = 0.7;
  /** The shuriken: spin (turns/s) through the wind-up, how long it takes to grow in (s), and how long it flies to its target (s). */
  const W0 = 1, W1 = 8, GROW = 0.25, FLY = 0.25;
  /** Where it strikes: its target's middle (× its height up it), short of it by this much (× its height: its face), and the noise burst there (× its height). */
  const AIM_UP = 0.45, AIM_FACE = 0.3, BURST = 0.6;
  /** A hair of hover while it is off the ground (m): enough to let the ground clamp be. */
  const AIR = 0.02;

  const A = P.board.standPoint(-1, 2).clone(), B = P.board.standPoint(1, 2).clone(); const V = A.constructor;
  const g = await f.createPokemon(S.getSpecies('Greninja'), 1), target = await f.createPokemon(S.getSpecies('Metagross'), 2);
  const mega = await f.createPokemon(S.getSpecies('Mega Greninja'), 1);
  g.position.copyFrom(A); target.position.copyFrom(B); f.faceEachOther(g, target);
  mega.setEnabled(false);
  const ug = f.units.get(g), um = f.units.get(mega), gr = ug.model.player, mr = um.model.player;
  const k = ug.model.height / um.model.height;

  // 1. The body: Mega's wind-up (slowed) and its throw, on Greninja (by each bone's turn in the world).
  const baked = H.bakeHandAttack(mr, ['ranged'], sampleTrack, { id: 0, species: 'Mega Greninja', clip: 'attack', hand: 'feeler_a_01', height: um.model.height, hitTime: 0 });
  const onM = H.retarget(baked, mr, um.model.height);
  const onG = H.retargetWorld(mr, onM, gr);
  gr.clips.set('gsWindUp', H.toClip(H.chainClips([{ clip: onG, from: FROM, to: RELEASE - 1, speed: SLOW }], 1, 0), 'gsWindUp', gr.shown));
  // (Its follow-through brought round to face ahead by its end: the backflip after it is a backflip, no twist in it.)
  gr.clips.set('gsThrow', H.toClip(H.faceAheadByEnd(gr, H.chainClips([{ clip: onG, from: RELEASE, to: RELEASE + FOLLOW, speed: 1 }], 1, 0)), 'gsThrow', gr.shown));
  const windSecs = (RELEASE - FROM) / SLOW / FPS, throwSecs = FOLLOW / FPS;

  // 2. The shuriken in the hand: Mega's, at its release, from its right hand.
  const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const star = H.poseOf(mr, onM, 'feeler_a_01'), handM = H.poseOf(mr, onM, 'right_hand');
  const restHM = H.restOf(mr, 'right_hand').rot, restHG = H.restOf(gr, 'right_hand').rot;
  // Held: its place from the hand at the release, the hand's turn from rest taken off, in Greninja's hand's rest frame.
  const held = (() => {
    const i = RELEASE - 1, D = qmul(handM[i].rot, qinv(restHM));
    const pos = qrot(qinv(D), sub(star[i].pos, handM[i].pos)).map((x) => x * k), rot = qmul(qinv(D), star[i].rot);
    return { pos: qrot(qinv(restHG), pos), rot: qmul(qinv(restHG), rot) };
  })();
  const ease = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

  // 3. The shuriken itself: Mega's holed one, its points in its bone's own frame (no skin), of vortex water.
  const src = mr.shown.find((s) => /anashuriken/.test(s.name)).mesh;
  const shuriken = src.clone('borrowedShuriken', null);
  shuriken.parent = null; // (not under Mega's model: it is hidden, and all of it with it)
  shuriken.makeGeometryUnique();
  const restStar = H.restOf(mr, 'feeler_a_01');
  const pos = src.getVerticesData('position'), nrm = src.getVerticesData('normal'), lp = new Float32Array(pos.length), ln = new Float32Array(nrm.length);
  for (let i = 0; i < pos.length; i += 3) {
    lp.set(H.toBoneFrame(restStar, [pos[i], pos[i + 1], pos[i + 2]]), i);
    ln.set(qrot(qinv(restStar.rot), [nrm[i], nrm[i + 1], nrm[i + 2]]), i);
  }
  shuriken.skeleton = null;
  shuriken.removeVerticesData('matricesIndices'); shuriken.removeVerticesData('matricesWeights');
  shuriken.setVerticesData('position', lp); shuriken.setVerticesData('normal', ln);
  shuriken.refreshBoundingInfo();
  const disc = (() => {
    const c = [0, 0, 0], a = [0, 0, 0], f0 = [ln[0], ln[1], ln[2]];
    for (let i = 0; i < lp.length; i += 3) { c[0] += lp[i]; c[1] += lp[i + 1]; c[2] += lp[i + 2]; const s = ln[i] * f0[0] + ln[i + 1] * f0[1] + ln[i + 2] * f0[2] < 0 ? -1 : 1; a[0] += ln[i] * s; a[1] += ln[i + 1] * s; a[2] += ln[i + 2] * s; }
    const k3 = 3 / lp.length, l = Math.hypot(...a) || 1;
    return { centre: c.map((x) => x * k3), axis: a.map((x) => x / l) };
  })();
  shuriken.material = waterSurface(sc, um.model.height, auraGlow('Water')[1], true, disc);
  shuriken.alwaysSelectAsActiveMesh = true;
  shuriken.setEnabled(false);

  const Mat = g.getWorldMatrix().constructor;
  const sk = ug.model.skeleton, hand = sk.bones.find((b) => b.name === 'right_hand'), conv = g.getChildren()[0];
  const Quat = hand.getRotationQuaternion().constructor;
  const one = new V(1, 1, 1);
  const spinM = (ang) => Mat.Compose(one, new Quat(Math.sin(ang / 2) * disc.axis[0], Math.sin(ang / 2) * disc.axis[1], Math.sin(ang / 2) * disc.axis[2], Math.cos(ang / 2)), V.Zero());

  // The throw, step by step (its own clock): rise and wind up, throw, backflip down, land.
  const st = (window.__gs = { stop: false, g, mega, shuriken, phase: 'idle' });
  const yaw0 = () => g.rotation.y;
  const run = () => new Promise((done) => {
    const t0 = performance.now(), ground = A.y, top = ground + JUMP * ug.model.height * g.scaling.y;
    const centre = 0.5 * ug.model.height * g.scaling.y;
    let ang = 0, last = 0, release = null, phase = '';
    // (Off the ground: the ground clamp let be — as for a flier, a hair of hover — till it lands.)
    ug.clamp = 0; ug.hover = ug.hoverTarget = AIR;
    const obs = sc.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000, dt = t - last; last = t;
      // Its spin: up through the wind-up (eased), full once thrown.
      ang += (t < windSecs ? W0 + (W1 - W0) * ease(t / windSecs) : W1) * 2 * Math.PI * dt;
      sk.computeAbsoluteTransforms();
      if (t < windSecs) {
        if (phase !== 'wind') { phase = st.phase = 'wind'; void gr.play('gsWindUp', { fade: 0.15 }); }
        // Up: a jump, quick off the ground, easing to the top.
        g.position.y = ground + (top - ground) * (1 - Math.pow(1 - Math.min(1, t / RISE), 3));
        // In the hand, growing in.
        const grow = ease(t / GROW);
        const holdM = Mat.Compose(new V(k * grow, k * grow, k * grow), new Quat(...held.rot), new V(...held.pos));
        shuriken.freezeWorldMatrix(spinM(ang).multiply(holdM).multiply(hand.getAbsoluteTransform()).multiply(conv.getWorldMatrix()));
        shuriken.visibility = 1; shuriken.setEnabled(true);
      } else if (t < windSecs + FLIP + throwSecs) {
        if (phase !== 'throw' && t < windSecs + throwSecs) { phase = st.phase = 'throw'; void gr.play('gsThrow', { fade: 0.05 }); }
        // Let go: from where it left the hand, straight at its target (to the face of it), turned as it left.
        if (!release) {
          const holdM = Mat.Compose(new V(k, k, k), new Quat(...held.rot), new V(...held.pos));
          const m = holdM.multiply(hand.getAbsoluteTransform()).multiply(conv.getWorldMatrix());
          const scl = new V(), rot = new Quat(), from = new V();
          m.decompose(scl, rot, from);
          const th = f.heightOf(target), middle = target.position.add(new V(0, th * AIM_UP, 0));
          const way = middle.subtract(from).normalize();
          release = { scl, rot, from, to: middle.subtract(way.scale(th * AIM_FACE)), way, t, hit: false };
        }
        const u = (t - release.t) / FLY;
        if (u < 1) {
          const at = V.Lerp(release.from, release.to, u);
          shuriken.freezeWorldMatrix(spinM(ang).multiply(Mat.Compose(release.scl, release.rot, at)));
          shuriken.visibility = 1;
        } else if (!release.hit) {
          // It strikes: gone in a Water noise burst on the face of its target, its dome back the way it came; the target flinches.
          release.hit = true;
          shuriken.setEnabled(false);
          f.beams?.hemiBurst(release.to, release.way.scale(-1), f.heightOf(target) * BURST, f.hueOf(g, 'Water'), false);
          void f.playHitReact(target);
        }
        // A backflip down (after the throw's follow-through): a full turn back over, about its middle, falling.
        if (t >= windSecs + throwSecs) {
          // (Into its battle stance as it turns over: it lands already in it.)
          if (phase !== 'flip') { phase = st.phase = 'flip'; void gr.play('idle', { fade: FLIP * 0.6 }); }
          const u = ease((t - windSecs - throwSecs) / FLIP);
          const pitch = -2 * Math.PI * u; // (back: its head goes away from the way it faces)
          const y = top + (ground - top) * u * u;
          g.rotation.x = pitch;
          // About its middle: its root moved so its middle stays where it falls.
          const R = Mat.RotationYawPitchRoll(yaw0(), pitch, 0), up = V.TransformNormal(new V(0, centre, 0), R);
          g.position.set(A.x, y + centre - up.y, A.z);
          g.position.x += -up.x; g.position.z += -up.z;
        }
      } else {
        sc.onBeforeRenderObservable.remove(obs);
        g.rotation.x = 0; g.position.copyFrom(A); ug.hover = ug.hoverTarget = 0;
        shuriken.setEnabled(false);
        st.phase = 'land';
        done();
      }
    });
  });

  // (Both in view: the thrower and its target.)
  const w = B.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, B).add(new V(0, 1.4, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(-9.5)).add(new V(0, 1.6, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(40,40,90,0.92)', color: '#fff', font: '600 15px system-ui', borderRadius: '6px', zIndex: 60, whiteSpace: 'pre' });
  label.textContent = `Greninja — Mega Greninja's Water Shuriken\njump, wind-up ×${SLOW} (spin ${W0} → ${W1} turns/s), throw, backflip`;
  document.body.append(label);
  await new Promise((r) => setTimeout(r, 800));
  while (!st.stop) {
    await run();
    await new Promise((r) => setTimeout(r, 1200));
  }
})();
