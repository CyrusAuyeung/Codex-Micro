"""Stage an allowlisted app and compile the current-user Windows installer."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = [
    'Micro Windows.exe', 'Micro Windows.exe.config', 'MicroHID.Windows.exe', 'MicroNetwork.Windows.exe', 'MicroInput.Windows.exe',
    'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll',
    'package.json', 'app-info.mjs', 'updates.mjs', 'server.mjs', 'model.mjs', 'vendor.mjs', 'device-mapping.mjs', 'network.mjs', 'input.mjs',
    'public/index.html', 'public/app.js', 'public/style.css', 'public/desktop.js', 'public/desktop.css',
    'public/hardware.html', 'public/hardware.js', 'public/hardware.css', 'public/mapping-core.js',
    'runtime/node.exe', 'runtime/LICENSE.node.txt', 'runtime/LICENSE.webview2.txt', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.build/release')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    subprocess.run([str(ROOT / 'runtime/node.exe'), str(ROOT / 'scripts/check-version.mjs')], check=True, cwd=ROOT)
    spec = importlib.util.spec_from_file_location('desktop_deps', ROOT / 'scripts/prepare-desktop.py')
    deps = importlib.util.module_from_spec(spec); spec.loader.exec_module(deps)
    iscc = deps.compiler(); bootstrap = deps.fetch('MicrosoftEdgeWebview2Setup.exe')
    runtime_spec = json.loads((ROOT / 'runtime/node-version.json').read_text(encoding='utf-8'))
    if hashlib.sha256((ROOT / 'runtime/node.exe').read_bytes()).hexdigest() != runtime_spec['sha256']:
        raise SystemExit('Runtime hash mismatch; run python build.py first.')
    stage = Path(tempfile.mkdtemp(prefix='installer-stage-', dir=ROOT / '.build'))
    for name in RUNTIME:
        target = stage / name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / name).read_bytes())
    (stage / 'README.md').write_text((ROOT / 'installer/README.md').read_text(encoding='utf-8').replace('@VERSION@', version), encoding='utf-8')
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(iscc), '/Qp', '/DAppVersion=' + version, '/DStageDir=' + str(stage),
                    '/DOutputPath=' + str(args.output.resolve()), '/DBootstrapPath=' + str(bootstrap),
                    str(ROOT / 'installer/MicroWindows.iss')], check=True, cwd=ROOT)
    asset = args.output / f'Micro-Windows-{version}-Setup-x64.exe'
    sha = hashlib.sha256(asset.read_bytes()).hexdigest()
    (args.output / 'SHA256SUMS.txt').write_text(f'{sha}  {asset.name}\n', encoding='utf-8', newline='\n')
    print(f'Packaged {asset} ({asset.stat().st_size / 1048576:.1f} MiB)\nSHA256 {sha}', flush=True)


if __name__ == '__main__':
    main()
