from pathlib import Path
import hashlib
import sys

root = Path(__file__).resolve().parents[1]
manifest = root / 'SOURCE_HASHES_SHA256.txt'
SOURCE_SUFFIXES = {'.html', '.css', '.js', '.json', '.md', '.py', '.mjs', '.yml', '.yaml', '.bat'}
WEB_UPLOAD_METADATA = {'.gitignore', '.nojekyll'}


def full_hex(s):
    return len(s) == 64 and all(c in '0123456789abcdef' for c in s)


def rel(p):
    return p.relative_to(root).as_posix()


def excluded_repository_metadata(p):
    r = rel(p)
    return r in WEB_UPLOAD_METADATA or r.startswith('.github/')


def eligible(p):
    if not p.is_file() or p.resolve() == manifest.resolve():
        return False
    if '.git' in p.parts or excluded_repository_metadata(p):
        return False
    return p.suffix.lower() in SOURCE_SUFFIXES


if not manifest.exists():
    print('FAIL hash manifest missing')
    sys.exit(1)

expected = {}
for raw in manifest.read_text('utf-8').splitlines():
    line = raw.strip()
    if not line or line.startswith('#'):
        continue
    if '  ' not in line:
        print('FAIL malformed hash line:', raw)
        sys.exit(1)
    digest, hpath = line.split('  ', 1)
    if not full_hex(digest):
        print('FAIL malformed SHA-256:', hpath)
        sys.exit(1)
    if hpath in expected:
        print('FAIL duplicate hash path:', hpath)
        sys.exit(1)
    if hpath in WEB_UPLOAD_METADATA or hpath.startswith('.github/'):
        print('FAIL repository metadata must not be hash-enforced:', hpath)
        sys.exit(1)
    expected[hpath] = digest

actual_files = {rel(p): p for p in root.rglob('*') if eligible(p)}
missing = sorted(set(actual_files) - set(expected))
extra = sorted(set(expected) - set(actual_files))
if missing:
    print('FAIL unhashed source files:', ','.join(missing))
    sys.exit(1)
if extra:
    print('FAIL manifest references missing/ineligible files:', ','.join(extra))
    sys.exit(1)

for hpath, p in sorted(actual_files.items()):
    actual = hashlib.sha256(p.read_bytes()).hexdigest()
    if actual != expected[hpath]:
        print('FAIL SHA-256 mismatch:', hpath)
        sys.exit(1)

print(f'PASS SHA-256 source manifest ({len(actual_files)} files; GitHub repository metadata excluded)')
