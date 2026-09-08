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
import shutil
import ctypes
from ctypes import wintypes
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
UNINSTALL = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{80A07802-0732-482B-ADF1-66CF664AB34C}_is1'
STARTUP = r'Software\Microsoft\Windows\CurrentVersion\Run'


def startup_value():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP) as key:
            return winreg.QueryValueEx(key, 'Micro Windows')[0]
    except FileNotFoundError:
        return None


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path, nargs='?')
    args = parser.parse_args()
    try:
        with urllib.request.urlopen('http://127.0.0.1:18414/api/health', timeout=1) as response:
            if json.load(response).get('app') == 'codex-micro-windows-panel':
                raise SystemExit('A production Micro Windows is running. Installer verification will not close it.')
    except (urllib.error.URLError, OSError, ValueError):
        pass
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY):
            raise SystemExit('An installed Micro Windows exists. Run installer verification on a clean Windows user or CI runner.')
    except FileNotFoundError:
        pass
    if startup_value() is not None:
        raise SystemExit('A Micro Windows startup entry exists. Use a clean Windows user for installer verification.')
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
        assert startup_value() is None, 'A fresh install must not enable startup'
        run(app / 'MicroSystem.Windows.exe', '--startup-on')
        expected_startup = f'"{app / "Micro Windows.exe"}" --background'
        assert startup_value() == expected_startup, 'Startup command must quote paths with spaces'
        files = [file for file in app.rglob('*') if file.is_file() and not file.name.startswith('unins')]
        before = {str(file.relative_to(app)): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
        run(package, *flags, '/LOG=' + str(work / 'upgrade.log'))
        assert startup_value() == expected_startup, 'Reinstall must preserve startup preference'
        assert marker.read_text(encoding='utf-8') == 'preserve existing user settings'
        for name, digest in before.items():
            assert hashlib.sha256((app / name).read_bytes()).hexdigest() == digest, name
        # Exercise the same external runner used by the desktop updater, without
        # starting a production keyboard service or touching real key mappings.
        updates = work / 'updates'; runner = updates / ('runner-' + uuid.uuid4().hex)
        runner.mkdir(parents=True)
        installer = updates / package.name; shutil.copyfile(package, installer)
        program = runner / 'MicroUpdate.Windows.exe'; shutil.copyfile(app / program.name, program)
        parent = subprocess.Popen([str(ROOT / 'runtime/node.exe'), '-e', 'setTimeout(()=>{},1500)'], creationflags=subprocess.CREATE_NO_WINDOW)
        creation, finish, kernel, user = (wintypes.FILETIME() for _ in range(4))
        assert ctypes.windll.kernel32.GetProcessTimes(wintypes.HANDLE(int(parent._handle)), ctypes.byref(creation), ctypes.byref(finish), ctypes.byref(kernel), ctypes.byref(user))
        ticks = (creation.dwHighDateTime << 32 | creation.dwLowDateTime) + 504911232000000000
        ticket = runner / 'ticket.json'
        ticket.write_text(json.dumps(dict(file=str(installer), sha256=sha, size=installer.stat().st_size, version=version, appDirectory=str(app), parentPid=parent.pid, parentStart=str(ticks), restart=False)), encoding='utf-8')
        helper = subprocess.Popen([str(program), str(ticket)], creationflags=subprocess.CREATE_NO_WINDOW)
        time.sleep(.4)
        assert helper.poll() is None, 'Updater must wait for its original process to exit'
        assert not (updates / 'install-result.json').exists()
        parent.wait(timeout=10)
        assert helper.wait(timeout=120) == 0, (updates / 'install-result.json').read_text(encoding='utf-8')
        assert json.loads((updates / 'install-result.json').read_text(encoding='utf-8'))['error'] is None
        assert startup_value() == expected_startup, 'In-app update must preserve login startup preference'
        for name, digest in before.items():
            assert hashlib.sha256((app / name).read_bytes()).hexdigest() == digest, name
        installer.write_bytes(b'tampered installer')
        assert subprocess.run([str(program), str(ticket)], creationflags=subprocess.CREATE_NO_WINDOW).returncode == 1
        assert '校验失败' in json.loads((updates / 'install-result.json').read_text(encoding='utf-8'))['error']
        assert marker.read_text(encoding='utf-8') == 'preserve existing user settings'
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            assert winreg.QueryValueEx(key, 'DisplayVersion')[0] == version
        run(app / 'MicroSystem.Windows.exe', '--startup-off')
        assert startup_value() is None, 'Turning off startup must remove the entry'
        run(app / 'MicroSystem.Windows.exe', '--startup-on')
        run(app / 'unins000.exe', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=' + str(work / 'uninstall.log'))
        assert not (app / 'Micro Windows.exe').exists()
        assert marker.read_text(encoding='utf-8') == 'preserve existing user settings'
        assert startup_value() is None, 'Uninstall must remove the startup entry'
        print(f'Installer {version}: install, application smoke, overwrite, external update runner/wait/hash checks, startup on/off/preservation, uninstall cleanup and data preservation passed.')
    finally:
        # Even a failed test must not leave this temporary installation in the login startup list.
        if startup_value() == f'"{app / "Micro Windows.exe"}" --background':
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, 'Micro Windows')
        marker.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
