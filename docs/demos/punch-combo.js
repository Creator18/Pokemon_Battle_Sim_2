// Demo: Blaziken's own punch and its own kick thrown six times, fast, left
// and right in turn (its right the left's mirror), each hit a punch or a kick
// at random and aimed a random way — the same punch or kick redirected
// (throwForward's aim), arm or leg reached out, each leaving an afterimage
// where it lands. A new combo each time round.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/punch-combo.js')).text())
// Stop: window.__combo.stop = true
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const H = await import('/src/client/render/handAttacks.ts');
  const { sampleTrack } = await import('/src/client/recipe/tranm.js');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  const T = (q, r) => P.board.standPoint(q, r).clone(); const V = T(0, 0).constructor;
  /** How many hits, the chance each is a kick, and how long each runs into the next (s). */
  const HITS = 6, KICK_CHANCE = 0.4, BLEND = 0.05;
  /** Its afterimages: a little fainter than a dodge's (0.95), so the blows blur rather than stand. */
  const GHOST_ALPHA = 0.75;
  /**
   * Each kind of hit: its clip, the limb that leads it, the part of it each
   * hit is (frames: swung through, out, on its way back), the frame it is
   * furthest out (its afterimage), how fast (× its own), and its aims — round from straight ahead (degrees, either way), and
   * up or down from its shoulder or hip.
   */
  const KINDS = {
    punch: { actions: ['swipeStart', 'swipeEnd'], clip: 'swipe', limb: 'left_hand', from: 34, to: 64, peak: 48, speed: 2.2, yaw: 40, pitch: [-30, 35] },
    kick: { actions: ['attack'], clip: 'attack', limb: 'left_foot', from: 34, to: 56, peak: 46, speed: 1.8, yaw: 35, pitch: [-35, 20] },
  };

  const a = await f.createPokemon(S.getSpecies('Blaziken'), 1), b = await f.createPokemon(S.getSpecies('Metagross'), 2);
  const A = T(-1, 2), B = T(1, 2); a.position.copyFrom(A); b.position.copyFrom(B); f.faceEachOther(a, b);
  const u = f.units.get(a), rig = u.model.player;
  for (const k of Object.values(KINDS)) {
    const cl = f.strikeClip(u, k.clip);
    const baked = H.bakeHandAttack(rig, k.actions, sampleTrack, { id: 0, species: 'Blaziken', clip: k.clip, hand: k.limb, height: u.model.height, hitTime: cl.hit });
    k.own = H.retarget(baked, rig, u.model.height); k.hit = baked.hit; k.fps = baked.fps;
  }

  const w = B.subtract(A).normalize(), side = new V(w.z, 0, -w.x);
  const c = A.add(w.scale(0.4)).add(new V(0, 0.95, 0));
  const cam = sc.activeCamera; cam.lowerRadiusLimit = 0.3; cam.upperRadiusLimit = 100; cam.attachControl(document.querySelector('canvas'), true);
  cam.setTarget(c); cam.setPosition(c.add(side.scale(-3.6)).add(w.scale(3.4)).add(new V(0, 0.5, 0)));
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '16px', top: '16px', padding: '8px 12px', background: 'rgba(150,60,10,0.92)', color: '#fff', font: '600 15px system-ui', borderRadius: '6px', zIndex: 60, whiteSpace: 'pre' });
  document.body.append(label);

  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const st = (window.__combo = { stop: false, hits: [] });
  for (let round = 1; !st.stop; round++) {
    // Six hits, left and right in turn, each a punch or a kick, each aimed its own way.
    const hits = [], parts = [];
    for (let i = 0; i < HITS; i++) {
      const kind = Math.random() < KICK_CHANCE ? 'kick' : 'punch', k = KINDS[kind];
      const aim = { yaw: rnd(-k.yaw, k.yaw), pitch: rnd(k.pitch[0], k.pitch[1]) };
      const left = H.throwForward(rig, k.own, k.limb, k.hit, 1, aim).clip;
      const right = i % 2 === 1;
      parts.push({ clip: right ? H.mirrorClip(rig, left) : left, from: k.from, to: k.to, speed: k.speed });
      // (When it starts in the combo: its frames at its speed, less the blend into it.)
      hits.push({ kind, side: right ? 'R' : 'L', limb: (right ? 'right' : 'left') + k.limb.slice(4), aim, frames: Math.floor((k.to - k.from) / k.speed) + 1, peak: (k.peak - k.from) / k.speed });
    }
    const combo = H.chainClips(parts, 1, BLEND);
    st.hits = hits;
    rig.clips.set('combo', H.toClip(combo, 'combo', rig.shown));
    label.textContent = `Blaziken — six-hit combo #${round}\n${hits.map((h, i) => `${i + 1}. ${h.side} ${h.kind.padEnd(5)} ${h.aim.yaw >= 0 ? '+' : ''}${h.aim.yaw.toFixed(0)}° round, ${h.aim.pitch >= 0 ? '+' : ''}${h.aim.pitch.toFixed(0)}° up`).join('\n')}`;
    // When each hit is furthest out in the combo.
    const fps = combo.fps, overlap = Math.round(BLEND * fps);
    let at = 0;
    const beats = hits.map((h) => { const start = at; at += h.frames - overlap; return { ...h, start: start / fps, end: (start + h.frames) / fps, peakAt: (start + h.peak) / fps }; });
    const t0 = performance.now();
    let ghosted = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      // Each hit, the moment it is furthest out: its afterimage.
      while (ghosted < beats.length && t >= beats[ghosted].peakAt) { f.afterimage(a, GHOST_ALPHA); ghosted++; }
    };
    const obs = sc.onBeforeRenderObservable.add(tick);
    await rig.play('combo', { fade: 0.12 });
    sc.onBeforeRenderObservable.remove(obs);
    void rig.play('idle', { fade: 0.2 });
    await new Promise((r) => setTimeout(r, 700));
  }
  label.remove();
})();
