// The 48-bit rotation Trinity stores animation keys in — browser port of
// tools/pokekit/trinity-quat.mjs (see that file for how the scheme was found).
//
// Smallest-three, with each stored component an ANGLE quantised over
// [-pi/4, +pi/4]; the fields start at bits 3, 18 and 33, and the low three bits
// say which component was dropped and whether the quaternion was negated.
//
// The Node version builds the 48-bit word with BigInt. This one keeps it a
// plain Number — 48 bits is well inside the 53 a double holds exactly — because
// it runs once per key for every clip at load, and BigInt is slow at that.

const K = (Math.PI / 2) / 0x7fff;
const ADD = Math.PI / 4;
const P3 = 8, P18 = 262144, P33 = 8589934592, P16 = 65536, P32 = 4294967296;

/** Unpack one PackedQuaternion (three u16) into out[o..o+3] as x, y, z, w. */
export function unpackQuatInto(X, Y, Z, out, o) {
  const pack = X + Y * P16 + Z * P32;
  const a = (Math.floor(pack / P3) % 32768) * K - ADD;
  const b = (Math.floor(pack / P18) % 32768) * K - ADD;
  const c = (Math.floor(pack / P33) % 32768) * K - ADD;
  const big = Math.sqrt(Math.max(0, 1 - (a * a + b * b + c * c)));
  const s = (X & 4) ? -1 : 1;
  // The dropped component was the largest, so it is positive and recoverable.
  switch (X & 3) {
    case 0: out[o] = s * big; out[o + 1] = s * a; out[o + 2] = s * b; out[o + 3] = s * c; break;
    case 1: out[o] = s * a; out[o + 1] = s * big; out[o + 2] = s * b; out[o + 3] = s * c; break;
    case 2: out[o] = s * a; out[o + 1] = s * b; out[o + 2] = s * big; out[o + 3] = s * c; break;
    default: out[o] = s * a; out[o + 1] = s * b; out[o + 2] = s * c; out[o + 3] = s * big; break;
  }
}

/** Trinity rest rotations are Euler XYZ radians; this is q = qz * qy * qx, as [x, y, z, w]. */
export function quatFromEuler(X, Y, Z) {
  const cx = Math.cos(X / 2), sx = Math.sin(X / 2);
  const cy = Math.cos(Y / 2), sy = Math.sin(Y / 2);
  const cz = Math.cos(Z / 2), sz = Math.sin(Z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
