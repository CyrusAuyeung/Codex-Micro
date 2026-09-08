import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Telemetry} from '../telemetry.mjs';
test('device information keeps time and source, labels cross-mode cache, never leaks another identity',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'micro-telemetry-')),t=new Telemetry(dir,true);await t.init();
  const identities=[{name:'Codex Micro',id:'vendor1'},{name:'Codex Micro KB',id:'kb1'}];t.live={identities,connected:true,devices:[{name:'Codex Micro',id:'vendor1',battery:80}]};
  await t.acceptStatus({version:'0.1.0-esp32s3',battery:80,is_charging:false},'hid1');
  let value=t.view({captured:true,device:{location_id:'hid1'}});assert.equal(value.fields.version.value,'0.1.0-esp32s3');assert.equal(value.fields.version.cached,false);assert.equal(value.fields.charging.value,false);
  t.live={identities,connected:true,devices:[{name:'Codex Micro KB',id:'kb1',battery:80}]};value=t.view({captured:false});assert.equal(value.fields.version.cached,true);assert.equal(value.fields.charging.cached,true);assert.equal(value.mode,'普通键盘');
  t.live={identities,connected:false,devices:[]};value=t.view({});assert.equal(value.fields.battery.cached,true);assert.equal(value.connected,false);
  t.live.identities=[{name:'Codex Micro',id:'different'}];assert.equal(t.view({}).fields.version,null);t.live.ambiguous=true;assert.equal(t.view({}).fields.battery,null);
  await t.setStartup(true);assert.equal((await t.startupState()).enabled,true);const reload=new Telemetry(dir,true);await reload.init();assert.equal((await reload.startupState()).enabled,true);await reload.setStartup(false);
});
