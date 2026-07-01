/**
 * Flat-top axial [q,r] → world XZ conversion for the 3D board.
 *
 * The shared engine's hex.ts documents pointy-top math for its *geometry*
 * helpers (distance/line/reachability are orientation-independent), but the
 * design calls for a FLAT-TOP rendered board. We implement the flat-top layout
 * locally here; distances/reachability from the shared engine still apply since
 * axial coordinates are orientation-agnostic.
 *
 * Flat-top layout (Red Blob Games conventions):
 *   x = size * (3/2 * q)
 *   z = size * (sqrt(3) * (r + q/2))
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Circumradius of a hex tile in world units. */
export const HEX_SIZE = 1.0;
/** Small gap so tiles read as discrete cells. */
export const HEX_GAP = 0.06;

const SQRT3 = Math.sqrt(3);

export function axialToWorld(q: number, r: number, y = 0): Vector3 {
  const s = HEX_SIZE + HEX_GAP;
  const x = s * (1.5 * q);
  const z = s * (SQRT3 * (r + q / 2));
  return new Vector3(x, y, z);
}

/** XZ world point → nearest axial tile [q,r] (flat-top inverse + cube round). */
export function worldToAxial(x: number, z: number): [number, number] {
  const s = HEX_SIZE + HEX_GAP;
  const q = ((2 / 3) * x) / s;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * z) / s;
  return cubeRoundAxial(q, r);
}

function cubeRoundAxial(qf: number, rf: number): [number, number] {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}
