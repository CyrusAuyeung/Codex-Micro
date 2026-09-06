"""Install, reinstall and uninstall in an isolated directory; refuse existing installs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
import winreg

ROOT = Path(__file__).resolve().parents[1]
UNINSTALL = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{80A07802-0732-482B-ADF1-66CF664AB34C}_is1'


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path, nargs='?')
    args = parser.parse_args()
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY):
            raise SystemExit('An installed Micro Windows exists. Run installer verification on a clean Windows user or CI runner.')
    except FileNotFoundError:
        pass
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    package = (args.package or ROOT / '.build/release' / f'Micro-Windows-{version}-Setup-x64.exe').resolve()
    sha = hashlib.sha256(package.read_bytes()).hexdigest()
    if (package.parent / 'SHA256SUMS.txt').read_text(encoding='utf-8') != f'{sha}  {package.name}\n':
        raise SystemExit('Installer hash mismatch')
    work = Path(tempfile.mkdtemp(prefix='安装 核验-', dir=ROOT / '.build')); app = work / 'Micro Windows'
    profile = Path(os.environ['LOCALAPPDATA']) / 'Micro Windows'; profile.mkdir(exist_ok=True)
    marker = profile / ('installer-smoke-' + uuid.uuid4().hex + '.txt')
    marker.write_text('preserve existing user settings', encoding='utf-8')
    flags = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/TASKS=!desktopicon', '/DIR=' + str(app)]
    try:
        run(package, *flags, '/LOG=' + str(work / 'install.log'))
        run(app / 'Micro Windows.exe', '--check-files')
        run(app / 'runtime/node.exe', ROOT / 'scripts/package-smoke.mjs', app, work)
        files = [file for file in app.rglob('*') if file.is_file() and not file.name.startswith('unins')]
        before = {str(file.relative_to(app)): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
        run(package, *flags, '/LOG=' + str(work / 'upgrade.log'))
        assert marker.read_text(encoding='utf-8') == 'preserve existing user settings'
        for name, digest in before.items():
            assert hashlib.sha256((app / name).read_bytes()).hexdigest() == digest, name
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            assert winreg.QueryValueEx(key, 'DisplayVersion')[0] == version
        run(app / 'unins000.exe', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=' + str(work / 'uninstall.log'))
        assert not (app / 'Micro Windows.exe').exists()
        assert marker.read_text(encoding='utf-8') == 'preserve existing user settings'
        print(f'Installer {version}: install, application smoke, overwrite, current-user registration and uninstall/data preservation passed.')
    finally:
        marker.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
