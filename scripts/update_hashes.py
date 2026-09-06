from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[1]
manifest = root / 'SOURCE_HASHES_SHA256.txt'

SOURCE_SUFFIXES = {'.html', '.css', '.js', '.json', '.md', '.py', '.mjs', '.yml', '.yaml', '.bat'}
WEB_UPLOAD_METADATA = {'.gitignore', '.nojekyll'}


def relpath(p: Path) -> str:
    return p.relative_to(root).as_posix()


def excluded_repository_metadata(p: Path) -> bool:
    rel = relpath(p)
    return rel in WEB_UPLOAD_METADATA or rel.startswith('.github/')


def eligible(p: Path) -> bool:
    if not p.is_file() or p.resolve() == manifest.resolve():
        return False
    if '.git' in p.parts or excluded_repository_metadata(p):
        return False
    return p.suffix.lower() in SOURCE_SUFFIXES


files = [p for p in root.rglob('*') if eligible(p)]
lines = []
for p in sorted(files, key=relpath):
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    lines.append(f"{digest}  {relpath(p)}")

header = [
    '# SHA-256 source manifest — NativeMP3Converter V1.0.2',
    '# GitHub web-upload metadata intentionally excluded: .gitignore, .nojekyll, .github/**',
    '# Runtime/source files remain hash-enforced.',
]
manifest.write_text('\n'.join(header + lines) + '\n', encoding='utf-8')
print(f"WROTE {len(lines)} hashes (repository metadata excluded for GitHub web upload compatibility)")
