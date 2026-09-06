import assert from "node:assert/strict";

class MockClassList{add(){} remove(){}}
class MockEl{
  constructor(id=""){this.id=id;this.hidden=false;this.disabled=false;this.value="";this.checked=false;this.textContent="";this.innerHTML="";this.title="";this.style={};this.dataset={};this.options=[];this.classList=new MockClassList();this.children=[];this.handlers=new Map();this.clickCount=0;}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn)} append(...x){this.children.push(...x)} appendChild(x){this.children.push(x);return x} remove(){} replaceChildren(...x){this.children=[...x]} querySelector(){return null} closest(){return this} click(){this.clickCount++;for(const fn of this.handlers.get("click")||[])fn({preventDefault(){},target:this})} setAttribute(){} removeAttribute(){} load(){}
}
const ids=[...new Set((await import("node:fs")).readFileSync(new URL("../index.html",import.meta.url),"utf8").match(/id="([^"]+)"/g)?.map(x=>x.slice(4,-1))||[])];
const map=new Map(ids.map(id=>[id,new MockEl(id)]));
map.get("mode").value="normal";map.get("bitrate").value="128";map.get("skipMp3").checked=true;map.get("outputMode").value="zip";map.get("preserveStructure").checked=true;map.get("conflictPolicy").value="skip";map.get("resumeMode").checked=true;map.get("autoSave").checked=true;map.get("statusFilter").value="all";
map.get("outputMode").options=["alongside","custom","workspace-results","zip"].map(value=>Object.assign(new MockEl(),{value,disabled:false}));
const document={querySelector(sel){return sel.startsWith("#")?map.get(sel.slice(1))||null:new MockEl()},createElement(){return new MockEl()},body:new MockEl("body")};
const windowObj={document,isSecureContext:false,addEventListener(){},removeEventListener(){}};
Object.defineProperty(globalThis,"document",{value:document,configurable:true});Object.defineProperty(globalThis,"window",{value:windowObj,configurable:true});Object.defineProperty(globalThis,"navigator",{value:{userAgent:"Node DOM smoke",deviceMemory:8},configurable:true});Object.defineProperty(globalThis,"location",{value:{protocol:"http:"},configurable:true});globalThis.matchMedia=()=>({matches:false});globalThis.Audio=class{};
await import("../js/app.js");
assert.equal(windowObj.__AUDIO_MP3_APP_READY__,true);
assert.match(map.get("engineState").textContent,/Native MP3 Core v0\.4/);
assert.match(map.get("memoryPolicyState").textContent,/PCM 防當機門檻/);
assert.equal(map.get("pickFilesBtn").disabled,false);
assert.equal(map.get("pickFolderBtn").disabled,false);
const filesBefore=map.get("fileInput").clickCount,folderBefore=map.get("folderInput").clickCount;map.get("pickFilesBtn").click();map.get("pickFolderBtn").click();assert.equal(map.get("fileInput").clickCount,filesBefore+1);assert.equal(map.get("folderInput").clickCount,folderBefore+1);
assert.ok((map.get("openOutputLocationBtn").handlers.get("click")||[]).length>0,"open output location button handler missing");
console.log("PASS DOM boot smoke: app initialized and file/folder/output-location buttons dispatch correctly");
