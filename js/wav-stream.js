const SUPPORTED_RATES=new Set([32000,44100,48000]);
const MAX_HEADER_SCAN=8*1024*1024;
const MAX_CHUNKS=4096;
const FRAME_GROUP=1152*64;

function readAscii(view,offset,len){let s="";for(let i=0;i<len;i++)s+=String.fromCharCode(view.getUint8(offset+i));return s}
function abortIf(signal){if(signal?.aborted)throw new DOMException("使用者已停止","AbortError")}

export async function inspectWavFile(file,{signal}={}){
  abortIf(signal);
  if(!file||typeof file.slice!=="function")return{streamable:false,reason:"不是可讀取的檔案"};
  const first=new Uint8Array(await file.slice(0,Math.min(file.size,12)).arrayBuffer());
  if(first.length<12)return{streamable:false,reason:"WAV 標頭不完整"};
  const firstView=new DataView(first.buffer,first.byteOffset,first.byteLength);
  const riff=readAscii(firstView,0,4),wave=readAscii(firstView,8,4);
  if(wave!=="WAVE"||!(riff==="RIFF"||riff==="RF64"))return{streamable:false,reason:"不是 RIFF/RF64 WAVE"};
  if(riff==="RF64")return{streamable:false,reason:"RF64 暫不支援真正串流，將使用瀏覽器解碼模式"};

  let offset=12,fmt=null,dataOffset=null,dataSize=null,chunks=0;
  while(offset+8<=file.size&&offset<MAX_HEADER_SCAN&&chunks++<MAX_CHUNKS){
    abortIf(signal);
    const hdr=new Uint8Array(await file.slice(offset,offset+8).arrayBuffer());
    if(hdr.length<8)break;
    const hv=new DataView(hdr.buffer,hdr.byteOffset,hdr.byteLength),id=readAscii(hv,0,4),size=hv.getUint32(4,true);
    const payload=offset+8,next=payload+size+(size&1);
    if(next<=offset||next>file.size+1)return{streamable:false,reason:"WAV chunk 長度異常"};
    if(id==="fmt "){
      if(size<16||size>65536)return{streamable:false,reason:"WAV fmt chunk 不合理"};
      const b=new Uint8Array(await file.slice(payload,payload+Math.min(size,64)).arrayBuffer());
      if(b.length<16)return{streamable:false,reason:"WAV fmt chunk 不完整"};
      const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
      fmt={audioFormat:v.getUint16(0,true),channels:v.getUint16(2,true),sampleRate:v.getUint32(4,true),byteRate:v.getUint32(8,true),blockAlign:v.getUint16(12,true),bitsPerSample:v.getUint16(14,true)};
    }else if(id==="data"){
      dataOffset=payload;dataSize=Math.min(size,Math.max(0,file.size-payload));
      if(fmt)break;
    }
    offset=next;
  }
  if(!fmt||dataOffset==null||dataSize==null)return{streamable:false,reason:"找不到必要的 fmt/data chunk"};
  const bytesPerSample=fmt.bitsPerSample/8;
  const validFormat=fmt.audioFormat===1||fmt.audioFormat===3;
  const validBits=(fmt.audioFormat===1&&[8,16,24,32].includes(fmt.bitsPerSample))||(fmt.audioFormat===3&&fmt.bitsPerSample===32);
  const expectedAlign=fmt.channels*bytesPerSample;
  if(!validFormat)return{streamable:false,reason:`WAV 編碼格式 ${fmt.audioFormat} 尚不支援串流`};
  if(!validBits)return{streamable:false,reason:`WAV ${fmt.bitsPerSample}-bit 尚不支援串流`};
  if(fmt.channels<1||fmt.channels>2)return{streamable:false,reason:`WAV ${fmt.channels} 聲道尚不支援串流`};
  if(!SUPPORTED_RATES.has(fmt.sampleRate))return{streamable:false,reason:`WAV ${fmt.sampleRate} Hz 尚不支援原生串流`};
  if(!Number.isInteger(bytesPerSample)||fmt.blockAlign!==expectedAlign||fmt.blockAlign<=0)return{streamable:false,reason:"WAV blockAlign 與格式不一致"};
  if(fmt.byteRate!==fmt.sampleRate*fmt.blockAlign)return{streamable:false,reason:"WAV byteRate 與格式不一致"};
  const frames=Math.floor(dataSize/fmt.blockAlign),duration=frames/fmt.sampleRate;
  if(!Number.isFinite(duration)||duration<=0)return{streamable:false,reason:"WAV 音訊長度無效"};
  return{streamable:true,container:riff,audioFormat:fmt.audioFormat,channels:fmt.channels,sampleRate:fmt.sampleRate,bitsPerSample:fmt.bitsPerSample,blockAlign:fmt.blockAlign,dataOffset,dataSize:frames*fmt.blockAlign,frames,duration,bytesPerSample};
}

function sampleAt(view,offset,format,bits){
  if(format===3){const v=view.getFloat32(offset,true);return Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0}
  if(bits===8)return(view.getUint8(offset)-128)/128;
  if(bits===16)return view.getInt16(offset,true)/32768;
  if(bits===24){let v=view.getUint8(offset)|(view.getUint8(offset+1)<<8)|(view.getUint8(offset+2)<<16);if(v&0x800000)v|=0xff000000;return v/8388608}
  return view.getInt32(offset,true)/2147483648;
}

function decodeChunk(bytes,info,{forceMono=false}={}){
  const frames=Math.floor(bytes.byteLength/info.blockAlign),outChannels=forceMono?1:info.channels;
  const out=Array.from({length:outChannels},()=>new Float32Array(frames)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),bps=info.bytesPerSample;
  for(let i=0;i<frames;i++){
    const base=i*info.blockAlign;
    if(info.channels===1){out[0][i]=sampleAt(view,base,info.audioFormat,info.bitsPerSample);continue}
    const l=sampleAt(view,base,info.audioFormat,info.bitsPerSample),r=sampleAt(view,base+bps,info.audioFormat,info.bitsPerSample);
    if(forceMono)out[0][i]=(l+r)*0.5;else{out[0][i]=l;out[1][i]=r}
  }
  return out;
}

export async function scanWavPeak(file,info,{forceMono=false,signal,onProgress}={}){
  let peak=0,readFrames=0;const framesPerRead=FRAME_GROUP,bytesPerRead=framesPerRead*info.blockAlign;
  for(let pos=0;pos<info.dataSize;pos+=bytesPerRead){
    abortIf(signal);const end=Math.min(info.dataSize,pos+bytesPerRead),bytes=new Uint8Array(await file.slice(info.dataOffset+pos,info.dataOffset+end).arrayBuffer()),pcm=decodeChunk(bytes,info,{forceMono});
    for(const ch of pcm)for(let i=0;i<ch.length;i++){const a=Math.abs(ch[i]);if(a>peak)peak=a}
    readFrames+=pcm[0]?.length||0;onProgress?.(Math.min(1,readFrames/info.frames));
  }
  return peak;
}

export async function streamWavPcm(file,info,{forceMono=false,signal,onChunk,onProgress}={}){
  let readFrames=0;const framesPerRead=FRAME_GROUP,bytesPerRead=framesPerRead*info.blockAlign;
  for(let pos=0;pos<info.dataSize;pos+=bytesPerRead){
    abortIf(signal);const end=Math.min(info.dataSize,pos+bytesPerRead),bytes=new Uint8Array(await file.slice(info.dataOffset+pos,info.dataOffset+end).arrayBuffer()),pcm=decodeChunk(bytes,info,{forceMono});
    await onChunk?.(pcm);readFrames+=pcm[0]?.length||0;onProgress?.(Math.min(1,readFrames/info.frames));
  }
  return{frames:readFrames,channels:forceMono?1:info.channels,sampleRate:info.sampleRate,duration:readFrames/info.sampleRate};
}

export const WAV_STREAM_INFO=Object.freeze({sampleRates:[32000,44100,48000],channels:[1,2],pcmBits:[8,16,24,32],floatBits:[32],maxHeaderScan:MAX_HEADER_SCAN});
