/**
 * A ring gauge (after a React gauge component, done here in plain SVG): its value an arc from the top, clockwise —
 * round-capped, a gradient along it (faint at its start, full at its tip), glowing in its own colour — and what's left
 * of the ring a second, paler arc, the two kept a gap apart at both ends; tick marks round its inside; its value (and a
 * label) in its middle, if shown. Its arc eases to each new value on a spring, or follows it at once.
 */
const NS = 'http://www.w3.org/2000/svg';
const BOX = 100;
let uid = 0;

export interface RingGaugeOptions {
  /** Its size (CSS px). */
  size: number;
  /** Its ring's width (in a 100-unit box). */
  stroke?: number;
  /** The gap between its value and what's left (percent of the ring, each end). */
  gap?: number;
  /** Tick marks round its inside; a glow; a gradient along its value. */
  ticks?: boolean; glow?: boolean; gradient?: boolean;
  /** Its value (and label) written in its middle. */
  showValue?: boolean;
  /** Its value's colour, by its percent (0–100); what's left's. */
  color?: (p: number) => string;
  rest?: (p: number, color: string) => string;
  /** Eased on a spring (true), or at once. */
  spring?: boolean;
}

/** The gauge's own colours: red low, amber, blue, green high. */
export const GAUGE_COLORS = (p: number) => (p <= 25 ? '#dc2626' : p <= 50 ? '#f59e0b' : p <= 75 ? '#3b82f6' : '#22c55e');
/** HP's: green, then amber below half, red below a quarter. */
export const HP_COLORS = (p: number) => (p > 50 ? '#22c55e' : p > 25 ? '#f59e0b' : '#dc2626');
const PALE: Record<string, string> = { '#dc2626': '#fecaca', '#f59e0b': '#fde68a', '#3b82f6': '#bfdbfe', '#22c55e': '#bbf7d0' };

export class RingGauge {
  readonly el: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly main: SVGCircleElement;
  private readonly rest: SVGCircleElement;
  private readonly stops: SVGStopElement[] = [];
  private readonly text: SVGTextElement | null = null;
  private readonly label: SVGTextElement | null = null;
  private readonly C: number;
  private readonly gradId: string;
  private target = 0; private shown = 0; private vel = 0;
  private lastColor = '';

  constructor(private readonly o: RingGaugeOptions) {
    const stroke = o.stroke ?? 10, r = BOX / 2 - stroke / 2;
    this.C = 2 * Math.PI * r;
    this.gradId = `ringGrad${++uid}`;
    this.el = document.createElement('div');
    this.el.style.cssText = `position:relative;width:${o.size}px;height:${o.size}px`;
    const svg = this.svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${BOX} ${BOX}`); svg.setAttribute('width', String(o.size)); svg.setAttribute('height', String(o.size));
    svg.setAttribute('fill', 'none');
    svg.style.cssText = 'position:absolute;inset:0;overflow:visible;user-select:none';
    if (o.gradient) {
      const defs = document.createElementNS(NS, 'defs'), g = document.createElementNS(NS, 'linearGradient');
      g.id = this.gradId; g.setAttribute('x1', '0%'); g.setAttribute('y1', '0%'); g.setAttribute('x2', '100%'); g.setAttribute('y2', '0%');
      for (const [off, op] of [['0%', '0.3'], ['100%', '1']]) {
        const s = document.createElementNS(NS, 'stop'); s.setAttribute('offset', off); s.setAttribute('stop-opacity', op);
        g.append(s); this.stops.push(s);
      }
      defs.append(g); svg.append(defs);
    }
    if (o.ticks) {
      // (Eight ticks round its inside, its top and bottom among them.)
      const tr = r - stroke / 2, len = 6;
      for (let i = 0; i <= 8; i++) {
        const a = ((i / 8) * 360 - 90) * (Math.PI / 180);
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', String(BOX / 2 + (tr - len) * Math.cos(a))); l.setAttribute('y1', String(BOX / 2 + (tr - len) * Math.sin(a)));
        l.setAttribute('x2', String(BOX / 2 + tr * Math.cos(a))); l.setAttribute('y2', String(BOX / 2 + tr * Math.sin(a)));
        l.setAttribute('stroke', 'currentColor'); l.setAttribute('stroke-width', '1'); l.setAttribute('opacity', '0.3');
        svg.append(l);
      }
    }
    const circle = () => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(BOX / 2)); c.setAttribute('cy', String(BOX / 2)); c.setAttribute('r', String(r));
      c.style.cssText = `stroke-linecap:round;stroke-linejoin:round;stroke-dashoffset:0;stroke-width:${stroke};transform-origin:50% 50%;shape-rendering:geometricPrecision`;
      svg.append(c);
      return c;
    };
    this.rest = circle(); this.main = circle();
    if (o.showValue) {
      const t = (y: number, size: number, weight: string) => {
        const e = document.createElementNS(NS, 'text');
        e.setAttribute('x', String(BOX / 2)); e.setAttribute('y', String(y)); e.setAttribute('text-anchor', 'middle');
        e.setAttribute('dominant-baseline', 'middle'); e.setAttribute('fill', 'currentColor');
        e.setAttribute('font-size', String(size)); e.setAttribute('font-weight', weight);
        svg.append(e); return e;
      };
      this.text = t(BOX / 2, 30, '700'); this.label = t(BOX / 2 + 20, 8, '500');
    }
    this.el.append(svg);
    this.draw();
  }

  /** Its value (percent, 0–100); what's written in its middle, and under it. */
  set(p: number, text?: string, label?: string): void {
    this.target = Math.max(0, Math.min(100, p));
    if (!this.o.spring) this.shown = this.target;
    if (this.text && text !== undefined) this.text.textContent = text;
    if (this.label && label !== undefined) this.label.textContent = label;
    if (!this.o.spring) this.draw();
  }

  /** Each frame (a spring gauge): its arc easing to its value. */
  update(dt: number): void {
    if (!this.o.spring) return;
    // (A spring, well damped: quick to it, no overshoot to speak of.)
    const k = 120, c = 2 * Math.sqrt(k) * 1.05;
    this.vel += (k * (this.target - this.shown) - c * this.vel) * Math.min(dt, 0.05);
    this.shown += this.vel * Math.min(dt, 0.05);
    if (Math.abs(this.target - this.shown) < 0.02 && Math.abs(this.vel) < 0.02) { this.shown = this.target; this.vel = 0; }
    this.draw();
  }

  private draw(): void {
    const p = this.shown, gap = this.o.gap ?? 5, pc = this.C / 100;
    const color = (this.o.color ?? GAUGE_COLORS)(p);
    const rest = (this.o.rest ?? ((_, c) => PALE[c] ?? 'rgba(85,85,85,.2)'))(p, color);
    // Its value: from the top, clockwise.
    this.main.style.strokeDasharray = `${Math.max(p * pc, 0)} ${this.C}`;
    this.main.style.transform = 'rotate(-90deg)';
    this.main.style.opacity = p < 0.5 ? '0' : '1';
    this.main.style.stroke = this.o.gradient ? `url(#${this.gradId})` : color;
    // What's left: from the top, the other way round, stopping a gap short of the value's tip (and starting a gap after
    // the top) — gone when there's no room for it.
    this.rest.style.strokeDasharray = `${Math.max((100 - p) * pc - gap * 2 * pc, 0)} ${this.C}`;
    this.rest.style.transform = `rotate(${360 - 90 - gap * 3.6}deg) scaleY(-1)`;
    this.rest.style.opacity = p > 100 - gap * 2 ? '0' : '1';
    this.rest.style.stroke = rest;
    if (color !== this.lastColor) {
      this.lastColor = color;
      for (const s of this.stops) s.setAttribute('stop-color', color);
      if (this.o.glow) this.svg.style.filter = `drop-shadow(0 0 2px ${color}80) drop-shadow(0 0 6px ${color}60) drop-shadow(0 0 12px ${color}40)`;
    }
  }
}
