import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {selectRelease,newer,Updates,downloadURL} from '../updates.mjs';
import {APP_VERSION} from '../app-info.mjs';
const future=APP_VERSION.split('.').map((n,i)=>Number(n)+(i===1?1:0)).join('.');
const release=(version=future)=>({tag_name:'v'+version,assets:[{name:`Micro-Windows-${version}-Setup-x64.exe`,size:100,url:'unused',browser_download_url:`https://github.com/CyrusAuyeung/Codex-Micro/releases/download/v${version}/Micro-Windows-${version}-Setup-x64.exe`}]});
test('only newer formal releases with this repository installer are downloadable',()=>{
  assert.equal(newer('2.0.0','1.1.6'),true);assert.equal(newer('2.0.0','2.0.0'),false);assert.equal(newer('2.0.0','2.1.0'),false);assert.equal(newer('2.0.1-beta','2.0.0'),false);
  assert.equal(selectRelease(release()).available,true);
  for(const url of ['https://evil.test/a.exe','https://github.com/CyrusAuyeung/Codex-Micro-evil/releases/a.exe','file:///C:/a.exe']){const r=release();r.assets[0].browser_download_url=url;assert.equal(selectRelease(r).available,false);}
  assert.equal(selectRelease({...release(),assets:[]}).available,false);
  assert.throws(()=>selectRelease({...release(),prerelease:true}));assert.throws(()=>selectRelease({...release(),draft:true}));
});
test('update checks coalesce, cache and keep a verified cached notice while offline',async()=>{
  const data=await mkdtemp(path.join(process.env.MICRO_TEST_ROOT||tmpdir(),'micro-updates-'));let calls=0,now=1000000;
  const updates=new Updates({data,now:()=>now,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return release();}});
  const result=await Promise.all([updates.check(),updates.check(),updates.check(true)]);assert.equal(calls,1);assert.equal(result[0].available,true);
  await updates.check(true);assert.equal(calls,1);now+=86400001;updates.fetcher=async()=>{throw new Error('offline');};const offline=await updates.check();assert.equal(offline.available,true);assert.match(offline.error,/重试/);
  await writeFile(path.join(data,'update-check.json'),JSON.stringify({checkedAt:now,release:{...release(),assets:[{name:'Micro-Windows-2.1.0-Setup-x64.exe',size:1,browser_download_url:'https://evil.test/a.exe'}]}}));
  const modified=new Updates({data,now:()=>now,fetcher:async()=>{throw new Error();}});assert.equal((await modified.check()).available,false);
});
test('simulation never checks the Internet',async()=>{const updates=new Updates({data:'.',simulation:true,fetcher:()=>{throw new Error('must not call');}});assert.equal((await updates.check()).simulation,true);});
const bytes=Buffer.from('a verified installer fixture'),sha=createHash('sha256').update(bytes).digest('hex');
async function downloadable({content=bytes,digest=sha,size=bytes.length,downloader}={}){const data=await mkdtemp(path.join(process.env.MICRO_TEST_ROOT||tmpdir(),'micro-download-')),r=release();Object.assign(r.assets[0],{size,digest:'sha256:'+digest});const updates=new Updates({data,fetcher:async()=>r,downloader:downloader||async function*(){yield content.subarray(0,6);yield content.subarray(6);}});return {data,updates,r};}
test('update stream is hashed and size checked before exposing an install ticket',async()=>{const {updates}=await downloadable();updates.start();const transfer=updates.transfer;assert.equal(updates.start().phase,'checking');assert.equal(updates.transfer,transfer);await transfer;assert.equal(updates.status().phase,'ready');assert.equal(updates.status().received,bytes.length);assert.equal(updates.status().file,undefined);const prepared=await updates.prepare();assert.equal(prepared.sha256,sha);assert.deepEqual(await readFile(prepared.file),bytes);await writeFile(prepared.file,'tampered');await assert.rejects(updates.prepare(),/发生变化/);assert.equal(updates.status().phase,'error');});
test('invalid download length or checksum never leaves an executable ready to install',async()=>{for(const options of [{digest:'0'.repeat(64)},{size:bytes.length-1},{size:bytes.length+1}]){const {updates}=await downloadable(options);updates.start();await updates.transfer;assert.equal(updates.status().phase,'error');assert.deepEqual(await readdir(updates.folder),[]);await assert.rejects(updates.prepare(),/先完成/);}});
test('cancel cleans partial files and a retry can complete',async()=>{let releaseChunk,waiting;const gate=new Promise(r=>releaseChunk=r);const {updates}=await downloadable({downloader:async function*(){yield bytes.subarray(0,5);waiting=true;await gate;yield bytes.subarray(5);}});updates.start();while(!waiting)await new Promise(r=>setTimeout(r,5));updates.cancel();releaseChunk();await updates.transfer;assert.equal(updates.status().phase,'cancelled');assert.deepEqual(await readdir(updates.folder),[]);updates.downloader=async function*(){yield bytes;};updates.start();await updates.transfer;assert.equal(updates.status().phase,'ready');});
test('digest fallback requires the exact installer entry from the same release',async()=>{const {updates,r}=await downloadable();delete r.assets[0].digest;const url=r.assets[0].browser_download_url.replace(r.assets[0].name,'SHA256SUMS.txt');r.assets.push({name:'SHA256SUMS.txt',browser_download_url:url,size:150});updates.downloader=async function*(address){yield address===url?Buffer.from(sha+'  '+r.assets[0].name+'\n'):bytes;};updates.start();await updates.transfer;assert.equal(updates.status().phase,'ready');const missing=await downloadable();delete missing.r.assets[0].digest;missing.updates.start();await missing.updates.transfer;assert.equal(missing.updates.status().phase,'error');assert.match(missing.updates.status().error,/未提供校验/);});
test('redirects are confined to HTTPS GitHub release hosts',()=>{for(const url of ['http://github.com/CyrusAuyeung/Codex-Micro/releases/download/v2.2.0/a.exe','https://evil.test/a.exe','https://github.com/other/project/releases/download/a.exe','https://user:pass@objects.githubusercontent.com/a','file:///C:/a.exe','https://objects.githubusercontent.com:444/a'])assert.throws(()=>downloadURL(url));assert.equal(downloadURL('https://release-assets.githubusercontent.com/path?token=signed').protocol,'https:');});
test('a simulation update consumes only an explicit local fixture',async()=>{const {data,r}=await downloadable(),file=path.join(data,'fixture.exe');await writeFile(file,bytes);const updates=new Updates({data,simulation:true,testFixture:{release:r,file},fetcher:()=>assert.fail('network'),downloader:()=>assert.fail('network')});updates.start();await updates.transfer;assert.equal(updates.status().phase,'ready');assert.equal((await updates.prepare()).sha256,sha);});
