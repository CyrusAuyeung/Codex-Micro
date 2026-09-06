import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {KeyboardInput} from '../input.mjs';
const C=createRequire(import.meta.url)('../public/mapping-core.js');
function fake(t){const input=new KeyboardInput({data:'unused',simulation:true});t.after(()=>input.close());input.start=()=>{};input.ready=true;const commands=[];input.send=c=>{commands.push(c);if(c.op==='record')input.ingest({kind:'recording',id:c.id,guarded:true,confirmRequired:true});if(c.op==='confirm')input.ingest({kind:'recorded',...input.session.candidate});};return {input,commands};}

test('shortcut recording accepts physical IME keys, missing code and numpad without swallowing modifiers',()=>{
  assert.deepEqual(C.fromEvent({key:'Process',code:'KeyK',isComposing:true,ctrlKey:true,shiftKey:true}),{key:'0x0E',mod:3});
  assert.deepEqual(C.fromEvent({key:'c',code:'',ctrlKey:true}),{key:'0x06',mod:1});
  assert.deepEqual(C.fromEvent({key:'Enter',code:'NumpadEnter'}),{key:'0x58',mod:0});
  assert.deepEqual(C.fromEvent({key:'Control'}),{modifierOnly:true});
  assert.deepEqual(C.fromEvent({key:'Process',code:'ShiftRight',isComposing:true}),{modifierOnly:true});
  assert.match(C.fromEvent({key:'Fn',code:'Fn'}).error,/键盘内部/);
  assert.match(C.fromEvent({key:'Process',isComposing:true}).error,/Windows/);
});
test('recording is owned by one page, ignores stale results and cannot be cancelled by another page',async t=>{
  const {input,commands}=fake(t),client=randomUUID(),other=randomUUID(),id=randomUUID();
  assert.equal((await input.begin(client,id)).guarded,true);assert.deepEqual(commands[0],{op:'record',id});
  await assert.rejects(()=>input.begin(other,randomUUID()),/另一个页面/);
  input.cancel(other,id);assert.equal(input.session.id,id);
  input.ingest({kind:'recorded',id:randomUUID(),mod:1,key:6});assert.equal(input.session.result,null);
  input.ingest({kind:'recorded',id,mod:1,key:6,revision:1});assert.equal(input.session.result,null);
  input.ingest({kind:'candidate',id,mod:1,key:6,revision:1});assert.equal(input.session.result,null);
  assert.equal((await input.state(other)).recording,null);
  await assert.rejects(()=>input.confirm(other,id,1),/结束/);
  assert.deepEqual(await input.confirm(client,id,1),{id,mod:1,key:6,revision:1});
  input.ingest({kind:'recorded',id,mod:1,key:25,revision:1});assert.equal(input.session.result.key,6);
  await input.confirm(client,id,1);assert.equal(commands.filter(c=>c.op==='confirm').length,1);
  input.cancel(client,id);assert.equal(input.session,null);
  await input.begin(client,randomUUID());input.session.expires=0;input.ingest({kind:'recorded',id:input.session.id,mod:0,key:4});assert.equal(input.session.result,null);
  input.tick();assert.equal(input.session,null);
});
test('abandoned recording sessions expire and stop the capture request',async t=>{
  const {input}=fake(t),client=randomUUID();
  await input.begin(client,randomUUID());input.clients.set(client,0);input.tick();assert.equal(input.session,null);
});
test('live preview exposes modifiers and the main key before completion, only to the recording page',async t=>{
  const {input}=fake(t),client=randomUUID(),other=randomUUID(),id=randomUUID();
  await input.begin(client,id);assert.equal(input.session.progress,null);
  for(const [mod,key] of [[1,null],[3,null],[0,null],[4,null],[4,4]]){
    input.ingest({kind:'progress',id,mod,key,holding:true});
    const state=await input.state(client);
    assert.deepEqual(state.recording.progress,{id,mod,key,holding:true});assert.equal(state.recording.result,null);
    assert.equal((await input.state(other)).recording,null);
  }
  input.ingest({kind:'candidate',id,mod:4,key:4,revision:1});
  assert.equal(input.session.result,null);assert.equal(input.session.progress,null);
  assert.deepEqual(await input.confirm(client,id,1),{id,mod:4,key:4,revision:1});
  input.ingest({kind:'progress',id,mod:0,key:null,holding:false});assert.equal(input.session.progress,null);
});
test('preview rejects invalid, unarmed, cancelled, expired and previous-session events',async t=>{
  const {input}=fake(t),client=randomUUID(),id=randomUUID();await input.begin(client,id);
  input.session.armed=false;input.ingest({kind:'progress',id,mod:1,key:null,holding:true});assert.equal(input.session.progress,null);input.session.armed=true;
  for(const value of [{mod:-1,key:4},{mod:256,key:4},{mod:'4',key:4},{mod:4,key:'4'},{mod:4},{mod:4,key:-1},{mod:4,key:65536},{mod:4,key:4,id:randomUUID()}]){
    input.ingest({kind:'progress',id,holding:true,...value});assert.equal(input.session.progress,null);
  }
  input.ingest({kind:'progress',id,mod:64,key:4,holding:true});assert.deepEqual(input.session.progress,{id,mod:64,key:4,holding:true});
  input.cancel(client,id);input.ingest({kind:'progress',id,mod:1,key:6,holding:true});assert.equal(input.session,null);
  const next=randomUUID();await input.begin(client,next);assert.equal(input.session.progress,null);
  input.ingest({kind:'progress',id,mod:1,key:6,holding:true});assert.equal(input.session.progress,null);
  input.session.expires=0;input.ingest({kind:'progress',id:next,mod:1,key:6,holding:true});assert.equal(input.session.progress,null);
});
test('modifier-only candidates and repeated rounds wait for explicit confirmation',async t=>{
  const {input}=fake(t),client=randomUUID(),id=randomUUID();await input.begin(client,id);
  for(const [revision,mod,key] of [[1,4,0],[2,5,0],[3,5,5],[4,80,0]]){
    input.ingest({kind:'progress',id,mod,key:null,holding:true});
    if(revision>1)await assert.rejects(()=>input.confirm(client,id,revision-1),/松开/);
    input.ingest({kind:'candidate',id,mod,key,revision});
    assert.deepEqual(input.session.candidate,{id,mod,key,revision});assert.equal(input.session.result,null);
  }
  await assert.rejects(()=>input.confirm(client,id,3),/变化/);
  assert.deepEqual(await input.confirm(client,id,4),{id,mod:80,key:0,revision:4});
});
test('invalid or unsupported rounds cannot be silently confirmed as the previous candidate',async t=>{
  const {input}=fake(t),client=randomUUID(),id=randomUUID();await input.begin(client,id);
  for(const value of [{mod:0,key:0},{mod:4,key:-1},{mod:4,key:'0'},{mod:256,key:0}])input.ingest({kind:'candidate',id,revision:1,...value});
  assert.equal(input.session.candidate,null);
  input.ingest({kind:'candidate',id,mod:4,key:0,revision:1});
  input.ingest({kind:'candidate',id,revision:2,error:'无法识别'});await assert.rejects(()=>input.confirm(client,id,2),/变化/);
  input.ingest({kind:'candidate',id,mod:1,key:6,revision:1});assert.equal(input.session.candidate.revision,2);
  input.session.expires=0;input.ingest({kind:'candidate',id,mod:1,key:6,revision:3});assert.equal(input.session.candidate.revision,2);
  await assert.rejects(()=>input.confirm(client,id,2),/结束/);
});
test('native confirmation refuses a key press arriving after the preview was displayed',async t=>{
  const {input}=fake(t),client=randomUUID(),id=randomUUID();await input.begin(client,id);
  input.ingest({kind:'candidate',id,mod:4,key:4,revision:1});const send=input.send;
  input.send=c=>{if(c.op==='confirm'){input.ingest({kind:'progress',id,mod:1,key:null,holding:true});input.ingest({kind:'confirm-rejected',id,revision:c.revision,error:'请先松开所有按键。'});}else send(c);};
  await assert.rejects(()=>input.confirm(client,id,1),/松开/);assert.equal(input.session.result,null);
  input.ingest({kind:'candidate',id,mod:1,key:0,revision:2});input.send=send;
  assert.deepEqual(await input.confirm(client,id,2),{id,mod:1,key:0,revision:2});
});
test('cancellation during confirmation discards late acknowledgements',async t=>{
  const {input}=fake(t),client=randomUUID(),id=randomUUID();await input.begin(client,id);
  input.ingest({kind:'candidate',id,mod:4,key:4,revision:1});const send=input.send;input.send=c=>{if(c.op!=='confirm')send(c);};
  const pending=input.confirm(client,id,1);input.cancel(client,id);
  input.ingest({kind:'recorded',id,mod:4,key:4,revision:1});await assert.rejects(()=>pending,/取消/);assert.equal(input.session,null);
});
test('idle pages do not launch the worker; simulation cannot capture real keyboards',async t=>{
  const input=new KeyboardInput({simulation:true,helper:''});t.after(()=>input.close());
  const client=randomUUID(),state=await input.state(client);assert.equal(input.native,null);assert.equal(state.ready,false);assert.equal(state.recording,null);
  await assert.rejects(()=>input.begin(client,randomUUID()),/模拟/);assert.equal(input.native,null);
  const production=new KeyboardInput({simulation:false,helper:'must-not-start-this-fixture'});assert.equal(production.fixture,null);
  await production.state(client);assert.equal(production.native,null);production.close();
  assert.throws(()=>input.touch('invalid'),/会话/);
});
test('cancelling while the worker starts cannot arm a late shortcut hook',async t=>{
  const {input,commands}=fake(t),client=randomUUID(),id=randomUUID();input.ready=false;
  const pending=input.begin(client,id);input.cancel(client,id);input.ready=true;
  await assert.rejects(()=>pending,/取消/);assert.equal(commands.some(c=>c.op==='record'),false);
});
test('first recording starts an idle helper and waits for its armed acknowledgement',async t=>{
  const input=new KeyboardInput({simulation:true,helper:fileURLToPath(new URL('./mock-input.mjs',import.meta.url))});t.after(()=>input.close());
  const client=randomUUID(),id=randomUUID();await input.state(client);assert.equal(input.native,null);
  const result=await input.begin(client,id);assert.equal(result.guarded,true);assert.equal((await input.state(client)).recording.armed,true);
  input.cancel(client,id);assert.equal(input.session,null);
});
