// Demo: every species' hand attack (an attack or swipe a hand leads), catalogued
// as Hand Attack 1, 2, …, retargeted onto one species (Blaziken) and kept clear
// of itself, then played in turn with a label.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/hand-attacks.js')).text())
// Progress: window.__hand.scan; jump to one: window.__hand.play(n); stop: window.__hand.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const H = await import('/src/client/render/handAttacks.ts');
  const { bodyShape } = await import('/src/client/render/bodyShape.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  const HANDS = ['left_hand', 'right_hand'];
  const hand = (window.__hand = { scan: { done: 0, total: 0 }, catalogue: [], stop: false });

  // 1. The one they are laid on (Blaziken), its body as capsules, a label.
  const who = await f.createPokemon(S.getSpecies('Blaziken'), 1);
  const target = await f.createPokemon(S.getSpecies('Metagross'), 2);
  who.position.copyFrom(T(-1, 2)); target.position.copyFrom(T(1, 2)); f.faceEachOther(who, target);
  const u = f.units.get(who), rig = u.model.player;
  const skin = u.model.meshes.map((m) => ({ positions: m.getVerticesData('position'), indices: m.getVerticesData('matricesIndices'), weights: m.getVerticesData('matricesWeights') })).filter((s) => s.positions && s.indices && s.weights);
  const caps = H.bodyCapsules(rig, skin);
  // (How it stands: a biped takes only upright animations, a quadruped only four-legged ones, both either.)
  const stance = f.stanceOf(who);
  hand.stance = stance; hand.skipped = [];
  const restD = H.restDepths(rig, caps);
  // (Its body: only species of its Pokédex body shape lend it theirs; their build, measured, shown alongside.)
  const shape = bodyShape('Blaziken');
  hand.shape = shape;
  const build = H.buildOf(rig, u.model.height);
  hand.build = build;
  hand.stats = [];
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(16,24,28,0.85)', color: '#fff', font: '600 15px system-ui', borderRadius: '6px', zIndex: 60 });
  document.body.append(label);
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  const c = T(0, 2).add(new V(0, 1.1, 0)); cam.setTarget(c); cam.setPosition(c.add(new V(-2.5, 1.0, -5.5)));
  hand.play = async (id) => {
    const s = hand.stats.find((x) => x.id === id);
    if (!s) return;
    label.textContent = `Hand Attack ${id} — from ${s.from}` + (hand.scan.done < hand.scan.total ? `   (scanning ${hand.scan.done}/${hand.scan.total})` : '');
    await rig.play(`hand${id}`, { fade: 0.15 });
    void rig.play('idle', { fade: 0.25 });
    await new Promise((r) => setTimeout(r, 700));
  };
  // Laid on it and kept clear of itself, then played at once.
  const add = async (a) => {
    a.id = hand.catalogue.length + 1;
    hand.catalogue.push(a);
    if (!f.constructor.fitsStance(stance, a.onFours)) { hand.skipped.push(`${a.id} ${a.species} (${a.clip}, on four legs)`); return; }
    if (a.shape !== shape) { hand.skipped.push(`${a.id} ${a.species} (${a.clip}, ${a.shape})`); return; }
    const r = H.retarget(a, rig, u.model.height);
    const before = Math.max(...H.selfOverlap(rig, caps, r.poses, restD));
    const clear = H.keepClearFully(rig, caps, r, restD);
    const after = Math.max(...H.selfOverlap(rig, caps, clear.poses, restD));
    rig.clips.set(`hand${a.id}`, H.toClip(clear, `hand${a.id}`, rig.shown));
    hand.stats.push({ id: a.id, from: `${a.species} (${a.clip}, ${a.hand.replace('_', ' ')}${a.onFours ? ', on four legs' : ''}, ${a.shape}, arms ×${a.arms === null ? '—' : a.arms.toFixed(2)}, build ${Number.isFinite(a.build) ? a.build.toFixed(2) : 'unlike'})`, build: a.build, arms: a.arms, overlapBefore: +before.toFixed(3), overlapAfter: +after.toFixed(3) });
    if (!hand.stop) await hand.play(a.id);
  };

  // 2. One species at a time: each attack or swipe a hand leads, shown as soon as it is found.
  // Only from species that learn a claw, a slash or a punch move (the games'
  // punching moves — Iron Fist's — not Sucker Punch).
  const { CLAW_MOVES } = await import('/src/client/vfx/slashMoves.ts');
  const PUNCHES = new Set(['Bullet Punch', 'Comet Punch', 'Dizzy Punch', 'Drain Punch', 'Dynamic Punch', 'Fire Punch', 'Focus Punch', 'Ice Punch', 'Jet Punch',
    'Mach Punch', 'Mega Punch', 'Power-Up Punch', 'Shadow Punch', 'Thunder Punch', 'Hammer Arm', 'Ice Hammer', 'Sky Uppercut', 'Meteor Mash',
    'Double Iron Bash', 'Headlong Rush', 'Plasma Fists', 'Rage Fist', 'Surging Strikes', 'Wicked Blow']);
  const handMove = (m) => m in CLAW_MOVES || PUNCHES.has(m);
  const raw = await (await fetch('/src/shared/data/raw/pokemon.json')).json();
  const names = raw.pokemon.filter((p) => (p.compatible_physical || []).some(handMove)).map((p) => p.name).filter((n) => S.getSpecies(n));
  hand.scan.total = names.length;
  for (const n of names) {
    if (hand.stop) break;
    const found = [];
    try {
      const node = await f.createPokemon(S.getSpecies(n), 1);
      node.setEnabled(false);
      const su = f.units.get(node);
      if (su) {
        const srig = su.model.player;
        const sb = H.buildOf(srig, su.model.height);
        const far = H.buildDistance(build, sb), fits = H.fitsBuild(build, sb);
        // (Its arms against Blaziken's, for their height: 1.2 is a fifth longer.)
        const arms = sb.armToHeight && build.armToHeight ? sb.armToHeight / build.armToHeight : null;
        // A hand attack: one whose blow a hand delivers (frontmost and driving in at its impact) —
        // from its attacks only (its attack and its swipe), never its ranged attack.
        for (const [key, actions] of [['attack', ['attack']], ['swipe', ['swipeStart', 'swipeEnd']]]) {
          if (key === 'swipe' && !f.strikeClip(su, 'swipe')) continue;
          const by = f.impactPart(node, key);
          if (!by || !HANDS.includes(by)) continue;
          const cl = f.strikeClip(su, key);
          const a = H.bakeHandAttack(srig, actions, sampleTrack, { id: 0, species: n, clip: key, hand: by, height: su.model.height, hitTime: cl ? cl.hit : 0.4 });
          // (Done on four legs, or upright: kept for the borrower whose stance it fits.)
          if (a) { a.onFours = f.onFours(node, actions); a.stance = f.stanceOf(node); a.build = far; a.fits = fits; a.arms = arms; a.shape = bodyShape(n); found.push(a); }
        }
      }
      f.units.delete(node);
      node.dispose(false, true);
    } catch (e) { console.warn('hand attacks: skipped', n, e); }
    hand.scan.done++;
    for (const a of found) await add(a);
  }
  hand.ready = true;
  label.textContent = `${hand.stats.length} hand attacks fit Blaziken (same body shape: ${shape}); ${hand.skipped.length} left out`;

  // 3. Then all of them, round and round.
  for (let i = 0; !hand.stop && hand.stats.length; i = (i + 1) % hand.stats.length) await hand.play(hand.stats[i].id);
})();
