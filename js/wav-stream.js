const ENCODER_RATES=new Set([32000,44100,48000]);
const MAX_HEADER_SCAN=8*1024*1024;
const MAX_CHUNKS=4096;
const FRAME_GROUP=1152*64;
const FORMAT_PCM=1,FORMAT_MS_ADPCM=2,FORMAT_IEEE_FLOAT=3,FORMAT_ALAW=6,FORMAT_MULAW=7,FORMAT_IMA_ADPCM=17,FORMAT_EXTENSIBLE=0xfffe;

function readAscii(view,offset,len){let s="";for(let i=0;i<len;i++)s+=String.fromCharCode(view.getUint8(offset+i));return s}
function abortIf(signal){if(signal?.aborted)throw new DOMException("使用者已停止","AbortError")}
function targetRateFor(sourceRate){
  if(ENCODER_RATES.has(sourceRate))return sourceRate;
  if(sourceRate>=8000&&sourceRate<38000)return 32000;
  if(sourceRate>=38000&&sourceRate<46500)return 44100;
  if(sourceRate>=46500&&sourceRate<=48000)return 48000;
  return null;
}
function formatLabel(tag){return({1:"PCM",2:"Microsoft ADPCM",3:"IEEE Float",6:"G.711 A-law",7:"G.711 μ-law",17:"IMA ADPCM",65534:"WAVE_FORMAT_EXTENSIBLE"})[tag]||`WAVE format ${tag}`}
function isStandardExtensibleGuid(bytes){
  if(bytes.length<40)return false;
  // KSDATAFORMAT_SUBTYPE_* = xxxxxxxx-0000-0010-8000-00AA00389B71
  const tail=[0x00,0x00,0x10,0x00,0x80,0x00,0x00,0xaa,0x00,0x38,0x9b,0x71];
  for(let i=0;i<tail.length;i++)if(bytes[28+i]!==tail[i])return false;
  return true;
}

export async function inspectWavFile(file,{signal}={}){
  abortIf(signal);
  if(!file||typeof file.slice!=="function")return{streamable:false,reason:"不是可讀取的檔案"};
  const first=new Uint8Array(await file.slice(0,Math.min(file.size,12)).arrayBuffer());
  if(first.length<12)return{streamable:false,reason:"WAV 標頭不完整"};
  const firstView=new DataView(first.buffer,first.byteOffset,first.byteLength);
  const riff=readAscii(firstView,0,4),wave=readAscii(firstView,8,4);
  if(wave!=="WAVE"||!(riff==="RIFF"||riff==="RF64"))return{streamable:false,reason:"不是 RIFF/RF64 WAVE"};
  if(riff==="RF64")return{streamable:false,container:riff,reason:"RF64 暫不支援真正串流，將使用瀏覽器解碼模式"};

  let offset=12,fmt=null,dataOffset=null,dataSize=null,chunks=0;
  while(offset+8<=file.size&&offset<MAX_HEADER_SCAN&&chunks++<MAX_CHUNKS){
    abortIf(signal);
    const hdr=new Uint8Array(await file.slice(offset,offset+8).arrayBuffer());
    if(hdr.length<8)break;
    const hv=new DataView(hdr.buffer,hdr.byteOffset,hdr.byteLength),id=readAscii(hv,0,4),size=hv.getUint32(4,true);
    const payload=offset+8,next=payload+size+(size&1);
    if(next<=offset||next>file.size+1)return{streamable:false,container:riff,reason:"WAV chunk 長度異常"};
    if(id==="fmt "){
      if(size<16||size>65536)return{streamable:false,container:riff,reason:"WAV fmt chunk 不合理"};
      const b=new Uint8Array(await file.slice(payload,payload+Math.min(size,96)).arrayBuffer());
      if(b.length<16)return{streamable:false,container:riff,reason:"WAV fmt chunk 不完整"};
      const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
      const rawFormat=v.getUint16(0,true),channels=v.getUint16(2,true),sampleRate=v.getUint32(4,true),byteRate=v.getUint32(8,true),blockAlign=v.getUint16(12,true),bitsPerSample=v.getUint16(14,true);
      let audioFormat=rawFormat,validBitsPerSample=bitsPerSample,subFormat=null;
      if(rawFormat===FORMAT_EXTENSIBLE){
        if(size<40||b.length<40||!isStandardExtensibleGuid(b)){
          fmt={rawFormat,audioFormat:rawFormat,channels,sampleRate,byteRate,blockAlign,bitsPerSample,validBitsPerSample,subFormat:null};
        }else{
          validBitsPerSample=v.getUint16(18,true)||bitsPerSample;
          subFormat=v.getUint16(24,true);
          if(subFormat===FORMAT_PCM||subFormat===FORMAT_IEEE_FLOAT)audioFormat=subFormat;
          fmt={rawFormat,audioFormat,channels,sampleRate,byteRate,blockAlign,bitsPerSample,validBitsPerSample,subFormat};
        }
      }else fmt={rawFormat,audioFormat,channels,sampleRate,byteRate,blockAlign,bitsPerSample,validBitsPerSample,subFormat};
    }else if(id==="data"){
      dataOffset=payload;dataSize=Math.min(size,Math.max(0,file.size-payload));
      if(fmt)break;
    }
    offset=next;
  }
  if(!fmt||dataOffset==null||dataSize==null)return{streamable:false,container:riff,reason:"找不到必要的 fmt/data chunk"};
  const base={container:riff,rawAudioFormat:fmt.rawFormat,audioFormat:fmt.audioFormat,formatLabel:formatLabel(fmt.rawFormat===FORMAT_EXTENSIBLE?fmt.rawFormat:fmt.audioFormat),subFormat:fmt.subFormat,channels:fmt.channels,sampleRate:fmt.sampleRate,bitsPerSample:fmt.bitsPerSample,validBitsPerSample:fmt.validBitsPerSample,blockAlign:fmt.blockAlign,dataOffset,dataSize};
  if(fmt.rawFormat===FORMAT_EXTENSIBLE&&!(fmt.audioFormat===FORMAT_PCM||fmt.audioFormat===FORMAT_IEEE_FLOAT))return{...base,streamable:false,reason:`WAVE_FORMAT_EXTENSIBLE 子格式 ${fmt.subFormat??"未知"} 尚不支援`};
  if([FORMAT_MS_ADPCM,FORMAT_IMA_ADPCM].includes(fmt.audioFormat))return{...base,streamable:false,reason:`${formatLabel(fmt.audioFormat)} 尚未內建 Native 解碼`};
  if(![FORMAT_PCM,FORMAT_IEEE_FLOAT,FORMAT_ALAW,FORMAT_MULAW].includes(fmt.audioFormat))return{...base,streamable:false,reason:`${formatLabel(fmt.audioFormat)} 尚未內建 Native 解碼`};
  if(fmt.channels<1||fmt.channels>2)return{...base,streamable:false,reason:`WAV ${fmt.channels} 聲道尚不支援 Native 串流`};
  const targetSampleRate=targetRateFor(fmt.sampleRate);
  if(!targetSampleRate)return{...base,streamable:false,reason:`WAV ${fmt.sampleRate} Hz 尚不支援 Native 串流`};

  let bytesPerSample=0,expectedAlign=0;
  if(fmt.audioFormat===FORMAT_PCM){
    if(![8,16,24,32].includes(fmt.bitsPerSample))return{...base,streamable:false,reason:`PCM ${fmt.bitsPerSample}-bit 尚不支援 Native 串流`};
    bytesPerSample=fmt.bitsPerSample/8;expectedAlign=fmt.channels*bytesPerSample;
  }else if(fmt.audioFormat===FORMAT_IEEE_FLOAT){
    if(fmt.bitsPerSample!==32)return{...base,streamable:false,reason:`IEEE Float ${fmt.bitsPerSample}-bit 尚不支援 Native 串流`};
    bytesPerSample=4;expectedAlign=fmt.channels*4;
  }else{
    if(fmt.bitsPerSample!==8)return{...base,streamable:false,reason:`${formatLabel(fmt.audioFormat)} 預期為 8-bit，實際 ${fmt.bitsPerSample}-bit`};
    bytesPerSample=1;expectedAlign=fmt.channels;
  }
  if(!Number.isInteger(bytesPerSample)||fmt.blockAlign!==expectedAlign||fmt.blockAlign<=0)return{...base,streamable:false,reason:"WAV blockAlign 與格式不一致"};
  const expectedByteRate=fmt.sampleRate*fmt.blockAlign;
  if(fmt.byteRate!==expectedByteRate)return{...base,streamable:false,reason:"WAV byteRate 與格式不一致"};
  const frames=Math.floor(dataSize/fmt.blockAlign),duration=frames/fmt.sampleRate;
  if(!Number.isFinite(duration)||duration<=0)return{...base,streamable:false,reason:"WAV 音訊長度無效"};
  return{...base,streamable:true,bytesPerSample,dataSize:frames*fmt.blockAlign,frames,duration,targetSampleRate,resampled:targetSampleRate!==fmt.sampleRate,codecName:fmt.rawFormat===FORMAT_EXTENSIBLE?`WAVE_FORMAT_EXTENSIBLE/${formatLabel(fmt.audioFormat)}`:formatLabel(fmt.audioFormat)};
}

function decodeMuLaw(byte){
  const u=(~byte)&0xff,sign=u&0x80,exponent=(u>>4)&7,mantissa=u&0x0f;
  let sample=((mantissa<<3)+0x84)<<exponent;sample-=0x84;if(sign)sample=-sample;
  return Math.max(-1,Math.min(1,sample/32768));
}
function decodeALaw(byte){
  const a=(byte^0x55)&0xff;let t=(a&0x0f)<<4,seg=(a&0x70)>>4;
  if(seg===0)t+=8;else if(seg===1)t+=0x108;else{t+=0x108;t<<=seg-1}
  if(!(a&0x80))t=-t;return Math.max(-1,Math.min(1,t/32768));
}
function sampleAt(view,offset,format,bits){
  if(format===FORMAT_ALAW)return decodeALaw(view.getUint8(offset));
  if(format===FORMAT_MULAW)return decodeMuLaw(view.getUint8(offset));
  if(format===FORMAT_IEEE_FLOAT){const v=view.getFloat32(offset,true);return Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0}
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

function createLinearResampler(sourceRate,targetRate,channels,totalSourceFrames){
  if(sourceRate===targetRate)return{process(pcm){return pcm},flush(){return null},targetFrames:totalSourceFrames};
  const targetFrames=Math.max(1,Math.round(totalSourceFrames*targetRate/sourceRate));
  let nextOut=0,sourceBase=0,carry=null;
  function process(pcm,final=false){
    const n=pcm[0]?.length||0;if(!n&&!final)return null;
    const start=sourceBase,end=sourceBase+n;let buf=pcm,bufStart=start;
    if(carry){buf=Array.from({length:channels},(_,ch)=>{const a=new Float32Array(n+1);a[0]=carry[ch];if(n)a.set(pcm[ch],1);return a});bufStart=start-1}
    const outs=Array.from({length:channels},()=>[]);
    while(nextOut<targetFrames){
      const pos=nextOut*sourceRate/targetRate,i0=Math.floor(pos),i1=i0+1;
      if(!final&&i1>=end)break;
      if(final&&i0>=end)break;
      const aIndex=i0-bufStart,bIndex=Math.min(i1,end-1)-bufStart,frac=pos-i0;
      if(aIndex<0||aIndex>=buf[0].length||bIndex<0||bIndex>=buf[0].length)break;
      for(let ch=0;ch<channels;ch++){const a=buf[ch][aIndex],b=buf[ch][bIndex];outs[ch].push(a+(b-a)*frac)}
      nextOut++;
    }
    if(n){carry=Array.from({length:channels},(_,ch)=>pcm[ch][n-1]);sourceBase=end}
    if(!outs[0].length)return null;
    return outs.map(a=>Float32Array.from(a));
  }
  return{process:pcm=>process(pcm,false),flush:()=>process(Array.from({length:channels},()=>new Float32Array(0)),true),targetFrames};
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
  let readFrames=0,writtenFrames=0;const framesPerRead=FRAME_GROUP,bytesPerRead=framesPerRead*info.blockAlign,outChannels=forceMono?1:info.channels,targetRate=info.targetSampleRate||info.sampleRate,resampler=createLinearResampler(info.sampleRate,targetRate,outChannels,info.frames);
  for(let pos=0;pos<info.dataSize;pos+=bytesPerRead){
    abortIf(signal);const end=Math.min(info.dataSize,pos+bytesPerRead),bytes=new Uint8Array(await file.slice(info.dataOffset+pos,info.dataOffset+end).arrayBuffer()),pcm=decodeChunk(bytes,info,{forceMono}),out=resampler.process(pcm);
    if(out?.[0]?.length){await onChunk?.(out);writtenFrames+=out[0].length}
    readFrames+=pcm[0]?.length||0;onProgress?.(Math.min(1,readFrames/info.frames));
  }
  const tail=resampler.flush();if(tail?.[0]?.length){await onChunk?.(tail);writtenFrames+=tail[0].length}
  return{frames:writtenFrames,sourceFrames:readFrames,channels:outChannels,sampleRate:targetRate,sourceSampleRate:info.sampleRate,duration:readFrames/info.sampleRate,resampled:targetRate!==info.sampleRate};
}

export const WAV_STREAM_INFO=Object.freeze({sampleRates:[32000,44100,48000],sourceSampleRateRange:[8000,48000],channels:[1,2],pcmBits:[8,16,24,32],floatBits:[32],telephonyCodecs:["G.711 A-law","G.711 μ-law"],extensibleSubFormats:["PCM","IEEE Float"],maxHeaderScan:MAX_HEADER_SCAN});
