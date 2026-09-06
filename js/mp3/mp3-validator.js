const BITRATES=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const SAMPLE_RATES=[44100,48000,32000,0];

function parseHeader(b0,b1,b2,b3){
  if(b0!==0xff||(b1&0xe0)!==0xe0)return null;
  const version=(b1>>>3)&3,layer=(b1>>>1)&3;
  if(version!==3||layer!==1)return null; // MPEG-1 Layer III only.
  const bitrateIndex=(b2>>>4)&15,srIndex=(b2>>>2)&3,padding=(b2>>>1)&1,bitrate=BITRATES[bitrateIndex],sampleRate=SAMPLE_RATES[srIndex];
  if(!bitrate||!sampleRate)return null;
  const mode=(b3>>>6)&3,channels=mode===3?1:2,frameLength=Math.floor(144*bitrate*1000/sampleRate)+padding;
  if(frameLength<24||frameLength>2000)return null;
  return{bitrate,sampleRate,channels,frameLength,bitrateIndex,srIndex,mode};
}

export async function validateMp3Structure(blob,{signal,onProgress,maxBytes=4*1024*1024*1024}={}){
  if(!(blob instanceof Blob)||blob.size<64)throw new Error("MP3 檔案太小");
  if(blob.size>maxBytes)throw new Error("MP3 超過結構驗證安全上限");
  const CHUNK=1024*1024;let filePos=0,carry=new Uint8Array(0),frames=0,totalFrameBytes=0,first=null,last=null;
  while(filePos<blob.size||carry.length){
    if(signal?.aborted)throw new DOMException("使用者已停止","AbortError");
    if(filePos<blob.size){
      const end=Math.min(blob.size,filePos+CHUNK),next=new Uint8Array(await blob.slice(filePos,end).arrayBuffer()),merged=new Uint8Array(carry.length+next.length);merged.set(carry);merged.set(next,carry.length);carry=merged;filePos=end;
    }
    let pos=0;
    while(pos+4<=carry.length){
      const h=parseHeader(carry[pos],carry[pos+1],carry[pos+2],carry[pos+3]);
      if(!h)throw new Error(`MP3 frame header 異常（位移 ${totalFrameBytes}）`);
      if(pos+h.frameLength>carry.length)break;
      if(!first)first=h;else if(h.sampleRate!==first.sampleRate||h.channels!==first.channels||h.bitrate!==first.bitrate)throw new Error("MP3 frame 參數不一致");
      last=h;pos+=h.frameLength;totalFrameBytes+=h.frameLength;frames++;
    }
    carry=carry.subarray(pos);
    onProgress?.(Math.min(1,totalFrameBytes/blob.size));
    if(filePos>=blob.size){if(carry.length)throw new Error("MP3 結尾存在不完整 frame");break}
  }
  if(!first||frames<1||totalFrameBytes!==blob.size)throw new Error("MP3 frame 結構驗證失敗");
  return{frames,bytes:totalFrameBytes,bitrate:first.bitrate,sampleRate:first.sampleRate,channels:first.channels,duration:frames*1152/first.sampleRate,lastFrame:last};
}

export function inspectMp3Bytes(bytes){
  if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes||0);let pos=0,frames=0,first=null;
  while(pos+4<=bytes.length){const h=parseHeader(bytes[pos],bytes[pos+1],bytes[pos+2],bytes[pos+3]);if(!h||pos+h.frameLength>bytes.length)return null;if(!first)first=h;else if(h.sampleRate!==first.sampleRate||h.channels!==first.channels||h.bitrate!==first.bitrate)return null;pos+=h.frameLength;frames++}
  if(pos!==bytes.length||!first)return null;return{frames,bytes:pos,bitrate:first.bitrate,sampleRate:first.sampleRate,channels:first.channels,duration:frames*1152/first.sampleRate};
}
