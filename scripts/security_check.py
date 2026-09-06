from pathlib import Path
import re,sys
root=Path(__file__).resolve().parents[1]
files=[p for p in root.rglob('*') if p.is_file() and p.suffix.lower() in {'.js','.html','.css','.json','.yml','.yaml','.py','.bat','.md','.txt'}]
runtime=[root/'index.html',root/'sw.js',*list((root/'js').rglob('*.js'))]
secret_patterns={
 'private-key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'github-token':r'gh[pousr]_[A-Za-z0-9_]{30,}',
 'aws-access-key':r'AKIA[0-9A-Z]{16}',
 'google-api-key':r'AIza[0-9A-Za-z_-]{30,}',
}
for p in files:
    text=p.read_text('utf-8',errors='ignore')
    for name,pat in secret_patterns.items():
        if re.search(pat,text): print('FAIL possible secret',name,p);sys.exit(1)
for p in runtime:
    text=p.read_text('utf-8',errors='ignore')
    if re.search(r'fetch\s*\(\s*["\']https?://|XMLHttpRequest|new\s+WebSocket\s*\(',text,re.I): print('FAIL remote network egress primitive',p);sys.exit(1)
path=(root/'js/path-utils.js').read_text('utf-8');fp=(root/'js/fingerprint.js').read_text('utf-8');zipjs=(root/'js/zip-store.js').read_text('utf-8');recovery=(root/'js/recovery-store.js').read_text('utf-8');app=(root/'js/app.js').read_text('utf-8');commit=(root/'js/safe-file-commit.js').read_text('utf-8');sw=(root/'sw.js').read_text('utf-8');handles=(root/'js/handle-store.js').read_text('utf-8');outputs=(root/'js/output-store.js').read_text('utf-8')
if not re.search(r'\^\[\\t\\r\\n \]\*\[=\+\\-@\]',path): print('FAIL CSV injection guard missing');sys.exit(1)
if 'sha256-sample-v2:' not in fp or 'size>SLICE_BYTES*2' not in fp: print('FAIL sampled fingerprint markers missing');sys.exit(1)
for token in ['p==="."||p===".."','startsWith("/")','/^[A-Za-z]:/','ZIP 路徑不可為絕對路徑']:
    if token not in zipjs: print('FAIL ZIP traversal guard missing:',token);sys.exit(1)
for token in ['TTL_MS=7*24*60*60*1000','cleanupExpiredRecovery']:
    if token not in recovery: print('FAIL recovery TTL guard missing:',token);sys.exit(1)
for token in ['OUTPUT_TTL_MS=7*24*60*60*1000','isOutputRecordFresh','await deleteOutput(key);return null','updatedAt:Date.now()']:
    if token not in outputs: print('FAIL output TTL enforcement missing:',token);sys.exit(1)
for token in ['TTL_MS=30*24*60*60*1000','clearHandles','updatedAt:Date.now()']:
    if token not in handles: print('FAIL handle retention guard missing:',token);sys.exit(1)
for token in ['MAX_FILES=10000','BACKUP_PREFIX','commitValidatedBlob','recoveryOutputMatches','validateMp3Structure','openOutputLocation','hasLocatableOutput','cleanupSidecars','PART_PREFIX','BACKUP_PREFIX','permissionPaused']:
    if token not in app: print('FAIL app data-safety marker missing:',token);sys.exit(1)
for token in ['backupFileName','writeHandleBlob','commitValidatedBlob','removeEntry(plan.name)']:
    if token not in commit: print('FAIL safe-commit marker missing:',token);sys.exit(1)
for token in ['CACHE_PREFIX','chopper-native-mp3-v1-','k.startsWith(CACHE_PREFIX)','ASSET_URLS.has(url.href)','cache:"reload"']:
    if token not in sw: print('FAIL service-worker isolation marker missing:',token);sys.exit(1)
print('PASS secret-pattern scan')
print('PASS no explicit remote network egress')
print('PASS CSV formula-injection guard')
print('PASS ZIP traversal guard')
print('PASS Recovery / Output read-time TTL / Handle retention guards')
print('PASS direct-output backup/rollback / output-location markers')
print('PASS Service Worker origin-cache isolation / allow-list markers')
