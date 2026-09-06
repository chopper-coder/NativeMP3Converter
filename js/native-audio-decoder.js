const SUPPORTED_NATIVE_RATES=new Set([32000,44100,48000]);
function contextCtor(){return window.AudioContext||window.webkitAudioContext}
function offlineCtor(){return window.OfflineAudioContext||window.webkitOfflineAudioContext}
function abortError(){return new DOMException("使用者已停止","AbortError")}
function throwIfAborted(signal){if(signal?.aborted)throw abortError()}

export async function decodeAudioFile(file,{forceMono=false,signal}={}){
  const Ctx=contextCtor();if(!Ctx)throw new Error("此瀏覽器沒有 Web Audio 解碼能力");
  let ctx=null,abortHandler=null;
  try{
    throwIfAborted(signal);
    // 不預先指定 sampleRate，避免瀏覽器在 decode 階段把 48 kHz 來源先偷偷轉成 44.1 kHz。
    ctx=new Ctx();
    abortHandler=()=>{try{ctx?.close()}catch{}};signal?.addEventListener?.("abort",abortHandler,{once:true});
    if(ctx.state==="suspended")await ctx.resume().catch(()=>{});throwIfAborted(signal);
    const bytes=await file.arrayBuffer();throwIfAborted(signal);
    let decoded;try{decoded=await ctx.decodeAudioData(bytes.slice(0))}catch(err){if(signal?.aborted)throw abortError();throw new Error(`瀏覽器無法解碼此音檔格式：${file.name}`)}
    throwIfAborted(signal);
    const desired=forceMono?1:Math.min(2,Math.max(1,decoded.numberOfChannels));
    const targetRate=SUPPORTED_NATIVE_RATES.has(decoded.sampleRate)?decoded.sampleRate:44100;
    let rendered=decoded;
    if(decoded.sampleRate!==targetRate||decoded.numberOfChannels!==desired){
      const Offline=offlineCtor();if(!Offline)throw new Error(`此瀏覽器無法將來源音訊轉為 ${targetRate/1000} kHz PCM`);
      const length=Math.max(1,Math.ceil(decoded.duration*targetRate)),off=new Offline(desired,length,targetRate),src=off.createBufferSource();src.buffer=decoded;src.connect(off.destination);src.start(0);rendered=await off.startRendering();throwIfAborted(signal);
    }
    const channels=[];for(let ch=0;ch<desired;ch++)channels.push(new Float32Array(rendered.getChannelData(ch)));
    return{channels,duration:rendered.duration,sampleRate:targetRate,sourceSampleRate:decoded.sampleRate,sourceChannels:decoded.numberOfChannels,outputChannels:desired,resampled:decoded.sampleRate!==targetRate};
  }finally{if(abortHandler)signal?.removeEventListener?.("abort",abortHandler);try{await ctx?.close()}catch{}}
}
