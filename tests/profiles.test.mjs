import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProfileStore,normalizeStore,validateMotion} from '../profiles.mjs';
const bindings={key1:{source:{type:'vendor_key',code:'AG00',modifiers:[]},action:'custom',custom:{key:'f24',modifiers:['right_control']}}};
test('legacy migration backs up exact file and preserves enabled, device and right modifier mappings',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'micro-profiles-')),old={version:1,enabled:true,device:{location_id:'same'},bindings};const original=JSON.stringify(old);await writeFile(path.join(dir,'bindings.json'),original);
  const store=new ProfileStore(dir),state=await store.init();assert.equal(state.version,2);assert.equal(state.profiles[0].name,'当前配置');assert.equal(state.enabled,true);assert.equal(state.device.location_id,'same');assert.deepEqual(state.bindings,bindings);
  const backups=await store.listBackups();assert.equal(backups.length,1);assert.equal(await readFile(path.join(dir,'backups',backups[0].id),'utf8'),original);
  const saved=JSON.parse(await readFile(path.join(dir,'bindings.json'),'utf8'));const again=await new ProfileStore(dir).init();assert.equal(again.activeProfileId,saved.activeProfileId);
  const exported=store.export(true);exported.profiles[0].bindings.key1.custom.key='a';const imported=store.import(exported);assert.equal(imported.profiles.length,2);assert.notEqual(imported.profiles[1].id,state.profiles[0].id);assert.equal(imported.bindings.key1.custom.key,'f24');
  await store.save(imported,'测试导入');assert.equal((await store.listBackups()).length,2);assert.deepEqual((await store.readBackup(backups[0].id)).bindings,bindings);
  await assert.rejects(store.readBackup('../bindings.json'));assert.throws(()=>store.import({format:'other'}));
});
test('invalid migration and motion preserve the original configuration',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'micro-bad-profile-')),file=path.join(dir,'bindings.json'),original='{"version":99,"enabled":true}';await writeFile(file,original);await assert.rejects(new ProfileStore(dir).init());assert.equal(await readFile(file,'utf8'),original);
  for(const value of [{engage:.2,release:.3,dialReverse:false,stickReverse:false},{engage:NaN,release:.1,dialReverse:false,stickReverse:false}])assert.throws(()=>validateMotion(value));
  assert.throws(()=>normalizeStore({version:2,enabled:false,profiles:[]}));
});
