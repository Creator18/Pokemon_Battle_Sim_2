// Round-robin tournaments: 10 AI competitors (BossAI, each its own style), both sides of every battle driven by AI.
// Each tournament gives the 10 a different set of species (no two alike in it, so no mirror matches), rotating through
// every species there is, each species' kit by its types. Every battle logged: who, species, kits, winner, time, HP
// left, every hit, the AIs' choices, and what the watchdog saw go wrong.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/tournament.js')).text()); __tour.start({ tournaments: 10 })
// Progress: __tour.state. Logs: __tour.log (one entry a battle). Summary: __tour.summary().
(() => {
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const SPECIES = ['Charizard', 'Pikachu', 'Zeraora', 'Glaceon', 'Garchomp', 'Gengar', 'Lucario', 'Dragonite', 'Scyther', 'Chandelure',
    'Ceruledge', 'Blastoise', 'Tyranitar', 'Gyarados', 'Alakazam', 'Machamp', 'Venusaur', 'Greninja', 'Metagross', 'Aegislash', 'Mewtwo',
    'Excadrill', 'Onix', 'Jolteon', 'Umbreon', 'Sylveon', 'Raichu', 'Golurk', 'Salamence', 'Steelix', 'Krookodile'];
  // A mixed roster (roster: 'mixed'): megas, baby forms and mid forms in among the rest, interleaved so every tournament
  // sees some of each.
  const MEGAS = ['Mega Charizard X', 'Mega Charizard Y', 'Mega Gengar', 'Mega Lucario', 'Mega Tyranitar', 'Mega Gyarados', 'Mega Alakazam', 'Mega Garchomp',
    'Mega Metagross', 'Mega Blastoise', 'Mega Mewtwo X', 'Mega Mewtwo Y', 'Mega Scizor', 'Mega Salamence', 'Mega Steelix', 'Mega Raichu X'];
  const BABIES = ['Charmander', 'Pichu', 'Riolu', 'Gastly', 'Dratini', 'Larvitar', 'Gible', 'Froakie', 'Litwick', 'Machop', 'Abra', 'Squirtle', 'Eevee', 'Honedge',
    'Beldum', 'Bagon'];
  const MIDS = ['Charmeleon', 'Haunter', 'Machoke', 'Kadabra', 'Dragonair', 'Gabite', 'Frogadier', 'Lampent', 'Wartortle', 'Shelgon', 'Metang', 'Krokorok',
    'Doublade', 'Pikachu', 'Pupitar'];
  const MIXED = (() => {
    const out = [], lists = [SPECIES, MEGAS, BABIES, MIDS];
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length && !out.includes(l[i])) out.push(l[i]);
    return out;
  })();
  const RANGED = { Fire: 'Flamethrower', Dragon: 'Dragon Pulse', Ice: 'Ice Beam', Grass: 'Solar Beam', Steel: 'Flash Cannon', Psychic: 'Psybeam',
    Bug: 'Signal Beam', Electric: 'Thunderbolt', Water: 'Hydro Pump', Ghost: 'Moongeist Beam', Fairy: 'Fleur Cannon', Rock: 'Stone Edge', Ground: 'Stone Edge' };
  // The 10 competitors: their styles (BossAI.AIStyle).
  const AGENTS = [
    { name: 'Berserker', style: { dodge: 0.3, slash: 0.95, detect: 0.2, wary: 0.2, think: [0.15, 0.25] } },
    { name: 'Turtle', style: { dodge: 0.9, detect: 0.9, wary: 0.95, slash: 0.5, jumpQuake: 0.95 } },
    { name: 'Sniper', style: { contest: 0.9, beamCool: [1.4, 2.2], slash: 0.5 } },
    { name: 'Balanced', style: {} },
    { name: 'Counterpuncher', style: { detect: 0.95, wary: 0.9, dodge: 0.7 } },
    { name: 'Reckless', style: { dodge: 0.1, contest: 0.2, wary: 0.1, detect: 0.1, jumpQuake: 0.3 } },
    { name: 'Jumper', style: { dodge: 0.95, jumpQuake: 1, detect: 0.4 } },
    { name: 'Slowpoke', style: { think: [0.45, 0.75], dodge: 0.4, detect: 0.3 } },
    { name: 'Quickdraw', style: { think: [0.1, 0.18], dodge: 0.7, detect: 0.7 } },
    { name: 'Clash King', style: { contest: 1, aiStop: [0.01, 0.12], beamCool: [1.6, 2.6] } },
  ];
  const kitFor = (S, sp) => {
    const types = S.getSpecies(sp).types;
    const ranged = types.map((t) => RANGED[t]).find(Boolean) ?? 'Tri Attack';
    const close = types.some((t) => t === 'Ground' || t === 'Rock') ? 'Earthquake' : 'Dragon Claw';
    let mobility = 'Quick Attack', control = 'Detect';
    if (types.includes('Ghost')) mobility = 'Shadow Sneak';
    else if (types.includes('Dark')) { mobility = undefined; control = 'Sucker Punch'; }
    else if (types.includes('Fighting')) { mobility = undefined; control = 'Counter'; }
    else if (types.includes('Electric')) mobility = 'Agility';
    const kit = { ranged, close, control };
    if (mobility) kit.mobility = mobility;
    return kit;
  };
  // The ported moves (kits: 'port'): balls, priority dashes, rams, slashes, flurries, Teleport, the braces — by type, the
  // choice among several turning with each entrant (n), so every one of them gets played.
  const PORT = {
    ball: { Ghost: ['Shadow Ball'], Fighting: ['Aura Sphere', 'Focus Blast'], Fairy: ['Moonblast'], Flying: ['Aeroblast'], Fire: ['Fire Blast', 'Flamethrower'] },
    close: { Fire: ['Flare Blitz', 'Bitter Blade', 'Fire Fang'], Flying: ['Brave Bird', 'Sky Attack'], Electric: ['Volt Tackle', 'Wild Charge'], Water: ['Wave Crash', 'Aqua Cutter'],
      Grass: ['Wood Hammer', 'Leaf Blade'], Normal: ['Double-Edge', 'Thrash', 'Giga Impact', 'Slash', 'Take Down', 'Cut'], Steel: ['Iron Head', 'Metal Claw', 'Iron Tail'],
      Dragon: ['Outrage', 'Dragon Rush', 'Dragon Claw'], Rock: ['Head Smash', 'Earthquake'], Ground: ['Earthquake'], Dark: ['Night Slash', 'Crunch'], Bug: ['X-Scissor'],
      Psychic: ['Psycho Cut', 'Psyblade'], Ghost: ['Shadow Claw'], Fighting: ['Close Combat', 'Sacred Sword'], Ice: ['Ice Fang'], Fairy: ['Play Rough'], Poison: ['Cross Poison'] },
    mobility: { Water: ['Aqua Jet'], Rock: ['Accelerock'], Steel: ['Bullet Punch'], Fighting: ['Mach Punch'], Ice: ['Ice Shard'], Electric: ['Zippy Zap', 'Agility'],
      Grass: ['Grassy Glide'], Bug: ['First Impression'], Normal: ['Extreme Speed', 'Quick Attack'], Ghost: ['Shadow Sneak'], Psychic: ['Teleport'] },
  };
  const pick = (table, types, n) => { for (const t of types) if (table[t]) return table[t][n % table[t].length]; return null; };
  const kitPort = (S, sp, n) => {
    const types = S.getSpecies(sp).types;
    const ranged = pick(PORT.ball, types, n) ?? types.map((t) => RANGED[t]).find(Boolean) ?? 'Tri Attack';
    const close = pick(PORT.close, types, n) ?? 'Slash';
    // (Its guard: Detect, Counter or Sucker Punch in turn — a brace counts as its one mobility move.)
    const control = ['Detect', 'Counter', 'Sucker Punch'][n % 3];
    const kit = { ranged, close, control };
    if (control === 'Detect') kit.mobility = pick(PORT.mobility, types, n) ?? 'Quick Attack';
    // (Any move the data lacks: told, not played blind.)
    for (const [slot, m] of Object.entries(kit)) if (!S.getMove(m) && !['Detect', 'Teleport', 'Agility'].includes(m)) kit[slot] = { ranged: 'Tri Attack', close: 'Slash', mobility: 'Quick Attack', control: 'Detect' }[slot];
    return kit;
  };
  const state = { running: false, tournament: 0, battle: 0, total: 0, done: 0, startedAt: 0, error: null };
  const log = [];
  window.__tour = { state, log, AGENTS, MIXED };

  const battle = async (S, BossAI, A, B, tour, limit) => {
    const P = window.__pbw, sc = P.scene;
    window.__zone?.dispose();
    window.__zone = await P.startBossZone({ species: A.species, boss: B.species, moves: A.kit, bossMoves: B.kit });
    const pf = window.__pf = window.__zone.pf;
    const me = pf.player, foe = pf.boss;
    // Both sides AI-driven, each in its own style.
    const aiA = new BossAI(me, foe, A.agent.style), aiB = new BossAI(foe, me, B.agent.style);
    aiA.arena = pf.arena; aiB.arena = pf.arena;
    pf.ai = aiB;
    pf.playerIntent = () => aiA.think();
    pf.restart();
    const statuses = [];
    pf.arena.onStatus = (on, status, secs) => statuses.push({ t: +pf.clock.toFixed(2), who: on === me ? 'A' : 'B', status, secs });
    // The AIs' choices, tallied as they are made.
    const tally = (ai) => { const t = {}; const push = ai.log.push.bind(ai.log); ai.log.push = (th) => { const k = th.chose.replace(/^tell \w+ → /, '').replace(/\(.*?\)/g, '').trim(); if (k !== 'busy') t[k] = (t[k] ?? 0) + 1; return push(th); }; return t; };
    const choicesA = tally(aiA), choicesB = tally(aiB);
    // The watchdog.
    const flags = [];
    const flag = (s) => { if (flags.length < 30 && !flags.some((f) => f.what === s)) flags.push({ t: +pf.clock.toFixed(2), what: s }); };
    const busySince = [-1, -1];
    let lastHitAt = 0;
    const watch = sc.onBeforeRenderObservable.add(() => {
      const t = pf.clock;
      [me, foe].forEach((f, k) => {
        const who = k === 0 ? A.agent.name : B.agent.name;
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) flag(`${who} NaN position`);
        if (Math.abs(f.x) > 11.3) flag(`${who} out of the arena (x ${f.x.toFixed(1)})`);
        if (f.y < -0.05) flag(`${who} under the floor`);
        if (f.busy && !f.down && !f.clashing) { if (busySince[k] < 0) busySince[k] = t; else if (t - busySince[k] > 5) flag(`${who} busy > 5 s (${f.using || (f.quick ? 'quick' : f.stunned ? 'stunned' : '?')})`); }
        else busySince[k] = -1;
        if ((pf.arena.pillars ?? []).some((pl) => f.x > pl.plat.x + 0.15 && f.x < pl.plat.x + pl.plat.w - 0.15 && f.y < pl.plat.top - 0.3 && pl.plat.h > 0.5) && !f.types.includes('Ghost') && !f.quick) flag(`${who} inside a pillar`);
      });
      const [a0, a1] = me.span(), [b0, b1] = foe.span();
      if (!me.quick && !foe.quick && !me.down && !foe.down && Math.abs(me.y - foe.y) < Math.min(me.H, foe.H) * 0.5 && a1 > b0 + 0.15 && a0 < b1 - 0.15) flag('bodies overlapping');
    });
    const nEv = () => pf.events.length;
    let seen = 0;
    while (!pf.result && pf.clock < limit) {
      await sleep(0.25);
      if (nEv() !== seen) { seen = nEv(); if (pf.events.some((e) => / → .* −/.test(e.text))) lastHitAt = pf.clock; }
      if (pf.clock - lastHitAt > 25 && pf.clock > 25) { flag('no blow landed for 25 s'); break; }
    }
    sc.onBeforeRenderObservable.remove(watch);
    const hpA = me.hp / me.maxHp, hpB = foe.hp / foe.maxHp;
    const winner = pf.result === 'won' ? 'A' : pf.result === 'lost' ? 'B' : hpA > hpB + 0.02 ? 'A' : hpB > hpA + 0.02 ? 'B' : 'draw';
    const hits = [];
    for (const e of pf.events) {
      const m = /^(.+?) \((you|boss)\) (.+?) → .+? −(\d+)/.exec(e.text);
      if (m) hits.push({ t: +(+e.t).toFixed(2), by: m[2] === 'you' ? 'A' : 'B', move: m[3], dmg: +m[4] });
    }
    // Left over after the fight: beam meshes still shown.
    const left = sc.meshes.filter((m) => /^beam/.test(m.name) && m.isEnabled() && m.isVisible).length;
    if (left && pf.result) flag(`${left} beam meshes left shown`);
    return {
      tour, a: { agent: A.agent.name, species: A.species, kit: A.kit }, b: { agent: B.agent.name, species: B.species, kit: B.kit },
      winner, decided: pf.result ? 'KO' : 'time', t: +pf.clock.toFixed(1), hp: { a: +hpA.toFixed(2), b: +hpB.toFixed(2) },
      hits, statuses, choices: { a: choicesA, b: choicesB }, flags, events: pf.events.slice(-40).map((e) => `${e.t} ${e.text}`),
    };
  };

  window.__tour.start = async ({ tournaments = 10, limit = 45, speed = 2.5, kits = 'type', roster = 'base', prior = [] } = {}) => {
    const POOL = roster === 'mixed' ? MIXED : SPECIES;
    if (state.running) return 'already running';
    state.running = true; state.startedAt = Date.now(); state.error = null;
    try {
      const S = await import('/src/shared/index.ts');
      const { BossAI } = await import('/src/client/platformer/BossAI.ts');
      // (Faster than real time, and lighter to draw.)
      window.__slow = speed;
      if (!window.__slowPatched) (0, eval)(await (await fetch('/docs/demos/slowmo.js')).text());
      window.__pbw.scene.getEngine().setHardwareScalingLevel(2);
      const pairs = [];
      for (let i = 0; i < AGENTS.length; i++) for (let j = i + 1; j < AGENTS.length; j++) pairs.push([i, j]);
      state.total = tournaments * pairs.length;
      // (Resumed: the battles already logged kept, and skipped.)
      log.push(...prior); state.done = prior.length;
      for (let k = 0; k < tournaments; k++) {
        state.tournament = k + 1;
        // This tournament's species: 10 different ones, the next 10 round the rotation.
        const entrants = AGENTS.map((agent, i) => { const n = k * AGENTS.length + i, species = POOL[n % POOL.length]; return { agent, species, kit: kits === 'port' ? kitPort(S, species, k + i) : kitFor(S, species) }; });
        for (let p = 0; p < pairs.length; p++) {
          state.battle = p + 1;
          if (k * pairs.length + p < prior.length) continue;
          // (Sides alternated: who plays the "player" and who the "boss" by the pair and the tournament.)
          let [i, j] = pairs[p];
          if ((p + k) % 2) [i, j] = [j, i];
          try { log.push(await battle(S, BossAI, entrants[i], entrants[j], k + 1, limit)); }
          catch (e) { log.push({ tour: k + 1, a: { agent: entrants[i].agent.name, species: entrants[i].species }, b: { agent: entrants[j].agent.name, species: entrants[j].species }, error: String(e?.stack ?? e).slice(0, 400) }); }
          state.done++;
        }
      }
    } catch (e) { state.error = String(e?.stack ?? e); }
    window.__slow = 1;
    window.__pbw.scene.getEngine().setHardwareScalingLevel(1);
    state.running = false;
    return 'finished';
  };

  // A summary of all logged battles: agents' records, species' records, moves' damage, how fights end, flags.
  window.__tour.summary = () => {
    const rec = (m, k) => (m[k] ??= { w: 0, l: 0, d: 0, ko: 0, time: 0, n: 0 });
    const agents = {}, species = {}, moves = {}, flags = {};
    let ko = 0, time = 0, len = 0, errors = 0;
    for (const b of log) {
      if (b.error) { errors++; continue; }
      const ra = rec(agents, b.a.agent), rb = rec(agents, b.b.agent), sa = rec(species, b.a.species), sb = rec(species, b.b.species);
      for (const r of [ra, rb, sa, sb]) { r.n++; r.time += b.t; }
      if (b.winner === 'A') { ra.w++; rb.l++; sa.w++; sb.l++; } else if (b.winner === 'B') { rb.w++; ra.l++; sb.w++; sa.l++; } else { ra.d++; rb.d++; sa.d++; sb.d++; }
      if (b.decided === 'KO') { ko++; (b.winner === 'A' ? ra : rb).ko++; } else time++;
      len += b.t;
      for (const h of b.hits) { const m = (moves[h.move] ??= { hits: 0, dmg: 0 }); m.hits++; m.dmg += h.dmg; }
      for (const f of b.flags) { const k = f.what.replace(/^\S+ /, '').replace(/\(.*\)/, '').trim(); flags[k] = (flags[k] ?? 0) + 1; }
    }
    const n = log.length - errors;
    return { battles: n, errors, ko, timeouts: time, avgLength: +(len / Math.max(1, n)).toFixed(1), agents, species, moves, flags };
  };
})();
