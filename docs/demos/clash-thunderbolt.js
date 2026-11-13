// Demo: in the League stadium, Pikachu's Thunderbolt against Zeraora's (yellow lightning against blue) — a clash
// held at its stand-off on beam 2's clash ball (meeting in the middle, pouring, for as long as it runs), the camera
// free: right-drag to orbit round the clash ball (kept centred on it, no panning), wheel to zoom.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/clash-thunderbolt.js')).text())
// Let it go (a tie: the ball bursts, both fade): window.__clashHold.release()
// Options first: window.__clashMoves = ['Thunderbolt', 'Thunderbolt'] (left, right);
// window.__clashSpecies = ['Pikachu', 'Zeraora']; window.__clashGap = 9
(async () => {
  const B = await import('/src/client/vfx/beam/beamMoves.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  window.__loop && (window.__loop.stop = true);
  window.__zip && (window.__zip.stop = true);
  window.__clashHold?.release();
  const [left, right] = window.__clashMoves ?? ['Thunderbolt', 'Thunderbolt'];
  const [sa, sb] = window.__clashSpecies ?? ['Pikachu', 'Zeraora'];
  const gap = window.__clashGap ?? 9;
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: sa, boss: sb, moves: { ranged: left }, bossMoves: { ranged: right } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const a = pf.player, b = pf.boss;
  // (No fight: the boss still, the fighters held as firing, the camera left to you.)
  pf.ai.paused = true;
  pf.restart(); pf.ai.paused = true;
  await new Promise((r) => setTimeout(r, 600));
  pf.follow = () => {};
  a.place(-gap / 2, 0, 1); b.place(gap / 2, 0, 1); a.face(1, true); b.face(-1, true);
  await new Promise((r) => setTimeout(r, 300));
  for (const x of [a, b]) { x.firing = true; x.using = x.moves.ranged; }
  const cam = sc.activeCamera, canvas = sc.getEngine().getRenderingCanvas();
  const V = a.node.position.constructor;
  const mid = new V(0, 1.1, 0);
  if ('lowerRadiusLimit' in cam) { cam.lowerRadiusLimit = 0.5; cam.upperRadiusLimit = 60; cam.wheelPrecision = 30; cam.panningSensibility = 0; }
  cam.setTarget(mid);
  cam.setPosition?.(mid.add(new V(0, 1.2, -11)));
  cam.attachControl(canvas, true);
  // (Orbiting on the right button only; its menu kept off the canvas.)
  if (cam.inputs?.attached?.pointers) cam.inputs.attached.pointers.buttons = [2];
  canvas.oncontextmenu = (e) => e.preventDefault();
  // The stand-off, held till let go.
  let release; const held = new Promise((r) => { release = r; });
  window.__clashHold = { release, a, b, cam };
  // (As the game makes them — Fighter.beamFor: a bolt off the body, Thunderbolt, on beam 2's clash ball; every other move
  // as it is: Ice Beam's starting egg and clash ball beam 1's.)
  const F = await import('/src/client/platformer/Fighter.ts');
  const spec = (m) => { const s = F.beamFor(m) ?? B.beamFor(m) ?? { element: 'Normal' }; return s.bolt && s.eggless ? { ...s, style: 2 } : s; };
  const play = f.playClash(a.node, b.node, spec(left), spec(right), null, 0, held, 0.5);
  // (The orbit's centre kept on the clash ball, wherever it sits.)
  const centre = sc.onBeforeRenderObservable.add(() => { const p = play.point?.(); if (p) cam.target.copyFrom(p); });
  void play.done.then(() => sc.onBeforeRenderObservable.remove(centre));
  void play.done.then(() => { for (const x of [a, b]) { x.firing = false; x.using = ''; } });
})();
