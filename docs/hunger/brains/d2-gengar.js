// d2-gengar: "The Grinning Shadow" — a Gengar that keeps beam range, wins clashes with Moongeist Beam, and turns every
// committed blow back with Sucker Punch. Reads the game, returns intents; changes nothing.
window.__brains = window.__brains || {};
window.__brains['d2-gengar'] = {
  name: 'The Grinning Shadow',
  species: 'Gengar',
  kit: { ranged: 'Moongeist Beam', close: 'Shadow Claw', control: 'Sucker Punch' },
  strategy: 'Hold Moongeist Beam range and fire only into openings; meet beams with a clash when it wins, else brace Sucker Punch to turn committed blows back at 1.5x; ignore Normal/Fighting moves entirely (Ghost immunity), claw anything that gets close.',
  make({ me, foe, arena, Fighter, consts, memory }) {
    const C = consts;
    const AIM_ANGLE = C.AIM_ANGLE, AIM_MIN = C.AIM_MIN;
    const RANGED = me.moves.ranged, CLOSE = me.moves.close, CONTROL = me.moves.control;
    const hasSP = CONTROL === 'Sucker Punch' || CONTROL === 'Counter' || CONTROL === 'Detect';
    const BEAM_CHARGE = 1.1, BALL_CHARGE = 1.0, FRONT_TIME = 0.6;
    const CLASH_MIN = (11 * 0.94) / 2 * 0.6;      // ≈ 3.1: nearer than this, a point-blank burst
    const QUAKE_R = (11 * 0.94) / 2 * 1.1;        // ≈ 5.7
    const FEINT_RANGE = 5;
    const WALL = 10.6;                             // arena edge (x ±11, a little inside)

    // Memory: what each foe species did to us (for the organiser's logs and later rounds).
    const rec = (memory[foe.name] = memory[foe.name] || { fights: 0, kit: null, braces: 0, clashes: 0 });
    rec.fights++; rec.kit = { ...foe.moves };

    const st = {
      aimLock: 0, lastFoeBraced: false, punishTill: -1, lastT: 0,
      jumpTill: -1, holdJumpTill: -1, lastCloseT: -10,
    };

    const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
    const dmgOnMe = (move) => (move ? safe(() => foe.damageTo(move, me), 1) : 0);
    const dmgOnFoe = (move) => (move ? safe(() => me.damageTo(move, foe), 1) : 0);
    const isRam = (m) => !!m && safe(() => C.isRamMove(m), false);
    const isQuick = (m) => !!m && safe(() => C.isQuickStrike(m), false);
    const isBall = (m) => !!m && safe(() => C.isBall(m), false);
    const BEHIND = new Set(['Shadow Sneak', 'Feint', 'Sucker Punch']);
    const braceReady = () => hasSP && me.ready(CONTROL) && !me.countering;
    // A brace only worth it against what hurts us (Normal and Fighting pass straight through a Ghost — and would waste it).
    const braceWorth = (move) => braceReady() && dmgOnMe(move) > 0 && (CONTROL !== 'Counter' || safe(() => me.setsOff(move), false));

    const IDLE = { want: 0, aim: 0, jumpHeld: false, jumpPressed: false, sink: false, ranged: false, close: false, mobility: false, control: false, dash: false };
    const out = (o) => Object.assign({}, IDLE, o);

    // Exact aim (−1 … 1) from our mouth to the foe's body middle, toward `dir`.
    const aimAt = (dir) => {
      const [mx, my] = me.mouth();
      const want = Math.atan2(foe.y + foe.H * 0.5 - my, Math.max(0.05, Math.abs(foe.x - mx)));
      return clamp(want / AIM_ANGLE, -1, 1);
    };
    const lineDir = (dir, a) => [dir * Math.cos(a * AIM_ANGLE), Math.sin(a * AIM_ANGLE)];
    const lineMeets = (dir, a, range) => {
      const from = me.mouth();
      return Fighter.lineMeets(from, lineDir(dir, a), range, foe);
    };
    const walledAt = (dir, a, range) => safe(() => Fighter.pillarAlong(arena, me.mouth(), lineDir(dir, a), range), null);

    // Should a clash with the foe's charging beam/ball go our way? (power × type; our timing assumed good.)
    const clashGood = (theirMove) => {
      if (!RANGED || !theirMove) return { ok: false, gain: 0 };
      const a = safe(() => me.clashTerms(RANGED, theirMove), null), b = safe(() => foe.clashTerms(theirMove, RANGED), null);
      if (!a || !b) return { ok: false, gain: 0 };
      const outright = a.P >= b.P && a.E >= b.E && (a.P > b.P || a.E > b.E);
      const lose = b.P >= a.P && b.E >= a.E && (b.P > a.P || b.E > a.E);
      if (lose) return { ok: false, gain: 0 };
      const r = (a.P * a.E * 1.9) / Math.max(1e-6, b.P * b.E * 1.6);
      const ok = outright || r > 1.2;
      return { ok, gain: ok ? dmgOnFoe(RANGED) * 1.8 : 0 };
    };

    // The foe's damaging gap-closers ready now, and how far they reach (centre to centre, world units).
    const foeContactReach = () => {
      let r = 0;
      const k = foe.moves;
      if (k.close && k.close !== 'Earthquake' && k.close !== 'Stone Edge' && foe.ready(k.close) && dmgOnMe(k.close) > 0) {
        r = Math.max(r, isRam(k.close) ? 3.2 * foe.H + 0.6 : foe.H * C.CLOSE_REACH * 1.45 + 0.4);
      }
      if (k.close === 'Earthquake' && foe.ready('Earthquake') && dmgOnMe('Earthquake') > 0) r = Math.max(r, QUAKE_R);
      if (k.mobility && foe.ready(k.mobility)) {
        if (isQuick(k.mobility) && dmgOnMe(k.mobility) > 0) r = Math.max(r, C.QUICK_DIST * foe.H + 0.6);
        if (BEHIND.has(k.mobility) && dmgOnMe(k.mobility) > 0) r = Math.max(r, FEINT_RANGE * foe.H);
      }
      return r;
    };

    return (t) => {
      if (me.down || foe.down) return out({ face: sgn(foe.x - me.x) || me.facing });
      const dx = foe.x - me.x, dir = sgn(dx) || me.facing, dist = Math.abs(dx);
      const dy = foe.y - me.y;
      const aim = aimAt(dir);

      // ── In a clash: stop our needle near the top. ──
      if (me.clashing) {
        const n = safe(() => me.clashing.needle(), null);
        if (n === null || safe(() => me.clashing.stopped(), null) !== null) return out({ face: dir });
        return out({ face: dir, ranged: n >= 0.955 });
      }

      // ── Aiming / in a move: keep the locked aim (a bot's line fires as it gets there). ──
      if (me.aiming) return out({ face: dir, aim: st.aimLock });
      if (me.busy) return out({ face: dir, aim: st.aimLock, jumpHeld: t < st.holdJumpTill });

      // The foe's brace: waited out, then punished while it cools.
      if (st.lastFoeBraced && !foe.countering) st.punishTill = t + 1.6;
      st.lastFoeBraced = foe.countering;
      const foeBraced = foe.countering;
      const facingFoe = me.facing === dir;
      const jumping = t < st.holdJumpTill;
      const base = { face: dir, aim, jumpHeld: jumping };

      // ════ Defence: what is coming at us? ════
      // 1) A beam or ball charging / pouring at us.
      const fb = foe.beam || foe.ballCharge;
      if (fb && foe.facing === -dir) {
        const inLine = safe(() => Fighter.lineMeets(fb.from, fb.dir, (fb.range || 8) + 0.6, me) !== null, false)
          || fb.at === me;
        const theirMove = fb.move;
        const hurts = dmgOnMe(theirMove) > 0;
        if (inLine && hurts) {
          const pace = safe(() => foe.paceOf(theirMove), 1) || 1;
          if (!fb.launched) {
            const charge = foe.ballCharge && fb === foe.ballCharge ? BALL_CHARGE : BEAM_CHARGE;
            const elapsed = foe.time - fb.pressedAt;
            const eta = (charge - elapsed) + 0.4 * FRONT_TIME / pace;
            const cg = clashGood(theirMove);
            const spGain = braceReady() ? 1.5 * dmgOnMe(theirMove) : 0;
            // Clash: our beam ready, far enough apart, early enough to fire before theirs launches.
            const canClash = cg.ok && RANGED && me.ready(RANGED) && dist > CLASH_MIN + 0.4 && (charge - elapsed) > AIM_MIN + Math.abs(aim) / C.AIM_RATE + 0.15
              && Math.abs(dy) < me.H * 1.2;
            if (canClash && cg.gain >= spGain * 0.9) {
              st.aimLock = aim; rec.clashes++;
              return out({ ...base, ranged: true, aim });
            }
            if (spGain > 0 && eta <= 0.85) { rec.braces++; return out({ ...base, control: true }); }
            if (spGain > 0) return out({ ...base });           // hold still, brace at the right beat
            if (canClash) { st.aimLock = aim; return out({ ...base, ranged: true, aim }); }
            // No brace, no clash: out of its way — up as it arrives.
            if (eta <= 0.45 && me.grounded) { st.holdJumpTill = t + 0.55; return out({ ...base, jumpPressed: true, jumpHeld: true, want: -dir }); }
            return out({ ...base, want: -dir });
          } else if (fb.pouring !== false && !(fb.struck && fb.struck.has && fb.struck.has(me))) {
            if (braceWorth(theirMove)) { rec.braces++; return out({ ...base, control: true }); }
            if (me.grounded) { st.holdJumpTill = t + 0.55; return out({ ...base, jumpPressed: true, jumpHeld: true }); }
          }
        }
      }
      // 2) A ball in flight at us.
      const ball = (foe.balls || []).find((b) => {
        if (!b.launched || b.done || !b.play || !b.play.position) return false;
        const p = safe(() => b.play.position(), null);
        if (!p) return false;
        const ahead = (me.x - p.x) * (sgn(me.x - foe.x) || 1);
        return b.homing === me || (ahead > -me.H * 0.3 && ahead < 3.0 && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H);
      });
      if (ball && dmgOnMe(ball.move) > 0) {
        if (braceWorth(ball.move)) { rec.braces++; return out({ ...base, control: true }); }
        if (!ball.homing && me.grounded) { st.holdJumpTill = t + 0.5; return out({ ...base, jumpPressed: true, jumpHeld: true }); }
      }
      // 3) Contact blows committed toward us.
      const fu = foe.using || '';
      const foeRam = foe.ramming;
      const closeReach = foe.H * C.CLOSE_REACH * 1.45 + me.reachOf().back + 0.4;
      let blow = null;
      if (foeRam && (foeRam.dir === undefined || foeRam.dir === -dir || sgn(me.x - foe.x) === foeRam.dir) && dist <= 3.2 * foe.H + 1.5 && Math.abs(dy) < me.H * 1.2) blow = foeRam.move;
      else if (foe.quick && (isQuick(fu) || BEHIND.has(fu)) && fu !== 'Sucker Punch' && dist <= C.QUICK_DIST * foe.H + 1.2) blow = fu;
      else if (foe.firing && fu && fu === foe.moves.close && fu !== 'Earthquake' && dist <= closeReach + 0.6) blow = fu;
      else if (foe.telling && foe.telling !== foe.moves.ranged && !(C.BRACES && C.BRACES.has(foe.telling))
        && foe.telling !== 'Growl' && foe.telling !== 'Smokescreen') {
        const tm = foe.telling;
        const reach = isRam(tm) ? 3.2 * foe.H + 1 : isQuick(tm) ? C.QUICK_DIST * foe.H + 1 : BEHIND.has(tm) ? FEINT_RANGE * foe.H : tm === 'Earthquake' ? QUAKE_R : closeReach;
        if (dist <= reach) blow = tm;
      }
      if (blow && dmgOnMe(blow) > 0) {
        if (braceWorth(blow)) { rec.braces++; return out({ ...base, control: true }); }
        if (blow !== 'Earthquake') {
          // No brace: claw first if it's right on us (contact cuts contact), else back dash out.
          if (CLOSE && me.ready(CLOSE) && facingFoe && dist <= me.H * 1.35 + foe.H * 0.3 && dmgOnFoe(CLOSE) > 0 && !foeBraced) return out({ ...base, close: true, aim: 0 });
          if (me.grounded && me.ready('Back Dash') && facingFoe && Math.abs(me.x - dir * 2.5 * me.H) < WALL) return out({ ...base, want: 0, dash: true });
          if (me.grounded) { st.holdJumpTill = t + 0.5; return out({ ...base, jumpPressed: true, jumpHeld: true, want: -dir }); }
        }
      }
      // 3b) Priority dashes are too fast to react to (Lucario's Bullet Punch chip): inside its reach, facing us, free
      // and ready — sometimes brace first, so a dash spam walks into Sucker Punch.
      const qm = foe.moves.mobility;
      if (qm && isQuick(qm) && foe.ready(qm) && dmgOnMe(qm) > 0 && braceReady() && !foe.busy && foe.facing === -dir
        && dist <= C.QUICK_DIST * foe.H + 0.8 && dist > me.H * 0.8 && Math.abs(dy) < me.H && Math.random() < 0.05) {
        rec.braces++; return out({ ...base, control: true });
      }
      // 4) Earthquake / Stone Edge.
      if (fu === 'Earthquake' && dmgOnMe('Earthquake') > 0 && dist <= QUAKE_R + 0.8) {
        if (braceWorth('Earthquake')) { rec.braces++; return out({ ...base, control: true }); }
        if (me.grounded) { st.holdJumpTill = t + 0.7; return out({ ...base, jumpPressed: true, jumpHeld: true }); }
        return out({ ...base, jumpHeld: true });
      }
      if (fu === 'Stone Edge' && foe.firing && dmgOnMe('Stone Edge') > 0) {
        if (braceWorth('Stone Edge')) { rec.braces++; return out({ ...base, control: true }); }
        if (me.grounded) { st.holdJumpTill = t + 0.6; return out({ ...base, jumpPressed: true, jumpHeld: true }); }
      }

      // ════ Offence ════
      const myShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp;
      const coast = t > 138 && myShare > foeShare + 0.03;           // ahead near the 150 s bell: don't gamble
      const punishing = t < st.punishTill;
      const foeWaits = foeBraced && !punishing;
      const threatR = foeContactReach();
      const foeHelpless = foe.stunned || (foe.busy && !foe.ramming && !foe.quick && !(foe.firing && fu === foe.moves.close)
        && !foe.countering);
      const myReachClose = me.H * 1.3 + foe.H * 0.35;

      // Close: claw anything in reach.
      if (CLOSE && me.ready(CLOSE) && dist <= myReachClose && Math.abs(dy) < me.H * 0.9 && dmgOnFoe(CLOSE) > 0
        && !(foeBraced && safe(() => foe.setsOff(CLOSE), true)) && !coast) {
        if (facingFoe) { st.aimLock = clamp(dy / (me.H * 1.5), -1, 1); return out({ ...base, close: true, aim: st.aimLock }); }
        return out({ ...base });  // turn first
      }

      // Beam: the line meets, nothing between, not into a brace, and no damaging blow can land on us mid-charge.
      const range = me.beamRange || 8;
      const meets = RANGED && lineMeets(dir, aim, range) !== null;
      const wall = meets ? walledAt(dir, aim, Math.min(dist + 1, range)) : null;
      const walled = wall !== null && wall < dist - foe.reachOf().front;
      const braceBlocks = foeBraced && safe(() => foe.setsOff(RANGED), true);
      const gapToThreat = dist - threatR;
      const safeToCharge = foeHelpless || threatR === 0 || gapToThreat > (foe.facing === -dir ? 0.5 : -1.0)
        || (foe.aiming || (foe.beam && !foe.beam.launched) || foe.ballCharge); // their charge → a clash, decided above
      const foeOwnFbHarmless = fb && dmgOnMe(fb.move) === 0;
      // A harmless beam still charging: wait for it to launch (then it's rooted, pouring nothing on us) — no 0 × 0 clash.
      const harmlessCharging = fb && foeOwnFbHarmless && !fb.launched;
      // It is aiming something that would beat ours in a clash: don't feed it one.
      const badClashComing = foe.aiming && foe.moves.ranged && dmgOnMe(foe.moves.ranged) > 0 && !clashGood(foe.moves.ranged).ok;
      if (meets && !walled && !braceBlocks && !harmlessCharging && !badClashComing && me.ready(RANGED) && dist > 2.2 && (safeToCharge || foeOwnFbHarmless)
        && (!coast || gapToThreat > 3)) {
        st.aimLock = aim;
        return out({ ...base, ranged: true, aim });
      }

      // ════ Movement: hold beam range ════
      // Ideal: beyond its gap-closers, inside our beam's reach, and angled so a flier stays inside our aim cone.
      const coneDx = Math.abs(dy) > 0.3 ? (Math.abs(dy) + 0.3) / Math.tan(AIM_ANGLE * 0.9) : 0;
      let lo = Math.max(CLASH_MIN + 0.6, threatR + 0.6, coneDx, 3.6);
      let hi = Math.max(lo + 1.2, range - 0.6);
      if (lo > range - 0.8) { lo = range - 1.6; hi = range - 0.4; }
      if (coast) { lo = Math.max(lo, 6.5); hi = Math.max(hi, 9); }
      const backRoom = dir > 0 ? me.x + WALL : WALL - me.x;      // room behind us (away from the foe)
      let want = 0, jumpPressed = false, dash = false;
      if (dist < lo) {
        if (backRoom > 1.2) {
          // Back away — facing it with a back dash when it presses in, else run.
          if (dist < lo - 1.2 && me.ready('Back Dash') && me.grounded && facingFoe && backRoom > 2.6 * me.H) { dash = true; want = 0; }
          else want = -dir;
        } else if (dist < 2.6 && foe.grounded && !foe.flying && me.grounded && !foeBraced && (!braceReady() || threatR === 0)) {
          // Cornered: over its head to the open side.
          want = dir; jumpPressed = true; st.holdJumpTill = t + 0.6;
        } else {
          want = 0; // stand: brace / claw handle it
        }
      } else if (dist > hi) {
        want = dir;
        if (dist > hi + 4 && me.ready('Dash') && me.grounded && !coast) dash = true;
      }
      // A pillar between: Ghosts pass through — walk on in to a clear line.
      if (walled && dist > lo) want = dir;
      // Foe high above us and close: step out from under it.
      if (dy > me.H * 1.2 && dist < coneDx) want = -dir;
      // Waiting out a brace: just keep range.
      if (foeWaits && dist < lo + 0.5 && backRoom > 1.2) want = -dir;

      return out({ face: dir, want, aim, dash, jumpPressed, jumpHeld: jumping || jumpPressed });
    };
  },
};
