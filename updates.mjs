import https from 'node:https';
import {readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {APP_VERSION, REPOSITORY} from './app-info.mjs';

export function versionParts(value) {
  if (typeof value !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)) return null;
  return value.split('.').map(Number);
}
export function newer(version, current) {
  const a = versionParts(version), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function selectRelease(release, current = APP_VERSION) {
  const version = release?.tag_name?.replace(/^v/, '');
  if (release?.draft || release?.prerelease || !versionParts(version)) throw new Error('发布信息无效');
  const expected = `Micro-Windows-${version}-Setup-x64.exe`;
  const url = `${REPOSITORY}/releases/download/${release.tag_name}/${expected}`;
  const asset = release.assets?.find(a => a.name === expected && a.browser_download_url === url && a.size > 0);
  return {version, available: newer(version, current) && Boolean(asset), url: asset ? url : null};
}
function fetchRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.github.com/repos/CyrusAuyeung/Codex-Micro/releases/latest', {
      headers: {'User-Agent': `Micro-Windows/${APP_VERSION}`, Accept: 'application/vnd.github+json'},
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub HTTP ${res.statusCode}`)); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 524288) req.destroy(new Error('发布信息过大')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    const deadline = setTimeout(() => req.destroy(new Error('检查更新超时')), 8000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject);
  });
}
export class Updates {
  constructor({data, simulation = false, fetcher = fetchRelease, now = Date.now}) {
    this.file = path.join(data, 'update-check.json'); this.simulation = simulation;
    this.fetcher = fetcher; this.now = now; this.pending = null; this.lastAttempt = 0; this.result = null;
  }
  async check(force = false) {
    if (this.simulation) return {current: APP_VERSION, available: false, simulation: true};
    if (this.pending) return this.pending;
    // Repeated opening of the window never floods GitHub, even after a failed check.
    if (this.result && this.now() - this.lastAttempt < (force ? 15000 : 86400000)) return this.result;
    this.pending = this.run(force).finally(() => { this.pending = null; }); return this.pending;
  }
  async run(force) {
    this.lastAttempt = this.now();
    let cached = null;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (Number.isFinite(saved.checkedAt)) cached = {...selectRelease(saved.release), checkedAt: saved.checkedAt};
      if (!force && cached && this.now() >= cached.checkedAt && this.now() - cached.checkedAt < 86400000)
        return this.result = {current: APP_VERSION, ...cached};
    } catch {}
    try {
      const release = await this.fetcher(), result = selectRelease(release), checkedAt = this.now();
      try { const tmp = this.file + '.tmp'; await writeFile(tmp, JSON.stringify({checkedAt, release})); await rename(tmp, this.file); } catch {}
      return this.result = {current: APP_VERSION, ...result, checkedAt};
    } catch {
      return this.result = {current: APP_VERSION, available: false, ...cached, error: '暂时无法检查更新，请联网后重试。'};
    }
  }
}
