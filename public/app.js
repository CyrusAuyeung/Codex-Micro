import {ask,syncControls} from './components.js';
import {profileManager} from './profile-manager.js';
import {ShortcutRecorder,recordedShortcut} from './record.js';
export async function mount(root){
const $=id=>root.querySelector('#'+id)||document.getElementById(id);
const modSymbols={left_control:'Ctrl',left_shift:'Shift',left_alt:'Alt',left_win:'Win',right_control:'右 Ctrl',right_shift:'右 Shift',right_alt:'右 Alt',right_win:'右 Win'};
const keyLabels={return_or_enter:'↩ 回车',escape:'Esc',spacebar:'空格',tab:'⇥ Tab',delete_or_backspace:'⌫ 退格',delete_forward:'⌦ 向前删除',up_arrow:'↑',down_arrow:'↓',left_arrow:'←',right_arrow:'→',home:'Home',end:'End',page_up:'Page Up',page_down:'Page Down',hyphen:'−',equal_sign:'=',open_bracket:'[',close_bracket:']',backslash:'\\',semicolon:';',quote:"'",grave_accent_and_tilde:'`',comma:',',period:'.',slash:'/',...modSymbols};
let data=null,selected='key1',drafts=new Map(),lastResult=null,busy=false,toastTimer=null,ownedLearnSession=null,stopped=false,motionDraft=null,recording=false,active=true,manager,resetHighlight=()=>{},lastInput='';
const testClient=crypto.randomUUID();let ownTest=false,refreshSerial=0;
const recorder=new ShortcutRecorder(result=>{try{const draft=currentDraft();draft.action='custom';draft.custom=recordedShortcut(result);renderEditor();renderBoard();toast('组合键已录入。');}catch(e){toast(e.message,true);}},value=>{recording=value;renderEditor();});
function keyLabel(k){if(modSymbols[k])return modSymbols[k];return ({modifiers_only:'仅修饰键（不搭配主键）',caps_lock:'Caps Lock',print_screen:'Print Screen',scroll_lock:'Scroll Lock',pause:'Pause',insert:'Insert',num_lock:'Num Lock',numpad_add:'小键盘 +',numpad_subtract:'小键盘 −',numpad_multiply:'小键盘 *',numpad_divide:'小键盘 /',numpad_decimal:'小键盘 .'})[k]||keyLabels[k]||(/^numpad\d$/.test(k)?'小键盘 '+k.slice(-1):String(k).toUpperCase());}
function shortcut(to){
  if(!to)return '—';
  if(to.scroll)return (to.scroll.axis==='horizontal'?'横向':'纵向')+'滚动';
  if(to.consumer_key_code)return {volume_increment:'音量 +',volume_decrement:'音量 −',mute:'静音',play_or_pause:'播放 / 暂停',scan_next_track:'下一曲',scan_previous_track:'上一曲'}[to.consumer_key_code]||to.consumer_key_code;
  if(to.key_code==='vk_none')return '不执行';
  return [...(to.modifiers||[]).map(m=>modSymbols[m]||m),...(to.key_code==='modifiers_only'?[]:[modSymbols[to.key_code]||keyLabel(to.key_code)])].join(' + ');
}
function usageLabel(source){
  if(source.type==='vendor_key'){
    const numbered=/^(?:AG|ACT)(\d+)$/.exec(source.code);
    return numbered?`独立按键 ${Number(numbered[1])+1}`:({ENC:'旋钮按下',ENC_CW:'旋钮向右',ENC_CC:'旋钮向左',RAD_UP:'摇杆向上',RAD_DOWN:'摇杆向下',RAD_LEFT:'摇杆向左',RAD_RIGHT:'摇杆向右'})[source.code]||source.code;
  }
  if(source.type==='consumer_key_code')return {205:'播放 / 暂停',226:'静音',233:'音量 +',234:'音量 −',181:'下一曲',182:'上一曲'}[source.code]||`媒体键 ${source.code}`;
  const c=source.code;
  let value;
  if(c>=4&&c<=29)value=String.fromCharCode(c+61);
  else if(c>=30&&c<=38)value=String(c-29);
  else if(c===39)value='0';
  else if(c>=58&&c<=69)value=`F${c-57}`;
  else if(c>=104&&c<=115)value=`F${c-91}`;
  else if(c>=224)value=modSymbols[['left_control','left_shift','left_alt','left_win','right_control','right_shift','right_alt','right_win'][c-224]];
  else value={40:'↩',41:'Esc',42:'⌫',43:'Tab',44:'空格',45:'−',46:'=',47:'[',48:']',49:'\\',51:';',52:"'",53:'`',54:',',55:'.',56:'/',57:'Caps Lock',70:'截屏键',73:'Insert',74:'Home',75:'Page Up',76:'⌦',77:'End',78:'Page Down',79:'→',80:'←',81:'↓',82:'↑'}[c]||`按键 ${c}`;
  return [...source.modifiers.map(m=>modSymbols[m]||m),value].join(' + ');
}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?11000:4000);}
async function request(route,body={}){
  const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({mode:data?.status.mode,...body})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成。');return result;
}
function currentDraft(){
  if(!drafts.has(selected)){
    const saved=data.bindings[selected]||data.defaults?.[selected];
    drafts.set(selected,{action:saved?.action||'original',custom:saved?.custom?structuredClone(saved.custom):{key:'c',modifiers:['left_control']},step:saved?.step??1,behavior:saved?.behavior?structuredClone(saved.behavior):{repeat:false,once:false,delay:400,interval:100}});
  }
  return drafts.get(selected);
}
function sharedControls(){
  const source=data.bindings[selected]?.source;if(!source)return [];
  const signature=s=>`${s.type}:${s.code}:${[...s.modifiers].sort().join(',')}`;
  return Object.entries(data.bindings).filter(([,b])=>signature(b.source)===signature(source)).map(([id])=>id);
}
async function select(id){
  if(recording)recorder.stop();
  if(data.learning && data.learning.sessionId===ownedLearnSession && data.learning.controlId!==id){busy=true;try{await request('/api/cancel-learn',{sessionId:ownedLearnSession});await refresh();}catch(e){toast(e.message,true);}finally{busy=false;}}
  selected=id;renderEditor();renderBoard();
}
function selectAction(action){currentDraft().action=action;renderEditor();renderBoard();}
function actionLabel(action){return ({shot_area:'截图',desktop:'桌面'})[action?.id]||action?.label||'自定义';}
function initialize(){
  initializeNext();
  for(const control of data.controls.filter(c=>c.kind==='key')){
    const button=document.createElement('button');button.className='hardware';button.id='control-'+control.id;
    button.style.gridRow=String(control.row+1);button.style.gridColumn=String(control.col+1);
    button.setAttribute('aria-label',`选择${control.label}`);
    const number=document.createElement('span');number.className='key-number';number.textContent=control.short;
    const label=document.createElement('span');label.className='key-function empty';label.textContent='未配置';
    const dot=document.createElement('span');dot.className='key-assigned';dot.hidden=true;
    button.append(number,label,dot);button.addEventListener('click',()=>select(control.id));$('keyboard-grid').append(button);
  }
  $('dial-control').onclick=()=>select(data.controls.find(c=>c.kind==='dial'&&c.id===selected)?.id||'dial_ccw');
  $('stick-control').onclick=()=>select(data.controls.find(c=>c.kind==='stick'&&c.id===selected)?.id||'stick_up');
  $('touch-control').onclick=()=>select('touch');
  const groups=new Map();
  for(const action of data.actions){
    if(!groups.has(action.group)){const group=document.createElement('optgroup');group.label=action.group;$('action-select').append(group);groups.set(action.group,group);}
    const option=document.createElement('option');option.value=action.id;option.textContent=actionLabel(action);groups.get(action.group).append(option);
  }
  for(const key of data.keys){const option=document.createElement('option');option.value=key;option.textContent=keyLabel(key);$('custom-key').append(option);}
  for(const id of ['copy','paste','undo','shot_area','save','find','desktop','task_view']){const button=document.createElement('button');button.textContent={copy:'复制',paste:'粘贴',undo:'撤销',shot_area:'截图',save:'保存',find:'查找',desktop:'桌面',task_view:'任务视图'}[id];button.dataset.action=id;button.onclick=()=>selectAction(id);$('quick-actions').append(button);}
  $('action-select').onchange=()=>selectAction($('action-select').value);
  $('custom-key').onchange=()=>{currentDraft().custom.key=$('custom-key').value;renderEditor();renderBoard();};
  for(const button of root.querySelectorAll('[data-mod]'))button.onclick=()=>{
    const mods=currentDraft().custom.modifiers,index=mods.indexOf(button.dataset.mod);
    if(index===-1)mods.push(button.dataset.mod);else mods.splice(index,1);
    renderEditor();renderBoard();
  };
  $('learn-button').onclick=async()=>{
    busy=true;renderEditor();
    try{const result=await request('/api/learn',{controlId:selected});ownedLearnSession=result.learning?.sessionId;await refresh();}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('cancel-learn').onclick=async()=>{try{await request('/api/cancel-learn',{sessionId:data.learning?.sessionId});await refresh();}catch(e){toast(e.message,true);}};
  $('save-button').onclick=()=>applyAll().catch(e=>toast(e.message,true));
  $('undo-button').onclick=()=>{if(busy||recording||data.learning)return;drafts.clear();motionDraft=structuredClone(data.motion);renderEditor();renderBoard();toast('已撤销修改。');};
  $('restore-button').onclick=()=>{for(const id of sharedControls()){drafts.set(id,{...structuredClone(currentDraft()),action:'original',step:1,behavior:{repeat:false,once:false,delay:400,interval:100}});}renderEditor();renderBoard();toast('已重置此键，请保存修改。');};
  $('share-button').onclick=async()=>{
    busy=true;renderEditor();
    try{await request('/api/share-source',{controlId:selected,sessionId:data.latestLearn.sessionId});drafts.delete(selected);await refresh();toast('已共用现有功能。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('mode-toggle').onclick=async()=>{
    busy=true;renderEditor();
    try{const enabled=!data.status.enabled;await request('/api/vendor-enabled',{enabled});await refresh();toast(enabled?'Windows 自定义已启用。':'已切回 Codex 默认控制。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('open-setup').onclick=()=>request('/api/open-setup').catch(e=>toast(e.message,true));
  $('confirm-device').onclick=async()=>{if(!confirm('将保存的配置关联到当前小键盘？确认后自定义功能保持关闭，可核对后再启用。'))return;try{await request('/api/confirm-device');await refresh();toast('已确认当前小键盘，请核对配置后启用。');}catch(e){toast(e.message,true);}};
  window.addEventListener('pagehide',()=>{if(ownedLearnSession)fetch('/api/cancel-learn',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({sessionId:ownedLearnSession}),keepalive:true}).catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&ownedLearnSession)request('/api/cancel-learn',{sessionId:ownedLearnSession}).catch(()=>{});});
}
function renderBoard(){
  const control=data.controls.find(c=>c.id===selected);
  for(const c of data.controls.filter(c=>c.kind==='key')){
    const button=$('control-'+c.id),binding=isChanged(c.id)?{...data.bindings[c.id],...drafts.get(c.id)}:data.bindings[c.id],action=data.actions.find(a=>a.id===binding?.action);
    const assigned=Boolean(binding&&binding.action!=='original');
    button.classList.toggle('selected',c.id===selected);button.setAttribute('aria-pressed',String(c.id===selected));
    const label=assigned?(binding.action==='custom'?shortcut({key_code:binding.custom.key,modifiers:binding.custom.modifiers}):actionLabel(action)):binding?'未设置':'未配置';
    button.querySelector('.key-function').textContent=label;button.title=c.label+' · '+label;button.classList.toggle('draft',isChanged(c.id));
    button.querySelector('.key-function').classList.toggle('empty',!assigned);button.querySelector('.key-assigned').hidden=!assigned;
    button.setAttribute('aria-label',`${c.label}，${assigned?actionLabel(action):binding?(data.status.mode==='vendor'?'已识别，未设置功能':'已识别，保持原功能'):'未识别'}`);
  }
  for(const [id,kind] of [['dial-control','dial'],['stick-control','stick'],['touch-control','touch']]){$(id).classList.toggle('selected',control.kind===kind);$(id).setAttribute('aria-pressed',String(control.kind===kind));}
  $('configured-count').textContent=`${Object.values(data.bindings).filter(b=>b.action!=='original').length} 项已配置`;
  $('learned-count').textContent=`${data.controls.filter(c=>c.kind==='key'&&data.bindings[c.id]).length} / 13 个按键已识别`;
}
function renderEditor(){
  if(!data)return;
  const vendor=data.status.mode==='vendor';
  const control=data.controls.find(c=>c.id===selected),binding=data.bindings[selected],draft=currentDraft();
  $('selected-label').textContent=control.label;
  $('selected-location').textContent=control.kind==='key'?`第${['一','二','三','四'][control.row]}排 · 从左数第${['一','二','三','四'][control.col]}个位置`:({dial:'左上角',stick:'右上角',touch:'左下角'}[control.kind]);
  const choices=$('direction-choices');choices.hidden=!['dial','stick'].includes(control.kind);
  if(!choices.hidden){
    if(choices.dataset.kind!==control.kind){choices.replaceChildren();choices.dataset.kind=control.kind;for(const c of data.controls.filter(c=>c.kind===control.kind)){const button=document.createElement('button');button.textContent=c.label.split(' · ')[1];button.dataset.control=c.id;button.onclick=()=>select(c.id);choices.append(button);}}
    for(const button of choices.children){button.classList.toggle('active',button.dataset.control===selected);button.setAttribute('aria-pressed',String(button.dataset.control===selected));}
  }
  $('optional-note').hidden=!control.optional;
  $('source-check').textContent=binding?'已识别':'未识别';$('source-check').classList.toggle('known',Boolean(binding));
  $('source-value').textContent=binding?usageLabel(binding.source):'尚未识别';$('source-value').classList.toggle('muted',!binding);
  $('learn-button').disabled=!data.status.canLearn||busy||Boolean(data.learning);
  $('learn-button').firstChild.textContent=binding?'重新识别 ':'识别按键 ';
  const learningHere=data.learning?.controlId===selected;
  $('learn-progress').hidden=!learningHere;$('learn-button').hidden=learningHere;
  if(learningHere){$('learn-instruction').textContent=data.learning.diagnostics?.received?'请松开所有按键':control.kind==='dial'?'请转动或按下旋钮':control.kind==='stick'?'请操作摇杆':control.kind==='touch'?'请触碰一次触摸点':'请按下并松开按键';$('learn-countdown').textContent=`${Math.max(0,Math.ceil((data.learning.expires-Date.now())/1000))} 秒内操作`;}
  const result=data.latestLearn?.controlId===selected&&data.latestLearn.mode===data.status.mode?data.latestLearn:null;
  const conflict=Boolean(result?.conflicts?.length),failed=Boolean(result?.error&&!['已取消识别。','已切换识别目标。','识别已停止。','面板已关闭。'].includes(result.error));
  $('learn-feedback').hidden=Boolean(data.learning)||!failed;
  if(failed){
    $('feedback-title').textContent=conflict?'发现相同的按键信号':result.diagnostics?.received?'已收到信号，尚未完成识别':'暂时没有收到按键信号';
    $('feedback-message').textContent=result.error;
    $('feedback-signal').textContent=result.source?`本次收到：${usageLabel(result.source)}`:result.diagnostics?.received?`已收到 ${result.diagnostics.received} 次信号${result.diagnostics.held.length?'，未收到完整的松开信号':''}`:'';
  }
  $('share-button').hidden=!conflict;$('share-button').disabled=busy||!data.status.ready||Boolean(data.learning);
  if(conflict){const peer=data.bindings[result.conflicts[0]];$('share-button').textContent=`共用现有功能 · ${data.actions.find(a=>a.id===peer?.action)?.label||'原功能'}`;}
  const shared=sharedControls();
  $('shared-note').hidden=shared.length<2;
  if(shared.length>1)$('shared-note').textContent=`${shared.map(id=>data.controls.find(c=>c.id===id).label).join('、')} 共用同一个信号，功能会一起更改。`;
  $('action-select').value=draft.action;$('custom-controls').hidden=draft.action!=='custom';
  $('action-select').querySelector('option[value="original"]').textContent=vendor?'未设置功能':'保持原功能';
  $('custom-key').value=draft.custom.key;
  for(const button of root.querySelectorAll('[data-mod]'))button.setAttribute('aria-pressed',String(draft.custom.modifiers.includes(button.dataset.mod)));
  for(const button of root.querySelectorAll('[data-action]'))button.classList.toggle('active',button.dataset.action===draft.action);
  const action=data.actions.find(a=>a.id===draft.action),to=draft.action==='custom'?{key_code:draft.custom.key,modifiers:draft.custom.modifiers}:action?.to;
  $('result-label').textContent=vendor&&draft.action==='original'?'未设置功能':actionLabel(action);$('shortcut-preview').textContent=shortcut(to);
  $('save-button').disabled=!hasDrafts()||busy||recording||Boolean(data.learning);
  $('save-button').firstChild.textContent='保存修改';
  $('undo-button').disabled=$('save-button').disabled;
  $('restore-button').disabled=!binding||draft.action==='original'||busy||recording||Boolean(data.learning);
  $('restore-button').textContent='重置此键';
  $('restore-button').title=shared.length>1?'同时清除共用此信号的 '+shared.length+' 个位置的功能。':'清除当前功能。';
  $('mode-toggle').disabled=busy||Boolean(data.learning)||!data.status.connected||(!data.status.enabled&&!data.status.ready);
  renderNext(control,draft);renderSummary();document.dispatchEvent(new Event('micro-render'));
}
async function refresh(){
  if(stopped)return;
  const revision=++refreshSerial;
  try{
    const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('服务暂不可用');
    const incoming=await response.json();if(stopped||revision!==refreshSerial)return;if(incoming.app!=='codex-micro-windows-panel')throw new Error('本地服务不匹配');
    const first=!data;if(data&&(data.status.mode!==incoming.status.mode||data.activeProfileId!==incoming.activeProfileId)){drafts.clear();motionDraft=null;lastResult=null;}data=incoming;if(!motionDraft)motionDraft=structuredClone(data.motion);if(first)initialize();
    const s=data.status;
    $('connection-state').textContent=s.ready?(s.mode==='vendor'?'Codex Micro · 蓝牙直连':'Codex Micro KB 已连接'):s.connected?'等待系统设置完成':'尚未连接小键盘';
    $('connection-state').className='status'+(s.ready?'':' wait');
    $('setup-banner').hidden=false;
    $('setup-message').textContent=s.error||(s.ready?'键盘已连接。':'请切到青灯，并通过蓝牙连接 Codex Micro。');
    $('confirm-device').hidden=!s.mismatch;
    $('simulation-banner').hidden=!s.simulation;
    $('mode-banner').hidden=s.mode!=='vendor';
    $('mode-toggle').textContent=s.enabled?'切回 Codex 默认控制':'启用 Windows 自定义';
    renderBoard();renderEditor();
    const result=data.latestLearn?.mode===data.status.mode?data.latestLearn:null;
    if(data.latestLearn?.sessionId===ownedLearnSession)ownedLearnSession=null;
    if(result&&result.sessionId!==lastResult){lastResult=result.sessionId;if(result.error)toast(result.error,result.error!=='已取消识别。');else if(result.source)toast(`已识别${data.controls.find(c=>c.id===result.controlId).label}。`);}
  }catch(e){if(stopped)return;$('connection-state').textContent='本地面板服务未连接';$('connection-state').className='status error';if(data){data.status.ready=false;data.status.canLearn=false;data.status.connected=false;renderEditor();}}
}
await refresh();if(!data)throw new Error('Codex 配置暂时无法加载，请重试。');
const refreshTimer=setInterval(()=>{if(active&&!document.hidden&&!busy&&!recording)refresh();},900);
function compareBinding(value){return JSON.stringify({action:value?.action||'original',custom:value?.action==='custom'?{key:value.custom.key,modifiers:[...value.custom.modifiers].sort()}:null,step:value?.action?.startsWith('scroll_')?(value.step??1):1,behavior:value?.behavior||{repeat:false,once:false,delay:400,interval:100}});}
function isChanged(id){return drafts.has(id)&&compareBinding(drafts.get(id))!==compareBinding(data.bindings[id]);}
function hasDrafts(){return Boolean(data)&&([...drafts.keys()].some(isChanged)||JSON.stringify(motionDraft)!==JSON.stringify(data.motion));}
window.addEventListener('micro-window-hiding',()=>{if(ownedLearnSession)request('/api/cancel-learn',{sessionId:ownedLearnSession}).catch(()=>{});});

async function applyAll(){
  if(busy||recording)return false;busy=true;renderEditor();
  try{
    const bindings={};for(const [id,draft] of drafts){if(!isChanged(id))continue;const source=data.bindings[id]?.source;if(!source)throw new Error('请先识别 '+data.controls.find(c=>c.id===id).label+' 的实体动作。');for(const [peer,b] of Object.entries(data.bindings)){if(b.source.code===source.code){if(bindings[peer]&&compareBinding(bindings[peer])!==compareBinding(draft))throw new Error('同一信号的按键有不同草稿，请统一功能后应用。');bindings[peer]={...structuredClone(draft),source};}}}
    await request('/api/profiles/apply',{bindings,motion:motionDraft,enable:data.status.ready&&!data.status.enabled&&Object.values(bindings).some(b=>b.action!=='original')});drafts.clear();motionDraft=null;await refresh();toast('配置已保存。');return true;
  }finally{busy=false;renderEditor();}
}
async function guardDrafts(){
  if(busy||recording)return false;if(!hasDrafts())return true;
  const answer=await ask({title:'还有未保存的修改',choices:[{value:'apply',label:'保存并切换',primary:true},{value:'discard',label:'放弃并切换'},{value:'cancel',label:'继续编辑'}]});
  if(answer.value==='apply'){try{return await applyAll();}catch(e){toast(e.message,true);return false;}}
  if(answer.value==='discard'){drafts.clear();motionDraft=structuredClone(data.motion);return true;}return false;
}
async function endTest(){if(!ownTest)return;ownTest=false;await request('/api/test',{enabled:false,client:testClient});}
function initializeNext(){
  const legend=document.createElement('span');legend.innerHTML='<i class="legend-draft"></i>未保存';const pressedLegend=document.createElement('span');pressedLegend.innerHTML='<i class="legend-pressed"></i>正在输入';$('learned-count').before(legend,pressedLegend);
  const profile=document.createElement('div');profile.className='profile-controls';profile.innerHTML='<label for="profile-select" class="sr-only">当前配置</label><select id="profile-select"></select><button id="manage-profiles" class="button">管理配置</button>';root.querySelector('.profile-summary').append(profile);
  const test=document.createElement('button');test.id='test-toggle';test.className='button';test.textContent='仅测试';$('mode-toggle').before(test);
  const record=document.createElement('button');record.id='record-button';record.className='button';record.textContent='录入组合键';record.onclick=()=>recorder.start();$('custom-controls').before(record);
  for(const [id,label] of Object.entries(modSymbols).filter(([id])=>id.startsWith('right_'))){const button=document.createElement('button');button.type='button';button.dataset.mod=id;button.textContent=label;button.setAttribute('aria-pressed','false');root.querySelector('.modifier-buttons').append(button);}
  const motion=document.createElement('div');motion.id='motion-controls';motion.className='motion-controls';motion.innerHTML='<div id="scroll-options"><label class="field-label" for="scroll-step">滚动步长</label><input id="scroll-step" type="number" min="1" max="10" step="1"></div><div id="direction-options"><label class="check-line"><input id="direction-reverse" type="checkbox">反转方向（当前方案）</label><label class="check-line"><input id="repeat-action" type="checkbox">长拨连发</label><div class="number-row" id="repeat-options"><label>首次延迟（毫秒）<input id="repeat-delay" type="number" min="150" max="2000" step="50"></label><label>连发间隔（毫秒）<input id="repeat-interval" type="number" min="40" max="1000" step="10"></label></div><div id="stick-sensitivity" class="number-row"><label>触发阈值<input id="stick-engage" type="number" min="0.2" max="0.95" step="0.05"></label><label>回中阈值<input id="stick-release" type="number" min="0.05" max="0.9" step="0.05"></label></div><p id="motion-hint" class="field-help">触发阈值越低越灵敏，回中阈值应低于触发阈值。</p></div>';
  root.querySelector('.function-section').append(motion);
  $('scroll-step').oninput=()=>{currentDraft().step=Number($('scroll-step').value);renderDirty();};
  $('direction-reverse').onchange=()=>{motionDraft[selected.startsWith('dial_')?'dialReverse':'stickReverse']=$('direction-reverse').checked;renderDirty();};
  $('repeat-action').onchange=()=>{currentDraft().behavior.repeat=$('repeat-action').checked;currentDraft().behavior.once=true;renderEditor();};
  for(const [id,key] of [['repeat-delay','delay'],['repeat-interval','interval']])$(id).oninput=()=>{currentDraft().behavior[key]=Number($(id).value);renderDirty();};
  for(const [id,key] of [['stick-engage','engage'],['stick-release','release']])$(id).oninput=()=>{motionDraft[key]=Number($(id).value);renderDirty();};
  $('profile-select').onchange=async()=>{const id=$('profile-select').value;await manager.operation('switch',{id});$('profile-select').value=data.activeProfileId;syncControls();};
  $('test-toggle').onclick=async()=>{try{if(ownTest)await endTest();else{await request('/api/test',{enabled:true,client:testClient});ownTest=true;}await refresh();}catch(e){toast(e.message,true);}};
  manager=profileManager({root,endpoint:'/api/profiles',title:'Codex 模式 · 配置管理',getData:()=>({...data,dirty:hasDrafts()}),guard:guardDrafts,refresh,changed:()=>{drafts.clear();motionDraft=null;lastInput='';},notify:toast,setBusy:value=>{busy=value;renderEditor();},beforeChange:endTest});
  initializeHighlight();setInterval(()=>{if(ownTest&&!document.hidden)request('/api/test',{enabled:true,client:testClient}).catch(()=>{ownTest=false;});},2500);
  const stop=()=>{recorder.stop();if(ownTest){ownTest=false;fetch('/api/test',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({enabled:false,client:testClient}),keepalive:true}).catch(()=>{});}};
  window.addEventListener('pagehide',stop);window.addEventListener('micro-window-hiding',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
}
function renderDirty(){if(data){$('save-button').disabled=!hasDrafts()||busy||recording||!!data.learning;$('undo-button').disabled=$('save-button').disabled;renderBoard();renderSummary();}}
function renderSummary(){if(!data)return;const count=[...drafts.keys()].filter(isChanged).length+(JSON.stringify(motionDraft)!==JSON.stringify(data.motion)?1:0);$('save-state').textContent=count?count+' 项修改未保存':'配置已保存';$('save-detail').textContent=count?'保存后生效。':lastInput||(data.status.testing?'仅测试 · 不执行功能':data.status.enabled?(data.status.captured?'Windows 自定义已启用':'等待键盘连接'):'启用 Windows 自定义后生效。');$('save-detail').title=$('save-detail').textContent;}
function renderNext(control,draft){
  const signature=JSON.stringify(data.profiles);if($('profile-select').dataset.signature!==signature){$('profile-select').replaceChildren(...data.profiles.map(p=>new Option(p.name,p.id)));$('profile-select').dataset.signature=signature;}$('profile-select').value=data.activeProfileId;$('profile-select').disabled=busy||recording||!!data.learning;
  $('test-toggle').textContent=data.status.testing?'结束测试':'仅测试';$('test-toggle').setAttribute('aria-pressed',String(data.status.testing));$('test-toggle').disabled=busy||recording||!!data.learning||!data.status.ready;
  if(!data.status.testing)ownTest=false;
  $('record-button').disabled=busy||!!data.learning;$('scroll-options').hidden=!draft.action.startsWith('scroll_');
  const value=(id,v)=>{if(document.activeElement!==$(id))$(id).value=v;};value('scroll-step',draft.step);$('direction-options').hidden=!['dial','stick'].includes(control.kind);$('direction-reverse').checked=control.kind==='dial'?motionDraft.dialReverse:motionDraft.stickReverse;
  $('repeat-action').closest('label').hidden=control.kind!=='stick'||control.id==='stick_press';$('repeat-action').checked=draft.behavior.repeat;$('repeat-options').hidden=control.kind!=='stick'||!draft.behavior.repeat;
  value('repeat-delay',draft.behavior.delay);value('repeat-interval',draft.behavior.interval);$('stick-sensitivity').hidden=control.kind!=='stick';$('motion-hint').hidden=control.kind!=='stick';value('stick-engage',motionDraft.engage);value('stick-release',motionDraft.release);
  $('manage-profiles').disabled=busy||recording;$('mode-toggle').disabled ||=recording;
  for(const field of root.querySelectorAll('#action-select,#custom-key,#quick-actions button,[data-mod],#direction-choices button,#motion-controls input'))field.disabled=busy||recording||!!data.learning;
}
function initializeHighlight(){
  const stream=new EventSource('/api/events'),pressed=new Map();
  const targets=ids=>ids.map(id=>id.startsWith('key')?$('control-'+id):id.startsWith('dial_')?$('dial-control'):id.startsWith('stick_')?$('stick-control'):$('touch-control'));
  const reset=()=>{for(const timer of pressed.values())clearTimeout(timer);pressed.clear();root.querySelectorAll('.pressed,.input-active').forEach(e=>e.classList.remove('pressed','input-active'));lastInput='';renderSummary();};resetHighlight=reset;
  stream.addEventListener('reset',reset);stream.onerror=reset;
  stream.addEventListener('input',event=>{if(!active)return;const value=JSON.parse(event.data),ids=value.controlIds||[];if(!ids.length){const known={ENC_CW:'dial_cw',ENC_CC:'dial_ccw',RAD_UP:'stick_up',RAD_DOWN:'stick_down',RAD_LEFT:'stick_left',RAD_RIGHT:'stick_right'}[value.code];if(known)ids.push(known);}
    for(const element of targets(ids).filter(Boolean)){clearTimeout(pressed.get(element));if(value.down){element.classList.add('pressed');pressed.set(element,null);}else pressed.set(element,setTimeout(()=>element.classList.remove('pressed'),120));}
    for(const button of root.querySelectorAll('[data-control]')){if(ids.includes(button.dataset.control))button.classList.toggle('input-active',value.down);}
    if(value.down){lastInput=(value.testing?'仅测试 · ':'收到 · ')+(ids.length?ids.map(id=>data.controls.find(c=>c.id===id)?.label||id).join(' / '):usageLabel({type:'vendor_key',code:value.code,modifiers:[]}));renderSummary();}
  });window.addEventListener('pagehide',()=>{reset();stream.close();});
}
return {getState:()=>({busy:busy||recording||!!data?.learning,dirty:hasDrafts()}),beforeLeave:guardDrafts,suspend:async()=>{active=false;recorder.stop();manager?.close();resetHighlight();await endTest();if(ownedLearnSession)await request('/api/cancel-learn',{sessionId:ownedLearnSession});},resume:()=>{active=true;renderBoard();renderEditor();refresh();},stop:()=>{stopped=true;clearInterval(refreshTimer);}};
}
