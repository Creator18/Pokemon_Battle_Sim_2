// Demo: two traced slashes in quick succession, the second mirrored — Garchomp's swipe (its right claw), and straight
// out of its blow the mirrored strike (its left claw, no second wind-up), each slash flowing along the claw that
// throws it — each going on along its arm as it pulls back, gone as the arm comes to rest — afterimages of the body
// left along each swing; a burst and a flinch on Metagross at each blow.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/trail-combo.js')).text())
// Stop: window.__trailCombo.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { ArcSlashFx } = await import('/src/client/vfx/ArcSlashFx.ts');
  const HA = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
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
  const st = (window.__trailCombo = { stop: false });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const ua = f.units.get(a), player = ua.model.player, rig = player;
  // Its striking claw and its partner; measured against its skinned mesh (under its handedness flip).
  const part = f.impactPart(a, 'swipe') ?? 'right_hand';
  const partner = part.replace(/^(left|right)/, (m) => (m === 'left' ? 'right' : 'left'));
  const boneOf = (n) => ua.model.skeleton.bones.find((x) => x.name === n);
  const skinned = ua.model.meshes.find((m) => m.skeleton) ?? ua.model.meshes[0];
  // The mirrored strike alone (its swipe's strike, left and right swapped): the second slash, with no wind-up of its own.
  const baked = HA.bakeHandAttack(rig, ['swipeEnd'], sampleTrack, { id: 0, species: '', clip: 'swipe', hand: part, height: ua.model.height, hitTime: 0 });
  rig.clips.set('swipeMirrorStrike', HA.toClip(HA.mirrorClip(rig, HA.retarget(baked, rig, ua.model.height)), 'swipeMirrorStrike', rig.shown));
  /** How long each strike is traced at most (s: each ends as its arm comes to rest), afterimages through its swing (s), how soon after the first blow the second strike comes, how often an afterimage is left. */
  const TRACE_MAX = 0.7, TRACE = 0.3, NEXT = 0.15, GHOST_EVERY = 0.06, SWIPE_HIT = 0.03, STRIKE_SPEED = 1.25;
  const H = f.heightOf(a);
  const sampler = (bone) => () => {
    if (!bone) return null;
    const p = bone.getAbsolutePosition(skinned).clone();
    const centre = a.position.add(new V(0, H * 0.5, 0));
    const out = p.subtract(centre); if (out.lengthSquared() < 1e-6) return null; out.normalize();
    return { tip: p.add(out.scale(H * 0.22)), base: p.subtract(out.scale(H * 0.1)) };
  };
  // Afterimages of the body along a swing: one every GHOST_EVERY for `secs`.
  const ghosts = (secs) => { for (let t = 0; t < secs; t += GHOST_EVERY) setTimeout(() => f.afterimage(a, 0.6), t * 1000); };
  const blow = (element) => {
    const th = f.heightOf(b), fwd = new V(Math.sin(a.rotation.y), 0, Math.cos(a.rotation.y));
    f.beams?.hemiBurst(b.position.add(new V(0, th * 0.55, 0)), fwd.scale(-1), th * 0.35, f.hueOf(a, element), false);
    void f.playHitReact(b);
  };
  await sleep(0.8);
  for (let i = 0; !st.stop; i++) {
    const element = TYPES[i % TYPES.length], hue = f.hueOf(a, element);
    label.textContent = `Two slashes — ${element} (${part}, then ${partner} mirrored)`;
    // The first: its swipe attack, as battles play it; traced from its strike's start.
    const struck = f.playAttackLunge(a, b.position.clone(), true);
    await new Promise((res) => { const o = sc.onBeforeRenderObservable.add(() => { if (player.active?.action === 'swipeEnd') { sc.onBeforeRenderObservable.remove(o); res(); } }); });
    const first = fx.trail({ element: hue, height: H, sample: sampler(boneOf(part)), trace: TRACE_MAX });
    ghosts(TRACE);
    await struck;
    blow(element);
    // The second, straight out of the first's blow: the mirrored strike, quicker, its partner claw traced.
    await sleep(NEXT);
    // (Its first arm's slash goes on along that arm as it pulls back, making way for the other: it ends as the arm comes to rest.)
    void player.play('swipeMirrorStrike', { fade: 0.06, speed: STRIKE_SPEED }).then(() => { if (player.active?.action === 'swipeMirrorStrike') void player.play('idle', { fade: 0.25 }); });
    const second = fx.trail({ element: hue, height: H, sample: sampler(boneOf(partner)), trace: TRACE_MAX / STRIKE_SPEED });
    ghosts(TRACE / STRIKE_SPEED);
    await sleep(SWIPE_HIT + 0.1 / STRIKE_SPEED);
    blow(element);
    await Promise.all([first.done, second.done]);
    await sleep(0.9);
  }
  label.remove();
})();
