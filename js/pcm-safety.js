const MB=1024*1024,GB=1024*MB;

export function estimatePcmWorkingSet({duration,sampleRate=44100,channels=2,sourceBytes=0}={}){
  if(!Number.isFinite(duration)||duration<=0)return null;
  const ch=Math.max(1,Math.min(2,Number(channels)||2));
  const pcm=duration*sampleRate*ch*4;
  // Web Audio may temporarily keep decoded/resampled buffers while JS owns a transferable PCM copy.
  // This is deliberately conservative; it is a crash-prevention estimate, not exact RAM accounting.
  return Math.ceil(pcm*2.0+Math.max(0,Number(sourceBytes)||0)*1.25+32*MB);
}

export function memoryPolicy({deviceMemoryGB=0,mobile=false,lowMemory=false}={}){
  const dm=Number(deviceMemoryGB)||0;
  let hard;
  if(dm>0)hard=Math.min(dm*GB*0.22,mobile||lowMemory?600*MB:1.6*GB);
  else hard=(mobile||lowMemory?500:1200)*MB;
  hard=Math.max(280*MB,hard);
  return{soft:Math.floor(hard*0.68),hard};
}
