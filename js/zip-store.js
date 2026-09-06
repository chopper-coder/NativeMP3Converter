const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crcUpdate(c,bytes){for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return c>>>0}
async function crc32Blob(blob){let c=0xffffffff;const CHUNK=4*1024*1024;for(let start=0;start<blob.size;start+=CHUNK){const bytes=new Uint8Array(await blob.slice(start,Math.min(blob.size,start+CHUNK)).arrayBuffer());c=crcUpdate(c,bytes)}return(c^0xffffffff)>>>0}
function u16(v){return[v&255,(v>>>8)&255]}function u32(v){return[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]}
function dosDateTime(d=new Date()){let y=Math.max(1980,d.getFullYear());const dt=((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1))>>>0,dd=(((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())>>>0;return{time:dt,date:dd}}
function safeZipPath(value){
  const raw=String(value??"").replace(/\\/g,"/");if(!raw||raw.startsWith("/")||/^[A-Za-z]:/.test(raw))throw new Error("ZIP 路徑不可為絕對路徑");
  const parts=raw.split("/").filter(Boolean);if(!parts.length||parts.some(p=>p==="."||p===".."))throw new Error("ZIP 路徑包含不安全的 . 或 .. 區段");
  const cleaned=parts.map(p=>p.replace(/[\u0000-\u001f]/g,"_").slice(0,180));const out=cleaned.join("/");if(out.length>4096)throw new Error("ZIP 路徑過長");return out;
}
export async function makeStoreZip(entries,onProgress=()=>{}){
  const ZIP32_MAX=0xffffffff;if(entries.length>65535)throw new Error("ZIP 檔案數超過 65535 個");
  const enc=new TextEncoder(),local=[],central=[],seen=new Set();let offset=0,index=0;
  for(const e of entries){
    const safeName=safeZipPath(e.name),key=safeName.toLocaleLowerCase();if(seen.has(key))throw new Error(`ZIP 內檔名重複：${safeName}`);seen.add(key);
    const name=enc.encode(safeName);if(name.length>65535)throw new Error("ZIP UTF-8 檔名過長");
    const blob=e.blob instanceof Blob?e.blob:new Blob([e.blob]),crc=await crc32Blob(blob),dt=dosDateTime(e.date),size=blob.size;if(size>ZIP32_MAX)throw new Error("單一檔案超過 ZIP32 4 GB 限制");
    const lh=new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0x0800),...u16(0),...u16(dt.time),...u16(dt.date),...u32(crc),...u32(size),...u32(size),...u16(name.length),...u16(0)]);local.push(lh,name,blob);
    const ch=new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(dt.time),...u16(dt.date),...u32(crc),...u32(size),...u32(size),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]);central.push(ch,name);
    const nextOffset=offset+lh.length+name.length+size;if(nextOffset>ZIP32_MAX)throw new Error("ZIP 總大小超過 ZIP32 4 GB 限制，請改用直接輸出資料夾");offset=nextOffset;index++;onProgress(index,entries.length);
  }
  const centralSize=central.reduce((s,a)=>s+a.length,0);if(centralSize>ZIP32_MAX||offset+centralSize>ZIP32_MAX)throw new Error("ZIP 總大小超過 ZIP32 4 GB 限制，請改用直接輸出資料夾");
  const end=new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(centralSize),...u32(offset),...u16(0)]);return new Blob([...local,...central,end],{type:"application/zip"});
}
export {safeZipPath};
