// Tribute d9: Tyranitar (Rock/Dark), "The Answering Mountain".
// Core idea: a tank that never swings first into a fresh brace. It waits for the foe to COMMIT to a blow, then braces
// Sucker Punch so the blow lands inside the 1 s window: no damage taken, 1.5x the blow's damage turned back (huge against
// Fighting / Water / Ground / Steel moves, which are super effective on Tyranitar). With Sucker Punch cooling, it rams
// (Head Smash: a 13 u/s gap-closer that pushes through ranged fire and breaks aims) and chips with Meteor Beam at range.
// It only ever reads the game and returns intents.
(function () {
  const SLUG = 'd9-tyranitar';
  window.__brains = window.__brains || {};
  window.__brains[SLUG] = {
    name: 'The Answering Mountain',
    species: 'Tyranitar',
    kit: { ranged: 'Meteor Beam', close: 'Head Smash', control: 'Sucker Punch' },
    strategy: 'Wait for the foe to commit, then brace Sucker Punch so its blow lands in the window and comes back 1.5x; ' +
      'while the brace cools, Head Smash rams through beams and aims, Meteor Beam chips from range, and fresh enemy braces are baited out with short rams.',

    make({ me, foe, arena, Fighter, consts, memory }) {
      const C = consts || {};
      const AIM_ANGLE = C.AIM_ANGLE || 0.6;
      const RAM_DIST = C.RAM_DIST || 3.2;
      const QUICK_DIST = C.QUICK_DIST || 3.2;
      const BRACES = C.BRACES || new Set(['Sucker Punch', 'Counter', 'Detect']);
      const isRam = (m) => { try { return !!C.isRamMove && C.isRamMove(m); } catch (e) { return false; } };
      const isQuick = (m) => { try { return !!C.isQuickStrike && C.isQuickStrike(m); } catch (e) { return false; } };
      const isBallMove = (m) => { try { return !!C.isBall && C.isBall(m); } catch (e) { return false; } };
      const getMove = (m) => { try { return C.getMove ? C.getMove(m) : null; } catch (e) { return null; } };
      const BEHIND = new Set(['Shadow Sneak', 'Feint']);
      const QUAKE_R = (11 * 0.94) / 2 * 1.1;
      const CLASH_MIN = (11 * 0.94) / 2 * 0.6;
      const BEAM_CHARGE = 1.1, FRONT_TIME = 0.6;
      const RANGED = 'Meteor Beam', CLOSE = 'Head Smash', BRACE = 'Sucker Punch';

      const foeKey = String(foe.name || 'foe').replace(/ \((you|boss)\)$/, '');
      memory.d9 = memory.d9 || {};
      const mem = (memory.d9[foeKey] = memory.d9[foeKey] || { baits: 0, baitBites: 0, braces: 0, counters: 0 });

      // ── state across frames ──
      const ballSeen = new WeakMap();
      let jumpUntil = -1;
      let lastBaitAt = -99, baitWatchUntil = -1;
      let lastEngage = 0;
      let lastFoeHp = foe.hp, lastMyHp = me.hp;
      let myBraceAt = -99;
      let foeBraceEndAt = -99, foeWasCountering = false;

      const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
      const dmgOnMe = (move) => safe(() => foe.damageTo(move, me), 100);
      const myDmg = (move) => safe(() => me.damageTo(move, foe), 100);
      const front = (f) => safe(() => f.reachOf().front, f.W / 2 || 0.5);
      const back = (f) => safe(() => f.reachOf().back, f.W / 2 || 0.5);
      const lineMeets = (from, dir, range, f) => safe(() => Fighter.lineMeets(from, dir, range, f), null);
      const center = (f) => [f.x, f.y + f.H * 0.5];

      /** Seconds till a beam's front, launched at its range, has come `d` along it. */
      const frontTime = (d, range, pace) => {
        const r = Math.max(0.1, range || 8);
        const k = 1 - Math.cbrt(Math.max(0, 1 - Math.min(1, d / r)));
        return (k * FRONT_TIME) / Math.max(0.2, pace || 1);
      };

      /** The foe's blow on its way to me: { tth (s till it lands), dmg, kind, move } — the soonest, or null. */
      function threat() {
        const out = [];
        const dirToMe = Math.sign(me.x - foe.x) || 1;
        const dist = Math.abs(me.x - foe.x);
        const dy = Math.abs(me.y - foe.y);
        const levelBody = dy < Math.max(me.H, foe.H) * 0.8;
        // A beam, charging or pouring, whose line meets me.
        const fb = foe.beam;
        if (fb && fb.pouring !== false && !(fb.struck && fb.struck.has && fb.struck.has(me))) {
          const d = lineMeets(fb.from, fb.dir, (fb.reach || fb.range || 8) + 0.5, me);
          if (d !== null) {
            const ft = frontTime(d, fb.range || fb.reach, fb.pace);
            const tth = fb.launched ? (fb.launchedAt + ft - foe.time - 0.12) : (fb.pressedAt + BEAM_CHARGE - foe.time + ft);
            out.push({ tth, move: fb.move, kind: 'beam' });
          }
        }
        // A ball charging at me (not let go yet).
        const bc = safe(() => foe.ballCharge, null);
        if (bc) {
          const homing = !!(getMove(bc.move) || {}).alwaysHits;
          const d = homing ? Math.hypot(me.x - foe.x, me.y - foe.y) : lineMeets(bc.from, bc.dir, 8.5, me);
          if (d !== null && (!homing || Math.sign(me.x - foe.x) === foe.facing)) {
            out.push({ tth: Math.max(0.5, BEAM_CHARGE - (foe.time - bc.pressedAt)) + d / 9, move: bc.move, kind: 'ballCharge', homing });
          }
        }
        // Balls in flight.
        for (const b of foe.balls || []) {
          if (!b.launched || b.done || !b.play || !b.play.position) continue;
          if (b.passed && b.passed.has && b.passed.has(me)) continue;
          const p = safe(() => b.play.position(), null);
          if (!p) continue;
          const prev = ballSeen.get(b);
          let vx = (b.dir ? b.dir[0] : foe.facing) * 9, vy = (b.dir ? b.dir[1] : 0) * 9;
          if (prev && me.time - prev.t > 1e-3) {
            const dt = me.time - prev.t;
            const ex = (p.x - prev.x) / dt, ey = (p.y - prev.y) / dt;
            if (Math.hypot(ex, ey) > 1) { vx = ex; vy = ey; }
          }
          ballSeen.set(b, { x: p.x, y: p.y, t: me.time });
          const sp = Math.max(2, Math.hypot(vx, vy));
          const [cx, cy] = center(me);
          const rx = cx - p.x, ry = cy - p.y;
          if (b.homing === me) { out.push({ tth: Math.hypot(rx, ry) / sp - 0.05, move: b.move, kind: 'ball', homing: true }); continue; }
          const ux = vx / sp, uy = vy / sp;
          const along = rx * ux + ry * uy;
          const perp = Math.abs(rx * uy - ry * ux);
          if (along > -0.2 && perp < me.H * 0.75) out.push({ tth: Math.max(0, along - front(me)) / sp, move: b.move, kind: 'ball' });
        }
        // A ram coming my way.
        const rm = foe.ramming;
        if (rm && rm.dir === dirToMe && levelBody) {
          const gap = dist - front(foe) - back(me);
          const left = RAM_DIST * foe.H - (rm.ran || 0);
          if (gap <= left + 0.6) out.push({ tth: (rm.go ? 0 : 0.25) + Math.max(0, gap) / 13, move: rm.move, kind: 'contact' });
        }
        // A priority dash or a strike from behind under way.
        if (foe.quick && foe.using) {
          if (isQuick(foe.using) && foe.facing === dirToMe && levelBody && dist <= QUICK_DIST * foe.H + front(foe) + 0.8) out.push({ tth: 0.12, move: foe.using, kind: 'contact' });
          else if (BEHIND.has(foe.using) && Math.hypot(me.x - foe.x, me.y - foe.y) <= 5 * foe.H + 1) out.push({ tth: 0.15, move: foe.using, kind: 'contact' });
        }
        // Its close move under way (flurry / slash), or Earthquake, or Stone Edge.
        if (foe.firing && foe.using) {
          const u = foe.using;
          if (u === 'Earthquake') {
            if (me.grounded && dist <= QUAKE_R + 0.6) out.push({ tth: 0.25, move: u, kind: 'quake' });
          } else if (u === 'Stone Edge') {
            out.push({ tth: 0.55, move: u, kind: 'edge' });
          } else if (u === (foe.moves && foe.moves.close) && !isRam(u)) {
            const reach = safe(() => foe.reachWith(u), foe.H * 1.3);
            if (dist <= reach + back(me) + 0.4 && dy < me.H) out.push({ tth: 0.12, move: u, kind: 'contact' });
          }
        }
        // A stock-bot tell for a contact move, with me in its reach.
        if (foe.telling && !foe.busy) {
          const u = foe.telling;
          if (u !== 'Earthquake' && !BRACES.has(u) && u !== (foe.moves && foe.moves.ranged)) {
            const reach = safe(() => foe.reachWith(u), foe.H * 1.3);
            if (dist <= reach + back(me) + 0.5 && levelBody) out.push({ tth: 0.4, move: u, kind: 'contact' });
          }
        }
        let best = null;
        for (const o of out) {
          o.dmg = dmgOnMe(o.move);
          if (o.dmg <= 0) continue; // immune (Psychic on Dark): ignore it
          if (!best || o.tth < best.tth) best = o;
        }
        return best;
      }

      /** Aim (−1 … 1) for my beam at the foe, leading it a little; and whether that line meets it in range. */
      function beamAim() {
        const [mx, my] = safe(() => me.mouth(), [me.x, me.y + me.H * 0.7]);
        const lead = 0.35;
        const tx = foe.x + (foe.vx || 0) * lead, ty = foe.y + foe.H * 0.5 + (foe.flying ? (foe.vy || 0) * lead * 0.5 : 0);
        const ang = Math.atan2(ty - my, Math.max(0.3, Math.abs(tx - mx)));
        let aim = Math.max(-1, Math.min(1, ang / AIM_ANGLE));
        const range = safe(() => me.beamRange, 8);
        let d = lineMeets([mx, my], safe(() => me.aimDir(aim), [me.facing, 0]), range, foe);
        if (d === null) {
          for (const a of [aim * 0.7, aim * 1.15, 0, 1, -1]) {
            const aa = Math.max(-1, Math.min(1, a));
            const dd = lineMeets([mx, my], safe(() => me.aimDir(aa), [me.facing, 0]), range, foe);
            if (dd !== null) { aim = aa; d = dd; break; }
          }
        }
        let walled = false;
        if (d !== null && arena && Fighter.pillarAlong) {
          const w = safe(() => Fighter.pillarAlong(arena, [mx, my], me.aimDir(aim), d), null);
          walled = w !== null && w < d;
        }
        return { aim, meets: d !== null && !walled, d };
      }

      const idle = () => ({ want: 0, aim: 0, jumpHeld: false, jumpPressed: false, sink: false, ranged: false, close: false, mobility: false, control: false, dash: false });

      return (t) => {
        const i = idle();
        const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx);
        const dy = foe.y - me.y;
        i.face = dir;
        if (me.down || foe.down) return i;

        // Bookkeeping: damage exchanged, foe brace ending, bait results.
        if (foe.hp < lastFoeHp || me.hp < lastMyHp) lastEngage = me.time;
        lastFoeHp = foe.hp; lastMyHp = me.hp;
        if (foeWasCountering && !foe.countering) foeBraceEndAt = me.time;
        if (!foeWasCountering && foe.countering && me.time < baitWatchUntil) { mem.baitBites++; baitWatchUntil = -1; }
        foeWasCountering = foe.countering;

        // In a clash: stop my number near the top.
        if (me.clashing) {
          const n = safe(() => me.clashing.needle(), null);
          if (n !== null && safe(() => me.clashing.stopped(), null) === null && n >= 0.93) i.ranged = true;
          return i;
        }

        // Aiming my beam: keep the line on the foe (it fires once the line gets there).
        if (me.aiming) {
          const b = beamAim();
          i.aim = b.aim;
          return i;
        }

        const ramReach = RAM_DIST * me.H;
        const gap = dist - (front(me) + front(foe));
        const facing = me.facing === dir;
        const level = Math.abs(dy) < me.H * 0.45 && !(foe.flying && dy > me.H * 0.3);
        const myShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp;
        const lateLead = t > 128 && myShare > foeShare + 0.02;
        const spReady = me.ready(BRACE);
        const hsReady = me.ready(CLOSE) && me.grounded;
        const mbReady = me.ready(RANGED);
        const fc = foe.moves && foe.moves.control;
        const foeBraceKind = fc && BRACES.has(fc) ? fc : null;
        const foeFree = !foe.busy;
        const foeBraceUp = !!foeBraceKind && (foe.countering || (foe.ready(fc) && foeFree));
        // Head Smash recoil: never ram myself to death.
        const hsDmg = myDmg(CLOSE);
        const recoilOk = (hsDmg * 0.5) < me.hp - 1 || hsDmg >= foe.hp * 1.6;
        // Can a ram land on it now (level, facing, in reach)?
        const ramOn = hsReady && facing && level && gap <= ramReach * 0.92 && gap > -0.5 && recoilOk;

        // Keep a dodge jump held to its top.
        if (me.time < jumpUntil) i.jumpHeld = true;

        const th = threat();

        if (me.busy) return i;

        // ── 1. A blow committed and about to land: brace (Sucker Punch turns it back). ──
        if (th) {
          const reflect = 1.5 * th.dmg;
          const window = th.kind === 'contact' ? 0.95 : 0.8;
          if (spReady && th.tth <= window) {
            // (A ram through it would hurt it more and stop it — e.g. its beam still charging, me in reach.)
            const ramBetter = ramOn && (th.kind === 'beam' || th.kind === 'ballCharge') && th.tth > 0.5 && hsDmg * 0.85 > reflect * 1.2;
            if (!ramBetter) { i.control = true; myBraceAt = me.time; mem.braces++; return i; }
            i.close = true; return i;
          }
          if (!spReady || th.tth > window) {
            // Its beam or ball charging at me: ram through it (contact beats a ranged attacker).
            if ((th.kind === 'beam' || th.kind === 'ballCharge') && ramOn && th.tth > 0.35 && (!spReady || hsDmg * 0.85 > reflect)) { i.close = true; return i; }
            // Its beam charging: fire back for a clash I'd win (power x type), far enough not to burst.
            if (!spReady && th.kind === 'beam' && mbReady && th.tth > 0.6 && facing && dist > CLASH_MIN + 0.5) {
              const fb = foe.beam;
              const mine = safe(() => me.clashTerms(RANGED, fb.move), null), theirs = safe(() => foe.clashTerms(fb.move, RANGED), null);
              if (fb && !fb.launched && mine && theirs && mine.P * mine.E >= theirs.P * theirs.E * 1.05) {
                const b = beamAim();
                i.aim = b.aim; i.ranged = true; return i;
              }
            }
            if (spReady && th.tth > window) {
              // Brace soon: hold still, facing it (moving would only spoil the timing).
              return i;
            }
            // No brace: get out of its way.
            if (th.kind === 'beam' || (th.kind === 'ball' && !th.homing) || th.kind === 'ballCharge' || th.kind === 'quake' || th.kind === 'edge') {
              const when = th.kind === 'quake' ? 0.3 : th.kind === 'edge' ? 0.45 : 0.3;
              if (me.grounded && th.tth <= when && !th.homing) { i.jumpPressed = true; i.jumpHeld = true; jumpUntil = me.time + 0.45; return i; }
              if (th.kind === 'beam' || th.kind === 'ballCharge') return i;
            } else if (th.kind === 'contact') {
              if (foe.ramming && me.grounded) { i.jumpPressed = true; i.jumpHeld = true; jumpUntil = me.time + 0.45; return i; }
              if (me.ready('Back Dash') && me.grounded) { i.want = 0; i.dash = true; return i; }
              if (me.grounded) { i.jumpPressed = true; i.jumpHeld = true; jumpUntil = me.time + 0.45; return i; }
            }
          }
        }

        // ── 2. Its brace up: never walk into it. Bait it out from beyond reach, then punish its lag. ──
        if (foe.countering) {
          // Back off a little so the punish ram has its run-up.
          if (gap < ramReach * 0.55 && me.grounded) { i.want = -dir; }
          return i;
        }
        const foeLagged = (foe.lagUntil || 0) > foe.time;
        const sinceFoeBrace = me.time - foeBraceEndAt;
        const vulnerable = foe.stunned || !!foe.aiming || !!foe.beam || foe.firing || foe.quick || !!foe.ramming || foeLagged
          || !!safe(() => foe.ballCharge, null) || (foeBraceKind && !foe.ready(fc) && sinceFoeBrace < 3);
        // Counter turns back physical blows only: my Meteor Beam is safe from it.
        const braceStopsRam = foeBraceUp && foeBraceKind !== 'Detect';
        const braceStopsBeam = foeBraceUp && foeBraceKind === 'Sucker Punch';

        // Late with the lead: run the clock, answering only what comes.
        if (lateLead) {
          if (vulnerable && ramOn && !braceStopsRam && gap > ramReach * 0.3) { i.close = true; return i; }
          if (gap < ramReach * 0.9 && me.grounded) { const away = -dir; if (Math.abs(me.x + away * 1.5) < 10) i.want = away; }
          return i;
        }

        // ── 3. Punish: it is busy (aiming, firing, lagging, flinching) — ram it. ──
        if (ramOn && (vulnerable || !foeBraceUp)) {
          // (Its brace up and it free to use it: wait — unless it is busy.)
          if (!(braceStopsRam && foeFree)) { i.close = true; lastEngage = me.time; return i; }
        }

        // ── 4. Bait a fresh brace out with a ram that can't reach. ──
        const patience = me.time - lastEngage;
        const baitWorth = mem.baits < 4 || mem.baitBites / Math.max(1, mem.baits) > 0.25;
        if (foeBraceUp && foeFree && hsReady && facing && level && gap > ramReach + 1.1 && gap < ramReach + 3.5
            && me.time - lastBaitAt > 2.2 && baitWorth && recoilOk) {
          i.close = true; lastBaitAt = me.time; baitWatchUntil = me.time + 0.8; mem.baits++; return i;
        }

        // ── 5. Meteor Beam: from range, at a flier, or at a Counter user. ──
        const b = beamAim();
        const foeThreatReach = Math.max(
          isRam(foe.moves && foe.moves.close) ? RAM_DIST * foe.H : foe.H * 1.4,
          isQuick(foe.moves && foe.moves.mobility) ? QUICK_DIST * foe.H : 0,
          (foe.moves && BEHIND.has(foe.moves.mobility)) ? 5 * foe.H : 0);
        const foeFar = gap > foeThreatReach + 1.2;
        const aloft = foe.flying || dy > me.H * 0.6;
        const beamSafe = !braceStopsBeam && (foeFar || aloft || (foe.stunned && gap > 2.5));
        if (mbReady && b.meets && beamSafe && me.grounded && dist > 2.2) {
          // (Turn first; the line comes round as it aims.)
          if (!facing) return i;
          i.aim = b.aim; i.ranged = true; lastEngage = me.time; return i;
        }

        // ── 6. Patience spent and nothing coming: press in (it is my lead to lose only at timeout). ──
        const behind = myShare < foeShare - 0.01;
        if (ramOn && !(braceStopsRam && foeFree) ) { i.close = true; return i; }
        if (ramOn && braceStopsRam && foeFree && patience > (behind ? 6 : 11) && (t > 100 || behind)) { i.close = true; lastEngage = me.time; return i; }

        // ── 7. Footwork: hold at ram range (its blows come to my brace); close in when far; stay out from under a flier. ──
        let want = 0;
        const holdAt = spReady ? ramReach * 0.75 : ramReach * 0.6;
        if (aloft) {
          // Under a flier: keep some distance so the beam can angle up at it.
          if (dist < 3) want = -dir; else if (dist > 6.5) want = dir;
        } else if (gap > holdAt + 0.6) want = dir;
        else if (gap < 0.6 && spReady && !hsReady) want = -dir; // too close to set up anything: step out
        // Never back into a wall.
        if (want && Math.abs(me.x + want * 1.2) > 10.3) want = 0;
        i.want = want;
        if (want === dir && gap > holdAt + 4 && me.ready('Dash') && me.grounded && facing) i.dash = true;
        // A pillar between us: over it.
        if (want === dir && arena && Fighter.pillarAlong) {
          const w = safe(() => Fighter.pillarAlong(arena, [me.x, me.y + 0.3], [dir, 0], Math.min(dist, 2.5)), null);
          if (w !== null && me.grounded) { i.jumpPressed = true; i.jumpHeld = true; jumpUntil = me.time + 0.45; }
        }
        return i;
      };
    },
  };
})();
