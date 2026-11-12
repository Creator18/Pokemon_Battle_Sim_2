// Demo: the zippy dash loop in the boss zone — speed-line teleports (Fighter.teleport 'lines'): four on the ground
// (about half straight past the boss), a takeoff, five in the air (aim varied, some over the boss), and landing hops.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/zip-loop.js')).text())
// Another Pokémon first: window.__zipSpecies = 'Talonflame'. Stop: window.__zip.stop = true
(async () => {
  const P = window.__pbw, sc = P.scene;
  window.__loop && (window.__loop.stop = true);
  window.__clashHold?.release();
  if (window.__zip) { window.__zip.stop = true; await new Promise((r) => setTimeout(r, 1500)); }
  sc.activeCamera.detachControl?.();
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__zipSpecies ?? 'Charizard' });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const Pl = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  pf.ai.paused = true; await sleep(2.5);
  pf.restart(); pf.ai.paused = true; await sleep(0.3);
  B.place(0, 0, -1); Pl.place(-6, 0, 1); await sleep(0.4);
  const zip = window.__zip = { stop: false, n: 0, around: 0, air: 0, mode: 'ground' };
  // (Aloft between hops: held up, still.)
  const keep = sc.onBeforeRenderObservable.add(() => { if (zip.mode === 'air' && !Pl.quick) { Pl.flying = true; Pl.vy = 0; Pl.vx = 0; } });
  const hop = async (dir, aim) => {
    for (let i = 0; i < 200 && Pl.quick; i++) await sleep(0.01);
    await sleep(0.3);
    // (Its cooldowns waived for the demo: every hop on cue.)
    Pl.quickCool = 0; Pl.readyAt.clear(); Pl.airDash = true; Pl.face(dir, true); Pl.aim = aim; Pl.teleport(pf.arena, 'lines'); zip.n++;
    for (let i = 0; i < 200 && Pl.quick; i++) await sleep(0.01);
  };
  const pick = (around) => (around ? (Math.sign(B.x - Pl.x) || 1) : Pl.x > 7 ? -1 : Pl.x < -7 ? 1 : Pl.facing);
  while (!zip.stop) {
    zip.mode = 'ground';
    for (let k = 0; k < 4 && !zip.stop; k++) { const around = Math.abs(B.x - Pl.x) < 6.5 && Math.random() < 0.5; if (around) zip.around++; await hop(pick(around), 0); }
    if (zip.stop || !Pl.canFly) continue;
    zip.mode = 'air'; await hop(pick(false), 1);
    let last = 1;
    for (let k = 0; k < 5 && !zip.stop; k++) {
      zip.air++;
      const over = Math.abs(B.x - Pl.x) < 6.5 && Math.random() < 0.4; if (over) zip.around++;
      const aim = Pl.y < 2.5 ? 1 : Pl.y > 6 ? -1 : [1, 0, -1].filter((a) => a !== last)[Math.floor(Math.random() * 2)]; last = aim;
      await hop(pick(over), aim);
    }
    zip.mode = 'land';
    for (let k = 0; k < 3 && Pl.y > 0.3 && !zip.stop; k++) await hop(pick(false), -1);
    for (let i = 0; i < 150 && !Pl.grounded; i++) await sleep(0.02);
  }
  sc.onBeforeRenderObservable.remove(keep);
})();
