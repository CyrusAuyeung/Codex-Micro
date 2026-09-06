"""Build and verify the Windows x64 executables with .NET Framework."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def run(*args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def main():
    if os.name != 'nt':
        raise SystemExit('Build on Windows 10 / 11 x64 or a Windows GitHub Actions runner.')
    csc = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if not csc.is_file():
        raise SystemExit(f'Missing .NET Framework C# compiler: {csc}')
    run(sys.executable, ROOT / 'scripts/prepare-runtime.py')
    node = ROOT / 'runtime/node.exe'
    run(node, ROOT / 'scripts/check-version.mjs')
    base = [csc, '/nologo', '/optimize+', '/platform:x64', '/r:System.Web.Extensions.dll',
            '/win32manifest:' + str(ROOT / 'native/app.manifest')]
    targets = [
        ('MicroHID.Windows.exe', ['/target:exe'], ['HidDevice.cs', 'KeyboardOutput.cs', 'MicroHID.cs']),
        ('Micro Windows.exe', ['/target:winexe', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll'], ['Launcher.cs']),
        ('MicroNetwork.Windows.exe', ['/target:exe', '/r:System.Windows.Forms.dll'], ['NetworkInfo.cs', 'NetworkRepair.cs']),
        ('MicroInput.Windows.exe', ['/target:exe', '/r:System.Windows.Forms.dll'], ['MicroInput.cs']),
    ]
    for name, flags, sources in targets:
        run(*base, *flags, '/out:' + str(ROOT / name), *(ROOT / 'native' / file for file in sources))
    for name in ['MicroHID.Windows.exe', 'MicroNetwork.Windows.exe', 'MicroInput.Windows.exe']:
        run(ROOT / name, '--self-test')
    run(ROOT / 'Micro Windows.exe', '--check-files')
    for file in [*ROOT.glob('*.mjs'), *(ROOT / 'public').glob('*.js'), *(ROOT / 'scripts').glob('*.mjs')]:
        run(node, '--check', file)
    print('Built and checked all four Windows x64 executables.', flush=True)


if __name__ == '__main__':
    main()
