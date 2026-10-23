// Demo: a flurry for any species — its own two physical clips (attack, swipe)
// cut to their strikes, each strike redirected a random way by the part that
// leads it (throwForward: aimed, reached out), left and right in turn (the
// other side its mirror), run fast one into the next, kept on the spot, an
// afterimage at each blow. A new flurry each time round.
// Run in the page: window.__flurrySpecies = 'Garchomp'; (0, eval)(await (await fetch('/docs/demos/flurry.js')).text())
// In the air (its air clips, hovering): window.__flurryFly = true first.
// Stop: window.__flurry.stop = true
(async () => {
  window.__built = true;
  const SPECIES = window.__flurrySpecies || 'Garchomp';
  /** In the air: how high it hovers (m), else on the ground. */
  const HOVER = window.__flurryFly ? 1.6 : 0;
  const S = await import('/src/shared/index.ts');
  const H = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  /** How many hits, how long each runs into the next (s), and its afterimages' opacity. */
  const HITS = 6, BLEND = 0.05, GHOST_ALPHA = 0.75;
  /** Each strike: from this many frames before its window, to this many after its blow. */
  const LEAD = 6, FOLLOW = 16, RUN_IN = 18;
  /**
   * By what leads it: how fast (× its own), how far it is reached out (its
   * elbow, knee or neck opened: 0..1), and its aims (round either way; up and
   * down from its shoulder, hip or neck).
   */
  const BY = {
    hand: { speed: 2.2, extend: 1, yaw: 40, pitch: [-30, 35] },
    foot: { speed: 1.8, extend: 1, yaw: 35, pitch: [-35, 20] },
    head: { speed: 2.0, extend: 0.5, yaw: 25, pitch: [-25, 15] },
  };
  /** What can lead a strike. */
  const PARTS = ['left_hand', 'right_hand', 'left_foot', 'right_foot', 'head'];
  const byOf = (part) => (/hand/.test(part) ? 'hand' : /foot/.test(part) ? 'foot' : 'head');
  /**
   * A foot leads one only when kicked: raised this much (× its height)
   * towards its hips from where it hangs at rest — not a lunge's stride, nor
   * a pounce (the whole body up, the feet with it).
   */
  const KICK_LIFT = 0.12;

  const a = await f.createPokemon(S.getSpecies(SPECIES), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  const A = T(-1, 2), B = T(1, 2); a.position.copyFrom(A); b.position.copyFrom(B); f.faceEachOther(a, b);
  if (HOVER) { f.setHover(a, HOVER); await new Promise((r) => setTimeout(r, 1500)); }
  const u = f.units.get(a), rig = u.model.player, names = rig.bones.map((x) => x.name);
  // (Its clips as it is now: its air ones, flying.)
  const act = (x) => f.act(u, x);
  const hipsName = ['hips', 'waist', 'spine_01'].find((x) => names.includes(x));
  // The way it faces (its rig's space): level, along a foot to its toes at rest.
  const atRest = { fps: 60, frames: 1, poses: [rig.rest], driven: new Set() };
  const toeOf = (side) => names.find((x, i) => rig.parentIndex[i] === names.indexOf(`${side}_foot`) && /foot_(middle|index|toe)/.test(x));
  const ft = H.pathOf(rig, atRest, 'left_foot')[0], toe = toeOf('left') ? H.pathOf(rig, atRest, toeOf('left'))[0] : [ft[0], ft[1], ft[2] + 1];
  let fwd = [toe[0] - ft[0], 0, toe[2] - ft[2]]; const fl = Math.hypot(fwd[0], fwd[2]) || 1; fwd = [fwd[0] / fl, 0, fwd[2] / fl];

  // Its strikes: each of its two physical clips, what leads it (the part
  // that drives furthest out ahead of its hips round the blow), its window
  // (while that part is out ahead), its blow (where it is furthest out).
  const strikes = [];
  for (const [key, actions] of [['attack', ['attack']], ['swipe', ['swipeStart', 'swipeEnd']]]) {
    const cl = f.strikeClip(u, key);
    if (!cl) continue;
    const baked = H.bakeHandAttack(rig, actions.map(act), sampleTrack, { id: 0, species: SPECIES, clip: key, hand: 'head', height: u.model.height, hitTime: cl.hit });
    if (!baked) continue;
    // (Its body never spun right round: a spin is eased to a sway.)
    const own = H.steadyHeading(rig, H.retarget(baked, rig, u.model.height));
    // Kept on the spot: what carries the body (its waist, its hips) keeps its height's bob, not its travel.
    for (const i of own.driven) {
      if (names[i] === 'origin' || !/^(waist|hips|spine_01|root)$/.test(names[i])) continue;
      const o = i * 10;
      for (const Pz of own.poses) { Pz[o] = rig.rest[o]; Pz[o + 2] = rig.rest[o + 2]; }
    }
    const hips = H.pathOf(rig, own, hipsName);
    const ahead = (part) => H.pathOf(rig, own, part).map((p, i) => (p[0] - hips[i][0]) * fwd[0] + (p[2] - hips[i][2]) * fwd[2]);
    const restHips = H.pathOf(rig, atRest, hipsName)[0][1];
    const lift = (part) => { const y0 = H.pathOf(rig, atRest, part)[0][1] - restHips; return H.pathOf(rig, own, part).map((p, i) => p[1] - hips[i][1] - y0); };
    // Each part's furthest out round the blow (a foot only while kicked).
    const furthest = (part) => {
      const d = ahead(part), base = d[0], up = /foot/.test(part) ? lift(part) : null;
      let at = null;
      for (let fr = Math.max(0, baked.hit - 10); fr < Math.min(baked.frames, baked.hit + 30); fr++) {
        if (up && up[fr] < KICK_LIFT * u.model.height) continue;
        if (!at || d[fr] - base > at.out) at = { part, out: d[fr] - base, peak: fr };
      }
      return at;
    };
    // What the game's own measure says leads it (impactPart), where it can
    // (not a foot that is never kicked: a lunge's stride); else whichever
    // drives furthest out ahead.
    const told = f.impactPart(a, key);
    let best = told && PARTS.includes(told) && names.includes(told) ? furthest(told) : null;
    if (!best) for (const part of PARTS.filter((x) => names.includes(x))) {
      const at = furthest(part);
      if (at && (!best || at.out > best.out)) best = at;
    }
    if (!best) continue;
    const t = H.throwForward(rig, own, best.part, best.peak);
    // (Its run-in no longer than RUN_IN before its blow: not a whole crouch.)
    const from = Math.max(0, Math.max(Math.min(t.from, best.peak), best.peak - RUN_IN) - LEAD), to = Math.min(baked.frames - 1, best.peak + FOLLOW);
    strikes.push({ key, part: best.part, own, peak: best.peak, from, to, by: byOf(best.part) });
  }
  window.__flurry = { stop: false, strikes: strikes.map((s) => `${s.key}: led by ${s.part}, blow at ${s.peak}, frames ${s.from}–${s.to}`) };

  const w = B.subtract(A).normalize(), side = new V(w.z, 0, -w.x);
  const c = A.add(w.scale(0.4)).add(new V(0, 0.95 + HOVER, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(-4.2)).add(w.scale(3.6)).add(new V(0, 0.6, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(40,40,90,0.92)', color: '#fff', font: '600 15px system-ui', borderRadius: '6px', zIndex: 60, whiteSpace: 'pre' });
  document.body.append(label);

  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const st = window.__flurry;
  for (let round = 1; !st.stop && strikes.length; round++) {
    const hits = [], parts = [];
    for (let i = 0; i < HITS; i++) {
      const s = strikes[Math.floor(Math.random() * strikes.length)], k = BY[s.by];
      const aim = { yaw: rnd(-k.yaw, k.yaw), pitch: rnd(k.pitch[0], k.pitch[1]) };
      const aimed = H.throwForward(rig, s.own, s.part, s.peak, k.extend, aim).clip;
      // (Left and right in turn: a strike on the other side than its turn is mirrored.)
      // (A head has no side: its turn's side is the body's lean, mirrored or not.)
      const sideOf = (p) => (p.startsWith('left') ? 'L' : p.startsWith('right') ? 'R' : 'L');
      const want = i % 2 === 0 ? 'L' : 'R', mirrored = sideOf(s.part) !== want;
      parts.push({ clip: mirrored ? H.mirrorClip(rig, aimed) : aimed, from: s.from, to: s.to, speed: k.speed });
      const shownSide = want;
      hits.push({ text: `${shownSide} ${s.key} (${s.by})  ${aim.yaw >= 0 ? '+' : ''}${aim.yaw.toFixed(0)}° round, ${aim.pitch >= 0 ? '+' : ''}${aim.pitch.toFixed(0)}° up`, frames: Math.floor((s.to - s.from) / k.speed) + 1, peak: (s.peak - s.from) / k.speed });
    }
    const combo = H.chainClips(parts, 1, BLEND);
    rig.clips.set('flurry', H.toClip(combo, 'flurry', rig.shown));
    label.textContent = `${SPECIES}${HOVER ? ' (flying)' : ''} — flurry #${round}\n${hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n')}`;
    const fps = combo.fps, overlap = Math.round(BLEND * fps);
    let at = 0;
    const beats = hits.map((h) => { const start = at; at += h.frames - overlap; return (start + h.peak) / fps; });
    const t0 = performance.now();
    let ghosted = 0;
    const obs = sc.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000;
      while (ghosted < beats.length && t >= beats[ghosted]) { f.afterimage(a, GHOST_ALPHA); ghosted++; }
    });
    await rig.play('flurry', { fade: 0.12 });
    sc.onBeforeRenderObservable.remove(obs);
    void rig.play(act('idle'), { fade: 0.2 });
    await new Promise((r) => setTimeout(r, 700));
  }
  label.remove();
})();
