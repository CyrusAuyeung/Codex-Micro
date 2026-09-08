import test from 'node:test';
import assert from 'node:assert/strict';
import {controls,actions,keys,destination,CaptureCollector,validateBindings} from '../model.mjs';
import {VendorDecoder,VendorInputs,windowsEvent} from '../vendor.mjs';
const source=code=>({type:'vendor_key',code,modifiers:[]});
test('all original physical controls remain separately addressable',()=>{
  assert.equal(controls.filter(c=>c.kind==='key').length,13);assert.equal(controls.length,22);
  assert.equal(new Set(controls.map(c=>c.id)).size,22);
  assert.deepEqual(controls.filter(c=>c.kind==='key').slice(-3).map(c=>[c.row,c.col]),[[3,1],[3,2],[3,3]]);
});
test('Windows actions use Ctrl, Win and VK media keys',()=>{
  assert.deepEqual(windowsEvent(destination({action:'copy'})),{op:'key',code:67,modifiers:[162]});
  assert.deepEqual(windowsEvent(destination({action:'redo'})),{op:'key',code:89,modifiers:[162]});
  assert.deepEqual(windowsEvent(destination({action:'shot_area'})),{op:'key',code:83,modifiers:[91,160]});
  assert.deepEqual(windowsEvent(destination({action:'task_view'})),{op:'key',code:9,modifiers:[91]});
  assert.equal(windowsEvent(destination({action:'mute'})).code,173);
  assert.equal(windowsEvent(destination({action:'original'})),null);
  assert.equal(windowsEvent(destination({action:'disabled'})),null);
  for(const action of actions.filter(a=>a.id!=='custom'))windowsEvent(destination({action:action.id}));
  for(const key of keys)assert.ok(windowsEvent(destination({action:'custom',custom:{key,modifiers:key==='modifiers_only'?['right_control']:[]}})));
});
test('custom shortcuts validate keys and retain right-hand Windows modifiers',()=>{
  assert.deepEqual(windowsEvent(destination({action:'custom',custom:{key:'f24',modifiers:['right_control','right_alt']}})),{op:'key',code:135,modifiers:[163,165]});
  for(const custom of [{key:'a',modifiers:['left_command']},{key:'fn',modifiers:[]},{key:'constructor',modifiers:[]}])assert.throws(()=>destination({action:'custom',custom}));
});
test('fragmented HID JSON, braces in strings, multiple messages and report ID work',()=>{
  const decoder=new VendorDecoder();
  const a={m:'v.oai.hid',p:{k:'AG00',act:2,note:'{}中文"'}},b={m:'v.oai.hid',p:{k:'ENC_CW',act:2}};
  const bytes=Buffer.from(JSON.stringify(a)+JSON.stringify(b));let result=[];
  for(let i=0;i<bytes.length;i+=19){const part=[...bytes.subarray(i,i+19)];result.push(...decoder.ingest([6,2,part.length,...part]));}
  assert.deepEqual(result,[a,b]);assert.deepEqual(decoder.ingest([6,2,61,1]),[]);
  assert.deepEqual(decoder.ingest([6,2,-1]),[]);assert.deepEqual(decoder.ingest([6,2,1,999]),[]);
});
test('vendor events ignore replies and invalid codes; joystick uses hysteresis',()=>{
  const input=new VendorInputs();assert.deepEqual(input.ingest({id:2,m:'v.oai.hid',p:{k:'AG00',act:2}}),[]);
  assert.deepEqual(input.ingest({m:'v.oai.hid',p:{k:'../x',act:2}}),[]);
  assert.deepEqual(input.ingest({m:'v.oai.hid',p:{k:'AG00',act:2}}).map(e=>e.down),[true,false]);
  assert.deepEqual(input.ingest({m:'v.oai.rad',p:{a:0,d:.7}}).map(e=>e.code),['RAD_RIGHT']);
  assert.deepEqual(input.ingest({m:'v.oai.rad',p:{a:0,d:.4}}),[]);
  assert.equal(input.ingest({m:'v.oai.rad',p:{a:0,d:.2}})[0].down,false);
});
test('learning waits for release and refuses multiple controls',()=>{
  const c=new CaptureCollector();c.ingest({...source('AG00'),down:true});assert.equal(c.result(),null);
  c.ingest({...source('AG00'),down:false});assert.deepEqual(c.result(),source('AG00'));
  c.ingest({...source('AG01'),down:true});c.ingest({...source('AG01'),down:false});assert.throws(()=>c.result(),/多个/);
});
test('shared source cannot silently receive divergent actions',()=>{
  validateBindings({key1:{source:source('AG00'),action:'copy'},key2:{source:source('AG00'),action:'copy'}});
  assert.throws(()=>validateBindings({key1:{source:source('AG00'),action:'copy'},key2:{source:source('AG00'),action:'paste'}}));
  assert.throws(()=>validateBindings({unknown:{source:source('AG00'),action:'copy'}}));
});
