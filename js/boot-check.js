(()=>{
  const READY_EVENT="audio-mp3-app-ready",ERROR_EVENT="audio-mp3-app-error";
  const getBox=()=>document.getElementById("bootAlert");
  const show=(message,kind="warn")=>{const box=getBox();if(!box)return;box.hidden=false;box.className=`boot-alert ${kind}`;box.textContent=message;};
  const clear=()=>{const box=getBox();if(!box)return;box.hidden=true;box.textContent="";box.className="boot-alert";};
  window.__AUDIO_MP3_BOOT_UI__={show,clear};
  if(location.protocol==="file:")show("⚠️ 目前是直接雙擊 index.html 的 file:// 模式。瀏覽器通常會限制 ES Module 與 Web Worker，請執行 start_local.bat，以 localhost（127.0.0.1）方式開啟。","warn");
  window.addEventListener(READY_EVENT,()=>clear());
  window.addEventListener(ERROR_EVENT,e=>show(`⚠️ 操作程式啟動失敗：${String(e?.detail?.message||e?.detail||"未知錯誤")}。請重新整理；若仍失敗，畫面上的錯誤文字可直接提供做檢查。`,"error"));
  window.addEventListener("error",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.message||e?.error?.message||"");if(text)show(`⚠️ 網頁程式載入錯誤：${text}`,"error");});
  window.addEventListener("unhandledrejection",e=>{if(window.__AUDIO_MP3_APP_READY__)return;const text=String(e?.reason?.message||e?.reason||"");if(text)show(`⚠️ 網頁程式載入失敗：${text}`,"error");});
  window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>{
    if(!window.__AUDIO_MP3_APP_READY__&&!window.__AUDIO_MP3_BOOT_ERROR__)show("⏳ 操作程式仍在載入中。如果網路第一次載入較慢，請稍候；超過 15 秒仍未完成再重新整理。","warn");
  },8000));
})();
