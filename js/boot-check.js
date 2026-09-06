(()=>{
  const READY_EVENT="audio-mp3-app-ready",ERROR_EVENT="audio-mp3-app-error";
  const getBox=()=>document.getElementById("bootAlert");
  const show=(message,kind="warn")=>{const box=getBox();if(!box)return;box.hidden=false;box.className=`boot-alert ${kind}`;box.textContent=message;};
  const clear=()=>{const box=getBox();if(!box)return;box.hidden=true;box.textContent="";box.className="boot-alert";};
  window.__AUDIO_MP3_BOOT_UI__={show,clear};
  if(location.protocol==="file:")show("⚠️ 目前是直接雙擊 index.html 的 file:// 模式。請執行 start_local.bat，以 localhost（127.0.0.1）方式開啟。","warn");
  window.addEventListener(READY_EVENT,()=>clear());
  window.addEventListener(ERROR_EVENT,e=>show(`⚠️ 操作程式啟動失敗：${String(e?.detail?.message||e?.detail||"未知錯誤")}。請重新整理；若仍失敗，請提供此錯誤文字。`,"error"));
  window.addEventListener("error",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.message||e?.error?.message||"");if(text)show(`⚠️ 網頁程式載入錯誤：${text}`,"error");});
  window.addEventListener("unhandledrejection",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.reason?.message||e?.reason||"");if(text)show(`⚠️ 網頁程式載入失敗：${text}`,"error");});
  async function diagnose(){
    if(window.__AUDIO_MP3_APP_READY__||window.__AUDIO_MP3_BOOT_ERROR__)return;
    if(!location.protocol.startsWith("http")){show("⚠️ 操作程式尚未啟動。請改用 start_local.bat 或 GitHub Pages。","warn");return;}
    try{
      const r=await fetch("./js/app.bundle.js",{cache:"no-store",credentials:"same-origin"});
      if(!r.ok){show(`⚠️ app.bundle.js 無法取得：HTTP ${r.status}。請確認 GitHub Repository 的 js/app.bundle.js 已上傳。`,"error");return;}
      const ct=String(r.headers.get("content-type")||"");
      if(!/javascript|ecmascript|text\/plain/i.test(ct)){show(`⚠️ app.bundle.js 回傳的 Content-Type 異常：${ct||"未提供"}。請確認 GitHub Pages 部署來源。`,"error");return;}
      show("⚠️ app.bundle.js 可以取得，但主程式仍未完成初始化。V1.0.3 已使用 Classic Bundle 並修正 File System Access picker ID 長度；請按 Ctrl+F5 後再試。若仍失敗，請提供此提示上方或 Console 第一個紅色錯誤。","error");
    }catch(err){show(`⚠️ 無法檢查 app.bundle.js：${String(err?.message||err)}。請確認網路與 GitHub Pages。`,"error");}
  }
  window.addEventListener("DOMContentLoaded",()=>setTimeout(diagnose,5000));
})();
