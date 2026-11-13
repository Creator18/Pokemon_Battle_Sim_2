// Demo: a held beam — poured onto the target for as long as it is held (Dragon Pulse by default: a beam 2, one long
// egg out to it; a bolt — Ice Beam, Psybeam, Thunderbolt — runs into it, zapping it). No damage: the look only. The camera free: drag to orbit round the middle, wheel to zoom.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/beam-held.js')).text())
// Others first: window.__bhMove = 'Dragon Pulse', window.__bhSpecies = 'Charizard', window.__bhTarget = 'Charizard',
// window.__bhGap = 4.5. Let go: window.__bhHold.release()
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const F = await import('/src/client/platformer/Fighter.ts');
  const P = window.__pbw, sc = P.scene, f = P.factory;
  for (const k of ['__loop', '__zip', '__eq', '__se', '__sb']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  window.__tbHold?.release();
  window.__bhHold?.release();
  await new Promise((r) => setTimeout(r, 600));
  const move = window.__bhMove ?? 'Dragon Pulse';
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__bhSpecies ?? 'Charizard', boss: window.__bhTarget ?? 'Charizard',
    moves: { ranged: move, close: 'Dragon Claw', mobility: 'Quick Attack', control: 'Detect' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 800));
  pf.restart(); pf.ai.paused = true;
  const a = pf.player, b = pf.boss, gap = window.__bhGap ?? 4.5;
  a.place(-gap / 2, 0, 1); b.place(gap / 2, 0, -1); a.face(1, true); b.face(-1, true);
  await new Promise((r) => setTimeout(r, 500));
  a.firing = true; a.using = move; b.stunned = true;
  let release; const held = new Promise((r) => { release = r; });
  // (As the game fires it: a bolt — Thunderbolt, Ice Beam, Psybeam — run into the target's body and taken into its aura,
  // and the target zapped in its colours till it lets go.)
  const base = F.beamFor(move);
  const spec = base.bolt ? { ...base, onto: () => b.node } : base;
  const play = f.playBeam(a.node, b.node, b.node.position.clone(), spec, held);
  void play.launched?.then(() => new Promise((r) => setTimeout(r, 300))).then(() => {
    f.holdHitReact?.(b.node, held);
    a.zap(b, move, held);
  });
  // (The camera free: drag — either button — to orbit round the middle, wheel to zoom; no panning.)
  pf.follow = () => {};
  const cam = sc.activeCamera, canvas = sc.getEngine().getRenderingCanvas(), V = a.node.position.constructor;
  const mid = new V(0, 1.1, 0);
  if ('lowerRadiusLimit' in cam) { cam.lowerRadiusLimit = 0.5; cam.upperRadiusLimit = 60; cam.wheelPrecision = 30; cam.panningSensibility = 0; }
  cam.setTarget(mid); cam.setPosition?.(mid.add(new V(0, 1.4, -10)));
  cam.attachControl(canvas, true);
  if (cam.inputs?.attached?.pointers) cam.inputs.attached.pointers.buttons = [0, 2];
  canvas.oncontextmenu = (e) => e.preventDefault();
  window.__bhHold = { release: () => { release(); a.firing = false; a.using = ''; b.stunned = false; }, a, b };
  void play.done.then(() => { a.firing = false; a.using = ''; b.stunned = false; });
})();
