"""Build and verify the Windows x64 executables with .NET Framework."""
import os
from pathlib import Path
import subprocess
import sys
import json
import shutil

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
    run(sys.executable, ROOT / 'scripts/prepare-desktop.py')
    node = ROOT / 'runtime/node.exe'
    run(node, ROOT / 'scripts/check-version.mjs')
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    assembly = ROOT / '.build/AssemblyInfo.cs'
    assembly.write_text('[assembly:System.Reflection.AssemblyVersion("' + version + '.0")]\n'
                        '[assembly:System.Reflection.AssemblyProduct("Micro Windows")]\n'
                        '[assembly:System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]\n', encoding='utf-8')
    base = [csc, '/nologo', '/optimize+', '/platform:x64', '/r:System.Web.Extensions.dll',
            '/win32manifest:' + str(ROOT / 'native/app.manifest')]
    metadata = sorted(Path('C:/Program Files (x86)/Windows Kits/10/UnionMetadata').glob('10.*/Windows.winmd'))
    if not metadata:
        raise SystemExit('Install the Windows 10/11 SDK (WinRT metadata is required for battery reads).')
    gac = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/assembly/GAC_MSIL'
    winrt = ['/r:' + str(metadata[-1]), '/r:' + str(csc.parent / 'System.Runtime.WindowsRuntime.dll')]
    for name in ['System.Runtime', 'System.Runtime.InteropServices.WindowsRuntime', 'System.Threading.Tasks']:
        winrt.append('/r:' + str(next((gac / name).glob('*/' + name + '.dll'))))
    targets = [
        ('MicroHID.Windows.exe', ['/target:exe'], ['HidDevice.cs', 'KeyboardOutput.cs', 'MicroHID.cs']),
        ('Micro Windows.exe', ['/target:winexe', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
                               '/r:' + str(ROOT / 'Microsoft.Web.WebView2.Core.dll'),
                               '/r:' + str(ROOT / 'Microsoft.Web.WebView2.WinForms.dll'),
                               '/win32icon:' + str(ROOT / 'assets/micro.ico'),
                               '/resource:' + str(ROOT / 'assets/micro.ico') + ',MicroWindows.Icon'], ['Launcher.cs']),
        ('MicroNetwork.Windows.exe', ['/target:exe', '/r:System.Windows.Forms.dll'], ['NetworkInfo.cs', 'NetworkRepair.cs']),
        ('MicroInput.Windows.exe', ['/target:exe', '/r:System.Windows.Forms.dll'], ['MicroInput.cs']),
        ('MicroSystem.Windows.exe', ['/target:exe', *winrt], ['MicroSystem.cs']),
        ('MicroUpdate.Windows.exe', ['/target:winexe'], ['MicroUpdate.cs']),
    ]
    for name, flags, sources in targets:
        run(*base, *flags, '/out:' + str(ROOT / name), assembly, *(ROOT / 'native' / file for file in sources))
    shutil.copyfile(ROOT / 'native/app.config', ROOT / 'Micro Windows.exe.config')
    for name in ['MicroHID.Windows.exe', 'MicroNetwork.Windows.exe', 'MicroInput.Windows.exe', 'MicroSystem.Windows.exe', 'MicroUpdate.Windows.exe']:
        run(ROOT / name, '--self-test')
    run(ROOT / 'Micro Windows.exe', '--check-files')
    run(ROOT / 'Micro Windows.exe', '--self-test')
    for file in [*ROOT.glob('*.mjs'), *(ROOT / 'scripts').glob('*.mjs')]:
        run(node, '--check', file)
    for file in (ROOT / 'public').glob('*.js'):
        # Browser entry points are loaded as modules; the shared UMD file is also required by Node.
        subprocess.run([str(node), '--input-type=module', '--check'], input=file.read_bytes(), cwd=ROOT, check=True)
    print('Built and checked all six Windows x64 executables.', flush=True)


if __name__ == '__main__':
    main()
