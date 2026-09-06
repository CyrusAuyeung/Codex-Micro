import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {KeyboardInput} from '../input.mjs';
const C=createRequire(import.meta.url)('../public/mapping-core.js');
function fake(t){const input=new KeyboardInput({data:'unused',simulation:true});t.after(()=>input.close());input.start=()=>{};input.ready=true;const commands=[];input.send=c=>{commands.push(c);if(c.op==='record')input.ingest({kind:'recording',id:c.id,guarded:true});};return {input,commands};}

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
  input.ingest({kind:'recorded',id,mod:1,key:6});assert.deepEqual(input.session.result,{id,mod:1,key:6});
  assert.equal((await input.state(other)).recording,null);
  input.ingest({kind:'recorded',id,mod:1,key:25});assert.equal(input.session.result.key,6);
  input.cancel(client,id);assert.equal(input.session,null);
  await input.begin(client,randomUUID());input.session.expires=0;input.ingest({kind:'recorded',id:input.session.id,mod:0,key:4});assert.equal(input.session.result,null);
  input.tick();assert.equal(input.session,null);
});
test('abandoned recording sessions expire and stop the capture request',async t=>{
  const {input}=fake(t),client=randomUUID();
  await input.begin(client,randomUUID());input.clients.set(client,0);input.tick();assert.equal(input.session,null);
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
