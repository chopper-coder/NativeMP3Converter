import assert from "node:assert/strict";
import {OUTPUT_TTL_MS,isOutputRecordFresh,putOutput,getOutputRecord,getOutput,clearOutputs,outputStoreStatus} from "../js/output-store.js";

const originalNow=Date.now;
const originalIndexedDB=globalThis.indexedDB;
const base=1_800_000_000_000;
try{
  // Node 測試環境刻意不提供 IndexedDB，強制走 memory fallback，驗證讀取時 TTL 仍會執行。
  try{delete globalThis.indexedDB}catch{globalThis.indexedDB=undefined}
  Date.now=()=>base;
  await clearOutputs();
  const blob=new Blob(["TTL-TEST"],{type:"audio/mpeg"});

  // putOutput 不允許 meta.updatedAt 覆寫本工具產生的 TTL 基準。
  await putOutput("fresh",blob,{updatedAt:1,note:"fresh"});
  let rec=await getOutputRecord("fresh");
  assert.ok(rec);assert.equal(rec.updatedAt,base);assert.equal(rec.note,"fresh");

  // 剛好 7 天仍視為有效；超過 1 ms 立即失效並不可再讀出。
  Date.now=()=>base+OUTPUT_TTL_MS;
  assert.equal((await getOutputRecord("fresh"))?.blob.size,blob.size);
  Date.now=()=>base+OUTPUT_TTL_MS+1;
  assert.equal(await getOutputRecord("fresh"),null);
  assert.equal(await getOutput("fresh"),null);

  // updatedAt 缺失／非數字／NaN／Infinity／未來時間均視為不可信，不得無限期保留。
  assert.equal(isOutputRecordFresh({},base),false);
  assert.equal(isOutputRecordFresh({updatedAt:"123"},base),false);
  assert.equal(isOutputRecordFresh({updatedAt:NaN},base),false);
  assert.equal(isOutputRecordFresh({updatedAt:Infinity},base),false);
  assert.equal(isOutputRecordFresh({updatedAt:base+1},base),false);
  assert.equal(isOutputRecordFresh({updatedAt:base-OUTPUT_TTL_MS},base),true);
  assert.equal(isOutputRecordFresh({updatedAt:base-OUTPUT_TTL_MS-1},base),false);

  // 即使持久化儲存清理不可用／失敗，過期資料也必須 fail closed，不能回傳給續作、下載或試聽。
  Date.now=()=>base;
  await putOutput("cleanup-failure",blob);
  Date.now=()=>base+OUTPUT_TTL_MS+1;
  assert.equal(await getOutputRecord("cleanup-failure"),null);
  assert.equal(outputStoreStatus().fallbackUsed,true);

  console.log("PASS NativeMP3Converter V1.0 output-store read-time TTL enforcement / boundary / malformed timestamp / cleanup-failure fail-closed");
}finally{
  Date.now=originalNow;
  if(originalIndexedDB===undefined){try{delete globalThis.indexedDB}catch{globalThis.indexedDB=undefined}}
  else globalThis.indexedDB=originalIndexedDB;
}
