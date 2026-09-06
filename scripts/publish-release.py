"""Publish an already verified release artifact from the checked-out commit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def command(*args):
    return subprocess.check_output(list(args), cwd=ROOT, text=True, encoding='utf-8').strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    version = os.environ['MICRO_RELEASE_VERSION']
    commit = os.environ['MICRO_RELEASE_COMMIT']
    repository = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise SystemExit('Invalid version or commit')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise SystemExit('Invalid repository')
    current = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if version != current or command('git', 'rev-parse', 'HEAD') != commit:
        raise SystemExit('Release version and commit must match this checkout')
    tag = 'v' + version
    existing = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{tag}^{{commit}}'], cwd=ROOT, capture_output=True, text=True)
    if existing.returncode == 0 and existing.stdout.strip() != commit:
        raise SystemExit(f'{tag} already points to another commit')
    folder = ROOT / '.build/release'
    asset = folder / f'Micro-Windows-{version}-win-x64.zip'
    checksum = folder / 'SHA256SUMS.txt'
    sha = hashlib.sha256(asset.read_bytes()).hexdigest()
    if checksum.read_text(encoding='utf-8') != f'{sha}  {asset.name}\n':
        raise SystemExit('Release asset checksum mismatch')
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    section = re.search(r'^## ' + re.escape(version) + r'\s*\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
    if not section or not section.group(1).strip():
        raise SystemExit('Missing release notes')
    notes = folder / 'release-notes.md'
    notes.write_text(section.group(1).strip() + f'\n\n下载 **{asset.name}**，完整解压后双击 **Micro Windows.exe**。\n', encoding='utf-8', newline='\n')
    if args.dry_run:
        print(f'Ready: {repository} {tag} at {commit}\n{asset.name}: {sha}')
        return
    subprocess.run(['gh', 'release', 'create', tag, '--repo', repository, '--target', commit,
                    '--title', f'Micro Windows {version}', '--notes-file', str(notes), '--latest',
                    str(asset), str(checksum)], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
