// Hunger Games tribute: Garchomp (Dragon/Ground) — "Landshark".
// Reads the game, returns intents. Never writes to any game object.
(() => {
  const SLUG = 'd4-garchomp';
  window.__brains = window.__brains || {};
  window.__brains[SLUG] = {
    name: 'Landshark',
    species: 'Garchomp',
    kit: { ranged: 'Dragon Energy', close: 'Dragon Rush', control: 'Counter' },
    strategy: 'Counter every committed physical ram/jet just before it lands (2x back), never bracing on bait; '
      + 'no tells, constant pressure: Dragon Rush from max run-up (knocks the foe back to ram range again), '
      + 'Dragon Energy at range and to win beam clashes (Hydro Cannon loses to it outright). '
      + 'Rams through charging beams, waits out enemy braces, ignores Electric (immune).',

    make({ me, foe, arena, Fighter, consts }) {
      const C = consts || {};
      const AIM_ANGLE = C.AIM_ANGLE ?? 0.6;
      const AIM_MIN = C.AIM_MIN ?? 0.25;
      const AIM_RATE = C.AIM_RATE ?? 2.2;
      const RAM_DIST = C.RAM_DIST ?? 3.2;
      const QUICK_DIST = C.QUICK_DIST ?? 3.2;
      const isRam = (m) => { try { return !!m && !!C.isRamMove?.(m); } catch { return false; } };
      const isQuick = (m) => { try { return !!m && !!C.isQuickStrike?.(m); } catch { return false; } };
      const isBallMove = (m) => { try { return !!m && !!C.isBall?.(m); } catch { return false; } };
      const BEHIND = new Set(['Shadow Sneak', 'Feint', 'Sucker Punch', 'Counter']);
      const BEAM_CHARGE = 1.1;
      const CLASH_MIN = (11 * 0.94) / 2 * 0.6 + 0.35; // centre to centre, with a margin
      const K = me.moves || {};
      const RANGED = K.ranged, CLOSE = K.close, MOB = K.mobility, CTRL = K.control;

      const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const dmg = (by, move, on) => { try { return move ? by.damageTo(move, on) : 0; } catch { return 0; } };
      const ready = (m) => { try { return !!m && me.ready(m); } catch { return false; } };

      // Gap between a's front and b's near side, along a → b (a assumed to face b).
      const gapOf = (a, b) => {
        const d = sgn(b.x - a.x) || a.facing;
        const [lo, hi] = b.span();
        const fr = a.reachOf().front;
        return d > 0 ? lo - (a.x + fr) : (a.x - fr) - hi;
      };
      const levelWith = (a, b, slack = 0) => b.y < a.y + a.H * (0.92 + slack) && b.y + b.H > a.y + 0.05;

      // State of this battle (my own, never the game's).
      const S = {
        aimLock: 0, aimFaceDir: 1, prevNeedle: null, clashSeen: null,
        jumpUntil: -1, foeBraced: false, punishTill: -1,
        clashWins: 0, clashLosses: 0,
      };

      // Foe's damage potential against me.
      const foeRangedHurts = dmg(foe, foe.moves?.ranged, me) > 0;
      const foeCloseHurts = dmg(foe, foe.moves?.close, me) > 0;
      const foeMobHurts = dmg(foe, foe.moves?.mobility, me) > 0;
      const esHurts = dmg(me, MOB, foe) > 0 && isQuick(MOB);
      const ramHurts = dmg(me, CLOSE, foe) > 0;
      const beamHurts = dmg(me, RANGED, foe) > 0;

      const foeContactReach = () => {
        let r = 0;
        try {
          if (foe.moves.close && foe.moves.close !== 'Earthquake' && foe.moves.close !== 'Stone Edge') r = Math.max(r, foe.reachWith(foe.moves.close) - foe.reachOf().front);
          if (foe.moves.mobility && (isQuick(foe.moves.mobility) || BEHIND.has(foe.moves.mobility))) r = Math.max(r, isQuick(foe.moves.mobility) ? QUICK_DIST * foe.H : 5 * foe.H);
        } catch { r = 3; }
        return r;
      };

      // The aim (−1..1) whose line from my mouth meets `target` within `range`, nearest the straight line to it; null: none.
      const aimAt = (target, range) => {
        const from = me.mouth();
        const want = Math.atan2(target.y + target.H * 0.5 - from[1], Math.abs(target.x - from[0]));
        const cands = [];
        for (let i = -10; i <= 10; i++) cands.push(i / 10);
        cands.sort((p, q) => Math.abs(p * AIM_ANGLE - want) - Math.abs(q * AIM_ANGLE - want));
        for (const a of cands) {
          const dir = me.aimDir(a);
          const d = Fighter.lineMeets(from, dir, range, target);
          if (d === null) continue;
          const wall = Fighter.nearer(Fighter.pillarAlong(arena, from, dir, range), Fighter.groundAlong(arena, from, dir, range));
          if (wall === null || d < wall) return a;
        }
        return null;
      };

      // The aim whose line meets the foe's charging line (a clash), nearest to pointing at its mouth.
      const clashAim = (fb) => {
        const from = me.mouth();
        const [fx, fy] = foe.mouth();
        const span = Math.hypot(fx - from[0], fy - from[1]) + foe.H;
        const want = Math.atan2(fy - from[1], Math.abs(fx - from[0]));
        const cands = [];
        for (let i = -10; i <= 10; i++) cands.push(i / 10);
        cands.sort((p, q) => Math.abs(p * AIM_ANGLE - want) - Math.abs(q * AIM_ANGLE - want));
        for (const a of cands) {
          if (Fighter.linesMeet(from, me.aimDir(a), span, fb.from, fb.dir, span, (me.H + foe.H) * 0.25)) return a;
        }
        return null;
      };

      // Would my beam win a clash against `move`?
      const clashGood = (move) => {
        try {
          const mine = me.clashTerms(RANGED, move), theirs = foe.clashTerms(move, RANGED);
          const ahead = (p, q) => p.P >= q.P && p.E >= q.E && (p.P > q.P || p.E > q.E);
          if (ahead(theirs, mine)) return false;
          if (ahead(mine, theirs)) return true;
          const ratio = (mine.P * mine.E) / Math.max(1e-6, theirs.P * theirs.E);
          // Learned: lost clashes against this one raise the bar.
          const need = S.clashLosses > S.clashWins ? 1.25 : 0.95;
          return ratio >= need;
        } catch { return false; }
      };

      const pillarsBetween = (dir, dist) => {
        const list = (arena.pillars || []).map((p) => p.plat).filter(Boolean);
        return list.filter((pl) => {
          const near = dir > 0 ? pl.x - me.x : me.x - (pl.x + pl.w);
          return near > -0.2 && near < dist && pl.top > me.y + 0.25;
        }).sort((a, b) => (dir > 0 ? a.x - b.x : b.x - a.x));
      };

      const think = (t) => {
        const now = me.time;
        const dx = foe.x - me.x, dir = sgn(dx) || me.facing, dist = Math.abs(dx);
        const dy = foe.y - me.y;
        const facingFoe = me.facing === dir;
        let I = { want: 0, face: dir, aim: 0, jumpPressed: false, jumpHeld: now < S.jumpUntil, sink: false,
          ranged: false, close: false, mobility: false, control: false, dash: false };
        const jump = () => { I.jumpPressed = true; I.jumpHeld = true; S.jumpUntil = now + 0.35; };

        if (me.down || foe.down) return { ...I, jumpHeld: false };

        // ── In a clash: stop my number at the top of its run.
        if (me.clashing) {
          let n = null, stopped = null, outcome = null;
          try { n = me.clashing.needle(); stopped = me.clashing.stopped(); outcome = me.clashing.outcome(); } catch { /* */ }
          if (outcome !== null && S.clashSeen !== 'done') {
            if (outcome > 0) S.clashWins++; else if (outcome < 0) S.clashLosses++;
            S.clashSeen = 'done';
          } else if (outcome === null) S.clashSeen = 'on';
          if (n !== null && stopped === null) {
            const falling = S.prevNeedle !== null && n < S.prevNeedle;
            if (n >= 0.965 || (falling && S.prevNeedle >= 0.9)) I.ranged = true;
          }
          S.prevNeedle = n;
          return { ...I, aim: me.aim };
        }
        S.prevNeedle = null; S.clashSeen = null;

        // ── Aiming my beam: hold the locked aim so it fires as soon as the line gets there.
        if (me.aiming) return { ...I, aim: S.aimLock, face: S.aimFaceDir };

        if (me.busy) return I;

        // ── Read the foe.
        const gap = gapOf(me, foe);
        const foeGap = gapOf(foe, me);
        const level = levelWith(me, foe);
        const ramRun = RAM_DIST * me.H;
        const quickRun = QUICK_DIST * me.H;
        const backWall = Math.abs(me.x - (-dir) * 11) ; // distance to the wall behind me
        const cornered = (-dir > 0 ? 11 - me.x : me.x + 11) < 2.2;
        void backWall;

        // Foe's brace: waited out; once over (its cooldown running), punished.
        const fctrl = foe.moves?.control;
        if (S.foeBraced && !foe.countering && fctrl && !foe.ready(fctrl)) S.punishTill = now + 2.5;
        S.foeBraced = foe.countering;

        // Foe's beam / charging ball, and whether its line is on me.
        const fb = foe.beam || foe.ballCharge;
        let beamOnMe = false, launchIn = 99, beamMove = '';
        if (fb && foeRangedHurts) {
          const range = (fb.launched ? (fb.reach ?? fb.range) : Math.max(fb.range, 1)) + 0.6;
          beamOnMe = Fighter.lineMeets(fb.from, fb.dir, range, me) !== null;
          launchIn = fb.launched ? 0 : Math.max(0, BEAM_CHARGE - (foe.time - fb.pressedAt));
          beamMove = fb.move;
        }
        // Foe aiming at me (its line on me).
        let aimingAtMe = false;
        if (foe.aiming && foeRangedHurts) {
          try { aimingAtMe = Fighter.lineMeets(foe.mouth(), foe.aimDir(foe.aiming.aim), foe.beamRange + 0.6, me) !== null || Math.abs(dy) < me.H; } catch { aimingAtMe = true; }
        }
        // A ball flying at me.
        let ballAtMe = null;
        if (foeRangedHurts) {
          for (const b of foe.balls || []) {
            if (!b.launched || b.done || !b.play?.position) continue;
            const p = b.play.position();
            const ahead = (me.x - p.x) * (sgn(me.x - foe.x) || 1);
            if (b.homing === me || (ahead > -me.H * 0.3 && ahead < 3.4 && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H)) { ballAtMe = b; break; }
          }
        }
        // A contact blow coming at me.
        let blow = '';
        const r = foe.ramming;
        if (r && foeCloseHurts && r.dir === (sgn(me.x - foe.x) || r.dir) && levelWith(foe, me, 0.1) && foeGap <= RAM_DIST * foe.H - (r.ran || 0) + 0.8) blow = 'ram';
        else if (foe.quick && foe.using && (isQuick(foe.using) || BEHIND.has(foe.using)) && foeMobHurts && dist <= QUICK_DIST * foe.H + 2.5) blow = 'quick';
        else if (foe.firing && foe.using && foe.using === foe.moves?.close && foe.using !== 'Earthquake' && foe.using !== 'Stone Edge' && foeCloseHurts) {
          let reach = 2; try { reach = foe.reachWith(foe.using); } catch { /* */ }
          if (dist <= reach + me.reachOf().back + 0.4 && Math.abs(dy) < me.H) blow = 'melee';
        } else if (foe.telling && (isRam(foe.telling) || isQuick(foe.telling) || foe.telling === foe.moves?.close) && foe.telling !== 'Earthquake' && foe.telling !== 'Stone Edge') {
          let reach = 2; try { reach = foe.reachWith(foe.telling); } catch { /* */ }
          if (foeGap <= reach - foe.reachOf().front + 0.5) blow = 'tell';
        }

        const canDetect = CTRL === 'Detect' && ready('Detect') && !me.countering;
        const canCounter = CTRL === 'Counter' && ready('Counter') && !me.countering;
        const canRam = CLOSE && ramHurts && isRam(CLOSE) && ready(CLOSE) && me.grounded && facingFoe;
        const ramWalled = Fighter.pillarAlong(arena, [me.x, me.y + me.H * 0.4], [dir, 0], dist) !== null;
        const foeRetreating = sgn(foe.vx) === dir && Math.abs(foe.vx) > 2;
        const ramInReach = canRam && level && !ramWalled && gap > -me.H * 0.6 && gap <= ramRun * (foeRetreating ? 0.72 : 0.93);
        const esReady = MOB && esHurts && ready(MOB) && facingFoe && (me.grounded || me.flying || !S.usedAirES);
        if (me.grounded) S.usedAirES = false;
        // Extreme Speed: level, or tilted up off the ground / along the aim aloft. Returns the aim to use, or null.
        const esAim = () => {
          if (!esReady) return null;
          const g = Math.max(0, gap);
          if (g > quickRun * 0.95) return null;
          const tryAim = (a) => {
            const tilt = (!me.grounded || a > 0) ? a * AIM_ANGLE : 0;
            const ux = Math.cos(tilt), uy = Math.sin(tilt);
            const along = g / Math.max(ux, 0.2);
            if (along > quickRun) return false;
            const y = Math.max(0, me.y + uy * along);
            return foe.y < y + me.H * 0.95 && foe.y + foe.H > y + 0.05;
          };
          if (tryAim(0)) return 0;
          const want = Math.atan2(dy + foe.H * 0.3, Math.max(0.3, g)) / AIM_ANGLE;
          const lo = me.grounded ? 0 : -1;
          for (const a of [clamp(want, lo, 1), 0.3, 0.5, 0.7, 1, -0.3, -0.6]) if (a >= lo && tryAim(a)) return a;
          return null;
        };
        const canBeam = RANGED && beamHurts && ready(RANGED) && facingFoe && (me.grounded || me.flying);
        const fireBeam = (a) => { S.aimLock = a; S.aimFaceDir = dir; I.ranged = true; I.aim = a; };
        const doRam = () => { I.close = true; I.want = 0; };
        const doES = (a) => { I.mobility = true; I.aim = a; I.want = 0; if (!me.grounded) S.usedAirES = true; };

        // ── 1. A blow coming at me.
        if (blow) {
          const bm = (r && r.move) || foe.using || foe.telling || '';
          let phys = false; try { phys = C.getMove?.(bm)?.category === 'physical' || String(C.getMove?.(bm)?.category).toLowerCase() === 'physical'; } catch { /* */ }
          // Counter: a physical blow turned back twice over — braced just before it lands (its window 1 s).
          if (canCounter && phys) {
            let arrive = 0;
            if (blow === 'ram') arrive = (r.go ? 0 : 0.35) + Math.max(0, foeGap) / 13;
            if (arrive < 0.8) { I.control = true; return I; }
            return I; // committed ram on its way: stand braced-ready, start nothing
          }
          if (blow === 'melee' && canRam && level) { doRam(); return I; }
          // Detect: only for blows worth it (no wasting it on a cheap Aqua Jet bait).
          if (canDetect && dmg(foe, bm, me) >= me.maxHp * 0.045) { I.control = true; return I; }
          if (blow === 'ram') {
            const left = RAM_DIST * foe.H - (r.ran || 0);
            if (!cornered && ready('Back Dash') && me.grounded && left < foeGap + 2.4 * me.H) { I.dash = true; I.want = 0; return I; }
            if (me.grounded) { jump(); return I; }
          }
          if (blow === 'melee' || blow === 'tell') {
            const ea = esAim();
            if (ea !== null && blow === 'melee') { doES(ea); return I; }
            if (!cornered && ready('Back Dash') && me.grounded) { I.dash = true; I.want = 0; return I; }
          }
        }

        // ── 2. A beam (or charging ball) on me.
        if (beamOnMe) {
          // Rooted while it charges: in at it — a contact blow cuts its attack off.
          if (launchIn > 0.05) {
            if (ramInReach) { doRam(); return I; }
            const ea = esAim(); if (ea !== null) { doES(ea); return I; }
            // Meet it: a clash I should win.
            const ctr = Math.hypot(foe.x - me.x, foe.y - me.y);
            if (canBeam && ctr >= CLASH_MIN && launchIn >= AIM_MIN + 0.12 && clashGood(beamMove)) {
              const a = clashAim(fb);
              if (a !== null && Math.abs(a) / AIM_RATE + AIM_MIN < launchIn - 0.05) { fireBeam(a); return I; }
            }
          }
          if (canDetect && launchIn <= 0.7) { I.control = true; return I; }
          // Dash in to ram before it launches.
          if (launchIn > 0.75 && canRam && level && !ramWalled && ready('Dash') && me.grounded && gap <= ramRun + 3.5) { I.dash = true; I.want = dir; return I; }
          if (launchIn <= 0.25) {
            if (!cornered && ready('Back Dash') && me.grounded && Math.abs(fb.dir[1]) < 0.35) { I.dash = true; I.want = 0; return I; }
            if (me.grounded) { jump(); I.want = -dir; return I; }
          }
        }

        // ── 3. A ball flying at me.
        if (ballAtMe) {
          if (ballAtMe.homing && canDetect) { I.control = true; return I; }
          if (!ballAtMe.homing && me.grounded) { jump(); I.want = dir; return I; }
        }

        // ── 4. Foe aiming at me (rooted): punish it.
        if (foe.aiming || (fb && !fb.launched)) {
          if (ramInReach) { doRam(); return I; }
          const ea = esAim(); if (ea !== null) { doES(ea); return I; }
          if (aimingAtMe && canRam && level && !ramWalled && ready('Dash') && me.grounded && gap > ramRun * 0.9 && gap <= ramRun + 4) { I.dash = true; I.want = dir; return I; }
        }

        // ── 5. Its brace up: wait it out (a beam is fine against Counter — it only turns physical blows).
        if (foe.countering) {
          if (fctrl === 'Counter' && canBeam && gap > 0.5) {
            const a = aimAt(foe, me.beamRange); if (a !== null) { fireBeam(a); return I; }
          }
          if (gap < 1.2 && !cornered) { I.want = -dir; return I; }
          return I;
        }

        // Its Detect/Sucker Punch ready, it is just standing there: our blows may be turned — still press, it costs it its brace.
        // ── 6. Attack.
        if (ramInReach) {
          // Point blank with Extreme Speed up: that first, the ram after (better run-up once pushed back).
          const ea = gap < ramRun * 0.2 ? esAim() : null;
          if (ea !== null) { doES(ea); return I; }
          doRam(); return I;
        }
        {
          const ea = esAim();
          // Extreme Speed when the ram is cooling, the foe out of the ram's line (aloft), or it is reeling.
          if (ea !== null && (!canRam || !level || foe.stunned || ramWalled)) { doES(ea); return I; }
        }
        if (canBeam && (me.grounded || me.flying)) {
          const fReach = foeContactReach();
          const foeThreat = !foe.stunned && !foe.busy && foeGap <= fReach + 1.6;
          const ramSoon = canRam || (CLOSE && (me.readyAt?.get?.(CLOSE) ?? 0) - now < 0.5);
          const out = !level || ramWalled || gap > ramRun * 0.95 || !ramSoon;
          if (!foeThreat && out) {
            const a = aimAt(foe, me.beamRange);
            if (a !== null) { fireBeam(a); return I; }
          }
        }

        // ── 7. Getting over Stone Edge pillars.
        if (ramWalled || pillarsBetween(dir, dist).length) {
          const pl = pillarsBetween(dir, dist)[0];
          I.want = dir;
          if (pl) {
            const near = dir > 0 ? pl.x - me.x : me.x - (pl.x + pl.w);
            if (me.grounded && near < 1.6) jump();
          } else if (me.grounded) jump();
          return I;
        }

        // ── 8. A foe high above (flying): get under it at an angle, jump and Extreme Speed up at it.
        if (dy > me.H * 1.1) {
          // Its flight about to run out (5 s cap): wait at a ram's run-up for it to drop — it can't take off for 3 s after.
          const left = typeof foe.flightLeft === 'number' ? foe.flightLeft : 99;
          if (left < 1.6 || (foe.vy < -3 && !foe.flying)) {
            const g = gap;
            if (g > ramRun * 0.85) I.want = dir;
            else if (g < ramRun * 0.55 && !cornered) I.want = -dir;
            return I;
          }
          const want = clamp(dy / Math.tan(0.5), 1.5, 4.0);
          if (dist > want + 0.6) I.want = dir;
          else if (dist < want - 0.8 && !cornered) I.want = -dir;
          if (I.want && I.want !== dir) I.face = 0;
          if (me.grounded && esReady && facingFoe && dy > 2.2 && dist < 6) jump();
          if (!me.grounded && esReady && facingFoe && me.vy < 2) {
            const ea = esAim(); if (ea !== null) { doES(ea); return I; }
          }
          return I;
        }

        // ── 9. Spacing: keep at a ram's run-up while the ram cools, close in while it is (nearly) ready.
        const ramCool = CLOSE ? Math.max(0, (me.readyAt?.get?.(CLOSE) ?? 0) - now) : 99;
        const punishing = now < S.punishTill;
        const foeMenace = !foe.stunned && (foe.moves?.close || foe.moves?.mobility) && (foeCloseHurts || foeMobHurts);
        if (ramCool < 0.35 || punishing) {
          if (gap > ramRun * 0.8) {
            I.want = dir;
            if (gap > ramRun + 2.5 && ready('Dash') && me.grounded && facingFoe && Math.random() < 0.08) I.dash = true;
          }
        } else if (gap < ramRun * 0.4 && foeMenace && !cornered) {
          if (ready('Back Dash') && me.grounded && gap < ramRun * 0.25) { I.dash = true; I.want = 0; }
          else I.want = -dir;
        } else if (gap > ramRun * 0.9) {
          I.want = dir;
          if (gap > ramRun + 3 && ready('Dash') && me.grounded && facingFoe && Math.random() < 0.05) I.dash = true;
        }
        return I;
      };

      return (t) => {
        let I = think(t);
        // Confused: the game turns every way round — turn them round first.
        if (me.confused && I) I = { ...I, want: -(I.want || 0), aim: -(I.aim || 0), face: I.face ? -I.face : I.face };
        return I;
      };
    },
  };
})();
