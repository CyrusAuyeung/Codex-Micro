import {spawnSync} from 'node:child_process';
import {mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testRoot = path.join(root, '.build', 'tests');
await mkdir(testRoot, {recursive: true});
const files = (await readdir(path.join(root, 'tests')))
  .filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join('tests', name));
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {...process.env, MICRO_TEST_ROOT: testRoot},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
