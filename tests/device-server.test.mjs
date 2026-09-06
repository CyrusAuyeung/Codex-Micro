import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mockDevice} from './mock-device.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+6000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await sleep(40);}throw new Error('Condition timed out');}
test('ordinary keyboard API works independently of browser presence and never captures Bluetooth',{timeout:20000},async t=>{
  const mock=await mockDevice();t.after(()=>mock.close());
  const data=await mkdtemp(path.join(process.env.MICRO_TEST_ROOT||tmpdir(),'micro-device-api-')),commands=path.join(data,'native-commands.jsonl');
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin='http://127.0.0.1:'+port;
  let output='';const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,MICRO_WINDOWS_DATA:data,MICRO_WINDOWS_PORT:String(port),MICRO_WINDOWS_TEST:'1',MICRO_WINDOWS_DEVICE_ORIGIN:mock.origin,MICRO_WINDOWS_HELPER:'',MICRO_WINDOWS_COMMANDS:commands},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const post=async(route,body={},expected=200)=>{const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'X-Micro-Panel':'1','Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,expected,JSON.stringify(result)+' '+output);return result;};
  t.after(async()=>{if(child.exitCode===null){try{await post('/api/quit');}catch{child.kill();}}await until(()=>child.exitCode!==null).catch(()=>child.kill());});
  await until(async()=>(await fetch(origin+'/api/health')).ok);
  const html=await(await fetch(origin)).text();assert.match(html,/普通键盘配置/);assert.match(html,/hardware.js/);
  const status=await(await fetch(origin+'/api/device/status')).json();assert.equal(status.simulation,true);assert.equal(status.localRemappingEnabled,false);
  for(const route of ['/api/device/read','/api/device/prepare','/api/device/commit']){const r=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);}
  assert.equal((await fetch(origin+'/api/device/commit')).status,404);
  const read=await post('/api/device/read'),draft=structuredClone(read.mapping);draft.key[1]='0x16';
  const review=await post('/api/device/prepare',{readToken:read.readToken,draft});assert.equal(mock.state.posts.length,0);
  const saved=await post('/api/device/commit',{token:review.token});assert.equal(saved.state,'awaiting-verification');assert.equal(mock.state.posts.length,1);
  // There is no page, WebSocket or browser heartbeat keeping this process alive.
  await sleep(150);assert.equal(child.exitCode,null);assert.equal((await post('/api/device/read')).verification.state,'verified');
  await assert.rejects(()=>access(commands),{code:'ENOENT'});
  const vendor=await(await fetch(origin+'/api/state')).json();assert.equal(vendor.status.connected,false);assert.match(vendor.status.error,/未访问真实蓝牙设备/);
  await post('/api/quit');await until(()=>child.exitCode!==null);assert.equal(child.exitCode,0,output);
});
