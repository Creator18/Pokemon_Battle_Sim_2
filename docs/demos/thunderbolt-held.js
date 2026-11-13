// Demo: a held Thunderbolt — Pikachu's bolts pouring into Charizard for as long as it is held, Charizard lit in the
// Electric zap aura (filled, shivering) the whole time. No damage: the look only. The camera free: right-drag to orbit
// round the bolt, wheel to zoom.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/thunderbolt-held.js')).text())
// Others first: window.__tbSpecies = 'Pikachu', window.__tbTarget = 'Charizard'. Let go: window.__tbHold.release()
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const F = await import('/src/client/platformer/Fighter.ts');
  const P = window.__pbw, sc = P.scene, f = P.factory;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf', '__miss', '__tb', '__tb2']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  window.__tbHold?.release();
  await new Promise((r) => setTimeout(r, 600));
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: window.__tbSpecies ?? 'Pikachu', boss: window.__tbTarget ?? 'Charizard',
    moves: { ranged: 'Thunderbolt', close: 'Dragon Claw', mobility: 'Agility', control: 'Sucker Punch' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 800));
  pf.restart(); pf.ai.paused = true;
  const a = pf.player, b = pf.boss;
  a.place(-3.5, 0, 1); b.place(3.5, 0, -1); a.face(1, true); b.face(-1, true);
  await new Promise((r) => setTimeout(r, 500));
  // (Both held as in a move: the attacker firing, the target struck.)
  a.firing = true; a.using = 'Thunderbolt'; b.stunned = true;
  let release; const held = new Promise((r) => { release = r; });
  const spec = { ...F.beamFor('Thunderbolt'), onto: () => b.node };
  const play = f.playBeam(a.node, b.node, b.node.position.clone(), spec, held);
  // Zapped from the moment the bolts reach it till they let go.
  let aura = null;
  void play.launched?.then(() => new Promise((r) => setTimeout(r, 450))).then(() => {
    aura = f.aura(b.node, { element: f.hueOf(a.node, 'Electric'), edge: 'smooth', reach: 'tight', fill: true, ignite: 0.08, die: 0.35, shiver: true });
    f.holdHitReact?.(b.node, held);
  });
  // (The camera free: right-drag to orbit round the middle of the bolt, wheel to zoom; no panning.)
  pf.follow = () => {};
  const cam = sc.activeCamera, canvas = sc.getEngine().getRenderingCanvas(), V = a.node.position.constructor;
  const mid = new V((a.x + b.x) / 2, 1.0, 0);
  if ('lowerRadiusLimit' in cam) { cam.lowerRadiusLimit = 0.5; cam.upperRadiusLimit = 60; cam.wheelPrecision = 30; cam.panningSensibility = 0; }
  cam.setTarget(mid); cam.setPosition?.(mid.add(new V(0, 1.4, -10)));
  cam.attachControl(canvas, true);
  if (cam.inputs?.attached?.pointers) cam.inputs.attached.pointers.buttons = [2];
  canvas.oncontextmenu = (e) => e.preventDefault();
  window.__tbHold = { release: () => { release(); aura?.release(); a.firing = false; a.using = ''; b.stunned = false; }, a, b };
  void play.done.then(() => { a.firing = false; a.using = ''; b.stunned = false; });
})();
