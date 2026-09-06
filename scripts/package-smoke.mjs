import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mockDevice} from '../tests/mock-device.mjs';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: package-smoke.mjs EXTRACTED_APP WORK_DIR');
const root = path.resolve(process.argv[2]), work = path.resolve(process.argv[3]);
const {version} = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const data = await mkdtemp(path.join(work, 'isolated-data-'));
const mock = await mockDevice();
const reservation = http.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const child = spawn(path.join(root, 'runtime/node.exe'), [path.join(root, 'server.mjs')], {
  cwd: work, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, MICRO_WINDOWS_DATA: data, MICRO_WINDOWS_PORT: String(port), MICRO_WINDOWS_TEST: '1',
    MICRO_WINDOWS_DEVICE_ORIGIN: mock.origin, MICRO_WINDOWS_HELPER: '', MICRO_WINDOWS_INPUT_HELPER: ''},
});
let output = '';
child.stdout.on('data', value => output += value);
child.stderr.on('data', value => output += value);
const exited = new Promise((resolve, reject) => {child.once('exit', resolve); child.once('error', reject);});
exited.catch(() => {});
async function post(route, body = {}) {
  const response = await fetch(origin + route, {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, 'X-Micro-Panel': '1'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
try {
  let health;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(origin + '/api/health', {signal: AbortSignal.timeout(1000)});
      if (response.ok) {health = await response.json(); break;}
    } catch {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(health, {app: 'codex-micro-windows-panel', version, simulation: true, deviceMapping: true});
  for (const route of ['/', '/codex', '/hardware.css', '/hardware.js', '/mapping-core.js', '/app.js', '/style.css']) {
    const response = await fetch(origin + route, {signal: AbortSignal.timeout(5000)});
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 100, route);
  }
  const state = await (await fetch(origin + '/api/state')).json();
  assert.deepEqual(state.bindings, {});
  assert.equal(state.status.enabled, false);
  const current = await post('/api/device/read'), draft = structuredClone(current.mapping);
  draft.mod[15] = 5; draft.key[15] = '0x00';
  const input = await post('/api/input/state', {client: randomUUID()});
  assert.equal(input.ready, false); assert.equal(input.recording, null);
  const review = await post('/api/device/prepare', {readToken: current.readToken, draft});
  assert.deepEqual(review.changes.map(change => change.index), [15]);
  const save = await post('/api/device/commit', {token: review.token});
  assert.equal(save.state, 'awaiting-verification');
  const checked = await post('/api/device/read');
  assert.equal(checked.verification.state, 'verified'); assert.equal(mock.state.posts.length, 1);
  assert.equal(checked.mapping.mod[15], 5); assert.equal(Number(checked.mapping.key[15]), 0);
  const backup = JSON.parse(await readFile(path.join(data, 'device-config/backups', save.backup), 'utf8'));
  assert.equal(backup.key[15], '0x28');
  await post('/api/quit');
  assert.equal(await Promise.race([exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not quit')), 5000); timer.unref();
  })]), 0);
  console.log(`Package ${version}: clean settings, Unicode path, seven pages, simulated save/backup/readback passed.`);
} finally {
  if (child.exitCode === null) child.kill();
  await mock.close();
}
