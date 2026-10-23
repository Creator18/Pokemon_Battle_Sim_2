/**
 * A tornado stripe, taken whole off the tornado: the coat's own stripe field
 * (WindFx's shell — its voronoi, wound round the sphere by its twist, cut at
 * its cel threshold) sampled over the sphere's surface at a random moment,
 * its separate stripes found, and one long one picked at random. Its outline
 * is traced along its length: for each slice across it, where its top edge
 * and its bottom edge are. (Taking each slice's outermost edges fills any gap
 * inside it, so the shape is always one piece along its length — never broken,
 * never two.) Used as a slash's shape (SlashFx).
 */

/** The coat's stripes, as WindFx draws them: their twist, their density, the cel threshold a stripe starts at, the sphere's radius. */
const TWIST = 2.5, DENSITY = 1, CUT = 0.45, SPHERE_R = 1.7;
/** Its height range on the sphere (its frame: −1 foot … TOP head). */
const Y0 = -1, Y1 = 2.4;
/** The sampling grid round the sphere and up it. */
const GW = 160, GH = 64;
/** A stripe worth taking: at least this many cells, at least this long for its width. */
const MIN_CELLS = 60, MIN_LONG = 2.6;
/** Its outline: this many slices along it. */
export const STRIPE_SLICES = 48;
/**
 * Never pinched shut along its length: every slice at least NECK × its widest
 * (widened about its own middle where narrower), but for its tips — the first
 * and last TIP of its length, where it narrows to its points.
 */
const NECK = 0.3, TIP = 0.12;
/** Stripes found ahead of time (in idle moments), so a slash never waits on one. */
const POOL = 12;

export interface Stripe {
  /** Its top and bottom edge in each slice (−1 … 1 across it, its widest the full span). */
  top: Float32Array;
  bottom: Float32Array;
}

// ── the tornado's own noise (WindFx: hash2 periodic in 4, voronoi) ──
const fract = (x: number) => x - Math.floor(x);
function hash2(px: number, py: number): [number, number] {
  px = ((px % 4) + 4) % 4; py = ((py % 4) + 4) % 4;
  return [fract(Math.sin(px * 127.1 + py * 311.7) * 43758.5453), fract(Math.sin(px * 269.5 + py * 183.3) * 43758.5453)];
}
/** The tornado's voronoi (WindFx's shader's, exactly): its nearest-point distance², periodic in 4. */
export function voronoi(x: number, y: number, t: number): number {
  const nx = Math.floor(x), ny = Math.floor(y), fx = x - nx, fy = y - ny;
  let md = 5;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const [hx, hy] = hash2(nx + i, ny + j);
    const ox = 0.5 + 0.5 * Math.sin(t + 6.2831 * hx), oy = 0.5 + 0.5 * Math.sin(t + 6.2831 * hy);
    const rx = i + ox - fx, ry = j + oy - fy;
    md = Math.min(md, rx * rx + ry * ry);
  }
  return md;
}

const pool: Stripe[] = [];
let filling = false;
const idle = (fn: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn); else setTimeout(fn, 30);
};
/** Keep the pool full: one stripe per idle moment. */
function refill(): void {
  if (filling || pool.length >= POOL) return;
  filling = true;
  idle(() => { pool.push(findStripe()); filling = false; refill(); });
}
refill();

/** One long stripe off the tornado, at random: from the pool (found ahead of time), else found now. */
export function randomStripe(): Stripe {
  const s = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : findStripe();
  refill();
  return s;
}

/** Find one: a few tries at random moments; a plain taper if none is found. */
function findStripe(): Stripe {
  for (let tries = 0; tries < 8; tries++) {
    const s = tryStripe(Math.random() * 100, Math.random() * Math.PI * 2);
    if (s) return s;
  }
  const top = new Float32Array(STRIPE_SLICES), bottom = new Float32Array(STRIPE_SLICES);
  for (let i = 0; i < STRIPE_SLICES; i++) { const k = i / (STRIPE_SLICES - 1); top[i] = Math.sqrt(4 * k * (1 - k)); bottom[i] = -top[i]; }
  return { top, bottom };
}

function tryStripe(t: number, turn: number): Stripe | null {
  // The field over the sphere's surface: round it (its angle) and up it, as
  // the shell lays it — wound by the twist — and cut where a stripe starts.
  const k = (4 * DENSITY) / 6.2831;
  const on = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const y = Y0 + ((gy + 0.5) / GH) * (Y1 - Y0);
    for (let gx = 0; gx < GW; gx++) {
      const ang = ((gx + 0.5) / GW) * Math.PI * 2 + turn;
      const f = voronoi((ang - y * TWIST - t * 1.8) * k, (y - t * 2) * k, t * 0.1);
      on[gy * GW + gx] = Math.pow(f, 0.75) >= CUT ? 1 : 0;
    }
  }
  // Its separate stripes (joined side to side and up and down; round it, it wraps).
  const label = new Int32Array(GW * GH).fill(-1);
  const comps: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || label[i] >= 0) continue;
    const id = comps.length, cells: number[] = [];
    label[i] = id; stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % GW, cy = (c / GW) | 0;
      const near = [cy * GW + ((cx + 1) % GW), cy * GW + ((cx + GW - 1) % GW), cy > 0 ? c - GW : -1, cy < GH - 1 ? c + GW : -1];
      for (const n of near) if (n >= 0 && on[n] && label[n] < 0) { label[n] = id; stack.push(n); }
    }
    comps.push(cells);
  }
  // Its cells laid out on the surface (arc length round it, height up it),
  // unwrapped round the seam; its long axis and how long it is for its width.
  const dx = (SPHERE_R * Math.PI * 2) / GW, dy = (Y1 - Y0) / GH;
  type Cand = { pts: [number, number][]; ax: [number, number]; long: number };
  const cands: Cand[] = [];
  for (const cells of comps) {
    if (cells.length < MIN_CELLS) continue;
    // (Touching the top or bottom of the field: cut off, not whole.)
    if (cells.some((c) => { const cy = (c / GW) | 0; return cy === 0 || cy === GH - 1; })) continue;
    const ref = cells[0] % GW;
    const pts = cells.map((c): [number, number] => {
      let cx = c % GW; const cy = (c / GW) | 0;
      if (cx - ref > GW / 2) cx -= GW; else if (ref - cx > GW / 2) cx += GW;
      return [cx * dx, cy * dy];
    });
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = Math.max(1e-9, tr - l1);
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const long = Math.sqrt(l1 / l2);
    if (long >= MIN_LONG) cands.push({ pts: pts.map(([x, y]) => [x - mx, y - my]), ax: [Math.cos(a), Math.sin(a)], long });
  }
  if (!cands.length) return null;
  const pick = cands[Math.floor(Math.random() * cands.length)];
  // Its outline along its length: in each slice along the long axis, its
  // outermost edges across it (gaps inside filled, so it stays one piece).
  const [ux, uy] = pick.ax, vx = -uy, vy = ux;
  let s0 = Infinity, s1 = -Infinity;
  const proj = pick.pts.map(([x, y]) => { const s = x * ux + y * uy; s0 = Math.min(s0, s); s1 = Math.max(s1, s); return [s, x * vx + y * vy]; });
  const top = new Float32Array(STRIPE_SLICES).fill(-Infinity), bottom = new Float32Array(STRIPE_SLICES).fill(Infinity);
  for (const [s, v] of proj) {
    const i = Math.min(STRIPE_SLICES - 1, Math.floor(((s - s0) / Math.max(1e-6, s1 - s0)) * STRIPE_SLICES));
    top[i] = Math.max(top[i], v); bottom[i] = Math.min(bottom[i], v);
  }
  // (An empty slice — the stripe slanting past the grid — takes its neighbours' between.)
  for (let i = 0; i < STRIPE_SLICES; i++) {
    if (Number.isFinite(top[i])) continue;
    let a = i - 1; while (a >= 0 && !Number.isFinite(top[a])) a--;
    let b = i + 1; while (b < STRIPE_SLICES && !Number.isFinite(top[b])) b++;
    const ta = a >= 0 ? top[a] : 0, ba = a >= 0 ? bottom[a] : 0, tb = b < STRIPE_SLICES ? top[b] : 0, bb = b < STRIPE_SLICES ? bottom[b] : 0;
    const w = a >= 0 && b < STRIPE_SLICES ? (i - a) / (b - a) : a >= 0 ? 0 : 1;
    top[i] = ta + (tb - ta) * w; bottom[i] = ba + (bb - ba) * w;
  }
  // Across it: centred on its own middle, its widest reaching ±1.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < STRIPE_SLICES; i++) { lo = Math.min(lo, bottom[i]); hi = Math.max(hi, top[i]); }
  const mid = (lo + hi) / 2, half = Math.max(1e-6, (hi - lo) / 2);
  for (let i = 0; i < STRIPE_SLICES; i++) { top[i] = (top[i] - mid) / half; bottom[i] = (bottom[i] - mid) / half; }
  // Never pinched shut along its length (but at its tips): each slice at least NECK wide, about its own middle.
  for (let i = 0; i < STRIPE_SLICES; i++) {
    const k = i / (STRIPE_SLICES - 1);
    const need = NECK * 2 * Math.min(1, Math.min(k, 1 - k) / TIP);
    const w = top[i] - bottom[i];
    if (w < need) { const m = (top[i] + bottom[i]) / 2; top[i] = m + need / 2; bottom[i] = m - need / 2; }
  }
  // Its ends pointed: the first and last slice closed (a stripe's ends are its tips).
  const m0 = (top[0] + bottom[0]) / 2, m1 = (top[STRIPE_SLICES - 1] + bottom[STRIPE_SLICES - 1]) / 2;
  top[0] = bottom[0] = m0; top[STRIPE_SLICES - 1] = bottom[STRIPE_SLICES - 1] = m1;
  return { top, bottom };
}
