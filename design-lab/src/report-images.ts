/** RGB Lanczos resampling with the oracle's coefficient quantization and two 8-bit passes.
 * Mathematical behavior follows Pillow 12.3's Resample.c; Sharp supplies decoding/WebP encoding.
 * https://github.com/baseline-pillow/Pillow/blob/12.3.0/src/libImaging/Resample.c
 */
const precision=2**22;
function coefficients(input:number,output:number,count=output) {
  const scale=input/output,filterScale=Math.max(1,scale),support=3*filterScale;
  const sinc=(x:number)=>x===0?1:Math.sin(x*Math.PI)/(x*Math.PI);
  return Array.from({length:count},(_,i)=>{
    const center=(i+.5)*scale,start=Math.max(0,Math.trunc(center-support+.5)),end=Math.min(input,Math.trunc(center+support+.5));
    let total=0;const weights=[];
    for(let j=start;j<end;j++){const x=(j-center+.5)/filterScale,w=x>=-3&&x<3?sinc(x)*sinc(x/3):0;weights.push(w);total+=w;}
    return {start,weights:weights.map(w=>{const n=(total?w/total:w)*precision;return Math.trunc(n+(n<0?-.5:.5));})};
  });
}
const channel=(value:number)=>Math.max(0,Math.min(255,Math.floor(value/precision)));
export function resizeRgb(input:Buffer,width:number,height:number,outWidth:number,outHeight:number,cropHeight=outHeight):Buffer {
  let intermediate=input;
  if(width!==outWidth) {
    const xs=coefficients(width,outWidth);intermediate=Buffer.alloc(outWidth*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<outWidth;x++) {
      const c=xs[x]!;let r=precision/2,g=r,b=r;
      for(let j=0;j<c.weights.length;j++){const p=(y*width+c.start+j)*3,k=c.weights[j]!;r+=input[p]!*k;g+=input[p+1]!*k;b+=input[p+2]!*k;}
      const p=(y*outWidth+x)*3;intermediate[p]=channel(r);intermediate[p+1]=channel(g);intermediate[p+2]=channel(b);
    }
  }
  if(height===outHeight)return intermediate.subarray(0,outWidth*cropHeight*3);
  const ys=coefficients(height,outHeight,cropHeight),result=Buffer.alloc(outWidth*cropHeight*3);
  for(let y=0;y<cropHeight;y++)for(let x=0;x<outWidth;x++) {
    const c=ys[y]!;let r=precision/2,g=r,b=r;
    for(let j=0;j<c.weights.length;j++){const p=((c.start+j)*outWidth+x)*3,k=c.weights[j]!;r+=intermediate[p]!*k;g+=intermediate[p+1]!*k;b+=intermediate[p+2]!*k;}
    const p=(y*outWidth+x)*3;result[p]=channel(r);result[p+1]=channel(g);result[p+2]=channel(b);
  }
  return result;
}
