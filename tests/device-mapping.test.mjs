import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DeviceMapping} from '../device-mapping.mjs';
import {mockDevice} from './mock-device.mjs';
import {createRequire} from 'node:module';
import {controls} from '../model.mjs';
const C=createRequire(import.meta.url)('../public/mapping-core.js');
const clone=structuredClone;
async function setup(t){const mock=await mockDevice();t.after(()=>mock.close());const data=await mkdtemp(path.join(process.env.MICRO_TEST_ROOT||tmpdir(),'micro-device-test-'));const service=new DeviceMapping({data,simulation:true,testOrigin:mock.origin,timeout:1000});await service.init();return {...mock,data,service};}
async function edit(service,index=1,key='0x19'){const read=await service.read(),draft=clone(read.mapping);draft.key[index]=key;return {read,draft,prepared:await service.prepare({readToken:read.readToken,draft})};}

test('ordinary physical positions match the Codex 13-key view without assigning unknown controls',()=>{
  const physical=C.LAYOUT.filter(slot=>slot.kind==='key');
  assert.deepEqual(physical.map(({id,row,col})=>({id,row,col})),controls.filter(c=>c.kind==='key').map(({id,row,col})=>({id,row,col})));
  assert.deepEqual(physical.map(s=>s.index),[1,2,4,5,6,7,8,9,10,11,13,14,15]);
  assert.deepEqual(physical.map(s=>s.code),['AG00','AG01','AG02','AG03','AG04','AG05','ACT06','ACT07','ACT08','ACT09','ACT10','ACT11','ACT12']);
  assert.deepEqual(C.LAYOUT.filter(s=>s.kind==='other').map(s=>s.index),[3,12]);
  assert.deepEqual([C.LAYOUT[0].kind,C.LAYOUT[0].row,C.LAYOUT[0].col],['dial',0,0]);
  assert.equal(new Set(C.LAYOUT.filter(s=>s.kind!=='other').map(s=>s.row+','+s.col)).size,14);
});
test('editing physical key 13 writes firmware slot 15 and preserves reserved slots',async t=>{
  const {service,state}=await setup(t);
  state.mapping.mod[3]=128;state.mapping.key[3]='0xFE';state.mapping.mod[12]=32;state.mapping.key[12]=65530;
  const before=clone(state.mapping),slot=C.LAYOUT.find(s=>s.id==='key13');
  const {prepared}=await edit(service,slot.index,'0x2B');
  assert.deepEqual(prepared.changes.map(c=>c.index),[15]);assert.equal(prepared.changes[0].label,'ACT12');
  await service.commit({token:prepared.token});assert.equal(state.posts.length,1);
  const expected=clone(before);expected.key[15]='0x2B';assert.deepEqual(state.posts[0],expected);
  assert.equal((await service.read()).verification.state,'verified');
});

test('device save needs confirmation, preserves unknown fields, backs up and verifies after restart',async t=>{
  const {service,state,data,origin}=await setup(t);state.mapping.mod[7]=129;state.mapping.key[7]=65530;state.mapping.key[8]=40;
  const {prepared}=await edit(service);assert.equal(state.posts.length,0);assert.equal(prepared.changes.length,1);
  state.mapping.key[4]='0x04'; // Unrelated edit made after the confirmation preview.
  const result=await service.commit({token:prepared.token});assert.equal(result.state,'awaiting-verification');assert.equal(state.posts.length,1);
  assert.equal(state.posts[0].mod[7],129);assert.equal(state.posts[0].key[7],65530);assert.equal(state.posts[0].key[8],40);assert.equal(state.posts[0].key[4],'0x04');assert.deepEqual(state.posts[0].extra,{preserve:true});
  const backup=JSON.parse(await readFile(path.join(data,'device-config/backups',result.backup),'utf8'));assert.equal(backup.key[1],'0x06');assert.equal(backup.key[4],'0x04');
  const restarted=new DeviceMapping({data,simulation:true,testOrigin:origin});await restarted.init();assert.equal(restarted.status().state,'awaiting-verification');
  const verified=await restarted.read();assert.equal(verified.verification.state,'verified');assert.equal(verified.mapping.key[1],'0x19');
  await assert.rejects(()=>service.commit({token:prepared.token}),/已使用/);assert.equal(state.posts.length,1);
});
test('conflicting edits are rejected both before preview and immediately before writing',async t=>{
  const {service,state}=await setup(t),r=await service.read(),draft=clone(r.mapping);draft.key[1]='0x19';state.mapping.key[1]='0x04';
  await assert.rejects(()=>service.prepare({readToken:r.readToken,draft}),/其他操作修改/);assert.equal(state.posts.length,0);
  const {prepared}=await edit(service,1,'0x05');state.mapping.key[1]='0x07';await assert.rejects(()=>service.commit({token:prepared.token}),/其他操作修改/);assert.equal(state.posts.length,0);
});
test('lost save response is never retried and next read detects that the device applied it',async t=>{
  const {service,state}=await setup(t),{prepared}=await edit(service);state.mode='drop';const result=await service.commit({token:prepared.token});assert.equal(result.state,'uncertain');assert.equal(state.posts.length,1);
  await assert.rejects(()=>service.prepare({readToken:'anything',draft:state.mapping}),/上次写入/);state.mode='ok';assert.equal((await service.read()).verification.state,'verified');assert.equal(state.posts.length,1);
});
test('failure response and divergent readback are reported without claiming success',async t=>{
  const {service,state}=await setup(t);let change=await edit(service);state.mode='reject';assert.equal((await service.commit({token:change.prepared.token})).state,'uncertain');state.mode='ok';assert.equal((await service.read()).verification.state,'not-applied');
  change=await edit(service);await service.commit({token:change.prepared.token});state.mapping.key[1]='0x07';const read=await service.read();assert.equal(read.verification.state,'different');assert.deepEqual(read.verification.differences,[1]);
});
test('matching configuration causes no POST; incomplete mapping and expired review cannot write',async t=>{
  const {service,state}=await setup(t),{prepared}=await edit(service);state.mapping.key[1]='0x19';assert.equal((await service.commit({token:prepared.token})).state,'unchanged');assert.equal(state.posts.length,0);
  const r=await service.read();await assert.rejects(()=>service.prepare({readToken:r.readToken,draft:{mod:[],key:[]}}),/16 项/);
  const change=await edit(service,1,'0x05');service.prepared.get(change.prepared.token).expires=0;await assert.rejects(()=>service.commit({token:change.prepared.token}),/过期/);assert.equal(state.posts.length,0);
});
test('OTA pages, redirects and malformed device responses are rejected',async t=>{
  const {service,state}=await setup(t);
  for(const mode of ['wrong-page','redirect','invalid-json','incomplete']){state.mode=mode;await assert.rejects(()=>service.read());}assert.equal(state.posts.length,0);
});
test('backup failure stops before POST and corrupted journal is preserved',async t=>{
  const {service,state,data}=await setup(t),{prepared}=await edit(service);
  await writeFile(path.join(data,'device-config/backups'),'blocked');await assert.rejects(()=>service.commit({token:prepared.token}));assert.equal(state.posts.length,0);
  const bad=path.join(data,'bad');await mkdir(path.join(bad,'device-config'),{recursive:true});const file=path.join(bad,'device-config/last-write.json');await writeFile(file,'not json');
  const broken=new DeviceMapping({data:bad});await assert.rejects(()=>broken.init(),/原文件已保留/);assert.equal(await readFile(file,'utf8'),'not json');
});
test('normal mode target is fixed; simulation only allows explicit local targets',async()=>{
  const data=await mkdtemp(path.join(process.env.MICRO_TEST_ROOT||tmpdir(),'micro-network-isolation-'));
  assert.equal(new DeviceMapping({data:'unused'}).origin,'http://192.168.4.1');
  for(const args of [{testOrigin:'http://127.0.0.1:5555'},{simulation:true,testOrigin:'http://example.com'},{simulation:true,testOrigin:'http://127.0.0.1:5555/path'},{simulation:true,testOrigin:'http://a:b@127.0.0.1'}])assert.throws(()=>new DeviceMapping({data:'unused',...args}));
  await assert.rejects(()=>new DeviceMapping({data,simulation:true}).read(),/不会访问真实键盘/);
});
