/**
 * The game's on-screen UI kit, one look for all of it: text boxes, the controls, prompts, the move bar.
 *
 * Drawn from the usual guidance:
 * - Placement: everything inside a ~4% safe margin; the moves bottom-centre (the convention for an action game's
 *   abilities), the controls a compact column bottom-right, the party top-left (TeamHud). The middle of the screen is
 *   kept clear for the play and its callouts.
 * - Text boxes: in the lower third, narrow (two lines, a fifth of the screen at most), so the world stays in view; the
 *   speaker on a nameplate tab above the box; the text typed out, then held long enough to read (by its length); a
 *   plain dark panel behind it with a light rim, high contrast whatever the scene is behind it.
 * - Type: a rounded, open sans for reading (Nunito); a condensed display face for names, numbers and callouts (Teko);
 *   sizes scaled to the screen's height, the body ≈ 24 px at 1080p (Xbox's guidelines: 26 px of body height there).
 * - Controls: shown as key caps; the list dims after a few seconds unchanged (it's there when looked for, not
 *   shouting); prompts for what can be done right now (catch, choose) shown where they apply.
 *
 * Sources: Xbox Accessibility Guideline 101 (text display) and 102 (contrast); Game Accessibility Guidelines; game
 * UI / HUD design guides (placement conventions, contextual prompts, dialogue boxes).
 */

const FONTS = 'https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Rajdhani:wght@500;600;700&family=Teko:wght@500;600;700&display=swap';

const CSS = `
:root { --gui-ink: #f8fafc; --gui-dim: rgba(226,232,240,.78); --gui-panel: rgba(12,17,32,.92); --gui-panel2: rgba(20,28,50,.92);
  --gui-rim: rgba(255,255,255,.92); --gui-shade: rgba(4,7,16,.55); --gui-safe: max(14px, 2.2vh); --gui-bar-h: 0px;
  --gui-body: clamp(15px, 2.25vh, 26px); --gui-small: clamp(12px, 1.55vh, 17px); }
.gui { font-family: Nunito, system-ui, sans-serif; color: var(--gui-ink); -webkit-font-smoothing: antialiased; }
.gui * { box-sizing: border-box; }

/* ── key caps ── */
.gui-cap { display: inline-flex; align-items: center; justify-content: center; min-width: 1.75em; height: 1.75em; padding: 0 .45em;
  border-radius: .32em; background: linear-gradient(180deg, #ffffff, #e2e8f0); color: #0f172a; font: 900 1em/1 Nunito, sans-serif;
  border: 1px solid #cbd5e1; border-bottom: .2em solid #94a3b8; box-shadow: 0 .12em .3em rgba(0,0,0,.35); letter-spacing: 0; white-space: nowrap; }
.gui-cap.wide { min-width: 3.4em; }

/* ── the text box ── */
.gui-say { position: fixed; left: 50%; bottom: calc(var(--gui-safe) + var(--gui-bar-h)); z-index: 30; pointer-events: none;
  width: min(780px, calc(100vw - 2 * var(--gui-safe))); transform: translateX(-50%); transition: bottom .25s ease; display: none; }
.gui-say.on { display: block; animation: gui-say-in .2s cubic-bezier(.2,1.3,.4,1); }
.gui-say.out { animation: gui-say-out .18s ease-in forwards; }
@keyframes gui-say-in { from { opacity: 0; transform: translate(-50%, 14px) scale(.98); } to { opacity: 1; transform: translateX(-50%); } }
@keyframes gui-say-out { to { opacity: 0; transform: translate(-50%, 8px); } }
.gui-say-panel { position: relative; padding: calc(var(--gui-body) * .8) calc(var(--gui-body) * 1.1) calc(var(--gui-body) * .9);
  min-height: calc(var(--gui-body) * 1.45 * 2 + var(--gui-body) * 1.7);
  background: linear-gradient(180deg, var(--gui-panel2), var(--gui-panel)); border: 2px solid var(--gui-rim); border-radius: 16px;
  box-shadow: 0 0 0 4px var(--gui-shade), 0 14px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 1px rgba(255,255,255,.05);
  font: 700 var(--gui-body)/1.45 Nunito, sans-serif; letter-spacing: .1px; text-shadow: 0 1px 1px rgba(0,0,0,.4); }
.gui-say-text .rest { visibility: hidden; }
.gui-say-name { position: absolute; left: 18px; top: 0; transform: translateY(-64%); padding: .28em .75em .16em; border-radius: 9px;
  background: var(--who, #e11d48); border: 2px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,.4);
  font: 600 calc(var(--gui-body) * 1.02)/1 Teko, sans-serif; letter-spacing: 1.6px; text-transform: uppercase; color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.35); }
.gui-say-name:empty { display: none; }
.gui-say-time { position: absolute; left: 18px; right: 18px; bottom: 7px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.28); transform-origin: left; }

/* ── a prompt (what you can do now) ── */
.gui-prompt { position: fixed; left: 50%; bottom: calc(var(--gui-safe) + var(--gui-bar-h) + 6px); transform: translateX(-50%); z-index: 28; pointer-events: none;
  display: none; align-items: center; gap: .6em; padding: .5em .95em .55em .6em; border-radius: 999px; font: 800 var(--gui-small)/1 Nunito, sans-serif;
  font-size: calc(var(--gui-small) * 1.12); background: var(--gui-panel); border: 2px solid var(--gui-rim); box-shadow: 0 0 0 3px var(--gui-shade), 0 8px 20px rgba(0,0,0,.4); }
.gui-prompt.on { display: inline-flex; animation: gui-pop .22s cubic-bezier(.2,1.5,.4,1); }
.gui-prompt .gui-meter { position: absolute; left: 16px; right: 16px; bottom: -1px; height: 3px; border-radius: 2px; transform-origin: left;
  background: linear-gradient(90deg, #ef4444, #fde68a); }
@keyframes gui-pop { from { opacity: 0; transform: translate(-50%, 8px) scale(.92); } to { opacity: 1; transform: translateX(-50%); } }

/* ── the controls ── */
.gui-legend { position: fixed; right: var(--gui-safe); bottom: var(--gui-safe); z-index: 26; pointer-events: none; display: flex; flex-direction: column;
  align-items: flex-end; gap: .45em; padding: .65em .75em; border-radius: 12px; background: rgba(8,12,24,.5); border: 1px solid rgba(255,255,255,.14);
  font: 800 var(--gui-small)/1 Nunito, sans-serif; color: var(--gui-ink); text-shadow: 0 1px 2px rgba(0,0,0,.6); transition: opacity .6s ease; }
.gui-legend.idle { opacity: .42; }
.gui-legend .row { display: flex; align-items: center; gap: .55em; white-space: nowrap; }
.gui-legend .row .keys { display: inline-flex; gap: .25em; }
.gui-legend .row .what { color: var(--gui-dim); font-weight: 700; }

/* ── the move bar ── */
.gui-moves { position: fixed; left: 50%; bottom: var(--gui-safe); transform: translateX(-50%); z-index: 27; pointer-events: none;
  display: flex; align-items: flex-end; gap: clamp(6px, 1vh, 12px); padding: 8px 10px 16px; border-radius: 18px;
  background: linear-gradient(180deg, rgba(8,12,24,0), rgba(8,12,24,.38)); transition: opacity .25s, transform .25s; --s: clamp(58px, 8.2vh, 88px); }
.gui-moves.off { opacity: 0; transform: translate(-50%, 16px); }
.gui-slot { position: relative; width: calc(var(--s) * 1.32); height: var(--s); border-radius: 14px; overflow: visible;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 34%, #101828) 0%, #0d1424 58%);
  border: 2px solid rgba(255,255,255,.7); box-shadow: 0 0 0 3px var(--gui-shade), 0 8px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.2);
  transition: transform .14s, border-color .14s, box-shadow .14s; }
.gui-slot.small { --s2: calc(var(--s) * .78); width: var(--s2); height: var(--s2); }
.gui-slot.long .name { font-size: calc(var(--s) * .128); letter-spacing: 0; }
.gui-slot.xlong .name { font-size: calc(var(--s) * .112); letter-spacing: -.01em; }
.gui-slot.none { opacity: .38; }
.gui-slot .band { position: absolute; left: 0; right: 0; top: 0; height: 24%; border-radius: 12px 12px 0 0; background: var(--c);
  display: flex; align-items: center; justify-content: center; font: 900 calc(var(--s) * .12)/1 Nunito, sans-serif; letter-spacing: .08em; text-transform: uppercase;
  color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.45); box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); overflow: hidden; }
.gui-slot .name { position: absolute; left: 4px; right: 4px; top: 30%; bottom: 24%; display: flex; align-items: center; justify-content: center; text-align: center;
  font: 800 calc(var(--s) * .15)/1.05 Nunito, sans-serif; letter-spacing: .01em; text-shadow: 0 1px 2px #000; overflow: hidden; }
.gui-slot.small .name { font-size: calc(var(--s) * .13); top: 14%; }
.gui-slot .key { position: absolute; left: 50%; bottom: 0; transform: translate(-50%, 48%); font-size: calc(var(--s) * .17); z-index: 2; }
.gui-slot .sweep { position: absolute; inset: 0; border-radius: 12px; background: conic-gradient(rgba(3,5,14,.8) var(--p, 0deg), transparent 0); }
.gui-slot .secs { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 600 calc(var(--s) * .4)/1 Teko, sans-serif;
  font-variant-numeric: tabular-nums; text-shadow: 0 2px 4px #000; }
.gui-slot .heat { position: absolute; left: 12%; right: 12%; top: 27%; display: flex; gap: 3px; }
.gui-slot .heat i { flex: 1; height: 3px; border-radius: 2px; background: transparent; }
.gui-slot .heat i.on { background: #fbbf24; } .gui-slot .heat i.on.hot { background: #f97316; } .gui-slot .heat i.on.max { background: #ef4444; }
.gui-slot.cool { border-color: rgba(255,255,255,.25); }
.gui-slot.using { border-color: #fff; transform: translateY(-5px); box-shadow: 0 0 0 3px var(--gui-shade), 0 0 18px color-mix(in srgb, var(--c) 80%, #fff), inset 0 1px 0 rgba(255,255,255,.2); }
.gui-slot.ready { animation: gui-ready .45s ease-out; }
.gui-slot.buff { border-color: #f9a8d4; box-shadow: 0 0 0 3px #ec4899, 0 0 22px #ec4899; }
.gui-slot.buff .secs { color: #fbcfe8; }
.gui-slot.braced { border-color: #93c5fd; box-shadow: 0 0 0 3px #60a5fa, 0 0 22px #3b82f6; }
.gui-slot.blocked { filter: saturate(.35) brightness(.8); }
@keyframes gui-ready { 40% { box-shadow: 0 0 0 4px rgba(255,255,255,.9), 0 0 24px #fff; } }

/* ── a card (the starter's stats) ── */
.gui-card { background: linear-gradient(180deg, var(--gui-panel2), var(--gui-panel)); border: 2px solid var(--gui-rim); border-radius: 16px;
  box-shadow: 0 0 0 4px var(--gui-shade), 0 14px 34px rgba(0,0,0,.45); font: 700 var(--gui-small)/1.35 Nunito, sans-serif; color: var(--gui-ink); }
.gui-title { font: 600 calc(var(--gui-body) * 1.35)/1 Teko, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; }
.gui-chip { display: inline-block; padding: .3em .8em .25em; border-radius: 999px; background: var(--c); color: #fff; font: 900 .8em/1 Nunito, sans-serif;
  letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 1px 1px rgba(0,0,0,.35); box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); }
`;

/** The fonts and the stylesheet, put in once. */
export function ensureGameUi(): void {
  if (document.querySelector('[data-gui-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = FONTS; link.dataset.guiFont = '';
  const style = document.createElement('style');
  style.dataset.guiStyle = ''; style.textContent = CSS;
  document.head.append(link, style);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A key cap's HTML. */
export const cap = (k: string) => `<i class="gui-cap${k.length > 2 ? ' wide' : ''}">${esc(k)}</i>`;

/** How long a line wants on screen to be read (s): typed out, then a reading pace (~15 characters a second), at least `min`. */
export const readTime = (text: string, min = 0) => Math.max(min, 1.1 + text.length / 15);

/** Who's speaking: the colour of their nameplate. */
const SPEAKER_COLORS: Record<string, string> = { 'PROF. OAK': '#c0392b', 'SIGN': '#8a5a2b', 'MOM': '#db2777' };

/**
 * The text box, lower third: a nameplate (who) above it, the text typed out, a thin bar running down the time left.
 * Lines replace one another; each stays up long enough to read.
 */
export class DialogueBox {
  readonly el: HTMLDivElement;
  private name: HTMLDivElement; private text: HTMLDivElement; private time: HTMLDivElement;
  private full = ''; private shown = 0; private start = 0; private until = 0; private secs = 1; private raf = 0;
  static CPS = 55;

  constructor() {
    ensureGameUi();
    this.el = document.createElement('div');
    this.el.className = 'gui gui-say';
    this.el.innerHTML = '<div class="gui-say-panel"><div class="gui-say-name"></div><div class="gui-say-text"></div><div class="gui-say-time"></div></div>';
    this.name = this.el.querySelector('.gui-say-name')!; this.text = this.el.querySelector('.gui-say-text')!; this.time = this.el.querySelector('.gui-say-time')!;
    document.body.append(this.el);
  }

  /** Say `text` (as `who`, if anyone), for at least `secs` — longer if it needs it to be read. */
  show(who: string | null, text: string, secs = 0): void {
    const w = who ? who.toUpperCase() : '';
    this.name.textContent = w;
    this.el.style.setProperty('--who', SPEAKER_COLORS[w] ?? '#2563eb');
    this.full = text; this.shown = 0; this.start = performance.now();
    this.secs = readTime(text, secs) + text.length / DialogueBox.CPS * 0.5;
    this.until = this.start + this.secs * 1000;
    this.el.classList.remove('out'); this.el.classList.remove('on'); void this.el.offsetWidth; this.el.classList.add('on');
    this.render();
    cancelAnimationFrame(this.raf);
    const step = () => {
      const now = performance.now();
      const n = Math.min(this.full.length, Math.floor(((now - this.start) / 1000) * DialogueBox.CPS));
      if (n !== this.shown) { this.shown = n; this.render(); }
      this.time.style.transform = `scaleX(${Math.max(0, (this.until - now) / (this.secs * 1000))})`;
      if (now >= this.until) { this.hide(); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Whether a line is up. */
  get showing(): boolean { return performance.now() < this.until; }

  hide(): void {
    cancelAnimationFrame(this.raf);
    this.until = 0;
    if (!this.el.classList.contains('on')) return;
    this.el.classList.add('out');
    setTimeout(() => { if (this.until === 0) this.el.classList.remove('on', 'out'); }, 180);
  }

  private render(): void {
    // (The rest of the line laid out but unseen: the box its full size from the start, the words not jumping about.)
    this.text.innerHTML = `${esc(this.full.slice(0, this.shown))}<span class="rest">${esc(this.full.slice(this.shown))}</span>`;
  }

  dispose(): void { cancelAnimationFrame(this.raf); this.el.remove(); }
}

/**
 * The controls, bottom right: a column of key caps and what they do. Dims after a few seconds unchanged; bright again
 * when they change (or `wake()`).
 */
export class ControlsLegend {
  readonly el: HTMLDivElement;
  private timer = 0; private key = '';
  constructor(items: [string[], string][] = []) {
    ensureGameUi();
    this.el = document.createElement('div');
    this.el.className = 'gui gui-legend';
    this.el.dataset.pfHelp = '';
    document.body.append(this.el);
    this.set(items);
  }
  set(items: [string[], string][]): void {
    const key = JSON.stringify(items);
    if (key === this.key) return;
    this.key = key;
    this.el.innerHTML = items.map(([keys, what]) => `<div class="row"><span class="what">${esc(what)}</span><span class="keys">${keys.map(cap).join('')}</span></div>`).join('');
    this.wake();
  }
  wake(): void {
    this.el.classList.remove('idle');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.add('idle'), 6000);
  }
  dispose(): void { clearTimeout(this.timer); this.el.remove(); }
}

/** A prompt for what can be done right now (`keys`, then what), above the move bar; an optional meter running down. */
export class Prompt {
  readonly el: HTMLDivElement;
  private label: HTMLSpanElement; private meter: HTMLDivElement; private shownKey = '';
  constructor() {
    ensureGameUi();
    this.el = document.createElement('div');
    this.el.className = 'gui gui-prompt';
    this.label = document.createElement('span');
    this.meter = document.createElement('div'); this.meter.className = 'gui-meter';
    this.el.append(this.label, this.meter);
    document.body.append(this.el);
  }
  /** Show `keys` + `what` (null: hidden); `left` 0..1 the meter (undefined: none). */
  set(keys: string[] | null, what = '', left?: number): void {
    if (!keys) { if (this.shownKey) { this.shownKey = ''; this.el.classList.remove('on'); } return; }
    const k = keys.join('+') + what;
    if (k !== this.shownKey) {
      this.shownKey = k;
      this.label.innerHTML = `${keys.map(cap).join(' ')} <span>${esc(what)}</span>`;
      this.el.classList.remove('on'); void this.el.offsetWidth; this.el.classList.add('on');
    }
    this.meter.style.display = left === undefined ? 'none' : 'block';
    if (left !== undefined) this.meter.style.transform = `scaleX(${Math.max(0, Math.min(1, left))})`;
  }
  dispose(): void { this.el.remove(); }
}
