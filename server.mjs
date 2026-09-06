import http from 'node:http';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {controls,actions,keys,destination,sourceSignature,CaptureCollector,validateBindings} from './model.mjs';
import {VendorDecoder,VendorInputs,windowsEvent} from './vendor.mjs';
import {DeviceMapping} from './device-mapping.mjs';
import {KeyboardInput} from './input.mjs';
import {APP_VERSION} from './app-info.mjs';
import {Updates} from './updates.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=process.env.MICRO_WINDOWS_DATA||path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData/Local'),'Micro Windows');
const STORE=path.join(DATA,'bindings.json');
const PORT=Number(process.env.MICRO_WINDOWS_PORT||18414);
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw new Error('Invalid local port');
const ORIGIN=`http://127.0.0.1:${PORT}`,APP='codex-micro-windows-panel';
const simulation=process.env.MICRO_WINDOWS_TEST==='1';
const updates=new Updates({data:DATA,simulation});
await mkdir(DATA,{recursive:true});
const deviceMapping=new DeviceMapping({data:DATA,simulation,testOrigin:process.env.MICRO_WINDOWS_DEVICE_ORIGIN});
await deviceMapping.init();
const keyboardInput=new KeyboardInput({data:DATA,simulation});
let state={version:1,bindings:{},device:null,enabled:false};
try{state=JSON.parse(await readFile(STORE,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('配置无法读取，原文件已保留：'+e.message);}
if(state.version!==1||typeof state.enabled!=='boolean')throw new Error('配置版本或启用状态无效，原文件已保留。');
validateBindings(state.bindings);
let native=null,nativeStatus={connected:false},decoder=new VendorDecoder(),inputs=new VendorInputs();
let learning=null,collector=null,latestLearn=null,learningTimer=null,settleTimer=null,lastOutputError=null;
let serial=Promise.resolve(),shuttingDown=false,resumeAttempt=null;
const pending=new Map(),held=new Map();
let operations=0;
const exclusive=fn=>{operations++;const p=serial.then(fn).finally(()=>operations--);serial=p.catch(()=>{});return p;};
const sameDevice=d=>Boolean(d&&state.device&&d.location_id===state.device.location_id);
function send(command){if(!native?.stdin.writable)throw new Error('Windows 按键服务未运行。');native.stdin.write(JSON.stringify(command)+'\n');}
function release(){held.clear();try{send({op:'release'});}catch{}}
function capture(value){
  const requestId=randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(requestId);release();reject(new Error('小键盘接收方式切换超时。'));},5000);
    pending.set(requestId,{resolve,reject,timer});
    try{send({op:'capture',value,requestId});}catch(e){clearTimeout(timer);pending.delete(requestId);reject(e);}
  });
}
function status(){
  const mismatch=Boolean(nativeStatus.connected&&state.device&&!sameDevice(nativeStatus.device));
  return {...nativeStatus,mode:'vendor',enabled:state.enabled,ready:Boolean(nativeStatus.connected&&nativeStatus.canPost&&!mismatch),canLearn:Boolean(nativeStatus.connected&&!mismatch),mismatch,error:mismatch?'设备身份与保存配置不同。确认当前设备后才能继续。':lastOutputError||nativeStatus.error||null,simulation};
}
function event(event){
  if(learning){
    const session=learning.sessionId;
    try{collector.ingest(event);}catch(e){exclusive(()=>learning?.sessionId===session?endLearn(e.message):null).catch(console.error);return;}
    clearTimeout(settleTimer);settleTimer=setTimeout(()=>exclusive(async()=>{if(learning?.sessionId!==session)return;try{const source=collector.result();if(source)await endLearn(null,source);}catch(e){await endLearn(e.message);}}).catch(console.error),250);return;
  }
  if(!state.enabled||!nativeStatus.captured||!sameDevice(nativeStatus.device))return;
  if(!event.down){const output=held.get(event.code);if(output)send({...output,id:event.code,down:false});held.delete(event.code);return;}
  if(held.has(event.code))return;
  const binding=Object.values(state.bindings).find(b=>b.source.code===event.code);
  if(!binding)return;
  const output=windowsEvent(destination(binding));if(output){held.set(event.code,output);send({...output,id:event.code,down:true});}
}
function startNative(){
  if(native)return;
  const fixture=simulation?process.env.MICRO_WINDOWS_HELPER:null;
  if(simulation&&!fixture){nativeStatus={connected:false,error:'模拟 HID 辅助程序未配置，未访问真实蓝牙设备。'};return;}
  native=spawn(fixture?process.execPath:path.join(ROOT,'MicroHID.Windows.exe'),fixture?[fixture]:[],{stdio:['pipe','pipe','pipe'],windowsHide:true,cwd:ROOT});
  createInterface({input:native.stdout}).on('line',line=>{
    let m;try{m=JSON.parse(line);}catch{return;}
    if(m.kind==='ack'){const p=pending.get(m.requestId);if(!p)return;clearTimeout(p.timer);pending.delete(m.requestId);if(m.ok){lastOutputError=null;p.resolve();}else{lastOutputError=m.error||'无法接管小键盘。';p.reject(new Error(lastOutputError));}return;}
    if(m.kind==='output-error'){lastOutputError=m.error;release();return;}
    if(m.kind==='status'){
      const old=nativeStatus;
      if(m.generation!==old.generation){release();decoder=new VendorDecoder();inputs=new VendorInputs();}
      nativeStatus=m;
      if(old.connected&&!m.connected&&learning)exclusive(()=>endLearn('小键盘已断开，已有设置已保留。')).catch(console.error);
      if(!learning&&!pending.size&&state.enabled&&sameDevice(m.device)&&m.connected&&!m.captured&&resumeAttempt!==m.device.location_id){
        resumeAttempt=m.device.location_id;
        exclusive(()=>capture(true)).catch(e=>{lastOutputError=e.message;});
      }
      if(!m.connected)resumeAttempt=null;
      return;
    }
    if(m.kind==='report'&&nativeStatus.connected&&m.generation===nativeStatus.generation){for(const object of decoder.ingest(m.data))for(const e of inputs.ingest(object))event(e);}
  });
  native.stderr.on('data',b=>console.error(String(b)));
  const failed=message=>{nativeStatus={connected:false,error:message};release();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear();if(learning)exclusive(()=>endLearn(message)).catch(console.error);};
  native.on('error',e=>failed('Windows HID 服务未能启动：'+e.message));
  native.on('exit',()=>{if(!shuttingDown)failed('Windows HID 服务已停止，请退出后重新启动面板。');});
}
async function persist(next){
  validateBindings(next.bindings);await mkdir(path.join(DATA,'backups'),{recursive:true});
  await copyFile(STORE,path.join(DATA,'backups',Date.now()+'.'+randomUUID()+'.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const tmp=STORE+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(next,null,2)+'\n');await rename(tmp,STORE);state=next;
}
function configuredDevice(){const s=status();if(!s.ready)throw new Error(s.error||'请先连接小键盘。');return structuredClone(s.device);}
function matching(source){return Object.entries(state.bindings).filter(([,b])=>sourceSignature(b.source)===sourceSignature(source)).map(([id])=>id);}
async function endLearn(message=null,source=null){
  if(!learning)return;
  const session=learning;learning=null;clearTimeout(learningTimer);clearTimeout(settleTimer);
  let conflicts=[];
  try{if(nativeStatus.connected)await capture(state.enabled&&sameDevice(nativeStatus.device));}catch(e){message='识别已结束，但接收方式未能恢复：'+e.message;}
  if(source&&!message){
    conflicts=matching(source).filter(id=>id!==session.controlId);
    if(conflicts.length)message=`它与 ${conflicts.map(id=>controls.find(c=>c.id===id).label).join('、')} 发出相同信号，可共用同一个功能。`;
    else {const next=structuredClone(state),old=next.bindings[session.controlId];next.device=session.device;next.bindings[session.controlId]={source,action:old?.action||'original',...(old?.custom?{custom:old.custom}:{})};try{await persist(next);}catch(e){message='未能保存识别结果：'+e.message;}}
  }
  latestLearn={...session,source:message&&!conflicts.length?null:source,conflicts,error:message,diagnostics:collector.diagnostics(),finishedAt:Date.now()};
}
async function startLearn(controlId){
  if(!controls.some(c=>c.id===controlId))throw new Error('控件不存在。');
  if(learning)await endLearn('已切换识别目标。');
  const device=configuredDevice();
  learning={controlId,device,mode:'vendor',sessionId:randomUUID(),expires:Date.now()+20000};
  collector=new CaptureCollector();latestLearn=null;release();lastOutputError=null;
  try{await capture(true);}catch(e){learning=null;throw e;}
  const session=learning.sessionId;learningTimer=setTimeout(()=>exclusive(()=>learning?.sessionId===session?endLearn(collector.received?'请松开按键后重新识别。':'未收到该动作的独立信号。请确认处于青灯 Codex 模式；部分触摸或电源动作仅供硬件自身使用。'):null).catch(console.error),20000);
  return learning;
}
async function saveBinding(body){
  if(learning)await endLearn('识别已停止。');const device=configuredDevice();
  const b=state.bindings[body.controlId];if(!b)throw new Error('请先识别这个实体按键。');
  const ids=matching(b.source);
  if(ids.length>1&&JSON.stringify([...(body.sharedControlIds||[])].sort())!==JSON.stringify([...ids].sort()))throw new Error('请确认一起修改的同信号按键。');
  const next=structuredClone(state);
  for(const id of ids)next.bindings[id]={source:next.bindings[id].source,action:body.action,...(body.action==='custom'?{custom:body.custom}:{})};
  validateBindings(next.bindings);next.device=device;next.enabled=body.action==='original'?state.enabled:true;
  release();lastOutputError=null;await capture(next.enabled);
  try{await persist(next);}catch(e){await capture(state.enabled);throw e;}
}
async function shareSource(body){
  const r=latestLearn;
  if(learning||!r?.conflicts.length||r.sessionId!==body.sessionId||r.controlId!==body.controlId)throw new Error('识别结果已过期，请重新识别。');
  const device=configuredDevice();if(device.location_id!==r.device.location_id)throw new Error('设备已改变，请重新识别。');
  const ids=matching(r.source);if(!ids.length)throw new Error('共用信号已改变，请重新识别。');
  const next=structuredClone(state);next.device=device;next.bindings[r.controlId]=structuredClone(next.bindings[ids[0]]);await persist(next);
  latestLearn={...r,conflicts:[],error:null,finishedAt:Date.now()};
}
async function enable(enabled){
  if(typeof enabled!=='boolean')throw new Error('启用状态无效。');
  const device=enabled?configuredDevice():state.device;if(learning)await endLearn('识别已停止。');
  const next={...structuredClone(state),enabled,device};release();lastOutputError=null;
  if(nativeStatus.connected)await capture(enabled);else if(enabled)throw new Error('小键盘未连接。');
  try{await persist(next);}catch(e){if(nativeStatus.connected)await capture(state.enabled);throw e;}
}
async function confirmDevice(){
  if(!nativeStatus.connected)throw new Error('请先连接小键盘。');
  if(learning)await endLearn('设备已重新确认。');release();await capture(false);
  await persist({...structuredClone(state),device:structuredClone(nativeStatus.device),enabled:false});lastOutputError=null;
}
const sendJSON=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function bodyJSON(req){let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('请求过大。');body+=chunk;}const result=JSON.parse(body||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('请求格式无效。');return result;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(req.headers.host!==`127.0.0.1:${PORT}`){sendJSON(res,403,{error:'仅允许本机访问。'});return;}
  try{
    const url=new URL(req.url,ORIGIN);
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.method==='GET'&&url.pathname==='/api/health'){sendJSON(res,200,{app:APP,version:APP_VERSION,simulation,deviceMapping:true,busy:operations>0});return;}
    if(req.method==='GET'&&url.pathname==='/api/device/status'){sendJSON(res,200,{app:APP,...deviceMapping.status(),localRemappingEnabled:state.enabled});return;}
    if(req.method==='GET'&&url.pathname==='/api/state'){startNative();sendJSON(res,200,{app:APP,status:status(),controls,actions,keys,bindings:state.bindings,defaults:{},savedKeyboardCount:0,learning:learning?{...learning,diagnostics:collector.diagnostics()}:null,latestLearn});return;}
    if(req.method==='POST'){
      if(req.headers.origin!==ORIGIN||req.headers['x-micro-panel']!=='1'){sendJSON(res,403,{error:'请从本机面板操作。'});return;}
      const b=await bodyJSON(req);
      if(url.pathname==='/api/updates'){sendJSON(res,200,await updates.check(b.force===true));return;}
      if(url.pathname==='/api/input/state'){sendJSON(res,200,await keyboardInput.state(b.client));return;}
      if(url.pathname==='/api/input/record'){sendJSON(res,200,await keyboardInput.begin(b.client,b.id));return;}
      if(url.pathname==='/api/input/confirm'){sendJSON(res,200,await keyboardInput.confirm(b.client,b.id,b.revision));return;}
      if(url.pathname==='/api/input/cancel'){keyboardInput.cancel(b.client,b.id);sendJSON(res,200,{ok:true});return;}
      if(url.pathname==='/api/device/diagnose'){sendJSON(res,200,await exclusive(async()=>{try{await deviceMapping.current();return {ok:true,network:deviceMapping.network.last};}catch(e){return {ok:false,error:e.message,network:e.network||deviceMapping.network.last};}}));return;}
      if(url.pathname==='/api/device/repair'){sendJSON(res,200,await exclusive(()=>deviceMapping.network.repair()));return;}
      if(url.pathname==='/api/device/read'){sendJSON(res,200,await exclusive(()=>deviceMapping.read()));return;}
      if(url.pathname==='/api/device/prepare'){sendJSON(res,200,await exclusive(()=>deviceMapping.prepare(b)));return;}
      if(url.pathname==='/api/device/commit'){sendJSON(res,200,await exclusive(()=>deviceMapping.commit(b)));return;}
      if(url.pathname==='/api/learn'){sendJSON(res,200,{learning:await exclusive(()=>startLearn(b.controlId))});return;}
      if(url.pathname==='/api/cancel-learn')await exclusive(()=>!learning||b.sessionId===learning.sessionId?endLearn('已取消识别。'):null);
      else if(url.pathname==='/api/save')await exclusive(()=>saveBinding(b));
      else if(url.pathname==='/api/share-source')await exclusive(()=>shareSource(b));
      else if(url.pathname==='/api/vendor-enabled')await exclusive(()=>enable(b.enabled));
      else if(url.pathname==='/api/confirm-device')await exclusive(()=>confirmDevice());
      else if(url.pathname==='/api/open-setup'){if(!simulation)spawn('explorer.exe',['ms-settings:bluetooth'],{windowsHide:true}).on('error',console.error);}
      else if(url.pathname==='/api/quit'){if(operations)throw new Error('正在与键盘通信，请完成后再退出。');sendJSON(res,200,{ok:true});setImmediate(shutdown);return;}
      else{sendJSON(res,404,{error:'没有这个操作。'});return;}
      sendJSON(res,200,{ok:true});return;
    }
    const file={'/':'hardware.html','/codex':'index.html','/app.js':'app.js','/style.css':'style.css','/hardware.js':'hardware.js','/hardware.css':'hardware.css','/mapping-core.js':'mapping-core.js','/desktop.css':'desktop.css','/desktop.js':'desktop.js'}[url.pathname];
    if(req.method!=='GET'||!file){sendJSON(res,404,{error:'页面不存在。'});return;}
    res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(file)],'Cache-Control':'no-store'});res.end(await readFile(path.join(ROOT,'public',file)));
  }catch(e){sendJSON(res,400,{error:e.message||'操作未完成。',...(e.network?{network:e.network}:{})});}
});
const heartbeat=setInterval(()=>{try{send({op:'heartbeat'});}catch{}},2000);
async function shutdown(){if(shuttingDown)return;shuttingDown=true;keyboardInput.close();clearInterval(heartbeat);clearTimeout(learningTimer);clearTimeout(settleTimer);release();try{send({op:'quit'});native.stdin.end();}catch{}server.close(()=>process.exit(0));setTimeout(()=>{native?.kill();process.exit(0);},1500).unref();}
server.listen(PORT,'127.0.0.1',()=>{if(state.enabled)startNative();console.log(`Micro Windows: ${ORIGIN}${simulation?' [SIMULATION]':''}`);});
server.on('error',e=>{console.error(e.message);process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
