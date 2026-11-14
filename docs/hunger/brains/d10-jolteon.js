// Tribute d10: Jolteon, "Static Shock".
// Exploits the aiming window (rush any foe that roots itself to aim), wins beam clashes with Electro Shot
// (P = 130 x STAB x 1.1 beats almost every legal beam), Detects rams and punishes the whiff.
window.__brains = window.__brains || {};
window.__brains['d10-jolteon'] = {
  name: 'Static Shock',
  species: 'Jolteon',
  kit: { ranged: 'Electro Shot', close: 'Giga Impact', mobility: 'Extreme Speed', control: 'Detect' },
  strategy: 'Hit-and-run: rush in with Extreme Speed / Giga Impact the moment the foe roots itself to aim, meet its beams with Electro Shot (wins most clashes outright), Detect incoming rams and punish while they cool; Giga Impact and Extreme Speed both hit Ground types. Ahead late, it kites to win on time.',
  make({ me, foe, arena, Fighter, consts, memory }) {
    const C = consts;
    const RANGED = me.moves.ranged, CLOSE = me.moves.close, MOB = me.moves.mobility, CTRL = me.moves.control;
    const CLASH_MIN = (11 * 0.94) / 2 * 0.6; // Fighter's CLASH_MIN (centre to centre)
    const QUAKE_R = (11 * 0.94) / 2 * 1.1;
    const WALL = 10.2;
    const rec = (memory[foe.name] = memory[foe.name] || { battles: 0 });
    rec.battles++;

    const dmg = (move, by, on) => { try { return move ? by.damageTo(move, on) : 0; } catch (e) { return 0; } };
    const mv = (m) => { try { return m ? C.getMove(m) : null; } catch (e) { return null; } };
    // Type effectiveness of an attacking type on one defending type (only what the clash maths needs).
    const CHART = {
      Electric: { Water: 2, Flying: 2, Electric: 0.5, Grass: 0.5, Dragon: 0.5, Ground: 0 },
      Fire: { Grass: 2, Ice: 2, Bug: 2, Steel: 2, Fire: 0.5, Water: 0.5, Rock: 0.5, Dragon: 0.5 },
      Water: { Fire: 2, Ground: 2, Rock: 2, Water: 0.5, Grass: 0.5, Dragon: 0.5 },
      Ground: { Electric: 2, Fire: 2, Poison: 2, Rock: 2, Steel: 2, Grass: 0.5, Bug: 0.5, Flying: 0 },
      Flying: { Grass: 2, Fighting: 2, Bug: 2, Electric: 0.5, Rock: 0.5, Steel: 0.5 },
      Steel: { Ice: 2, Rock: 2, Fairy: 2, Fire: 0.5, Water: 0.5, Electric: 0.5, Steel: 0.5 },
      Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
      Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Steel: 0.5, Dark: 0 },
      Ghost: { Ghost: 2, Psychic: 2, Dark: 0.5, Normal: 0 },
      Fighting: { Normal: 2, Ice: 2, Rock: 2, Dark: 2, Steel: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Fairy: 0.5, Ghost: 0 },
      Normal: { Rock: 0.5, Steel: 0.5, Ghost: 0 },
      Dark: { Psychic: 2, Ghost: 2, Fighting: 0.5, Dark: 0.5, Fairy: 0.5 },
      Ice: { Grass: 2, Ground: 2, Flying: 2, Dragon: 2, Fire: 0.5, Water: 0.5, Ice: 0.5, Steel: 0.5 },
      Rock: { Fire: 2, Ice: 2, Flying: 2, Bug: 2, Fighting: 0.5, Ground: 0.5, Steel: 0.5 },
      Fairy: { Fighting: 2, Dragon: 2, Dark: 2, Fire: 0.5, Poison: 0.5, Steel: 0.5 },
      Grass: { Water: 2, Ground: 2, Rock: 2, Fire: 0.5, Grass: 0.5, Poison: 0.5, Flying: 0.5, Bug: 0.5, Dragon: 0.5, Steel: 0.5 },
      Poison: { Grass: 2, Fairy: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
      Bug: { Grass: 2, Psychic: 2, Dark: 2, Fire: 0.5, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Ghost: 0.5, Steel: 0.5, Fairy: 0.5 },
    };
    const eff = (a, d) => (CHART[a] && CHART[a][d] !== undefined ? CHART[a][d] : 1);
    const clashTerms = (f, move, against) => {
      const m = mv(move), o = mv(against);
      if (!m) return { P: 40, E: 1 };
      const special = String(m.category).toLowerCase() === 'special';
      const stat = special ? f.spAtk / 100 : String(m.category).toLowerCase() === 'physical' ? f.attack / 100 : 1;
      return { P: (m.basePower || 0) * (f.types.includes(m.moveType) ? 1.5 : 1) * stat, E: o ? eff(m.moveType, o.moveType) : 1 };
    };
    // Would my beam win a clash against the foe's ranged move? (outright, or comfortably on timing: I stop near the top.)
    const clashGood = () => {
      if (!RANGED || !foe.moves.ranged || foe.moves.ranged === 'Stone Edge') return false;
      const a = clashTerms(me, RANGED, foe.moves.ranged), b = clashTerms(foe, foe.moves.ranged, RANGED);
      if (a.P >= b.P && a.E >= b.E && (a.P > b.P || a.E > b.E)) return true;
      if (b.P >= a.P && b.E >= a.E && (b.P > a.P || b.E > a.E)) return false;
      return a.P * a.E * 1.9 > b.P * b.E * 1.55 * 1.1;
    };

    const elecHit = dmg(RANGED, me, foe) > 0;
    const zapHit = dmg(MOB, me, foe) > 0;
    const ramHit = dmg(CLOSE, me, foe) > 0;
    const foeRanged = foe.moves.ranged, foeClose = foe.moves.close, foeMob = foe.moves.mobility, foeCtrl = foe.moves.control;
    const foeHasDetect = foeCtrl === 'Detect', foeHasSP = foeCtrl === 'Sucker Punch', foeHasCounter = foeCtrl === 'Counter';

    let lockedAim = null; // aim held while my ranged line swings
    let lastJump = -9, lastDetect = -9, lastAct = -9;
    let quakeSeen = -9;

    const IDLE = C.IDLE;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const aimAt = () => {
      const [mx, my] = me.mouth();
      const want = Math.atan2(foe.y + foe.H * 0.5 - my, Math.max(0.2, Math.abs(foe.x - mx)));
      return clamp(want / C.AIM_ANGLE, -1, 1);
    };
    const lineHits = (aim, range) => {
      try { return Fighter.lineMeets(me.mouth(), me.aimDir(aim), range, foe) !== null; } catch (e) { return false; }
    };
    const foeReach = (m) => { try { return m ? foe.reachWith(m) : 0; } catch (e) { return 0; } };

    return (t) => {
      const dx = foe.x - me.x, dist = Math.abs(dx), dir = Math.sign(dx) || me.facing;
      const dy = foe.y - me.y;
      const base = { ...IDLE, face: dir, aim: 0 };
      if (me.down || foe.down) return base;

      // ── a clash: stop the needle near the top ──
      if (me.clashing) {
        const n = me.clashing.needle();
        if (n === null || me.clashing.stopped() !== null) return { ...IDLE, face: dir };
        return { ...IDLE, face: dir, ranged: n >= 0.955 };
      }

      const aim = aimAt();
      // My line swinging: keep the aim I pressed with, so it fires at once.
      if (me.aiming) return { ...IDLE, face: dir, aim: lockedAim === null ? aim : lockedAim };
      lockedAim = null;

      const front = me.reachOf().front, ffront = foe.reachOf().front;
      const gap = dist - (front + ffront);
      const level = Math.abs(dy) < me.H * 0.6;
      const facingFoe = me.facing === dir;
      const foeFacingMe = foe.facing === -dir;
      const quickReach = C.QUICK_DIST * me.H;
      const ramReach = C.RAM_DIST * me.H;
      const nearWallBehind = (me.x * -dir) > WALL - 1.2; // my back to a wall
      const hpShare = me.hp / me.maxHp, foeShare = foe.hp / foe.maxHp;
      const lead = hpShare - foeShare;
      const safeMode = (t > 115 && lead > 0.06) || (t > 135 && lead > 0.02);

      // ── what the foe is doing ──
      const foeRam = !!foe.ramming;
      const foeQuick = foe.quick && (C.isQuickStrike(foe.using) || foe.using === 'Shadow Sneak' || foe.using === 'Feint' || foe.using === 'Sucker Punch');
      const foeSwing = foe.firing && foe.using && foe.using === foeClose && foeClose !== 'Earthquake';
      const foeTell = foe.telling || '';
      const fb = foe.beam || foe.ballCharge;
      const foeAiming = !!foe.aiming;
      const foeCharging = !!fb && !fb.launched;
      const chargeAge = foeCharging ? foe.time - fb.pressedAt : foeAiming ? -(0.25) : 0;
      const beamLineAtMe = !!fb && (() => { try { return Fighter.lineMeets(fb.from, fb.dir, (fb.range || 8) + 0.6, me) !== null; } catch (e) { return false; } })();
      const rangedThreat = (foeAiming && foeFacingMe && Math.abs(dy) < me.H * 2.2 && foeRanged !== 'Stone Edge') || (foeCharging && beamLineAtMe);
      const foeWindingRanged = foeAiming || foeCharging;
      const foeQuake = foe.using === 'Earthquake' || foeTell === 'Earthquake';
      const foeEdge = foe.using === 'Stone Edge' || foeTell === 'Stone Edge' || (foeAiming && foeRanged === 'Stone Edge');
      const foeBraced = foe.countering;
      const foeVulnerable = foe.stunned || (foe.busy && !foe.inContactMove() && !foeBraced && !foeWindingRanged && foe.using !== 'Earthquake');

      // A contact blow coming at me that will reach.
      let blowComing = false;
      if (foeRam && Math.sign(foe.ramming.dir || foe.facing) === -dir && gap <= C.RAM_DIST * foe.H + 0.8 && Math.abs(dy) < foe.H) blowComing = true;
      if (foeQuick && dist <= C.QUICK_DIST * foe.H + front + ffront + 1) blowComing = true;
      if (foeSwing && dist <= foeReach(foeClose) + me.reachOf().back + 0.4) blowComing = true;
      if (foeTell && foeTell !== 'Earthquake' && foeTell !== foeRanged && !C.BRACES.has(foeTell) && dist <= foeReach(foeTell) + 0.8) blowComing = true;

      // Foe balls in flight at me.
      const ballAtMe = (foe.balls || []).find((b) => {
        if (!b.launched || b.done || !b.play || !b.play.position) return false;
        const p = b.play.position();
        const ahead = (me.x - p.x) * Math.sign(me.x - foe.x || 1);
        return b.homing === me || (ahead > -me.H * 0.3 && ahead < 3.4 && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H);
      });

      const canDetect = CTRL === 'Detect' && me.ready(CTRL) && !me.countering;
      const jump = (want = 0) => { lastJump = t; return { ...base, want, jumpPressed: true, jumpHeld: true }; };
      const detect = () => { lastDetect = t; return { ...base, control: true }; };

      if (me.busy) {
        // Keep holding a jump while airborne; otherwise just watch.
        return { ...base, jumpHeld: !me.grounded && t - lastJump < 0.5 };
      }
      const airborneHold = !me.grounded && t - lastJump < 0.5;

      // ── defence ──
      // A ram still lighting its coat (not running yet) in Zippy reach: strike first, its ram is cut off.
      if (foeRam && !foe.ramming.go && zapHit && facingFoe && me.ready(MOB) && gap <= quickReach * 0.9 && level && !foeBraced) {
        return { ...base, aim: 0, mobility: true };
      }
      if (blowComing) {
        // Detect zips out as it lands: their move is wasted and cools.
        if (canDetect) return detect();
        // A priority dash or ram right on me and nothing to brace with: hit back first if I can win the race.
        if (foeTell && zapHit && facingFoe && level && me.ready(MOB) && gap <= quickReach) return { ...base, aim: 0, mobility: true };
        if (me.grounded && me.ready('Back Dash') && !nearWallBehind) return { ...base, want: 0, dash: true };
        if (me.grounded) return jump(-dir);
      }
      if (foeQuake && me.grounded && dist <= QUAKE_R + 0.6) {
        if (foe.using === 'Earthquake') quakeSeen = t;
        return jump(0);
      }
      if (t - quakeSeen < 1.3 && me.grounded && dist <= QUAKE_R + 0.6) return jump(0);
      if (foeEdge && me.grounded) return jump(0);
      if (ballAtMe) {
        if (canDetect && ballAtMe.homing === me) return detect();
        if (me.grounded) return jump(0);
        if (canDetect) return detect();
      }

      // ── the aiming window: the foe roots itself to fire — punish it ──
      if (rangedThreat || (foeWindingRanged && foeFacingMe)) {
        if (!foeBraced) {
          // Contact moves push through ranged fire and cut the beam off.
          if (zapHit && facingFoe && me.ready(MOB) && gap <= quickReach * 0.95 && (me.grounded || !me.flying)) return { ...base, aim: level ? 0 : aim, mobility: true };
          if (ramHit && facingFoe && me.grounded && level && me.ready(CLOSE) && gap <= ramReach * 0.9) return { ...base, close: true };
          // Meet it: a clash I win (or a point-blank burst that hurts it more than me).
          if (elecHit && facingFoe && me.ready(RANGED) && (foeCharging ? chargeAge < 0.75 : foeAiming)) {
            const far = Math.hypot(dx, dy) >= CLASH_MIN + 0.2;
            const burstOk = dmg(RANGED, me, foe) > dmg(foeRanged, foe, me) * 1.1;
            if ((far && clashGood()) || (!far && burstOk)) {
              lockedAim = aim; lastAct = t;
              return { ...base, aim, ranged: true };
            }
          }
          // Too far to strike yet: close the gap fast (it is rooted).
          const strikeReach = Math.max(zapHit ? quickReach : 0, ramHit ? ramReach : 0);
          const timeLeft = foeCharging ? 1.15 - chargeAge : 1.1;
          if (gap > strikeReach * 0.9 && timeLeft > 0.45 && !safeMode) {
            if (me.ready('Dash') && (me.grounded || me.flying)) return { ...base, want: dir, dash: true };
            return { ...base, want: dir };
          }
        }
        // Can't stop it: get out of its way as it launches.
        if (rangedThreat && foeCharging && chargeAge > 0.8) {
          if (canDetect) return detect();
          if (me.grounded) return jump(0);
        }
        if (rangedThreat && foeCharging && chargeAge > 0.55 && me.grounded && !canDetect) return jump(0);
      }
      // A beam pouring: don't walk into its line.
      if (fb && fb.launched && foe.beam && foe.beam.pouring && !beamLineAtMe) {
        return { ...base, want: 0, jumpHeld: airborneHold };
      }

      // ── its brace up: wait it out (special beats Counter) ──
      if (foeBraced) {
        if (foeHasCounter && elecHit && facingFoe && me.ready(RANGED) && lineHits(aim, me.beamRange)) { lockedAim = aim; return { ...base, aim, ranged: true }; }
        // Step back out of its lunge's reach and let it whiff.
        if (gap < 2.5 && !nearWallBehind) return { ...base, want: -dir, face: dir };
        return base;
      }

      // ── offence ──
      const punish = foeVulnerable;
      // Foe on a cooldown for its brace: free to press.
      const braceDown = !foeCtrl || !C.BRACES.has(foeCtrl) || !foe.ready(foeCtrl);
      const aggressive = !safeMode || punish;

      if (aggressive && facingFoe) {
        // Zippy Zap: priority, no momentum needed. Best right in reach.
        if (zapHit && me.ready(MOB) && gap <= quickReach * 0.92 && gap > -0.2 && (level || Math.abs(dy) < me.H * 1.6)) {
          lastAct = t; return { ...base, aim: dy > me.H * 0.5 ? aim : 0, mobility: true };
        }
        // Giga Impact: a ram, harder from further off; level ground only.
        if (ramHit && me.ready(CLOSE) && me.grounded && level && gap <= ramReach * 0.92 && (gap > ramReach * 0.35 || punish || !zapHit || !me.ready(MOB))) {
          lastAct = t; return { ...base, close: true };
        }
        // Electro Shot: when it can't get to me in time (it's busy, or far off), and the line meets it.
        if (elecHit && me.ready(RANGED) && lineHits(aim, me.beamRange)) {
          const rush = Math.max(foeReach(foeClose), foeReach(foeMob), 2);
          const safeFar = dist > rush + 1.2;
          // Its rush moves cooling (a whiffed / Detected ram): it can't cut my charge off.
          const rushDown = (!foeClose || !foe.ready(foeClose) || C.isQuickStrike(foeClose) === false && !C.isRamMove(foeClose) && gap > 2.5)
            && (!foeMob || !C.isQuickStrike(foeMob) || !foe.ready(foeMob) || gap > C.QUICK_DIST * foe.H + 1);
          if ((punish && rushDown && (foe.stunned || gap > 1.2)) || safeFar) { lockedAim = aim; lastAct = t; return { ...base, aim, ranged: true }; }
        }
      }

      // ── movement ──
      const anyAttackReady = (zapHit && me.ready(MOB)) || (ramHit && me.ready(CLOSE)) || (elecHit && me.ready(RANGED));
      // Above me (flying foe): rise after it a little for Zippy/beam angles.
      if (dy > me.H * 1.2 && dist < 4 && me.grounded && anyAttackReady && !safeMode) return jump(0);

      if (safeMode && !punish) {
        // Ahead on time: keep away, out of its rush reach, but not into a corner.
        const keep = Math.max(foeReach(foeClose), foeReach(foeMob), 4) + 1;
        if (dist < keep && !nearWallBehind) return { ...base, want: -dir, face: dir };
        if (nearWallBehind && dist < 3 && me.ready('Dash')) return { ...base, want: dir, jumpPressed: true, jumpHeld: true };
        return base;
      }

      if (!anyAttackReady) {
        // Everything cooling: back off from a close foe (Detect up, hold ground).
        if (gap < 2.2 && !canDetect && !nearWallBehind) return { ...base, want: -dir, face: dir };
        if (gap < 1.0 && !nearWallBehind) return { ...base, want: -dir, face: dir };
        return base;
      }
      // Ram ready but too close: step back for run-up.
      if (ramHit && me.ready(CLOSE) && !(zapHit && me.ready(MOB)) && gap < ramReach * 0.35 && !nearWallBehind && me.grounded) {
        return { ...base, want: -dir, face: dir };
      }
      // Close in to striking range.
      const want = (zapHit && me.ready(MOB)) ? quickReach * 0.85 : (ramHit && me.ready(CLOSE)) ? ramReach * 0.8 : me.beamRange * 0.8;
      if (gap > want) {
        if (gap > want + 4 && me.ready('Dash') && me.grounded && !foeWindingRanged && Math.random() < 0.05) return { ...base, want: dir, dash: true };
        return { ...base, want: dir, jumpHeld: airborneHold };
      }
      return { ...base, jumpHeld: airborneHold };
    };
  },
};
