(()=>{
  const READY_EVENT="audio-mp3-app-ready",ERROR_EVENT="audio-mp3-app-error";
  const getBox=()=>document.getElementById("bootAlert");
  const show=(message,kind="warn")=>{const box=getBox();if(!box)return;box.hidden=false;box.className=`boot-alert ${kind}`;box.textContent=message;};
  const clear=()=>{const box=getBox();if(!box)return;box.hidden=true;box.textContent="";box.className="boot-alert";};
  window.__AUDIO_MP3_BOOT_UI__={show,clear};
  if(location.protocol==="file:")show("⚠️ 目前是直接雙擊 index.html 的 file:// 模式。瀏覽器通常會限制 ES Module 與 Web Worker，請執行 start_local.bat，以 localhost（127.0.0.1）方式開啟。","warn");
  window.addEventListener(READY_EVENT,()=>clear());
  window.addEventListener(ERROR_EVENT,e=>show(`⚠️ 操作程式啟動失敗：${String(e?.detail?.message||e?.detail||"未知錯誤")}。請重新整理；若仍失敗，請提供此錯誤文字。`,"error"));
  window.addEventListener("error",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.message||e?.error?.message||"");if(text)show(`⚠️ 網頁程式載入錯誤：${text}`,"error");});
  window.addEventListener("unhandledrejection",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.reason?.message||e?.reason||"");if(text)show(`⚠️ 網頁程式載入失敗：${text}`,"error");});
  async function diagnose(){
    if(window.__AUDIO_MP3_APP_READY__||window.__AUDIO_MP3_BOOT_ERROR__)return;
    if(!location.protocol.startsWith("http")){show("⚠️ 操作程式尚未啟動。請改用 start_local.bat 或 GitHub Pages。","warn");return;}
    try{
      const r=await fetch("./js/app.js",{cache:"no-store",credentials:"same-origin"});
      if(!r.ok){show(`⚠️ app.js 無法取得：HTTP ${r.status}。請確認 GitHub Repository 的 js/app.js 已上傳到正確位置。`,"error");return;}
      const ct=String(r.headers.get("content-type")||"");
      if(!/javascript|ecmascript|text\/plain/i.test(ct)){show(`⚠️ app.js 回傳的 Content-Type 異常：${ct||"未提供"}。請確認 GitHub Pages 部署來源與檔案路徑。`,"error");return;}
      show("⚠️ app.js 本身可由伺服器取得，但 ES Module 圖或初始化尚未完成。V1.0.1 已改用直接 module 載入；請先強制重新整理（Ctrl+F5）。若仍失敗，請提供瀏覽器 Console 第一個紅色錯誤。","error");
    }catch(err){show(`⚠️ 無法檢查 app.js：${String(err?.message||err)}。請確認網路與 GitHub Pages。`,"error");}
  }
  window.addEventListener("DOMContentLoaded",()=>setTimeout(diagnose,15000));
})();
