// d8-greninja — "Mirror Shinobi". Greninja (Water/Dark).
// A reactive ninja: it reads every committed attack frame by frame and turns it back with Sucker Punch (1.5x the
// attacker's own damage), crashes Wave Crash into anyone rooted in an aim / beam / whiff, and pours Hydro Cannon only
// from range at a foe that can't reflect it. Reads the game, returns intents; changes nothing.
window.__brains = window.__brains || {};
window.__brains['d8-greninja'] = {
  name: 'Mirror Shinobi',
  species: 'Greninja',
  kit: { ranged: 'Hydro Cannon', close: 'Wave Crash', control: 'Sucker Punch' },
  strategy: 'Never swing first into a ready brace: stand at Wave Crash range and Sucker Punch every committed blow, beam or ball '
    + '(1.5x their own damage back), ram anyone rooted in an aim, beam or whiff, and fire Hydro Cannon only from range when it cannot be reflected; '
    + 'play keep-away when ahead near the 150 s bell.',

  make({ me, foe, arena, Fighter, consts, memory }) {
    const C = consts;
    const IDLE = C.IDLE;
    const AIM_ANGLE = C.AIM_ANGLE;
    const RANGED = me.moves.ranged, CLOSE = me.moves.close, CONTROL = me.moves.control;
    const HAS_SP = CONTROL === 'Sucker Punch';
    const BEHIND = new Set(['Shadow Sneak', 'Feint', 'Sucker Punch', 'Counter']);
    const LIMIT = 150;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const mv = (m) => (m ? C.getMove(m) : null);
    const physical = (m) => (mv(m)?.category === 'physical');
    const ballSeen = new WeakMap();

    // (Learning: how often each foe species braces; kept across battles.)
    const rec = (memory[foe.name] ??= { battles: 0, braces: 0 });
    rec.battles++;
    let foeWasCountering = false;

    // State.
    let aimLock = 0;           // the aim we hold while aiming our beam
    let lastNeedle = null;
    let lastAttackAt = -10;    // last time we started an attack
    let prevT = 0;

    const dmgOnMe = (m) => { try { return m ? foe.damageTo(m, me) : 0; } catch { return 1; } };
    const dmgOnFoe = (m) => { try { return m ? me.damageTo(m, foe) : 0; } catch { return 1; } };
    const ready = (m) => !!m && me.ready(m);
    const coolLeft = (f, m) => (m ? (f.readyAt.get(m) ?? -Infinity) - f.time : Infinity);

    // Can the foe turn a blow back at us (or dodge it with Detect) within `within` seconds?
    // returns 'hard' (Sucker Punch / Counter vs physical), 'soft' (Detect) or ''.
    const foeReflect = (isPhysical, within) => {
      const c = foe.moves.control;
      if (!c || !C.BRACES.has(c)) return '';
      if (c === 'Counter' && !isPhysical) return '';
      const kind = c === 'Detect' ? 'soft' : 'hard';
      if (foe.countering) return kind;
      if (coolLeft(foe, c) > within) return '';
      // Locked in its own move (aiming, pouring, flinching, mid ram/step): it cannot brace.
      if (foe.aiming || foe.firing || foe.stunned || foe.ramming || foe.quick || foe.down) return '';
      return kind;
    };

    // The most urgent attack coming at us: { kind, move, now } where `now` says brace right this frame.
    const incoming = (dist) => {
      const out = [];
      // A beam.
      const fb = foe.beam;
      if (fb && !(fb.struck && fb.struck.has(me))) {
        let meets = null;
        try { meets = Fighter.lineMeets(fb.from, fb.dir, (fb.range ?? 8) + 0.6, me); } catch { meets = null; }
        if (meets !== null) {
          const el = foe.time - (fb.pressedAt ?? foe.time);
          out.push({ kind: 'beam', move: fb.move, now: fb.launched || el >= 0.85, launched: !!fb.launched, el, fb });
        }
      }
      // A ball charging at us (not launched yet).
      const bc = foe.ballCharge;
      if (bc) {
        let meets = null;
        try { meets = Fighter.lineMeets(bc.from, bc.dir, (bc.range ?? 8) + 0.6, me); } catch { meets = null; }
        if (meets !== null) out.push({ kind: 'ballCharge', move: bc.move, now: false });
      }
      // Balls in flight.
      for (const b of foe.balls || []) {
        if (!b.launched || b.done || !b.play || !b.play.position) continue;
        if (b.passed && b.passed.has(me)) continue;
        const p = b.play.position();
        const cx = me.x, cy = me.y + me.H * 0.5;
        const d = Math.hypot(p.x - cx, p.y - cy);
        const prev = ballSeen.get(b);
        let speed = 8;
        if (prev && me.time > prev.t) {
          const dd = prev.d - d;
          speed = Math.max(0.5, dd / (me.time - prev.t));
          if (dd < 0 && b.homing !== me) { ballSeen.set(b, { d, t: me.time }); continue; } // going away
        }
        ballSeen.set(b, { d, t: me.time });
        const level = Math.abs(p.y - cy) < me.H * 1.1;
        if (b.homing !== me && !level) continue;
        const eta = d / speed;
        out.push({ kind: 'ball', move: b.move, now: eta < 0.45 || d < me.H * 1.2, eta, homing: b.homing === me });
      }
      // A ram.
      const r = foe.ramming;
      if (r && Math.sign(me.x - foe.x) === r.dir && Math.abs(me.y - foe.y) < Math.max(me.H, foe.H)) {
        const gap = dist - (me.reachOf().front + foe.reachOf().front);
        const left = C.RAM_DIST * foe.H - (r.ran || 0);
        if (gap <= left + 0.8) out.push({ kind: 'ram', move: r.move, now: true, gap });
      }
      // A priority dash or strike from behind.
      if (foe.quick && foe.using && (C.isQuickStrike(foe.using) || BEHIND.has(foe.using)) && dist < 8) {
        out.push({ kind: 'quick', move: foe.using, now: true });
      }
      // A slash / flurry / quake / Stone Edge under way.
      if (foe.firing && foe.using && !foe.beam) {
        const u = foe.using;
        if (u === 'Earthquake') { if (me.grounded && dist <= 6.3) out.push({ kind: 'quake', move: u, now: true }); }
        else if (u === 'Stone Edge') { if (me.grounded) out.push({ kind: 'edge', move: u, now: true }); }
        else if (u === foe.moves.close && !C.isRamMove(u)) {
          if (dist <= foe.reachWith(u) + me.reachOf().back + 0.5 && Math.abs(me.y - foe.y) < Math.max(me.H, foe.H) * 1.2) out.push({ kind: 'close', move: u, now: true });
        }
      }
      // A stock-bot tell for a blow (it commits after its hold).
      if (foe.telling && !foe.busy) {
        const u = foe.telling;
        if (u === foe.moves.close || u === foe.moves.mobility) {
          const reach = C.isRamMove(u) ? C.RAM_DIST * foe.H + 1 : C.isQuickStrike(u) ? C.QUICK_DIST * foe.H + 1 : BEHIND.has(u) ? 6 : u === 'Earthquake' ? 6.3 : foe.reachWith(u) + 0.8;
          if (dist <= reach) out.push({ kind: 'tell', move: u, now: true });
        }
      }
      // Only what can hurt us (Psychic on a Dark type does nothing: not worth a brace).
      const real = out.filter((o) => dmgOnMe(o.move) > 0);
      const order = { quick: 0, close: 1, ram: 2, ball: 3, beam: 4, quake: 5, edge: 6, tell: 7, ballCharge: 8 };
      real.sort((a, b) => (b.now - a.now) || (order[a.kind] - order[b.kind]));
      return real[0] || null;
    };

    return (t) => {
      const dt = Math.max(0, t - prevT); prevT = t; void dt;
      const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx);
      const dy = foe.y - me.y;
      const face = dir;
      const base = { ...IDLE, face, aim: 0 };

      // Learning: count foe braces.
      if (foe.countering && !foeWasCountering) rec.braces++;
      foeWasCountering = foe.countering;

      if (me.down || foe.down) return base;

      // ── A clash: stop our needle near its top.
      if (me.clashing) {
        const n = me.clashing.needle();
        if (n === null || me.clashing.stopped() !== null) { lastNeedle = null; return { ...base, aim: aimLock }; }
        const falling = lastNeedle !== null && n < lastNeedle;
        lastNeedle = n;
        return { ...base, aim: aimLock, ranged: n >= 0.955 || (falling && n >= 0.9) };
      }
      lastNeedle = null;

      // ── Our own beam being aimed: hold the aim we chose (it fires once the line gets there).
      if (me.aiming) return { ...base, aim: aimLock };
      if (me.busy) return { ...base, aim: aimLock };

      const gap = dist - (me.reachOf().front + foe.reachOf().front);
      const ramReach = C.RAM_DIST * me.H;
      const facing = me.facing === dir;
      const levelGround = me.grounded && Math.abs(dy) < me.H * 0.6 && foe.y < me.y + me.H * 0.9;
      const myShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp;
      const late = t > LIMIT - 18;
      const protectLead = late && myShare > foeShare + 0.01;
      const desperate = t > LIMIT - 25 && myShare < foeShare;

      // Our beam's aim at the foe.
      const [mx, my] = me.mouth();
      const want = Math.atan2(foe.y + foe.H * 0.5 - my, Math.max(0.01, Math.abs(foe.x - mx)));
      const aim = clamp(want / AIM_ANGLE, -1, 1);
      let beamMeets = null;
      try { beamMeets = Fighter.lineMeets([mx, my], [dir * Math.cos(aim * AIM_ANGLE), Math.sin(aim * AIM_ANGLE)], me.beamRange, foe); } catch { beamMeets = null; }
      let walled = false;
      try {
        const w = Fighter.pillarAlong(arena, [mx, my], [dir * Math.cos(aim * AIM_ANGLE), Math.sin(aim * AIM_ANGLE)], Math.min(dist + 1, me.beamRange));
        walled = w !== null && w < dist - foe.reachOf().front;
      } catch { walled = false; }

      // ── Incoming.
      const th = incoming(dist);
      if (th) {
        const spReady = HAS_SP && ready(CONTROL) && !me.countering;
        if (spReady && th.now && th.kind !== 'ballCharge') {
          return { ...base, control: true };
        }
        if (me.countering) return base; // braced: stand still and let it come
        if (spReady && !th.now) {
          // Wait for it (stay in its line so the brace catches it) — unless we can crash into the rooted attacker now.
          if ((th.kind === 'beam' || th.kind === 'ballCharge') && ready(CLOSE) && facing && levelGround && gap >= 0 && gap <= ramReach * 0.95
            && dmgOnFoe(CLOSE) > 0 && me.hp > dmgOnFoe(CLOSE) / 3 + 5) {
            lastAttackAt = t;
            return { ...base, close: true };
          }
          return base;
        }
        // No brace to hand.
        if (th.kind === 'beam' || th.kind === 'ballCharge') {
          // Ram through it (contact pushes through ranged fire and knocks the firer out of it).
          if (ready(CLOSE) && facing && levelGround && gap >= -0.2 && gap <= ramReach * 0.95 && me.hp > dmgOnFoe(CLOSE) / 3 + 5) {
            lastAttackAt = t;
            return { ...base, close: true };
          }
          // Meet a charging beam with ours if ours wins the clash.
          if (th.kind === 'beam' && !th.launched && th.el < 0.55 && ready(RANGED) && facing && dist > 3.4) {
            let win = false;
            try {
              const a = me.clashTerms(RANGED, th.move), b = foe.clashTerms(th.move, RANGED);
              win = a.P * a.E > b.P * b.E * 1.12;
              const fb = th.fb;
              win = win && Fighter.linesMeet([mx, my], me.aimDir(aim), me.beamRange, fb.from, fb.dir, fb.range ?? 8, (me.H + foe.H) * 0.25);
            } catch { win = false; }
            if (win) { aimLock = aim; lastAttackAt = t; return { ...base, aim, ranged: true }; }
          }
          // Jump out of its line as it comes.
          if (th.kind === 'beam' && (th.launched || th.el > 0.8) && me.grounded) return { ...base, jumpPressed: true, jumpHeld: true };
          if (th.kind === 'beam' && !me.grounded) return { ...base, jumpHeld: true };
          return base;
        }
        if (th.kind === 'ball') {
          if (!th.homing && me.grounded && th.eta < 0.5) return { ...base, jumpPressed: true, jumpHeld: true };
          if (!me.grounded) return { ...base, jumpHeld: true };
          return base;
        }
        if (th.kind === 'ram') {
          if (me.grounded && th.gap < 3) return { ...base, jumpPressed: true, jumpHeld: true };
          return { ...base, jumpHeld: !me.grounded };
        }
        if (th.kind === 'quake' || th.kind === 'edge') {
          if (me.grounded) return { ...base, jumpPressed: true, jumpHeld: true, want: th.kind === 'quake' ? -dir : 0 };
          return { ...base, jumpHeld: true, want: th.kind === 'quake' ? -dir : 0 };
        }
        if (th.kind === 'close' || th.kind === 'quick' || th.kind === 'tell') {
          if (me.grounded && me.ready('Back Dash')) return { ...base, want: 0, dash: true };
          return { ...base, want: -dir };
        }
      }

      // ── The foe braced: never swing into it. Step back a touch, then punish its whiff.
      if (foe.countering) {
        const keep = foe.moves.control === 'Detect' ? 0 : (gap < 1.2 ? -dir : 0);
        return { ...base, want: keep };
      }

      // ── Offense.
      const ramDmg = dmgOnFoe(CLOSE);
      const ramSafe = !foeReflect(true, 0.9) || (foeReflect(true, 0.9) === 'soft' && t - lastAttackAt > 2.5);
      const recoilOk = me.hp > ramDmg / 3 + 5 || ramDmg * 0.85 >= foe.hp && me.hp > ramDmg / 3 * 0.7;
      const foeRooted = !!(foe.aiming || (foe.firing && (foe.beam || foe.ballCharge)) || foe.stunned);
      const canRam = ready(CLOSE) && facing && levelGround && ramDmg > 0 && recoilOk && gap >= -0.2 && gap <= ramReach * 0.93;
      if (canRam && (ramSafe || foeRooted) && !(protectLead && !foeRooted)) {
        lastAttackAt = t;
        return { ...base, close: true };
      }

      // The foe aiming a beam or ball at us (not out yet): with our brace up, stand in its line and wait to turn it back;
      // else only fire back if our beam would win the clash.
      const foeAimingRanged = !!(foe.aiming || foe.ballCharge || (foe.beam && !foe.beam.launched));
      let clashWin = false;
      if (foeAimingRanged && foe.moves.ranged) {
        try {
          const a = me.clashTerms(RANGED, foe.moves.ranged), b = foe.clashTerms(foe.moves.ranged, RANGED);
          clashWin = a.P * a.E > b.P * b.E * 1.12;
        } catch { clashWin = false; }
      }
      if (foeAimingRanged && HAS_SP && ready(CONTROL)) return base;

      const beamDmg = dmgOnFoe(RANGED);
      const beamSafe = !foeReflect(false, 1.8) || (foeReflect(false, 1.8) === 'soft' && t - lastAttackAt > 2.5);
      // Rushers can reach us during the 1.35 s commitment: beam only from range or at a rooted / far foe.
      const foeFast = foe.moves.mobility && (C.isQuickStrike(foe.moves.mobility) || BEHIND.has(foe.moves.mobility) || foe.moves.mobility === 'Teleport');
      const minBeam = foeRooted ? 3.4 : foeFast ? 6.0 : 4.6;
      const canBeam = ready(RANGED) && facing && beamDmg > 0 && beamMeets !== null && !walled && dist >= minBeam
        && !(foe.ramming) && me.grounded;
      if (canBeam && (beamSafe || foeRooted) && (!foeAimingRanged || clashWin) && (!protectLead || dist > 7)) {
        aimLock = aim; lastAttackAt = t;
        return { ...base, aim, ranged: true };
      }

      // ── Positioning.
      let target; // desired horizontal distance
      const spUp = HAS_SP && ready(CONTROL);
      if (protectLead) target = 9;
      else if (!foe.grounded && dy > me.H) target = clamp(dy / 0.6, 4.8, 7.8); // a flier: get an angle for the cannon
      else if (ready(CLOSE)) target = me.reachOf().front + foe.reachOf().front + ramReach * 0.8;
      else if (ready(RANGED) && !spUp) target = 6.5;
      else if (spUp) target = me.reachOf().front + foe.reachOf().front + ramReach * 0.75;
      else target = Math.max(5.5, foe.reachWith(foe.moves.close || 'Scratch') + 2.5);
      if (desperate && !protectLead) target = Math.min(target, me.reachOf().front + foe.reachOf().front + ramReach * 0.85);

      let wantX = 0;
      if (dist > target + 0.5) wantX = dir;
      else if (dist < target - 0.5) wantX = -dir;
      // Backing into a wall: hold (or slip past by jumping when cornered and threatened).
      const room = 10.3;
      if (wantX !== 0 && Math.abs(me.x + wantX * 0.8) > room) wantX = 0;
      let jump = false;
      // Cornered with the foe close and nothing to hand: hop over toward the open side.
      if (Math.abs(me.x) > room - 0.5 && Math.sign(me.x) === -dir && gap < 1.0 && !spUp && me.grounded && !ready(CLOSE)) { wantX = dir; jump = true; }
      // A pillar in the way: over it.
      if (wantX !== 0 && me.grounded) {
        try {
          const p = Fighter.pillarAlong(arena, [me.x, me.y + me.H * 0.4], [wantX, 0], 1.4);
          if (p !== null) jump = true;
        } catch { /* none */ }
      }
      // A foe far above (flier) and us wanting to close: nothing to jump for — keep to the floor.
      let dash = false;
      if (wantX === dir && dist - target > 4 && me.grounded && me.ready('Dash') && !foeRooted) dash = true;
      const i = { ...base, want: wantX, face: wantX === -dir ? dir : face, aim };
      if (jump) { i.jumpPressed = true; i.jumpHeld = true; }
      if (dash) i.dash = true;
      // Retreating while we still want to face the foe: turning only by `face` when standing; when stepping away we
      // turn our back briefly, so stop and face once we are where we want.
      return i;
    };
  },
};
