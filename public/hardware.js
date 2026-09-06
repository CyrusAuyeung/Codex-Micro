import './mapping-core.js';
const C=globalThis.MicroMapping,$=id=>document.getElementById(id);
const empty=()=>({mod:Array(16).fill(null),key:Array(16).fill(null)});
let baseline=empty(),draft=empty(),readToken=null,busy=false,stopped=false,recording=false,recordTimer=null,selected=1,saveToken=null,verification={state:'idle'},simulation=false;
let connection=null;
const cards=[],mods=[];
const inputClient=crypto.randomUUID();
let inputPolling=false,inputTimer=null,recordId=null,recordSlot=null,recordReady=false,recordConfirming=false,recordCandidate=null;
const presets=[['复制',1,6],['粘贴',1,25],['撤销',1,29],['截图',10,22],['保存',1,22],['查找',1,9],['桌面',8,7],['任务视图',8,43]];
function notify(text,error=false){$('notice').textContent=text;$('notice').hidden=false;$('notice').classList.toggle('error',error);}
function make(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function changed(){return C.changed(baseline,draft);}
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
  const text=C.parts(draft,selected).join(' + ');stopRecord();$('record-hint').textContent='已录入：'+text+'。尚未写入键盘。';render();
}
function recordPrompt(){return '拦截已就绪。可单独录入修饰键，也可录入组合键；支持反复试按。录入期间 Alt + A 等快捷键不会交给截图等软件。';}
function showRecordState(session){
  if(!recording||!recordReady)return;
  recordCandidate=session.candidate||null;
  const progress=session.progress,holding=progress?.holding===true;
  let value='',status=recordPrompt();
  if(holding){
    const {mod,key}=progress;
    value=mod||key!==null?C.parts({mod:[mod],key:[key===null?0:key]},0).join(' + '):'';
    if(key===0)value=(mod?value+' + ':'')+'未识别按键';
    status=key===0?'此按键不能作为普通主键录入，请松开后重新试按。':key===null?(mod?'可继续补按其他键；松开部分修饰键时，仍保留完整组合。':'请松开其余按键，再查看这一轮组合。'):'松开部分按键仍显示完整组合；保持修饰键、按下新主键即可替换。全部松开后可确认。';
  }else if(recordCandidate){
    value=recordCandidate.error?'未识别按键':C.parts({mod:[recordCandidate.mod],key:[recordCandidate.key]},0).join(' + ');
    status=recordCandidate.error||'已保留这一轮组合。可继续试按覆盖，或点击“使用此组合”。';
  }
  if($('record-target').value!==value)$('record-target').value=value;
  $('record-preview-label').textContent=holding?'本轮组合':recordCandidate?'待使用的组合':'实时预览';
  $('confirm-record').disabled=recordConfirming||holding||!recordCandidate||Boolean(recordCandidate.error);
  if(recordConfirming)status='正在确认组合键并结束拦截…';
  if($('record-status').textContent!==status)$('record-status').textContent=status;
}
async function confirmRecord(){
  if(!recording||!recordReady||recordConfirming||$('confirm-record').disabled)return;
  const id=recordId,revision=recordCandidate.revision;recordConfirming=true;$('confirm-record').disabled=true;$('record-status').textContent='正在确认组合键并结束拦截…';
  try{const result=await api('/api/input/confirm',{client:inputClient,id,revision},6000);if(recordId===id)finishRecord(result);}
  catch(e){if(recordId===id){recordConfirming=false;$('record-status').textContent=e.message;pollInput();}}
}
async function startRecord(){
  if(busy||stopped)return;if(recording){stopRecord();render();return;}
  recording=true;recordSlot=selected;recordId=crypto.randomUUID();const id=recordId;
  $('record-target').value='';$('record-target').placeholder='正在准备…';$('record-preview-label').textContent='实时预览';$('confirm-record').disabled=true;$('record-status').textContent='正在准备 Windows 快捷键拦截，请稍候再按键。';
  $('record-dialog').showModal();$('record-target').focus();render();
  inputTimer=setInterval(pollInput,50);pollInput();
  recordTimer=setTimeout(()=>{stopRecord();render();$('record-hint').textContent='录入已超时，未应用试按结果。请重新点击录入。';},60000);
  try{const result=await api('/api/input/record',{client:inputClient,id});if(!recording||recordId!==id){await api('/api/input/cancel',{client:inputClient,id});return;}
    if(!result.guarded||!result.confirmRequired)throw new Error('录入组件版本不匹配，请退出程序后重新启动新版。');
    recordReady=true;$('record-target').placeholder='按键会实时显示在这里…';$('record-status').textContent=recordPrompt();pollInput();
  }catch(e){if(recordId===id){stopRecord();render();$('record-hint').textContent=e.message+' 可取消后重试，或手动选择。';}}
}
async function pollInput(){
  if(inputPolling||!recording||stopped||document.hidden)return;inputPolling=true;const id=recordId;
  try{
    const inputState=await api('/api/input/state',{client:inputClient},5000);
    const result=inputState.recording?.result;
    if(recording&&result?.id===recordId){if(result.error){stopRecord();render();$('record-hint').textContent=result.error;}else if(recordConfirming)finishRecord(result);}
    else if(recordId===id&&recordReady){
      if(inputState.recording?.id===id)showRecordState(inputState.recording);
      else{stopRecord();render();$('record-hint').textContent='录入已结束，未应用试按结果。请重新点击录入。';}
    }
  }catch(e){if(recordId===id){stopRecord();render();$('record-hint').textContent='录入连接中断：'+e.message;}}finally{inputPolling=false;}
}
function describeVerification(v){
  if(v.state==='verified')return readToken?'已重新读取并核对一致。请切回蓝灯普通键盘模式使用；网页和托盘程序都可以关闭。':'上次写入已核对。要查看键盘现在的配置，请重新读取。';
  if(v.state==='not-applied')return '重新读取的配置与写入前相同，上次修改没有在本次读取中体现。请核对后再决定是否重新保存。';
  if(v.state==='different')return '重新读取后，'+v.differences.map(i=>C.slotLabel(i)+'（#'+i+'）').join('、')+' 与预期不同。已显示设备当前配置，请检查。';
  if(['sending','awaiting-verification','uncertain'].includes(v.state))return '上次写入还需要核对。请重新进入 Config 热点，再点击“读取键盘”。';
  return '';
}
function render(){
  const changes=changed(),missing=C.missing(draft),locked=busy||stopped;
  for(let i=0;i<16;i++){
    cards[i].querySelector('strong').textContent=C.parts(draft,i).join(' + ');
    cards[i].setAttribute('aria-label',C.slotLabel(i)+'，'+C.LAYOUT[i].location+'，'+C.parts(draft,i).join(' + '));
    cards[i].title=C.slotLabel(i)+' · '+C.slotReference(i)+'\n'+C.parts(draft,i).join(' + ');
    cards[i].setAttribute('aria-pressed',String(i===selected));cards[i].classList.toggle('selected',i===selected);cards[i].classList.toggle('modified',changes.includes(i));cards[i].classList.toggle('unread',missing.includes(i));cards[i].disabled=locked;
  }
  $('selected-label').textContent=C.slotLabel(selected);
  $('selected-location').textContent=C.LAYOUT[selected].location;
  $('selected-reference').textContent='原厂编号 '+C.slotReference(selected);
  const otherChanges=changes.filter(i=>C.LAYOUT[i].kind==='other').length;
  $('other-slot-state').textContent=otherChanges?otherChanges+' 项修改':'2 项';
  $('other-slots').classList.toggle('has-changes',otherChanges>0);
  $('shortcut-preview').textContent=C.parts(draft,selected).join(' + ');
  const value=C.keyNumber(draft.key[selected]),select=$('key-select');
  select.querySelectorAll('[data-dynamic]').forEach(e=>e.remove());
  if(value===null||!C.KEYS.some(k=>k.n===value)){const op=make('option',C.keyLabel(draft.key[selected]));op.dataset.dynamic='1';op.value=value===null?'':C.hex(value);select.prepend(op);}
  select.value=value===null?'':C.hex(value);select.disabled=locked||recording;
  $('raw-value').textContent=value===null?'尚未读取':C.hex(value);
  mods.forEach((m,i)=>{m.checked=Boolean((draft.mod[selected]||0)&C.MODS[i].v);m.disabled=locked||recording;});
  $('right-modifiers').hidden=!((draft.mod[selected]||0)&240);$('right-modifiers').textContent='此键包含右侧修饰键。上方修改会保留它们；录入组合键或选择预设会替换整个组合。';
  document.querySelectorAll('[data-preset]').forEach(e=>e.disabled=locked||recording);
  $('record-button').disabled=locked;$('record-button').textContent=recording?'等待组合键 · 点击取消':'录入组合键';
  $('restore-button').disabled=locked||!changes.includes(selected);$('undo-button').disabled=locked||!changes.length;
  $('read-button').disabled=locked;$('read-button').textContent=busy?'处理中…':'读取键盘 ↻';
  $('diagnose-button').disabled=locked;$('repair-button').disabled=locked;
  $('import-button').disabled=locked||recording;$('export-button').disabled=locked;$('export-button').textContent=missing.length?'导出草稿':'导出配置';
  $('save-button').disabled=locked||recording||!readToken||missing.length>0||!changes.length;
  $('change-count').textContent=changes.length+' 项修改';
  if(stopped){$('connection-state').textContent='Micro Windows 已退出';$('save-state').textContent='本地服务已停止';$('save-detail').textContent='已经保存在键盘里的快捷键仍由键盘执行。';return;}
  $('connection-state').className='status'+(readToken?'':' wait');$('connection-state').textContent=busy?'正在与键盘通信':readToken?'已读取设备配置':connection?.summary||'尚未读取键盘';
  $('save-state').textContent=verification.state==='verified'&&!changes.length?(readToken?'已核对设备配置':'上次写入已核对'):changes.length?changes.length+' 项修改尚未写入':'尚未写入新修改';
  $('save-detail').textContent=changes.length?'本页修改尚未写入。点击预览查看差异，再确认写入键盘。':describeVerification(verification)||'读取 → 编辑 → 预览修改 → 写入 → 重新读取核对';
  if(verification.backup)$('save-detail').textContent+=' 上次写入前备份已保存在本机。';
}
function showNetwork(value){
  if(!value)return;connection=value;
  $('network-title').textContent=value.reachable?'键盘配置接口可用':value.summary;
  $('network-detail').textContent=value.detail;
  $('network-time').textContent='检查时间：'+new Date(value.checkedAt).toLocaleTimeString()+' · 结果保存在本机';
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
  if(changed().length&&!window.confirm('读取会替换本页未保存的修改。需要保留时，请先导出。现在读取键盘吗？'))return;
  busy=true;stopRecord();render();
  try{
    const r=await api('/api/device/read');baseline=C.validate(r.mapping,false);draft=C.clone(baseline);readToken=r.readToken;verification=r.verification;
    $('read-label').textContent='已读取键盘的 16 个配置位';$('read-detail').textContent='读取时间：'+new Date(r.readAt).toLocaleString();
    notify(describeVerification(verification)||'读取完成。点选图中的实体键位，即可设置 Windows 快捷键。',verification.state==='different'||verification.state==='not-applied');
  }catch(e){readToken=null;notify('读取失败：'+e.message,true);}
  finally{busy=false;render();}
}
for(const slot of C.LAYOUT){
  const i=slot.index,b=slot.kind==='dial'?$('mapping-dial'):make('button',undefined,slot.kind==='key'?'hardware':'mapping-key');
  b.type='button';b.dataset.slot=String(i);
  if(slot.kind==='key'){
    b.id='mapping-'+slot.id;b.style.gridRow=String(slot.row+1);b.style.gridColumn=String(slot.col+1);
    b.append(make('span',slot.short,'key-number'),make('strong','未读取','key-function'));$('mapping-grid').append(b);
  }else if(slot.kind==='other'){
    b.id='mapping-slot-'+i;b.append(make('small',C.slotReference(i)),make('strong','未读取'));$('other-slot-grid').append(b);
  }
  b.onclick=()=>{selected=i;stopRecord();render();};cards[i]=b;
}
for(const m of C.MODS){
  const label=make('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',m.label);input.onchange=()=>{draft.mod[selected]=input.checked?(draft.mod[selected]||0)|m.v:(draft.mod[selected]||0)&~m.v;render();};
  label.append(input,make('span',m.label));$('modifier-choices').append(label);mods.push(input);
}
const groups=new Map();
for(const key of C.KEYS){if(!groups.has(key.group)){const g=make('optgroup');g.label=key.group;groups.set(key.group,g);$('key-select').append(g);}const op=make('option',key.label);op.value=C.hex(key.n);groups.get(key.group).append(op);}
for(const [label,mod,key] of presets){const b=make('button',label);b.dataset.preset=label;b.onclick=()=>{draft.mod[selected]=mod;draft.key[selected]=C.hex(key);render();};$('quick-actions').append(b);}
$('key-select').onchange=()=>{if($('key-select').value){draft.key[selected]=$('key-select').value;if(draft.mod[selected]===null)draft.mod[selected]=0;render();}};
$('restore-button').onclick=()=>{stopRecord();draft.mod[selected]=baseline.mod[selected];draft.key[selected]=baseline.key[selected];render();};
$('undo-button').onclick=()=>{stopRecord();draft=C.clone(baseline);render();notify('已撤销本页修改，没有写入键盘。');};
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
window.addEventListener('blur',()=>{if(recording){stopRecord();render();$('record-hint').textContent='页面失去焦点，已取消录入。请重新点击录入并保持此页面在前台。';}});
window.addEventListener('pagehide',()=>{clearInterval(inputTimer);inputTimer=null;if(recordId)fetch('/api/input/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({client:inputClient,id:recordId}),keepalive:true}).catch(()=>{});});
window.addEventListener('pageshow',()=>{if(recording&&!inputTimer&&!stopped){inputTimer=setInterval(pollInput,50);pollInput();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording){stopRecord();render();}if(!document.hidden)pollInput();});
window.addEventListener('beforeunload',e=>{if(!stopped&&(busy||changed().length)){e.preventDefault();e.returnValue='';}});
$('import-button').onclick=()=>$('import-file').click();
$('import-file').onchange=async()=>{const file=$('import-file').files[0];if(!file)return;try{if(file.size>65536)throw new Error('配置文件过大，请选择小于 64 KB 的 JSON。');const value=C.parseImport(await file.text());for(let i=0;i<16;i++)if(value.mapping.mod[i]!==null&&C.keyNumber(value.mapping.key[i])!==null){draft.mod[i]=value.mapping.mod[i];draft.key[i]=value.mapping.key[i];}notify('已导入到本页，尚未写入键盘。'+(value.draft?'未读取的位置保留当前值。':''));render();}catch(e){notify(e.message,true);}finally{$('import-file').value='';}};
let exportName='';
$('export-button').onclick=()=>{stopRecord();render();const value=C.exportValue(draft),incomplete=value.format==='codex-micro-ui-draft';$('export-title').textContent=incomplete?'导出草稿':'导出配置';$('export-hint').textContent=incomplete?'未读取的位置保留为空；导入时不会覆盖目标配置中的这些位置。':'导出的是本页配置。导出不会向键盘写入。';$('export-json').value=JSON.stringify(value,null,2);$('export-status').textContent='可下载文件，也可以复制 JSON 保存。';exportName='codex-micro-'+(incomplete?'draft-':'mapping-')+new Date().toISOString().replace(/[:.]/g,'-')+'.json';$('export-dialog').showModal();};
$('close-export').onclick=()=>$('export-dialog').close();
$('copy-export').onclick=async()=>{try{await navigator.clipboard.writeText($('export-json').value);$('export-status').textContent='已复制。';}catch{const area=$('export-json');area.focus();area.select();$('export-status').textContent=document.execCommand('copy')?'已复制。':'请手动复制选中的内容。';}};
$('download-export').onclick=()=>{const url=URL.createObjectURL(new Blob([$('export-json').value],{type:'application/json'})),a=make('a');a.href=url;a.download=exportName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('export-status').textContent='已请求浏览器下载；如果没有收到文件，可使用复制 JSON。';};
$('save-button').onclick=async()=>{
  if($('save-button').disabled)return;busy=true;stopRecord();render();
  try{
    const r=await api('/api/device/prepare',{readToken,draft});saveToken=r.token;
    if(!r.changes.length){notify('键盘已包含这些修改。请重新读取以更新本页，没有重复写入。');return;}
    $('change-list').replaceChildren();
    for(const c of r.changes){const row=make('div',undefined,'change-row'),name=make('div'),values=make('div');name.append(make('strong',C.slotLabel(c.index)),make('small',C.slotReference(c.index),'change-reference'));values.append(make('span',c.before,'old'),make('span',' → '+c.after));row.append(name,values);$('change-list').append(row);}
    if(simulation)$('change-list').prepend(make('p','模拟测试：本次只写入模拟设备。','field-help'));
    $('save-dialog').showModal();$('cancel-save').focus();
  }catch(e){notify('保存前检查未通过：'+e.message+' 本次没有写入键盘。',true);}
  finally{busy=false;render();}
};
$('cancel-save').onclick=()=>{$('save-dialog').close();saveToken=null;};
$('save-dialog').addEventListener('cancel',()=>saveToken=null);
$('confirm-save').onclick=async()=>{
  if(!saveToken||busy||stopped)return;const token=saveToken;saveToken=null;$('save-dialog').close();busy=true;render();
  try{const result=await api('/api/device/commit',{token});verification={...result};readToken=null;baseline=C.clone(draft);notify(result.message,result.state==='uncertain');$('read-label').textContent='等待重新读取核对';$('read-detail').textContent='重新进入 Config 配置热点后，点击“读取键盘”。';}
  catch(e){readToken=null;verification={state:'uncertain'};notify(e.message+'\n请先重新读取键盘核对；本页不会自动重试。',true);}
  finally{busy=false;render();}
};
$('quit-button').onclick=async()=>{
  if(busy||stopped)return;
  if(changed().length&&!window.confirm('本页有尚未写入的修改。退出会丢失草稿，是否继续？'))return;
  try{await api('/api/quit');stopped=true;stopRecord();$('quit-button').disabled=true;notify('Micro Windows 已退出。已保存到键盘的配置可以继续使用。');render();}catch(e){notify(e.message,true);}
};
render();
try{
  const response=await fetch('/api/device/status',{cache:'no-store'}),value=await response.json();
  if(!response.ok||value.app!=='codex-micro-windows-panel')throw new Error('本地服务版本不匹配，请退出旧程序并重新启动 1.1.6 版。');
  simulation=Boolean(value.simulation);$('simulation-banner').hidden=!simulation;$('layout-simulation').hidden=!simulation;verification=value;
  const message=describeVerification(value);if(message)notify(message);
  if(value.localRemappingEnabled)notify((message?message+'\n':'')+'原来的 Codex 本机映射仍已启用，可在“Codex 模式”页面单独关闭。');
  render();
}catch(e){notify('服务未就绪：'+e.message,true);}
