// Hunger Games tribute: Gyarados (Water/Flying) - "Red Tide".
// Read-only brain: it reads the two Fighters and the arena and returns an Intent each frame. Nothing is changed.
(function () {
  window.__brains = window.__brains || {};

  const KIT = { ranged: 'Hydro Cannon', close: 'Sky Attack', mobility: 'Aqua Jet', control: 'Detect' };

  // Tuning.
  const BEAM_CHARGE = 1.1;       // a beam's charge before launch (s) - Fighter's BEAM_CHARGE; learned per move below
  const FRONT_TIME = 0.6;        // a beam's front crossing (s)
  const RUN = 7, RAM_SPEED = 13; // world units / s
  const COAT_LAG = 0.3;          // guess: a ram's coat lighting before it runs (s)
  const WALL = 10.6;             // the stadium floor's half-width, about

  window.__brains['d5-gyarados'] = {
    name: 'Red Tide',
    species: 'Gyarados',
    kit: KIT,
    strategy: 'Hover at Sky Attack range and punish every commitment: any aim, beam charge, whiffed slash or brace lag is met by a full-momentum Sky Attack ram (or Aqua Jet when closer), which pushes through ranged fire and cancels the shot. '
      + 'Detect the blows and beams it cannot beat, jump rams and Stone Edge, never strike into a brace, and sit on the HP lead near the 150 s limit.',

    make({ me, foe, arena, Fighter, consts, memory }) {
      const C = consts;
      const AIM_ANGLE = C.AIM_ANGLE;
      memory.charge = memory.charge || {};          // observed beam charge time by move name
      memory.foes = memory.foes || {};
      const fm = (memory.foes[foe.name] = memory.foes[foe.name] || { battles: 0, ranged: 0, contact: 0, braces: 0 });
      fm.battles++;

      let lockedAim = null;       // aim held while our own aim is being taken
      let lastJumpPress = -9;     // when we last pressed jump
      let foeWasBraced = false, punishTill = -1;
      let foeBeamSeen = null;     // the foe beam object last seen charging (to learn its charge time)
      let lastFoeUse = '';
      let clashStop = null;

      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const sgn = (v, d) => (v > 0 ? 1 : v < 0 ? -1 : d);

      return (t) => {
        const I = { want: 0, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
          ranged: false, close: false, mobility: false, control: false, dash: false };
        if (me.down) return I;
        const dx = foe.x - me.x, dir = sgn(dx, me.facing), dist = Math.abs(dx);
        I.face = dir;
        if (foe.down) return I;

        // ── a clash: stop the needle near its top ──
        if (me.clashing) {
          const n = me.clashing.needle();
          if (n === null || me.clashing.stopped() !== null) return I;
          if (clashStop === null) clashStop = 0.06 + Math.random() * 0.06;
          I.ranged = n >= 1 - clashStop;
          return I;
        }
        clashStop = null;

        // ── geometry ──
        const myFront = me.reachOf().front;
        const [flo, fhi] = foe.span();
        const gap = dir > 0 ? flo - (me.x + myFront) : (me.x - myFront) - fhi; // our nose to its body
        const myMid = me.y + me.H * 0.5, foeMid = foe.y + foe.H * 0.5;
        const dy = foeMid - myMid;
        const level = Math.abs(dy) < (me.H + foe.H) * 0.5 * 0.7 && foe.y < me.y + me.H && foe.y + foe.H > me.y;
        const facingFoe = me.facing === dir;
        const ramLen = C.RAM_DIST * me.H;
        const quickLen = C.QUICK_DIST * me.H;
        const [mx, my] = me.mouth();
        const aimRaw = clamp(Math.atan2(foeMid - my, Math.max(0.3, Math.abs(foe.x - mx))) / AIM_ANGLE, -1, 1);
        const aim = Math.abs(aimRaw) < 0.12 ? 0 : aimRaw;
        I.aim = aim;
        const pillarIn = (d) => {
          if (!arena || !arena.level) return false;
          const w = Fighter.pillarAlong(arena, [me.x, me.y + me.H * 0.4], [dir, 0], Math.max(0.1, d));
          return w !== null && w < d;
        };
        const blocked = pillarIn(Math.max(0.1, gap + myFront));
        const hpMe = me.hp / me.maxHp, hpFoe = foe.hp / foe.maxHp;
        const lead = hpMe - hpFoe;
        const late = t > 118;
        const protect = late && lead > 0.04;      // sit on the lead
        const desperate = (t > 125 && lead < 0.03) || (t > 100 && lead < -0.15);

        // ── the foe's state ──
        const fb = foe.beam || foe.ballCharge;
        const foeRanged = foe.moves.ranged || '';
        const foeClose = foe.moves.close || '';
        if (foe.using && foe.using !== lastFoeUse) {
          if (foe.using === foeRanged) fm.ranged++;
          else if (foe.using === foeClose || foe.using === foe.moves.mobility) fm.contact++;
          else if (C.BRACES.has(foe.using)) fm.braces++;
        }
        lastFoeUse = foe.using || '';
        // learn how long its beams charge
        if (foe.beam && !foe.beam.launched) foeBeamSeen = foe.beam;
        else if (foeBeamSeen && foe.beam === foeBeamSeen && foeBeamSeen.launched) {
          const c = foe.time - foeBeamSeen.pressedAt;
          if (c > 0.05 && c < 3) memory.charge[foeBeamSeen.move] = c;
          foeBeamSeen = null;
        } else if (!foe.beam) foeBeamSeen = null;
        const chargeOf = (m) => (memory.charge[m] !== undefined ? Math.min(memory.charge[m], BEAM_CHARGE) : BEAM_CHARGE);

        // its brace: waited out, then punished while it cools
        if (foeWasBraced && !foe.countering) punishTill = t + 1.6;
        foeWasBraced = foe.countering;
        const punishing = t < punishTill;
        const foeBraced = foe.countering;

        // is its ranged move pointed at us (aiming, charging, pouring)?
        const facesMe = foe.facing === -dir;
        let rangedThreat = false, timeToHit = Infinity, beamLive = false;
        if (foe.aiming && facesMe && foeRanged !== 'Stone Edge') {
          const left = Math.max(0, C.AIM_MIN - (foe.time - foe.aiming.since));
          rangedThreat = Math.abs(dy) < me.H * 2.2;
          timeToHit = left + (C.isBall(foeRanged) ? 0.25 : chargeOf(foeRanged)) + 0.12;
        }
        if (fb) {
          const meets = Fighter.lineMeets(fb.from, fb.dir, (fb.range || 8) + 0.6, me) !== null;
          if (meets && facesMe) {
            rangedThreat = true;
            if (!fb.launched) timeToHit = Math.max(0, chargeOf(fb.move) - (foe.time - fb.pressedAt)) + 0.12;
            else { timeToHit = 0; beamLive = !!(foe.beam && foe.beam.pouring); }
          }
        }
        // a ball in flight coming at us
        let ballAt = null;
        for (const b of foe.balls || []) {
          if (!b.launched || b.done || !b.play || !b.play.position) continue;
          const p = b.play.position();
          const ahead = (me.x - p.x) * sgn(me.x - foe.x, 1);
          if (b.homing === me || (ahead > -me.H * 0.3 && ahead < 3.5 && Math.abs(p.y - myMid) < me.H * 0.9)) { ballAt = b; break; }
        }
        // Stone Edge coming up under us
        const edgeComing = foeRanged === 'Stone Edge' && ((foe.firing && foe.using === 'Stone Edge') || foe.telling === 'Stone Edge');
        const edgeAiming = foeRanged === 'Stone Edge' && !!foe.aiming;
        // a contact blow coming at us
        const ram = foe.ramming;
        const foeRamAtMe = !!ram && ram.dir === -dir && level && gap < C.RAM_DIST * foe.H + 1.5;
        const foeQuick = foe.quick && foe.using && (C.isQuickStrike(foe.using) || foe.using === 'Shadow Sneak' || foe.using === 'Feint' || foe.using === 'Sucker Punch' || foe.using === 'Counter');
        const foeSwing = foe.firing && foe.using && foe.using === foeClose && !C.isRamMove(foeClose) && foeClose !== 'Earthquake';
        const swingReach = foeSwing ? foe.reachWith(foeClose) + me.reachOf().back + 0.3 : 0;
        const swingAtMe = foeSwing && dist <= swingReach && Math.abs(dy) < me.H * 1.2;
        const tellClose = foe.telling && (foe.telling === foeClose || foe.telling === foe.moves.mobility) && foe.telling !== 'Earthquake'
          && dist <= foe.reachWith(foe.telling) + me.reachOf().back + 0.4;
        // the foe open: rooted in something that isn't a contact blow (aim, charge, pour, whiffed swing, brace lag, flinch)
        const foeOpen = !foeBraced && (foe.stunned || !!foe.aiming || (foe.firing && !foe.inContactMove() && !C.BRACES.has(foe.using))
          || (foe.busy && !foe.inContactMove() && !foe.quick && !foe.ramming));

        // ── our own move under way ──
        if (me.busy) {
          if (me.aiming) { I.aim = lockedAim !== null ? lockedAim : aim; I.face = me.facing; }
          if (me.flying) I.jumpHeld = dy > 0.2;
          return I;
        }
        lockedAim = null;

        const can = (m) => !!m && me.ready(m);
        const ramReady = can(KIT.close) && (me.grounded || me.flying);
        const jetReady = can(KIT.mobility) && (me.grounded || me.flying);
        const detectReady = can(KIT.control) && !me.countering;
        // ram lands if level, facing, no pillar, within the run
        // its lunging brace (Sucker Punch, Counter) ready: it can turn back a committed blow - unless it is locked in a move
        const fCtl = foe.moves.control || '';
        const lungeReady = (fCtl === 'Sucker Punch' || fCtl === 'Counter') && foe.ready(fCtl) && !foeBraced;
        // its Detect ready: a ram into it is wasted, so it gets baited out too (with Aqua Jet) before the ram
        const detectUp = fCtl === 'Detect' && foe.ready(fCtl) && !foeBraced;
        const foeLocked = !!foe.aiming || !!foe.beam || !!foe.ballCharge || foe.stunned || !!foe.ramming || foe.quick
          || (foe.firing && !C.BRACES.has(foe.using));
        const safeHit = !lungeReady || foeLocked;
        const safeShot = safeHit || fCtl === 'Counter';   // Counter turns back physical blows only
        const ramOk = (maxGap) => ramReady && facingFoe && level && !blocked && gap <= maxGap && !foeBraced && safeHit;
        const jetOk = (maxGap) => jetReady && facingFoe && level && !blocked && gap <= maxGap && gap > 0.15 && !foeBraced;
        const ramTime = (g) => COAT_LAG + Math.max(0, g - ramLen * 0.9) / RUN + Math.min(g, ramLen) / RAM_SPEED;

        const jump = () => { I.jumpPressed = true; I.jumpHeld = true; lastJumpPress = t; };
        const fire = (a) => { I.ranged = true; I.aim = a; lockedAim = a; };

        // ── 1. a contact blow on its way at us ──
        if (foeRamAtMe || foeQuick || swingAtMe || tellClose) {
          // a slow swing we are already outside: no need
          if (detectReady && (foeRamAtMe ? gap < 4.5 : true)) { I.control = true; return I; }
          if (foeRamAtMe) {
            // over it (rams run flat); or meet it head-on if we're already airborne
            if (me.grounded) { jump(); I.want = 0; return I; }
            if (ramOk(ramLen)) { I.close = true; return I; }
            I.jumpHeld = true; return I;
          }
          if ((swingAtMe || tellClose) && me.grounded && can('Back Dash')) { I.dash = true; I.want = 0; return I; }
          if (swingAtMe && me.grounded) { jump(); I.want = -dir; return I; }
        }

        // ── 2. Stone Edge: interrupt the aim, else jump the pillar ──
        if (edgeAiming && ramOk(ramLen * 0.95)) { I.close = true; return I; }
        if (edgeAiming && jetOk(quickLen * 0.95)) { I.mobility = true; I.aim = 0; return I; }
        if (edgeComing) {
          if (me.grounded) { jump(); I.want = dir; return I; }
          I.jumpHeld = true; I.want = dir;
          return I;
        }

        // ── 3. its ranged move at us ──
        if (rangedThreat && !foeBraced) {
          // beat it to the punch: a contact move pushes through and cancels the shot
          if (ramOk(ramLen * 0.98) && ramTime(gap) < timeToHit + 0.35) { I.close = true; return I; }
          if (jetOk(quickLen * 0.98) && timeToHit > 0.12) { I.mobility = true; I.aim = 0; return I; }
          if (ramOk(ramLen * 0.98) && (beamLive || timeToHit < 0.3)) { I.close = true; return I; }   // take it, ram anyway
          // close the distance if there's time to get there before it lands
          const need = ramTime(gap);
          if (facingFoe && level && !blocked && need < timeToHit - 0.1 && gap > ramLen * 0.9) {
            I.want = dir;
            if (can('Dash') && me.grounded && gap > ramLen * 1.2) I.dash = true;
            return I;
          }
          // no time: brace or get out of its line
          if (detectReady && timeToHit < 0.45) { I.control = true; return I; }
          if (timeToHit < 0.35 || beamLive) {
            if (me.grounded) { jump(); return I; }
            I.jumpHeld = true;
            // airborne off a jump: take off and climb clear of its line
            if (!me.flying && me.mayFly && t - lastJumpPress > 0.16) { I.jumpPressed = true; lastJumpPress = t; }
            return I;
          }
          // wait for the moment, edging in
          if (gap > ramLen * 0.9 && !protect) I.want = dir;
          return I;
        }
        if (ballAt) {
          if (ramOk(ramLen * 0.6)) { I.close = true; return I; }   // through it and into the thrower
          if (ballAt.homing === me && detectReady) { I.control = true; return I; }
          if (!ballAt.homing && me.grounded) { jump(); I.want = dir; return I; }
        }

        // ── 4. it is braced: wait it out (a step back), then punish ──
        if (foeBraced) {
          if (gap < 2.2 && me.grounded) I.want = -dir;
          return I;
        }

        // ── 5. it is open: punish ──
        if (foeOpen) {
          if (ramOk(ramLen * 0.98)) { I.close = true; return I; }
          if (jetOk(quickLen * 0.95) && gap > 0.6) { I.mobility = true; I.aim = 0; return I; }
        }
        if (punishing && ramOk(ramLen * 0.98)) { I.close = true; return I; }

        // ── 6. flight: match a foe high above, come down onto a grounded one ──
        if (dy > me.H * 0.8) {
          if (me.mayFly || me.flying) {
            if (me.flying && me.flightLeft !== undefined && me.flightLeft < 0.8) { I.sink = true; return I; }
            if (me.flying) { I.jumpHeld = true; I.want = gap > ramLen * 0.85 ? dir : gap < ramLen * 0.4 ? -dir : 0; return I; }
            if (me.grounded) { jump(); return I; }
            I.jumpHeld = true;
            if (t - lastJumpPress > 0.16) { I.jumpPressed = true; lastJumpPress = t; }
            return I;
          }
          // can't follow it up: Aqua Jet aimed up, or the cannon up at it
          if (jetReady && facingFoe && dist < quickLen && aimRaw > 0.3 && !foeBraced) { I.mobility = true; I.aim = aimRaw; return I; }
          if (can(KIT.ranged) && facingFoe && !protect) {
            const d = Fighter.lineMeets([mx, my], me.aimDir(aimRaw), me.beamRange, foe);
            if (d !== null && safeShot) { fire(aimRaw); return I; }
          }
          I.want = gap > 2 ? dir : 0;
          return I;
        }
        if (me.flying && me.flightLeft !== undefined && me.flightLeft < 0.8) I.sink = true;
        else if (me.flying) {
          if (dy < -me.H * 0.35) I.sink = true;
          else if (dy > me.H * 0.15) I.jumpHeld = true;
        }

        // ── bait: its brace ready and it free - a cheap Aqua Jet to draw the brace out (or land 40 power), then ram while it cools ──
        if ((lungeReady || detectUp) && !foeLocked && !protect) {
          if (jetOk(quickLen * 0.95) && gap > 0.4) { I.mobility = true; I.aim = 0; return I; }
          if (gap > quickLen * 0.85) { I.want = dir; return I; }
          if (gap < quickLen * 0.4 && me.grounded) I.want = -dir;
          return I;
        }
        // ── 7. neutral: space at ram range, ram with a run-up ──
        const sweetLo = ramLen * 0.55, sweetHi = ramLen * 0.92;
        const aggressive = desperate || (!protect && (hpMe > 0.35 || lead > -0.1));
        if (aggressive && ramOk(sweetHi) && gap >= sweetLo) { I.close = true; return I; }
        // too close for a good run: Aqua Jet poke when the ram is cooling, else make room
        if (gap < sweetLo) {
          if (!ramReady && jetOk(quickLen) && gap > 0.5 && aggressive) { I.mobility = true; I.aim = 0; return I; }
          if (ramOk(sweetLo) && (desperate || gap < 0.6)) { I.close = true; return I; }   // point blank: still 70%+
          const roomBehind = dir > 0 ? me.x + WALL : WALL - me.x;
          if (me.grounded && can('Back Dash') && roomBehind > 3 && ramReady) { I.dash = true; I.want = 0; return I; }
          if (roomBehind > 1.5) { I.want = -dir; return I; }
          // cornered: just ram
          if (ramOk(ramLen)) { I.close = true; return I; }
          return I;
        }
        // far: a cannon shot if it's not going to be punished (it's busy, or far and facing away), else close in
        if (can(KIT.ranged) && facingFoe && gap > ramLen * 1.25 && !protect && safeShot) {
          const meets = Fighter.lineMeets([mx, my], me.aimDir(aim), me.beamRange, foe) !== null;
          // its beam would beat ours in a clash: shoot only when it can't answer (flinching, or its back turned)
          let weaker = false;
          try {
            if (foeRanged && foeRanged !== 'Stone Edge') {
              const a = me.clashTerms(KIT.ranged, foeRanged), b = foe.clashTerms(foeRanged, KIT.ranged);
              weaker = a.P * a.E < b.P * b.E * 1.1;
            }
          } catch (e) { weaker = true; }
          const safe = weaker ? (foe.stunned || foe.facing !== -dir) : (foe.busy || foe.facing !== -dir || gap > ramLen * 2.2);
          // its own beam charging out of line: don't hand it a clash we'd lose
          if (meets && safe && !(foe.beam && !foe.beam.launched)) { fire(aim); return I; }
        }
        if (protect) {
          // keep it at arm's length; let it come to us
          if (gap < ramLen * 0.75) I.want = -dir;
          return I;
        }
        if (gap > sweetHi) {
          I.want = dir;
          if (can('Dash') && me.grounded && gap > sweetHi + 4.5 && Math.random() < 0.15) I.dash = true;
          return I;
        }
        // in the sweet spot, ram cooling: hover here, facing it
        if (blocked && me.grounded) { jump(); I.want = dir; }
        return I;
      };
    },
  };
})();
