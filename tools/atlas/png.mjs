// PNG-8 (indexed colour) encode and decode, with no dependency but node:zlib (README.md).
//
// The encoder writes exactly IHDR, PLTE, IDAT and IEND: colour type 3, bit depth 8, no interlace,
// filter 0 on every row, deflate level 9. Its bytes depend on the zlib build, which is why
// `--check` compares decoded pixels and palette, never file bytes. The decoder reads any
// non-interlaced 8-bit indexed PNG (all five row filters, several IDAT chunks, ancillary chunks
// skipped), so it also reads PNGs other tools wrote.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** '#rrggbb' to [r, g, b]. */
export function hexToRgb(hex) {
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`palette colour ${hex} is not lower-case #rrggbb`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** [r, g, b] to '#rrggbb'. */
export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encodes an index buffer as PNG-8.
 * @param {{ width: number, height: number, palette: string[], indices: Uint8Array }} img
 *   `palette` is '#rrggbb' strings (1 to 256); every index must point inside it.
 */
export function encodePng8({ width, height, palette, indices }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`bad size ${width} x ${height}`);
  }
  if (indices.length !== width * height) throw new Error('indices length is not width x height');
  if (palette.length < 1 || palette.length > 256) throw new Error('palette must hold 1 to 256 colours');
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= palette.length) throw new Error(`index ${indices[i]} is past the palette`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  // compression 0, filter method 0, interlace 0 (bytes 10 to 12 stay 0)
  const plte = Buffer.from(palette.flatMap(hexToRgb));
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter type 0 (None)
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decodes an 8-bit indexed PNG.
 * @param {Uint8Array} buf
 * @returns {{ width: number, height: number, palette: string[], indices: Uint8Array }}
 */
export function decodePng8(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let ihdr;
  let palette;
  const idat = [];
  let ended = false;
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > b.length) throw new Error(`chunk ${type} runs past the end of the file`);
    const data = b.subarray(off + 8, off + 8 + len);
    if (crc32(b.subarray(off + 4, off + 8 + len)) !== b.readUInt32BE(off + 8 + len)) {
      throw new Error(`chunk ${type} fails its CRC`);
    }
    off += 12 + len;
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') {
      if (len % 3) throw new Error('PLTE length is not a multiple of 3');
      palette = [];
      for (let i = 0; i < len; i += 3) palette.push(rgbToHex([data[i], data[i + 1], data[i + 2]]));
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') {
      ended = true;
      break;
    } else if (!(type.charCodeAt(0) & 0x20)) {
      // An upper-case first letter marks a critical chunk; ancillary ones (tRNS, gAMA, tEXt) skip.
      throw new Error(`unknown critical chunk ${type}`);
    }
  }
  if (!ihdr || !ended) throw new Error('PNG lacks IHDR or IEND');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [depth, colourType, , , interlace] = ihdr.subarray(8, 13);
  if (colourType !== 3 || depth !== 8) {
    throw new Error(`not PNG-8: colour type ${colourType}, bit depth ${depth} (want 3 and 8)`);
  }
  if (interlace !== 0) throw new Error('interlaced PNGs are not read');
  if (!palette) throw new Error('indexed PNG lacks PLTE');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width + 1;
  if (raw.length !== stride * height) throw new Error('image data is the wrong length');
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const src = y * stride + 1;
    const dst = y * width;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? indices[dst + x - 1] : 0;
      const up = y > 0 ? indices[dst - width + x] : 0;
      const c = x > 0 && y > 0 ? indices[dst - width + x - 1] : 0;
      let pred;
      if (filter === 0) pred = 0;
      else if (filter === 1) pred = a;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (a + up) >> 1;
      else if (filter === 4) pred = paeth(a, up, c);
      else throw new Error(`row ${y} has unknown filter ${filter}`);
      indices[dst + x] = (raw[src + x] + pred) & 0xff;
    }
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= palette.length) throw new Error(`pixel index ${indices[i]} is past the palette`);
  }
  return { width, height, palette, indices };
}
