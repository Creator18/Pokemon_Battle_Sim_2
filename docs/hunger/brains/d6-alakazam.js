// Tribute d6: Alakazam - "The Spoon Oracle".
// Reads every tell, answers beams with a stronger beam (Photon Geyser clashes), Detects blows, Teleports behind
// beamers, and only commits its long Photon Geyser charge when the foe can't reach it in time.
// Giga Impact (Normal ram) is the anti-aim tool (pushes through ranged fire) and the only damage on Dark types.
window.__brains = window.__brains || {};
window.__brains['d6-alakazam'] = {
  name: 'The Spoon Oracle',
  species: 'Alakazam',
  kit: { ranged: 'Photon Geyser', close: 'Giga Impact', mobility: 'Teleport', control: 'Detect' },
  strategy: 'Keep mid range, Detect or Teleport away from every blow, win beam clashes with STAB Photon Geyser, and fire it only into windows the foe cannot close (busy, cooling, knocked back by a Giga Impact ram). Up on HP late, kite to the timeout.',
  make({ me, foe, arena, Fighter, consts, memory }) {
    const C = consts;
    const PG = me.moves.ranged || 'Photon Geyser';
    const GI = me.moves.close || 'Giga Impact';
    const MOB = me.moves.mobility || null;
    const CTL = me.moves.control || null;
    const AIM_ANGLE = C.AIM_ANGLE, AIM_MIN = C.AIM_MIN, AIM_RATE = C.AIM_RATE;
    const RAM_DIST = C.RAM_DIST, QUICK_DIST = C.QUICK_DIST, CLOSE_REACH = C.CLOSE_REACH;
    const QUAKE_R = (11 * 0.94) / 2 * 1.1;
    const CLASH_MIN = (11 * 0.94) / 2 * 0.6;
    const BEHIND = { 'Feint': 1, 'Shadow Sneak': 1, 'Sucker Punch': 1 };
    const NON_ATTACK = { 'Teleport': 1, 'Dash': 1, 'Back Dash': 1, 'Detect Zip': 1, 'Agility': 1, 'Detect': 1, 'Growl': 1, 'Smokescreen': 1 };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const mem = memory;
    mem.battles = (mem.battles || 0) + 1;
    mem.errors = mem.errors || 0;

    const S = {
      lastMe: me.time, dt: 1 / 60,
      aim: null,            // { mode: 'shot' | 'clash', at: my time pressed }
      clashSeen: -1, lastN: null,
      lastAttackT: 0,       // my clock: last time I committed an attack
      foeBracedWas: false,
      hopUntil: -1,
      tellName: '', tellSince: 0, // the foe's tell (its field is never cleared after a ram or a dash): how fresh it is
    };

    const idle = (face) => ({ want: 0, face, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
      ranged: false, close: false, mobility: false, control: false, dash: false });

    const cdLeft = (f, m) => { if (!m) return Infinity; const r = f.readyAt && f.readyAt.get(m); return r === undefined ? 0 : Math.max(0, r - f.time); };
    const fk = foe.moves || {};
    const isQS = (m) => !!m && C.isQuickStrike(m);
    const foeStrikeMob = fk.mobility && (isQS(fk.mobility) || BEHIND[fk.mobility]) ? fk.mobility : null;
    const foeHasRam = !!fk.close && C.isRamMove(fk.close);
    const foeQuake = fk.close === 'Earthquake';
    const foeBraceKind = fk.control && C.BRACES.has(fk.control) ? fk.control : null;

    // Damage per hit of each of my attacks on this foe.
    const pgDmg = (() => { try { return me.damageTo(PG, foe); } catch (e) { return 1; } })();
    const giDmg = (() => { try { return me.damageTo(GI, foe); } catch (e) { return 1; } })();
    const pgUseful = pgDmg > 0;
    const giUseful = giDmg > 0;
    // Dark foes: Photon Geyser does nothing - the ram is the weapon.
    const brawl = !pgUseful && giUseful;

    // Clash odds of my beam against their ranged move.
    const clashOdds = (theirs) => {
      try {
        if (!theirs || theirs === 'Stone Edge') return 0;
        const a = me.clashTerms(PG, theirs), b = foe.clashTerms(theirs, PG);
        if (a.P >= b.P && a.E >= b.E && (a.P > b.P || a.E > b.E)) return 99;
        if (b.P >= a.P && b.E >= a.E && (b.P > a.P || b.E > a.E)) return 0;
        return (a.P * a.E) / Math.max(1e-6, b.P * b.E);
      } catch (e) { return 0; }
    };
    const clashGood = pgUseful && clashOdds(fk.ranged) >= 0.9;

    // Walls either side of me at my height.
    const walls = () => {
      let L = -11, R = 11;
      for (const s of arena.level || []) {
        if (!(s.top > me.y + 0.3 && s.top - s.h < me.y + me.H * 0.6)) continue;
        if (s.x + s.w <= me.x + 1e-3) L = Math.max(L, s.x + s.w);
        else if (s.x >= me.x - 1e-3) R = Math.min(R, s.x);
      }
      return [L, R];
    };

    const desiredAim = (tx, ty) => {
      const [mx, my] = me.mouth();
      return clamp(Math.atan2(ty - my, Math.max(0.05, Math.abs(tx - mx))) / AIM_ANGLE, -1, 1);
    };
    // Best fixed aim (level / up / down or exact) whose line meets the foe within my reach.
    const lineHits = (a) => {
      const from = me.mouth(), d = me.aimDir(a);
      const hit = Fighter.lineMeets(from, d, me.beamRange, foe);
      if (hit === null) return false;
      const wall = Fighter.pillarAlong ? Fighter.pillarAlong(arena, from, d, me.beamRange) : null;
      return wall === null || wall > hit;
    };
    const facingAimHits = () => {
      const want = desiredAim(foe.x, foe.y + foe.H * 0.5);
      for (const a of [want, 0, 0.5, -0.5, 1, -1]) if (lineHits(a)) return a;
      return null;
    };

    // How long until the foe is done with what it is doing (s).
    const foeBusyLeft = () => {
      let b = 0;
      if (foe.stunned) b = Math.max(b, 0.3);
      if (foe.knockT > 0) b = Math.max(b, foe.knockT + 0.3);
      if (foe.aiming) b = Math.max(b, Math.max(0.05, AIM_MIN - (foe.time - foe.aiming.since)) + 1.1);
      if (foe.beam) {
        if (!foe.beam.launched) b = Math.max(b, 1.1 - (foe.time - foe.beam.pressedAt) + 0.6);
        else if (foe.beam.pouring) b = Math.max(b, 0.5);
      }
      const bc = foe.ballCharge;
      if (bc) b = Math.max(b, Math.max(0, 1.1 - (foe.time - bc.pressedAt)));
      if (foe.lagUntil > foe.time) b = Math.max(b, foe.lagUntil - foe.time);
      if (foe.countering && fk.control === 'Counter') b = Math.max(b, 0.6);
      if (foe.firing && foe.using === fk.close && !foe.beam) b = Math.max(b, 0.25);
      if (foe.down) b = 99;
      return b;
    };

    // Seconds until the foe could land a contact blow (or a quake) on me.
    const foeETA = (gap, dist) => {
      const run = (foe.flying ? 9 : 7) * (foe.stride || 1);
      const busy = foeBusyLeft();
      let best = Infinity;
      const tool = (m, reachGap, start, extra) => {
        const c = cdLeft(foe, m);
        if (!Number.isFinite(c)) return;
        const eta = Math.max(busy, c, Math.max(0, gap - reachGap) / run) + start + (extra || 0);
        if (eta < best) best = eta;
      };
      if (fk.close && !foeQuake) {
        if (foeHasRam) tool(fk.close, RAM_DIST * foe.H * 0.95, 0.4, 0.5);  // a ram pushes through my pour: need more margin
        else tool(fk.close, foe.H * 1.45 - foe.reachOf().front + 0.15, 0.4);
      }
      if (foeQuake && me.grounded) tool('Earthquake', QUAKE_R - me.reachOf().front - foe.reachOf().front, 0.6);
      if (foeStrikeMob) tool(foeStrikeMob, isQS(foeStrikeMob) ? QUICK_DIST * foe.H : 5 * foe.H, 0.3, 0.3);
      // Plain walking up and pressing: even with nothing ready it can arrive.
      void dist;
      return best;
    };

    // A contact blow on its way to me now.
    const contactIncoming = (dist, gap, dy, toMe) => {
      const r = foe.ramming;
      if (r && r.dir === toMe && Math.abs(dy) < foe.H + 0.2 && gap <= RAM_DIST * foe.H - (r.ran || 0) + 1.2) return 'ram';
      const u = foe.using || '';
      if (foe.quick && u && !NON_ATTACK[u] && (isQS(u) || BEHIND[u] || u === 'Counter') && dist < 6 * foe.H) return 'quick';
      if (foe.firing && u && u === fk.close && !foeQuake && !foe.beam && dist <= foe.H * 1.45 + me.reachOf().back + 0.6) return 'swing';
      // (A stale tell - left over after a ram or a quick strike - is ignored.)
      const tl = foe.time - S.tellSince < 0.65 ? (foe.telling || '') : '';
      if (tl && tl !== fk.ranged && !NON_ATTACK[tl] && tl !== 'Earthquake') {
        if (tl === fk.close && foeHasRam && gap <= RAM_DIST * foe.H + 0.8 && Math.abs(dy) < foe.H) return 'ram';
        if (tl === fk.close && !foeHasRam && dist <= foe.H * 1.45 + me.reachOf().back + 1.0) return 'swing';
        if (tl === fk.mobility && (isQS(tl) || BEHIND[tl]) && dist < 6 * foe.H) return 'quick';
      }
      return null;
    };

    const quakeIncoming = (dist) => {
      if (!foeQuake) return false;
      const on = foe.telling === 'Earthquake' || ((foe.firing || foe.quick) && foe.using === 'Earthquake');
      return on && dist <= QUAKE_R + 0.8;
    };

    // A foe beam/ball charging or pouring whose line meets me.
    const beamThreat = () => {
      const fb = foe.beam || foe.ballCharge;
      if (!fb) return null;
      const meets = Fighter.lineMeets(fb.from, fb.dir, (fb.range || 8) + 0.6, me) !== null;
      if (!meets) return null;
      return { fb, launched: !!fb.launched, charging: !fb.launched };
    };
    const ballThreat = () => {
      for (const b of foe.balls || []) {
        if (!b.launched || b.done || !b.play || !b.play.position) continue;
        const p = b.play.position();
        const towards = Math.sign(me.x - foe.x) || 1;
        const ahead = (me.x - p.x) * towards;
        const near = b.homing === me || (Math.abs(p.y - (me.y + me.H * 0.5)) < me.H * 0.9);
        if (near && ahead > -me.H * 0.3 && ahead < 3.4) return { b, ahead, homing: b.homing === me };
      }
      return null;
    };

    // -- aiming (player style: rangedHeld) ----------------------------------------------
    const startAim = (mode, face) => {
      S.aim = { mode, at: me.time };
      S.lastAttackT = me.time;
      return { ...idle(face), ranged: true, rangedHeld: true };
    };

    const steerAim = (face) => {
      const a = S.aim || { mode: 'shot', at: me.aiming.since };
      const el = me.time - me.aiming.since;
      let target;
      const fb = foe.beam && !foe.beam.launched ? foe.beam : foe.ballCharge;
      let release = false;
      if (a.mode === 'clash' && fb) {
        const [fx, fy] = foe.mouth();
        target = desiredAim(fx, fy);
        const from = me.mouth(), d = me.aimDir(me.aim);
        const span = Math.hypot(fx - from[0], fy - from[1]) + foe.H;
        const meets = foe.facing === -me.facing && Fighter.linesMeet(from, d, span, fb.from, fb.dir, span, (me.H + foe.H) * 0.25);
        if (meets && el >= AIM_MIN + 0.005) release = true;
        // Their beam about to launch: let go now whatever.
        if (foe.beam && !foe.beam.launched && 1.1 - (foe.time - foe.beam.pressedAt) < 0.12 && el >= AIM_MIN) release = true;
      } else {
        const best = facingAimHits();
        target = best !== null ? best : desiredAim(foe.x, foe.y + foe.H * 0.5);
        if (el >= AIM_MIN + 0.005 && lineHits(me.aim)) release = true;
        // Foe out of my line for long: let it go anyway (its pour is a hit zone).
        if (el > 1.1) release = true;
        // Foe's beam now charging at me: let go so the lines can meet (a clash).
        if (fb && el >= AIM_MIN && Fighter.lineMeets(fb.from, fb.dir, (fb.range || 8) + 0.6, me) !== null) release = true;
      }
      if (el > 2.4) release = true;
      const vel = clamp((target - me.aim) / Math.max(1e-3, AIM_RATE * S.dt), -1, 1);
      if (release) S.aim = null;
      return { ...idle(face), aim: release ? 0 : vel, rangedHeld: !release };
    };

    // -- the clash stopper ---------------------------------------------------------------
    const clashPress = (face) => {
      const cm = me.clashing;
      const n = cm.needle();
      if (n === null || cm.stopped() !== null) { S.lastN = null; S.clashSeen = -1; return idle(face); }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      if (S.clashSeen < 0) S.clashSeen = now;
      const falling = S.lastN !== null && n < S.lastN;
      S.lastN = n;
      const press = n >= 0.955 || (falling && n >= 0.9) || now - S.clashSeen > 2.05;
      return { ...idle(face), ranged: press };
    };

    // -- one frame -----------------------------------------------------------------------
    const think = (t) => {
      const dtm = me.time - S.lastMe; S.lastMe = me.time;
      if (dtm > 1e-4 && dtm < 0.2) S.dt = S.dt * 0.7 + dtm * 0.3;

      const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx);
      const toMe = -dir;                     // the way the foe must go to reach me
      const dy = foe.y - me.y;
      const myF = me.reachOf().front, foF = foe.reachOf().front;
      const gap = dist - myF - foF;
      if (foe.telling !== S.tellName) { S.tellName = foe.telling; S.tellSince = foe.time; }
      if (!me.clashing) { S.clashSeen = -1; S.lastN = null; }
      if (me.down || foe.down) { S.aim = null; return idle(dir); }

      if (me.clashing) return clashPress(dir);
      if (me.aiming) return steerAim(dir);
      S.aim = null;
      if (me.busy) return idle(dir);

      const facing = me.facing === dir;
      const [wl, wr] = walls();
      const roomBehind = dir > 0 ? me.x - wl : wr - me.x;     // room on my side away from the foe
      const backDashLen = 0.7 * 3.6 * me.H;
      const shareMe = me.hp / me.maxHp, shareFoe = foe.hp / foe.maxHp;
      const late = t > 118;
      const kite = late && shareMe > shareFoe + 0.04;
      const desperate = t > 125 && shareMe < shareFoe;
      const idleFor = me.time - S.lastAttackT;

      // The foe's brace: Counter only turns physical blows; Sucker Punch / Detect anything.
      const foeBraced = foe.countering;
      const braceBlocksBeam = foeBraced && fk.control !== 'Counter';
      const braceBlocksRam = foeBraced;

      const base = idle(dir);
      const ready = (m) => !!m && me.ready(m);
      const detectReady = CTL === 'Detect' && ready('Detect');
      const tpReady = MOB === 'Teleport' && ready('Teleport');
      const bdReady = ready('Back Dash') && me.grounded;

      // 1. A blow coming at me.
      const inc = contactIncoming(dist, gap, dy, toMe);
      if (inc) {
        if (detectReady) return { ...base, control: true };
        if (tpReady && (inc === 'ram' || roomBehind < backDashLen + 0.5)) return { ...base, mobility: true };
        if (inc === 'ram' && me.grounded) {
          if (bdReady && roomBehind > backDashLen + 0.6 && gap > 0.8) return { ...base, dash: true };
          return { ...base, want: -dir, jumpPressed: true, jumpHeld: true };
        }
        if (bdReady && roomBehind > 1.5) return { ...base, dash: true };
        if (me.grounded) return { ...base, want: -dir, jumpPressed: true, jumpHeld: true };
        return { ...base, want: -dir };
      }

      // 2. Earthquake / Stone Edge on their way.
      if (quakeIncoming(dist)) {
        if (bdReady && dist + backDashLen > QUAKE_R + 0.6 && roomBehind > backDashLen) return { ...base, dash: true };
        if (detectReady && dist < foe.H * 2) return { ...base, control: true };
        if (me.grounded) return { ...base, jumpPressed: true, jumpHeld: true, want: roomBehind > 2 ? -dir : 0 };
        return { ...base, jumpHeld: true };
      }
      if ((foe.telling === 'Stone Edge' || (foe.firing && foe.using === 'Stone Edge')) && me.grounded) {
        if (detectReady) return { ...base, control: true };
        return { ...base, jumpPressed: true, jumpHeld: true };
      }

      // 3. A beam or ball charging / pouring at me.
      const bt = beamThreat();
      if (bt) {
        const theirs = bt.fb.move;
        const odds = clashOdds(theirs);
        const left = bt.charging ? 1.1 - (foe.time - (bt.fb.pressedAt || foe.time)) : 0;
        if (bt.charging) {
          // Meet it: a clash I should win.
          if (pgUseful && odds >= 0.85 && ready(PG) && dist >= CLASH_MIN + 0.3 && left > AIM_MIN + 0.05 && foe.facing === -dir) {
            return startAim('clash', dir);
          }
          // Behind the rooted beamer.
          if (tpReady && left > 0.15 && Math.random() < 0.9) return { ...base, mobility: true };
          // Through it: the ram keeps going.
          if (giUseful && ready(GI) && facing && me.grounded && Math.abs(dy) < me.H * 0.6 && gap <= RAM_DIST * me.H * 0.9 && !braceBlocksRam) {
            S.lastAttackT = me.time;
            return { ...base, close: true };
          }
          // Out of its line: its reach is fixed now.
          if (bdReady && roomBehind > backDashLen + 0.3) return { ...base, dash: true };
          if (detectReady && left < 0.45) return { ...base, control: true };
          if (me.grounded && left < 0.35) return { ...base, want: -dir, jumpPressed: true, jumpHeld: true };
          return { ...base, want: roomBehind > 1 ? -dir : dir };
        }
        // Launched: Detect if its front hasn't reached me, else get out.
        if (detectReady) return { ...base, control: true };
        if (bdReady && roomBehind > backDashLen + 0.3) return { ...base, dash: true };
        if (me.grounded) return { ...base, want: -dir, jumpPressed: true, jumpHeld: true };
      }
      const ball = ballThreat();
      if (ball) {
        if (ball.homing || !me.grounded) {
          if (detectReady && ball.ahead < 1.8) return { ...base, control: true };
        } else if (ball.ahead < 2.8) {
          return { ...base, jumpPressed: true, jumpHeld: true };
        }
      }
      // A foe aiming at me (not yet let go): get ready to meet it.
      if (foe.aiming && foe.facing === -dir && fk.ranged && fk.ranged !== 'Stone Edge') {
        const odds = clashOdds(fk.ranged);
        if (pgUseful && odds >= 0.85 && ready(PG) && facing && dist >= CLASH_MIN + 0.3 && dist <= me.beamRange + 2.5) {
          return startAim('clash', dir);
        }
        // Rooted while it aims: ram it.
        if (giUseful && ready(GI) && facing && me.grounded && Math.abs(dy) < me.H * 0.6 && gap <= RAM_DIST * me.H * 0.9 && !braceBlocksRam) {
          S.lastAttackT = me.time;
          return { ...base, close: true };
        }
      }

      // 4. Cornered with the foe close: swap sides.
      if (roomBehind < 1.6 && gap < 2.2 && !kite) {
        if (tpReady) return { ...base, mobility: true };
        if (me.grounded && foe.grounded && foe.H < 2.6) { S.hopUntil = me.time + 0.6; return { ...base, want: dir, jumpPressed: true, jumpHeld: true }; }
      }
      if (me.time < S.hopUntil && !me.grounded) return { ...base, want: dir, jumpHeld: true };

      // 5. Opportunities.
      const eta = foeETA(gap, dist);
      const busy = foeBusyLeft();
      const pushT = Math.min(0.6, Math.max(0, idleFor - 5) * 0.06) + (desperate ? 0.4 : 0);
      const myLaunch = AIM_MIN + 1.1;
      const aimA = facingAimHits();
      const pgReady = pgUseful && ready(PG);
      const canRam = giUseful && ready(GI) && me.grounded && Math.abs(dy) < me.H * 0.6 && !braceBlocksRam && !(foe.flying && dy > me.H * 0.5);
      const ramGapOk = gap <= RAM_DIST * me.H * 0.92;

      // Their Counter braced: my special beam goes through it.
      if (foeBraced && fk.control === 'Counter' && pgReady && aimA !== null && facing) return startAim('shot', dir);

      if (pgReady && aimA !== null && !braceBlocksBeam) {
        const safe = eta > myLaunch - pushT;
        const kiteSafe = eta > myLaunch + 0.5;
        if ((kite ? kiteSafe : safe) || (busy > myLaunch - 0.2)) {
          if (facing) return startAim('shot', dir);
          return { ...base, face: dir };
        }
      }

      // Ram: the foe is rooted (aiming, charging, recovering) or walking into me.
      if (canRam && ramGapOk && facing && !kite) {
        const rooted = busy > 0.25 && !foe.ramming;
        const walkingIn = gap < Math.max(1.2, foe.H * 1.45 - foF + 0.6) && !foe.busy;
        const brawlGo = brawl && (rooted || gap > RAM_DIST * me.H * 0.4) && eta > 0.5;
        if (rooted || walkingIn || brawlGo || (desperate && gap < RAM_DIST * me.H * 0.9)) {
          S.lastAttackT = me.time;
          return { ...base, close: true };
        }
      }

      // 6. Spacing.
      // Ideal centre distance: just inside my beam's reach (beams), or the edge of my ram's run (brawl).
      let D = pgUseful ? Math.min(me.beamRange * 0.82 + myF * 0.5, me.beamRange + myF - 0.4) : RAM_DIST * me.H * 0.85 + myF + foF;
      // A foe up high: stand further out so my aim cone can reach it.
      if (dy > me.H * 0.6) D = Math.max(D, dy / Math.tan(AIM_ANGLE * 0.9));
      if (kite) D = 8.5;
      const lo = Math.max(CLASH_MIN + 0.2, D - 1.1), hi = D + 0.6;

      if (dist < lo) {
        // Too close: out (keeping my face to it with a back dash), else ram it off, else walk.
        if (canRam && ramGapOk && facing && gap < 1.0 && !kite && eta < 0.9) { S.lastAttackT = me.time; return { ...base, close: true }; }
        if (bdReady && roomBehind > backDashLen + 0.3 && (gap < 2.2 || kite)) return { ...base, dash: true };
        if (roomBehind > 1.2) return { ...base, want: -dir };
        if (tpReady && gap < 2.5) return { ...base, mobility: true };
        return base;
      }
      if (dist > hi) {
        if (kite) return base;
        // Far off with a dash: in quickly only if it can't punish the arrival.
        if (dist > hi + 4 && ready('Dash') && me.grounded && eta > 1.2 && Math.random() < 0.05) return { ...base, want: dir, dash: true };
        return { ...base, want: dir };
      }
      return base;
    };

    return (t) => {
      try { return think(t); }
      catch (e) {
        mem.errors++;
        if (mem.errors <= 3) throw e;      // the first few reach the organiser's log
        return idle(Math.sign(foe.x - me.x) || 1);
      }
    };
  },
};
