import { decodeAudioFile } from "./native-audio-decoder.js";
import { makeStoreZip } from "./zip-store.js";
import { clearOutputs,cleanupExpiredOutputs,putOutput,getOutput,getOutputRecord,deleteOutput,outputStoreStatus,storageEstimate } from "./output-store.js";
import { recoveryKey,putRecovery,getRecovery,clearRecovery,cleanupExpiredRecovery } from "./recovery-store.js";
import { putHandle,getHandle,clearHandles,queryRW,requestRW } from "./handle-store.js";
import { fileFingerprint,isStrongFingerprint } from "./fingerprint.js";
import { estimatePcmWorkingSet, memoryPolicy } from "./pcm-safety.js";
import { sanitizeSegment,safeBase,normalizeRelativePath,dirname,joinPath,isMp3,extOf,csvEscape,hasPathSegment,isPathInside } from "./path-utils.js";
import { inspectWavFile } from "./wav-stream.js";
import { PART_PREFIX,BACKUP_PREFIX,partFileName,commitValidatedBlob } from "./safe-file-commit.js";
import { streamWavToMp3 } from "./wav-mp3-streamer.js";
import { validateMp3Structure } from "./mp3/mp3-validator.js";

const $=s=>document.querySelector(s);
const els={
  fileInput:$("#fileInput"),folderInput:$("#folderInput"),pickFiles:$("#pickFilesBtn"),pickFolder:$("#pickFolderBtn"),openWorkspace:$("#openWorkspaceBtn"),dropZone:$("#dropZone"),
  fileList:$("#fileList"),empty:$("#emptyState"),mode:$("#mode"),bitrate:$("#bitrate"),skipMp3:$("#skipMp3"),
  outputMode:$("#outputMode"),chooseOutput:$("#chooseOutputBtn"),openOutputLocation:$("#openOutputLocationBtn"),restoreFolders:$("#restoreFoldersBtn"),forgetFolders:$("#forgetFoldersBtn"),outputFolderState:$("#outputFolderState"),preserveStructure:$("#preserveStructure"),conflictPolicy:$("#conflictPolicy"),resumeMode:$("#resumeMode"),autoSave:$("#autoSave"),qualityHint:$("#qualityHint"),
  convert:$("#convertBtn"),cancel:$("#cancelBtn"),stopScan:$("#stopScanBtn"),clear:$("#clearBtn"),zip:$("#zipBtn"),csv:$("#csvBtn"),json:$("#jsonBtn"),clearRecovery:$("#clearRecoveryBtn"),retryFailed:$("#retryFailedBtn"),cleanupSidecars:$("#cleanupSidecarsBtn"),outputResultsPanel:$("#outputResultsPanel"),outputResultsSummary:$("#outputResultsSummary"),outputResultsList:$("#outputResultsList"),status:$("#statusText"),sourceState:$("#sourceState"),scanSummary:$("#scanSummary"),
  listTools:$("#listTools"),search:$("#searchInput"),statusFilter:$("#statusFilter"),filterCount:$("#filterCount"),
  overallWrap:$("#overallWrap"),overallText:$("#overallText"),overallPercent:$("#overallPercent"),overallBar:$("#overallBar"),engine:$("#engineState"),offline:$("#offlineState"),storage:$("#storageState"),memoryState:$("#memoryPolicyState"),updateApp:$("#updateAppBtn"),log:$("#log")
};

const MB=1024*1024,GB=1024*MB,MAX_NONSTREAM_FILE=250*MB,MAX_STREAM_WAV=16*GB,MAX_FILES=10000,RESULT_FOLDER="MP3_轉換結果",RENDER_LIMIT=300;
const mobileLike=matchMedia("(max-width:760px)").matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const lowMemory=Number.isFinite(navigator.deviceMemory)&&navigator.deviceMemory<=4;
const SOFT_FILE=(mobileLike||lowMemory?60:120)*MB;
const MEMORY_POLICY=memoryPolicy({deviceMemoryGB:navigator.deviceMemory||0,mobile:mobileLike,lowMemory});
const ZIP_AUTO_SOFT=(mobileLike||lowMemory?350:900)*MB;
const ZIP_MANUAL_WARN=(mobileLike||lowMemory?500:1200)*MB;
const SUPPORTED=new Set(["m4a","aac","wav","flac","ogg","oga","opus","webm","mp3","aif","aiff","amr"]);

let items=[],busy=false,analyzing=false,cancelRequested=false,currentItem=null,currentProcessedCount=0,currentTotalCount=0,uid=1;
let activeEncodeTask=null,activeAbortController=null;
let workspaceRootHandle=null,customOutputHandle=null,workspaceName="",sourceMode="files",scanIgnored=0,scanMp3=0;
let sessionRecords=[],scanning=false,scanCancelRequested=false,excludedCustomPath="",batchTargets=[],permissionPaused=false;
const storageReady=Promise.allSettled([cleanupExpiredOutputs(),cleanupExpiredRecovery()]).then(results=>{for(const r of results)if(r.status==="rejected")appendLog(`續作清理警告：${r.reason?.message||r.reason}`)});

function fmtBytes(n){if(!Number.isFinite(n))return"—";const u=["B","KB","MB","GB","TB"];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return`${v.toFixed(i?1:0)} ${u[i]}`}
function fmtDuration(sec){if(!Number.isFinite(sec)||sec<=0)return"—";sec=Math.round(sec);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function setStatus(t){els.status.textContent=t}
function appendLog(t){const lines=(els.log.textContent+t+"\n").split("\n");els.log.textContent=lines.slice(-220).join("\n");els.log.scrollTop=els.log.scrollHeight}
function downloadBlob(blob,name){const a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
function releaseURLs(item){if(item.inputURL)URL.revokeObjectURL(item.inputURL);if(item.outputURL)URL.revokeObjectURL(item.outputURL);item.inputURL=item.outputURL=null}
function releaseItem(item){releaseURLs(item)}
function isSupported(file){return SUPPORTED.has(extOf(file.name))||String(file.type||"").startsWith("audio/")}
function fileSizeLimit(file){return extOf(file.name)==="wav"?MAX_STREAM_WAV:MAX_NONSTREAM_FILE}
function initialMessage(file){const limit=fileSizeLimit(file);if(file.size>limit)return`檔案超過此模式 ${fmtBytes(limit)} 安全上限`;if(isMp3(file.name))return"此檔案已是 MP3；依目前設定會略過再次轉碼";if(extOf(file.name)==="wav"&&file.size>MAX_NONSTREAM_FILE)return`大型 WAV：若格式符合條件將使用真正串流模式（${fmtBytes(file.size)}）`;if(file.size>SOFT_FILE)return`大型檔案提醒：${fmtBytes(file.size)}，建議關閉其他分頁後再轉換`;return"等待轉換"}
function settingsSnapshot(){return{encoder:"chopper-native-mp3-core-0.4.1",mode:els.mode.value,bitrate:Number(els.bitrate.value)||128,channels:els.mode.value==="mono"?1:null,sampleRate:"auto",metadata:false}}
function settingsKey(s=settingsSnapshot()){return JSON.stringify(s)}
function outputLabel(s=settingsSnapshot()){const ch=s.actualChannels||s.channels,rate=Number(s.actualSampleRate)||Number(s.sampleRate)||44100;return`Native MP3｜${s.bitrate||128} kbps｜${ch===1?"Mono":ch===2?"Stereo":"保持來源聲道（最多 2）"}｜${(rate/1000).toFixed(rate%1000?1:0)} kHz${s.streaming?"｜Streaming":""}`}
function updateQualityHint(){const q={64:"語音省空間；較窄頻寬",96:"語音清晰；容量與清晰度平衡",128:"一般錄音與日常使用建議",192:"較高 bit budget，適合較複雜聲音",256:"保留更多頻譜資訊；檔案較大",320:"最高位元率；Native v0.4.1 會實際使用更多 main-data bits"};els.qualityHint.textContent=`${els.bitrate.value} kbps｜${q[Number(els.bitrate.value)]||"自訂音質"}`;renderMemoryPolicy()}
function outputChannelGuess(){return els.mode.value==="mono"?1:2}
function updateItemMemoryEstimate(item){if(item.streamInfo?.streamable){item.memoryEstimate=Math.min(96*MB,Math.max(32*MB,item.streamInfo.blockAlign*1152*256));return item.memoryEstimate}item.memoryEstimate=estimatePcmWorkingSet({duration:item.duration,sampleRate:44100,channels:outputChannelGuess(),sourceBytes:item.file.size});return item.memoryEstimate}
function renderMemoryPolicy(){if(!els.memoryState)return;els.memoryState.textContent=`🧠 壓縮格式 PCM 防當機門檻：提醒約 ${fmtBytes(MEMORY_POLICY.soft)}｜阻止約 ${fmtBytes(MEMORY_POLICY.hard)}；相容 PCM WAV 使用低記憶體雙通道串流`;for(const item of items)if(item.duration)updateItemMemoryEstimate(item)}
function memoryRisk(item){if(item.streamInfo?.streamable)return"ok";const bytes=updateItemMemoryEstimate(item);if(!bytes)return"unknown";return bytes>MEMORY_POLICY.hard?"hard":bytes>MEMORY_POLICY.soft?"soft":"ok"}
async function ensureDurationForMemory(item){if(extOf(item.file.name)==="wav"&&!item.streamInfo){item.streamInfo=await inspectWavFile(item.file,{signal:activeAbortController?.signal}).catch(()=>null);if(item.streamInfo?.streamable){item.duration=item.streamInfo.duration;item.streamCapable=true}}if(!item.duration)item.duration=await probeMediaDuration(item.file,1800);if(item.duration)updateItemMemoryEstimate(item);return item.duration}
function assessBatchMemory(targets){const hard=[],soft=[];for(const item of targets){if(!item.duration)continue;const risk=memoryRisk(item);if(risk==="hard")hard.push(item);else if(risk==="soft")soft.push(item)}return{hard,soft}}
function sourceRelativeForFile(file,folderMode=false){const raw=folderMode?String(file.webkitRelativePath||file.name):file.name;if(!folderMode)return normalizeRelativePath(file.name);const parts=raw.replace(/\\/g,"/").split("/").filter(Boolean);return normalizeRelativePath(parts.length>1?parts.slice(1).join("/"):file.name)}
function sourceRootNameFromFiles(list){for(const f of list){const p=String(f.webkitRelativePath||"").replace(/\\/g,"/").split("/").filter(Boolean);if(p.length>1)return sanitizeSegment(p[0],"資料夾")}return"匯入資料夾"}
function newItem(file,{relativePath=null,sourceDirHandle=null,sourceKind="files"}={}){const hard=file.size>fileSizeLimit(file),large=!hard&&file.size>SOFT_FILE;return{id:uid++,file,relativePath:normalizeRelativePath(relativePath||file.name),sourceDirHandle,sourceKind,status:hard?"error":"ready",message:initialMessage(file),progress:0,inputURL:null,outputURL:null,outputSize:0,outputName:null,outputRelative:null,outputHandle:null,outputStorage:null,outputCacheKey:null,outputDirHandle:null,largeWarning:large,conversionSettings:null,duration:null,outputDuration:null,fingerprint:null,validation:null,safetyRenamed:false,memoryEstimate:null,encoderStats:null,streamInfo:null,streamCapable:false,memorySoftApproved:false}}
function resetSessionOutput(){sessionRecords=[];els.csv.disabled=true;els.json.disabled=true}
function isExcludedRelative(rel){return hasPathSegment(rel,RESULT_FOLDER)||(excludedCustomPath&&isPathInside(rel,excludedCustomPath))}
function setScanning(value){scanning=value;els.stopScan.hidden=!value;updateButtons()}
function stopScanning(){if(!scanning)return;scanCancelRequested=true;setStatus("正在停止資料夾掃描…")}
function sleep0(){return new Promise(r=>setTimeout(r,0))}

async function addFiles(list,{folderMode=false,replace=false}={}){
  if(busy||scanning)return;
  if(replace){clearQueueOnly();scanIgnored=0;scanMp3=0;}
  let added=0,ignored=0,mp3=0;
  if(folderMode){sourceMode="folder-input";workspaceRootHandle=null;workspaceName=sourceRootNameFromFiles(list)}else if(sourceMode!=="workspace"){sourceMode="files";workspaceRootHandle=null;workspaceName=""}
  scanCancelRequested=false;setScanning(folderMode);
  try{
    const all=Array.from(list||[]);
    const rootIsOutput=folderMode&&workspaceName.toLocaleLowerCase()===RESULT_FOLDER.toLocaleLowerCase();
    for(let idx=0;idx<all.length;idx++){
      if(scanCancelRequested)break;
      const file=all[idx];
      if(items.length>=MAX_FILES){ignored+=all.length-idx;break}
      if(!isSupported(file)||String(file.name).startsWith(PART_PREFIX)||String(file.name).startsWith(BACKUP_PREFIX)){ignored++;continue}
      const rel=sourceRelativeForFile(file,folderMode);
      if(rootIsOutput||(folderMode&&isExcludedRelative(rel))){ignored++;continue}
      if(folderMode){if(items.some(x=>x.relativePath===rel&&x.file.size===file.size&&x.file.lastModified===file.lastModified))continue}
      else{
        const maybe=items.find(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified);
        if(maybe){try{const [a,b]=await Promise.all([ensureFingerprint(maybe),fileFingerprint(file)]);if(isStrongFingerprint(a)&&isStrongFingerprint(b)&&a===b)continue}catch{}}
      }
      if(isMp3(file.name))mp3++;
      items.push(newItem(file,{relativePath:rel,sourceKind:folderMode?"folder-input":"files"}));added++;
      if(folderMode&&idx%200===0){setStatus(`正在整理資料夾… 已加入 ${added} 個可處理檔案`);await sleep0()}
    }
    scanIgnored+=ignored;scanMp3+=mp3;updateSourceCapabilities();updateScanSummary();render();
    const capped=items.length>=MAX_FILES;setStatus(scanCancelRequested?`掃描已停止；目前保留 ${added} 個已找到檔案。`:capped?`已達安全上限 ${MAX_FILES} 個檔案；其餘檔案未加入，避免瀏覽器資源耗盡。`:`已加入 ${added} 個檔案${ignored?`，略過 ${ignored} 個不支援或輸出資料夾內檔案`:""}。`);
  } finally {setScanning(false)}
}
function clearQueueOnly(){for(const i of items)releaseItem(i);items=[];batchTargets=[];els.overallWrap.hidden=true;resetSessionOutput()}
function statusIcon(item){if(item.status==="done")return"✅";if(item.status==="error")return"⚠️";if(item.status==="cancelled")return"⏹️";if(item.status==="skipped")return"⏭️";if(item.largeWarning)return"🟠";return"🎧"}
function outputModeIsDirect(){return["workspace-results","alongside","custom"].includes(els.outputMode.value)}
function canDirectWrite(){return typeof window.showDirectoryPicker==="function"&&window.isSecureContext}
function refreshOutputDestinationState(){
  if(!els.outputFolderState)return;
  let text="",kind="";
  if(els.outputMode.value==="alongside"){
    if(workspaceRootHandle){text=`✅ MP3 會直接存回各來源音檔所在資料夾｜工作資料夾：${workspaceName}`;kind="ready"}
    else{text="⚠️ 要直接存回來源旁邊，請使用「📂 開啟工作資料夾」取得來源資料夾讀寫權限。";kind="warn"}
  }else if(els.outputMode.value==="workspace-results"){
    if(workspaceRootHandle){text=`✅ MP3 會輸出到：${workspaceName}/${RESULT_FOLDER}`;kind="ready"}
    else{text="⚠️ 尚未開啟可寫入的工作資料夾。";kind="warn"}
  }else if(els.outputMode.value==="custom"){
    if(customOutputHandle){text=`✅ 自訂輸出資料夾：${customOutputHandle.name}${els.preserveStructure.checked?"｜保留原始子資料夾結構":"｜集中輸出"}`;kind="ready"}
    else{text="📁 尚未選擇輸出資料夾；開始轉換時也會提示選擇。";kind="warn"}
  }else{text="⬇️ 使用瀏覽器下載：單檔直接下載 MP3，多檔在安全容量內下載 ZIP。"}
  els.outputFolderState.textContent=text;els.outputFolderState.className=`output-destination-state${kind?` ${kind}`:""}`;
}
function hasLocatableOutput(){
  if(!canDirectWrite())return false;
  if(els.outputMode.value==="custom")return !!customOutputHandle;
  if(els.outputMode.value==="workspace-results"||els.outputMode.value==="alongside")return !!workspaceRootHandle;
  return false;
}
function updateSourceCapabilities(){
  const workspace=!!workspaceRootHandle;
  for(const opt of els.outputMode.options){if(opt.value==="workspace-results"||opt.value==="alongside")opt.disabled=!workspace}
  if((els.outputMode.value==="workspace-results"||els.outputMode.value==="alongside")&&!workspace)els.outputMode.value=canDirectWrite()?"custom":"zip";
  els.chooseOutput.hidden=els.outputMode.value!=="custom";els.preserveStructure.disabled=busy||els.outputMode.value==="alongside";
  if(sourceMode==="workspace")els.sourceState.textContent=`📂 工作資料夾：${workspaceName}｜可直接存回原音檔旁邊，或改選其他輸出資料夾`;
  else if(sourceMode==="folder-input")els.sourceState.textContent=`📁 匯入資料夾：${workspaceName}｜來源僅讀；可另選輸出資料夾。若要寫回原處，請改用「開啟工作資料夾」`;
  else els.sourceState.textContent="🎵 一般檔案模式｜來源位置不會暴露給網頁；可另選輸出資料夾或使用瀏覽器下載";
  if(!canDirectWrite()){
    els.openWorkspace.disabled=true;els.openWorkspace.title="此瀏覽器不支援直接讀寫資料夾；請使用『匯入資料夾』＋瀏覽器下載";
    for(const opt of els.outputMode.options)if(opt.value==="custom")opt.disabled=true;
    if(els.outputMode.value==="custom")els.outputMode.value="zip";
  }else{for(const opt of els.outputMode.options)if(opt.value==="custom")opt.disabled=false}
  refreshOutputDestinationState();
  if(els.openOutputLocation)els.openOutputLocation.disabled=busy||analyzing||scanning||!hasLocatableOutput();
}
function updateScanSummary(){
  if(!items.length){els.scanSummary.hidden=true;els.listTools.hidden=true;els.scanSummary.replaceChildren();return}
  const total=items.reduce((sum,x)=>sum+x.file.size,0),hard=items.filter(x=>x.file.size>fileSizeLimit(x.file)).length,large=items.filter(x=>x.largeWarning).length,mp3=items.filter(x=>isMp3(x.file.name)).length;
  const known=items.filter(x=>Number.isFinite(x.duration)&&x.duration>0),duration=known.reduce((sum,x)=>sum+x.duration,0);for(const x of known)updateItemMemoryEstimate(x);
  const memHard=known.filter(x=>!x.streamInfo?.streamable&&x.memoryEstimate>MEMORY_POLICY.hard).length,memSoft=known.filter(x=>!x.streamInfo?.streamable&&x.memoryEstimate>MEMORY_POLICY.soft&&x.memoryEstimate<=MEMORY_POLICY.hard).length,streaming=items.filter(x=>x.streamInfo?.streamable).length;
  els.scanSummary.hidden=false;els.listTools.hidden=false;els.scanSummary.replaceChildren();
  const title=document.createElement("strong");title.textContent="掃描摘要";els.scanSummary.append(title);
  const grid=document.createElement("div");grid.className="summary-grid";
  for(const [value,label] of [[items.length,"可處理檔案"],[fmtBytes(total),"來源總容量"],[mp3,"已是 MP3"],[scanIgnored,"已略過"]]){const box=document.createElement("div");box.className="summary-kpi";const strong=document.createElement("strong");strong.textContent=String(value);const span=document.createElement("span");span.textContent=label;box.append(strong,span);grid.append(box)}
  els.scanSummary.append(grid);
  if(known.length){const note=document.createElement("div");note.className="small-state";note.textContent=`⏱️ 已知 ${known.length}/${items.length} 個檔案長度，合計 ${fmtDuration(duration)}。${streaming?` ✅ ${streaming} 個 WAV 可用低記憶體串流。`:""}${memHard?` ⚠️ ${memHard} 個壓縮格式預估 PCM 超過安全門檻。`:""}${memSoft?` 🟠 ${memSoft} 個接近記憶體門檻。`:""}`;els.scanSummary.append(note)}
  if(hard||large){const note=document.createElement("div");note.className="small-state";note.textContent=`${hard?`⚠️ ${hard} 個檔案超過各自模式安全上限；`:""}${large?`🟠 ${large} 個大型檔案會在開始前檢查是否可串流。`:""}`;els.scanSummary.append(note)}
}

async function getItemBlob(item){if(item.outputHandle){try{return await item.outputHandle.getFile()}catch{}}if(item.outputCacheKey)return await getOutput(item.outputCacheKey);return null}
async function previewOriginal(item,button){try{button.disabled=true;if(!item.inputURL)item.inputURL=URL.createObjectURL(item.file);const audio=new Audio(item.inputURL);audio.controls=true;await audio.play().catch(()=>{});const wrap=button.closest(".file-card");let old=wrap.querySelector("audio.preview-player");if(old)old.remove();audio.className="preview-player";wrap.insertBefore(audio,wrap.querySelector(".file-actions"));button.textContent="▶️ 原檔已載入"}catch(err){setStatus(`試聽失敗：${err?.message||err}`)}finally{button.disabled=false}}
async function previewOutput(item,button){try{button.disabled=true;const blob=await getItemBlob(item);if(!blob)throw new Error("找不到轉換結果，請重新轉換");if(item.outputURL)URL.revokeObjectURL(item.outputURL);item.outputURL=URL.createObjectURL(blob);const audio=new Audio(item.outputURL);audio.controls=true;const wrap=button.closest(".file-card");let old=wrap.querySelector("audio.preview-player");if(old)old.remove();audio.className="preview-player";wrap.insertBefore(audio,wrap.querySelector(".file-actions"));await audio.play().catch(()=>{});button.textContent="▶️ MP3 已載入"}catch(err){setStatus(`試聽失敗：${err?.message||err}`)}finally{button.disabled=false}}
async function downloadItem(item,button){try{button.disabled=true;const blob=await getItemBlob(item);if(!blob)throw new Error("找不到轉換結果，請重新轉換");downloadBlob(blob,item.outputName||`${safeBase(item.file.name)}.mp3`)}catch(err){setStatus(`下載失敗：${err?.message||err}`)}finally{button.disabled=false}}
function visibleItems(){
  const q=els.search.value.trim().toLocaleLowerCase(),f=els.statusFilter.value;
  return items.filter(item=>{
    if(q&&!`${item.file.name} ${item.relativePath}`.toLocaleLowerCase().includes(q))return false;
    if(f==="all")return true;if(f==="problem")return item.status==="error"||item.status==="cancelled";return item.status===f;
  });
}
function estimatedMp3Size(item){if(!Number.isFinite(item.duration)||item.duration<=0)return null;const br=item.conversionSettings?.bitrate||settingsSnapshot().bitrate;return Math.round(item.duration*br*1000/8)}
function outputResultItems(){return items.filter(x=>["done","skipped","error","cancelled"].includes(x.status))}
async function locateItemOutput(item){
  if(!canDirectWrite()){setStatus("目前瀏覽器無法定位資料夾；請從瀏覽器下載清單查看檔案。");return}
  const startIn=item.outputStorage==="direct"?(item.outputDirHandle||item.sourceDirHandle||await outputBrowseHandle()):null;
  if(!startIn){setStatus("此檔案不是直接資料夾輸出，沒有可定位的系統資料夾。");return}
  try{const chosen=await window.showDirectoryPicker({mode:"read",startIn,id:"chopper-native-mp3-v1-locate-item"});setStatus(`已開啟 ${item.outputName||item.file.name} 的輸出位置定位視窗：${chosen.name}`)}catch(err){if(err?.name!=="AbortError")setStatus(`定位輸出位置失敗：${err?.message||err}`)}
}
function renderOutputResults(){
  if(!els.outputResultsPanel)return;const rows=outputResultItems(),ok=rows.filter(x=>x.status==="done").length,skip=rows.filter(x=>x.status==="skipped").length,fail=rows.filter(x=>x.status==="error"||x.status==="cancelled").length;
  els.outputResultsPanel.hidden=rows.length===0;els.outputResultsSummary.textContent=rows.length?`成功 ${ok}｜略過 ${skip}｜失敗／停止 ${fail}`:"尚無輸出結果。";els.outputResultsList.replaceChildren();
  for(const item of rows.slice(-200)){
    const row=document.createElement("div");row.className=`output-result-row ${item.status}`;
    const main=document.createElement("div");main.className="output-result-main";const n=document.createElement("strong");n.textContent=item.outputName||item.file.name;const p=document.createElement("span");p.textContent=item.outputRelative||item.relativePath;const m=document.createElement("small");m.textContent=`${statusIcon(item)} ${item.message}${item.outputSize?`｜${fmtBytes(item.outputSize)}`:""}`;main.append(n,p,m);row.append(main);
    const act=document.createElement("div");act.className="output-result-actions";
    if(item.status==="done"){const dl=document.createElement("button");dl.className="mini";dl.type="button";dl.textContent="⬇️ 下載";dl.addEventListener("click",()=>downloadItem(item,dl));act.append(dl);if(item.outputStorage==="direct"){const loc=document.createElement("button");loc.className="mini";loc.type="button";loc.textContent="📂 定位";loc.addEventListener("click",()=>locateItemOutput(item));act.append(loc)}}
    row.append(act);els.outputResultsList.append(row);
  }
  if(els.retryFailed)els.retryFailed.disabled=busy||analyzing||scanning||!items.some(x=>x.status==="error"||x.status==="cancelled");
  if(els.cleanupSidecars)els.cleanupSidecars.disabled=busy||analyzing||scanning||!workspaceRootHandle;
}
async function retryFailedItems(){if(busy||analyzing||scanning)return;let n=0;for(const item of items){if(item.status!=="error"&&item.status!=="cancelled")continue;item.status="ready";item.progress=0;item.message="等待重新轉換";item.validation=null;item.encoderStats=null;n++}permissionPaused=false;render();setStatus(n?`已將 ${n} 個失敗／停止檔案重新加入待轉換。請按「開始轉 MP3」。`:`沒有失敗檔案需要重試。`)}
async function cleanupSidecars(){
  if(!workspaceRootHandle)return;const prefixes=[PART_PREFIX,BACKUP_PREFIX];let removed=0,failed=0,visited=0;
  async function walk(dir,depth=0){if(depth>64)return;for await(const [name,h] of dir.entries()){if(++visited>20000)throw new Error("掃描筆數超過安全上限 20,000");if(h.kind==="directory"){await walk(h,depth+1);continue}if(prefixes.some(p=>name.startsWith(p))){try{await dir.removeEntry(name);removed++}catch{failed++}}}}
  if(!window.confirm("只會刪除本工具專用前綴的 .part/.bak 暫存檔，不會刪除正式 MP3 或來源音檔。要開始清理嗎？"))return;
  try{await walk(workspaceRootHandle);setStatus(`暫存清理完成：移除 ${removed} 個${failed?`，${failed} 個無法刪除`:""}。`)}catch(err){setStatus(`清理暫存失敗：${err?.message||err}`)}
}
function render(){
  els.empty.hidden=items.length>0;els.fileList.replaceChildren();const filtered=visibleItems(),shown=filtered.slice(0,RENDER_LIMIT);els.filterCount.textContent=items.length?`顯示 ${Math.min(filtered.length,RENDER_LIMIT)} / ${filtered.length}（全部 ${items.length}）`:"";
  for(const item of shown){
    const card=document.createElement("article");card.className=`file-card ${item.status}${item.largeWarning?" large":""}`;card.dataset.id=item.id;
    const top=document.createElement("div");top.className="file-top";const icon=document.createElement("div");icon.className="file-icon";icon.textContent=statusIcon(item);
    const main=document.createElement("div");main.className="file-main";const name=document.createElement("div");name.className="file-name";name.title=item.file.name;name.textContent=item.file.name;
    const path=document.createElement("div");path.className="file-path";path.title=item.relativePath;path.textContent=item.relativePath;
    const meta=document.createElement("div");meta.className="file-meta";const est=estimatedMp3Size(item),mem=item.duration?updateItemMemoryEstimate(item):null;meta.textContent=`原始 ${fmtBytes(item.file.size)}${item.duration?`｜⏱️ ${fmtDuration(item.duration)}`:""}${mem?`｜PCM工作量約 ${fmtBytes(mem)}`:""}${item.outputSize?` → MP3 ${fmtBytes(item.outputSize)}`:est?`｜預估 MP3 ${fmtBytes(est)}`:""}${item.conversionSettings?`｜${outputLabel(item.conversionSettings)}`:""}${item.validation?`｜${item.validation}`:""}`;
    const state=document.createElement("div");state.className="file-state";state.textContent=item.message;main.append(name,path,meta,state);top.append(icon,main);card.append(top);
    if(item.status==="converting"){const prog=document.createElement("div");prog.className="file-progress progress-track";const bar=document.createElement("div");bar.className="progress-bar";bar.style.width=`${Math.max(0,Math.min(100,item.progress))}%`;prog.append(bar);card.append(prog)}
    const actions=document.createElement("div");actions.className="file-actions";const src=document.createElement("button");src.type="button";src.className="mini";src.textContent="▶️ 試聽原檔";src.addEventListener("click",()=>previewOriginal(item,src));actions.append(src);
    if(item.status==="done"||(item.status==="skipped"&&item.outputHandle)){const preview=document.createElement("button");preview.type="button";preview.className="mini";preview.textContent="▶️ 試聽 MP3";preview.addEventListener("click",()=>previewOutput(item,preview));const dl=document.createElement("button");dl.type="button";dl.className="mini";dl.textContent="⬇️ 下載 MP3";dl.addEventListener("click",()=>downloadItem(item,dl));actions.append(preview,dl);if(item.outputStorage==="direct"){const loc=document.createElement("button");loc.type="button";loc.className="mini";loc.textContent="📂 定位輸出";loc.addEventListener("click",()=>locateItemOutput(item));actions.append(loc)}}
    if(["done","error","cancelled","skipped"].includes(item.status)){const retry=document.createElement("button");retry.type="button";retry.className="mini";retry.textContent="🔄 重新轉換";retry.disabled=busy||analyzing;retry.addEventListener("click",async()=>{item.status="ready";item.progress=0;item.message="等待重新轉換";item.outputHandle=null;item.outputDirHandle=null;item.validation=null;item.outputSize=0;item.outputDuration=null;item.outputStorage=null;item.outputName=null;item.outputRelative=null;item.conversionSettings=null;item.encoderStats=null;if(item.outputCacheKey)await deleteOutput(item.outputCacheKey).catch(()=>{});item.outputCacheKey=null;render()});actions.append(retry)}
    const rm=document.createElement("button");rm.type="button";rm.className="mini remove";rm.textContent="移除";rm.disabled=busy||analyzing;rm.addEventListener("click",()=>{releaseItem(item);items=items.filter(x=>x!==item);render();updateScanSummary()});actions.append(rm);card.append(actions);els.fileList.append(card)
  }
  if(filtered.length>RENDER_LIMIT){const note=document.createElement("div");note.className="info-card";note.textContent=`大量資料夾模式：畫面只渲染前 ${RENDER_LIMIT} 筆符合篩選的資料；其餘 ${filtered.length-RENDER_LIMIT} 筆仍會正常處理。可用上方搜尋／狀態篩選快速找到失敗檔案。`;els.fileList.append(note)}
  renderOutputResults();updateButtons();
}
function updateButtons(){
  els.convert.disabled=busy||analyzing||scanning||!items.some(x=>x.file.size<=fileSizeLimit(x.file)&&["ready","error","cancelled"].includes(x.status));els.clear.disabled=busy||analyzing||scanning;els.pickFiles.disabled=busy||analyzing||scanning;els.pickFolder.disabled=busy||analyzing||scanning;els.openWorkspace.disabled=busy||analyzing||scanning||!canDirectWrite();els.outputMode.disabled=busy||analyzing||scanning;els.chooseOutput.disabled=busy||analyzing||scanning;if(els.openOutputLocation)els.openOutputLocation.disabled=busy||analyzing||scanning||!hasLocatableOutput();els.restoreFolders.disabled=busy||analyzing||scanning;els.forgetFolders.disabled=busy||analyzing||scanning;els.mode.disabled=busy||analyzing;els.bitrate.disabled=busy||analyzing;els.skipMp3.disabled=busy||analyzing;els.preserveStructure.disabled=busy||analyzing||els.outputMode.value==="alongside";els.conflictPolicy.disabled=busy||analyzing;els.resumeMode.disabled=busy||analyzing;els.autoSave.disabled=busy||analyzing;
  const locked=busy||analyzing||scanning,haveCached=items.some(x=>x.status==="done"&&x.outputStorage!=="direct");els.zip.disabled=locked||!haveCached;els.csv.disabled=locked||sessionRecords.length===0;els.json.disabled=locked||sessionRecords.length===0;els.clearRecovery.disabled=locked;
}
function updateCurrentCard(){if(!currentItem)return;const card=els.fileList.querySelector(`[data-id="${currentItem.id}"]`);if(!card)return;const bar=card.querySelector(".progress-bar"),state=card.querySelector(".file-state");if(bar)bar.style.width=`${currentItem.progress}%`;if(state)state.textContent=currentItem.message}
function overall(done,total,fileProgress=0){const value=total?Math.min(100,Math.round(((done+fileProgress/100)/total)*100)):0;els.overallPercent.textContent=value>=100?"100%":`約 ${value}%`;els.overallBar.style.width=`${value}%`}
function overallByDuration(){
  if(!batchTargets.length)return;const known=batchTargets.filter(x=>Number.isFinite(x.duration)&&x.duration>0);if(known.length<Math.ceil(batchTargets.length*.7))return overall(currentProcessedCount,currentTotalCount,currentItem?.progress||0);
  const total=known.reduce((s,x)=>s+x.duration,0);let done=0;for(const x of known){if(["done","skipped","error"].includes(x.status))done+=x.duration;else if(x===currentItem)done+=x.duration*(x.progress/100)}const pct=total?Math.min(100,Math.round(done/total*100)):0;els.overallPercent.textContent=pct>=100?"100%":`約 ${pct}%`;els.overallBar.style.width=`${pct}%`;
}
function encodeNativeInWorker(channels,settings){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./mp3/encoder-worker.js",import.meta.url),{type:"module"});
    const cleanup=()=>{if(activeEncodeTask?.worker===worker)activeEncodeTask=null;try{worker.terminate()}catch{}};
    activeEncodeTask={worker,reject:(err)=>{cleanup();reject(err)}};
    worker.onmessage=e=>{
      if(e.data?.type==="progress"){if(!currentItem||cancelRequested)return;const p=Math.max(0,Math.min(99,Math.round(Number(e.data.progress||0)*100)));currentItem.progress=Math.max(currentItem.progress,p);currentItem.message=`Native MP3 編碼中… 約 ${currentItem.progress}%`;updateCurrentCard();overallByDuration();return}
      if(e.data?.type==="done"){const out=new Uint8Array(e.data.buffer);const info=e.data.info||null;cleanup();resolve({data:out,info});return}
      if(e.data?.type==="error"){const err=new Error(e.data.message||"Native MP3 Encoder 發生錯誤");cleanup();reject(err)}
    };
    worker.onerror=e=>{const err=new Error(e.message||"Native MP3 Worker 啟動失敗");cleanup();reject(err)};
    const transfers=channels.map(c=>c.buffer);worker.postMessage({type:"encode",channels,options:{bitrate:settings?.bitrate||128,sampleRate:Number(settings?.sampleRate)||44100}},transfers);
  });
}
async function detectCustomOutputInsideWorkspace(){
  excludedCustomPath="";if(!workspaceRootHandle||!customOutputHandle||typeof workspaceRootHandle.resolve!=="function")return;
  try{const parts=await workspaceRootHandle.resolve(customOutputHandle);if(parts&&parts.length){excludedCustomPath=normalizeRelativePath(parts.join("/"));const before=items.length;items=items.filter(i=>!isPathInside(i.relativePath,excludedCustomPath));const removed=before-items.length;if(removed){scanIgnored+=removed;setStatus(`輸出資料夾位於來源內：已排除 ${excludedCustomPath}，並移除 ${removed} 個可能被重複掃描的檔案。`);updateScanSummary();render()}}}catch{}
}
async function chooseCustomOutput(){if(!canDirectWrite()){setStatus("此瀏覽器不支援直接寫入資料夾，請改用 ZIP 相容模式。");return}try{const handle=await window.showDirectoryPicker({mode:"readwrite",id:"chopper-native-mp3-v1-output"});customOutputHandle=handle;await putHandle("custom-output",handle).catch(()=>{});els.restoreFolders.hidden=false;els.forgetFolders.hidden=false;els.outputFolderState.textContent=`✅ 輸出資料夾：${handle.name}`;els.outputMode.value="custom";await detectCustomOutputInsideWorkspace();updateSourceCapabilities();setStatus(`已選擇輸出資料夾：${handle.name}`)}catch(err){if(err?.name!=="AbortError")setStatus(`選擇輸出資料夾失敗：${err?.message||err}`)}}
async function outputBrowseHandle(){
  if(els.outputMode.value==="custom")return customOutputHandle;
  if(els.outputMode.value==="workspace-results"&&workspaceRootHandle){try{return await workspaceRootHandle.getDirectoryHandle(RESULT_FOLDER)}catch{return workspaceRootHandle}}
  if(els.outputMode.value==="alongside"){
    const direct=items.filter(i=>i.outputStorage==="direct"&&i.sourceDirHandle);
    if(direct.length===1)return direct[0].sourceDirHandle;
    return workspaceRootHandle;
  }
  return null;
}
async function openOutputLocation(){
  if(!canDirectWrite()){setStatus("目前瀏覽器無法開啟資料夾定位視窗。若使用瀏覽器下載模式，請從瀏覽器的下載清單查看檔案。");return}
  try{
    const startIn=await outputBrowseHandle();
    if(!startIn){setStatus("目前沒有可定位的直接輸出資料夾；請先選擇輸出資料夾，或使用『開啟工作資料夾』後直接存回來源旁邊。");return}
    const chosen=await window.showDirectoryPicker({mode:"read",startIn,id:"chopper-native-mp3-v1-locate-output"});
    setStatus(`已開啟系統資料夾定位視窗：${chosen.name}。此操作只用來定位，不會變更目前的輸出設定。`);
  }catch(err){if(err?.name!=="AbortError")setStatus(`開啟輸出位置失敗：${err?.message||err}`)}
}
async function scanWorkspaceHandle(root,{restored=false}={}){
  clearQueueOnly();workspaceRootHandle=root;workspaceName=sanitizeSegment(root.name,"工作資料夾");sourceMode="workspace";els.outputMode.value="alongside";excludedCustomPath="";
  if(customOutputHandle&&typeof root.resolve==="function"){try{const parts=await root.resolve(customOutputHandle);if(parts&&parts.length)excludedCustomPath=normalizeRelativePath(parts.join("/"))}catch{}}
  scanCancelRequested=false;setScanning(true);setStatus(`${restored?"正在恢復並掃描":"正在掃描"} ${workspaceName}…`);const stats={supported:0,ignored:0,mp3:0,limitReached:false};
  try{await walkWorkspace(root,"",stats);scanIgnored=stats.ignored;scanMp3=stats.mp3;updateSourceCapabilities();updateScanSummary();render();setStatus(scanCancelRequested?`掃描已停止：目前保留 ${stats.supported} 個已找到檔案。`:stats.limitReached?`已達安全上限 ${MAX_FILES} 個檔案，已停止繼續掃描，避免瀏覽器資源耗盡。`:`工作資料夾掃描完成：${stats.supported} 個可處理檔案，${stats.ignored} 個已略過。`)}finally{setScanning(false)}
}
async function openWorkspace(){if(!canDirectWrite()){setStatus("目前瀏覽器不支援可直接讀寫的工作資料夾；請使用『匯入資料夾』。");return}if(busy||scanning)return;try{const root=await window.showDirectoryPicker({mode:"readwrite",id:"chopper-native-mp3-v1-workspace"});await putHandle("workspace",root).catch(()=>{});els.restoreFolders.hidden=false;els.forgetFolders.hidden=false;await scanWorkspaceHandle(root)}catch(err){if(err?.name!=="AbortError"){appendLog(String(err?.stack||err));setStatus(`開啟工作資料夾失敗：${err?.message||err}`)}}}
async function walkWorkspace(dir,prefix,stats){
  if(stats.limitReached||items.length>=MAX_FILES){stats.limitReached=true;return}
  for await(const [name,handle] of dir.entries()){
    if(scanCancelRequested||stats.limitReached)return;
    if(items.length>=MAX_FILES){stats.limitReached=true;return}
    if(handle.kind==="directory"){
      const relDir=joinPath(prefix,name);if(hasPathSegment(relDir,RESULT_FOLDER)||(excludedCustomPath&&isPathInside(relDir,excludedCustomPath))){stats.ignored++;continue}await walkWorkspace(handle,relDir,stats);if(stats.limitReached)return;continue;
    }
    if(handle.kind!=="file")continue;if(String(name).startsWith(PART_PREFIX)||String(name).startsWith(BACKUP_PREFIX)){stats.ignored++;continue}let file;try{file=await handle.getFile()}catch{stats.ignored++;continue}if(!isSupported(file)){stats.ignored++;continue}const rel=joinPath(prefix,name);if(isExcludedRelative(rel)){stats.ignored++;continue}if(isMp3(file.name))stats.mp3++;items.push(newItem(file,{relativePath:rel,sourceDirHandle:dir,sourceKind:"workspace"}));stats.supported++;if(stats.supported%100===0){setStatus(`正在掃描… 已找到 ${stats.supported} 個可處理檔案`);await sleep0()}
  }
}
async function initRestorableHandles(){if(!canDirectWrite())return;try{const [w,c]=await Promise.all([getHandle("workspace").catch(()=>null),getHandle("custom-output").catch(()=>null)]);if(w||c){els.restoreFolders.hidden=false;els.forgetFolders.hidden=false;const states=[];if(w)states.push(`工作：${w.name}（${await queryRW(w)}）`);if(c)states.push(`輸出：${c.name}（${await queryRW(c)}）`);els.restoreFolders.title=states.join("｜")}}catch{}}
async function forgetSavedFolders(){if(!window.confirm("要忘記本站保存的工作／輸出資料夾 Handle 嗎？這只會刪除本站的恢復紀錄，不會刪除任何檔案，也無法代替瀏覽器本身的權限管理。"))return;try{await clearHandles();els.restoreFolders.hidden=true;els.forgetFolders.hidden=true;setStatus("已忘記本站保存的資料夾 Handle；目前分頁已開啟的資料夾仍可使用到本次工作結束。") }catch(err){setStatus(`忘記資料夾 Handle 失敗：${err?.message||err}`)}}
async function restoreFolders(){
  if(!canDirectWrite())return;try{const w=await getHandle("workspace").catch(()=>null),c=await getHandle("custom-output").catch(()=>null);let restored=false;if(w){const perm=await requestRW(w);if(perm==="granted"){workspaceRootHandle=w;restored=true}}
    if(c){const perm=await requestRW(c);if(perm==="granted"){customOutputHandle=c}}
    if(restored){await detectCustomOutputInsideWorkspace();await scanWorkspaceHandle(workspaceRootHandle,{restored:true})}else if(customOutputHandle){els.outputMode.value="custom";updateSourceCapabilities();setStatus(`已恢復輸出資料夾：${customOutputHandle.name}`)}else setStatus("未取得上次資料夾的讀寫權限。")
  }catch(err){setStatus(`恢復資料夾失敗：${err?.message||err}`)}
}
function assignOutputNames(targets){const targetIds=new Set(targets.map(x=>x.id));const used=new Set(items.filter(x=>!targetIds.has(x.id)&&x.outputStorage!=="direct"&&x.outputRelative).map(x=>x.outputRelative.toLowerCase()));for(const item of targets){let base=safeBase(item.file.name),candidate=`${base}.mp3`,n=2;let key=buildOutputRelative(item,candidate).toLowerCase();while(used.has(key)){candidate=`${base}_${n++}.mp3`;key=buildOutputRelative(item,candidate).toLowerCase()}used.add(key);item.outputName=candidate;item.outputRelative=buildOutputRelative(item,candidate)}}
function buildOutputRelative(item,name=item.outputName){const dir=els.preserveStructure.checked?dirname(item.relativePath):"";if(els.outputMode.value==="alongside")return joinPath(dirname(item.relativePath),name);if(els.outputMode.value==="workspace-results")return joinPath(RESULT_FOLDER,dir,name);if(els.outputMode.value==="custom")return joinPath(dir,name);return joinPath(RESULT_FOLDER,dir,name)}
async function ensureDir(root,relative){let dir=root;for(const part of normalizeRelativePath(relative).split("/").filter(Boolean))dir=await dir.getDirectoryHandle(part,{create:true});return dir}
async function existingFile(dir,name){try{return await dir.getFileHandle(name)}catch(err){if(err?.name==="NotFoundError")return null;throw err}}
async function forceMp3SourceProtection(item,dir,name){
  if(!isMp3(item.file.name)||name.toLocaleLowerCase()!==item.file.name.toLocaleLowerCase())return name;
  let risky=els.outputMode.value==="alongside"||els.outputMode.value==="custom";
  if(!risky)return name;
  if(item.sourceDirHandle&&dir?.isSameEntry){try{risky=await dir.isSameEntry(item.sourceDirHandle)}catch{risky=true}}
  if(!risky)return name;
  item.safetyRenamed=true;return `${safeBase(item.file.name)}_重新轉換.mp3`;
}
async function planDirectTarget(item){
  let dir,relativeDir="";const preserve=els.preserveStructure.checked;
  if(els.outputMode.value==="workspace-results"){if(!workspaceRootHandle)throw new Error("尚未開啟可寫入的工作資料夾");relativeDir=joinPath(RESULT_FOLDER,preserve?dirname(item.relativePath):"");dir=await ensureDir(workspaceRootHandle,relativeDir)}
  else if(els.outputMode.value==="alongside"){if(!item.sourceDirHandle)throw new Error("此來源未提供直接寫回權限；請改用『開啟工作資料夾』");dir=item.sourceDirHandle;relativeDir=dirname(item.relativePath)}
  else if(els.outputMode.value==="custom"){if(!customOutputHandle)throw new Error("請先選擇輸出資料夾");relativeDir=preserve?dirname(item.relativePath):"";dir=await ensureDir(customOutputHandle,relativeDir)}else return null;
  let name=item.outputName||`${safeBase(item.file.name)}.mp3`;const original=name;name=await forceMp3SourceProtection(item,dir,name);let exists=await existingFile(dir,name);
  if(item.safetyRenamed||exists&&els.conflictPolicy.value==="rename"){const stem=safeBase(name);let candidate=name,n=2;while(await existingFile(dir,candidate)){candidate=`${stem}_${n++}.mp3`}name=candidate;exists=await existingFile(dir,name)}
  item.outputName=name;item.outputRelative=buildOutputRelative(item,name);if(item.safetyRenamed&&original!==name)item.message=`安全保護：原始 MP3 不允許被同名覆蓋，輸出改為 ${name}`;return{dir,name,existing:exists,relative:item.outputRelative};
}
async function outputExistsForPlan(plan){if(!plan?.existing)return false;try{const f=await plan.existing.getFile();return f.size>0}catch{return false}}
async function recoveryOutputMatches(plan,record){
  if(!plan?.existing||!record?.outputSize||!isStrongFingerprint(record?.outputFingerprint))return false;
  try{const f=await plan.existing.getFile();if(f.size!==record.outputSize)return false;const fp=await fileFingerprint(f);if(!isStrongFingerprint(fp)||fp!==record.outputFingerprint)return false;const structure=await validateMp3Structure(f,{signal:activeAbortController?.signal});if(record.outputBitrate&&structure.bitrate!==record.outputBitrate)return false;if(record.outputSampleRate&&structure.sampleRate!==record.outputSampleRate)return false;return true}catch{return false}
}
async function ensureFingerprint(item){if(!item.fingerprint)item.fingerprint=await fileFingerprint(item.file);return item.fingerprint}
async function makeRecoveryKey(item,plan,settings){return recoveryKey({workspace:workspaceName||customOutputHandle?.name||sourceMode||"output",relativePath:item.relativePath,size:item.file.size,lastModified:item.file.lastModified,fingerprint:await ensureFingerprint(item),settingsKey:settingsKey(settings),outputMode:els.outputMode.value,outputRelative:plan?.relative||item.outputRelative||""})}
async function makeCacheKey(item,settings){return`zip|${await makeRecoveryKey(item,null,settings)}`}
function record(item,result,extra={}){sessionRecords.push({time:new Date().toISOString(),source:item.relativePath,output:item.outputRelative||item.outputName||"",sourceBytes:item.file.size,outputBytes:item.outputSize||0,durationSeconds:item.duration||"",outputDurationSeconds:item.outputDuration||"",validation:item.validation||"",settings:item.conversionSettings?outputLabel(item.conversionSettings):outputLabel(),result,message:item.message,...extra});els.csv.disabled=false;els.json.disabled=false}
async function preflightStorage(targets){const est=await storageEstimate();if(!est){els.storage.textContent="ℹ️ 瀏覽器未提供暫存空間估算";return true}const used=est.usage||0,quota=est.quota||0,free=Math.max(0,quota-used);els.storage.textContent=`💾 瀏覽器可用暫存約 ${fmtBytes(free)} / 配額 ${fmtBytes(quota)}`;if(els.outputMode.value!=="zip")return true;const estimate=targets.reduce((sum,x)=>sum+(estimatedMp3Size(x)||Math.min(x.file.size*.8,250*MB)),0);if(free<estimate)return window.confirm(`瀏覽器可用暫存約 ${fmtBytes(free)}，預估本批 MP3 約 ${fmtBytes(estimate)}。ZIP 相容模式可能空間不足。仍要繼續嗎？`);return true}
function probeMediaDuration(blob,timeout=1800){return new Promise(resolve=>{const url=URL.createObjectURL(blob),audio=document.createElement("audio");let ended=false;const finish=v=>{if(ended)return;ended=true;clearTimeout(timer);audio.removeAttribute("src");audio.load();URL.revokeObjectURL(url);resolve(Number.isFinite(v)&&v>0?v:null)};const timer=setTimeout(()=>finish(null),timeout);audio.preload="metadata";audio.onloadedmetadata=()=>finish(audio.duration);audio.onerror=()=>finish(null);audio.src=url})}
async function probeDurations(targets){if(targets.length>200){setStatus("大量批次超過 200 筆：略過完整長度預掃描；WAV 會在處理前檢查串流能力，其餘格式在解碼時取得實際時長。");return}const pending=targets.filter(x=>!x.duration);if(!pending.length)return;setStatus(`正在快速分析 ${pending.length} 個音檔長度與 WAV 串流能力…`);let cursor=0;async function worker(){while(cursor<pending.length){const i=cursor++,item=pending[i];if(cancelRequested)return;if(extOf(item.file.name)==="wav")await ensureDurationForMemory(item);else item.duration=await probeMediaDuration(item.file,1200)}}await Promise.all(Array.from({length:Math.min(6,pending.length)},worker));updateScanSummary();render()}
async function validateMp3Blob(blob,inputDuration,{expectedBitrate=null,expectedSampleRate=null}={}){
  if(!blob||blob.size<128)throw new Error("輸出 MP3 太小，完整性驗證失敗");const structure=await validateMp3Structure(blob,{signal:activeAbortController?.signal});
  if(expectedBitrate&&structure.bitrate!==Number(expectedBitrate))throw new Error(`輸出 bitrate 異常：預期 ${expectedBitrate}，實際 ${structure.bitrate} kbps`);
  if(expectedSampleRate&&structure.sampleRate!==Number(expectedSampleRate))throw new Error(`輸出 sample rate 異常：預期 ${expectedSampleRate}，實際 ${structure.sampleRate} Hz`);
  if(Number.isFinite(inputDuration)&&inputDuration>0){const diff=Math.abs(structure.duration-inputDuration),allow=Math.max(1.5,Math.min(5,inputDuration*.002));if(diff>allow)throw new Error(`輸出長度異常：來源 ${fmtDuration(inputDuration)}，輸出 ${fmtDuration(structure.duration)}`)}
  return{duration:structure.duration,structure,validation:`✅ MP3 全檔 frame 驗證通過｜${structure.bitrate} kbps｜${(structure.sampleRate/1000).toFixed(structure.sampleRate%1000?1:0)} kHz`};
}
async function streamWavDirect(item,plan,settings){
  const signal=activeAbortController?.signal,tempName=partFileName(plan.name);let tempHandle=null,writable=null;
  try{
    tempHandle=await plan.dir.getFileHandle(tempName,{create:true});writable=await tempHandle.createWritable();
    const result=await streamWavToMp3(item.file,{bitrate:settings.bitrate,forceMono:settings.channels===1,signal,collect:false,onProgress:(p,phase)=>{item.progress=Math.max(item.progress,Math.min(99,Math.round(p*100)));item.message=phase==="scan"?`WAV 串流峰值掃描中… 約 ${item.progress}%`:`WAV → MP3 串流編碼中… 約 ${item.progress}%`;updateCurrentCard();overallByDuration()},onMp3Chunk:chunk=>writable.write(chunk)});
    await writable.close();writable=null;const tempFile=await tempHandle.getFile(),checked=await validateMp3Blob(tempFile,result.duration,{expectedBitrate:settings.bitrate,expectedSampleRate:result.sampleRate});
    const finalHandle=await commitValidatedBlob(plan,tempFile);await plan.dir.removeEntry(tempName).catch(()=>{});return{handle:finalHandle,checked,result};
  }catch(err){try{await writable?.abort()}catch{}try{if(tempHandle)await plan.dir.removeEntry(tempName)}catch{}throw err}
}

async function restoreCachedOutputs(targets,settings){
  if(els.outputMode.value!=="zip"||!els.resumeMode.checked)return;
  for(const item of targets){
    if(isMp3(item.file.name)&&els.skipMp3.checked)continue;
    try{
      item.outputCacheKey=await makeCacheKey(item,settings);const rec=await getOutputRecord(item.outputCacheKey);if(!rec?.blob)continue;
      const storedSettings=rec.conversionSettings||settings,checked=await validateMp3Blob(rec.blob,item.duration,{expectedBitrate:settings.bitrate,expectedSampleRate:Number(storedSettings.actualSampleRate)||null});
      item.status="done";item.outputSize=rec.blob.size;item.outputStorage="indexeddb-resume";item.conversionSettings=storedSettings;item.outputDuration=checked.duration;item.validation="♻️ 7 天續作暫存｜✅ MP3 全檔重新驗證";item.message="接續上次工作：來源取樣指紋與設定相同，且暫存 MP3 全檔 frame 驗證通過";record(item,"resumed-cache",{reason:"persistent-cache-verified"});
    }catch(err){appendLog(`Cache resume invalid: ${item.relativePath}｜${err?.message||err}`);if(item.outputCacheKey)await deleteOutput(item.outputCacheKey).catch(()=>{})}
  }
}

async function convertOne(item,done,total,settings){
  currentItem=item;item.status="converting";item.message="正在檢查來源與串流能力…";item.progress=0;item.conversionSettings=settings;render();let plan=null,recoveryId=null;
  try{
    if(isMp3(item.file.name)&&els.skipMp3.checked){item.status="skipped";item.outputName=null;item.outputRelative=null;item.message="已是 MP3，依設定略過再次有損轉碼";record(item,"skipped",{reason:"already-mp3"});return true}
    if(outputModeIsDirect()){
      plan=await planDirectTarget(item);item.outputDirHandle=plan.dir;recoveryId=await makeRecoveryKey(item,plan,settings);
      if(els.resumeMode.checked&&await outputExistsForPlan(plan)){let r=null;try{r=await getRecovery(recoveryId)}catch{}if(r&&await recoveryOutputMatches(plan,r)){item.status="skipped";item.outputHandle=plan.existing;item.outputDirHandle=plan.dir;const f=await plan.existing.getFile();item.outputSize=f.size;item.outputDuration=r.outputDuration||null;item.outputStorage="direct";item.conversionSettings=r.conversionSettings||settings;item.validation="♻️ 來源取樣指紋＋輸出 MP3 全檔驗證續作";item.message="接續上次工作：來源取樣指紋相同，且輸出 MP3 結構與指紋驗證通過，已安全略過";record(item,"skipped",{reason:"recovery-verified"});return true}else if(r){appendLog(`Recovery output mismatch: ${item.relativePath}，將重新轉換`)}}
      if(plan.existing&&els.conflictPolicy.value==="skip"){item.status="skipped";item.outputHandle=plan.existing;item.outputDirHandle=plan.dir;const f=await plan.existing.getFile();item.outputSize=f.size;item.outputStorage="direct";item.message="輸出 MP3 已存在，依設定略過（未宣稱為已驗證續作）";record(item,"skipped",{reason:"exists"});return true}
    }else item.outputCacheKey=item.outputCacheKey||await makeCacheKey(item,settings);
    await storageReady;if(item.outputCacheKey&&item.status!=="done")await deleteOutput(item.outputCacheKey).catch(()=>{});if(cancelRequested)throw new DOMException("使用者已停止","AbortError");
    await ensureDurationForMemory(item);if(cancelRequested)throw new DOMException("使用者已停止","AbortError");
    if(item.duration&&!item.streamInfo?.streamable){const risk=memoryRisk(item);if(risk==="hard")throw new Error(`預估 PCM 工作記憶體 ${fmtBytes(item.memoryEstimate)}，超過目前裝置安全門檻 ${fmtBytes(MEMORY_POLICY.hard)}；為避免瀏覽器當機已停止此檔`);if(risk==="soft"&&!item.memorySoftApproved){const ok=window.confirm(`${item.file.name} 預估 Native PCM 工作記憶體約 ${fmtBytes(item.memoryEstimate)}，接近目前裝置安全門檻。仍要處理此檔嗎？`);if(!ok)throw new Error("使用者取消高記憶體檔案");item.memorySoftApproved=true}}

    let blob=null,checked=null;
    if(item.streamInfo?.streamable){
      const actualChannels=settings.channels===1?1:item.streamInfo.channels;item.conversionSettings={...settings,actualChannels,actualSampleRate:item.streamInfo.sampleRate,streaming:true};
      if(outputModeIsDirect()){
        if(!plan)plan=await planDirectTarget(item);item.outputDirHandle=plan.dir;const streamed=await streamWavDirect(item,plan,settings);item.outputHandle=streamed.handle;item.outputStorage="direct";item.encoderStats=streamed.result.encoderStats;item.outputSize=streamed.result.outputBytes;item.outputDuration=streamed.checked.duration;item.validation=streamed.checked.validation+(item.encoderStats?.peakProtected?"｜✅ 峰值保護":"")+"｜✅ 低記憶體 WAV 串流";checked=streamed.checked;
      }else{
        const streamed=await streamWavToMp3(item.file,{bitrate:settings.bitrate,forceMono:settings.channels===1,signal:activeAbortController?.signal,collect:true,onProgress:(p,phase)=>{item.progress=Math.max(item.progress,Math.min(99,Math.round(p*100)));item.message=phase==="scan"?`WAV 串流峰值掃描中… 約 ${item.progress}%`:`WAV → MP3 串流編碼中… 約 ${item.progress}%`;updateCurrentCard();overallByDuration()}});
        blob=streamed.blob;item.encoderStats=streamed.encoderStats;checked=await validateMp3Blob(blob,streamed.duration,{expectedBitrate:settings.bitrate,expectedSampleRate:streamed.sampleRate});item.outputDuration=checked.duration;item.validation=checked.validation+(item.encoderStats?.peakProtected?"｜✅ 峰值保護":"")+"｜✅ 低記憶體 WAV 串流";item.outputSize=blob.size;item.outputStorage=await putOutput(item.outputCacheKey,blob,{source:item.relativePath,settingsKey:settingsKey(settings),outputDuration:item.outputDuration,validation:item.validation,encoder:"native-0.4.1",encoderStats:item.encoderStats,conversionSettings:item.conversionSettings});
      }
    }else{
      if(extOf(item.file.name)==="wav"&&item.file.size>MAX_NONSTREAM_FILE)throw new Error(`此大型 WAV 不符合真正串流條件（${item.streamInfo?.reason||"格式／取樣率不支援"}），且超過完整解碼安全上限 ${fmtBytes(MAX_NONSTREAM_FILE)}`);
      item.message="瀏覽器原生完整解碼中…";updateCurrentCard();
      const decoded=await decodeAudioFile(item.file,{forceMono:settings.channels===1,signal:activeAbortController?.signal});if(cancelRequested)throw new DOMException("使用者已停止","AbortError");
      item.duration=decoded.duration||item.duration;item.conversionSettings={...settings,actualChannels:decoded.outputChannels,actualSampleRate:decoded.sampleRate,streaming:false};item.message=`Native MP3 Worker 編碼中｜${settings.bitrate} kbps｜${decoded.outputChannels===1?"Mono":"Stereo"}｜${(decoded.sampleRate/1000).toFixed(decoded.sampleRate%1000?1:0)} kHz`;updateCurrentCard();
      const encoded=await encodeNativeInWorker(decoded.channels,{...settings,sampleRate:decoded.sampleRate}),data=encoded.data;item.encoderStats=encoded.info?.stats||null;if(cancelRequested)throw new DOMException("使用者已停止","AbortError");if(!(data instanceof Uint8Array)||data.byteLength<128)throw new Error("Native MP3 輸出檔案為空或過小");
      blob=new Blob([data],{type:"audio/mpeg"});checked=await validateMp3Blob(blob,item.duration,{expectedBitrate:settings.bitrate,expectedSampleRate:decoded.sampleRate});item.outputDuration=checked.duration;item.validation=checked.validation+(item.encoderStats?.peakProtected?"｜✅ 峰值保護":"");item.outputSize=blob.size;
      if(outputModeIsDirect()){if(!plan)plan=await planDirectTarget(item);item.outputDirHandle=plan.dir;item.outputHandle=await commitValidatedBlob(plan,blob);item.outputStorage="direct"}else item.outputStorage=await putOutput(item.outputCacheKey,blob,{source:item.relativePath,settingsKey:settingsKey(settings),outputDuration:item.outputDuration,validation:item.validation,encoder:"native-0.4.1",encoderStats:item.encoderStats,conversionSettings:item.conversionSettings});
    }

    if(outputModeIsDirect()&&recoveryId){try{const written=await item.outputHandle.getFile(),outputFingerprint=await fileFingerprint(written),structure=checked?.structure||await validateMp3Structure(written,{signal:activeAbortController?.signal});if(isStrongFingerprint(outputFingerprint))await putRecovery(recoveryId,{source:item.relativePath,output:item.outputRelative,size:item.file.size,lastModified:item.file.lastModified,fingerprint:await ensureFingerprint(item),settings,conversionSettings:item.conversionSettings,validation:item.validation,encoder:"native-0.4.1",outputSize:written.size,outputDuration:item.outputDuration||null,outputFingerprint,outputBitrate:structure.bitrate,outputSampleRate:structure.sampleRate,outputFrames:structure.frames});else appendLog(`Recovery 未寫入：${item.relativePath} 無 WebCrypto 強取樣指紋`)}catch(err){appendLog(`Recovery write warning: ${err?.message||err}`)}}
    item.status="done";item.progress=100;item.message=item.outputStorage==="direct"?`Native MP3 完成且全檔驗證通過，已直接寫入：${item.outputRelative}`:`Native MP3 完成且全檔驗證通過，結果已保留 7 天續作暫存（${item.outputStorage==="memory"?"記憶體備援":"IndexedDB"}）`;overallByDuration();record(item,"success",{mode:item.streamInfo?.streamable?"wav-streaming":"browser-full-decode",...(item.safetyRenamed?{reason:"source-mp3-protected"}:{})});return true;
  }catch(err){
    const aborted=cancelRequested||err?.name==="AbortError"||String(err?.message||err).includes("使用者已停止");
    if(aborted){item.status="cancelled";item.progress=0;item.message="已停止；未完成的 .part 暫存已嘗試清理，可重新轉換";record(item,"cancelled")}
    else{item.status="error";item.progress=0;const msg=String(err?.message||err);if(msg.includes("NotAllowed")||err?.name==="NotAllowedError"){permissionPaused=true;els.restoreFolders.hidden=false}item.message=msg.includes("Quota")?"轉換失敗：瀏覽器暫存空間不足":(msg.includes("NotAllowed")||err?.name==="NotAllowedError")?"轉換暫停：資料夾寫入權限遭拒，請重新授權後接續":msg.includes("瀏覽器無法解碼")?`轉換失敗：${msg}。Native 版來源格式取決於目前瀏覽器支援。`:msg.includes("PCM 工作記憶體")?`已保護性略過：${msg}`:msg.includes("輸出長度異常")||msg.includes("MP3 frame")?`完整性驗證失敗，未提交輸出：${msg}`:`轉換失敗：${msg}`;appendLog(item.message);record(item,"error")}
    return false;
  }finally{currentItem=null;render();updateScanSummary()}
}

async function startConvert(){
  if(busy||analyzing||scanning)return;if(els.outputMode.value==="custom"&&!customOutputHandle){await chooseCustomOutput();if(!customOutputHandle)return}
  let targets=items.filter(x=>x.file.size<=fileSizeLimit(x.file)&&["ready","error","cancelled"].includes(x.status));if(!targets.length){setStatus("沒有需要轉換的檔案。");return}
  cancelRequested=false;activeAbortController=new AbortController();analyzing=true;els.cancel.disabled=false;render();let settings;
  try{
    await probeDurations(targets);if(cancelRequested){setStatus("已停止音訊分析；尚未開始編碼。");return}
    const largeNonStream=targets.filter(x=>x.largeWarning&&!x.streamInfo?.streamable);if(largeNonStream.length&&!window.confirm(`有 ${largeNonStream.length} 個大型來源無法使用低記憶體 WAV 串流，完整解碼後的 PCM 可能很大。仍要繼續嗎？`))return;
    const risks=assessBatchMemory(targets),hardIds=new Set(risks.hard.map(x=>x.id));
    for(const item of risks.hard){item.status="error";item.message=`已保護性略過：預估 PCM 工作記憶體 ${fmtBytes(item.memoryEstimate)}，超過目前裝置安全門檻 ${fmtBytes(MEMORY_POLICY.hard)}`}
    if(risks.soft.length){const sum=risks.soft.reduce((a,x)=>a+(x.memoryEstimate||0),0);if(!window.confirm(`有 ${risks.soft.length} 個非串流音檔的 PCM 工作記憶體接近目前裝置門檻（逐檔估算合計 ${fmtBytes(sum)}）。仍要繼續嗎？`)){render();updateScanSummary();return}for(const item of risks.soft)item.memorySoftApproved=true}
    targets=targets.filter(x=>!hardIds.has(x.id));if(!targets.length){setStatus("所有待處理檔案都因預估 PCM 記憶體風險而被保護性略過。");render();return}
    assignOutputNames(targets);settings=settingsSnapshot();resetSessionOutput();await restoreCachedOutputs(targets,settings);targets=targets.filter(x=>["ready","error","cancelled"].includes(x.status)&&!hardIds.has(x.id));
    if(!targets.length){setStatus("全部檔案都已由續作暫存恢復或不需重新轉換。");render();if(els.autoSave.checked&&els.outputMode.value==="zip")await autoExportCompleted();return}
    if(!(await preflightStorage(targets)))return;
    analyzing=false;busy=true;batchTargets=targets;currentProcessedCount=0;currentTotalCount=targets.length;els.cancel.disabled=false;els.overallWrap.hidden=false;els.overallText.textContent=`0 / ${targets.length}`;overall(0,targets.length);els.engine.textContent=`✅ CHOPPER Native MP3 Core v0.4.1｜${settings.bitrate} kbps｜WAV 真串流 + Worker fallback｜純 JavaScript｜0 第三方套件`;render();
    let processed=0;permissionPaused=false;for(const item of targets){currentProcessedCount=processed;currentTotalCount=targets.length;if(cancelRequested||permissionPaused)break;els.overallText.textContent=`${processed+1} / ${targets.length}｜${item.relativePath}`;await convertOne(item,processed,targets.length,settings);if(cancelRequested)break;processed++;currentProcessedCount=processed;overallByDuration()}
    if(cancelRequested){setStatus("已停止轉換；重新選擇相同來源後可利用已驗證續作紀錄接續。");els.overallText.textContent="已停止"}
    else if(permissionPaused){setStatus("資料夾寫入權限已失效，整批已暫停，避免後續檔案連續失敗。請重新取得資料夾權限後，再按『開始轉 MP3』接續。");els.overallText.textContent="已暫停｜等待重新授權"}
    else{const ok=targets.filter(x=>x.status==="done").length,skip=targets.filter(x=>x.status==="skipped").length,failed=targets.filter(x=>x.status==="error").length;setStatus(`本次 Native MP3 處理完成：${ok} 個成功${skip?`，${skip} 個略過`:""}${failed?`，${failed} 個失敗`:""}。`);els.overallText.textContent=`完成｜成功 ${ok}・略過 ${skip}・失敗 ${failed}`;els.overallPercent.textContent="100%";els.overallBar.style.width="100%";if(els.autoSave.checked)await autoExportCompleted()}
  }catch(err){appendLog(String(err?.stack||err));if(currentItem){currentItem.status=cancelRequested?"cancelled":"error";currentItem.message=cancelRequested?"已停止，可重新轉換":`Native 編碼失敗：${err?.message||err}`;currentItem.progress=0}setStatus(cancelRequested?"已停止。":`Native MP3 編碼失敗：${err?.message||err}`)}
  finally{analyzing=false;busy=false;els.cancel.disabled=true;currentItem=null;batchTargets=[];activeEncodeTask=null;activeAbortController=null;render();updateStorageState()}
}

function stopConvert(){if(!busy&&!analyzing)return;cancelRequested=true;try{activeAbortController?.abort()}catch{}if(currentItem){currentItem.status="cancelled";currentItem.progress=0;currentItem.message="正在停止並清理暫存…"}setStatus(analyzing?"正在停止音訊分析…":"正在停止 Native 編碼／串流寫入…");if(activeEncodeTask){const task=activeEncodeTask;activeEncodeTask=null;try{task.worker.terminate()}catch{}try{task.reject(new DOMException("使用者已停止","AbortError"))}catch{}}els.engine.textContent="⏹️ Native 編碼已停止；未完成輸出不會提交為正式 MP3";render()}
async function autoExportCompleted(){
  if(outputModeIsDirect()){setStatus(`${els.status.textContent} 已直接寫入指定位置，不需再按下載；可按「📂 開啟轉換後檔案位置」快速定位。`);updateSourceCapabilities();return}
  const done=items.filter(x=>x.status==="done"&&x.outputStorage!=="direct");if(!done.length)return;
  if(done.length===1){const item=done[0],blob=await getItemBlob(item);if(!blob)return;downloadBlob(blob,item.outputName||`${safeBase(item.file.name)}.mp3`);setStatus(`轉換完成，已自動下載 ${item.outputName||"MP3"}。`);return}
  await zipAll({automatic:true});
}
async function zipAll({automatic=false}={}){const done=items.filter(x=>x.status==="done"&&x.outputStorage!=="direct");if(!done.length){setStatus("目前沒有需要打包的瀏覽器暫存 MP3；直接資料夾輸出已經寫入目的地。");return}const total=done.reduce((s,x)=>s+x.outputSize,0);const ZIP32_SAFE=3.5*1024*1024*1024;if(total>ZIP32_SAFE){setStatus(`目前 MP3 總大小約 ${fmtBytes(total)}，超過本工具 ZIP32 安全範圍。請改用直接輸出資料夾，避免產生無法解壓的 ZIP。`);return}if(automatic&&total>ZIP_AUTO_SOFT){setStatus(`轉換已完成，但結果約 ${fmtBytes(total)}；為避免瀏覽器因自動建立大型 ZIP 耗盡記憶體，本次未自動打包。建議改用直接輸出資料夾；結果仍保留在續作暫存，可手動下載。`);return}if(!automatic&&total>ZIP_MANUAL_WARN&&!window.confirm(`MP3 總大小約 ${fmtBytes(total)}，建立 ZIP 可能大量占用記憶體。仍要繼續嗎？`))return;els.zip.disabled=true;setStatus("正在建立 ZIP（保留選定的資料夾結構）…");try{const entries=[];for(let i=0;i<done.length;i++){const item=done[i],blob=await getItemBlob(item);if(!blob)throw new Error(`${item.outputName} 的續作暫存遺失，請重新轉換`);entries.push({name:item.outputRelative||joinPath(RESULT_FOLDER,item.outputName),blob,date:new Date(item.file.lastModified||Date.now())})}const blob=await makeStoreZip(entries,(n,t)=>setStatus(`正在建立 ZIP：${n} / ${t}`));downloadBlob(blob,"MP3_轉換結果.zip");setStatus(`${automatic?"轉換完成，已自動下載":"ZIP 已建立"}，共 ${done.length} 個 MP3。`)}catch(err){setStatus(`建立 ZIP 失敗：${err?.message||err}`)}finally{render()}}
function exportCsv(){if(!sessionRecords.length)return;const headers=["time","source","output","sourceBytes","outputBytes","durationSeconds","outputDurationSeconds","validation","settings","result","message","reason"],rows=[headers.join(","),...sessionRecords.map(r=>headers.map(h=>csvEscape(r[h]??"")).join(","))];downloadBlob(new Blob(["\ufeff"+rows.join("\r\n")],{type:"text/csv;charset=utf-8"}),"MP3_轉換紀錄.csv")}
function exportJson(){if(!sessionRecords.length)return;downloadBlob(new Blob([JSON.stringify({version:"1.0.0",exportedAt:new Date().toISOString(),records:sessionRecords},null,2)],{type:"application/json"}),"MP3_轉換紀錄.json")}
function clearAll(){if(busy||analyzing||scanning)return;clearQueueOnly();workspaceRootHandle=null;customOutputHandle=null;workspaceName="";sourceMode="files";scanIgnored=scanMp3=0;excludedCustomPath="";els.fileInput.value="";els.folderInput.value="";els.outputMode.value=canDirectWrite()?"custom":"zip";updateSourceCapabilities();render();updateScanSummary();setStatus("已清空工作區；7 天續作暫存仍保留。")}
async function clearRecoveryCache(){if(!window.confirm("要清除瀏覽器內的 MP3 續作暫存與 Recovery 紀錄嗎？來源檔案與已直接輸出的 MP3 不會被刪除。"))return;const result=await Promise.allSettled([clearOutputs(),clearRecovery()]);for(const i of items){i.outputCacheKey=null;if(i.outputStorage!=="direct"&&i.status==="done"){i.status="ready";i.outputSize=0;i.message="續作暫存已清除，等待重新轉換"}}const failed=result.filter(x=>x.status==="rejected").length;setStatus(failed?`已清除可用的續作暫存，但有 ${failed} 個瀏覽器儲存區無法存取；不影響來源或已直接輸出的 MP3。`:"已清除續作暫存。直接寫入資料夾的檔案不受影響。");render();updateStorageState()}
async function updateStorageState(){const est=await storageEstimate();const st=outputStoreStatus();if(est){const free=Math.max(0,(est.quota||0)-(est.usage||0));els.storage.textContent=`💾 瀏覽器可用暫存約 ${fmtBytes(free)}｜續作暫存保留 ${st.ttlDays} 天${st.fallbackUsed?"｜⚠️ IndexedDB 曾失敗，已啟用記憶體備援":""}`}else els.storage.textContent=st.fallbackUsed?"⚠️ IndexedDB 不可用，已啟用記憶體備援":"ℹ️ 瀏覽器未提供儲存空間估算"}
function setupServiceWorker(){
  if(!("serviceWorker" in navigator)||!location.protocol.startsWith("http")){els.offline.textContent="ℹ️ 離線快取需由 HTTP/HTTPS 網頁啟用";return}
  let heard=false,reloading=false;
  const showUpdate=reg=>{if(!reg.waiting)return;els.updateApp.hidden=false;els.offline.textContent="🆕 已下載新版程式；為避免 Encoder 新舊版本混用，請按『立即更新』完成切換";els.updateApp.onclick=()=>{els.updateApp.disabled=true;reg.waiting?.postMessage({type:"ACTIVATE_UPDATE"})}};
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(reloading)return;reloading=true;location.reload()});
  navigator.serviceWorker.addEventListener("message",e=>{if(e.data?.type!=="OFFLINE_STATUS")return;heard=true;els.offline.textContent=e.data.ready?"✅ Native 離線程式已完整快取":"⚠️ Native 離線程式尚未完整快取，請保持連線並重新整理"});
  navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(reg=>{
    const ask=()=>{const sw=reg.active||navigator.serviceWorker.controller;if(sw)sw.postMessage({type:"CHECK_OFFLINE_READY"})};
    if(reg.waiting)showUpdate(reg);
    reg.addEventListener("updatefound",()=>{const sw=reg.installing;if(!sw)return;sw.addEventListener("statechange",()=>{if(sw.state==="installed"&&navigator.serviceWorker.controller)showUpdate(reg);else if(sw.state==="activated")ask();else if(sw.state==="redundant"&&!heard)els.offline.textContent="⚠️ Native 離線快取安裝失敗，請重新整理"})});
    ask();setTimeout(()=>{ask();if(!heard&&!reg.waiting)els.offline.textContent="⏳ Native 離線程式仍在快取中"},2000);setTimeout(()=>{ask();if(!heard&&!reg.waiting)els.offline.textContent="⚠️ 尚未確認離線快取完成；目前仍可在線使用 Native Encoder"},15000)
  }).catch(()=>{els.offline.textContent="⚠️ Service Worker 無法註冊，離線模式未啟用"})
}

els.pickFiles.addEventListener("click",()=>els.fileInput.click());els.pickFolder.addEventListener("click",()=>els.folderInput.click());els.openWorkspace.addEventListener("click",openWorkspace);els.chooseOutput.addEventListener("click",chooseCustomOutput);els.openOutputLocation.addEventListener("click",openOutputLocation);els.restoreFolders.addEventListener("click",restoreFolders);els.forgetFolders.addEventListener("click",forgetSavedFolders);
els.fileInput.addEventListener("change",async e=>{await addFiles(e.target.files,{folderMode:false});e.target.value=""});els.folderInput.addEventListener("change",async e=>{await addFiles(e.target.files,{folderMode:true,replace:true});e.target.value=""});
for(const ev of["dragenter","dragover"])els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.add("dragover")});for(const ev of["dragleave","drop"])els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.remove("dragover")});els.dropZone.addEventListener("drop",e=>void addFiles(e.dataTransfer.files,{folderMode:false}));els.dropZone.addEventListener("click",()=>els.fileInput.click());els.dropZone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();els.fileInput.click()}});
els.mode.addEventListener("change",()=>{renderMemoryPolicy();updateButtons();render()});els.bitrate.addEventListener("change",()=>{updateQualityHint();render()});els.outputMode.addEventListener("change",()=>{if(els.outputMode.value==="custom"&&!customOutputHandle)els.outputFolderState.textContent="請按下方按鈕選擇可寫入的輸出資料夾。";updateSourceCapabilities();render()});els.preserveStructure.addEventListener("change",()=>{refreshOutputDestinationState();render()});els.convert.addEventListener("click",startConvert);els.cancel.addEventListener("click",stopConvert);els.stopScan.addEventListener("click",stopScanning);els.clear.addEventListener("click",clearAll);els.zip.addEventListener("click",zipAll);els.csv.addEventListener("click",exportCsv);els.json.addEventListener("click",exportJson);els.clearRecovery.addEventListener("click",clearRecoveryCache);els.retryFailed?.addEventListener("click",retryFailedItems);els.cleanupSidecars?.addEventListener("click",cleanupSidecars);els.search.addEventListener("input",render);els.statusFilter.addEventListener("change",render);window.addEventListener("beforeunload",()=>items.forEach(releaseURLs));

try{
  els.engine.textContent=`✅ CHOPPER Native MP3 Core v0.4.1｜${els.bitrate.value} kbps｜自適應 frame bit allocation｜純 JavaScript｜0 第三方套件`;
  updateQualityHint();updateSourceCapabilities();render();updateScanSummary();updateStorageState();setupServiceWorker();initRestorableHandles();
  window.__AUDIO_MP3_APP_READY__=true;
  if(typeof window.dispatchEvent==="function"&&typeof CustomEvent==="function")window.dispatchEvent(new CustomEvent("audio-mp3-app-ready",{detail:{version:"1.0.2"}}));
}catch(err){
  const message=String(err?.message||err||"未知錯誤");
  window.__AUDIO_MP3_BOOT_ERROR__=message;
  if(typeof window.dispatchEvent==="function"&&typeof CustomEvent==="function")window.dispatchEvent(new CustomEvent("audio-mp3-app-error",{detail:{message,stack:String(err?.stack||"")}}));
  throw err;
}
