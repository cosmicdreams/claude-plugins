import { sharedRequire } from './runtime.ts';
import { roundEven, roundDecimal } from './json.ts';
import type { Geometry, GeometryBox } from './build-artifacts.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export const TOLERANCE = 40, THRESHOLD = 0.06;
export interface Pixels { width: number; height: number; data: Uint8Array }
/** Pillow crop semantics include black pixels outside the source, and ties round to even. */
export function region(img: Pixels, box: GeometryBox): Pixels {
  const x = roundEven(box.x), y = roundEven(box.y), width = roundEven(box.width), height = roundEven(box.height);
  if (width < 0 || height < 0) throw new Error('negative crop dimension');
  const data = new Uint8Array(width * height * 3);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) if (x + i >= 0 && x + i < img.width && y + j >= 0 && y + j < img.height) data.set(img.data.subarray(((y + j) * img.width + x + i) * 3, ((y + j) * img.width + x + i) * 3 + 3), (j * width + i) * 3);
  return { width, height, data };
}
export function masked(img: Pixels, boxes: GeometryBox[]): Pixels {
  const data = img.data.slice();
  for (const b of boxes) {
    const x = roundEven(b.x) - 1, y = roundEven(b.y) - 1;
    for (let j = Math.max(0, y); j < Math.min(img.height, y + roundEven(b.height) + 2); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + roundEven(b.width) + 2); i++) data.fill(255, (j * img.width + i) * 3, (j * img.width + i) * 3 + 3);
  }
  return { ...img, data };
}
export function comparePair(a: Pixels, b: Pixels, corrected = false) {
  const width = corrected ? Math.max(a.width, b.width) : Math.min(a.width, b.width), height = corrected ? Math.max(a.height, b.height) : Math.min(a.height, b.height), sharedW = Math.min(a.width, b.width), sharedH = Math.min(a.height, b.height), total = Math.max(1, width * height);
  let changed = corrected ? total - sharedW * sharedH : 0;
  for (let y = 0; y < sharedH; y++) for (let x = 0; x < sharedW; x++) {
    const ai = (y * a.width + x) * 3, bi = (y * b.width + x) * 3, r = Math.abs(a.data[ai]! - b.data[bi]!), g = Math.abs(a.data[ai + 1]! - b.data[bi + 1]!), blue = Math.abs(a.data[ai + 2]! - b.data[bi + 2]!);
    // Pillow's RGB -> L uses integer coefficients and nearest rounding.
    if ((corrected ? Math.max(r, g, blue) : Math.floor((r * 19595 + g * 38470 + blue * 7471 + 32768) / 65536)) > TOLERANCE) changed++;
  }
  return { width, height, changed, ratio: roundDecimal(changed / total, 4), ...(corrected ? { widthDelta: Math.abs(a.width - b.width) } : {}), heightDelta: corrected ? Math.abs(a.height - b.height) : 0, pass: changed / total <= THRESHOLD };
}
export async function compare(png: string | Buffer, geometry: Geometry, corrected = false, masks?: GeometryBox[][] | null) {
  // Use raw RGBA and Pillow's alpha-compositing rounding, independent of libvips flatten.
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), data = new Uint8Array(decoded.info.width * decoded.info.height * 3);
  for (let p = 0; p < data.length / 3; p++) { const a = decoded.data[p * 4 + 3]!; for (let c = 0; c < 3; c++) data[p * 3 + c] = Math.floor((decoded.data[p * 4 + c]! * a + 255 * (255 - a) + 127) / 255); }
  const img: Pixels = { width: decoded.info.width, height: decoded.info.height, data }, pairs = [];
  for (let i = 0; i < Math.min(geometry.variants?.length ?? 0, geometry.captures?.length ?? 0); i++) {
    const v = geometry.variants![i]!, c = geometry.captures![i]!, boxes = masks?.[i]; let a = region(img, v), b = region(img, c);
    const ratioUnmasked = boxes?.length ? comparePair(a, b, corrected).ratio : undefined;
    if (boxes?.length) { a = masked(a, boxes); b = masked(b, boxes); }
    pairs.push({ ...comparePair(a, b, corrected), ...(boxes?.length ? { ratioUnmasked, textMasked: boxes.length } : {}), label: v.label ?? null, heightDelta: roundDecimal(Math.abs(v.height - c.height), 1) });
  }
  return { ...(corrected ? { metric: 'corrected' } : {}), threshold: THRESHOLD, tolerance: TOLERANCE, pairs, pass: !!pairs.length && pairs.every(p => p.pass) };
}
