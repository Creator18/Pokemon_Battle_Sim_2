// Demo: the new crescent cut (CrescentFx) against the old slash (RecipeFactory.playCrossSlash) — Garchomp at Metagross,
// side-on, round and round: old, new, old, new… through a few types. A label says which is which.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/crescent-cut.js')).text())
// Options first: window.__ccTypes = ['Dragon', 'Dark', 'Fire'], window.__ccOnly = 'new' (or 'old').
// Stop: window.__crescent.stop = true
(async () => {
  window.__crescent && (window.__crescent.stop = true);
  const me = (window.__crescent = { stop: false });
  const { CrescentFx } = await import('/src/client/vfx/CrescentFx.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  window.__zone?.dispose();
  window.__zone = await P.startBossZone({ species: 'Garchomp', boss: 'Metagross', moves: { ranged: 'Dragon Pulse', close: 'Dragon Claw', control: 'Detect' } });
  const pf = window.__pf = window.__zone.pf;
  pf.ai.paused = true; pf.restart(); pf.ai.paused = true;
  const idle = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false };
  pf.playerIntent = () => ({ ...idle, face: 1 });
  await new Promise((r) => setTimeout(r, 900));
  const a = pf.player, b = pf.boss;
  a.place(-1.6, 0, 1); b.place(1.6, 0, -1); a.face(1, true); b.face(-1, true);
  const fx = new CrescentFx(sc, sc.activeCamera);
  // A label: which one this is.
  let tag = document.getElementById('ccTag');
  if (!tag) {
    tag = document.createElement('div'); tag.id = 'ccTag';
    Object.assign(tag.style, { position: 'fixed', top: '90px', left: '50%', transform: 'translateX(-50%)', font: '700 22px system-ui', color: '#fff',
      textShadow: '0 2px 6px #000', zIndex: 50, pointerEvents: 'none' });
    document.body.appendChild(tag);
  }
  const types = window.__ccTypes ?? ['Dragon', 'Dark', 'Fire', 'Psychic', 'Ghost', 'Water'];
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  for (let k = 0; !me.stop; k++) {
    const type = types[Math.floor(k / 2) % types.length];
    const which = window.__ccOnly ?? (k % 2 ? 'new' : 'old');
    tag.textContent = `${which === 'new' ? 'NEW crescent' : 'old slash'} — ${type}`;
    if (which === 'old') {
      await f.playCrossSlash(a.node, b.node.position.clone(), type, () => { void f.playHitReact(b.node); return true; }, true);
    } else {
      // Its swipe, as a slash plays it, the crescent following its striking part (RecipeFactory.playCrescentSlash);
      // the blow as its head crosses in front.
      await f.playCrescentSlash(a.node, b.node.position.clone(), type, () => { void f.playHitReact(b.node); return true; });
      await sleep(0.6);
    }
    await sleep(0.9);
  }
  tag.remove();
})();
