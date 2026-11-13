// Slow motion for any demo: the page's clock (performance.now, which Babylon's frame times are read from, and every
// setTimeout) runs at `window.__slow` × real time — everything, the game, its effects and the demos' own waits, slowed
// together. Run in the page: window.__slow = 0.25; (0, eval)(await (await fetch('/docs/demos/slowmo.js')).text())
// Back to full speed: window.__slow = 1 (the clock stays patched, at 1×).
(() => {
  if (window.__slowPatched) return;
  window.__slowPatched = true;
  const realNow = performance.now.bind(performance);
  const realTimeout = window.setTimeout.bind(window);
  // (Its own clock: real time since the last change of speed, scaled, on from where it was — never jumping.)
  let base = realNow(), at = base, speed = window.__slow ?? 0.25;
  const now = () => {
    const want = window.__slow ?? 1;
    if (want !== speed) { const t = at + (realNow() - base) * speed; base = realNow(); at = t; speed = want; }
    return at + (realNow() - base) * speed;
  };
  performance.now = now;
  window.setTimeout = (fn, ms = 0, ...args) => realTimeout(fn, (ms || 0) / Math.max(1e-3, window.__slow ?? 1), ...args);
})();
