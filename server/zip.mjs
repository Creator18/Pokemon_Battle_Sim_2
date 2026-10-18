// Read entries out of a zip without unpacking it.
//
// The Trinity archives are 1.4 GB across four files and hold about 590 models
// between them. Extracting all of that to bake it would cost more disk than the
// result and take longer than the bake; and shelling out to the OS once per
// model means six hundred process launches. A zip's central directory is a
// list, and the payload is raw deflate, which zlib already does.
//
// Only what is needed: stored and deflated entries, no encryption, no spanning.
// Zip64 is handled because these archives are past four gigabytes uncompressed.

import fs from 'fs';
import zlib from 'zlib';

const EOCD = 0x06054b50;        // end of central directory
const EOCD64 = 0x06064b50;
const LOC64 = 0x07064b50;       // zip64 end-of-central-directory locator
const CEN = 0x02014b50;         // central directory file header
const LOC = 0x04034b50;         // local file header

export function openZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;

  const read = (pos, len) => {
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, pos);
    return b;
  };

  // The end-of-central-directory record is last, after a comment of unknown
  // length, so it is found by scanning backwards for its signature.
  const tailLen = Math.min(size, 66000);
  const tail = read(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: ' + file);

  let count = tail.readUInt16LE(eocd + 10);
  let cenSize = tail.readUInt32LE(eocd + 12);
  let cenOff = tail.readUInt32LE(eocd + 16);

  // Past 4 GB or 65535 entries the real values live in the zip64 record and the
  // classic fields are saturated.
  if (cenOff === 0xffffffff || count === 0xffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === LOC64) { loc = i; break; }
    if (loc < 0) throw new Error('zip64 needed but no locator in ' + file);
    const z64at = Number(tail.readBigUInt64LE(loc + 8));
    const z = read(z64at, 56);
    if (z.readUInt32LE(0) !== EOCD64) throw new Error('bad zip64 record in ' + file);
    count = Number(z.readBigUInt64LE(32));
    cenSize = Number(z.readBigUInt64LE(40));
    cenOff = Number(z.readBigUInt64LE(48));
  }

  const cen = read(cenOff, cenSize);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cen.length; i++) {
    if (cen.readUInt32LE(p) !== CEN) break;
    const method = cen.readUInt16LE(p + 10);
    let csize = cen.readUInt32LE(p + 20);
    let usize = cen.readUInt32LE(p + 24);
    const nlen = cen.readUInt16LE(p + 28);
    const elen = cen.readUInt16LE(p + 30);
    const clen = cen.readUInt16LE(p + 32);
    let local = cen.readUInt32LE(p + 42);
    const name = cen.toString('utf8', p + 46, p + 46 + nlen);
    // Saturated fields are stored in the zip64 extra field, in the order
    // uncompressed, compressed, local offset — but only the ones that overflowed.
    if (usize === 0xffffffff || csize === 0xffffffff || local === 0xffffffff) {
      let e = p + 46 + nlen;
      const end = e + elen;
      while (e + 4 <= end) {
        const id = cen.readUInt16LE(e), sz = cen.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(cen.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cen.readBigUInt64LE(q)); q += 8; }
          if (local === 0xffffffff) { local = Number(cen.readBigUInt64LE(q)); q += 8; }
          break;
        }
        e += 4 + sz;
      }
    }
    if (!name.endsWith('/')) entries.set(name, { name, method, csize, usize, local });
    p += 46 + nlen + elen + clen;
  }

  // The local header repeats the name and extra field at its own lengths, which
  // need not match the central directory's, so the payload offset is only
  // knowable from the local header itself.
  function readEntry(e) {
    const h = read(e.local, 30);
    if (h.readUInt32LE(0) !== LOC) throw new Error('bad local header for ' + e.name);
    const at = e.local + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const raw = read(at, e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`${e.name}: compression method ${e.method} not supported`);
  }

  return {
    names: () => [...entries.keys()],
    has: (n) => entries.has(n),
    get: (n) => { const e = entries.get(n); return e ? readEntry(e) : null; },
    find: (re) => [...entries.keys()].filter((n) => re.test(n)),
    close: () => fs.closeSync(fd),
    size: entries.size,
  };
}
