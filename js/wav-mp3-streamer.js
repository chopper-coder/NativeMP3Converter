import {inspectWavFile,scanWavPeak,streamWavPcm} from "./wav-stream.js";
import {StreamingMp3Encoder} from "./mp3/native-mp3-encoder.js";

const PEAK_LIMIT=0.985;
function concat(frames){const total=frames.reduce((s,f)=>s+f.length,0),out=new Uint8Array(total);let p=0;for(const f of frames){out.set(f,p);p+=f.length}return out}

export async function streamWavToMp3(file,{bitrate=128,forceMono=false,signal,onProgress,onMp3Chunk,collect=false}={}){
  const info=await inspectWavFile(file,{signal});if(!info.streamable)throw new Error(info.reason||"此 WAV 不支援串流模式");
  let peak=0;peak=await scanWavPeak(file,info,{forceMono,signal,onProgress:p=>onProgress?.(p*.18,"scan")});
  const inputScale=peak>PEAK_LIMIT?PEAK_LIMIT/peak:1,channels=forceMono?1:info.channels;
  let used=0,capacity=0,frames=0,bytes=0;const chunks=[];
  const encoder=new StreamingMp3Encoder({channels,bitrate,sampleRate:info.sampleRate,inputScale,onStats:s=>{used+=s.usedBits;capacity+=s.mainCapacity;frames++;}});
  async function emit(frameList){if(!frameList.length)return;const chunk=concat(frameList);bytes+=chunk.length;if(collect)chunks.push(chunk);await onMp3Chunk?.(chunk)}
  await streamWavPcm(file,info,{forceMono,signal,onChunk:async pcm=>emit(encoder.push(pcm)),onProgress:p=>onProgress?.(.18+p*.82,"encode")});
  await emit(encoder.flush());onProgress?.(1,"done");
  const encoderStats={frames,mainDataUsage:capacity?used/capacity:0,inputScale,peakProtected:inputScale<0.999999,streaming:true,sourcePeak:peak};
  return{info,channels,sampleRate:info.sampleRate,duration:info.duration,outputBytes:bytes,encoderStats,blob:collect?new Blob(chunks,{type:"audio/mpeg"}):null};
}
