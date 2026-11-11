// Demo: the stadiums — Poke2D Arena's six stages, rebuilt low-poly in 3D, no tiles (grass to start; the buttons along the top switch).
// The hex board and its surroundings hidden; Charizard (the player) steered by WASD against Greninja, the camera over its shoulder.
// Others: window.__arenaCfg = { player: 'Charizard', opponent: 'Ceruledge', moves: [4 moves], botMoves: [...], stamina: false } first.
// Run in the page: (0, eval)(await (await fetch('/docs/demos/arena-grass.js')).text())
(async () => {
  window.__built = true;
  const S = await import('/src/shared/index.ts');
  const { grassStadium } = await import('/src/client/render/arenas/grassStadium.ts');
  const P = window.__pbw, f = P.factory, sc = P.scene;
  for (const el of document.querySelectorAll('body > *:not(canvas)')) { if (!el.querySelector('canvas')) el.style.display = 'none'; }
  P.camera.tick = () => {};
  for (const m of sc.meshes) m.setEnabled(false);
  const { THEMED_STADIUMS } = await import('/src/client/render/arenas/themedStadiums.ts');
  const STADIUMS = { grass: grassStadium, ...THEMED_STADIUMS };
  window.__arena?.dispose();
  let arena = STADIUMS.grass(sc);
  P.field.setAir(arena.air); sc.clearColor = arena.air.fog.toColor4(1);
  const V = arena.root.position.constructor;
  // Who and with what (window.__arenaCfg first): the player, its moves on 1–4; the opponent, the moves it fires back with.
  const cfg = { player: 'Charizard', opponent: 'Greninja', moves: ['Flamethrower', 'Dragon Pulse', 'Flare Blitz', 'Outrage'],
    botMoves: ['Hydro Pump', 'Acrobatics'], stamina: true, ...(window.__arenaCfg ?? {}) };
  const a = await f.createPokemon(S.getSpecies(cfg.opponent), 1), b = await f.createPokemon(S.getSpecies(cfg.player), 2);
  a.position.set(-9, 0, 0); b.position.set(9, 0, 0); f.faceEachOther(a, b);
  const cam = sc.activeCamera; cam.maxZ = Math.max(cam.maxZ, 400);
  // Third person, over Charizard's shoulder, always looking at Greninja: only Charizard moving moves it, never the mouse.
  // Charizard on WASD / the arrows (W toward Greninja, A/D round it, S away), F held to walk, Shift to dash, Space to fly / land; 1–4 arm a move, left click lets it go.
  const { ShoulderCam } = await import('/src/client/camera/ShoulderCam.ts');
  const { WasdControl } = await import('/src/client/input/WasdControl.ts');
  window.__wasd?.dispose(); window.__shoulder?.dispose();
  window.__shoulder = new ShoulderCam(sc, cam, b, a, (n) => f.heightOf(n), (n) => f.liftOf(n));
  window.__wasd = new WasdControl(sc, f, cam, b, { bounds: arena.bounds, follow: false });
  // Its moves on 1–4 (armed), let go with a left click at Greninja; every move follows its target.
  // Greninja fires back every few seconds (Hydro Pump, Acrobatics): dash (Shift) just before it lands to dodge — too soon and it follows you.
  // Stamina (the bar): standing still fills it; dashes, beams held past their first moment, and long rushes spend it.
  const { RealtimeMoves } = await import('/src/client/input/RealtimeMoves.ts');
  const { MoveControl } = await import('/src/client/input/MoveControl.ts');
  const { OpponentBot } = await import('/src/client/input/OpponentBot.ts');
  window.__moves?.dispose(); window.__bot?.dispose();
  const wasd = window.__wasd;
  // Stamina: each its own — filled by standing still, spent on dashes, held beams and long rushes. The player's shown over its moves.
  const { Stamina } = await import('/src/client/input/Stamina.ts');
  for (const s of window.__staminas?.values() ?? []) s.dispose();
  const paceOf = (n) => (n === wasd.node ? wasd.pace : window.__bot?.busy ? 'busy' : 'still');
  // (Testing — stamina: false — none at all: no bar, nothing spent.)
  const staminas = (window.__staminas = new Map(cfg.stamina ? [a, b].map((n) => [n, new Stamina(sc, () => paceOf(n))]) : []));
  const showStamina = (n) => {
    for (const s of staminas.values()) s.hide();
    if (!staminas.has(n)) return;
    Object.assign(staminas.get(n).show().style, { position: 'fixed', left: '50%', bottom: '74px', transform: 'translateX(-50%)', zIndex: '60' });
  };
  wasd.options.stamina = staminas.get(b) ?? null; showStamina(b);
  const engine = new RealtimeMoves(sc, f, P.vfx, {
    staminaOf: (n) => staminas.get(n) ?? null,
    dashOf: (n) => (n === wasd.node ? { startedAt: wasd.dashStartedAt, going: wasd.isDashing } : null),
    onStruck: (n, until) => { if (n === wasd.node) void wasd.hold(until); else if (n === window.__bot?.node) window.__bot.hold(until); },
    clamp: (p) => { const B = arena.bounds; p.x = Math.max(-B.halfW + 0.6, Math.min(B.halfW - 0.6, p.x)); p.z = Math.max(-B.halfD + 0.6, Math.min(B.halfD - 0.6, p.z)); return p; },
  });
  window.__moves = new MoveControl(engine, wasd, a, document.querySelector('canvas'), cfg.moves);
  window.__bot = new OpponentBot(sc, engine, a, b, cfg.botMoves);
  // (Resting for now: it stands and watches. __bot.paused = false to have it fire back.)
  window.__bot.paused = true;
  // Swap who you play: __play('Greninja') / __play('Charizard').
  window.__play = (name) => { const [me, them] = name === cfg.opponent ? [a, b] : [b, a]; window.__wasd.take(me); window.__shoulder.player = me; window.__shoulder.opponent = them; window.__moves.opponent = them; window.__bot.node = them; window.__bot.target = me; wasd.options.stamina = staminas.get(me) ?? null; showStamina(me); };
  document.querySelector('canvas').focus();
  window.__arena = arena;
  // The stadiums: __stadium('forest' | 'seaside' | 'volcanic' | 'ice' | 'ruins' | 'grass'), or the buttons along the top.
  // Its floor under every Pokémon (they stand on its stones, its dunes), and its footprints (sand).
  const { Footprints } = await import('/src/client/render/arenas/footprints.ts');
  const ground = () => {
    f.groundAt = arena.heightAt ?? null;
    window.__prints?.dispose(); window.__prints = null;
    if (arena.footprints && arena.heightAt) window.__prints = new Footprints(sc, f, () => [a, b], arena.heightAt, arena.footprints);
  };
  ground();
  window.__stadium = (name) => {
    arena.dispose();
    arena = window.__arena = STADIUMS[name](sc);
    P.field.setAir(arena.air); sc.clearColor = arena.air.fog.toColor4(1);
    ground();
    window.__wasd.node.position.set(9, 0, 0); window.__bot.node.position.set(-9, 0, 0);
  };
  document.querySelector('#stadiumPick')?.remove();
  const { el, ensureStyles } = await import('/src/client/ui/dom.ts');
  ensureStyles();
  const pick = el('div', { id: 'stadiumPick', style: { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', display: 'flex', gap: '8px', zIndex: '60' } });
  for (const name of Object.keys(STADIUMS)) pick.append(el('button', { class: 'pbw-btn', text: name[0].toUpperCase() + name.slice(1), onclick: () => window.__stadium(name) }));
  document.body.append(pick);
})();
