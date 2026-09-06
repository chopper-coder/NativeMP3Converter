const CACHE_PREFIX="chopper-native-mp3-v1-";
const CACHE="chopper-native-mp3-v1-cache-4-picker-id-hotfix";
const ASSETS=["./","./index.html","./css/style.css","./js/app.bundle.js","./js/boot-check.js"];
const ASSET_URLS=new Set(ASSETS.map(a=>new URL(a,self.registration.scope).href));
const assetRequests=()=>[...ASSET_URLS].map(url=>new Request(url,{cache:"reload",credentials:"same-origin"}));
async function isReady(){const cache=await caches.open(CACHE);for(const url of ASSET_URLS)if(!(await cache.match(url)))return false;return true}
async function report(target){target?.postMessage({type:"OFFLINE_STATUS",ready:await isReady(),cache:CACHE})}
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(assetRequests()))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(async()=>{const clients=await self.clients.matchAll({includeUncontrolled:true});await Promise.all(clients.map(c=>report(c)))})));
self.addEventListener("message",e=>{if(e.data?.type==="CHECK_OFFLINE_READY")e.waitUntil(report(e.source));else if(e.data?.type==="ACTIVATE_UPDATE")self.skipWaiting()});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  if(e.request.mode==="navigate"){
    e.respondWith((async()=>{try{const res=await fetch(new Request(e.request,{cache:"no-store",credentials:"same-origin"}));if(res.ok&&res.type!=="opaque"){const cache=await caches.open(CACHE);await cache.put(new Request(new URL("./index.html",self.registration.scope).href),res.clone())}return res}catch(err){const cache=await caches.open(CACHE);return(await cache.match(new URL("./index.html",self.registration.scope).href))||(await cache.match(new URL("./",self.registration.scope).href))||Promise.reject(err)}})());return;
  }
  if(!ASSET_URLS.has(url.href))return;
  e.respondWith((async()=>{const cache=await caches.open(CACHE);try{const res=await fetch(new Request(e.request,{cache:"no-store",credentials:"same-origin"}));if(res.ok&&res.type!=="opaque")await cache.put(e.request,res.clone());return res}catch(err){const hit=await cache.match(e.request);if(hit)return hit;throw err}})());
});
