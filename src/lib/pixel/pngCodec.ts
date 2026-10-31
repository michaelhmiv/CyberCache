/**
 * Minimal pure-TS PNG codec (golden-image infrastructure, overhaul
 * addendum) — decode 8-bit non-interlaced PNGs (gray, RGB, palette,
 * gray+alpha, RGBA) and encode RGBA PNGs, using only node:zlib. No
 * native deps, so the golden suite runs identically in CI and locally.
 * NOT a general PNG implementation: interlaced and 16-bit files throw.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major, 4 per pixel. */
  data: Uint8Array;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

export function decodePng(buf: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset < buf.length) {
    const length = readU32(buf, offset);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = readU32(buf, dataStart);
      height = readU32(buf, dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'PLTE') {
      palette = buf.subarray(dataStart, dataStart + length);
    } else if (type === 'tRNS') {
      trns = buf.subarray(dataStart, dataStart + length);
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
  const raw = inflateSync(compressed);
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const row = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const recon = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? recon[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = row[x];
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      recon[x] = value;
    }
    prev.set(recon);
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (colorType === 6) {
        out[dst] = recon[src];
        out[dst + 1] = recon[src + 1];
        out[dst + 2] = recon[src + 2];
        out[dst + 3] = recon[src + 3];
      } else if (colorType === 2) {
        out[dst] = recon[src];
        out[dst + 1] = recon[src + 1];
        out[dst + 2] = recon[src + 2];
        out[dst + 3] = 255;
      } else if (colorType === 0) {
        out[dst] = out[dst + 1] = out[dst + 2] = recon[src];
        out[dst + 3] = 255;
      } else if (colorType === 4) {
        out[dst] = out[dst + 1] = out[dst + 2] = recon[src];
        out[dst + 3] = recon[src + 1];
      } else if (colorType === 3) {
        if (!palette) throw new Error('palette PNG without PLTE');
        const idx = recon[src];
        out[dst] = palette[idx * 3] ?? 0;
        out[dst + 1] = palette[idx * 3 + 1] ?? 0;
        out[dst + 2] = palette[idx * 3 + 2] ?? 0;
        out[dst + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8), 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return out;
}

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(Buffer.from(raw), { level: 6 });
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Pixel-diff with tolerance: returns the fraction of pixels whose
 *  per-channel delta exceeds `channelTolerance`, ignoring fully
 *  transparent pairs. Sizes must match. */
export function diffFraction(a: RgbaImage, b: RgbaImage, channelTolerance = 12): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let different = 0;
  let counted = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] === 0 && b.data[i + 3] === 0) continue;
    counted++;
    if (
      Math.abs(a.data[i] - b.data[i]) > channelTolerance ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > channelTolerance ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > channelTolerance ||
      Math.abs(a.data[i + 3] - b.data[i + 3]) > channelTolerance
    ) {
      different++;
    }
  }
  return counted === 0 ? 0 : different / counted;
}
