// Demo: the back dash (L, anyone's) — gone backwards in speed lines, still facing forwards, dropping back in its
// jump-down pose. Looped: facing the boss, three back dashes away from it on the ground; back in with Agility; then
// aloft, back dashes in the air (level, then aimed up and down).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/back-dash-loop.js')).text())
// Another Pokémon first: window.__backSpecies = 'Talonflame'. Stop: window.__back.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  if (window.__back) { window.__back.stop = true; await new Promise((r) => setTimeout(r, 1500)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__backSpecies ?? 'Charizard',
    moves: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Agility', control: 'Sucker Punch' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const down = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const up = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
  const hold = async (keys, s) => { keys.forEach(down); await sleep(s); keys.forEach(up); };
  const tap = (k) => hold([k], 0.05);
  const settle = async () => { for (let i = 0; i < 100 && Pl.quick; i++) await sleep(0.02); };
  pf.ai.paused = true; await sleep(1.5);
  pf.restart(); pf.ai.paused = true; await sleep(0.3);
  const b = window.__back = { stop: false, dashes: 0 };
  let was = false;
  const count = sc.onBeforeRenderObservable.add(() => { if (Pl.quick && !was && Pl.using === 'Back Dash') b.dashes++; was = Pl.quick; });
  while (!b.stop) {
    B.place(9, 0, -1); B.face(-1, true);
    Pl.restore(); Pl.place(6, 0, 1); Pl.face(1, true); await sleep(0.8);
    // Away from it, still facing it.
    for (let k = 0; k < 3 && !b.stop; k++) { await tap('l'); await settle(); await sleep(0.45); }
    // Back in.
    await hold(['d', 'j'], 0.9); await settle(); await sleep(0.5);
    if (!Pl.canFly || b.stop) continue;
    // Aloft: taken off, Space held to stay up; back dashes level, then aimed up, then down.
    await hold([' '], 0.15); await sleep(0.25);
    down(' '); await sleep(0.5);
    await tap('l'); await settle(); await sleep(0.4);
    down('w'); await tap('l'); await settle(); up('w'); await sleep(0.4);
    up(' ');
    down('s'); await tap('l'); await settle(); up('s'); await sleep(0.3);
    for (let i = 0; i < 100 && !Pl.grounded; i++) await sleep(0.03);
    await sleep(0.4);
  }
  sc.onBeforeRenderObservable.remove(count);
})();
