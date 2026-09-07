import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Gsm610Decoder,unpackMsGsmBlock} from '../js/gsm610-decoder.js';
import {inspectWavFile,streamWavPcm} from '../js/wav-stream.js';
import {streamWavToMp3} from '../js/wav-mp3-streamer.js';
import {validateMp3Structure} from '../js/mp3/mp3-validator.js';

// Deterministic 65-byte MS-GSM block generated from a 440 Hz / 8 kHz mono tone.
// Expected PCM hash was independently obtained with FFmpeg/libgsm_ms during release testing.
const BLOCK=Uint8Array.from(Buffer.from('iN3hGoVC7xZAm9KKguYc22kkRwViQ/ovWYtHAvG/ZC2F2D3uUXgIxElrJ9HbBIbQnkKbtgaiuspqTkgFxnISW0k=','base64'));
const EXPECTED_PCM_SHA256='f681f10593eefd0995718f16073f9a0a17628e646ff5226c13450659d4274477';
function pcmBytes(samples){const b=Buffer.alloc(samples.length*2);for(let i=0;i<samples.length;i++)b.writeInt16LE(samples[i],i*2);return b}
const pair=unpackMsGsmBlock(BLOCK);assert.equal(pair.length,2);assert.equal(pair[0].subframes.length,4);assert.equal(pair[1].subframes.length,4);
const dec=new Gsm610Decoder(),pcm=dec.decodeMsBlock(BLOCK);
assert.equal(pcm.length,320);
assert.equal(crypto.createHash('sha256').update(pcmBytes(pcm)).digest('hex'),EXPECTED_PCM_SHA256,'GSM 6.10 PCM must be bit-exact to independent decoder fixture');

function ascii(v,o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))}
function makeGsmWav(block){
  const fmtSize=20,factSize=4,dataSize=block.length,total=12+(8+fmtSize)+(8+factSize)+(8+dataSize)+(dataSize&1),ab=new ArrayBuffer(total),v=new DataView(ab);let o=0;
  ascii(v,o,'RIFF');o+=4;v.setUint32(o,total-8,true);o+=4;ascii(v,o,'WAVE');o+=4;
  ascii(v,o,'fmt ');o+=4;v.setUint32(o,fmtSize,true);o+=4;v.setUint16(o,49,true);o+=2;v.setUint16(o,1,true);o+=2;v.setUint32(o,8000,true);o+=4;v.setUint32(o,1625,true);o+=4;v.setUint16(o,65,true);o+=2;v.setUint16(o,0,true);o+=2;v.setUint16(o,2,true);o+=2;v.setUint16(o,320,true);o+=2;
  ascii(v,o,'fact');o+=4;v.setUint32(o,4,true);o+=4;v.setUint32(o,320,true);o+=4;
  ascii(v,o,'data');o+=4;v.setUint32(o,dataSize,true);o+=4;new Uint8Array(ab,o,dataSize).set(block);o+=dataSize;if(dataSize&1)o++;
  return new Blob([ab],{type:'audio/wav'});
}
const wav=makeGsmWav(BLOCK),info=await inspectWavFile(wav);
assert.equal(info.streamable,true,info.reason||'');assert.equal(info.audioFormat,49);assert.equal(info.codecName,'GSM 6.10 / Microsoft WAV (format 49)');assert.equal(info.sampleRate,8000);assert.equal(info.blockAlign,65);assert.equal(info.samplesPerBlock,320);assert.equal(info.frames,320);assert.equal(info.targetSampleRate,32000);
let frames=0;const streamed=await streamWavPcm(wav,info,{onChunk:x=>{frames+=x[0].length}});assert.equal(streamed.sourceFrames,320);assert.equal(streamed.sampleRate,32000);assert.equal(frames,1280);
const mp3=await streamWavToMp3(wav,{bitrate:128,collect:true});const valid=await validateMp3Structure(mp3.blob);assert.equal(valid.sampleRate,32000);assert.equal(valid.bitrate,128);assert.equal(valid.channels,1);
console.log('PASS GSM 6.10 / WAVE format 49: 65-byte MS-GSM block, bit-exact PCM fixture, stream resample and MP3 output');
