// Hunger Games tribute: d3-lucario (Lucario, Fighting/Steel).
// Reads the game, returns intents. Never writes to any game object.
window.__brains = window.__brains || {};
window.__brains['d3-lucario'] = {
  name: 'Aura Warden',
  species: 'Lucario',
  kit: { ranged: 'Aura Sphere', close: 'Close Combat', mobility: 'Bullet Punch', control: 'Detect' },
  strategy: 'Punish the aiming window: whenever the foe roots itself to aim or charge, Bullet Punch / Close Combat it (contact pushes through ranged fire and cancels the shot). From range, throw the homing Aura Sphere only when the foe cannot reach me during its charge; Detect real incoming blows, wait out braces, and coast on HP share near the time limit.',

  make({ me, foe, arena, consts, Fighter }) {
    const C = consts;
    const AIM_ANGLE = C.AIM_ANGLE || 0.6;
    const QUICK_DIST = C.QUICK_DIST || 3.2;
    const RAM_DIST = C.RAM_DIST || 3.2;
    const BALL_REACH = C.BALL_REACH || 8;
    const BRACES = C.BRACES || new Set(['Sucker Punch', 'Counter', 'Detect']);
    const isBall = C.isBall || (() => false);
    const isRam = C.isRamMove || (() => false);
    const isQuick = C.isQuickStrike || (() => false);
    const getMove = C.getMove || (() => null);

    const K = me.moves || {};
    const RANGED = K.ranged, CLOSE = K.close, MOB = K.mobility, CTRL = K.control;
    const IDLE = { want: 0, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
      ranged: false, close: false, mobility: false, control: false, dash: false };

    // Does a move of mine hurt this foe at all (Gengar is immune to Fighting)?
    const hurts = (m) => { try { return !!m && me.damageTo(m, foe) > 0; } catch (e) { return true; } };
    const ccOK = hurts(CLOSE), bpOK = hurts(MOB), asOK = hurts(RANGED);
    const foeK = foe.moves || {};
    const foeHasRush = isRam(foeK.close) || isQuick(foeK.mobility);
    const foeCounter = foeK.control === 'Counter';

    const st = {
      aim: 0,            // aim held while my ranged move is being taken
      punishTill: -1,    // foe's brace just ended: press in
      foeBraced: false,
      clashPressed: false,
      lastJump: -1,
      aimStart: -1,
    };

    const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const out = (o) => Object.assign({}, IDLE, o);

    // Body gap along x between me and the foe (world units, < 0 overlapping).
    function bodyGap() {
      const [lo, hi] = me.span(), [flo, fhi] = foe.span();
      return foe.x >= me.x ? flo - hi : lo - fhi;
    }
    // My aim direction, facing `face`.
    const dirFor = (face, a) => [face * Math.cos(a * AIM_ANGLE), Math.sin(a * AIM_ANGLE)];

    // Close Combat's flurry reach (Fighter.flurry's disc), at aim a.
    function flurryHits(face, a, slack) {
      const R = me.H * 0.9, d = dirFor(face, a);
      const cx = me.x + d[0] * R * 0.75, cy = me.y + me.H * 0.5 + d[1] * R * 0.75;
      const [l, r, b, t] = foe.box();
      const px = Math.max(l, Math.min(r, cx)), py = Math.max(b, Math.min(t, cy));
      return Math.hypot(px - cx, py - cy) <= R * 0.75 * (slack || 0.92);
    }
    function flurryAim(face) {
      for (const a of [0, 0.5, 1, -0.5, -1]) if (flurryHits(face, a)) return a;
      return null;
    }

    // Bullet Punch (Fighter.quickAttack): along aim aloft or aimed up, level on the ground otherwise.
    function punchHits(face, a, gap) {
      if (!me.grounded && !me.flying && me.airDash === false) return false;
      const tilt = !me.grounded || a > 0 ? a * AIM_ANGLE : 0;
      const ux = Math.cos(tilt), uy = Math.sin(tilt);
      const reach = QUICK_DIST * me.H;
      const upTo = (gap - 0.08) / Math.max(ux, 0.2);
      if (upTo > reach * 0.95) return false;
      const y = me.y + uy * Math.max(0, upTo);
      return foe.y < y + me.H * 0.9 && foe.y + foe.H > y + me.H * 0.1;
    }
    function punchAim(face, gap) {
      for (const a of [0, 0.5, 1]) if (punchHits(face, a, gap)) return a;
      return null;
    }

    // The foe's blow (a contact move) under way or wound up, and how far it reaches.
    function foeContact() {
      const u = foe.using || '';
      if (foe.ramming) return { move: foe.ramming.move || foeK.close, reach: RAM_DIST * foe.H + 1.2 };
      if (foe.quick && u && u !== 'Counter' && u !== 'Sucker Punch') return { move: u, reach: QUICK_DIST * foe.H + 1.2 };
      if (foe.firing && u && u === foeK.close && u !== 'Earthquake') return { move: u, reach: foe.H * 0.9 * 1.45 + 0.4 };
      const tl = !foe.busy ? foe.telling : '';
      if (tl && tl === foeK.close && tl !== 'Earthquake' && !isRam(tl)) return { move: tl, reach: foe.H * 0.9 * 1.45 + 0.6, tell: true };
      if (tl && (isRam(tl) || isQuick(tl))) return { move: tl, reach: RAM_DIST * foe.H + 1.5, tell: true };
      return null;
    }

    // The foe rooted with its ranged move: aiming, or its beam / ball charging (the window to punish).
    function foeRooted() {
      if (foe.aiming) return true;
      if (foe.beam && !foe.beam.launched) return true;
      if (foe.ballCharge) return true;
      return false;
    }

    // A foe ball flying at me.
    function ballAtMe() {
      for (const b of foe.balls || []) {
        if (!b.launched || b.done || !b.play || !b.play.position) continue;
        const p = b.play.position();
        if (b.homing === me) { if (Math.hypot(p.x - me.x, p.y - (me.y + me.H * 0.5)) < me.H * 2.2) return { b, homing: true, d: Math.abs(p.x - me.x) }; continue; }
        const ahead = (me.x - p.x) * sgn(me.x - foe.x || 1);
        if (ahead > -me.H * 0.3 && ahead < 3.2 && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H) return { b, homing: false, d: ahead };
      }
      return null;
    }

    // The foe's beam pouring along a line that meets me.
    function beamOnMe() {
      const b = foe.beam;
      if (!b || !b.launched) return false;
      try { return Fighter.lineMeets(b.from, b.dir, (b.range || 8) + 0.5, me) !== null; } catch (e) { return true; }
    }
    function beamChargingAtMe() {
      const b = foe.beam || foe.ballCharge;
      if (!b || b.launched) return false;
      try { return Fighter.lineMeets(b.from, b.dir, (b.range || 8) + 1, me) !== null; } catch (e) { return true; }
    }

    // A Stone Edge pillar between me and the foe, near me.
    function pillarAhead(dir) {
      for (const s of arena.level || []) {
        if (!s.pillar || s.hidden) continue;
        const near = dir > 0 ? s.x - me.x : me.x - (s.x + s.w);
        const beyondFoe = dir > 0 ? s.x > foe.x : s.x + s.w < foe.x;
        if (near > -0.2 && near < 1.6 && !beyondFoe && s.top > me.y + 0.3) return s;
      }
      return null;
    }

    return (t) => {
      if (me.down || foe.down) return out({ face: sgn(foe.x - me.x) || me.facing });
      const dx = foe.x - me.x, dir = sgn(dx) || me.facing, dist = Math.abs(dx);
      const dy = foe.y - me.y;
      const facing = me.facing === dir;
      const gap = bodyGap();
      const base = { face: dir, aim: 0 };

      // In a clash: stop my needle at its top.
      if (me.clashing) {
        const n = me.clashing.needle ? me.clashing.needle() : null;
        const done = me.clashing.stopped ? me.clashing.stopped() !== null : false;
        if (n === null || done) { st.clashPressed = false; return out(base); }
        if (!st.clashPressed && n >= 0.955) { st.clashPressed = true; return out(Object.assign(base, { ranged: true })); }
        return out(base);
      }
      st.clashPressed = false;

      // Taking aim: keep my line where I set it.
      if (me.aiming) return out({ face: me.facing, aim: st.aim });
      if (me.busy) return out({ face: dir, aim: st.aim, jumpHeld: !me.grounded });

      // The foe's brace: wait it out, then punish while it cools.
      if (st.foeBraced && !foe.countering) st.punishTill = t + 1.6;
      st.foeBraced = foe.countering;

      const myShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp;
      const lateLead = t > 132 && myShare > foeShare + 0.04;
      const detectReady = CTRL === 'Detect' && me.ready(CTRL);
      const ccReady = ccOK && CLOSE && me.ready(CLOSE);
      const bpReady = bpOK && MOB && me.ready(MOB);
      const asReady = asOK && RANGED && me.ready(RANGED);
      const ccAim = facing ? flurryAim(dir) : null;
      const bpAim = facing && gap > 0.15 ? punchAim(dir, gap) : null;
      const eDist = Math.hypot(dx, dy);

      // ── Foe braced (Detect / Sucker Punch / Counter): no blows into it. Counter only turns physical: an Aura Sphere is safe.
      if (foe.countering) {
        if (foeCounter && asReady && facing && eDist < BALL_REACH - 0.6) { st.aim = 0; return out(Object.assign(base, { ranged: true })); }
        if (gap < 0.6) return out(Object.assign(base, { want: -dir }));
        return out(base);
      }

      // ── Threats on me.
      const fc = foeContact();
      if (fc && dist <= fc.reach + me.reachOf().back) {
        const firm = !fc.tell;
        // Detect: the blow is truly coming.
        if (detectReady && (firm || dist < fc.reach * 0.8)) return out(Object.assign(base, { control: true }));
        // In my reach and it's only winding up: strike first.
        if (fc.tell && ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
        if (fc.tell && bpReady && bpAim !== null) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
        // A ram along the floor: hop it.
        if (foe.ramming && me.grounded && Math.abs(dy) < me.H) return out(Object.assign(base, { jumpPressed: true, jumpHeld: true }));
        // Already under way: trade blows (my flurry holds it), else back-dash out.
        if (firm && ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
        if (me.grounded && me.ready('Back Dash') && firm) return out(Object.assign(base, { want: 0, dash: true }));
      }

      // Earthquake / Stone Edge coming: off the ground.
      const fu = foe.using || (!foe.busy ? foe.telling : '');
      if (fu === 'Earthquake' && me.grounded && dist < 7.5 && t - st.lastJump > 0.25) { st.lastJump = t; return out(Object.assign(base, { want: dir, jumpPressed: true, jumpHeld: true })); }
      if (fu === 'Stone Edge' && me.grounded && t - st.lastJump > 0.3) {
        // Rooted foe in reach: punish through it; else hop.
        if (bpReady && bpAim !== null) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
        st.lastJump = t; return out(Object.assign(base, { jumpPressed: true, jumpHeld: true }));
      }

      // ── The aiming window: the foe rooted with its ranged move. Rush it.
      if (foeRooted() || (foe.telling === foeK.ranged && !foe.busy)) {
        if (ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
        if (bpReady && bpAim !== null) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
        // Too far to punch: dash in, if that brings me into punching range.
        if (facing && me.grounded && me.ready('Dash') && gap > QUICK_DIST * me.H * 0.6 && gap < QUICK_DIST * me.H + 5 && Math.abs(dy) < me.H * 1.5)
          return out(Object.assign(base, { want: dir, dash: true }));
      }

      // A beam pouring on me: Detect, or punch through it if I can reach.
      if (beamOnMe()) {
        if (bpReady && bpAim !== null) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
        if (ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
        if (detectReady) return out(Object.assign(base, { control: true }));
        if (me.grounded && t - st.lastJump > 0.4) { st.lastJump = t; return out(Object.assign(base, { jumpPressed: true, jumpHeld: true, want: dir })); }
      }

      // A ball at me.
      const ball = ballAtMe();
      if (ball) {
        if (ball.homing || ball.d < 1.3) {
          if (detectReady && ball.d < 1.6) return out(Object.assign(base, { control: true }));
          if (bpReady && bpAim !== null) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
        }
        if (!ball.homing && me.grounded && t - st.lastJump > 0.4) { st.lastJump = t; return out(Object.assign(base, { jumpPressed: true, jumpHeld: true, want: lateLead ? 0 : dir })); }
      }

      // ── Late lead: protect the HP share (keep away, snipe with Aura Sphere).
      if (lateLead) {
        const safe = gap > (foeHasRush ? RAM_DIST * foe.H + 1.2 : 2.5);
        if (asReady && facing && safe && eDist < BALL_REACH - 0.7) { st.aim = 0; return out(Object.assign(base, { ranged: true })); }
        if (ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
        const wallBehind = dir > 0 ? me.x < -9.5 : me.x > 9.5;
        if (gap < 5 && !wallBehind) return out(Object.assign(base, { want: -dir }));
        return out(base);
      }

      // ── Offence.
      const punishing = t < st.punishTill;
      // 1. In flurry reach: Close Combat.
      if (ccReady && ccAim !== null) { st.aim = ccAim; return out(Object.assign(base, { aim: ccAim, close: true })); }
      // 2. Bullet Punch in (priority, pushes through ranged fire).
      if (bpReady && bpAim !== null && (gap > 0.5 || !ccOK || punishing)) { st.aim = bpAim; return out(Object.assign(base, { aim: bpAim, mobility: true })); }
      // 3. Aura Sphere (homing, never misses) — only when it can't be cut off during its charge.
      if (asReady && facing && eDist < BALL_REACH - 0.6) {
        const foeBusyLong = foe.stunned || (foe.firing && foe.using && foe.using !== foeK.close) || foe.dashT > 0;
        const foeCantRush = !(foeK.close && foe.ready(foeK.close) && isRam(foeK.close)) && !(foeK.mobility && foe.ready(foeK.mobility) && isQuick(foeK.mobility));
        const far = gap > (foeHasRush ? RAM_DIST * foe.H + 1.0 : 3.0);
        const high = dy > me.H * 1.3 && foe.flying;
        if (far || high || foeBusyLong || (foeCantRush && gap > 2.2) || !ccOK) {
          st.aim = 0;
          return out(Object.assign(base, { ranged: true }));
        }
      }

      // 4. Close the distance.
      const i = Object.assign({}, base);
      if (dy > me.H * 0.9 && dist < me.H * 2.5) {
        // Foe above me: jump into it (flurry aimed up when it comes into reach).
        if (me.grounded && t - st.lastJump > 0.35) { st.lastJump = t; return out(Object.assign(i, { want: dist > me.H ? dir : 0, jumpPressed: true, jumpHeld: true })); }
        return out(Object.assign(i, { want: dist > me.H * 0.8 ? dir : 0, jumpHeld: true }));
      }
      if (!me.grounded) return out(Object.assign(i, { want: gap > 0.2 ? dir : 0, jumpHeld: dy > 0 }));
      if (pillarAhead(dir) && t - st.lastJump > 0.4) { st.lastJump = t; return out(Object.assign(i, { want: dir, jumpPressed: true, jumpHeld: true })); }
      // Waiting on cooldowns while touching: hold my ground facing it (don't walk into a free hit).
      if (gap < 0.25) {
        if (!ccReady && !bpReady && me.hp < foe.hp * 0.9 && foe.ready(foeK.close) && me.ready('Back Dash') && Math.random() < 0.02)
          return out(Object.assign(i, { want: 0, dash: true }));
        return out(i);
      }
      // Far: dash in toward punching range.
      if (gap > QUICK_DIST * me.H + 1.5 && me.ready('Dash') && facing && Math.random() < 0.25) return out(Object.assign(i, { want: dir, dash: true }));
      return out(Object.assign(i, { want: dir }));
    };
  },
};
