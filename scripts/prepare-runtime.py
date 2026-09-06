"""Install the pinned official Node.js runtime, checking its SHA-256."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / 'runtime/node-version.json').read_text(encoding='utf-8'))
TARGET = ROOT / 'runtime/node.exe'


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare():
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.is_file() and sha256(TARGET) == SPEC['sha256']:
        print(f"Node.js {SPEC['version']} ready (SHA-256 verified).", flush=True)
        return
    temporary = TARGET.with_suffix('.download')
    source = os.environ.get('MICRO_NODE_SOURCE')
    if source:
        shutil.copyfile(source, temporary)
    else:
        url = f"https://nodejs.org/dist/v{SPEC['version']}/{SPEC['platform']}/node.exe"
        print(f'Downloading {url}', flush=True)
        with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
    actual = sha256(temporary)
    if actual != SPEC['sha256']:
        raise SystemExit(f'Node.js SHA-256 mismatch: {actual}; expected {SPEC["sha256"]}')
    temporary.replace(TARGET)
    print(f"Node.js {SPEC['version']} installed (SHA-256 verified).", flush=True)


if __name__ == '__main__':
    prepare()
