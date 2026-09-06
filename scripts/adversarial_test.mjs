import assert from "node:assert/strict";
import {inspectWavFile} from "../js/wav-stream.js";
import {encodeMp3,StreamingMp3Encoder} from "../js/mp3/native-mp3-encoder.js";
import {inspectMp3Bytes,validateMp3Structure} from "../js/mp3/mp3-validator.js";
import {safeZipPath,makeStoreZip} from "../js/zip-store.js";
import {csvEscape,sanitizeSegment,normalizeRelativePath} from "../js/path-utils.js";

function blob(bytes,type="application/octet-stream"){return new Blob([Uint8Array.from(bytes)],{type})}
function ascii(s){return [...s].map(c=>c.charCodeAt(0))}

// Malformed/truncated WAV headers must fail closed, not throw RangeError or become streamable.
for(const b of [[],ascii("RIFF"),[...ascii("RIFF"),0,0,0,0,...ascii("WAVE")]]){
  const r=await inspectWavFile(blob(b,"audio/wav"));assert.equal(r.streamable,false);
}
// fmt chunk declares absurd size that exceeds actual file.
{
  const b=[...ascii("RIFF"),40,0,0,0,...ascii("WAVE"),...ascii("fmt "),0xff,0xff,0xff,0x7f];
  const r=await inspectWavFile(blob(b,"audio/wav"));assert.equal(r.streamable,false);
}
// Fake RF64 is explicitly non-streaming instead of trusting 32-bit sizes.
{
  const b=[...ascii("RF64"),0xff,0xff,0xff,0xff,...ascii("WAVE")];
  const r=await inspectWavFile(blob(b,"audio/wav"));assert.equal(r.streamable,false);assert.match(r.reason,/RF64/);
}

// MP3 validator must reject junk, truncation and inconsistent frame parameters.
await assert.rejects(()=>validateMp3Structure(blob(new Array(128).fill(0))));
const pcm=new Float32Array(44100/5);for(let i=0;i<pcm.length;i++)pcm[i]=.2*Math.sin(2*Math.PI*440*i/44100);
const good=encodeMp3([pcm],{bitrate:128,sampleRate:44100});assert.ok(inspectMp3Bytes(good));
await assert.rejects(()=>validateMp3Structure(new Blob([good.subarray(0,good.length-1)],{type:"audio/mpeg"})));
const other=encodeMp3([pcm],{bitrate:192,sampleRate:44100}),mixed=new Uint8Array(good.length+other.length);mixed.set(good);mixed.set(other,good.length);assert.equal(inspectMp3Bytes(mixed),null);

// Channel mismatch must fail closed rather than silently truncate a channel.
assert.throws(()=>encodeMp3([new Float32Array(2000),new Float32Array(1999)],{bitrate:128}),/長度必須一致/);
const streaming=new StreamingMp3Encoder({channels:2,bitrate:128,sampleRate:44100});assert.throws(()=>streaming.push([new Float32Array(100),new Float32Array(99)]),/長度必須一致/);

// ZIP traversal / absolute path / Windows drive / duplicate case-insensitive output.
for(const name of ["../evil.mp3","A/../../evil.mp3","/root.mp3","C:/evil.mp3","./evil.mp3"])assert.throws(()=>safeZipPath(name));
await assert.rejects(()=>makeStoreZip([{name:"A/Test.mp3",blob:blob([1])},{name:"a/test.mp3",blob:blob([2])}]),/重複/);

// Spreadsheet injection and filename/path controls.
for(const v of ["=1+1"," +SUM(A1:A2)","\t-2+3","\r@cmd"])assert.equal(csvEscape(v).includes("'"),true);
assert.equal(sanitizeSegment("NUL"),"_NUL");assert.equal(/[\\:*?\"<>|\u0000-\u001f]/.test(sanitizeSegment('a<b>?c|d')),false);
assert.equal(normalizeRelativePath("../../safe/../x.wav").includes(".."),false);
const deep=Array.from({length:200},(_,i)=>`folder_${i}`).join("/")+"/x.wav";const capped=normalizeRelativePath(deep);assert.ok(capped.length<=2048);assert.ok(capped.split("/").length<=64);assert.match(capped,/__[0-9a-f]{8}$/);

console.log("PASS adversarial malformed WAV/MP3, channel mismatch, CSV and ZIP traversal regressions");

// Direct-output commit must roll back an existing file when the first final write fails.
{
  const {commitValidatedBlob}=await import("../js/safe-file-commit.js");
  class FakeHandle{
    constructor(dir,name){this.dir=dir;this.name=name}
    async getFile(){const b=this.dir.files.get(this.name);if(!b)throw Object.assign(new Error("not found"),{name:"NotFoundError"});return new File([b],this.name)}
    async createWritable(){
      const handle=this,parts=[];let aborted=false;
      return{async write(x){if(handle.dir.failName===handle.name&&handle.dir.failCount>0){handle.dir.failCount--;throw new Error("simulated write failure")}parts.push(x)},async close(){if(!aborted)handle.dir.files.set(handle.name,new Blob(parts))},async abort(){aborted=true}};
    }
  }
  class FakeDir{
    constructor(){this.files=new Map();this.failName=null;this.failCount=0}
    async getFileHandle(name,{create=false}={}){if(!this.files.has(name)&&!create)throw Object.assign(new Error("not found"),{name:"NotFoundError"});if(!this.files.has(name)&&create)this.files.set(name,new Blob([]));return new FakeHandle(this,name)}
    async removeEntry(name){if(!this.files.has(name))throw Object.assign(new Error("not found"),{name:"NotFoundError"});this.files.delete(name)}
  }
  const d=new FakeDir();d.files.set("a.mp3",new Blob(["OLD"]));const existing=await d.getFileHandle("a.mp3");d.failName="a.mp3";d.failCount=1;
  await assert.rejects(()=>commitValidatedBlob({dir:d,name:"a.mp3",existing},new Blob(["NEW"])),/simulated/);
  assert.equal(await (await (await d.getFileHandle("a.mp3")).getFile()).text(),"OLD");
  assert.equal([...d.files.keys()].some(x=>x.startsWith(".__chopper_mp3_backup__")),false);
  d.failCount=0;await commitValidatedBlob({dir:d,name:"a.mp3",existing:await d.getFileHandle("a.mp3")},new Blob(["NEW"]));assert.equal(await (await (await d.getFileHandle("a.mp3")).getFile()).text(),"NEW");
}
console.log("PASS safe direct-output commit rollback regression");
