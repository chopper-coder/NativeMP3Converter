const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function sanitizeSegment(value,fallback="item"){
  let s=String(value??"").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/[ .]+$/g,"").trim();
  if(!s)s=fallback;if(RESERVED.test(s))s=`_${s}`;return s.slice(0,180);
}
export function safeBase(name){const base=String(name??"").replace(/\.[^.]+$/u,"");return sanitizeSegment(base,"audio")}
function fnv1a(value){let h=0x811c9dc5;for(const ch of String(value??"")){h^=ch.codePointAt(0);h=Math.imul(h,0x01000193)}return(h>>>0).toString(16).padStart(8,"0")}
export function normalizeRelativePath(path){
  const raw=String(path??"").replace(/\\/g,"/"),all=raw.split("/").filter(Boolean).filter(p=>p!=="."&&p!=="..").map(p=>sanitizeSegment(p,"item"));
  const maxSegments=64,maxLength=2048,out=[];let used=0,truncated=all.length>maxSegments;
  for(const seg0 of all.slice(0,maxSegments)){const sep=out.length?1:0,remaining=maxLength-used-sep;if(remaining<=0){truncated=true;break}let seg=seg0;if(seg.length>remaining){seg=seg.slice(0,remaining);truncated=true}out.push(seg);used+=sep+seg.length;if(seg.length<seg0.length)break}
  if(truncated&&out.length){const suffix=`__${fnv1a(raw)}`,sep=out.length>1?1:0,prefixLen=out.slice(0,-1).reduce((n,x)=>n+x.length,0)+Math.max(0,out.length-2),room=Math.max(suffix.length,Math.min(180,maxLength-prefixLen-sep));out[out.length-1]=`${out[out.length-1].slice(0,Math.max(1,room-suffix.length))}${suffix}`.slice(0,room)}
  return out.join("/")
}
export function pathSegments(path){return normalizeRelativePath(path).split("/").filter(Boolean)}
export function dirname(path){const p=normalizeRelativePath(path),i=p.lastIndexOf("/");return i<0?"":p.slice(0,i)}
export function joinPath(...parts){return parts.map(normalizeRelativePath).filter(Boolean).join("/")}
export function replaceExtWithMp3(name){return`${safeBase(name)}.mp3`}
export function isMp3(name){return/\.mp3$/i.test(String(name??""))}
export function extOf(name){const m=String(name??"").match(/\.([^.]+)$/);return m?m[1].toLowerCase():""}
export function csvEscape(value){let s=String(value??"");if(/^[\t\r\n ]*[=+\-@]/.test(s))s=`'${s}`;return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
export function hasPathSegment(path,segment){const needle=String(segment??"").toLocaleLowerCase();return pathSegments(path).some(p=>p.toLocaleLowerCase()===needle)}
export function isPathInside(path,parent){const p=normalizeRelativePath(path).toLocaleLowerCase(),root=normalizeRelativePath(parent).toLocaleLowerCase();return!!root&&(p===root||p.startsWith(`${root}/`))}
