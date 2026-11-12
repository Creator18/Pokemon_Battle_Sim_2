// Demo: Agility (J) — a movement move, zipping in speed lines the way you hold, on and on while J is held. Looped:
// held right across the arena, held left back, then up into the air and zipping there (aimed up, level, down).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/agility-loop.js')).text())
// Another Pokémon first: window.__agilitySpecies = 'Talonflame'. Stop: window.__agility.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  for (const k of ['__loop', '__zip', '__counter', '__cc']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  if (window.__agility) { window.__agility.stop = true; await new Promise((r) => setTimeout(r, 1500)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__agilitySpecies ?? 'Charizard',
    moves: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Agility', control: 'Sucker Punch' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const down = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const up = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
  const hold = async (keys, s) => { keys.forEach(down); await sleep(s); keys.forEach(up); };
  pf.ai.paused = true; await sleep(1.5);
  pf.restart(); pf.ai.paused = true; await sleep(0.3);
  B.place(0, 0, -1);
  const a = window.__agility = { stop: false, zips: 0 };
  let was = false;
  const count = sc.onBeforeRenderObservable.add(() => { if (Pl.quick && !was) a.zips++; was = Pl.quick; });
  while (!a.stop) {
    Pl.restore(); Pl.place(-9, 0, 1); await sleep(0.6);
    // Across, held right; back, held left.
    await hold(['d', 'j'], 1.6); await sleep(0.4);
    await hold(['a', 'j'], 1.6); await sleep(0.4);
    if (!Pl.canFly || a.stop) continue;
    // Up and flying; zips aimed up, level, down.
    // (Jumped, then Space again aloft to take off — held throughout: it keeps flying, rising a little.)
    await hold([' '], 0.15); await sleep(0.25);
    down(' '); await sleep(0.6);
    await hold(['d', 'w', 'j'], 0.4);
    await hold(['d', 'j'], 0.9);
    await hold(['a', 'j'], 0.9);
    up(' ');
    await hold(['a', 's', 'j'], 0.6);
    for (let i = 0; i < 100 && !Pl.grounded; i++) await sleep(0.03);
    await sleep(0.4);
  }
  sc.onBeforeRenderObservable.remove(count);
})();
