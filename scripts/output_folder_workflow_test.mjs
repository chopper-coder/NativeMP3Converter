import assert from "node:assert/strict";
import fs from "node:fs";

class MockClassList{add(){} remove(){}}
class MockEl{
  constructor(id=""){this.id=id;this.hidden=false;this.disabled=false;this.value="";this.checked=false;this.textContent="";this.innerHTML="";this.title="";this.style={};this.dataset={};this.options=[];this.classList=new MockClassList();this.children=[];this.handlers=new Map();this.clickCount=0;this.className="";}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn)}
  append(...x){this.children.push(...x)} appendChild(x){this.children.push(x);return x} remove(){} replaceChildren(...x){this.children=[...x]}
  querySelector(){return null} closest(){return this} setAttribute(){} removeAttribute(){} load(){}
  async click(){this.clickCount++;for(const fn of this.handlers.get("click")||[])await fn({preventDefault(){},target:this})}
}
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const ids=[...new Set(html.match(/id="([^"]+)"/g)?.map(x=>x.slice(4,-1))||[])];
const map=new Map(ids.map(id=>[id,new MockEl(id)]));
map.get("mode").value="normal";map.get("bitrate").value="128";map.get("skipMp3").checked=true;map.get("outputMode").value="custom";map.get("preserveStructure").checked=true;map.get("conflictPolicy").value="skip";map.get("resumeMode").checked=true;map.get("autoSave").checked=true;map.get("statusFilter").value="all";
map.get("outputMode").options=["alongside","custom","workspace-results","zip"].map(value=>Object.assign(new MockEl(),{value,disabled:false}));
const document={querySelector(sel){return sel.startsWith("#")?map.get(sel.slice(1))||null:new MockEl()},createElement(){return new MockEl()},body:new MockEl("body")};
const root={name:"來源錄音",kind:"directory",async *entries(){},async queryPermission(){return"granted"},async requestPermission(){return"granted"},async resolve(){return null}};
const located={name:"來源錄音",kind:"directory"};
const pickerCalls=[];
const windowObj={document,isSecureContext:true,addEventListener(){},removeEventListener(){},async showDirectoryPicker(opts){assert.ok(typeof opts?.id==="string"&&opts.id.length<=32,`picker id must be <=32 chars: ${opts?.id}`);pickerCalls.push(opts);return pickerCalls.length===1?root:located}};
Object.defineProperty(globalThis,"document",{value:document,configurable:true});Object.defineProperty(globalThis,"window",{value:windowObj,configurable:true});Object.defineProperty(globalThis,"navigator",{value:{userAgent:"Node folder workflow",deviceMemory:8},configurable:true});Object.defineProperty(globalThis,"location",{value:{protocol:"http:"},configurable:true});globalThis.matchMedia=()=>({matches:false});globalThis.Audio=class{};
await import("../js/app.js");
await map.get("openWorkspaceBtn").click();
assert.equal(map.get("outputMode").value,"alongside","workspace should default to same-source output");
assert.equal(map.get("openOutputLocationBtn").disabled,false,"output-location button should enable for workspace direct output");
assert.match(map.get("outputFolderState").textContent,/直接存回各來源音檔所在資料夾/);
await map.get("openOutputLocationBtn").click();
assert.equal(pickerCalls.length,2);
assert.equal(pickerCalls[1].startIn,root,"location picker should start in current output workspace");
assert.equal(pickerCalls[1].mode,"read");
assert.equal(map.get("outputMode").value,"alongside","locating output must not change output mode");
assert.ok(map.get("retryFailedBtn"),"retry failed control missing");
assert.ok(map.get("cleanupSidecarsBtn"),"sidecar cleanup control missing");
assert.ok(map.get("outputResultsPanel"),"output results panel missing");
console.log("PASS NativeMP3Converter V1.0 output recovery workflow: workspace defaults alongside and locate button uses startIn without mutating output settings");
