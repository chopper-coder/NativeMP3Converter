import { ANALYSIS_WINDOW } from "./analysis-window.js";

const DEFAULT_SAMPLE_RATE = 44100;
const SAMPLE_RATE_INDEXES = Object.freeze({44100:0,48000:1,32000:2});
const BITRATE_PRESETS = Object.freeze({
  64:{bps:64000,index:5,lowpassBands:11,label:"speech-space"},
  96:{bps:96000,index:7,lowpassBands:15,label:"speech-clear"},
  128:{bps:128000,index:9,lowpassBands:21,label:"standard"},
  192:{bps:192000,index:11,lowpassBands:26,label:"high"},
  256:{bps:256000,index:13,lowpassBands:30,label:"higher"},
  320:{bps:320000,index:14,lowpassBands:32,label:"maximum-bitrate"}
});
const SAMPLES_PER_FRAME = 1152;
const SAMPLES_PER_GRANULE = 576;
const GAIN_CALIBRATION = -3;
const PEAK_LIMIT = 0.985;

// MPEG-1 Layer III Huffman table 5. Numeric table data is part of the codec format.
const H5_CODE = new Uint16Array([1,2,6,5,3,1,4,4,7,5,7,1,6,1,1,0]);
const H5_LEN  = new Uint8Array ([1,3,6,7,3,3,6,7,6,6,7,8,7,6,7,8]);

const FILTER = Array.from({length:32},(_,k)=>Float64Array.from({length:64},(_,j)=>
  Math.cos((2*k+1)*(16-j)*Math.PI/64)
));
const MDCT = Array.from({length:18},(_,m)=>Float64Array.from({length:36},(_,j)=>
  Math.sin(Math.PI/36*(j+0.5))*Math.cos((Math.PI/72)*(2*j+19)*(2*m+1))
));
const ALIAS_C = [-0.6,-0.535,-0.33,-0.185,-0.095,-0.041,-0.0142,-0.0037];
const ALIAS_CS = Float64Array.from(ALIAS_C,c=>1/Math.sqrt(1+c*c));
const ALIAS_CA = Float64Array.from(ALIAS_C,c=>c/Math.sqrt(1+c*c));

class BitWriter {
  constructor(){this.bytes=[];this.current=0;this.used=0;this.bitLength=0;}
  write(value,n){
    value=Number(value)>>>0;
    for(let i=n-1;i>=0;i--){
      this.current=(this.current<<1)|((value>>>i)&1);this.used++;this.bitLength++;
      if(this.used===8){this.bytes.push(this.current&255);this.current=0;this.used=0;}
    }
  }
  appendBits(bits){for(const b of bits)this.write(b,1)}
  finishToLength(nBytes){
    if(this.used){this.bytes.push((this.current<<(8-this.used))&255);this.current=0;this.used=0;}
    if(this.bytes.length>nBytes)throw new Error(`MP3 bitstream overflow: ${this.bytes.length} > ${nBytes}`);
    while(this.bytes.length<nBytes)this.bytes.push(0);
    return Uint8Array.from(this.bytes);
  }
}

class AnalysisBank {
  constructor(scale=1){this.x=new Float64Array(512);this.off=0;this.scale=Number.isFinite(scale)?scale:1;}
  step(pcm,offset){
    for(let src=0,i=31;i>=0;i--,src++){const v=Number(pcm[offset+src]);this.x[(i+this.off)&511]=(Number.isFinite(v)?v:0)*this.scale;}
    const y=new Float64Array(64);
    for(let i=0;i<64;i++){
      let sum=0;
      for(let j=0;j<8;j++){
        const zIndex=i+(j<<6);
        sum+=this.x[(zIndex+this.off)&511]*ANALYSIS_WINDOW[zIndex];
      }
      y[i]=sum;
    }
    this.off=(this.off+480)&511;
    const out=new Float64Array(32);
    for(let k=0;k<32;k++){
      let s=0,row=FILTER[k];
      for(let j=0;j<64;j++)s+=row[j]*y[j];
      out[k]=s;
    }
    return out;
  }
  granule(pcm,start){
    const cur=Array.from({length:18},(_,t)=>this.step(pcm,start+t*32));
    for(let t=1;t<18;t+=2)for(let band=1;band<32;band+=2)cur[t][band]*=-1;
    return cur;
  }
}

function transformGranule(cur,prev){
  const xr=new Float64Array(576),input=new Float64Array(36);
  for(let band=0;band<32;band++){
    for(let t=0;t<18;t++){input[t]=prev[t][band];input[t+18]=cur[t][band];}
    for(let m=0;m<18;m++){
      let sum=0,row=MDCT[m];
      for(let j=0;j<36;j++)sum+=input[j]*row[j];
      xr[band*18+m]=sum;
    }
  }
  for(let band=0;band<31;band++)for(let k=0;k<8;k++){
    const li=band*18+17-k,ui=(band+1)*18+k,a=xr[li],b=xr[ui];
    xr[li]=a*ALIAS_CS[k]+b*ALIAS_CA[k];xr[ui]=b*ALIAS_CS[k]-a*ALIAS_CA[k];
  }
  return xr;
}

function huffmanBitLength(ix){
  let last=-1;for(let i=0;i<576;i++)if(ix[i])last=i;
  if(last<0)return{length:0,pairs:0};
  const pairs=Math.floor((last+2)/2);let length=0;
  for(let p=0;p<pairs;p++){
    const a=p*2,x=ix[a]||0,y=ix[a+1]||0,index=x*4+y;
    length+=H5_LEN[index];if(x)length++;if(y)length++;
  }
  return{length,pairs};
}

function encodeHuffman(ix,signs){
  const info=huffmanBitLength(ix);if(!info.length)return{bits:[],pairs:0};
  const bits=[];
  for(let p=0;p<info.pairs;p++){
    const a=p*2,x=ix[a]||0,y=ix[a+1]||0,index=x*4+y,code=H5_CODE[index],len=H5_LEN[index];
    for(let i=len-1;i>=0;i--)bits.push((code>>>i)&1);
    if(x)bits.push(signs[a]?1:0);if(y)bits.push(signs[a+1]?1:0);
  }
  return{bits,pairs:info.pairs};
}

function prepareSpectrum(xr,lowpassBands){
  const mag=new Float64Array(576),signs=new Uint8Array(576);let peak=0,energy=0,weighted=0,active=0;
  const limit=Math.min(576,Math.max(0,lowpassBands*18));
  for(let i=0;i<limit;i++){
    const v=xr[i],a=Math.abs(v);mag[i]=a;signs[i]=v<0?1:0;
    if(a>peak)peak=a;if(a>1e-10)active++;
    const e=a*a;energy+=e;const pos=i/Math.max(1,limit-1);weighted+=e*(1+0.9*pos*pos);
  }
  const highRatio=energy>1e-30?Math.max(0,(weighted/energy)-1):0;
  const complexity=peak<1e-12?0.05:Math.max(0.05,Math.log1p(energy*1e5)*(1+0.45*highRatio)+active/320);
  return{mag,signs,peak,complexity};
}

function buildQuantized(mag,gain){
  const step=Math.pow(2,(gain-210)/4),ix=new Uint8Array(576),den=Math.max(step,1e-30);
  for(let i=0;i<576;i++)if(mag[i])ix[i]=Math.min(3,Math.floor(Math.pow(mag[i]/den,0.75)+0.4054));
  return ix;
}

function quantizePrepared(prepared,maxBits){
  const {mag,signs,peak}=prepared;
  if(peak<1e-12||maxBits<=0)return{bits:[],pairs:0,gain:210,usedBits:0};
  let lo=0,hi=255,best=null;
  while(lo<=hi){
    const mid=(lo+hi)>>1,ix=buildQuantized(mag,mid),info=huffmanBitLength(ix);
    if(info.length<=maxBits){best={gain:mid,ix,info};hi=mid-1}else lo=mid+1;
  }
  if(!best)return{bits:[],pairs:0,gain:255,usedBits:0};
  const packed=encodeHuffman(best.ix,signs);
  return{...packed,gain:Math.max(0,Math.min(255,best.gain+GAIN_CALIBRATION)),usedBits:packed.bits.length};
}

function allocateBudgets(preparedList,totalBits){
  const count=preparedList.length;if(!count)return[];
  const scores=preparedList.map(p=>p.complexity),sum=scores.reduce((a,b)=>a+b,0)||1;
  const floorBits=Math.min(96,Math.floor(totalBits/(count*5))),remaining=Math.max(0,totalBits-floorBits*count);
  const out=scores.map(s=>floorBits+Math.floor(remaining*s/sum));let used=out.reduce((a,b)=>a+b,0),i=0;
  while(used<totalBits){out[i++%count]++;used++}return out;
}

export function peakScaleFor(channels){
  let peak=0;
  for(const channel of channels)for(let i=0;i<channel.length;i++){const a=Math.abs(channel[i]);if(a>peak)peak=a;}
  return peak>PEAK_LIMIT?PEAK_LIMIT/peak:1;
}

function writeSideInfo(channels,infos){
  const bw=new BitWriter();bw.write(0,9);bw.write(0,channels===1?5:3);
  for(let ch=0;ch<channels;ch++)bw.write(0,4);
  for(let gr=0;gr<2;gr++)for(let ch=0;ch<channels;ch++){
    const q=infos[gr][ch];
    bw.write(q.bits.length,12);bw.write(q.pairs,9);bw.write(q.gain,8);bw.write(0,4);bw.write(0,1);
    bw.write(5,5);bw.write(5,5);bw.write(5,5);bw.write(7,4);bw.write(7,3);
    bw.write(0,1);bw.write(0,1);bw.write(0,1);
  }
  return bw.finishToLength(channels===1?17:32);
}

function frameHeader(channels,padding,bitrateIndex,sampleRateIndex){
  const mode=channels===1?3:0;let v=0;
  v|=(0x7ff<<21);v|=(3<<19);v|=(1<<17);v|=(1<<16);v|=(bitrateIndex<<12);v|=(sampleRateIndex<<10);
  v|=((padding?1:0)<<9);v|=(mode<<6);v|=(1<<2);
  return new Uint8Array([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255]);
}

function concatChunks(chunks,total=chunks.reduce((s,c)=>s+c.length,0)){const out=new Uint8Array(total);let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return out;}

export class StreamingMp3Encoder {
  constructor({channels,bitrate=128,sampleRate=DEFAULT_SAMPLE_RATE,inputScale=1,onStats}={}){
    const preset=BITRATE_PRESETS[Number(bitrate)],sampleRateIndex=SAMPLE_RATE_INDEXES[Number(sampleRate)];
    if(!preset)throw new Error(`Native MP3 Encoder 不支援 ${bitrate} kbps`);
    if(sampleRateIndex===undefined)throw new Error(`Native MP3 Encoder 不支援 ${sampleRate} Hz`);
    if(channels!==1&&channels!==2)throw new Error("Native MP3 Encoder 僅支援 1 或 2 聲道");
    this.channels=channels;this.bitrate=Number(bitrate);this.sampleRate=Number(sampleRate);this.sampleRateIndex=sampleRateIndex;
    this.preset=preset;this.inputScale=Number.isFinite(inputScale)&&inputScale>0?inputScale:1;this.onStats=onStats;
    this.banks=Array.from({length:channels},()=>new AnalysisBank(this.inputScale));
    this.prev=Array.from({length:channels},()=>Array.from({length:18},()=>new Float64Array(32)));
    this.pending=Array.from({length:channels},()=>new Float32Array(0));this.pendingLength=0;this.padAcc=0;this.frameIndex=0;this.closed=false;
    const exact=144*preset.bps;this.baseFrameLength=Math.floor(exact/this.sampleRate);this.frameRemainder=exact-this.baseFrameLength*this.sampleRate;
  }
  _frame(block){
    this.padAcc+=this.frameRemainder;let padding=0;if(this.padAcc>=this.sampleRate){padding=1;this.padAcc-=this.sampleRate;}
    const frameLength=this.baseFrameLength+padding,sideLength=this.channels===1?17:32,mainCapacity=(frameLength-4-sideLength)*8;
    const spectra=Array.from({length:2},()=>Array(this.channels)),prepared=[];
    for(let gr=0;gr<2;gr++)for(let ch=0;ch<this.channels;ch++){
      const start=gr*SAMPLES_PER_GRANULE,cur=this.banks[ch].granule(block[ch],start),xr=transformGranule(cur,this.prev[ch]);this.prev[ch]=cur;
      const prep=prepareSpectrum(xr,this.preset.lowpassBands);spectra[gr][ch]=prep;prepared.push(prep);
    }
    const budgets=allocateBudgets(prepared,mainCapacity),infos=Array.from({length:2},()=>Array(this.channels)),mainBits=[];let unit=0,usedBits=0;
    for(let gr=0;gr<2;gr++)for(let ch=0;ch<this.channels;ch++){
      const q=quantizePrepared(spectra[gr][ch],budgets[unit++]);infos[gr][ch]=q;mainBits.push(...q.bits);usedBits+=q.usedBits;
    }
    if(mainBits.length>mainCapacity)throw new Error("Native MP3 main-data overflow");
    const side=writeSideInfo(this.channels,infos),main=new BitWriter();main.appendBits(mainBits);
    const body=main.finishToLength(frameLength-4-side.length),head=frameHeader(this.channels,padding,this.preset.index,this.sampleRateIndex),frame=concatChunks([head,side,body],frameLength);
    this.onStats?.({frame:this.frameIndex++,mainCapacity,usedBits,budgets:[...budgets],inputScale:this.inputScale,lowpassBands:this.preset.lowpassBands,bitrate:this.bitrate,sampleRate:this.sampleRate});
    return frame;
  }
  push(channels){
    if(this.closed)throw new Error("Streaming MP3 Encoder 已結束");
    if(!Array.isArray(channels)||channels.length!==this.channels||!channels.every(c=>c instanceof Float32Array))throw new Error("Streaming MP3 Encoder PCM 聲道格式不正確");
    const lengths=channels.map(c=>c.length);if(!lengths.every(n=>n===lengths[0]))throw new Error("Streaming MP3 Encoder 各聲道 PCM 長度必須一致");
    const length=lengths[0];if(length<=0)return[];
    let src=channels,srcLength=length;
    if(this.pendingLength){
      const merged=Array.from({length:this.channels},(_,ch)=>{const out=new Float32Array(this.pendingLength+length);out.set(this.pending[ch],0);out.set(channels[ch].subarray(0,length),this.pendingLength);return out});
      src=merged;srcLength=this.pendingLength+length;this.pendingLength=0;
    }
    const out=[];let pos=0;
    while(pos+SAMPLES_PER_FRAME<=srcLength){out.push(this._frame(src.map(c=>c.subarray(pos,pos+SAMPLES_PER_FRAME))));pos+=SAMPLES_PER_FRAME;}
    const remain=srcLength-pos;this.pendingLength=remain;
    this.pending=Array.from({length:this.channels},(_,ch)=>remain?new Float32Array(src[ch].subarray(pos,srcLength)):new Float32Array(0));
    return out;
  }
  flush(){
    if(this.closed)return[];this.closed=true;
    if(!this.pendingLength)return[];
    const block=Array.from({length:this.channels},(_,ch)=>{const out=new Float32Array(SAMPLES_PER_FRAME);out.set(this.pending[ch]);return out});
    this.pendingLength=0;this.pending=Array.from({length:this.channels},()=>new Float32Array(0));return[this._frame(block)];
  }
}

export function encodeMp3(channels,{bitrate=128,sampleRate=DEFAULT_SAMPLE_RATE,onProgress,onStats}={}){
  if(!Array.isArray(channels)||!channels.length||channels.length>2)throw new Error("Native MP3 Encoder 僅支援 1 或 2 聲道");
  if(!channels.every(c=>c instanceof Float32Array))throw new Error("Native MP3 Encoder 需要 Float32 PCM");
  const lengths=channels.map(c=>c.length);if(!lengths.every(n=>n===lengths[0]))throw new Error("Native MP3 Encoder 各聲道 PCM 長度必須一致");
  const n=lengths[0];if(!n)return new Uint8Array();
  const totalFrames=Math.ceil(n/SAMPLES_PER_FRAME),scale=peakScaleFor(channels),stream=new StreamingMp3Encoder({channels:channels.length,bitrate,sampleRate,inputScale:scale,onStats});
  const chunks=[];let total=0,done=0;
  const pushFrames=frames=>{for(const f of frames){chunks.push(f);total+=f.length;done++;if(onProgress&&(done%4===0||done===totalFrames))onProgress(Math.min(1,done/totalFrames));}};
  pushFrames(stream.push(channels.map(c=>c.subarray(0,n))));pushFrames(stream.flush());
  return concatChunks(chunks,total);
}

export const NATIVE_MP3_INFO=Object.freeze({
  name:"CHOPPER Native MP3 Core",coreVersion:"0.4.1",sampleRate:DEFAULT_SAMPLE_RATE,sampleRates:[32000,44100,48000],
  bitrates:Object.keys(BITRATE_PRESETS).map(Number),channels:[1,2],dependencies:0,wasm:false,
  streaming:true,adaptiveBitAllocation:true,minimumGainSearch:true,peakProtection:true,bitReservoir:false,shortBlocks:false
});
