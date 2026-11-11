// Demo: the traced slash (ArcSlashFx.trail) — the slash flowing along the path of the striking part as it swings:
// Garchomp's swipe attack (as battles play it), its striking part (the factory's impactPart) traced through its strike,
// the ribbon's cutting edge through the part and its inner edge toward the body; a stack of three; a burst and a
// flinch on Metagross at the blow. Round and round, through a few types.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/trail-slash.js')).text())
// Stop: window.__trailSlash.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { ArcSlashFx } = await import('/src/client/vfx/ArcSlashFx.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const A = T(-1, 2), Bp = T(1, 2);
  const a = await f.createPokemon(S.getSpecies(window.__trailSpecies ?? 'Garchomp'), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  a.position.copyFrom(A); b.position.copyFrom(Bp); f.faceEachOther(a, b);
  const w = Bp.subtract(A).normalize(), side = new V(w.z, 0, -w.x), c = V.Center(A, Bp).add(new V(0, 1.0, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(6.5)).add(w.scale(-1.5)).add(new V(0, 1.6, 0)));
  const fx = new ArcSlashFx(sc);
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', padding: '8px 14px', background: 'rgba(20,24,40,0.85)',
    color: '#fff', font: '600 16px system-ui', borderRadius: '8px', zIndex: 60 });
  document.body.append(label);
  const TYPES = ['Dragon', 'Fire', 'Water', 'Electric', 'Grass', 'Dark', 'Steel', 'Psychic'];
  const st = (window.__trailSlash = { stop: false, fx });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const ua = f.units.get(a), player = ua.model.player;
  // Its striking part, its bone; when in its swipe the blow falls.
  const part = f.impactPart(a, 'swipe') ?? 'right_hand';
  const bone = ua.model.skeleton.bones.find((x) => x.name === part);
  // Its swipe mirrored (handAttacks.mirrorClip: left and right swapped), and the part that strikes in it — its partner.
  const HA = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const rig = player, windUp = player.clips.get('swipeStart').duration;
  const baked = HA.bakeHandAttack(rig, ['swipeStart', 'swipeEnd'], sampleTrack, { id: 0, species: '', clip: 'swipe', hand: part, height: ua.model.height, hitTime: 0 });
  rig.clips.set('swipeMirror', HA.toClip(HA.mirrorClip(rig, HA.retarget(baked, rig, ua.model.height)), 'swipeMirror', rig.shown));
  const mirrorPart = part.replace(/^(left|right)/, (m) => (m === 'left' ? 'right' : 'left'));
  const mirrorBone = ua.model.skeleton.bones.find((x) => x.name === mirrorPart);
  const SWIPE_HIT = 0.03;
  // (Measured against its skinned mesh, under its handedness flip — against its root, the part would come out mirrored.)
  const skinned = ua.model.meshes.find((m) => m.skeleton) ?? ua.model.meshes[0];
  /** How long its strike is traced, from its start (s): the blow (in its first frames) and its follow-through. */
  const TRACE = 0.3;
  await sleep(0.8);
  for (let i = 0; !st.stop; i++) {
    const element = TYPES[i % TYPES.length];
    const H = f.heightOf(a);
    // Every other swing mirrored: the other way, with its other claw.
    const mirrored = i % 2 === 1, by = mirrored ? mirrorBone : bone;
    label.textContent = `Traced slash — ${element} (along ${mirrored ? mirrorPart : part}${mirrored ? ', mirrored' : ''})`;
    const sample = () => {
      if (!by) return null;
      const p = by.getAbsolutePosition(skinned).clone();
      const centre = a.position.add(new V(0, H * 0.5, 0));
      const out = p.subtract(centre); if (out.lengthSquared() < 1e-6) return null; out.normalize();
      return { tip: p.add(out.scale(H * 0.22)), base: p.subtract(out.scale(H * 0.1)) };
    };
    // Its swipe attack, as battles play it (RecipeFactory.playAttackLunge, swipe): its wind-up, then its strike —
    // traced from the moment its strike begins, for TRACE (its blow and follow-through).
    let play;
    if (!mirrored) {
      const struck = f.playAttackLunge(a, b.position.clone(), true);
      await new Promise((res) => { const o = sc.onBeforeRenderObservable.add(() => { if (player.active?.action === 'swipeEnd') { sc.onBeforeRenderObservable.remove(o); res(); } }); });
      play = fx.trail({ element: f.hueOf(a, element), height: H, sample, trace: TRACE });
      await struck;
    } else {
      // The mirrored swipe, played as the swipe attack is: wind-up and strike in one, its step in and back with it.
      const start = a.position.clone(), dir = b.position.subtract(start); dir.y = 0; dir.normalize();
      const step = (to, secs) => new Promise((res) => { const from = a.position.clone(); let t = 0; const o = sc.onBeforeRenderObservable.add(() => { t = Math.min(1, t + sc.getEngine().getDeltaTime() / 1000 / secs); a.position.copyFrom(V.Lerp(from, to, t * t * (3 - 2 * t))); if (t >= 1) { sc.onBeforeRenderObservable.remove(o); res(); } }); });
      void step(start.add(dir.scale(0.45)), Math.max(0.12, windUp)).then(() => step(start, 0.35));
      void player.play('swipeMirror', { fade: 0.12 }).then(() => player.play('idle', { fade: 0.25 }));
      await sleep(windUp);
      play = fx.trail({ element: f.hueOf(a, element), height: H, sample, trace: TRACE });
      await sleep(SWIPE_HIT);
    }
    await play.hit;
    const th = f.heightOf(b), fwd = new V(Math.sin(a.rotation.y), 0, Math.cos(a.rotation.y));
    f.beams?.hemiBurst(b.position.add(new V(0, th * 0.55, 0)), fwd.scale(-1), th * 0.35, f.hueOf(a, element), false);
    void f.playHitReact(b);
    await play.done;
    await sleep(0.8);
  }
  label.remove();
})();
