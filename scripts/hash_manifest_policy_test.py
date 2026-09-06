from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
manifest = root / 'SOURCE_HASHES_SHA256.txt'
text = manifest.read_text('utf-8')
entries = []
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith('#'):
        continue
    if '  ' not in line:
        print('FAIL malformed manifest line')
        sys.exit(1)
    entries.append(line.split('  ', 1)[1])

for forbidden in ('.gitignore', '.nojekyll'):
    if forbidden in entries:
        print('FAIL GitHub web-upload metadata is still hash-enforced:', forbidden)
        sys.exit(1)
if any(p.startswith('.github/') for p in entries):
    print('FAIL .github metadata is still hash-enforced')
    sys.exit(1)

required = {
    'index.html',
    'sw.js',
    'css/style.css',
    'js/app.js',
    'js/output-store.js',
    'js/mp3/native-mp3-encoder.js',
    'scripts/verify_hashes.py',
    'scripts/security_check.py',
}
missing = sorted(required - set(entries))
if missing:
    print('FAIL core files unexpectedly excluded from manifest:', ','.join(missing))
    sys.exit(1)

print('PASS GitHub web-upload manifest policy: repository metadata excluded; core source remains hash-enforced')
