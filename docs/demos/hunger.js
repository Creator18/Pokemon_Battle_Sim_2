// The Hunger Games: ten tributes, each a bot brain written by its own agent (docs/hunger/brains/<slug>.js — see
// docs/hunger/RULES.md), fought out in elimination series in the boss arena, sped up. Losers are out; survivors may
// change their brains between rounds; last one standing wins.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/hunger.js')).text());
//   await __hg.load(['d1-charizard', ...])        (re)loads brains (cache-busted)
//   __hg.series(slugA, slugB, { bestOf: 3 })      starts a series in the background → __hg.state, __hg.results
(() => {
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const state = { running: false, series: null, battle: 0, error: null };
  const results = [];
  const brains = (window.__brains ??= {});
  const memories = {};
  const locked = {};
  window.__hg = { state, results, brains, memories };

  // No hover stalling (RULES.md): more than HOVER_H body heights up for over HOVER_T s in a row, it is made to sink
  // (its jump let go, sinking) till it is back on the ground.
  const HOVER_H = 2.5, HOVER_T = 4;
  const noHover = (slug) => {
    const b = brains[slug];
    if (!b || b.__noHover) return;
    const make = b.make;
    b.make = function (ctx) {
      const think = make.call(this, ctx);
      let since = -1, forcing = false;
      return (t) => {
        const i = think(t), me = ctx.me;
        if (me.y > me.H * HOVER_H) { if (since < 0) since = t; if (t - since > HOVER_T) forcing = true; }
        else { since = -1; if (me.y < 0.05) forcing = false; }
        return forcing && i ? { ...i, jumpHeld: false, jumpPressed: false, sink: true } : i;
      };
    };
    b.__noHover = true;
  };
  window.__hg.noHover = noHover;

  window.__hg.load = async (slugs) => {
    const out = {};
    for (const s of slugs) {
      try {
        const src = await (await fetch(`/docs/hunger/brains/${s}.js?v=${Date.now()}`)).text();
        (0, eval)(src);
        noHover(s);
        // (Its kit and species locked as loaded: read once, never again per battle - no picking a kit per opponent.)
        if (brains[s]) locked[s] = { species: String(brains[s].species), kit: JSON.parse(JSON.stringify(brains[s].kit ?? {})) };
        out[s] = brains[s] ? 'ok' : 'file ran but did not register window.__brains[slug]';
      } catch (e) { out[s] = 'error: ' + String(e?.message ?? e).slice(0, 300); }
    }
    return out;
  };

  // A kit as played: each slot checked against what the game can play; anything it can't, put back to a safe move (told).
  const checkKit = (F, S, kit, fixes) => {
    const k = { ...kit };
    const ok = {
      ranged: (m) => !!(F.beamFor(m) || F.isBall(m) || m === 'Thunderbolt' || m === 'Stone Edge'),
      close: (m) => !!(S.getMove(m) && (F.isRamMove(m) || F.isFlurry(m) || F.isSlashMove(m) || m === 'Earthquake')),
      mobility: (m) => F.isQuickStrike(m) || !!F.BEHIND_STRIKES[m] || ['Teleport', 'Agility', 'Dash'].includes(m),
      control: (m) => ['Detect', 'Counter', 'Sucker Punch', 'Growl', 'Smokescreen'].includes(m),
    };
    const safe = { ranged: 'Tri Attack', close: 'Slash', mobility: 'Quick Attack', control: 'Detect' };
    for (const slot of ['ranged', 'close', 'mobility', 'control']) {
      if (k[slot] === undefined) continue;
      if (!ok[slot](k[slot])) { fixes.push(`${slot} "${k[slot]}" can't be played there - ${safe[slot]} instead`); k[slot] = safe[slot]; }
    }
    // (One mobility move: a brace (Counter, Sucker Punch) counts as one.)
    if (k.mobility && ['Counter', 'Sucker Punch'].includes(k.control)) { fixes.push(`${k.control} counts as its mobility move - ${k.mobility} dropped`); delete k.mobility; }
    return k;
  };

  // One battle: A (the "player" side) against B (the "boss" side), each driven by its own brain.
  const battle = async (S, F, BossAI, A, B, limit) => {
    const P = window.__pbw, sc = P.scene;
    // (The field cleared first: the last fight torn down - its beams, balls, auras gone with it - then any effect still
    // left drawn swept away, so nothing stray carries into this one.)
    window.__zone?.dispose();
    await sleep(0.1);
    const STRAY = /^(beam|tornado|aimDot|aimLine|ember|smoke|growl|crescent|slash|orb|ball|ring|spark|quake|ripple|bolt|lightning|fire|egg)/i;
    const leftover = sc.meshes.filter((m) => STRAY.test(m.name) && !m.isDisposed());
    for (const m of leftover) { try { m.dispose(); } catch { /* gone */ } }
    // (A torn-down zone leaves no meshes of its own, so any particles still going are strays too.)
    for (const ps of [...(sc.particleSystems ?? [])]) { leftover.push({ name: `particles:${ps.name}` }); try { ps.dispose(); } catch { /* gone */ } }
    const fixes = { a: [], b: [] };
    const kitA = checkKit(F, S, A.kit, fixes.a), kitB = checkKit(F, S, B.kit, fixes.b);
    window.__zone = await P.startBossZone({ species: A.species, boss: B.species, moves: kitA, bossMoves: kitB });
    const pf = window.__pf = window.__zone.pf;
    const me = pf.player, foe = pf.boss;
    const consts = { AIM_ANGLE: F.AIM_ANGLE, AIM_MIN: F.AIM_MIN, AIM_RATE: F.AIM_RATE, AIM_HOLD_MAX: F.AIM_HOLD_MAX, CLOSE_REACH: F.CLOSE_REACH,
      RAM_DIST: F.RAM_DIST, QUICK_DIST: F.QUICK_DIST, BEAM_REACH: F.BEAM_REACH, BALL_REACH: F.BALL_REACH, BRACES: F.BRACES, IDLE: F.IDLE,
      isBall: F.isBall, isRamMove: F.isRamMove, isQuickStrike: F.isQuickStrike, isFlurry: F.isFlurry, beamFor: F.beamFor, getMove: S.getMove };
    const errors = { a: [], b: [] };
    const drive = (side, T, self, other) => {
      const mem = (memories[T.slug] ??= {});
      let think = null;
      try { think = brains[T.slug].make({ me: self, foe: other, arena: pf.arena, BossAI, Fighter: F.Fighter, consts, memory: mem, clock: () => pf.clock }); }
      catch (e) { errors[side].push('make: ' + String(e?.message ?? e).slice(0, 200)); }
      // (A broken brain: the stock bot stands in for it, and it is told.)
      const fallback = new BossAI(self, other); fallback.arena = pf.arena;
      return () => {
        if (!think) return fallback.think();
        try { const i = think(pf.clock); return i && typeof i === 'object' ? { ...F.IDLE, ...i } : F.IDLE; }
        catch (e) { if (errors[side].length < 5) errors[side].push(`t ${pf.clock.toFixed(1)}: ` + String(e?.message ?? e).slice(0, 200)); return F.IDLE; }
      };
    };
    const thinkA = drive('a', A, me, foe), thinkB = drive('b', B, foe, me);
    pf.ai = { think: thinkB, log: [], arena: pf.arena, paused: false };
    pf.playerIntent = thinkA;
    pf.restart();
    const statuses = [];
    pf.arena.onStatus = (on, status, secs) => statuses.push(`${pf.clock.toFixed(1)} ${on === me ? 'A' : 'B'} ${status}`);
    while (!pf.result && pf.clock < limit) await sleep(0.25);
    const hpA = me.hp / me.maxHp, hpB = foe.hp / foe.maxHp;
    const winner = pf.result === 'won' ? 'A' : pf.result === 'lost' ? 'B' : hpA > hpB + 0.02 ? 'A' : hpB > hpA + 0.02 ? 'B' : 'draw';
    const hits = {};
    for (const e of pf.events) {
      const m = /^(.+?) \((you|boss)\) (.+?) → .+? −(\d+)/.exec(e.text);
      if (m) { const k = `${m[2] === 'you' ? 'A' : 'B'}:${m[3]}`; (hits[k] ??= [0, 0]); hits[k][0]++; hits[k][1] += +m[4]; }
    }
    return { a: A.slug, b: B.slug, clearedBefore: leftover.map((m) => m.name), kits: { a: kitA, b: kitB }, kitFixes: fixes, winner, decided: pf.result ? 'KO' : 'time', t: +pf.clock.toFixed(1),
      hp: { a: +hpA.toFixed(2), b: +hpB.toFixed(2) }, hits, statuses: statuses.slice(0, 30), brainErrors: errors,
      events: pf.events.slice(-30).map((e) => `${e.t} ${e.text}`) };
  };

  // A series, best of `bestOf` (draws replayed, at most bestOf + 2 battles): sides swapped each battle.
  window.__hg.series = (slugA, slugB, { bestOf = 3, limit = 150, speed = 3, species = {} } = {}) => {
    if (state.running) return 'already running';
    state.running = true; state.error = null; state.series = `${slugA} v ${slugB}`; state.battle = 0;
    void (async () => {
      const rec = { a: slugA, b: slugB, wins: { [slugA]: 0, [slugB]: 0 }, battles: [], winner: null };
      try {
        const S = await import('/src/shared/index.ts');
        const F = await import('/src/client/platformer/Fighter.ts');
        const { BossAI } = await import('/src/client/platformer/BossAI.ts');
        window.__slow = speed;
        if (!window.__slowPatched) (0, eval)(await (await fetch('/docs/demos/slowmo.js')).text());
        const need = Math.ceil(bestOf / 2);
        const T = (slug) => ({ slug, species: species[slug] ?? locked[slug].species, kit: locked[slug].kit });
        for (let n = 0; n < bestOf + 2 && rec.wins[slugA] < need && rec.wins[slugB] < need; n++) {
          state.battle = n + 1;
          const [x, y] = n % 2 ? [slugB, slugA] : [slugA, slugB];
          const b = await battle(S, F, BossAI, T(x), T(y), limit);
          rec.battles.push(b);
          const w = b.winner === 'A' ? x : b.winner === 'B' ? y : null;
          if (w) rec.wins[w]++;
        }
        rec.winner = rec.wins[slugA] > rec.wins[slugB] ? slugA : rec.wins[slugB] > rec.wins[slugA] ? slugB
          // (Still level: the one with more HP left over the series.)
          : (rec.battles.reduce((s, b) => s + (b.a === slugA ? b.hp.a - b.hp.b : b.hp.b - b.hp.a), 0) >= 0 ? slugA : slugB);
      } catch (e) { state.error = String(e?.stack ?? e).slice(0, 600); rec.error = state.error; }
      results.push(rec);
      window.__slow = 1;
      state.running = false;
    })();
    return 'started';
  };
})();
