import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = name => readFile(path.join(root, name), 'utf8');
const {version} = JSON.parse(await read('package.json'));
assert.match(version, /^\d+\.\d+\.\d+$/);
const expected = process.argv[2];
if (expected) assert.equal(version, expected, 'Requested release must match package.json');
const server = await read('server.mjs');
assert.ok(server.includes(`version:'${version}',simulation`), 'Server version must match package.json');
const launcher = await read('native/Launcher.cs');
assert.ok(launcher.includes(`ServiceVersion()=="${version}"`), 'Launcher version must match package.json');
assert.ok((await read('public/hardware.html')).includes(`WINDOWS ${version}</div>`), 'Page version must match package.json');
assert.ok((await read('CHANGELOG.md')).includes(`## ${version}`), 'Add release notes to CHANGELOG.md');
console.log(`Micro Windows ${version}: version checks passed.`);
