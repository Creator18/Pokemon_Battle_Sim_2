// Use-case tests for the boss zone (platformer-boss.js, run it first): scripted players fight the boss, and each fight
// is read back — the result, every blow, what the boss chose, whether the bodies ever overlapped, how long each side
// spent held by blows, how long both poured Flamethrowers at once (a clash that never happened).
//   const r = await window.__scen('name', async ({ P, B, pf, key, tap, sleep }) => { ...one beat of the player... }, secs)
// P: the player's Fighter, B: the boss's; tap('u') presses a key; key('d', true/false) holds or lets go.
// Ready-made players: window.__players.{idle, beamDuel, rusher, kiter, flyer, dodger} — e.g. await __scen('rush', __players.rusher, 40)
// Every result is kept in localStorage 'pfTests' (by name), across reloads.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/platformer-boss-test.js')).text())
(() => {
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  window.__scen = async (name, script, secs = 30) => {
    const pf = window.__pf, sc = window.__pbw.scene;
    const down = new Set();
    const key = (k, d) => { if (d && down.has(k)) return; d ? down.add(k) : down.delete(k); window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { key: k })); };
    const tap = async (k, s = 0.05) => { key(k, true); await sleep(s); key(k, false); };
    pf.ai.paused = false; pf.restart(); await sleep(0.3);
    const P = pf.player, B = pf.boss;
    let minGap = 99, overlapFrames = 0, frames = 0, stunP = 0, stunB = 0, bothBeams = 0, bossAir = 0, youAir = 0;
    const o = sc.onBeforeRenderObservable.add(() => {
      frames++;
      const [a, b] = P.span(), [c, d] = B.span();
      const level = P.y < B.y + B.H && P.y + P.H > B.y, g = Math.max(c - b, a - d);
      if (level) { minGap = Math.min(minGap, g); if (g < -0.01) overlapFrames++; }
      if (P.stunned) stunP++; if (B.stunned) stunB++;
      if (P.firing && B.firing && P.using === P.moves.ranged && B.using === B.moves.ranged) bothBeams++;
      if (!B.grounded) bossAir++; if (!P.grounded) youAir++;
    });
    const t0 = performance.now(); let stop = false;
    const runner = (async () => { while (!stop && !pf.result && performance.now() - t0 < secs * 1000) await script({ P, B, pf, key, tap, sleep }); })();
    while (!pf.result && performance.now() - t0 < secs * 1000) await sleep(0.2);
    stop = true; for (const k of [...down]) key(k, false); await runner.catch(() => {});
    sc.onBeforeRenderObservable.remove(o);
    const chose = {};
    for (const l of pf.ai.log) { const c = l.chose.replace(/:.*/, ''); chose[c] = (chose[c] || 0) + 1; }
    const blows = {};
    for (const e of pf.events) { const m = e.text.match(/^(.*?\((?:you|boss)\)) (.+?) →/); if (m) { const k = `${m[1].includes('boss') ? 'boss' : 'you'} ${m[2]}`; blows[k] = (blows[k] || 0) + 1; } }
    const r = { name, result: pf.result ?? 'timeout', secs: +((performance.now() - t0) / 1000).toFixed(1), hp: { you: P.hp, boss: B.hp }, blows,
      bossChose: chose, minGap: +minGap.toFixed(3), overlapFrames,
      heldShare: { you: +(stunP / frames).toFixed(2), boss: +(stunB / frames).toFixed(2) },
      bothBeamsSecs: +(bothBeams / frames * (performance.now() - t0) / 1000).toFixed(1),
      airShare: { you: +(youAir / frames).toFixed(2), boss: +(bossAir / frames).toFixed(2) },
      events: pf.events.map((e) => `${e.t} ${e.text}`) };
    pf.ai.paused = true;
    window.__last = r;
    // (Kept across a reload: localStorage 'pfTests', by name.)
    try { const all = JSON.parse(localStorage.getItem('pfTests') ?? '{}'); all[name] = r; localStorage.setItem('pfTests', JSON.stringify(all)); } catch { /* none */ }
    return r;
  };
  const faceBoss = async ({ P, B, tap }) => { const dir = Math.sign(B.x - P.x); if (dir && P.facing !== dir) await tap(dir > 0 ? 'd' : 'a', 0.04); };
  window.__players = {
    // Does nothing.
    idle: async ({ sleep: s }) => { await s(0.2); },
    // Stands its ground, beam whenever it can.
    beamDuel: async (c) => { await faceBoss(c); if (!c.P.busy) await c.tap('u'); await c.sleep(0.15); },
    // Closes in with Quick Attack, then slashes; beam when it can't reach.
    rusher: async (c) => {
      const { P, B, tap, key, sleep: s } = c; await faceBoss(c);
      const dist = Math.abs(B.x - P.x);
      if (P.busy) { await s(0.1); return; }
      if (dist < 2.6) await tap('i');
      else if (dist < 5.5) await tap('j');
      else { const k = B.x > P.x ? 'd' : 'a'; key(k, true); await s(0.25); key(k, false); }
      await s(0.12);
    },
    // Keeps its distance: runs off when the boss is near, turns and beams when far.
    kiter: async (c) => {
      const { P, B, tap, key, sleep: s } = c;
      const dist = Math.abs(B.x - P.x), away = B.x > P.x ? 'a' : 'd';
      if (P.busy) { await s(0.1); return; }
      if (dist < 4.5) { key(away, true); await s(0.35); key(away, false); if (Math.random() < 0.4) await tap(' ', 0.2); }
      else { await faceBoss(c); await tap('u'); }
      await s(0.15);
    },
    // Takes to the air and stays high, beaming down at it now and then.
    flyer: async (c) => {
      const { P, tap, key, sleep: s } = c;
      if (P.grounded) { await tap(' ', 0.15); await s(0.2); await tap(' ', 0.1); }
      if (P.y < 3.5) { key(' ', true); await s(0.3); key(' ', false); }
      await faceBoss(c); if (!P.busy) await tap('u');
      await s(0.3);
    },
    // Duels with beams but jumps the boss's: watches it, and hops when its beam starts.
    dodger: async (c) => {
      const { P, B, tap, sleep: s } = c;
      if (B.firing && B.using === B.moves.ranged && B.time - B.usingSince < 1.2 && P.grounded && !P.busy) { await s(0.6); await tap(' ', 0.25); await s(0.5); return; }
      await faceBoss(c); if (!P.busy && !B.firing) await tap('u'); await s(0.12);
    },
  };
  return 'ok';
})();
