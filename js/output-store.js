const DB_NAME="chopper-native-mp3-v1-output";
const STORE_NAME="outputs";
export const OUTPUT_TTL_MS=7*24*60*60*1000;
let dbPromise=null;
const memoryFallback=new Map();
let fallbackUsed=false;

function openDB(){
  if(dbPromise)return dbPromise;
  if(!globalThis.indexedDB)return Promise.reject(new Error("IndexedDB 不可用"));
  let req;
  try{req=indexedDB.open(DB_NAME,1)}catch(err){return Promise.reject(err)}
  dbPromise=new Promise((resolve,reject)=>{
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{dbPromise=null;reject(req.error||new Error("IndexedDB 開啟失敗"))};
    req.onblocked=()=>{dbPromise=null;reject(new Error("IndexedDB 被其他分頁阻擋"))};
  });
  return dbPromise;
}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error("IndexedDB 交易已中止"));tx.onerror=()=>reject(tx.error||new Error("IndexedDB 交易失敗"))})}
export function isOutputRecordFresh(record,now=Date.now(),maxAge=OUTPUT_TTL_MS){
  if(!record||typeof record.updatedAt!=="number"||!Number.isFinite(record.updatedAt)||record.updatedAt<=0)return false;
  if(typeof now!=="number"||!Number.isFinite(now)||record.updatedAt>now)return false;
  if(typeof maxAge!=="number"||!Number.isFinite(maxAge)||maxAge<0)return false;
  return now-record.updatedAt<=maxAge;
}
export async function clearOutputs(){memoryFallback.clear();try{const db=await openDB(),tx=db.transaction(STORE_NAME,"readwrite");tx.objectStore(STORE_NAME).clear();await txDone(tx)}catch{fallbackUsed=true}}
export async function cleanupExpiredOutputs(maxAge=OUTPUT_TTL_MS){
  const now=Date.now();
  for(const [k,v] of memoryFallback)if(!isOutputRecordFresh(v,now,maxAge))memoryFallback.delete(k);
  try{
    const db=await openDB(),tx=db.transaction(STORE_NAME,"readwrite"),store=tx.objectStore(STORE_NAME),req=store.openCursor();
    await new Promise((resolve,reject)=>{req.onsuccess=()=>{const cur=req.result;if(!cur){resolve();return}if(!isOutputRecordFresh(cur.value,now,maxAge))cur.delete();cur.continue()};req.onerror=()=>reject(req.error)});
    await txDone(tx);
  }catch{fallbackUsed=true}
}
export async function putOutput(id,blob,meta={}){
  // updatedAt 一律由本工具在寫入當下產生，避免呼叫端 meta 覆寫 TTL 基準。
  const rec={blob,...meta,updatedAt:Date.now()};
  try{const db=await openDB(),tx=db.transaction(STORE_NAME,"readwrite");tx.objectStore(STORE_NAME).put(rec,String(id));await txDone(tx);memoryFallback.delete(String(id));return"indexeddb"}
  catch{fallbackUsed=true;memoryFallback.set(String(id),rec);return"memory"}
}
export async function getOutputRecord(id){
  const key=String(id),now=Date.now();
  const memoryRecord=memoryFallback.get(key)||null;
  if(memoryRecord){
    if(!isOutputRecordFresh(memoryRecord,now)){await deleteOutput(key);return null}
    return memoryRecord;
  }
  try{
    const db=await openDB(),tx=db.transaction(STORE_NAME,"readonly"),done=txDone(tx),req=tx.objectStore(STORE_NAME).get(key);
    const result=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error("讀取轉換結果失敗"))});
    await done;
    if(result&&!isOutputRecordFresh(result,now)){
      // TTL 判定先成立；後續刪除即使失敗，也不得把過期 MP3 回傳給上層。
      await deleteOutput(key);
      return null;
    }
    return result;
  }catch{
    const fallback=memoryFallback.get(key)||null;
    if(fallback&&!isOutputRecordFresh(fallback,now)){await deleteOutput(key);return null}
    return fallback;
  }
}
export async function getOutput(id){return (await getOutputRecord(id))?.blob||null}
export async function deleteOutput(id){
  const key=String(id);memoryFallback.delete(key);
  try{const db=await openDB(),tx=db.transaction(STORE_NAME,"readwrite");tx.objectStore(STORE_NAME).delete(key);await txDone(tx)}catch{fallbackUsed=true}
}
export function outputStoreStatus(){return{fallbackUsed,memoryCount:memoryFallback.size,ttlDays:7}}
export async function storageEstimate(){if(!navigator.storage?.estimate)return null;try{return await navigator.storage.estimate()}catch{return null}}
