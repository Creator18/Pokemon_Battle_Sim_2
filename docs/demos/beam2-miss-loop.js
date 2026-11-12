// Demo: a beam 2 (Dragon Pulse) striking nothing, looped — its start egg and its column as one long egg (broad at the
// start, rounded narrow front), no end ball. The camera held side-on on it.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/beam2-miss-loop.js')).text())
// Another beam first: window.__missMove = 'Hydro Pump'. The start egg alone (no shaft): window.__missShaft = false.
// Stop: window.__miss.stop = true
(async () => {
  for (let i = 0; i < 100 && !window.__zone; i++) await new Promise((r) => setTimeout(r, 100));
  const P = window.__pbw, sc = P.scene;
  for (const k of ['__loop', '__zip', '__counter', '__cc', '__agility', '__back', '__cf']) window[k] && (window[k].stop = true);
  window.__clashHold?.release();
  if (window.__miss) { window.__miss.stop = true; await new Promise((r) => setTimeout(r, 2500)); }
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ moves: { ranged: window.__missMove ?? 'Dragon Pulse', close: 'Dragon Claw', mobility: 'Agility', control: 'Counter' } });
  const pf = window.__pf = window.__zone.pf; window.__arena = window.__zone.arena;
  const me = pf.player, B = pf.boss;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const tap = async (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); await sleep(0.05); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  pf.ai.paused = true; await sleep(0.8); pf.restart(); pf.ai.paused = true; await sleep(0.3);
  // (The camera held: side-on, the whole beam in view.)
  pf.follow = () => {};
  const cam = sc.activeCamera, V = me.node.position.constructor;
  const m = window.__miss = { stop: false, shots: 0 };
  // (No shaft, if asked: its column, its swirls and tornado hidden each frame — the start egg alone.)
  const hide = sc.onBeforeRenderObservable.add(() => {
    const off = window.__missShaft === false;
    for (const x of sc.meshes) if (/^beam(Tube|Swirl|Tornado)/.test(x.name)) x.isVisible = !off;
  });
  while (!m.stop) {
    me.restore(); me.readyAt.clear();
    B.place(9.5, 0, -1); me.place(4, 0, -1); me.face(-1, true);
    cam.setTarget(new V(-1, 1.2, 0)); cam.setPosition?.(new V(-1, 2.4, -15));
    await sleep(0.6);
    await tap('u'); m.shots++;
    for (let i = 0; i < 100 && !me.busy; i++) await sleep(0.02);
    for (let i = 0; i < 400 && me.busy && !m.stop; i++) await sleep(0.02);
    await sleep(0.5);
  }
  sc.onBeforeRenderObservable.remove(hide);
  for (const x of sc.meshes) if (/^beam(Tube|Swirl|Tornado)/.test(x.name)) x.isVisible = true;
})();
