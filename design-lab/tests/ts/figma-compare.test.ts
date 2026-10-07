import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePair, compare, masked, region } from '../../src/figma-compare.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const pixels = (width: number, height: number, fill = 100) => ({ width, height, data: new Uint8Array(width * height * 3).fill(fill) });
test('identical pixels pass both metrics, missing content and displacement fail', () => {
  const a = pixels(100, 100), b = pixels(100, 100, 255); assert.equal(comparePair(a, a).changed, 0); assert.equal(comparePair(a, a, true).pass, true); assert.equal(comparePair(a, b).pass, false);
  const shifted = pixels(100, 100); for (let y = 0; y < 100; y++) shifted.data.fill(255, y * 300, y * 300 + 60); assert.ok(comparePair(a, shifted).ratio > .06);
});
test('unmatched height and area count in corrected acceptance', () => { const a = pixels(100, 50), b = pixels(100, 80); assert.equal(comparePair(a, b).pass, true); const corrected = comparePair(a, b, true); assert.equal(corrected.changed, 3000); assert.equal(corrected.heightDelta, 30); assert.equal(corrected.pass, false); });
test('tolerance applies per channel and equality at the threshold does not count', () => { const a = pixels(10, 10), b = pixels(10, 10); for (let p = 0; p < 100; p++) b.data[p * 3] = 150; assert.equal(comparePair(a, b).pass, true); assert.equal(comparePair(a, b, true).changed, 100); for (let p = 0; p < 100; p++) b.data[p * 3] = 140; assert.equal(comparePair(a, b, true).changed, 0); });
test('Pillow crop rounding and black padding are retained', () => { const image = pixels(2, 2, 255); const out = region(image, { x: -.5, y: 0, width: 3, height: 2 }); assert.deepEqual([...out.data.subarray(0, 3)], [255, 255, 255]); assert.deepEqual([...out.data.subarray(6, 9)], [0, 0, 0]); });
test('masking expands text boxes by a pixel and keeps other geometry', () => { const img = pixels(10, 10, 0), out = masked(img, [{ x: 3, y: 3, width: 1, height: 1 }]); assert.equal(out.data[(2 * 10 + 2) * 3], 255); assert.equal(out.data[(5 * 10 + 5) * 3], 0); assert.equal(img.data[(2 * 10 + 2) * 3], 0); });
test('Sharp decoding uses white alpha background, corrected metrics and text masks', async () => {
  const png = await sharp({ create: { width: 20, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(); const geometry = { variants: [{ label: 'Mobile', x: 0, y: 0, width: 20, height: 20 }], captures: [{ label: 'Mobile', x: 0, y: 20, width: 20, height: 20 }] };
  const result = await compare(png, geometry, true, [[{ x: 2, y: 2, width: 3, height: 4 }]]); assert.equal(result.metric, 'corrected'); assert.equal(result.pass, true); assert.equal(result.pairs[0]!.ratioUnmasked, 0); assert.equal(result.pairs[0]!.textMasked, 1); assert.equal((await compare(png, { variants: [], captures: [] }, true)).pass, false);
});

test('row-span crops retain exact legacy pixels at five boundaries and rounding cases',()=>{
 const img=pixels(11,9);img.data.forEach((_,i)=>img.data[i]=(i*31)%256);
 for(const box of [{x:0,y:0,width:11,height:9},{x:-2,y:-3,width:12,height:13},{x:10,y:8,width:4,height:5},{x:1.5,y:2.5,width:4.5,height:6.5},{x:-20,y:12,width:3,height:4}]){
  const actual=region(img,box),data=new Uint8Array(actual.data.length),even=(v:number)=>v%1===.5?(Math.floor(v)%2?Math.ceil(v):Math.floor(v)):Math.round(v),x=even(box.x),y=even(box.y);
  for(let j=0;j<actual.height;j++)for(let i=0;i<actual.width;i++)if(x+i>=0&&x+i<img.width&&y+j>=0&&y+j<img.height){const start=((y+j)*img.width+x+i)*3;data.set(img.data.subarray(start,start+3),(j*actual.width+i)*3);}
  assert.deepEqual(actual.data,data);
 }
});
test('shared decode/crops preserve both metrics and masks on every alpha byte',async()=>{
 const {compareBoth}=await import('../../src/figma-compare.ts'),data=Buffer.alloc(16*16*4);
 for(let p=0;p<256;p++){data[p*4]=p;data[p*4+1]=255-p;data[p*4+2]=(p*17)%256;data[p*4+3]=p;}
 const png=await sharp(data,{raw:{width:16,height:16,channels:4}}).png().toBuffer();
 const boxes=[{x:-2,y:-1,width:9,height:10},{x:1.5,y:2.5,width:4.5,height:6.5},{x:14,y:14,width:6,height:7}];
 const geometry={variants:boxes,captures:boxes.map(b=>({...b,x:b.x+1,y:b.y+1}))};
 for(const masks of [null,boxes.map(()=>[{x:1,y:2,width:3,height:4}])]){const both=await compareBoth(png,geometry,masks);assert.deepEqual(both.original,await compare(png,geometry,false,masks));assert.deepEqual(both.corrected,await compare(png,geometry,true,masks));}
});
