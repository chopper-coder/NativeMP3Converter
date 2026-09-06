(()=>{
  const VERSION="1.0.0";
  const CACHE_PREFIX="chopper-native-mp3-v1-";
  const EXPECTED_CACHE="chopper-native-mp3-v1-cache-1";
  const RESET_KEY=`chopper-native-mp3-v1-cache-reset-${VERSION}`;
  const RESET_PARAM="_nmp3reset";
  window.__AUDIO_MP3_BOOT_VERSION__=VERSION;
  const ui=()=>window.__AUDIO_MP3_BOOT_UI__;
  const show=(m,k="warn")=>ui()?.show?.(m,k);
  const storageGet=k=>{try{return sessionStorage.getItem(k)}catch{return null}};
  const storageSet=(k,v)=>{try{sessionStorage.setItem(k,v)}catch{}};
  const storageRemove=k=>{try{sessionStorage.removeItem(k)}catch{}};

  function currentScope(){try{return new URL("./",location.href).href}catch{return""}}
  function resetParamPresent(){try{return new URL(location.href).searchParams.get(RESET_PARAM)===VERSION}catch{return false}}
  function reloadWithResetMarker(){
    try{const u=new URL(location.href);u.searchParams.set(RESET_PARAM,VERSION);location.replace(u.href)}catch{location.reload()}
  }
  function clearResetMarker(){
    try{const u=new URL(location.href);if(u.searchParams.get(RESET_PARAM)!==VERSION)return;u.searchParams.delete(RESET_PARAM);history.replaceState(history.state,"",u.href)}catch{}
  }
  async function askControllerCache(){
    const controller=navigator.serviceWorker?.controller;if(!controller)return null;
    return await new Promise(resolve=>{
      let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);navigator.serviceWorker.removeEventListener("message",onMessage);resolve(v)};
      const onMessage=e=>{if(e.data?.type==="OFFLINE_STATUS")finish(String(e.data.cache||""))};
      const timer=setTimeout(()=>finish(""),900);navigator.serviceWorker.addEventListener("message",onMessage);
      try{controller.postMessage({type:"CHECK_OFFLINE_READY"})}catch{finish("")}
    });
  }
  async function clearOwnCachesAndRegistration(){
    try{if(globalThis.caches){for(const key of await caches.keys())if(key.startsWith(CACHE_PREFIX))await caches.delete(key)}}catch{}
    try{const scope=currentScope();for(const reg of await navigator.serviceWorker.getRegistrations())if(!scope||reg.scope===scope)await reg.unregister()}catch{}
  }
  async function recoverStaleController(){
    if(!("serviceWorker" in navigator)||!location.protocol.startsWith("http")||!navigator.serviceWorker.controller)return false;
    const cache=await askControllerCache();
    if(cache===EXPECTED_CACHE)return false;
    // The query marker is also a reload-loop guard when sessionStorage is blocked.
    if(resetParamPresent()||storageGet(RESET_KEY)==="done")return false;
    storageSet(RESET_KEY,"done");
    show(`♻️ 偵測到舊版離線快取${cache?`（${cache}）`:""}，正在自動清除並重新載入最新版…`,"warn");
    await clearOwnCachesAndRegistration();
    reloadWithResetMarker();
    return true;
  }
  async function start(){
    try{
      if(await recoverStaleController())return;
      // Query string bypasses an older cache-first Service Worker allow-list on the first repaired load.
      await import(`./app.js?v=${encodeURIComponent(VERSION)}`);
      if(!window.__AUDIO_MP3_APP_READY__)throw new Error("app.js 已載入，但沒有完成初始化");
      storageRemove(RESET_KEY);clearResetMarker();
      window.dispatchEvent(new CustomEvent("audio-mp3-app-ready",{detail:{version:VERSION}}));
    }catch(err){
      const message=String(err?.message||err||"未知錯誤");
      window.__AUDIO_MP3_BOOT_ERROR__=message;
      window.dispatchEvent(new CustomEvent("audio-mp3-app-error",{detail:{message,stack:String(err?.stack||"")}}));
    }
  }
  start();
})();
