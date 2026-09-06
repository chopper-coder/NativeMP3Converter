import assert from "node:assert/strict";
import fs from "node:fs";

class MockClassList{add(){} remove(){}}
class MockEl{
  constructor(id=""){this.id=id;this.hidden=false;this.disabled=false;this.value="";this.checked=false;this.textContent="";this.innerHTML="";this.title="";this.style={};this.dataset={};this.options=[];this.classList=new MockClassList();this.children=[];this.handlers=new Map();this.className="";}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn)}
  append(...x){this.children.push(...x)} appendChild(x){this.children.push(x);return x} remove(){} replaceChildren(...x){this.children=[...x]}
  querySelector(){return null} closest(){return this} setAttribute(){} removeAttribute(){} load(){} click(){}
  async emit(type,event={}){for(const fn of this.handlers.get(type)||[])await fn({preventDefault(){},target:this,...event})}
}
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
assert.match(html,/<option value="alongside">與來源音檔放在同一資料夾/,"alongside option must be selectable in HTML");
assert.match(html,/id="authorizeSourceBtn"/,"source authorization button missing");
const ids=[...new Set(html.match(/id="([^"]+)"/g)?.map(x=>x.slice(4,-1))||[])];
const map=new Map(ids.map(id=>[id,new MockEl(id)]));
map.get("mode").value="normal";map.get("bitrate").value="128";map.get("skipMp3").checked=true;map.get("outputMode").value="custom";map.get("preserveStructure").checked=true;map.get("conflictPolicy").value="skip";map.get("resumeMode").checked=true;map.get("autoSave").checked=true;map.get("statusFilter").value="all";
map.get("outputMode").options=["alongside","custom","workspace-results","zip"].map(value=>Object.assign(new MockEl(),{value,disabled:false}));
const document={querySelector(sel){return sel.startsWith("#")?map.get(sel.slice(1))||null:new MockEl()},createElement(){return new MockEl()},body:new MockEl("body")};
const sourceFile={name:"meeting.wav",size:12345,lastModified:987654,type:"audio/wav",slice(){return{async arrayBuffer(){return new ArrayBuffer(0)}}}};
const fileHandle={kind:"file",name:"meeting.wav",async getFile(){return sourceFile}};
const root={name:"MeetingAudio",kind:"directory",async getFileHandle(name){if(name!=="meeting.wav")throw Object.assign(new Error("not found"),{name:"NotFoundError"});return fileHandle},async *entries(){yield ["meeting.wav",fileHandle]},async queryPermission(){return"granted"},async requestPermission(){return"granted"},async resolve(){return null}};
const wrongRoot={name:"WrongFolder",kind:"directory",async getFileHandle(){throw Object.assign(new Error("not found"),{name:"NotFoundError"})},async queryPermission(){return"granted"},async requestPermission(){return"granted"},async resolve(){return null}};
const pickerCalls=[];
const windowObj={document,isSecureContext:true,addEventListener(){},removeEventListener(){},async showDirectoryPicker(opts){assert.ok(opts.id.length<=32);pickerCalls.push(opts);return pickerCalls.length===1?wrongRoot:root}};
Object.defineProperty(globalThis,"document",{value:document,configurable:true});Object.defineProperty(globalThis,"window",{value:windowObj,configurable:true});Object.defineProperty(globalThis,"navigator",{value:{userAgent:"Node same-folder UX",deviceMemory:8},configurable:true});Object.defineProperty(globalThis,"location",{value:{protocol:"https:"},configurable:true});globalThis.matchMedia=()=>({matches:false});globalThis.Audio=class{};
await import("../js/app.js?same-folder-test=1");
assert.equal(map.get("outputMode").options.find(x=>x.value==="alongside").disabled,false,"same-folder option should stay selectable before folder authorization");
await map.get("fileInput").emit("change",{target:{files:[sourceFile],value:""}});
assert.equal(map.get("authorizeSourceBtn").hidden,true,"authorization button only appears after choosing same-folder mode");
map.get("outputMode").value="alongside";
await map.get("outputMode").emit("change");
assert.equal(pickerCalls.length,1,"choosing same-folder mode should immediately request source-folder authorization");
assert.equal(pickerCalls[0].mode,"readwrite");
assert.equal(pickerCalls[0].id,"cmp3-v1-source");
assert.equal(map.get("outputMode").value,"alongside");
assert.equal(map.get("authorizeSourceBtn").hidden,false,"wrong folder must keep retry authorization button visible");
assert.match(map.get("statusText").textContent,/核對未通過/);
await map.get("authorizeSourceBtn").emit("click");
assert.equal(pickerCalls.length,2,"retry authorization should reopen the picker");
assert.equal(map.get("authorizeSourceBtn").hidden,true,"authorization button should hide after successful authorization");
assert.match(map.get("outputFolderState").textContent,/已授權：MeetingAudio/);
assert.match(map.get("sourceState").textContent,/已授權來源資料夾：MeetingAudio/);
assert.equal(map.get("openOutputLocationBtn").disabled,false,"location button should enable after source folder authorization");
console.log("PASS V1.0.4 same-folder UX: normal file import can select alongside, authorize source folder, verify current file, and enable direct output");
