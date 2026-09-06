const DB_NAME="chopper-native-mp3-v1-recovery";
const STORE="jobs";
const TTL_MS=7*24*60*60*1000;
let dbPromise=null;
function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error("IndexedDB 不可用"));return}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>{dbPromise=null;reject(req.error||new Error("Recovery DB 開啟失敗"))};req.onblocked=()=>{dbPromise=null;reject(new Error("Recovery DB 被其他分頁阻擋"))};
  });return dbPromise;
}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Recovery DB 交易失敗"));tx.onabort=()=>reject(tx.error||new Error("Recovery DB 交易中止"))})}
export function recoveryKey({workspace,relativePath,size,lastModified,fingerprint,settingsKey,outputMode,outputRelative}){return[workspace||"",relativePath||"",size||0,lastModified||0,fingerprint||"",settingsKey||"",outputMode||"",outputRelative||""].join("|")}
export async function putRecovery(key,value){const db=await openDB(),tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({...value,updatedAt:Date.now()},key);await done(tx)}
export async function getRecovery(key){const db=await openDB(),tx=db.transaction(STORE,"readonly"),req=tx.objectStore(STORE).get(key);const value=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error("Recovery DB 讀取失敗"))});await done(tx);if(value&&Date.now()-(value.updatedAt||0)>TTL_MS)return null;return value}
export async function cleanupExpiredRecovery(maxAge=TTL_MS){const cutoff=Date.now()-maxAge,db=await openDB(),tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE),req=store.openCursor();await new Promise((resolve,reject)=>{req.onsuccess=()=>{const cur=req.result;if(!cur){resolve();return}if((cur.value?.updatedAt||0)<cutoff)cur.delete();cur.continue()};req.onerror=()=>reject(req.error||new Error("Recovery 清理失敗"))});await done(tx)}
export async function clearRecovery(){const db=await openDB(),tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).clear();await done(tx)}
export const recoveryStoreInfo=Object.freeze({ttlDays:7});
