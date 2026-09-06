"""Package a built Windows app using an explicit runtime allowlist."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = [
    'Micro Windows.exe', 'MicroHID.Windows.exe', 'MicroNetwork.Windows.exe', 'MicroInput.Windows.exe',
    'server.mjs', 'model.mjs', 'vendor.mjs', 'device-mapping.mjs', 'network.mjs', 'input.mjs',
    'public/index.html', 'public/app.js', 'public/style.css',
    'public/hardware.html', 'public/hardware.js', 'public/hardware.css', 'public/mapping-core.js',
    'runtime/node.exe', 'runtime/LICENSE.node.txt', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.build/release')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    subprocess.run([str(ROOT / 'runtime/node.exe'), str(ROOT / 'scripts/check-version.mjs')], check=True, cwd=ROOT)
    runtime_spec = json.loads((ROOT / 'runtime/node-version.json').read_text(encoding='utf-8'))
    with (ROOT / 'runtime/node.exe').open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != runtime_spec['sha256']:
            raise SystemExit('Runtime hash mismatch; run python build.py first.')
    files = {name: (ROOT / name).read_bytes() for name in RUNTIME}
    readme = (ROOT / 'scripts/portable-readme.md').read_text(encoding='utf-8').replace('@VERSION@', version)
    files['README.md'] = readme.encode('utf-8')
    args.output.mkdir(parents=True, exist_ok=True)
    asset = args.output / f'Micro-Windows-{version}-win-x64.zip'
    with zipfile.ZipFile(asset, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo('Micro Windows/' + name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    with zipfile.ZipFile(asset) as archive:
        if archive.testzip() is not None:
            raise SystemExit('ZIP verification failed')
        for name, data in files.items():
            if archive.read('Micro Windows/' + name) != data:
                raise SystemExit(f'ZIP content mismatch: {name}')
    sha = hashlib.sha256(asset.read_bytes()).hexdigest()
    (args.output / 'SHA256SUMS.txt').write_text(f'{sha}  {asset.name}\n', encoding='utf-8', newline='\n')
    print(f'Packaged {asset} ({len(files)} files)\nSHA256 {sha}', flush=True)


if __name__ == '__main__':
    main()
