import { sharedRequire } from './runtime.ts';
import { roundEven, roundDecimal } from './json.ts';
import type { Geometry, GeometryBox } from './build-artifacts.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export const TOLERANCE = 40,
  THRESHOLD = 0.06;
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}
/** Pillow crop semantics include black pixels outside the source, and ties round to even. */
export function region(img: Pixels, box: GeometryBox): Pixels {
  const x = roundEven(box.x),
    y = roundEven(box.y),
    width = roundEven(box.width),
    height = roundEven(box.height);
  if (width < 0 || height < 0) throw new Error('negative crop dimension');
  const data = new Uint8Array(width * height * 3);
  const left = Math.max(0, x),
    right = Math.min(img.width, x + width);
  if (right > left)
    for (let j = Math.max(0, -y); j < Math.min(height, img.height - y); j++) {
      const start = ((y + j) * img.width + left) * 3;
      data.set(img.data.subarray(start, start + (right - left) * 3), (j * width + left - x) * 3);
    }
  return { width, height, data };
}
export function masked(img: Pixels, boxes: GeometryBox[]): Pixels {
  const data = img.data.slice();
  for (const b of boxes) {
    const x = roundEven(b.x) - 1,
      y = roundEven(b.y) - 1;
    for (let j = Math.max(0, y); j < Math.min(img.height, y + roundEven(b.height) + 2); j++)
      for (let i = Math.max(0, x); i < Math.min(img.width, x + roundEven(b.width) + 2); i++)
        data.fill(255, (j * img.width + i) * 3, (j * img.width + i) * 3 + 3);
  }
  return { ...img, data };
}
export function comparePair(a: Pixels, b: Pixels, corrected = false) {
  const width = corrected ? Math.max(a.width, b.width) : Math.min(a.width, b.width),
    height = corrected ? Math.max(a.height, b.height) : Math.min(a.height, b.height),
    sharedW = Math.min(a.width, b.width),
    sharedH = Math.min(a.height, b.height),
    total = Math.max(1, width * height);
  let changed = corrected ? total - sharedW * sharedH : 0;
  for (let y = 0; y < sharedH; y++)
    for (let x = 0; x < sharedW; x++) {
      const ai = (y * a.width + x) * 3,
        bi = (y * b.width + x) * 3,
        r = Math.abs(a.data[ai]! - b.data[bi]!),
        g = Math.abs(a.data[ai + 1]! - b.data[bi + 1]!),
        blue = Math.abs(a.data[ai + 2]! - b.data[bi + 2]!);
      // Pillow's RGB -> L uses integer coefficients and nearest rounding.
      if (
        (corrected ? Math.max(r, g, blue) : Math.floor((r * 19595 + g * 38470 + blue * 7471 + 32768) / 65536)) >
        TOLERANCE
      )
        changed++;
    }
  return {
    width,
    height,
    changed,
    ratio: roundDecimal(changed / total, 4),
    ...(corrected ? { widthDelta: Math.abs(a.width - b.width) } : {}),
    heightDelta: corrected ? Math.abs(a.height - b.height) : 0,
    pass: changed / total <= THRESHOLD,
  };
}
/** Pillow-compatible alpha rounding shared by metrics and report thumbnails. */
export function flattenRgbaOverWhite(rgba: Uint8Array): Uint8Array {
  const data = new Uint8Array((rgba.length / 4) * 3);
  // Exactly Pillow's integer rounding; opaque pixels need no arithmetic.
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]!;
    if (a === 255) {
      data[j] = rgba[i]!;
      data[j + 1] = rgba[i + 1]!;
      data[j + 2] = rgba[i + 2]!;
    } else {
      const white = 255 * (255 - a) + 127;
      data[j] = Math.floor((rgba[i]! * a + white) / 255);
      data[j + 1] = Math.floor((rgba[i + 1]! * a + white) / 255);
      data[j + 2] = Math.floor((rgba[i + 2]! * a + white) / 255);
    }
  }
  return data;
}
async function decode(png: string | Buffer): Promise<Pixels> {
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: decoded.info.width, height: decoded.info.height, data: flattenRgbaOverWhite(decoded.data) };
}
function prepare(img: Pixels, geometry: Geometry, masks?: GeometryBox[][] | null) {
  return Array.from({ length: Math.min(geometry.variants?.length ?? 0, geometry.captures?.length ?? 0) }, (_, i) => {
    const v = geometry.variants![i]!,
      c = geometry.captures![i]!,
      boxes = masks?.[i],
      originalA = region(img, v),
      originalB = region(img, c);
    return {
      v,
      c,
      boxes,
      originalA,
      originalB,
      a: boxes?.length ? masked(originalA, boxes) : originalA,
      b: boxes?.length ? masked(originalB, boxes) : originalB,
    };
  });
}
function measure(prepared: ReturnType<typeof prepare>, corrected: boolean) {
  const pairs = prepared.map(({ v, c, boxes, a, b, originalA, originalB }) => ({
    ...comparePair(a, b, corrected),
    ...(boxes?.length
      ? { ratioUnmasked: comparePair(originalA, originalB, corrected).ratio, textMasked: boxes.length }
      : {}),
    label: v.label ?? null,
    heightDelta: roundDecimal(Math.abs(v.height - c.height), 1),
  }));
  return {
    ...(corrected ? { metric: 'corrected' } : {}),
    threshold: THRESHOLD,
    tolerance: TOLERANCE,
    pairs,
    pass: !!pairs.length && pairs.every((p) => p.pass),
  };
}
export async function compare(
  png: string | Buffer,
  geometry: Geometry,
  corrected = false,
  masks?: GeometryBox[][] | null,
) {
  return measure(prepare(await decode(png), geometry, masks), corrected);
}
/** Decode and crop once, then evaluate both historical and corrected metrics. */
export async function compareBoth(png: string | Buffer, geometry: Geometry, masks?: GeometryBox[][] | null) {
  const prepared = prepare(await decode(png), geometry, masks);
  return { original: measure(prepared, false), corrected: measure(prepared, true) };
}
