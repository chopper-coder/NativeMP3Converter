from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1]
required=[root/'index.html',root/'css/style.css',root/'js/app.js',root/'js/boot-check.js',root/'js/native-audio-decoder.js',root/'js/pcm-safety.js',root/'js/wav-stream.js',root/'js/wav-mp3-streamer.js',root/'js/safe-file-commit.js',root/'js/mp3/native-mp3-encoder.js',root/'js/mp3/mp3-validator.js',root/'js/mp3/analysis-window.js',root/'js/mp3/encoder-worker.js',root/'js/zip-store.js',root/'js/output-store.js',root/'js/recovery-store.js',root/'js/path-utils.js',root/'js/fingerprint.js',root/'js/handle-store.js',root/'sw.js',root/'scripts/self_test.mjs',root/'scripts/dom_boot_test.mjs',root/'scripts/output_folder_workflow_test.mjs',root/'scripts/external_codec_test.mjs',root/'scripts/adversarial_test.mjs',root/'scripts/output_ttl_test.mjs',root/'scripts/hash_manifest_policy_test.py',root/'scripts/direct_module_boot_test.mjs',root/'scripts/security_check.py',root/'scripts/update_hashes.py',root/'scripts/verify_hashes.py',root/'start_local.bat',root/'README.md',root/'SECURITY.md',root/'SECURITY_AUDIT_V1.0.md',root/'GITHUB_UPLOAD_GUIDE.md']
for p in required:
    if not p.exists(): print('FAIL missing',p);sys.exit(1)
runtime=[root/'index.html',root/'sw.js',*list((root/'js').rglob('*.js'))]
for p in runtime:
    text=p.read_text('utf-8')
    if re.search(r'https?://',text,re.I): print('FAIL runtime remote URL:',p);sys.exit(1)
    for pat,label in [(r'\beval\s*\(','eval'),(r'new\s+Function\b','Function constructor'),(r'document\.write\s*\(','document.write'),(r'\.innerHTML\s*=','innerHTML assignment'),(r'\.outerHTML\s*=','outerHTML assignment'),(r'insertAdjacentHTML\s*\(','insertAdjacentHTML')]:
        if re.search(pat,text): print('FAIL dangerous DOM/code sink',label,p);sys.exit(1)
for p in root.rglob('*'):
    if p.is_file() and (p.suffix.lower()=='.wasm' or 'ffmpeg-core' in p.name.lower()): print('FAIL forbidden runtime binary:',p);sys.exit(1)
index=(root/'index.html').read_text('utf-8')
for token in ['V1.0.1｜Direct Module Boot Hotfix','id="folderInput"','id="openWorkspaceBtn"','id="outputMode"','id="openOutputLocationBtn"','id="forgetFoldersBtn"','id="resumeMode"','id="autoSave"','id="bitrate"','id="searchInput"','id="stopScanBtn"','id="retryFailedBtn"','id="cleanupSidecarsBtn"','id="outputResultsPanel"','id="memoryPolicyState"','第三方套件 0','Content-Security-Policy','frame-src \'none\'','script-src \'self\'','object-src \'none\'','name="referrer" content="no-referrer"']:
    if token not in index: print('FAIL index marker missing:',token);sys.exit(1)
if "'unsafe-inline'" in index or "'unsafe-eval'" in index: print('FAIL weak CSP');sys.exit(1)
if re.search(r'\son[a-z]+\s*=',index,re.I): print('FAIL inline event handler in HTML');sys.exit(1)
app=(root/'js/app.js').read_text('utf-8')
html_ids=set(re.findall(r'id="([^"]+)"',index));queried=set(re.findall(r'\$\("#([^"]+)"\)',app));missing=sorted(queried-html_ids)
if missing: print('FAIL app queries missing DOM ids:',','.join(missing));sys.exit(1)
for js in (root/'js').rglob('*.js'):
    text=js.read_text('utf-8')
    for rel in re.findall(r'(?:from\s+|import\s*\()["\'](\.[^"\']+\.js)["\']',text):
        if not (js.parent/rel).resolve().exists(): print('FAIL unresolved JS import:',js,rel);sys.exit(1)
for token in ['streamWavToMp3','inspectWavFile','validateMp3Structure','PART_PREFIX','BACKUP_PREFIX','MAX_FILES','commitValidatedBlob','activeAbortController','fileSizeLimit','recoveryOutputMatches','autoExportCompleted','source-mp3-protected','native-0.4.1','openOutputLocation','locateItemOutput','cleanupSidecars','retryFailedItems','renderOutputResults','refreshOutputDestinationState','showDirectoryPicker({mode:"read",startIn']:
    if token not in app: print('FAIL app marker missing:',token);sys.exit(1)


for rel,token in [('js/output-store.js','chopper-native-mp3-v1-output'),('js/recovery-store.js','chopper-native-mp3-v1-recovery'),('js/handle-store.js','chopper-native-mp3-v1-handles')]:
    if token not in (root/rel).read_text('utf-8'): print('FAIL fresh DB namespace missing:',rel,token);sys.exit(1)
for token in ['chopper-native-mp3-v1-workspace','chopper-native-mp3-v1-output','chopper-native-mp3-v1-locate-output','chopper-native-mp3-v1-locate-item','updateViaCache:"none"']:
    if token not in app: print('FAIL fresh picker/SW marker missing:',token);sys.exit(1)

output_store=(root/'js/output-store.js').read_text('utf-8')
for token in ['OUTPUT_TTL_MS=7*24*60*60*1000','isOutputRecordFresh','await deleteOutput(key);return null','const rec={blob,...meta,updatedAt:Date.now()}']:
    if token not in output_store: print('FAIL output-store read-time TTL marker missing:',token);sys.exit(1)
decoder=(root/'js/native-audio-decoder.js').read_text('utf-8')
for token in ['SUPPORTED_NATIVE_RATES','decoded.sampleRate','targetRate']:
    if token not in decoder: print('FAIL decoder source-rate marker missing:',token);sys.exit(1)
enc=(root/'js/mp3/native-mp3-encoder.js').read_text('utf-8')
for token in ['StreamingMp3Encoder','coreVersion:"0.4.1"','sampleRates:[32000,44100,48000]','encodeMp3']:
    if token not in enc: print('FAIL encoder marker missing:',token);sys.exit(1)
sw=(root/'sw.js').read_text('utf-8')
for token in ['chopper-native-mp3-v1-cache-2','CACHE_PREFIX','k.startsWith(CACHE_PREFIX)','cache:"reload"','ASSET_URLS','!ASSET_URLS.has(url.href)','ACTIVATE_UPDATE','e.request.mode==="navigate"','cache:"no-store"','wav-stream.js','safe-file-commit.js','mp3-validator.js']:
    if token not in sw: print('FAIL service worker marker missing:',token);sys.exit(1)
manifest_policy=(root/'scripts/verify_hashes.py').read_text('utf-8')
for token in ["WEB_UPLOAD_METADATA = {'.gitignore', '.nojekyll'}", "r.startswith('.github/')", "repository metadata must not be hash-enforced"]:
    if token not in manifest_policy: print('FAIL GitHub web-upload manifest policy marker missing:',token);sys.exit(1)
pkg=json.loads((root/'package.json').read_text('utf-8'))
if pkg.get('dependencies') or pkg.get('devDependencies'): print('FAIL npm dependencies present');sys.exit(1)
print('PASS runtime remote URL = 0')
print('PASS dangerous DOM/code sinks = 0')
print('PASS strict CSP / no inline handlers')
print('PASS no FFmpeg/WASM runtime assets')
print('PASS Service Worker cache allow-list')
print('PASS zero npm dependencies')

if '<script type="module" src="./js/app.js"></script>' not in index: print('FAIL direct module boot tag missing');sys.exit(1)
if 'bootstrap.js' in index: print('FAIL legacy bootstrap still referenced by index');sys.exit(1)
if (root/'js/bootstrap.js').exists(): print('FAIL legacy bootstrap file should not ship');sys.exit(1)
print('PASS NativeMP3Converter V1.0.1 direct-module / fresh namespace / branch-deploy / TTL / output markers')
