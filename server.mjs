import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {controls,actions,keys,sourceSignature,CaptureCollector,validateBindings,controlForCode as knownControls} from './model.mjs';
import {VendorDecoder,VendorInputs} from './vendor.mjs';
import {DeviceMapping} from './device-mapping.mjs';
import {KeyboardInput} from './input.mjs';
import {APP_VERSION} from './app-info.mjs';
import {Updates} from './updates.mjs';
import {ProfileStore,validateMotion,profileName,defaultMotion} from './profiles.mjs';
import {ActionOutput} from './output.mjs';
import {Telemetry} from './telemetry.mjs';
import {OrdinaryProfiles} from './ordinary-profiles.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=process.env.MICRO_WINDOWS_DATA||path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData/Local'),'Micro Windows');
const PORT=Number(process.env.MICRO_WINDOWS_PORT||18414);
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw new Error('Invalid local port');
const ORIGIN=`http://127.0.0.1:${PORT}`,APP='codex-micro-windows-panel';
const simulation=process.env.MICRO_WINDOWS_TEST==='1';
const testFixture=simulation&&process.env.MICRO_WINDOWS_UPDATE_FIXTURE?JSON.parse(await readFile(process.env.MICRO_WINDOWS_UPDATE_FIXTURE,'utf8')):null;
const updates=new Updates({data:DATA,simulation,testFixture});
await mkdir(DATA,{recursive:true});
const deviceMapping=new DeviceMapping({data:DATA,simulation,testOrigin:process.env.MICRO_WINDOWS_DEVICE_ORIGIN});
await deviceMapping.init();
const keyboardInput=new KeyboardInput({data:DATA,simulation});
const profiles=new ProfileStore(DATA);let state=await profiles.init();
const ordinaryProfiles=new OrdinaryProfiles(DATA);await ordinaryProfiles.init();
const telemetry=new Telemetry(DATA,simulation);await telemetry.init();
let native=null,nativeStatus={connected:false},decoder=new VendorDecoder(),inputs=new VendorInputs(state.motion);
let testing=null,telemetryRequest=null,lastTelemetryQuery=0;
const streams=new Set();let eventSequence=0;
const output=new ActionOutput(command=>{if(command.op==='release'&&!native)return;try{send(command);}catch(e){lastOutputError=e.message;}});
let learning=null,collector=null,latestLearn=null,learningTimer=null,settleTimer=null,lastOutputError=null;
let serial=Promise.resolve(),shuttingDown=false,resumeAttempt=null;
const pending=new Map();
let operations=0;
const exclusive=fn=>{operations++;const p=serial.then(fn).finally(()=>operations--);serial=p.catch(()=>{});return p;};
const sameDevice=d=>Boolean(d&&state.device&&d.location_id===state.device.location_id);
function send(command){if(!native?.stdin.writable)throw new Error('Windows 按键服务未运行。');native.stdin.write(JSON.stringify(command)+'\n');}
function publish(type,value){const text=`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;for(const client of streams){if(client.destroyed||client.writableLength>65536){client.destroy();streams.delete(client);}else client.write(text);}}
function release(){output.release();publish('reset',{});}
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
  return {...nativeStatus,mode:'vendor',enabled:state.enabled,testing:!!testing,ready:Boolean(nativeStatus.connected&&nativeStatus.canPost&&!mismatch),canLearn:Boolean(nativeStatus.connected&&!mismatch),mismatch,error:mismatch?'设备身份与保存配置不同。确认当前设备后才能继续。':lastOutputError||nativeStatus.error||null,simulation};
}
function event(event){
  if(nativeStatus.captured&&(state.enabled||testing||learning)){let controlIds=Object.entries(state.bindings).filter(([,b])=>b.source.code===event.code).map(([id])=>id);if(!controlIds.length&&knownControls[event.code])controlIds=[knownControls[event.code]];publish('input',{...event,sequence:++eventSequence,time:Date.now(),testing:!!testing,controlIds});}
  if(learning){
    const session=learning.sessionId;
    try{collector.ingest(event);}catch(e){exclusive(()=>learning?.sessionId===session?endLearn(e.message):null).catch(console.error);return;}
    clearTimeout(settleTimer);settleTimer=setTimeout(()=>exclusive(async()=>{if(learning?.sessionId!==session)return;try{const source=collector.result();if(source)await endLearn(null,source);}catch(e){await endLearn(e.message);}}).catch(console.error),250);return;
  }
  if(testing||keyboardInput.session&&!keyboardInput.session.result||!state.enabled||!nativeStatus.captured||!sameDevice(nativeStatus.device))return;
  output.input(event,state.bindings,state.motion);
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
      if(m.generation!==old.generation){release();decoder=new VendorDecoder();inputs=new VendorInputs(state.motion);telemetryRequest=null;}
      nativeStatus=m;
      if(!m.connected&&testing){testing=null;try{send({op:'capture',value:false,requestId:randomUUID()});}catch{}}
      if(old.connected&&!m.connected&&learning)exclusive(()=>endLearn('小键盘已断开，已有设置已保留。')).catch(console.error);
      if(!learning&&!testing&&!pending.size&&state.enabled&&sameDevice(m.device)&&m.connected&&!m.captured&&resumeAttempt!==m.device.location_id){
        resumeAttempt=m.device.location_id;
        exclusive(()=>capture(true)).catch(e=>{lastOutputError=e.message;});
      }
      if(!m.connected)resumeAttempt=null;
      return;
    }
    if(m.kind==='report'&&nativeStatus.connected&&m.generation===nativeStatus.generation){for(const object of decoder.ingest(m.data)){
      if(object.id===telemetryRequest){telemetryRequest=null;telemetry.acceptStatus(object.result,nativeStatus.device?.location_id).catch(console.error);}
      else for(const e of inputs.ingest(object))event(e);
    }}
  });
  native.stderr.on('data',b=>console.error(String(b)));
  const failed=message=>{nativeStatus={connected:false,error:message};testing=null;release();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear();if(learning)exclusive(()=>endLearn(message)).catch(console.error);};
  native.on('error',e=>failed('Windows HID 服务未能启动：'+e.message));
  native.on('exit',()=>{if(!shuttingDown)failed('Windows HID 服务已停止，请退出后重新启动面板。');});
}
async function persist(next,reason){state=await profiles.save(next,reason);}
function configuredDevice(){const s=status();if(!s.ready)throw new Error(s.error||'请先连接小键盘。');return structuredClone(s.device);}
function matching(source){return Object.entries(state.bindings).filter(([,b])=>sourceSignature(b.source)===sourceSignature(source)).map(([id])=>id);}
async function endLearn(message=null,source=null){
  if(!learning)return;
  const session=learning;learning=null;clearTimeout(learningTimer);clearTimeout(settleTimer);
  let conflicts=[];
  try{if(nativeStatus.connected)await capture((state.enabled||!!testing)&&sameDevice(nativeStatus.device));}catch(e){message='识别已结束，但接收方式未能恢复：'+e.message;}
  if(source&&!message){
    conflicts=matching(source).filter(id=>id!==session.controlId);
    if(conflicts.length)message=`它与 ${conflicts.map(id=>controls.find(c=>c.id===id).label).join('、')} 发出相同信号，可共用同一个功能。`;
    else {const next=structuredClone(state),old=next.bindings[session.controlId];next.device=session.device;next.bindings[session.controlId]={...old,source,action:old?.action||'original'};try{await persist(next,'识别实体按键');}catch(e){message='未能保存识别结果：'+e.message;}}
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
  for(const id of ids)next.bindings[id]={source:next.bindings[id].source,action:body.action,...(body.action==='custom'?{custom:body.custom}:{}),...(body.step!==undefined?{step:body.step}:{}),...(body.behavior?{behavior:body.behavior}:{})};
  validateBindings(next.bindings);next.device=device;next.enabled=testing||body.action==='original'?state.enabled:true;
  release();lastOutputError=null;await capture(next.enabled||!!testing);
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
  const device=enabled?configuredDevice():state.device;if(learning)await endLearn('识别已停止。');testing=null;
  const next={...structuredClone(state),enabled,device};release();lastOutputError=null;
  if(nativeStatus.connected)await capture(enabled);else if(enabled)throw new Error('小键盘未连接。');
  try{await persist(next);}catch(e){if(nativeStatus.connected)await capture(state.enabled);throw e;}
}
async function confirmDevice(){
  if(!nativeStatus.connected)throw new Error('请先连接小键盘。');
  if(learning)await endLearn('设备已重新确认。');testing=null;release();await capture(false);
  await persist({...structuredClone(state),device:structuredClone(nativeStatus.device),enabled:false});lastOutputError=null;
}
async function setTest(body){
  if(typeof body.enabled!=='boolean'||typeof body.client!=='string'||! /^[a-f0-9-]{36}$/i.test(body.client))throw new Error('测试会话无效。');
  if(!body.enabled){if(testing&&testing.client!==body.client)return;if(!testing)return;testing=null;release();if(nativeStatus.connected)await capture(state.enabled&&sameDevice(nativeStatus.device));return;}
  configuredDevice();if(learning)await endLearn('识别已停止。');if(testing&&testing.client!==body.client)throw new Error('另一个页面正在测试。');
  if(!testing){release();await capture(true);}testing={client:body.client,expires:Date.now()+7000};
}
async function changeProfiles(body){
  if(learning)await endLearn('配置已切换。');
  if(testing)await setTest({enabled:false,client:testing.client});
  const next=structuredClone(state);const current=next.profiles.find(p=>p.id===next.activeProfileId);
  if(['create','copy','rename'].includes(body.operation)&&next.profiles.some(p=>p.name===body.name?.trim()&&(body.operation!=='rename'||p.id!==current.id)))throw new Error('这个配置名称已存在，请换一个名称。');
  if(body.operation==='create'||body.operation==='copy'){next.profiles.push({id:randomUUID(),name:profileName(body.name),bindings:body.operation==='copy'?structuredClone(next.bindings):{},motion:body.operation==='copy'?structuredClone(next.motion):{...defaultMotion}});}
  else if(body.operation==='rename')current.name=profileName(body.name);
  else if(body.operation==='delete'){if(next.profiles.length===1)throw new Error('至少保留一套配置。');next.profiles=next.profiles.filter(p=>p.id!==current.id);next.activeProfileId=next.profiles[0].id;}
  else if(body.operation==='switch'){if(!next.profiles.some(p=>p.id===body.id))throw new Error('配置不存在。');next.activeProfileId=body.id;}
  else throw new Error('未知配置操作。');
  const active=next.profiles.find(p=>p.id===next.activeProfileId);next.bindings=active.bindings;next.motion=active.motion;
  release();await persist(next,({create:'新建配置',copy:'复制配置',rename:'重命名配置',delete:'删除配置',switch:'切换配置'})[body.operation]);inputs=new VendorInputs(state.motion);
}
async function applyDrafts(body){
  if(learning)throw new Error('请先完成按键识别。');
  const next=structuredClone(state);if(!body.bindings||typeof body.bindings!=='object'||Array.isArray(body.bindings))throw new Error('草稿无效。');
  for(const [id,value] of Object.entries(body.bindings)){if(!next.bindings[id])throw new Error('请先识别 '+id+' 对应的实体动作。');next.bindings[id]={...value,source:next.bindings[id].source};}
  next.motion=validateMotion(body.motion??state.motion);validateBindings(next.bindings);
  if(body.enable===true&&!testing){next.device=configuredDevice();next.enabled=true;}
  release();if(nativeStatus.connected)await capture(next.enabled||!!testing);
  try{await persist(next,'应用方案草稿');}catch(e){if(nativeStatus.connected)await capture(state.enabled||!!testing);throw e;}inputs=new VendorInputs(state.motion);
}
function queryTelemetry(force=false){if(!nativeStatus.captured||learning||telemetryRequest&&Date.now()-lastTelemetryQuery<5000||!force&&Date.now()-lastTelemetryQuery<30000)return;lastTelemetryQuery=Date.now();telemetryRequest=randomUUID();try{send({op:'device-status',requestId:telemetryRequest});}catch{telemetryRequest=null;}}
const sendJSON=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function bodyJSON(req){let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576)throw new Error('请求过大。');body+=chunk;}const result=JSON.parse(body||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('请求格式无效。');return result;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(req.headers.host!==`127.0.0.1:${PORT}`){sendJSON(res,403,{error:'仅允许本机访问。'});return;}
  try{
    const url=new URL(req.url,ORIGIN);
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.method==='GET'&&url.pathname==='/api/events'){startNative();res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write('event: reset\ndata: {}\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
    if(req.method==='GET'&&url.pathname==='/api/telemetry'){startNative();telemetry.refresh().catch(console.error);queryTelemetry();sendJSON(res,200,telemetry.view(nativeStatus));return;}
    if(req.method==='GET'&&url.pathname==='/api/startup'){sendJSON(res,200,await telemetry.startupState());return;}
    if(req.method==='GET'&&url.pathname==='/api/updates/status'){sendJSON(res,200,updates.status());return;}
    if(req.method==='GET'&&url.pathname==='/api/updates/result'){let result=null;try{result=JSON.parse(await readFile(path.join(DATA,'updates/install-result.json'),'utf8'));}catch{}sendJSON(res,200,{result});return;}
    if(req.method==='GET'&&url.pathname==='/api/ordinary/profiles'){sendJSON(res,200,ordinaryProfiles.view());return;}
    if(req.method==='GET'&&url.pathname==='/api/ordinary/profiles/export'){sendJSON(res,200,ordinaryProfiles.export(url.searchParams.get('all')==='1'));return;}
    if(req.method==='GET'&&url.pathname==='/api/ordinary/profiles/backups'){sendJSON(res,200,{backups:await ordinaryProfiles.listBackups()});return;}
    if(req.method==='GET'&&url.pathname==='/api/profiles/export'){sendJSON(res,200,profiles.export(url.searchParams.get('all')==='1'));return;}
    if(req.method==='GET'&&url.pathname==='/api/profiles/backups'){sendJSON(res,200,{backups:await profiles.listBackups()});return;}
    if(req.method==='GET'&&url.pathname==='/api/health'){sendJSON(res,200,{app:APP,version:APP_VERSION,simulation,deviceMapping:true,busy:operations>0});return;}
    if(req.method==='GET'&&url.pathname==='/api/device/status'){sendJSON(res,200,{app:APP,...deviceMapping.status(),localRemappingEnabled:state.enabled});return;}
    if(req.method==='GET'&&url.pathname==='/api/state'){startNative();sendJSON(res,200,{app:APP,status:status(),controls,actions,keys,bindings:state.bindings,...profiles.view(state),defaults:{},savedKeyboardCount:0,learning:learning?{...learning,diagnostics:collector.diagnostics()}:null,latestLearn});return;}
    if(req.method==='POST'){
      if(req.headers.origin!==ORIGIN||req.headers['x-micro-panel']!=='1'){sendJSON(res,403,{error:'请从本机面板操作。'});return;}
      const b=await bodyJSON(req);
      if(url.pathname==='/api/telemetry/refresh'){await telemetry.refresh(true);queryTelemetry(true);sendJSON(res,200,telemetry.view(nativeStatus));return;}
      if(url.pathname==='/api/startup'){sendJSON(res,200,await telemetry.setStartup(b.enabled));return;}
      if(url.pathname==='/api/ordinary/profiles'){sendJSON(res,200,await exclusive(()=>ordinaryProfiles.change(b)));return;}
      if(url.pathname==='/api/ordinary/profiles/import'){sendJSON(res,200,await exclusive(()=>ordinaryProfiles.import(b.data)));return;}
      if(url.pathname==='/api/ordinary/profiles/backup'){sendJSON(res,200,await exclusive(()=>ordinaryProfiles.change({operation:'backup'})));return;}
      if(url.pathname==='/api/ordinary/profiles/restore'){sendJSON(res,200,b.confirm?await exclusive(()=>ordinaryProfiles.restore(b.id)):ordinaryProfiles.view(await ordinaryProfiles.readBackup(b.id)));return;}
      if(url.pathname==='/api/test'){await exclusive(()=>setTest(b));sendJSON(res,200,{testing:!!testing});return;}
      if(url.pathname==='/api/profiles'){await exclusive(()=>changeProfiles(b));sendJSON(res,200,profiles.view(state));return;}
      if(url.pathname==='/api/profiles/apply'){await exclusive(()=>applyDrafts(b));sendJSON(res,200,{ok:true});return;}
      if(url.pathname==='/api/profiles/import'){await exclusive(()=>persist(profiles.import(b.data),'导入配置方案'));sendJSON(res,200,profiles.view(state));return;}
      if(url.pathname==='/api/profiles/backup'){await exclusive(()=>persist(structuredClone(state),'手动备份'));sendJSON(res,200,{ok:true});return;}
      if(url.pathname==='/api/profiles/restore'){const backup=await profiles.readBackup(b.id);if(!b.confirm){sendJSON(res,200,{...profiles.view(backup),enabled:backup.enabled});return;}await exclusive(async()=>{if(testing)await setTest({enabled:false,client:testing.client});if(learning)await endLearn('恢复配置。');release();await persist({...backup,device:state.device,enabled:state.enabled},'恢复前备份');inputs=new VendorInputs(state.motion);});sendJSON(res,200,profiles.view(state));return;}
      if(url.pathname==='/api/updates'){sendJSON(res,200,await updates.check(b.force===true));return;}
      if(url.pathname==='/api/updates/download'){sendJSON(res,200,updates.start());return;}
      if(url.pathname==='/api/updates/cancel'){sendJSON(res,200,updates.cancel());return;}
      if(url.pathname==='/api/updates/prepare'){if(operations||learning||keyboardInput.session&&!keyboardInput.session.result)throw new Error('请先完成当前操作，再安装更新。');sendJSON(res,200,await exclusive(()=>updates.prepare()));return;}
      if(url.pathname==='/api/input/state'){sendJSON(res,200,await keyboardInput.state(b.client));return;}
      if(url.pathname==='/api/input/record'){release();sendJSON(res,200,await keyboardInput.begin(b.client,b.id));return;}
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
    const file={'/':'shell.html','/codex':'shell.html','/views/ordinary':'hardware.html','/views/codex':'index.html','/app.js':'app.js','/style.css':'style.css','/hardware.js':'hardware.js','/hardware.css':'hardware.css','/mapping-core.js':'mapping-core.js','/desktop.css':'desktop.css','/desktop.js':'desktop.js','/keyboard.css':'keyboard.css','/micro.svg':'micro.svg','/components.js':'components.js','/profile-manager.js':'profile-manager.js','/record.js':'record.js','/next.css':'next.css','/device-info.js':'device-info.js'}[url.pathname];
    if(req.method!=='GET'||!file){sendJSON(res,404,{error:'页面不存在。'});return;}
    res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)],'Cache-Control':'no-store'});res.end(await readFile(path.join(ROOT,'public',file)));
  }catch(e){sendJSON(res,400,{error:e.message||'操作未完成。',...(e.network?{network:e.network}:{})});}
});
const heartbeat=setInterval(()=>{try{send({op:'heartbeat'});}catch{}for(const client of streams)client.write(': heartbeat\n\n');if(testing&&Date.now()>testing.expires)exclusive(()=>testing?setTest({enabled:false,client:testing.client}):null).catch(console.error);queryTelemetry();},2000);
async function shutdown(){if(shuttingDown)return;shuttingDown=true;keyboardInput.close();clearInterval(heartbeat);clearTimeout(learningTimer);clearTimeout(settleTimer);release();for(const client of streams)client.end();try{send({op:'quit'});native.stdin.end();}catch{}server.close(()=>process.exit(0));setTimeout(()=>{native?.kill();process.exit(0);},1500).unref();}
server.listen(PORT,'127.0.0.1',()=>{if(state.enabled)startNative();console.log(`Micro Windows: ${ORIGIN}${simulation?' [SIMULATION]':''}`);});
server.on('error',e=>{console.error(e.message);process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
