// The Iron Juggernaut — Metagross (Steel/Psychic). A read-only brain: it reads the fight and returns intents.
window.__brains = window.__brains || {};
window.__brains['d7-metagross'] = {
  name: 'The Iron Juggernaut',
  species: 'Metagross',
  kit: { ranged: 'Steel Beam', close: 'Giga Impact', mobility: 'Bullet Punch', control: 'Detect' },
  strategy: 'A bulky 135-Attack wall that walks through ranged fire: Giga Impact rams from full run-up (backing off for momentum), ' +
    'Bullet Punch to chase knockbacks and swat fliers, Steel Beam only when the foe cannot rush it (or to win a favourable clash), ' +
    'Detect for big incoming blows, jumps quakes/balls/rams, and never swings into a brace. Rams anyone who stands still to aim.',
  make({ me, foe, arena, Fighter, consts, memory }) {
    const { AIM_ANGLE, RAM_DIST, QUICK_DIST, isBall, isRamMove, isQuickStrike, isFlurry, getMove } = consts;
    const QUAKE_R = 5.7, CLASH_MIN = 3.2, WALL = 10.6;
    const RANGED = me.moves.ranged, CLOSE = me.moves.close, MOB = me.moves.mobility, CTRL = me.moves.control;
    const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const species = String(foe.name || '').replace(/ \(.*\)$/, '');
    const rec = (memory[species] = memory[species] || { battles: 0, contact: 0, ranged: 0 });
    rec.battles++;

    // ── type chart bits for beam clashes (move type vs move type) ──
    const VS_STEEL = { Fire: 2, Fighting: 2, Ground: 2, Normal: 0.5, Grass: 0.5, Ice: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5,
      Rock: 0.5, Dragon: 0.5, Steel: 0.5, Fairy: 0.5, Poison: 0 };
    const STEEL_VS = { Fire: 0.5, Water: 0.5, Electric: 0.5, Steel: 0.5, Ice: 2, Rock: 2, Fairy: 2 };
    const clashScore = (f, move, against) => {
      const m = getMove(move); if (!m) return 40;
      const stab = (f.types || []).includes(m.moveType) ? 1.5 : 1;
      const stat = String(m.category).toLowerCase() === 'physical' ? f.attack : f.spAtk;
      const e = against === 'Steel' ? (VS_STEEL[m.moveType] ?? 1) : m.moveType === 'Steel' ? (STEEL_VS[against] ?? 1) : 1;
      return m.basePower * stab * (stat / 100) * e;
    };
    const dmg = (move) => { try { return move ? me.damageTo(move, foe) : 0; } catch (e) { return 0; } };
    const foeDmg = (move) => { try { return move ? foe.damageTo(move, me) : 0; } catch (e) { return 60; } };

    let lockAim = 0, punishUntil = -1, foeBraced = false, lastLog = -1, backDashPlan = false;
    const idle = (face) => ({ want: 0, face, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
      ranged: false, close: false, mobility: false, control: false, dash: false });

    // A gap measured skin to skin along x (ram/quick contact uses bodies' spans).
    const spanGap = () => {
      const [lo, hi] = foe.span(); const front = me.reachOf().front;
      return foe.x >= me.x ? lo - (me.x + front) : (me.x - front) - hi;
    };
    const levelWith = () => foe.y < me.y + me.H * 0.95 && foe.y + foe.H > me.y + 0.05;
    const room = (d) => (d > 0 ? WALL - me.x : me.x + WALL);
    const pillarBetween = () => {
      const ps = arena && arena.pillars; if (!ps || !ps.length) return false;
      const lo = Math.min(me.x, foe.x), hi = Math.max(me.x, foe.x);
      return ps.some((p) => p && p.plat && p.plat.x + p.plat.w > lo + 0.2 && p.plat.x < hi - 0.2 && p.plat.top > me.y + 0.4);
    };
    // Best beam aim (−1 … 1) whose line meets the foe within range; null if none.
    const beamAim = () => {
      const from = me.mouth();
      const want = Math.atan2(foe.y + foe.H * 0.5 - from[1], Math.abs(foe.x - from[0])) / AIM_ANGLE;
      let best = null, bestD = Infinity;
      for (let a = -1; a <= 1.0001; a += 0.1) {
        const aa = Math.round(a * 10) / 10;
        if (Fighter.lineMeets(from, me.aimDir(aa), me.beamRange, foe) === null) continue;
        const d = Math.abs(aa - want);
        if (d < bestD) { bestD = d; best = aa; }
      }
      return best;
    };
    // How far the foe can lunge at us right now with something ready (world units, skin gap).
    const foeRush = () => {
      let r = 0;
      const c = foe.moves.close, m = foe.moves.mobility;
      if (c && foe.ready(c)) r = Math.max(r, isRamMove(c) ? RAM_DIST * foe.H : foe.H * 1.3);
      if (m && foe.ready(m)) {
        if (isQuickStrike(m)) r = Math.max(r, QUICK_DIST * foe.H);
        else if (m === 'Shadow Sneak' || m === 'Feint' || m === 'Teleport') r = Math.max(r, 5 * foe.H);
      }
      return r;
    };

    // What is coming at us now.
    const threat = () => {
      const toMe = sgn(me.x - foe.x) || 1, dist = Math.abs(foe.x - me.x);
      const out = { contact: null, beam: null, ball: null, quake: false, edge: false, aimingAtMe: false };
      const r = foe.ramming;
      if (r && r.dir === toMe && levelWith()) {
        const [lo, hi] = me.span(); const ff = foe.reachOf().front;
        const g = toMe > 0 ? lo - (foe.x + ff) : (foe.x - ff) - hi;
        out.contact = { move: r.move, eta: r.go ? g / 13 : 0.25 + g / 13, kind: 'ram', gap: g };
      } else if (foe.quick && foe.using && dist <= QUICK_DIST * foe.H + me.reachOf().back + foe.reachOf().front + 0.8) {
        out.contact = { move: foe.using, eta: 0.1, kind: 'quick', gap: 0 };
      } else if (foe.firing && foe.using && foe.using === foe.moves.close && foe.using !== 'Earthquake' && !isRamMove(foe.using)
        && dist <= foe.reachWith(foe.using) + me.reachOf().back + 0.4 && Math.abs(foe.y - me.y) < me.H * 1.2) {
        out.contact = { move: foe.using, eta: 0.15, kind: 'blow', gap: 0 };
      } else if (foe.telling && foe.telling === foe.moves.close && foe.telling !== 'Earthquake' && dist <= foe.reachWith(foe.telling) + me.reachOf().back + 0.4) {
        out.contact = { move: foe.telling, eta: 0.35, kind: 'tell', gap: 0 };
      }
      if (foe.using === 'Earthquake' || foe.telling === 'Earthquake') out.quake = dist <= QUAKE_R + 1;
      if (foe.using === 'Stone Edge' || foe.telling === 'Stone Edge') out.edge = true;
      const fb = foe.beam || foe.ballCharge;
      if (fb && fb.from && fb.dir) {
        const meets = Fighter.lineMeets(fb.from, fb.dir, (fb.range || 6) + 0.6, me) !== null;
        if (meets || (!fb.launched && foe.facing === toMe && Math.abs(foe.y - me.y) < me.H)) {
          out.beam = { move: fb.move, launched: !!fb.launched, age: foe.time - (fb.pressedAt ?? foe.time), meets, dirY: fb.dir[1] };
        }
      }
      if (foe.aiming && foe.facing === toMe) out.aimingAtMe = true;
      for (const b of foe.balls || []) {
        if (!b || !b.launched || b.done || !b.play || !b.play.position) continue;
        const p = b.play.position();
        const ahead = (me.x - p.x) * toMe;
        if (b.homing === me || (ahead > -me.H * 0.3 && ahead < 3.4 && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H)) { out.ball = { move: b.move, homing: b.homing === me, ahead }; break; }
      }
      return out;
    };

    // Turn first, act next frame (moves start before turning inside a step).
    const attack = (base, key, dir, aim = 0) => {
      if (me.facing !== dir) return { ...base, want: 0, face: dir, aim };
      return { ...base, want: 0, face: dir, aim, [key]: true };
    };

    return (t) => {
      const dx = foe.x - me.x, dir = sgn(dx) || me.facing, dist = Math.abs(dx), dy = foe.y - me.y;
      const base = idle(dir);
      if (me.down || foe.down) return base;

      // Clash: stop the needle near its top.
      if (me.clashing) {
        const n = me.clashing.needle ? me.clashing.needle() : null;
        if (n === null || (me.clashing.stopped && me.clashing.stopped() !== null)) return base;
        return { ...base, ranged: n >= 0.94 };
      }
      // Taking aim: keep the line on the foe.
      if (me.aiming) {
        const a = beamAim(); if (a !== null) lockAim = a;
        return { ...base, aim: lockAim };
      }

      // Foe's braces: wait them out, punish the whiff.
      if (foeBraced && !foe.countering) punishUntil = t + 0.6;
      foeBraced = foe.countering;
      const punishing = t < punishUntil;

      const th = threat();
      if (th.contact) rec.contact += 1 / 60; if (th.beam) rec.ranged += 1 / 60;

      // Airborne: keep the jump held to rise full height; land otherwise.
      const airHold = !me.grounded;
      if (me.busy) return { ...base, jumpHeld: airHold };

      const gap = spanGap();
      const H = me.H;
      const ramReach = RAM_DIST * H * 0.95;
      const quickReach = QUICK_DIST * H * 0.92;
      const giOK = CLOSE && me.ready(CLOSE) && dmg(CLOSE) > 0;
      const bpOK = MOB && me.ready(MOB) && dmg(MOB) > 0;
      const sbOK = RANGED && me.ready(RANGED) && dmg(RANGED) > 0;
      const detOK = CTRL === 'Detect' && me.ready(CTRL) && !me.countering;
      const level = levelWith();
      const walled = pillarBetween();
      const backDir = -dir;
      const canBackDash = me.grounded && me.ready('Back Dash') && room(backDir) > 2.6 * H + 0.5;

      // ── defence ──
      if (th.quake && me.grounded) return { ...base, jumpPressed: true, jumpHeld: true };
      if (th.quake) return { ...base, jumpHeld: true };
      if (th.edge && me.grounded) return { ...base, want: dir, jumpPressed: true, jumpHeld: true };

      if (th.contact) {
        const c = th.contact, hurtBy = foeDmg(c.move);
        // A ram still far: ram back if ours lands first, else wait for it to come close.
        if (c.kind === 'ram' && c.eta > 0.55) {
          if (giOK && level && gap <= ramReach && !foe.countering) return attack(base, 'close', dir);
        } else {
          if (detOK && hurtBy >= 90) return { ...base, control: true };
          if (c.kind === 'ram' && me.grounded) return { ...base, jumpPressed: true, jumpHeld: true, want: dir };
          if ((c.kind === 'blow' || c.kind === 'tell') && canBackDash) return { ...base, want: 0, dash: true };
          if (detOK) return { ...base, control: true };
        }
      }

      // The foe standing still to aim / charging a beam at us: hit it first (contact pushes through ranged fire).
      if (th.aimingAtMe || (th.beam && !th.beam.launched)) {
        if (giOK && level && gap <= ramReach && !walled && !foe.countering) return attack(base, 'close', dir);
        if (bpOK && gap <= quickReach && (level || dy > 0) && !foe.countering) return attack(base, 'mobility', dir, level ? 0 : 1);
        if (th.beam && sbOK && dist > CLASH_MIN + 0.4 && th.beam.age < 0.7 && me.facing === dir) {
          const mine = clashScore(me, RANGED, (getMove(th.beam.move) || {}).moveType);
          const theirs = clashScore(foe, th.beam.move, 'Steel');
          if (mine >= theirs * 1.1) { lockAim = beamAim() ?? 0; return { ...base, aim: lockAim, ranged: true }; }
        }
        if (th.beam && th.beam.meets && th.beam.age > 0.55) {
          if (detOK) return { ...base, control: true };
          if (me.grounded && Math.abs(th.beam.dirY) < 0.3) return { ...base, jumpPressed: true, jumpHeld: true };
        }
        // Close in on the rooted aimer.
        if (!walled && gap > ramReach * 0.8) {
          if (me.ready('Dash') && me.grounded && gap > ramReach + 1.5) return { ...base, want: dir, dash: true };
          return { ...base, want: dir };
        }
      }
      if (th.beam && th.beam.launched && th.beam.meets) {
        // Pouring at us: ram through it if we can, else get out of its line.
        if (giOK && level && gap <= ramReach && !walled) return attack(base, 'close', dir);
        if (bpOK && gap <= quickReach && level) return attack(base, 'mobility', dir);
        if (me.grounded && Math.abs(th.beam.dirY) < 0.35) return { ...base, jumpPressed: true, jumpHeld: true };
      }
      if (th.ball && !th.ball.homing && me.grounded && th.ball.ahead < 2.6) return { ...base, jumpPressed: true, jumpHeld: true, want: dir };
      if (th.ball && th.ball.homing && detOK && th.ball.ahead < 1.6 && foeDmg(th.ball.move) >= 120) return { ...base, control: true };

      // A brace up: don't swing into it.
      if (foe.countering && !punishing) {
        if (gap > ramReach * 0.9) return { ...base, want: dir, jumpHeld: airHold };
        return { ...base, jumpHeld: airHold };
      }

      // ── anti-air: a foe well above ──
      if (dy > H * 0.9) {
        if (bpOK && me.facing === dir) {
          const reach = QUICK_DIST * H;
          const yAbove = me.grounded ? 0 : 0;
          const ang = Math.atan2(dy + foe.H * 0.4 - yAbove, Math.max(0.1, dist));
          if (!me.grounded && ang <= AIM_ANGLE * 1.15 && Math.hypot(dist, dy) <= reach + 0.6) return { ...base, aim: 1, mobility: true, jumpHeld: true };
          if (me.grounded && dy < 3.2 + reach * Math.sin(AIM_ANGLE) && dist < reach * 1.1 && dist > 0.8) return { ...base, jumpPressed: true, jumpHeld: true };
          if (me.grounded && ang <= AIM_ANGLE && Math.hypot(dist, dy) <= reach) return { ...base, aim: 1, mobility: true };
        }
        if (sbOK && me.grounded) {
          const a = beamAim();
          if (a !== null && foeRush() < gap) { lockAim = a; return attack(base, 'ranged', dir, a); }
        }
        // Stand off at a slant it can be struck at.
        const wantDx = Math.max(1.6, dy * 1.45);
        if (dist > wantDx + 0.8) return { ...base, want: dir, jumpHeld: airHold };
        if (dist < wantDx - 0.8 && room(backDir) > 1.5) return { ...base, want: backDir, jumpHeld: airHold };
        return { ...base, jumpHeld: airHold };
      }

      // A pillar in the way: over it.
      if (walled && me.grounded && dist < 6) return { ...base, want: dir, jumpPressed: true, jumpHeld: true };

      // ── offence ──
      const foeOpen = foe.stunned || (foe.busy && !foe.inContactMove()) || punishing;
      if (giOK && level && !walled && gap <= ramReach && gap > -H * 0.3) {
        // Hugging and calm: step back for a run-up first (momentum: ×0.7 standing, ×1 at full run).
        if (gap < H * 0.7 && canBackDash && !foeOpen && !th.contact && Math.random() < 0.5) { backDashPlan = true; return { ...base, want: 0, dash: true }; }
        backDashPlan = false;
        return attack(base, 'close', dir);
      }
      if (bpOK && gap <= quickReach && gap > 0.15 && (level || (dy > 0 && dy < H * 1.2))) {
        const giSoon = CLOSE && !me.ready(CLOSE) && (me.readyAt.get(CLOSE) ?? 0) - me.time < 0.35;
        if (!giOK && !giSoon) return attack(base, 'mobility', dir, level ? 0 : 0.6);
      }
      if (sbOK && !walled && me.grounded) {
        const a = beamAim();
        const safe = foe.stunned || gap > foeRush() + 1.5 || (foe.firing && !foe.inContactMove() && foe.using !== foe.moves.ranged);
        const foeBeamBeats = foe.moves.ranged && foe.ready(foe.moves.ranged) && !isBall(foe.moves.ranged) && foe.moves.ranged !== 'Stone Edge'
          && clashScore(foe, foe.moves.ranged, 'Steel') > clashScore(me, RANGED, (getMove(foe.moves.ranged) || {}).moveType) * 1.1
          && dist > CLASH_MIN;
        if (a !== null && safe && !foeBeamBeats && (!giOK || gap > ramReach + 1)) { lockAim = a; return attack(base, 'ranged', dir, a); }
      }

      // ── movement ──
      const giWait = CLOSE ? Math.max(0, (me.readyAt.get(CLOSE) ?? 0) - me.time) : 9;
      const idealGap = giWait < 0.5 ? ramReach * 0.85 : Math.min(ramReach, quickReach) * 0.8;
      if (gap > idealGap + 0.3) {
        if (me.grounded && me.ready('Dash') && gap > idealGap + 4 && me.facing === dir) return { ...base, want: dir, dash: true };
        return { ...base, want: dir, jumpHeld: airHold };
      }
      // Too close with the ram cooling: a back dash out of flurry reach for the next run-up.
      if (gap < H * 0.4 && giWait > 0.3 && canBackDash && !foeOpen && Math.random() < 0.08) return { ...base, want: 0, dash: true };
      if (t - lastLog > 30) { lastLog = t; }
      return { ...base, jumpHeld: airHold };
    };
  },
};
