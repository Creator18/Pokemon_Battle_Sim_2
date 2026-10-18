// BNTX textures — browser port of tools/pokekit/bntx.mjs.
//
// Nintendo's texture container. The pixels are stored BLOCK LINEAR (the Tegra
// X1's tiling): 4x4 blocks grouped into 512-byte GOBs (64 bytes across, 8 rows
// down), GOBs stacked into columns 2^blockHeightLog2 tall. That has to be undone
// before anything can read the image. Only mip 0 is read.

export const FORMAT = {
  0x02: 'R5G6B5', 0x07: 'R8G8', 0x09: 'R16', 0x0b: 'R8G8B8A8', 0x0c: 'B8G8R8A8',
  0x1a: 'BC1', 0x1b: 'BC2', 0x1c: 'BC3', 0x1d: 'BC4', 0x1e: 'BC5', 0x1f: 'BC6H', 0x20: 'BC7',
  0x2d: 'ASTC_4x4', 0x2e: 'ASTC_5x4', 0x2f: 'ASTC_5x5', 0x30: 'ASTC_6x5', 0x31: 'ASTC_6x6',
};
const CHAN = { 1: 'UNorm', 2: 'SNorm', 3: 'UInt', 4: 'SInt', 5: 'Float', 6: 'SRGB' };
const BLOCK_BYTES = { BC1: 8, BC2: 16, BC3: 16, BC4: 8, BC5: 16, BC6H: 16, BC7: 16 };

const divUp = (a, b) => Math.floor((a + b - 1) / b);

function blockLinearAddr(x, y, widthInBlocks, bpp, blockHeight) {
  const gobsAcross = divUp(widthInBlocks * bpp, 64);
  const gob = Math.floor(y / (8 * blockHeight)) * 512 * blockHeight * gobsAcross
            + Math.floor((x * bpp) / 64) * 512 * blockHeight
            + Math.floor((y % (8 * blockHeight)) / 8) * 512;
  const xb = x * bpp;
  return gob
    + Math.floor((xb % 64) / 32) * 256
    + Math.floor((y % 8) / 2) * 64
    + Math.floor((xb % 32) / 16) * 32
    + (y % 2) * 16
    + (xb % 16);
}

export function deswizzle(src, widthInBlocks, heightInBlocks, bpp, blockHeightLog2) {
  const blockHeight = 1 << blockHeightLog2;
  const out = new Uint8Array(widthInBlocks * heightInBlocks * bpp);
  for (let y = 0; y < heightInBlocks; y++) {
    for (let x = 0; x < widthInBlocks; x++) {
      const from = blockLinearAddr(x, y, widthInBlocks, bpp, blockHeight);
      if (from + bpp > src.length) continue;
      out.set(src.subarray(from, from + bpp), (y * widthInBlocks + x) * bpp);
    }
  }
  return out;
}

/** Parse a BNTX and return mip 0 untiled: { format, channel, srgb, width, height, bytesPerBlock, data }. */
export function readBntx(bytes) {
  const b = bytes;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'BNTX') throw new Error('not a BNTX');
  let at = -1;
  for (let i = 0; i < Math.min(b.length - 4, 65536); i++) {
    if (b[i] === 0x42 && b[i + 1] === 0x52 && b[i + 2] === 0x54 && b[i + 3] === 0x49) { at = i; break; }
  }
  if (at < 0) throw new Error('no BRTI block');
  const word = dv.getUint32(at + 0x1c, true);
  const fmtId = word >>> 8, chanId = word & 0xff;
  const format = FORMAT[fmtId] || `UNKNOWN(0x${fmtId.toString(16)})`;
  const tex = {
    format,
    channel: CHAN[chanId] || String(chanId),
    srgb: chanId === 6,
    width: dv.getUint32(at + 0x24, true),
    height: dv.getUint32(at + 0x28, true),
    blockHeightLog2: dv.getUint32(at + 0x34, true) & 7,
  };
  const ptrs = Number(dv.getBigUint64(at + 0x70, true));
  const dataOffset = Number(dv.getBigUint64(ptrs, true));
  const bpb = BLOCK_BYTES[format];
  if (!bpb) { tex.data = null; return tex; }
  tex.bytesPerBlock = bpb;
  const wb = divUp(tex.width, 4), hb = divUp(tex.height, 4);
  // The stored surface is padded to whole GOB columns, so take everything from
  // the offset and let deswizzle index into it.
  tex.data = deswizzle(b.subarray(dataOffset), wb, hb, bpb, tex.blockHeightLog2);
  return tex;
}
