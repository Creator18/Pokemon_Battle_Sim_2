// Hunger Games tribute d1-charizard: "Skyreign" (Charizard, Fire/Flying).
// Reads the game, returns intents. Changes nothing.
(() => {
  const SLUG = 'd1-charizard';
  window.__brains = window.__brains || {};
  window.__brains[SLUG] = {
    name: 'Skyreign',
    species: 'Charizard',
    kit: { ranged: 'Fire Blast', close: 'Flare Blitz', mobility: 'Quick Attack', control: 'Detect' },
    strategy: 'Space at the edge of Flare Blitz range and ram anything that walks in, aims or charges (contact cuts ranged attacks off); '
      + 'Fire Blast from range or into a foe locked in its move, win clashes it can win, Detect or fly over blows it cannot. '
      + 'Once ahead on HP share it guards the lead: no walk-in rams, only interrupts, punishes and safe Fire Blast pokes from outside its reach.',

    make({ me, foe, arena, Fighter, consts, memory }) {
      const C = consts;
      const AA = C.AIM_ANGLE;
      const K = me.moves || {};
      const RANGED = K.ranged, CLOSE = K.close, MOB = K.mobility, CTRL = K.control;
      const BRACES = C.BRACES;
      // (Game constants not passed in: ball / beam charge, ram wind-up and speed, clash distance, flight cap.)
      const BALL_CHARGE = 1.0, BEAM_CHARGE = 1.1, RAM_WIND = 0.5, RAM_SPEED = 13, CLASH_MIN = 3.15, FLY_CAP = 6;

      const foeKey = String(foe.name || 'foe').replace(/ \((you|boss)\)$/, '');
      const mem = (memory[foeKey] = memory[foeKey] || { battles: 0 });
      mem.battles++;

      let clashPrev = null;
      let foeBracedPrev = false, punishTill = -1;

      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const dmg = (move, by, on) => { try { return move ? by.damageTo(move, on) : 0; } catch (e) { return 0; } };
      const cdLeft = (f, move) => (move ? Math.max(0, (f.readyAt.get(move) ?? -Infinity) - f.time) : Infinity);
      const levelWith = (a, b, slack = 0) => a.y < b.y + b.H + slack && a.y + a.H > b.y - slack;
      const lineThick = (from, d, range, f, r) => {
        let best = null;
        for (const off of [0, r, -r]) {
          const m = Fighter.lineMeets([from[0], from[1] + off], d, range, f);
          if (m !== null && (best === null || m < best)) best = m;
        }
        return best;
      };
      // (Clash odds: my ranged against theirs — >1 mine stronger. Outright: ahead on both power and type.)
      const clashEdge = (theirs) => {
        try {
          const a = me.clashTerms(RANGED, theirs), b = foe.clashTerms(theirs, RANGED);
          const outrightMine = a.P >= b.P && a.E >= b.E && (a.P > b.P || a.E > b.E);
          const outrightTheirs = b.P >= a.P && b.E >= a.E && (b.P > a.P || b.E > a.E);
          return { k: (a.P * a.E) / (b.P * b.E), mine: outrightMine, theirs: outrightTheirs };
        } catch (e) { return { k: 0, mine: false, theirs: true }; }
      };

      return (t) => {
        const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx);
        const out = { want: 0, face: dir, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
          ranged: false, close: false, mobility: false, control: false, dash: false };
        if (me.down || foe.down) return out;

        // ── In a clash: stop the needle at the top of its run. ──
        if (me.clashing) {
          const n = me.clashing.needle();
          if (n === null || me.clashing.stopped() !== null) { clashPrev = null; return out; }
          const press = n >= 0.95 || (clashPrev !== null && clashPrev >= 0.85 && n < clashPrev);
          clashPrev = n;
          return { ...out, ranged: press };
        }
        clashPrev = null;

        // ── Geometry. ──
        const [mx, my] = me.mouth();
        const ty = foe.y + foe.H * 0.5;
        const aimAt = clamp(Math.atan2(ty - my, Math.max(0.3, Math.abs(foe.x - mx))) / AA, -1, 1);
        const aimDirAt = (a) => [dir * Math.cos(a * AA), Math.sin(a * AA)];
        const shotClear = (a) => {
          const d = aimDirAt(a), from = [mx, my];
          const hit = Fighter.lineMeets(from, d, me.beamRange, foe);
          if (hit === null) return false;
          const wall = Fighter.nearer(Fighter.pillarAlong(arena, from, d, me.beamRange), Fighter.groundAlong(arena, from, d, me.beamRange));
          return wall === null || wall > hit;
        };
        const front = me.reachOf().front;
        const [flo, fhi] = foe.span();
        const gap = dir > 0 ? flo - (me.x + front) : (me.x - front) - fhi;
        const ramLen = C.RAM_DIST * me.H;
        const approach = -(foe.vx || 0) * dir; // + : coming at me
        const predGap = gap - approach * RAM_WIND * 0.7;
        const lvl = levelWith(me, foe);
        const facing = me.facing === dir;
        const pillarInWay = Fighter.pillarAlong(arena, [me.x, me.y + me.H * 0.5], [dir, 0], Math.max(0.2, gap + 0.5)) !== null;
        const ramDmg = dmg(CLOSE, me, foe), qaDmg = dmg(MOB, me, foe);
        const canRam = !!CLOSE && me.ready(CLOSE) && (me.grounded || me.flying) && lvl && ramDmg > 0 && !pillarInWay;
        const ramIn = canRam && predGap <= ramLen * 0.92 && gap > -0.4;
        const canQA = !!MOB && C.isQuickStrike(MOB) && me.ready(MOB) && qaDmg > 0 && lvl && gap <= C.QUICK_DIST * me.H * 0.9 && gap > 0.2 && !pillarInWay;
        const canDetect = CTRL === 'Detect' && me.ready(CTRL) && !me.countering;
        const fbReady = !!RANGED && me.ready(RANGED) && dmg(RANGED, me, foe) > 0;
        const hpShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp, lead = hpShare - foeShare;
        const toMe = Math.sign(me.x - foe.x) || -foe.facing;
        const foeFacingMe = foe.facing === toMe;

        // ── The foe's brace: waited out, then punished while it cools. ──
        if (foeBracedPrev && !foe.countering && foe.moves.control && !foe.ready(foe.moves.control)) punishTill = t + 1.8;
        foeBracedPrev = foe.countering;
        const punishing = t < punishTill;

        // ── Altitude. ──
        let wantY = 0;
        const flyTo = (o, y) => {
          if (me.flying) {
            if ((me.flightLeft ?? 5) < 0.7) { o.sink = true; return; }
            const err = y - me.y;
            if (err > 0.08) o.jumpHeld = true;
            else if (err < -0.7) o.sink = true;
          } else if (y > me.y + 0.5) { o.jumpPressed = true; o.jumpHeld = true; }
        };
        const fightY = () => Math.min(Math.max(0.5, foe.y + foe.H * 0.5 - me.H * 0.5), me.H * 2.2);
        wantY = me.flying || foe.y > me.H * 0.7 ? fightY() : 0;

        // ── Busy: keep the aim on the foe, hold altitude. ──
        if (me.busy) {
          const o = { ...out, aim: me.aiming ? aimAt : out.aim };
          if (me.flying) flyTo(o, wantY);
          return o;
        }

        // ── Threats. ──
        const foeDmg = (m) => dmg(m, foe, me);
        // A beam or ball charging (or pouring) on a line through me.
        let lineT = null;
        const fb = foe.beam || foe.ballCharge;
        if (fb && foeFacingMe && foeDmg(fb.move) > 0 && !(fb.launched && fb.pouring === false)) {
          const isBallC = !foe.beam;
          const d = lineThick(fb.from, fb.dir, (fb.range || 8) + 0.6, me, isBallC ? 0.3 * foe.H : 0.12);
          if (d !== null) {
            const rem = fb.launched ? 0 : Math.max(0, (isBallC ? BALL_CHARGE : BEAM_CHARGE) - (foe.time - fb.pressedAt));
            lineT = { rem, launched: !!fb.launched, from: fb.from, dir: fb.dir, move: fb.move };
          }
        }
        // A ball in flight at me.
        let ballT = null;
        for (const b of foe.balls || []) {
          if (!b.launched || b.done || !b.play || !b.play.position) continue;
          if (foeDmg(b.move) <= 0) continue;
          const p = b.play.position();
          let d;
          if (b.homing === me) d = Math.hypot(p.x - me.x, p.y - (me.y + me.H * 0.5));
          else d = lineThick([p.x, p.y], b.dir, 9, me, 0.3 * foe.H);
          if (d !== null && (!ballT || d < ballT.d)) ballT = { d, p, dir: b.dir, homing: b.homing === me };
        }
        // A blow about to land.
        let blowT = null;
        const myBack = me.reachOf().back;
        const r = foe.ramming;
        if (r && r.dir === toMe && levelWith(me, foe, 0.1) && foeDmg(r.move) > 0) {
          const ffront = foe.reachOf().front;
          const [ml, mh] = me.span();
          const g = toMe > 0 ? ml - (foe.x + ffront) : (foe.x - ffront) - mh;
          if (g <= C.RAM_DIST * foe.H - (r.ran || 0) + 0.8) blowT = { move: r.move, ram: true };
        }
        const tell = foe.telling;
        if (!blowT && tell && tell !== foe.moves.ranged && !BRACES.has(tell) && foeDmg(tell) > 0 && tell !== 'Stone Edge'
          && dist <= foe.reachWith(tell) + myBack + 0.6 && levelWith(me, foe, 1)) blowT = { move: tell, tell: true };
        if (!blowT && foe.firing && foe.using && foe.using === foe.moves.close && foe.using !== 'Earthquake' && foeDmg(foe.using) > 0
          && foe.time - foe.usingSince < 0.35 && dist <= foe.reachWith(foe.using) + myBack + 0.3 && levelWith(me, foe, 0.5)) blowT = { move: foe.using };
        if (!blowT && foe.quick && foe.using && foeDmg(foe.using) > 0 && (C.isQuickStrike(foe.using) || foe.using === 'Feint' || foe.using === 'Shadow Sneak')
          && dist <= foe.reachWith(foe.using) + 0.6) blowT = { move: foe.using, quick: true };
        const edgeT = (foe.telling === 'Stone Edge' || (foe.firing && foe.using === 'Stone Edge')) && foeDmg('Stone Edge') > 0;
        const foeAiming = !!foe.aiming && foeFacingMe && dist <= foe.beamRange + 3;
        const foeTellRanged = !!tell && tell === foe.moves.ranged && foeFacingMe;

        // Answers.
        const ram = (why) => ({ ...out, close: true, why });
        const qa = () => ({ ...out, mobility: true, aim: me.grounded ? 0 : aimAt });
        const fire = () => ({ ...out, ranged: true, aim: aimAt });
        const detect = () => ({ ...out, control: true });
        const dodgeLine = (from, d) => {
          // Off the line: over it or under it, whichever is nearer.
          const o = { ...out };
          const lx = Math.abs(d[0]) > 1e-3 ? from[1] + (d[1] / d[0]) * (me.x - from[0]) : me.y + me.H;
          const mid = me.y + me.H * 0.5;
          if (lx <= mid || me.grounded) { flyTo(o, lx + 0.35 * foe.H + 0.6); if (me.grounded) { o.jumpPressed = true; o.jumpHeld = true; } }
          else { o.sink = true; }
          o.want = 0;
          return o;
        };
        const finish = (o) => { if (!o.jumpPressed && !o.jumpHeld && !o.sink) flyTo(o, wantY); return o; };

        // ── Blows coming: Detect, or out of the way. ──
        if (blowT) {
          if (canDetect) return detect();
          if (blowT.ram) { const o = { ...out }; flyTo(o, foe.y + foe.H + 0.6); o.jumpPressed = me.grounded; o.jumpHeld = true; return o; }
          if (me.ready('Back Dash') && (me.grounded || me.flying)) return { ...out, dash: true, want: 0 };
          const o = { ...out, want: -dir }; o.jumpPressed = me.grounded; o.jumpHeld = true; return o;
        }
        if (edgeT) {
          if (canDetect && foe.firing) return detect();
          const o = { ...out }; o.jumpPressed = me.grounded; o.jumpHeld = true; return o;
        }

        // ── A beam / ball charging at me: cut it off, out-clash it, or leave its line. ──
        if (lineT && !lineT.launched) {
          if (ramIn && facing && !foe.countering && lineT.rem > RAM_WIND + Math.max(0, gap) / RAM_SPEED + 0.05) return finish(ram('interrupt charge'));
          if (canQA && facing && !foe.countering && lineT.rem > 0.2) return finish(qa());
          const ce = clashEdge(lineT.move);
          const aimTime = Math.max(C.AIM_MIN, Math.abs(aimAt) / C.AIM_RATE) + 0.06;
          if (fbReady && facing && dist >= CLASH_MIN + 0.3 && lineT.rem > aimTime && !ce.theirs && (ce.mine || ce.k > 0.9)) return finish(fire());
          if (lineT.rem < 0.35 && canDetect) return detect();
          if (lineT.rem < 0.9) return dodgeLine(lineT.from, lineT.dir);
          // Time in hand: close in to ram it if that works out, else get clear.
          if (canRam && gap - ramLen < 4.2 && gap > ramLen * 0.9 && me.ready('Dash') && facing) return finish({ ...out, want: dir, dash: true });
          return dodgeLine(lineT.from, lineT.dir);
        }
        if (lineT && lineT.launched) {
          if (canDetect) return detect();
          return dodgeLine(lineT.from, lineT.dir);
        }
        if (ballT) {
          if (canDetect && ballT.d < 2.2) return detect();
          if (!ballT.homing && ballT.d < 4.5) return dodgeLine([ballT.p.x, ballT.p.y], ballT.dir);
        }

        // ── Lead in hand: guard it. No walk-in rams; only cut off aims and charges, punish locked foes, and poke
        // with Fire Blast from outside its reach; otherwise keep out of its reach on the ground (no stalling aloft). ──
        const killable = ramDmg * 0.7 >= foe.hp || dmg(RANGED, me, foe) >= foe.hp;
        const guarding = lead > 0.035 && !killable;

        // ── Its brace up: don't swing into it (Fire Blast is special — Counter lets it through). ──
        if (foe.countering && !punishing) {
          if (foe.moves.control === 'Counter' && fbReady && facing && shotClear(aimAt)) return finish(fire());
          const o = { ...out };
          if (gap < ramLen * 0.6) o.want = -dir;
          return finish(o);
        }

        // ── It is aiming / about to aim at me: cut it off. ──
        if ((foeAiming || foeTellRanged) && facing) {
          if (ramIn) return finish(ram('interrupt aim'));
          if (canQA) return finish(qa());
          if (canRam && gap > ramLen * 0.9 && gap - ramLen < 4.2 && me.ready('Dash') && me.grounded) return finish({ ...out, want: dir, dash: true });
        }

        // ── Offense. ──
        const foeLocked = foe.stunned || (foe.firing && foe.using && foe.using !== foe.moves.control) || !!foe.aiming || (foe.busy && !foe.inContactMove());
        if (facing && ramIn && (killable || foeLocked || punishing)) return finish(ram('punish'));
        if (facing && canQA && (foe.stunned || foe.aiming) && !canRam) return finish(qa());
        // Foe's contact reach, and how soon it can use it.
        let foeReach = foe.H * C.CLOSE_REACH * 1.45;
        let foeContactCd = Infinity;
        if (foe.moves.close && foe.moves.close !== 'Earthquake' && foeDmg(foe.moves.close) > 0) {
          foeReach = Math.max(foeReach, foe.reachWith(foe.moves.close)); foeContactCd = Math.min(foeContactCd, cdLeft(foe, foe.moves.close));
        }
        if (foe.moves.mobility && (C.isQuickStrike(foe.moves.mobility) || foe.moves.mobility === 'Teleport') && foeDmg(foe.moves.mobility) !== 0) {
          foeReach = Math.max(foeReach, C.QUICK_DIST * foe.H + foe.reachOf().front); foeContactCd = Math.min(foeContactCd, cdLeft(foe, foe.moves.mobility));
        }
        const foeBraceUp = foe.moves.control && (foe.moves.control === 'Sucker Punch' || foe.moves.control === 'Counter') && foe.ready(foe.moves.control);
        if (facing && ramIn && !guarding && !foe.inContactMove() && (!foeBraceUp || Math.random() < 0.02)) return finish(ram('walk-in'));
        const fireSafe = dist > foeReach + 0.6 || foe.stunned || foeContactCd > 1.6 || foeLocked;
        // (Its own shot on the way: only fire into it if the clash would go my way.)
        const rivalShot = (foe.aiming || fb) && foe.moves.ranged && foe.moves.ranged !== 'Stone Edge';
        const clashOk = !rivalShot || (() => { const ce = clashEdge(foe.moves.ranged); return !ce.theirs && (ce.mine || ce.k > 0.9); })();
        if (facing && fbReady && fireSafe && clashOk && shotClear(aimAt)) return finish(fire());

        // ── Spacing. ──
        const o = { ...out };
        const wallBehind = me.x * -dir > 8.8;
        if (!guarding && (canRam || (CLOSE && cdLeft(me, CLOSE) < 0.5))) {
          // Ram ready: walk to the edge of its reach (it fires as they come in).
          if (gap > ramLen * 0.85) {
            o.want = dir;
            if (gap > ramLen + 3 && me.ready('Dash') && (me.grounded || me.flying) && facing && Math.random() < 0.04) o.dash = true;
          } else if (gap < ramLen * 0.45 && !wallBehind) {
            // Too close for a run-up: step back for momentum.
            if (me.ready('Back Dash') && (me.grounded || me.flying) && Math.random() < 0.15) { o.dash = true; o.want = 0; }
            else o.want = -dir;
          }
        } else {
          // Ram cooling: keep out of its reach; poke when Fire Blast is up.
          const keep = Math.max(foeReach + 0.8, ramLen * 0.9);
          if (dist < keep) {
            if (wallBehind) {
              // Cornered: over its head to the open side.
              if (me.flying || me.mayFly) { flyTo(o, foe.y + foe.H + 1.6); if (me.grounded) { o.jumpPressed = true; o.jumpHeld = true; } o.want = dir; return o; }
              if (canDetect && dist < foeReach + 0.3 && foeContactCd < 0.2) return detect();
            } else if (dist < foeReach + 0.3 && me.ready('Back Dash') && (me.grounded || me.flying)) { o.dash = true; o.want = 0; }
            else o.want = -dir;
          } else if (dist > Math.max(keep + 1.5, me.beamRange - 0.5)) o.want = dir;
        }
        return finish(o);
      };
    },
  };
})();
