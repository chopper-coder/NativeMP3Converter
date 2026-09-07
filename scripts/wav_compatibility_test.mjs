import assert from 'node:assert/strict';
import {inspectWavFile,streamWavPcm} from '../js/wav-stream.js';
import {streamWavToMp3} from '../js/wav-mp3-streamer.js';
import {validateMp3Structure} from '../js/mp3/mp3-validator.js';

function writeAscii(v,o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))}
function makeStandardWav({format=1,rate=8000,channels=1,bits=16,frames=1600,dataFactory}={}){
  const bps=bits/8,align=channels*bps,fmtSize=(format===6||format===7)?18:16,dataSize=frames*align,total=12+8+fmtSize+(fmtSize&1)+8+dataSize;
  const ab=new ArrayBuffer(total),v=new DataView(ab);writeAscii(v,0,'RIFF');v.setUint32(4,total-8,true);writeAscii(v,8,'WAVE');writeAscii(v,12,'fmt ');v.setUint32(16,fmtSize,true);v.setUint16(20,format,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*align,true);v.setUint16(32,align,true);v.setUint16(34,bits,true);if(fmtSize===18)v.setUint16(36,0,true);
  const dataChunk=12+8+fmtSize+(fmtSize&1);writeAscii(v,dataChunk,'data');v.setUint32(dataChunk+4,dataSize,true);let o=dataChunk+8;
  for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){
    if(format===1&&bits===16){const s=Math.round(Math.sin(2*Math.PI*440*i/rate)*10000);v.setInt16(o,s,true);o+=2}
    else if(format===6||format===7){v.setUint8(o++,dataFactory?dataFactory(i,ch):(format===7?(i%2?0xff:0x7f):(i%2?0xd5:0x55)))}
    else throw new Error('unsupported test builder format');
  }
  return new Blob([ab],{type:'audio/wav'});
}
function makeExtensiblePcm({rate=16000,channels=1,bits=16,frames=3200}={}){
  const align=channels*(bits/8),fmtSize=40,dataSize=frames*align,total=12+8+fmtSize+8+dataSize,ab=new ArrayBuffer(total),v=new DataView(ab);writeAscii(v,0,'RIFF');v.setUint32(4,total-8,true);writeAscii(v,8,'WAVE');writeAscii(v,12,'fmt ');v.setUint32(16,fmtSize,true);v.setUint16(20,0xfffe,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*align,true);v.setUint16(32,align,true);v.setUint16(34,bits,true);v.setUint16(36,22,true);v.setUint16(38,bits,true);v.setUint32(40,channels===1?4:3,true);
  // KSDATAFORMAT_SUBTYPE_PCM {00000001-0000-0010-8000-00AA00389B71}
  const guid=[1,0,0,0,0,0,0x10,0,0x80,0,0,0xaa,0,0x38,0x9b,0x71];guid.forEach((b,i)=>v.setUint8(44+i,b));
  const d=60;writeAscii(v,d,'data');v.setUint32(d+4,dataSize,true);let o=d+8;for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){v.setInt16(o,Math.round(Math.sin(2*Math.PI*600*i/rate)*9000),true);o+=2}
  return new Blob([ab],{type:'audio/wav'});
}

const cases=[
  ['PCM 8 kHz',makeStandardWav({format:1,rate:8000,bits:16}),1,8000],
  ['G.711 μ-law 8 kHz',makeStandardWav({format:7,rate:8000,bits:8}),7,8000],
  ['G.711 A-law 8 kHz',makeStandardWav({format:6,rate:8000,bits:8}),6,8000],
  ['WAVE_FORMAT_EXTENSIBLE PCM 16 kHz',makeExtensiblePcm({rate:16000}),1,16000],
];
for(const [name,wav,format,sourceRate] of cases){
  const info=await inspectWavFile(wav);assert.equal(info.streamable,true,`${name}: ${info.reason||''}`);assert.equal(info.audioFormat,format);assert.equal(info.sampleRate,sourceRate);assert.equal(info.targetSampleRate,32000);assert.equal(info.resampled,true);
  let pcmFrames=0;const streamedPcm=await streamWavPcm(wav,info,{onChunk:pcm=>{pcmFrames+=pcm[0].length}});assert.equal(streamedPcm.sampleRate,32000);assert.ok(pcmFrames>=Math.floor(info.duration*32000)-1&&pcmFrames<=Math.ceil(info.duration*32000)+1);
  const out=await streamWavToMp3(wav,{bitrate:128,collect:true});assert.equal(out.sampleRate,32000);assert.equal(out.sourceSampleRate,sourceRate);assert.equal(out.encoderStats.resampled,true);const mp3=await validateMp3Structure(out.blob);assert.equal(mp3.sampleRate,32000);assert.equal(mp3.bitrate,128);assert.equal(mp3.channels,1);
}
// Unsupported ADPCM should return an exact codec diagnostic instead of falling through silently.
{
  const wav=makeStandardWav({format:7,rate:8000,bits:8});const bytes=new Uint8Array(await wav.arrayBuffer());new DataView(bytes.buffer).setUint16(20,17,true);const r=await inspectWavFile(new Blob([bytes],{type:'audio/wav'}));assert.equal(r.streamable,false);assert.match(r.reason,/IMA ADPCM/);
}
console.log('PASS WAV compatibility: 8 kHz PCM, G.711 mu-law/A-law, extensible PCM, streaming resample to 32 kHz');
