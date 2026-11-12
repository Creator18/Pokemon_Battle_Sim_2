// Demo: the dash button (L) and Agility (J). Looped: plain dashes across (D + L, A + L — the zippy dash's springing
// pose, afterimages) and a back dash (L alone); then Agility's boost (J) — the same dashes as zippy dashes, further —
// on the ground and in the air. Cooldowns waived between dashes for the demo; Agility's boost as it is (4 s).
// Run in the page: (0, eval)(await (await fetch('/docs/demos/agility-loop.js')).text())
// Another Pokémon first: window.__agilitySpecies = 'Talonflame'. Stop: window.__agility.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__back', '__cf', '__miss']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  if (window.__agility) { window.__agility.stop = true; await new Promise((r) => setTimeout(r, 1500)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__agilitySpecies ?? 'Charizard',
    moves: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Agility', control: 'Counter' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const down = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const up = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
  const press = async (keys, s = 0.06) => { keys.forEach(down); await sleep(s); keys.slice().reverse().forEach(up); };
  // (A dash, its cooldown waived; then till it is done.)
  const dash = async (dir) => {
    for (const m of ['Dash', 'Back Dash']) Pl.readyAt.delete(m);
    await press(dir ? [dir, 'l'] : ['l']);
    for (let i = 0; i < 80 && (Pl.busy || Pl.quick); i++) await sleep(0.02);
    await sleep(0.3);
  };
  pf.ai.paused = true; await sleep(1.5);
  pf.restart(); pf.ai.paused = true; await sleep(0.3);
  B.place(0, 0, -1);
  const a = window.__agility = { stop: false, rounds: 0 };
  while (!a.stop) {
    Pl.restore(); Pl.place(-9, 0, 1); await sleep(0.6);
    // Plain: across and back, then a back dash.
    for (const d of ['d', 'd', 'd', 'a', 'a']) await dash(d);
    Pl.face(1, true); await dash(null);
    // Agility's boost: zippy dashes, further.
    Pl.readyAt.delete('Agility'); await press(['j']); await sleep(0.3);
    for (const d of ['d', 'd', 'a', null]) await dash(d);
    // Aloft (taken off, Space held), still boosted if it lasts.
    if (Pl.canFly) {
      Pl.readyAt.delete('Agility'); await press(['j']);
      await press([' '], 0.15); await sleep(0.25); down(' '); await sleep(0.5);
      for (const d of ['d', 'a', null]) await dash(d);
      up(' ');
      for (let i = 0; i < 100 && !Pl.grounded; i++) await sleep(0.03);
    }
    a.rounds++;
    await sleep(0.8);
  }
})();
