import assert from 'node:assert/strict';
import {sharedRequire} from '../../src/runtime.ts';
const sharp=sharedRequire()('sharp') as typeof import('sharp').default;
export interface PixelTolerance {mean:number;max:number;fraction:number;above:number}
export const EXACT:PixelTolerance={mean:0,max:0,fraction:0,above:0};
// Independent Lanczos implementations and SVG antialiasing can disagree at edges.
// Mean error <= 1/255, no more than 1% channels > 16, and max <= 64/255.
// JPEG also differs through decoder/encoder quantization (separate, stricter max bound).
export const JPEG:PixelTolerance={mean:2,max:32,fraction:0.01,above:16};
export const EDGE:PixelTolerance={mean:1,max:64,fraction:0.01,above:16};
export async function assertPixels(actual:Buffer,expected:Buffer,label:string,tolerance:PixelTolerance=EXACT) {
  const decode=async(data:Buffer)=>sharp(data).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const [a,b]=await Promise.all([decode(actual),decode(expected)]);
  assert.deepEqual(a.info,b.info,label+': decoded shape');
  let sum=0,max=0,above=0;
  for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]!-b.data[i]!);sum+=d;max=Math.max(max,d);if(d>tolerance.above)above++;}
  const stats={mean:sum/a.data.length,max,fraction:above/a.data.length};
  assert.ok(stats.mean<=tolerance.mean&&stats.max<=tolerance.max&&stats.fraction<=tolerance.fraction,label+': '+JSON.stringify(stats)+' tolerance '+JSON.stringify(tolerance));
  return stats;
}
