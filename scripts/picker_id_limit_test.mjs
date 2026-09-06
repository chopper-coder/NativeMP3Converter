import assert from "node:assert/strict";
import fs from "node:fs";

const files=["js/app.js","js/app.bundle.js"];
const all=[];
for(const file of files){
  const text=fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
  for(const m of text.matchAll(/show(?:Directory|OpenFile|SaveFile)Picker\s*\(\s*\{[\s\S]{0,400}?\bid\s*:\s*["']([^"']+)["']/g)){
    all.push({file,id:m[1]});
  }
}
assert.ok(all.length>=4,"expected File System Access picker ids");
for(const {file,id} of all){
  assert.ok(id.length<=32,`${file}: picker id exceeds 32 chars (${id.length}): ${id}`);
  assert.match(id,/^[A-Za-z0-9_-]+$/,`${file}: picker id contains unsupported/unstable characters: ${id}`);
}
const sourceIds=[...new Set(all.filter(x=>x.file==="js/app.js").map(x=>x.id))];
assert.deepEqual(sourceIds.sort(),["cmp3-v1-locate-item","cmp3-v1-locate-output","cmp3-v1-output","cmp3-v1-workspace"].sort());
console.log(`PASS picker ID compatibility: ${sourceIds.length} unique IDs, max ${Math.max(...sourceIds.map(x=>x.length))}/32 chars`);
