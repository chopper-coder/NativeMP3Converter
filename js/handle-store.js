const DB_NAME="chopper-native-mp3-v1-handles";
const STORE="handles";
const TTL_MS=30*24*60*60*1000;
let dbPromise=null;
function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error("IndexedDB 不可用"));return}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>{dbPromise=null;reject(req.error||new Error("Handle DB 開啟失敗"))};req.onblocked=()=>{dbPromise=null;reject(new Error("Handle DB 被其他分頁阻擋"))};
  });return dbPromise;
}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Handle DB 交易失敗"));tx.onabort=()=>reject(tx.error||new Error("Handle DB 交易中止"))})}
export async function putHandle(key,handle){const db=await openDB(),tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({handle,updatedAt:Date.now()},key);await done(tx)}
export async function getHandle(key){
  const db=await openDB(),tx=db.transaction(STORE,"readonly"),req=tx.objectStore(STORE).get(key);const value=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error("Handle DB 讀取失敗"))});await done(tx);
  if(!value)return null;
  if(value?.handle){if(Date.now()-(value.updatedAt||0)>TTL_MS){deleteHandle(key).catch(()=>{});return null}return value.handle}
  // Backward-compatible migration from V2.0.x raw FileSystemHandle records.
  if(value?.kind){putHandle(key,value).catch(()=>{});return value}
  return null;
}
export async function deleteHandle(key){const db=await openDB(),tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(key);await done(tx)}
export async function clearHandles(){const db=await openDB(),tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).clear();await done(tx)}
export async function queryRW(handle){if(!handle?.queryPermission)return"prompt";try{return await handle.queryPermission({mode:"readwrite"})}catch{return"prompt"}}
export async function requestRW(handle){if(!handle?.requestPermission)return"denied";try{return await handle.requestPermission({mode:"readwrite"})}catch{return"denied"}}
export const handleStoreInfo=Object.freeze({ttlDays:30});
