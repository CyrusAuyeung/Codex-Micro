import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {selectRelease,newer,Updates} from '../updates.mjs';
const release=(version='2.1.0')=>({tag_name:'v'+version,assets:[{name:`Micro-Windows-${version}-Setup-x64.exe`,size:100,url:'unused',browser_download_url:`https://github.com/CyrusAuyeung/Codex-Micro/releases/download/v${version}/Micro-Windows-${version}-Setup-x64.exe`}]});
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
