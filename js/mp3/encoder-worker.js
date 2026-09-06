import { encodeMp3, NATIVE_MP3_INFO } from "./native-mp3-encoder.js";
self.onmessage=e=>{
  if(e.data?.type!=="encode")return;
  try{
    const channels=(e.data.channels||[]).map(x=>x instanceof Float32Array?x:new Float32Array(x));
    let used=0,capacity=0,frames=0,inputScale=1,lowpassBands=0,sampleRate=Number(e.data?.options?.sampleRate)||44100;
    const out=encodeMp3(channels,{
      bitrate:Number(e.data?.options?.bitrate)||128,
      sampleRate:Number(e.data?.options?.sampleRate)||44100,
      onProgress:p=>self.postMessage({type:"progress",progress:p}),
      onStats:s=>{used+=s.usedBits;capacity+=s.mainCapacity;frames++;inputScale=s.inputScale;lowpassBands=s.lowpassBands;sampleRate=s.sampleRate||sampleRate;}
    });
    const stats={frames,mainDataUsage:capacity?used/capacity:0,inputScale,peakProtected:inputScale<0.999999,lowpassBands,sampleRate};
    self.postMessage({type:"done",buffer:out.buffer,info:{...NATIVE_MP3_INFO,stats}},[out.buffer]);
  }catch(err){self.postMessage({type:"error",message:String(err?.message||err),stack:String(err?.stack||"")});}
};
