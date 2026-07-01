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
  if (attrs) {
    if (attrs.class) node.className = attrs.class;
    if (attrs.id) node.id = attrs.id;
    if (attrs.text !== undefined) node.textContent = attrs.text;
    if (attrs.html !== undefined) node.innerHTML = attrs.html;
    if (attrs.title !== undefined) node.title = attrs.title;
    if (attrs.style) Object.assign(node.style, attrs.style);
    if (attrs.onclick) node.addEventListener('click', attrs.onclick as EventListener);
    if (attrs.oninput) node.addEventListener('input', attrs.oninput);
    if (attrs.dataset) for (const [k, v] of Object.entries(attrs.dataset)) node.dataset[k] = v;
  }
  if (children) for (const c of children) node.append(c);
  return node;
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
  .pbw-btn {
    background: var(--accent); color: #fff; border: none; border-radius: 9px;
    padding: 11px 20px; font-size: 15px; font-weight: 700; cursor: pointer;
    transition: transform .08s, filter .15s; font-family: inherit;
  }
  .pbw-btn:hover:not(:disabled) { filter: brightness(1.12); transform: translateY(-1px); }
  .pbw-btn:active:not(:disabled) { transform: translateY(0); }
  .pbw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pbw-btn.ghost { background: var(--panel-alt); border: 1px solid var(--border); }
  .pbw-btn.toggle-on { background: var(--accent); }
  .pbw-btn.toggle-off { background: var(--panel-alt); border: 1px solid var(--border); color: var(--text-dim); }
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
