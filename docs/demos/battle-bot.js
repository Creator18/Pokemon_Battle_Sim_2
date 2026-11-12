// Test battles: the boss's AI against a bot playing you — it braces on the boss's tells (Counter on a physical blow,
// Sucker Punch on any), back dashes or jumps a beam, closes in with Agility, stops its clash needles, attacks openings.
// A watchdog flags what looks wrong: out of the arena, NaN, bodies overlapping, stuck busy, a hit after a faint,
// beam meshes left over.
// Load: (0, eval)(await (await fetch('/docs/demos/battle-bot.js')).text())
// Then: await __battle({ species, boss, moves, bossMoves, skill: 0..1, limit: s }) → { winner, t, hp, counts, flags, events }
(() => {
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const IDLE = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false };
  window.__battle = async (o = {}) => {
    for (let i = 0; i < 100 && !window.__zone; i++) await sleep(0.1);
    const P = window.__pbw, sc = P.scene;
    for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf']) window[k] && (window[k].stop = true);
    window.__zone?.dispose();
    window.__zone = await P.startBossZone({ species: o.species ?? 'Charizard', boss: o.boss ?? 'Charizard',
      moves: o.moves ?? { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Agility', control: 'Counter' }, bossMoves: o.bossMoves });
    const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
    const me = pf.player, foe = pf.boss;
    const skill = o.skill ?? 0.7;
    pf.restart();
    const flags = []; const flag = (s) => { if (flags.length < 40 && !flags.some((f) => f.what === s)) flags.push({ t: +pf.clock.toFixed(2), what: s }); };
    const counts = {};
    const tally = (k) => { counts[k] = (counts[k] ?? 0) + 1; };
    // The bot's state.
    let react = null;          // { at, intent }: a reaction, made at `at`
    let seenTell = '';
    let nextThink = 0;
    let busySince = { you: -1, boss: -1 };
    let pressedStop = false;
    const bot = () => {
      const t = pf.clock;
      const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx), dy = foe.y - me.y;
      const base = { ...IDLE, face: dir, jumpHeld: me.flying && dy > -0.3 };
      // In a clash: stop its number near the top (how near: its skill).
      if (me.clashing) {
        const n = me.clashing.needle();
        if (n === null || me.clashing.stopped() !== null) { pressedStop = false; return base; }
        if (!pressedStop && n >= 1 - (0.05 + (1 - skill) * 0.5)) { pressedStop = true; tally('clash stop'); return { ...base, ranged: true }; }
        return base;
      }
      pressedStop = false;
      // A reaction due.
      // (A brace against a beam: made as it launches — its charge outlasts a brace.)
      if (react && react.launch) {
        if (foe.beam?.launched) { const r = react.intent; react = null; return r; }
        if (!foe.beam && t > react.at + 3) react = null;
      } else if (react && t >= react.at) { const r = react.intent; react = null; return r; }
      // Its tell: answered after a reaction time.
      if (foe.telling && foe.telling !== seenTell) {
        seenTell = foe.telling;
        const delay = 0.12 + (1 - skill) * 0.35 + Math.random() * 0.1;
        const tell = foe.telling, physical = tell === foe.moves.close || tell === foe.moves.mobility;
        let r = null;
        if (Math.random() < skill) {
          if (me.moves.control === 'Sucker Punch' || (me.moves.control === 'Counter' && physical)) { r = { ...base, control: true }; tally('brace on tell'); }
          else if (!physical) {
            if (Math.random() < 0.5) { r = { ...base, dash: true, want: 0 }; tally('back dash a beam'); }
            else if (Math.random() < 0.5) { r = { ...base, ranged: true }; tally('meet the beam'); }
            else { r = { ...base, jumpPressed: true, jumpHeld: true }; tally('jump a beam'); }
          }
        }
        if (r) react = { at: t + delay, intent: r, launch: !physical && !!r.control && o.braceOnLaunch !== false };
      }
      if (!foe.telling) seenTell = '';
      // (Waiting to brace: still, nothing begun that would leave it busy then.)
      if (react) return base;
      if (t < nextThink || me.busy) return base;
      nextThink = t + 0.15 + Math.random() * 0.2;
      // An opening (it recovering, or still): attack — close in reach, else a beam, else in with Agility, else walk.
      const reach = (me.H + foe.H * 0.5) * 1.1;
      if (dist <= reach && Math.abs(dy) < me.H * 0.8) { tally('slash'); return { ...base, close: true }; }
      if (Math.abs(dy) < me.H * 0.6 && dist < 10 && Math.random() < 0.35) { tally('beam'); return { ...base, ranged: true }; }
      // (Far off: Agility's boost first, if it has it; then in with a dash — zippy, boosted.)
      if (me.moves.mobility === 'Agility' && dist > 5 && me.ready('Agility') && Math.random() < 0.5) { tally('agility boost'); return { ...base, mobility: true }; }
      if (dist > 4.5 && me.ready('Dash') && Math.random() < 0.5) { tally(me.zippy ? 'zippy dash in' : 'dash in'); return { ...base, want: dir, dash: true }; }
      if (me.moves.mobility === 'Quick Attack' && dist > 2 && dist < 6 && Math.random() < 0.4) { tally('quick attack'); return { ...base, mobility: true }; }
      if (dy > me.H) return { ...base, jumpPressed: true, jumpHeld: true };
      return { ...base, want: dir };
    };
    pf.playerIntent = bot;
    // The watchdog.
    let downAt = { you: -1, boss: -1 };
    const nEv0 = 0;
    const watch = sc.onBeforeRenderObservable.add(() => {
      const t = pf.clock;
      for (const [who, f] of [['you', me], ['boss', foe]]) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) flag(`${who} NaN position`);
        if (Math.abs(f.x) > 11.2) flag(`${who} out of the arena (x ${f.x.toFixed(1)})`);
        if (f.y < -0.05) flag(`${who} under the floor (y ${f.y.toFixed(2)})`);
        if (f.busy && !f.down && !f.clashing) { if (busySince[who] < 0) busySince[who] = t; else if (t - busySince[who] > 5) flag(`${who} busy > 5 s (${f.using || (f.quick ? 'quick' : f.stunned ? 'stunned' : '?')})`); }
        else busySince[who] = -1;
        if (f.down && downAt[who] < 0) downAt[who] = t;
      }
      // Bodies overlapping (level with each other).
      const [a0, a1] = me.span(), [b0, b1] = foe.span();
      if (!me.quick && !foe.quick && Math.abs(me.y - foe.y) < Math.min(me.H, foe.H) * 0.5 && a1 > b0 + 0.15 && a0 < b1 - 0.15) flag('bodies overlapping');
    });
    const t0 = performance.now(), limit = (o.limit ?? 90) * 1000;
    while (!pf.result && performance.now() - t0 < limit) await sleep(0.2);
    await sleep(1.5);
    sc.onBeforeRenderObservable.remove(watch);
    // Hits after a faint.
    const events = pf.events.map((e) => `${e.t} ${e.text}`);
    for (const e of pf.events) {
      const m = /^(.+?) .+ → (.+?) −/.exec(e.text);
      if (!m) continue;
      const by = m[1] === me.name ? 'you' : 'boss';
      if (downAt[by] >= 0 && e.t > downAt[by] + 0.05) flag(`${m[1]} landed a blow after fainting (${e.text})`);
    }
    // Leftovers: beam meshes still shown.
    const left = sc.meshes.filter((m) => /^beam/.test(m.name) && m.isEnabled() && m.isVisible).length;
    if (left) flag(`${left} beam meshes left shown after the fight`);
    for (const e of pf.events) { const k = e.text.replace(/\(.*?\)|−?\d+(\.\d+)?/g, '').replace(/Charizard|you|boss|[^a-zA-Z: →]/g, ' ').replace(/\s+/g, ' ').trim(); tally('ev: ' + k.slice(0, 50)); }
    return { winner: pf.result, t: +pf.clock.toFixed(1), hp: { you: me.hp, boss: foe.hp }, counts, flags, events: events.slice(-12), ai: pf.ai?.log?.slice(-5) };
  };
})();
