"""Fetch pinned desktop build inputs and stage the WebView2 SDK (not the browser)."""
import hashlib
from pathlib import Path
import shutil
import urllib.request
import zipfile
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / '.build/downloads'
INPUTS = {
    'webview2.nupkg': ('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4191.47/microsoft.web.webview2.1.0.4191.47.nupkg', 'f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0'),
    'MicrosoftEdgeWebview2Setup.exe': ('https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/474c9f1d-0fd5-49da-b3b0-df536d328170/MicrosoftEdgeWebview2Setup.exe', '17debf797a6c737959bc588236e897936ffac1af5f7e515e674ab32f9edfe719'),
    'innosetup-7.1.0-x64.exe': ('https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe', '0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f'),
}


def fetch(name):
    url, digest = INPUTS[name]
    target = DOWNLOADS / name
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        with urllib.request.urlopen(url, timeout=90) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != digest:
            raise SystemExit(f'Unexpected checksum: {name}')
        target.write_bytes(content)
    return target


def main():
    sdk = fetch('webview2.nupkg')
    with zipfile.ZipFile(sdk) as archive:
        for source, target in {
            'lib/net462/Microsoft.Web.WebView2.Core.dll': 'Microsoft.Web.WebView2.Core.dll',
            'lib/net462/Microsoft.Web.WebView2.WinForms.dll': 'Microsoft.Web.WebView2.WinForms.dll',
            'runtimes/win-x64/native/WebView2Loader.dll': 'WebView2Loader.dll',
            'LICENSE.txt': 'runtime/LICENSE.webview2.txt',
        }.items():
            (ROOT / target).write_bytes(archive.read(source))
    print('WebView2 SDK 1.0.4191.47 verified and staged.')


def compiler():
    target = ROOT / '.build/tools/inno/ISCC.exe'
    if not target.is_file():
        installer = fetch('innosetup-7.1.0-x64.exe')
        subprocess.run([str(installer), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/NOICONS',
                        '/DIR=' + str(target.parent)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    return target


if __name__ == '__main__':
    main()
