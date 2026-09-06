const SLICE_BYTES=64*1024;
function hex(bytes){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("")}
export function isStrongFingerprint(value){return String(value||"").startsWith("sha256-sample-v2:")}
export async function fileFingerprint(file){
  const size=Number(file?.size||0);
  if(!globalThis.crypto?.subtle)return`meta-v2:${size}:${Number(file?.lastModified||0)}`;
  const ranges=[[0,Math.min(size,SLICE_BYTES)]];
  if(size>SLICE_BYTES*2){const mid=Math.max(0,Math.floor(size/2-SLICE_BYTES/2));ranges.push([mid,Math.min(size,mid+SLICE_BYTES)])}
  if(size>SLICE_BYTES)ranges.push([Math.max(0,size-SLICE_BYTES),size]);
  const parts=[];let total=0;for(const [a,b] of ranges){const x=new Uint8Array(await file.slice(a,b).arrayBuffer());parts.push(x);total+=x.length}
  const marker=new TextEncoder().encode(`|v2|${size}|${ranges.map(x=>x.join("-")).join(",")}|`),merged=new Uint8Array(total+marker.length);let p=0;
  for(const x of parts){merged.set(x,p);p+=x.length}merged.set(marker,p);
  return`sha256-sample-v2:${hex(await crypto.subtle.digest("SHA-256",merged))}`;
}
