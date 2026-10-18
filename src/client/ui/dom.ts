/** Tiny DOM helpers + one-time global stylesheet injection for the UI overlay. */

import { THEME } from '../theme.ts';

type Attrs = Partial<{
  class: string;
  id: string;
  text: string;
  html: string;
  title: string;
  style: Partial<CSSStyleDeclaration>;
  onclick: (e: MouseEvent) => void;
  oninput: (e: Event) => void;
  dataset: Record<string, string>;
}>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // Command buttons are the layered 3D button (see .pbw-btn below): the label
  // goes on the face, over the deck it presses down onto.
  const btn3d = tag === 'button' && !!attrs?.class && /(^|\s)pbw-btn(\s|$)/.test(attrs.class);
  const label: ParentNode & Node = btn3d ? build3dButton(node as HTMLElement) : node;
  if (attrs) {
    if (attrs.class) node.className = attrs.class;
    if (attrs.id) node.id = attrs.id;
    if (attrs.text !== undefined) label.textContent = attrs.text;
    if (attrs.html !== undefined) node.innerHTML = attrs.html;
    if (attrs.title !== undefined) node.title = attrs.title;
    if (attrs.style) Object.assign(node.style, attrs.style);
    if (attrs.onclick) node.addEventListener('click', attrs.onclick as EventListener);
    if (attrs.oninput) node.addEventListener('input', attrs.oninput);
    if (attrs.dataset) for (const [k, v] of Object.entries(attrs.dataset)) node.dataset[k] = v;
  }
  if (children) for (const c of children) label.append(c);
  return node;
}

/**
 * The 3D command button: a deck (the block underneath), and a face that lifts
 * on hover and presses down onto the deck on click, with a press spot that
 * darkens and a gloss stripe that sweeps across. Returns the label span.
 */
function build3dButton(node: HTMLElement): HTMLElement {
  const span = (cls: string) => {
    const s = document.createElement('span');
    s.className = cls;
    return s;
  };
  const deck = span('pbw-btn-deck');
  const face = span('pbw-btn-face');
  const spot = span('pbw-btn-spot');
  const sheen = span('pbw-btn-sheen');
  const label = span('pbw-btn-label');
  deck.setAttribute('aria-hidden', 'true');
  spot.setAttribute('aria-hidden', 'true');
  sheen.setAttribute('aria-hidden', 'true');
  face.append(spot, sheen, label);
  node.append(deck, face);
  return label;
}

let injected = false;
export function ensureStyles(): void {
  if (injected) return;
  injected = true;
  const css = `
  :root {
    --bg: ${THEME.bg}; --panel: ${THEME.panel}; --panel-alt: ${THEME.panelAlt};
    --accent: ${THEME.accent}; --text: ${THEME.text}; --text-dim: ${THEME.textDim};
    --border: ${THEME.border}; --good: ${THEME.good}; --warn: ${THEME.warn}; --bad: ${THEME.bad};
  }
  .pbw-modal-wrap {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(5,5,15,0.72); backdrop-filter: blur(3px); z-index: 50;
  }
  .pbw-panel {
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    padding: 24px; color: var(--text); box-shadow: 0 18px 60px rgba(0,0,0,0.6);
    max-width: 92vw; max-height: 92vh; overflow: auto;
  }
  .pbw-h1 { font-size: 26px; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.5px; }
  .pbw-h2 { font-size: 16px; font-weight: 700; color: var(--text-dim); margin: 10px 0 8px; text-transform: uppercase; letter-spacing: 1px; }
  .pbw-sub { color: var(--text-dim); font-size: 14px; margin-bottom: 16px; }
  /* ── The 3D command button ─────────────────────────────────────────
     A face over a deck. Rest / hover / press move whole pixels only (a
     fractional move or a tilt makes Chrome drop anti-aliasing on the edge:
     a dashed rim). The overshooting curve stands in for the spring
     (stiffness 620, damping 32, mass 0.5). */
  .pbw-btn {
    --spring: cubic-bezier(.3, 1.45, .55, 1); --t: .2s;
    --deck: #ffffff; --deck-glow: rgba(255,255,255,0.15);
    --face: #18181b; --ink: #ffffff; --rim: #ffffff;
    --hi: rgba(255,255,255,0.15); --lo: rgba(0,0,0,0.3);
    --spot: rgba(255,255,255,0.2); --gloss: rgba(255,255,255,0.42);
    position: relative; isolation: isolate; display: inline-flex; min-width: 152px;
    padding: 0 0 6px; border: none; background: none; border-radius: 9999px;
    cursor: pointer; outline: none; font-family: inherit; color: var(--ink);
    -webkit-tap-highlight-color: transparent;
  }
  .pbw-btn:focus-visible { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #fff; }
  .pbw-btn:disabled { pointer-events: none; opacity: 0.5; }
  .pbw-btn-deck {
    position: absolute; left: 0; right: 0; bottom: 0; top: 6px; z-index: -1;
    border-radius: 9999px; background: var(--deck); box-shadow: 0 10px 18px var(--deck-glow);
    transition: transform var(--t) var(--spring);
  }
  .pbw-btn-face {
    position: relative; z-index: 1; display: inline-flex; width: 100%;
    align-items: center; justify-content: center; overflow: hidden;
    border-radius: 9999px; padding: 12px 28px;
    background: var(--face); color: var(--ink); font-size: 14px; font-weight: 600; line-height: 20px;
    /* An inset ring, not a border, so the rim stays smooth while the face moves. */
    box-shadow: inset 0 0 0 1px var(--rim), inset 0 2px 0 var(--hi), inset 0 -2px 0 var(--lo);
    backface-visibility: hidden; will-change: transform;
    transition: transform var(--t) var(--spring);
  }
  .pbw-btn-spot {
    position: absolute; top: 4px; bottom: 4px; left: 50%; width: 40px; margin-left: -20px;
    border-radius: 9999px; background: var(--spot); filter: blur(4px); pointer-events: none;
    opacity: 0; transform: scaleX(.25);
    transition: transform var(--t) var(--spring), opacity var(--t) var(--spring);
  }
  /* The gloss: a soft, slanted band of light that SWEEPS the face — once,
     left to right, each time the pointer arrives, and again (faster,
     brighter) on a press. It travels at constant speed with a gentle ease
     out and fades at both ends, so it reads as light passing over a curved
     surface rather than a stripe jumping into place. */
  .pbw-btn-sheen {
    position: absolute; top: -20%; bottom: -20%; left: 0; width: 46%; pointer-events: none;
    background: linear-gradient(100deg,
      transparent 0%, color-mix(in srgb, var(--gloss) 35%, transparent) 30%,
      var(--gloss) 50%, color-mix(in srgb, var(--gloss) 35%, transparent) 70%, transparent 100%);
    mix-blend-mode: screen; filter: blur(1px);
    opacity: 0; transform: translateX(-140%) skewX(-18deg);
  }
  @keyframes pbw-sheen-sweep {
    0%   { opacity: 0;   transform: translateX(-140%) skewX(-18deg); }
    18%  { opacity: .85; }
    70%  { opacity: .85; }
    100% { opacity: 0;   transform: translateX(260%) skewX(-18deg); }
  }
  @keyframes pbw-sheen-press {
    0%   { opacity: 0; transform: translateX(-140%) skewX(-18deg); }
    25%  { opacity: 1; }
    100% { opacity: 0; transform: translateX(260%) skewX(-18deg); }
  }
  .pbw-btn-label { position: relative; z-index: 1; white-space: nowrap; transition: transform var(--t) var(--spring); }
  .pbw-btn:hover .pbw-btn-deck { transform: translateY(1px); }
  .pbw-btn:hover .pbw-btn-face { transform: translateY(-2px); }
  .pbw-btn:hover .pbw-btn-spot { opacity: .3; transform: scaleX(.45); }
  .pbw-btn:hover .pbw-btn-sheen { animation: pbw-sheen-sweep .8s cubic-bezier(.25, .6, .35, 1) both; }
  .pbw-btn:hover .pbw-btn-label { transform: translateY(-1px); }
  .pbw-btn:active .pbw-btn-deck { transform: translateY(-1px); }
  .pbw-btn:active .pbw-btn-face { transform: translateY(6px); }
  .pbw-btn:active .pbw-btn-spot { opacity: 1; transform: scaleX(1); }
  .pbw-btn:active .pbw-btn-sheen { animation: pbw-sheen-press .38s cubic-bezier(.3, .7, .4, 1) both; }
  @media (prefers-reduced-motion: reduce) { .pbw-btn .pbw-btn-sheen { animation: none !important; } }
  .pbw-btn:active .pbw-btn-label { transform: translateY(1px); }
  /* Secondary actions (Back, Join, Clear path) and an unselected toggle: the
     same button, quieter — a grey deck and rim, dimmer ink. */
  .pbw-btn.ghost, .pbw-btn.toggle-off {
    --deck: #52525b; --deck-glow: rgba(0,0,0,0.25);
    --face: #18181b; --rim: #52525b; --ink: #d4d4d8; --spot: rgba(255,255,255,0.12);
  }
  .pbw-btn.toggle-off { --ink: var(--text-dim); }
  .pbw-btn.toggle-on .pbw-btn-sheen { mix-blend-mode: multiply; }
  /* The selected toggle: the face lights up white, ink dark. */
  .pbw-btn.toggle-on {
    --face: #fafafa; --ink: #09090b; --rim: #d4d4d8; --deck: #ffffff;
    --hi: rgba(255,255,255,0.9); --lo: rgba(24,24,27,0.06);
    --spot: rgba(9,9,11,0.1); --gloss: rgba(113,113,122,0.38);
  }
  .pbw-input {
    background: var(--panel-alt); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 10px 12px; font-size: 15px; font-family: inherit; width: 100%;
  }
  .pbw-row { display: flex; gap: 10px; align-items: center; }
  .pbw-grid { display: grid; gap: 12px; }
  .pbw-card {
    background: var(--panel-alt); border: 2px solid var(--border); border-radius: 12px;
    padding: 12px; cursor: pointer; transition: border-color .15s, transform .1s;
    text-align: center;
  }
  .pbw-card:hover { transform: translateY(-2px); }
  .pbw-card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
  .pbw-card img { width: 72px; height: 72px; image-rendering: pixelated; }
  .pbw-tag {
    display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px;
    font-weight: 700; margin: 2px; color: #10101c;
  }
  .pbw-move {
    background: var(--panel-alt); border: 2px solid var(--border); border-radius: 9px;
    padding: 8px 10px; cursor: pointer; text-align: left; font-size: 13px; position: relative;
    transition: border-color .12s;
  }
  .pbw-move.selected { border-color: var(--accent); }
  .pbw-move.disabled { opacity: 0.45; cursor: not-allowed; }
  .pbw-move .mv-name { font-weight: 700; }
  .pbw-move .mv-meta { color: var(--text-dim); font-size: 11px; }
  .pbw-tooltip {
    position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; width: 240px;
    background: #0A0A16; border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    font-size: 12px; z-index: 100; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    pointer-events: none;
  }
  .pbw-move:hover .pbw-tooltip { display: block; }

  /* HUD */
  #pbw-hud { position: fixed; top: 0; left: 0; right: 0; padding: 14px 18px;
    display: flex; justify-content: space-between; align-items: flex-start; pointer-events: none; }
  .pbw-hpwrap { pointer-events: auto; width: 300px; }
  .pbw-hpwrap.right { text-align: right; }
  .pbw-name { font-weight: 800; font-size: 16px; color: var(--text); text-shadow: 0 1px 3px #000; }
  .pbw-hpbar { height: 14px; background: #10101c; border-radius: 8px; overflow: hidden; margin-top: 4px; border: 1px solid var(--border); }
  .pbw-hpfill { height: 100%; width: 100%; transition: width .5s ease, background .3s; border-radius: 8px; }
  .pbw-hptext { font-size: 12px; color: var(--text-dim); margin-top: 3px; }
  .pbw-statusicons { margin-top: 4px; }
  .pbw-status-icon { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 6px; margin-right: 4px; }
  #pbw-turnbar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto;
    background: var(--panel); border: 1px solid var(--border); border-radius: 20px; padding: 6px 16px;
    color: var(--text); font-weight: 700; font-size: 14px; display: flex; gap: 12px; align-items: center; }
  .pbw-weather { font-size: 12px; color: var(--warn); }

  /* Declaration panel */
  #pbw-decl { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); pointer-events: auto;
    background: var(--panel); border: 1px solid var(--border); border-top-left-radius: 14px; border-top-right-radius: 14px;
    padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; min-width: 620px; max-width: 90vw; }
  .pbw-moves-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .pbw-hint { color: var(--text-dim); font-size: 13px; text-align: center; min-height: 18px; }
  .pbw-cd-pips { display: flex; gap: 3px; margin-top: 4px; }
  .pbw-cd-pip { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
  .pbw-cd-pip.hot { background: var(--accent); }

  /* Battle log */
  #pbw-log { position: fixed; bottom: 14px; left: 14px; width: 320px; max-height: 210px; overflow-y: auto;
    pointer-events: auto; background: rgba(13,13,26,0.82); border: 1px solid var(--border); border-radius: 10px;
    padding: 10px; font-size: 12px; color: var(--text-dim); line-height: 1.5; }
  #pbw-log .turnhdr { color: var(--accent); font-weight: 700; margin-top: 4px; }

  /* Game over */
  .pbw-winner { font-size: 40px; font-weight: 900; text-align: center; margin-bottom: 8px; }

  .pbw-conn-status { font-size: 13px; margin-top: 10px; }
  .pbw-dot { display:inline-block; width:9px;height:9px;border-radius:50%;margin-right:6px; }
  .pbw-spinner { display:inline-block; width:16px;height:16px;border:2px solid var(--border);
    border-top-color: var(--accent); border-radius:50%; animation: pbw-spin .8s linear infinite; vertical-align: middle; }
  @keyframes pbw-spin { to { transform: rotate(360deg); } }
  .pbw-ready-tag { font-size: 12px; padding: 2px 8px; border-radius: 8px; margin-left: 6px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}

export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
