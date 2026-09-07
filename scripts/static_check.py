from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1]
required=[root/'index.html',root/'css/style.css',root/'js/app.bundle.js',root/'js/app.js',root/'js/boot-check.js',root/'js/native-audio-decoder.js',root/'js/pcm-safety.js',root/'js/wav-stream.js',root/'js/gsm610-decoder.js',root/'js/wav-mp3-streamer.js',root/'js/safe-file-commit.js',root/'js/mp3/native-mp3-encoder.js',root/'js/mp3/mp3-validator.js',root/'js/mp3/analysis-window.js',root/'js/mp3/encoder-worker.js',root/'js/zip-store.js',root/'js/output-store.js',root/'js/recovery-store.js',root/'js/path-utils.js',root/'js/fingerprint.js',root/'js/handle-store.js',root/'sw.js',root/'scripts/build_classic_bundle.py',root/'scripts/self_test.mjs',root/'scripts/dom_boot_test.mjs',root/'scripts/output_folder_workflow_test.mjs',root/'scripts/same_folder_workflow_test.mjs',root/'scripts/picker_id_limit_test.mjs',root/'scripts/wav_compatibility_test.mjs',root/'scripts/gsm610_compatibility_test.mjs',root/'scripts/external_codec_test.mjs',root/'scripts/adversarial_test.mjs',root/'scripts/output_ttl_test.mjs',root/'scripts/hash_manifest_policy_test.py',root/'scripts/classic_bundle_boot_test.mjs',root/'scripts/security_check.py',root/'scripts/update_hashes.py',root/'scripts/verify_hashes.py',root/'start_local.bat',root/'README.md',root/'SECURITY.md',root/'SECURITY_AUDIT_V1.0.md',root/'SECURITY_AUDIT_V1.0.4.md',root/'SECURITY_AUDIT_V1.0.5.md',root/'SECURITY_AUDIT_V1.0.6.md',root/'GITHUB_UPLOAD_GUIDE.md']
for p in required:
    if not p.exists(): print('FAIL missing',p);sys.exit(1)
runtime=[root/'index.html',root/'sw.js',root/'js/app.bundle.js',root/'js/boot-check.js',root/'css/style.css']
for p in runtime:
    text=p.read_text('utf-8')
    if re.search(r'https?://',text,re.I): print('FAIL runtime remote URL:',p);sys.exit(1)
    for pat,label in [(r'\beval\s*\(','eval'),(r'new\s+Function\b','Function constructor'),(r'document\.write\s*\(','document.write'),(r'\.innerHTML\s*=','innerHTML assignment'),(r'\.outerHTML\s*=','outerHTML assignment'),(r'insertAdjacentHTML\s*\(','insertAdjacentHTML')]:
        if re.search(pat,text): print('FAIL dangerous DOM/code sink',label,p);sys.exit(1)
for p in root.rglob('*'):
    if p.is_file() and (p.suffix.lower()=='.wasm' or 'ffmpeg-core' in p.name.lower()): print('FAIL forbidden runtime binary:',p);sys.exit(1)
index=(root/'index.html').read_text('utf-8')
for token in ['V1.0.6｜GSM 6.10 WAV Compatibility Edition','id="folderInput"','id="openWorkspaceBtn"','id="outputMode"','id="authorizeSourceBtn"','id="openOutputLocationBtn"','id="forgetFoldersBtn"','id="resumeMode"','id="autoSave"','id="bitrate"','id="searchInput"','id="stopScanBtn"','id="retryFailedBtn"','id="cleanupSidecarsBtn"','id="outputResultsPanel"','id="memoryPolicyState"','第三方套件 0','Content-Security-Policy',"frame-src 'none'","script-src 'self'","worker-src 'self' blob:","object-src 'none'",'name="referrer" content="no-referrer"','<script defer src="./js/app.bundle.js"></script>']:
    if token not in index: print('FAIL index marker missing:',token);sys.exit(1)
if '<script type="module"' in index or 'src="./js/app.js"' in index: print('FAIL runtime still uses ES Module app boot');sys.exit(1)
if "'unsafe-inline'" in index or "'unsafe-eval'" in index: print('FAIL weak CSP');sys.exit(1)
if re.search(r'\son[a-z]+\s*=',index,re.I): print('FAIL inline event handler in HTML');sys.exit(1)
source=(root/'js/app.js').read_text('utf-8');bundle=(root/'js/app.bundle.js').read_text('utf-8')
html_ids=set(re.findall(r'id="([^"]+)"',index));queried=set(re.findall(r'\$\("#([^"]+)"\)',source));missing=sorted(queried-html_ids)
if missing: print('FAIL app queries missing DOM ids:',','.join(missing));sys.exit(1)
for js in [p for p in (root/'js').rglob('*.js') if p.name!='app.bundle.js']:
    text=js.read_text('utf-8')
    for rel in re.findall(r'(?:from\s+|import\s*\()["\'](\.[^"\']+\.js)["\']',text):
        if not (js.parent/rel).resolve().exists(): print('FAIL unresolved source JS import:',js,rel);sys.exit(1)
for token in ['streamWavToMp3','inspectWavFile','validateMp3Structure','PART_PREFIX','BACKUP_PREFIX','MAX_FILES','commitValidatedBlob','activeAbortController','fileSizeLimit','recoveryOutputMatches','autoExportCompleted','source-mp3-protected','native-0.4.1','openOutputLocation','locateItemOutput','cleanupSidecars','retryFailedItems','renderOutputResults','refreshOutputDestinationState','showDirectoryPicker({mode:"read",startIn','authorizeSameFolderForCurrentItems','cmp3-v1-source']:
    if token not in source: print('FAIL source marker missing:',token);sys.exit(1)
for token in ['ENCODER_WORKER_SOURCE','new Blob([ENCODER_WORKER_SOURCE]','new Worker(workerURL)','window.__AUDIO_MP3_APP_READY__=true']:
    if token not in bundle: print('FAIL classic bundle marker missing:',token);sys.exit(1)
if 'import.meta' in bundle or re.search(r'\btype\s*:\s*["\']module["\']',bundle): print('FAIL module-only runtime marker remains in bundle');sys.exit(1)
for rel,token in [('js/output-store.js','chopper-native-mp3-v1-output'),('js/recovery-store.js','chopper-native-mp3-v1-recovery'),('js/handle-store.js','chopper-native-mp3-v1-handles')]:
    if token not in (root/rel).read_text('utf-8'): print('FAIL fresh DB namespace missing:',rel,token);sys.exit(1)
output_store=(root/'js/output-store.js').read_text('utf-8')
for token in ['OUTPUT_TTL_MS=7*24*60*60*1000','isOutputRecordFresh','await deleteOutput(key);return null','const rec={blob,...meta,updatedAt:Date.now()}']:
    if token not in output_store: print('FAIL output-store read-time TTL marker missing:',token);sys.exit(1)
gsm=(root/'js/gsm610-decoder.js').read_text('utf-8')
for token in ['Gsm610Decoder','unpackMsGsmBlock','decodeMsBlock','formatTag:49','blockAlign:65','samplesPerBlock:320']:
    if token not in gsm: print('FAIL GSM610 decoder marker missing:',token);sys.exit(1)
enc=(root/'js/mp3/native-mp3-encoder.js').read_text('utf-8')
for token in ['StreamingMp3Encoder','coreVersion:"0.4.1"','sampleRates:[32000,44100,48000]','encodeMp3']:
    if token not in enc: print('FAIL encoder marker missing:',token);sys.exit(1)
sw=(root/'sw.js').read_text('utf-8')
for token in ['chopper-native-mp3-v1-cache-7-gsm610-wav','CACHE_PREFIX','k.startsWith(CACHE_PREFIX)','cache:"reload"','ASSET_URLS','!ASSET_URLS.has(url.href)','ACTIVATE_UPDATE','e.request.mode==="navigate"','cache:"no-store"','./js/app.bundle.js']:
    if token not in sw: print('FAIL service worker marker missing:',token);sys.exit(1)
if any(x in sw for x in ['native-audio-decoder.js','encoder-worker.js','analysis-window.js']): print('FAIL Service Worker still requires source module graph');sys.exit(1)
pkg=json.loads((root/'package.json').read_text('utf-8'))
if pkg.get('version')!='1.0.6': print('FAIL package version');sys.exit(1)
if pkg.get('dependencies') or pkg.get('devDependencies'): print('FAIL npm dependencies present');sys.exit(1)
print('PASS runtime remote URL = 0')
print('PASS dangerous DOM/code sinks = 0')
print('PASS strict CSP / Blob Worker only')
print('PASS no FFmpeg/WASM runtime assets')
print('PASS single classic runtime bundle / no ES-module boot graph')
print('PASS Service Worker minimal runtime allow-list')
print('PASS zero npm dependencies')
print('PASS NativeMP3Converter V1.0.6 classic-bundle / GSM610-WAV / telephony-WAV / same-folder UX / picker-ID / TTL / output markers')
