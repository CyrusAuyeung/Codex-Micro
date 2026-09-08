import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionOutput} from '../output.mjs';
import {VendorInputs,windowsEvent} from '../vendor.mjs';
import {destination,validateBindings} from '../model.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const binding=(code,action,extra={})=>({source:{type:'vendor_key',code,modifiers:[]},action,...extra});
test('scroll applies steps, horizontal direction and reversal without key injection',()=>{
  const commands=[],engine=new ActionOutput(c=>commands.push(c)),bindings={dial_cw:binding('ENC_CW','scroll_up',{step:3}),dial_ccw:binding('ENC_CC','scroll_left',{step:2})};
  engine.input({code:'ENC_CW',down:true},bindings,{});engine.input({code:'ENC_CW',down:false},bindings,{});assert.deepEqual(commands,[{op:'scroll',axis:'vertical',amount:3}]);
  engine.input({code:'ENC_CW',down:true},bindings,{dialReverse:true});assert.deepEqual(commands.at(-1),{op:'scroll',axis:'horizontal',amount:-2});engine.release();
  commands.length=0;engine.input({code:'ENC_CC',down:true},{dial_cw:bindings.dial_cw},{dialReverse:true});assert.deepEqual(commands,[{op:'scroll',axis:'vertical',amount:3}],'one configured direction must also reverse');engine.release();
});
test('held repeat starts after delay and stops on neutral or release',async()=>{
  const commands=[],engine=new ActionOutput(c=>commands.push(c)),bindings={stick_up:binding('RAD_UP','copy',{behavior:{repeat:true,once:true,delay:150,interval:40}})};
  validateBindings(bindings);engine.input({code:'RAD_UP',down:true},bindings,{});assert.equal(commands.length,2);await wait(230);assert.ok(commands.length>=6);
  engine.input({code:'RAD_UP',down:false},bindings,{});const end=commands.length;await wait(100);assert.equal(commands.length,end);
  engine.input({code:'RAD_UP',down:true},bindings,{});engine.release();const released=commands.length;await wait(230);assert.equal(commands.length,released);assert.equal(commands.at(-1).op,'release');
});
test('configured joystick hysteresis releases previous direction before the new one',()=>{
  const inputs=new VendorInputs({engage:.7,release:.2}),rad=(a,d)=>inputs.ingest({m:'v.oai.rad',p:{a,d}});
  assert.deepEqual(rad(0,.65),[]);assert.equal(rad(0,.8)[0].code,'RAD_RIGHT');assert.deepEqual(rad(0,.3),[]);assert.deepEqual(rad(.25,.8).map(e=>[e.code,e.down]),[['RAD_RIGHT',false],['RAD_UP',true]]);assert.equal(rad(.25,.1)[0].down,false);
});
test('modifier-only capture output preserves both sides and rejects invalid repeat limits',()=>{
  assert.deepEqual(windowsEvent(destination({action:'custom',custom:{key:'modifiers_only',modifiers:['left_control','right_alt']}})),{op:'key',code:165,modifiers:[162]});
  assert.throws(()=>validateBindings({stick_up:binding('RAD_UP','copy',{behavior:{repeat:true,delay:0,interval:1}})}));
});
