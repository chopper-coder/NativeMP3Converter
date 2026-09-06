import {safeBase} from "./path-utils.js";

export const PART_PREFIX=".__chopper_mp3_part__";
export const BACKUP_PREFIX=".__chopper_mp3_backup__";

function sidecarToken(){return globalThis.crypto?.randomUUID?.().replace(/-/g,"")||`${Date.now()}_${Math.random().toString(16).slice(2)}`}
export function partFileName(finalName){return`${PART_PREFIX}${safeBase(finalName)}_${sidecarToken()}.part`}
export function backupFileName(finalName){return`${BACKUP_PREFIX}${safeBase(finalName)}_${sidecarToken()}.bak`}

export async function writeHandleBlob(handle,blob){
  const writable=await handle.createWritable();
  try{await writable.write(blob);await writable.close()}
  catch(err){try{await writable.abort()}catch{}throw err}
}

export async function commitValidatedBlob(plan,blob){
  if(!plan?.dir||!plan?.name)throw new Error("輸出計畫不完整");
  let target=null,backupHandle=null,backupName=null;const hadExisting=!!plan.existing;
  try{
    if(hadExisting){
      const previous=await plan.existing.getFile();backupName=backupFileName(plan.name);backupHandle=await plan.dir.getFileHandle(backupName,{create:true});await writeHandleBlob(backupHandle,previous);
    }
    target=await plan.dir.getFileHandle(plan.name,{create:true});await writeHandleBlob(target,blob);
    if(backupName)await plan.dir.removeEntry(backupName).catch(()=>{});
    return target;
  }catch(err){
    if(backupHandle){
      try{
        const previous=await backupHandle.getFile(),restoreTarget=await plan.dir.getFileHandle(plan.name,{create:true});await writeHandleBlob(restoreTarget,previous);
        if(backupName)await plan.dir.removeEntry(backupName).catch(()=>{});
      }catch(restoreErr){
        throw new Error(`正式輸出寫入失敗，舊檔自動回復也失敗；安全備份 ${backupName||""} 已盡量保留。原錯誤：${err?.message||err}；回復錯誤：${restoreErr?.message||restoreErr}`);
      }
    }else if(target){await plan.dir.removeEntry(plan.name).catch(()=>{})}
    throw err;
  }
}
