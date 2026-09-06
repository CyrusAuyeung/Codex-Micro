"""Extract a portable ZIP into an isolated Unicode path and run its smoke check."""
import argparse
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path, nargs='?')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    package = args.package or ROOT / '.build/release' / f'Micro-Windows-{version}-win-x64.zip'
    base = ROOT / '.build'
    base.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='安装包 核验-', dir=base))
    with zipfile.ZipFile(package) as archive:
        for entry in archive.infolist():
            parts = PurePosixPath(entry.filename)
            if parts.is_absolute() or '..' in parts.parts or parts.parts[0] != 'Micro Windows':
                raise SystemExit(f'Unexpected ZIP path: {entry.filename}')
            target = work / entry.filename
            if not target.resolve().is_relative_to(work.resolve()):
                raise SystemExit(f'Unsafe ZIP path: {entry.filename}')
            if not entry.is_dir():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
    app = work / 'Micro Windows'
    subprocess.run([str(app / 'Micro Windows.exe'), '--check-files'], check=True, cwd=work)
    subprocess.run([str(app / 'runtime/node.exe'), str(ROOT / 'scripts/package-smoke.mjs'), str(app), str(work)], check=True, cwd=work)


if __name__ == '__main__':
    main()
