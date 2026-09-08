import './mapping-core.js';
import {ask,syncControls} from './components.js';
import {profileManager} from './profile-manager.js';
export async function mount(root){
const C=globalThis.MicroMapping,$=id=>root.querySelector('#'+id)||document.getElementById(id);
const empty=()=>({mod:Array(16).fill(null),key:Array(16).fill(null)});
let baseline=empty(),draft=empty(),readToken=null,busy=false,stopped=false,recording=false,recordTimer=null,selected=1,saveToken=null,verification={state:'idle'},simulation=false;
let connection=null,library=null,manager,deviceBaseline=null,customSelected=false;
const cards=[],mods=[];
const inputClient=crypto.randomUUID();
let inputPolling=false,inputTimer=null,recordId=null,recordSlot=null,recordReady=false,recordConfirming=false,recordCandidate=null;
const presets=[['复制',1,6],['粘贴',1,25],['撤销',1,29],['截图',10,22],['保存',1,22],['查找',1,9],['桌面',8,7],['任务视图',8,43]];
function notify(text,error=false){clearTimeout(notify.timer);$('notice').textContent=text;$('notice').hidden=false;$('notice').classList.toggle('error',error);notify.timer=setTimeout(()=>$('notice').hidden=true,error?12000:5000);}
function make(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function changed(){return C.changed(baseline,draft);}
function labelAt(i){return draft.mod[i]===null||C.keyNumber(draft.key[i])===null?'未配置':draft.mod[i]===0&&C.keyNumber(draft.key[i])===0?'未设置':C.parts(draft,i).join(' + ');}
function stopRecord(){
  const id=recordId;recordId=null;recordSlot=null;recording=false;recordReady=false;recordConfirming=false;recordCandidate=null;clearTimeout(recordTimer);clearInterval(inputTimer);inputTimer=null;
  $('record-target').value='';
  $('confirm-record').disabled=true;
  if($('record-dialog').open)$('record-dialog').close();
  if(id)api('/api/input/cancel',{client:inputClient,id}).catch(()=>{});
}
function finishRecord(result){
  if(!recording||recordSlot!==selected)return;
  draft.mod[selected]=result.mod;draft.key[selected]=C.hex(C.keyNumber(result.key));
  stopRecord();customSelected=true;render();notify('组合键已录入。');
}
function recordPrompt(){return '请按下组合键。';}
function showRecordState(session){
  if(!recording||!recordReady)return;
  recordCandidate=session.candidate||null;
  const progress=session.progress,holding=progress?.holding===true;
  let value='',status=recordPrompt();
  if(holding){
    const {mod,key}=progress;
    value=mod||key!==null?C.parts({mod:[mod],key:[key===null?0:key]},0).join(' + '):'';
    if(key===0)value=(mod?value+' + ':'')+'未识别按键';
    status=key===0?'暂不支持此按键，请重新试按。':'请松开全部按键后确认。';
  }else if(recordCandidate){
    value=recordCandidate.error?'未识别按键':C.parts({mod:[recordCandidate.mod],key:[recordCandidate.key]},0).join(' + ');
    status=recordCandidate.error||'可继续试按，或点击“使用此组合”。';
  }
  if($('record-target').value!==value)$('record-target').value=value;
  $('record-preview-label').textContent=holding?'本轮组合':recordCandidate?'待使用的组合':'实时预览';
  $('confirm-record').disabled=recordConfirming||holding||!recordCandidate||Boolean(recordCandidate.error);
  if(recordConfirming)status='正在确认组合键…';
  if($('record-status').textContent!==status)$('record-status').textContent=status;
}
async function confirmRecord(){
  if(!recording||!recordReady||recordConfirming||$('confirm-record').disabled)return;
  const id=recordId,revision=recordCandidate.revision;recordConfirming=true;$('confirm-record').disabled=true;$('record-status').textContent='正在确认组合键…';
  try{const result=await api('/api/input/confirm',{client:inputClient,id,revision},6000);if(recordId===id)finishRecord(result);}
  catch(e){if(recordId===id){recordConfirming=false;$('record-status').textContent=e.message;pollInput();}}
}
async function startRecord(){
  if(busy||stopped)return;if(recording){stopRecord();render();return;}
  recording=true;recordSlot=selected;recordId=crypto.randomUUID();const id=recordId;
  $('record-target').value='';$('record-target').placeholder='正在准备…';$('record-preview-label').textContent='实时预览';$('confirm-record').disabled=true;$('record-status').textContent='正在准备，请稍候…';
  $('record-dialog').showModal();$('record-target').focus();render();
  inputTimer=setInterval(pollInput,50);pollInput();
  recordTimer=setTimeout(()=>{stopRecord();render();notify('录入超时，请重试。',true);},60000);
  try{const result=await api('/api/input/record',{client:inputClient,id});if(!recording||recordId!==id){await api('/api/input/cancel',{client:inputClient,id});return;}
    if(!result.guarded||!result.confirmRequired)throw new Error('录入组件版本不匹配，请退出程序后重新启动新版。');
    recordReady=true;$('record-target').placeholder='按键会实时显示在这里…';$('record-status').textContent=recordPrompt();pollInput();
  }catch(e){if(recordId===id){stopRecord();render();notify(e.message,true);}}
}
async function pollInput(){
  if(inputPolling||!recording||stopped||document.hidden)return;inputPolling=true;const id=recordId;
  try{
    const inputState=await api('/api/input/state',{client:inputClient},5000);
    const result=inputState.recording?.result;
    // Only the confirm request may apply the result. Polling must not cancel its session first.
    if(recording&&result?.id===recordId){if(result.error){stopRecord();render();notify(result.error,true);}}
    else if(recordId===id&&recordReady){
      if(inputState.recording?.id===id)showRecordState(inputState.recording);
      else{stopRecord();render();notify('录入已结束，请重试。',true);}
    }
  }catch(e){if(recordId===id){stopRecord();render();notify(e.message,true);}}finally{inputPolling=false;}
}
function describeVerification(v){
  if(v.state==='verified')return readToken?'已核对一致。':'上次写入已核对。';
  if(v.state==='not-applied')return '未检测到上次修改，请检查配置。';
  if(v.state==='different')return '与预期不符：'+v.differences.map(i=>C.slotLabel(i)).join('、')+'。';
  if(['sending','awaiting-verification','uncertain'].includes(v.state))return '上次写入待核对，请重新读取键盘。';
  return '';
}
function render(){
  const changes=changed(),missing=C.missing(draft),locked=busy||stopped;
  for(let i=0;i<16;i++){
    const preset=presets.find(([,m,k])=>draft.mod[i]===m&&C.keyNumber(draft.key[i])===k);cards[i].querySelector('strong').textContent=preset?.[0]||labelAt(i);const dot=cards[i].querySelector('.key-assigned');if(dot)dot.hidden=missing.includes(i)||draft.mod[i]===0&&C.keyNumber(draft.key[i])===0;
    cards[i].querySelector('.key-function')?.classList.toggle('empty',missing.includes(i));
    cards[i].setAttribute('aria-label',C.slotLabel(i)+'，'+C.LAYOUT[i].location+'，'+C.parts(draft,i).join(' + '));
    cards[i].title=C.slotLabel(i)+' · '+C.slotReference(i)+'\n'+C.parts(draft,i).join(' + ');
    cards[i].setAttribute('aria-pressed',String(i===selected));cards[i].classList.toggle('selected',i===selected);cards[i].classList.toggle('modified',C.LAYOUT[i].kind==='other'&&changes.includes(i));cards[i].classList.toggle('draft',changes.includes(i));cards[i].classList.toggle('unread',missing.includes(i));cards[i].disabled=locked;
  }
  $('selected-label').textContent=C.slotLabel(selected);
  $('selected-location').textContent=C.LAYOUT[selected].location;
  const otherChanges=changes.filter(i=>C.LAYOUT[i].kind==='other').length;
  $('other-slot-state').textContent=otherChanges?otherChanges+' 项修改':'2 项';
  $('other-slots').classList.toggle('has-changes',otherChanges>0);
  const value=C.keyNumber(draft.key[selected]),select=$('key-select');
  $('shortcut-preview').textContent=missing.includes(selected)||(draft.mod[selected]===0&&value===0)?'—':labelAt(selected);
  select.querySelectorAll('[data-dynamic]').forEach(e=>e.remove());
  if(value===null||!C.KEYS.some(k=>k.n===value)){const op=make('option',C.keyLabel(draft.key[selected]));op.dataset.dynamic='1';op.value=value===null?'':C.hex(value);select.prepend(op);}
  select.value=value===null?'':C.hex(value);select.disabled=locked||recording;
  mods.forEach((m,i)=>{m.setAttribute('aria-pressed',String(Boolean((draft.mod[selected]||0)&C.MODS[i].v)));m.disabled=locked||recording;});
  root.querySelectorAll('[data-preset]').forEach(e=>e.disabled=locked||recording);
  $('record-button').disabled=locked;$('record-button').textContent=recording?'等待组合键 · 点击取消':'录入组合键';
  $('restore-button').disabled=locked||recording||(draft.mod[selected]===0&&value===0);$('undo-button').disabled=locked||recording||!changes.length;
  $('read-button').disabled=locked||recording;$('read-button').textContent='读取键盘';
  $('diagnose-button').disabled=locked;$('repair-button').disabled=locked;
  $('save-button').disabled=locked||recording||!changes.length||!library;
  $('write-button').disabled=locked||recording||missing.length===16;
  $('manage-profiles').disabled=locked||recording||!library;
  $('profile-select').disabled=locked||recording||!library;
  if(library){const signature=JSON.stringify(library.profiles);if($('profile-select').dataset.signature!==signature){$('profile-select').replaceChildren(...library.profiles.map(p=>new Option(p.name,p.id)));$('profile-select').dataset.signature=signature;}$('profile-select').value=library.activeProfileId;}
  const preset=presets.findIndex(([,m,k])=>m===draft.mod[selected]&&k===value),action=customSelected?'custom':missing.includes(selected)?'':draft.mod[selected]===0&&value===0?'original':preset>=0?String(preset):'custom';
  $('action-select').value=action;$('action-select').disabled=locked||recording;$('custom-controls').hidden=action!=='custom';
  $('result-label').textContent=action===''?'选择功能':action==='original'?'未设置功能':preset>=0?presets[preset][0]:'自定义快捷键';
  for(const button of root.querySelectorAll('[data-preset]'))button.classList.toggle('active',presets[preset]?.[0]===button.dataset.preset);
  $('change-count').textContent=(16-missing.length)+' 项已配置';
  if(stopped){$('connection-state').textContent='Micro Windows 已退出';$('save-state').textContent='本地服务已停止';$('save-detail').textContent='';return;}
  $('connection-state').className='status'+(readToken?'':' wait');$('connection-state').textContent=busy?'正在与键盘通信':readToken?'已读取设备配置':connection?.summary||'尚未读取键盘';
  $('save-state').textContent=changes.length?changes.length+' 项修改未保存':'配置已保存';
  const synchronized=deviceBaseline&&!C.missing(draft).length&&!C.changed(deviceBaseline,draft).length;
  $('save-detail').textContent=changes.length?'保存后可写入键盘。':describeVerification(verification)||(synchronized?'已与键盘核对一致。':'写入键盘后生效。');
  $('save-detail').title=$('save-detail').textContent;
  document.dispatchEvent(new Event('micro-render'));
}
function showNetwork(value){
  if(!value)return;connection=value;
  $('network-title').textContent=value.reachable?'键盘配置接口可用':value.summary;
  $('network-detail').textContent=value.detail;
  $('network-time').textContent='检查时间：'+new Date(value.checkedAt).toLocaleTimeString();
  $('repair-button').hidden=!value.canRepair;
}
async function api(route,body={},timeout=25000){
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),timeout);
  try{
    const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify(body),signal:control.signal});
    const data=await response.json();if(data.network)showNetwork(data.network);if(!response.ok)throw new Error(data.error||'操作未完成。');return data;
  }catch(e){if(e.name==='AbortError')throw new Error('本地服务响应超时。涉及写入时请先重新读取核对，不要重复保存。');throw e;}finally{clearTimeout(timer);}
}
async function load(){
  if(busy||stopped)return;
  if(!await guardDrafts())return;
  busy=true;stopRecord();render();
  try{
    const r=await api('/api/device/read');deviceBaseline=C.validate(r.mapping,false);draft=C.clone(deviceBaseline);customSelected=false;readToken=r.readToken;verification=r.verification;
    notify(describeVerification(verification)||'已读取键盘配置。',verification.state==='different'||verification.state==='not-applied');
  }catch(e){readToken=null;notify('读取失败：'+e.message,true);}
  finally{busy=false;render();}
}
for(const slot of C.LAYOUT){
  const i=slot.index,b=slot.kind==='dial'?$('mapping-dial'):make('button',undefined,slot.kind==='key'?'hardware':'mapping-key');
  b.type='button';b.dataset.slot=String(i);
  if(slot.kind==='key'){
    b.id='mapping-'+slot.id;b.style.gridRow=String(slot.row+1);b.style.gridColumn=String(slot.col+1);
    b.append(make('span',slot.short,'key-number'),make('strong','未配置','key-function'),make('span',undefined,'key-assigned'));$('mapping-grid').append(b);
  }else if(slot.kind==='other'){
    b.id='mapping-slot-'+i;b.append(make('small',C.slotReference(i)),make('strong','未读取'));$('other-slot-grid').append(b);
  }
  b.onclick=()=>{selected=i;customSelected=false;stopRecord();render();if($('other-dialog').open)$('other-dialog').close();};cards[i]=b;
}
for(const m of C.MODS){
  const button=make('button',m.label);button.type='button';button.setAttribute('aria-pressed','false');button.onclick=()=>{draft.mod[selected]=(draft.mod[selected]||0)^m.v;if(draft.key[selected]===null)draft.key[selected]='0x00';render();};$('modifier-choices').append(button);mods.push(button);
}
const groups=new Map();
for(const key of C.KEYS){if(!groups.has(key.group)){const g=make('optgroup');g.label=key.group;groups.set(key.group,g);$('key-select').append(g);}const op=make('option',key.label);op.value=C.hex(key.n);groups.get(key.group).append(op);}
for(const [index,[label,mod,key]] of presets.entries()){const b=make('button',label);b.dataset.preset=label;b.onclick=()=>{draft.mod[selected]=mod;draft.key[selected]=C.hex(key);customSelected=false;render();};$('quick-actions').append(b);$('action-select').append(new Option(label,String(index)));}
$('action-select').append(new Option('自定义快捷键','custom'));
$('action-select').onchange=()=>{const value=$('action-select').value;customSelected=value==='custom';if(value==='original'){draft.mod[selected]=0;draft.key[selected]='0x00';}else if(!customSelected){const [,mod,key]=presets[Number(value)];draft.mod[selected]=mod;draft.key[selected]=C.hex(key);}render();};
$('key-select').onchange=()=>{if($('key-select').value){draft.key[selected]=$('key-select').value;if(draft.mod[selected]===null)draft.mod[selected]=0;render();}};
$('restore-button').onclick=()=>{stopRecord();customSelected=false;draft.mod[selected]=0;draft.key[selected]='0x00';render();notify('已重置此键，请保存修改。');};
$('undo-button').onclick=()=>{stopRecord();draft=C.clone(baseline);customSelected=false;render();notify('已撤销修改。');};
$('read-button').onclick=load;
async function diagnose(){
  if(busy||stopped)return;busy=true;stopRecord();render();
  try{const result=await api('/api/device/diagnose');if(!result.ok)readToken=null;notify(result.ok?'键盘配置接口已响应。点击“读取键盘”载入当前配置。':result.error,!result.ok);}
  catch(e){notify('检查未完成：'+e.message,true);}finally{busy=false;render();}
}
$('diagnose-button').onclick=diagnose;
$('repair-button').onclick=()=>{if(!busy&&!stopped&&connection?.canRepair)$('repair-dialog').showModal();};
$('cancel-repair').onclick=()=>$('repair-dialog').close();
$('confirm-repair').onclick=async()=>{
  if(busy||stopped)return;$('repair-dialog').close();busy=true;render();notify('请完成 Windows 管理员权限提示，正在等待临时修复启动…');
  try{const r=await api('/api/device/repair',{},130000);notify(r.message);await new Promise(resolve=>setTimeout(resolve,12000));busy=false;await diagnose();}
  catch(e){notify(e.message,true);}finally{busy=false;render();}
};
$('record-button').onclick=startRecord;
$('cancel-record').onclick=()=>{stopRecord();render();};
$('confirm-record').onclick=confirmRecord;
$('record-dialog').addEventListener('cancel',()=>{stopRecord();render();});
// The Windows helper owns capture and confirmation, including modifier-only chords.
for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(recording){e.preventDefault();e.stopImmediatePropagation();}},true);
window.addEventListener('blur',()=>{if(recording){stopRecord();render();notify('窗口已切换，录入已取消。');}});
window.addEventListener('pagehide',()=>{clearInterval(inputTimer);inputTimer=null;if(recordId)fetch('/api/input/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({client:inputClient,id:recordId}),keepalive:true}).catch(()=>{});});
window.addEventListener('pageshow',()=>{if(recording&&!inputTimer&&!stopped){inputTimer=setInterval(pollInput,50);pollInput();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording){stopRecord();render();}if(!document.hidden)pollInput();});
$('save-button').onclick=()=>saveLocal().catch(e=>notify(e.message,true));
$('write-button').onclick=async()=>{
  if($('write-button').disabled)return;if(changed().length&&!await saveLocal().catch(e=>{notify(e.message,true);return false;}))return;busy=true;stopRecord();render();
  try{
    if(!readToken){const read=await api('/api/device/read');deviceBaseline=C.validate(read.mapping,false);readToken=read.readToken;verification=read.verification;}
    const payload=C.clone(draft);for(const i of C.missing(payload)){payload.mod[i]=deviceBaseline.mod[i];payload.key[i]=deviceBaseline.key[i];}
    const r=await api('/api/device/prepare',{readToken,draft:payload});saveToken=r.token;
    if(!r.changes.length){notify('配置已与键盘一致。');return;}
    $('change-list').replaceChildren();
    for(const c of r.changes){const row=make('div',undefined,'change-row'),name=make('div'),values=make('div');name.append(make('strong',C.slotLabel(c.index)),make('small',C.slotReference(c.index),'change-reference'));values.append(make('span',c.before,'old'),make('span',' → '+c.after));row.append(name,values);$('change-list').append(row);}
    $('save-dialog').showModal();$('cancel-save').focus();
  }catch(e){notify('保存前检查未通过：'+e.message+' 本次没有写入键盘。',true);}
  finally{busy=false;render();}
};
$('cancel-save').onclick=()=>{$('save-dialog').close();saveToken=null;};
$('save-dialog').addEventListener('cancel',()=>saveToken=null);
$('confirm-save').onclick=async()=>{
  if(!saveToken||busy||stopped)return;const token=saveToken;saveToken=null;$('save-dialog').close();busy=true;render();
  try{const result=await api('/api/device/commit',{token});verification={...result};readToken=null;baseline=C.clone(draft);notify(result.message,result.state==='uncertain');}
  catch(e){readToken=null;verification={state:'uncertain'};notify(e.message+'\n请先重新读取键盘核对；本页不会自动重试。',true);}
  finally{busy=false;render();}
};
window.addEventListener('micro-window-hiding',()=>{stopRecord();render();});
async function refreshProfiles(reset=false){const response=await fetch('/api/ordinary/profiles'),incoming=await response.json();if(!response.ok)throw new Error(incoming.error);if(reset||!library||library.activeProfileId!==incoming.activeProfileId){baseline=C.clone(incoming.mapping);draft=C.clone(baseline);customSelected=false;}library=incoming;render();}
async function saveLocal(){if(busy||recording)return false;busy=true;render();try{const incoming=await api('/api/ordinary/profiles',{operation:'save',mapping:draft});library=incoming;baseline=C.clone(incoming.mapping);draft=C.clone(baseline);notify('配置已保存，写入键盘后生效。');return true;}finally{busy=false;render();}}
async function guardDrafts(){if(busy||recording||$('save-dialog').open)return false;if(!changed().length)return true;const answer=await ask({title:'还有未保存的修改',choices:[{value:'apply',label:'保存并切换',primary:true},{value:'discard',label:'放弃并切换'},{value:'cancel',label:'继续编辑'}]});if(answer.value==='apply')try{return await saveLocal();}catch(e){notify(e.message,true);return false;}if(answer.value==='discard'){draft=C.clone(baseline);render();return true;}return false;}
let resetProfiles=false;
manager=profileManager({root,endpoint:'/api/ordinary/profiles',title:'普通模式 · 配置管理',getData:()=>({...library,dirty:changed().length>0}),guard:guardDrafts,refresh:async()=>{await refreshProfiles(resetProfiles);resetProfiles=false;},changed:operation=>{resetProfiles=true;verification={state:'idle'};if(['switch','delete','restore'].includes(operation)){readToken=null;deviceBaseline=null;}},notify,setBusy:value=>{busy=value;render();}});
$('profile-select').onchange=async()=>{await manager.operation('switch',{id:$('profile-select').value});$('profile-select').value=library.activeProfileId;syncControls();};
render();
try{
  await refreshProfiles(true);
  const response=await fetch('/api/device/status',{cache:'no-store'}),value=await response.json();
  if(!response.ok||value.app!=='codex-micro-windows-panel')throw new Error('本地服务不匹配，请退出后重新启动程序。');
  simulation=Boolean(value.simulation);$('simulation-banner').hidden=!simulation;$('layout-simulation').hidden=!simulation;verification=value;
  const message=describeVerification(value);if(message&&value.state!=='verified')notify(message);
  render();
}catch(e){notify('服务未就绪：'+e.message,true);}
return {getState:()=>({busy:busy||recording||$('save-dialog').open,dirty:changed().length>0}),beforeLeave:guardDrafts,suspend:async()=>{stopRecord();manager.close();},resume:()=>render(),stop:()=>{stopped=true;stopRecord();}};
}
