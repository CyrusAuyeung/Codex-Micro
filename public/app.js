const $=id=>document.getElementById(id);
const modSymbols={left_win:'Win',right_win:'右 Win',left_control:'Ctrl',right_control:'右 Ctrl',left_alt:'Alt',right_alt:'右 Alt',left_shift:'Shift',right_shift:'右 Shift'};
const keyLabels={return_or_enter:'↩ 回车',escape:'Esc',spacebar:'空格',tab:'⇥ Tab',delete_or_backspace:'⌫ 退格',delete_forward:'⌦ 向前删除',up_arrow:'↑',down_arrow:'↓',left_arrow:'←',right_arrow:'→',home:'Home',end:'End',page_up:'Page Up',page_down:'Page Down',hyphen:'−',equal_sign:'=',open_bracket:'[',close_bracket:']',backslash:'\\',semicolon:';',quote:"'",grave_accent_and_tilde:'`',comma:',',period:'.',slash:'/',...modSymbols};
let data=null,selected='key1',drafts=new Map(),lastResult=null,busy=false,toastTimer=null,ownedLearnSession=null,stopped=false;
function keyLabel(k){if(modSymbols[k])return modSymbols[k];return ({caps_lock:'Caps Lock',print_screen:'Print Screen',scroll_lock:'Scroll Lock',pause:'Pause',insert:'Insert',num_lock:'Num Lock',numpad_add:'小键盘 +',numpad_subtract:'小键盘 −',numpad_multiply:'小键盘 *',numpad_divide:'小键盘 /',numpad_decimal:'小键盘 .'})[k]||keyLabels[k]||(/^numpad\d$/.test(k)?'小键盘 '+k.slice(-1):String(k).toUpperCase());}
function shortcut(to){
  if(!to)return '—';
  if(to.consumer_key_code)return {volume_increment:'音量 +',volume_decrement:'音量 −',mute:'静音',play_or_pause:'播放 / 暂停',scan_next_track:'下一曲',scan_previous_track:'上一曲'}[to.consumer_key_code]||to.consumer_key_code;
  if(to.key_code==='vk_none')return '不执行';
  return [...(to.modifiers||[]).map(m=>modSymbols[m]||m),modSymbols[to.key_code]||keyLabel(to.key_code)].join(' + ');
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
    drafts.set(selected,{action:saved?.action||'original',custom:saved?.custom?structuredClone(saved.custom):{key:'c',modifiers:['left_control']}});
  }
  return drafts.get(selected);
}
function sharedControls(){
  const source=data.bindings[selected]?.source;if(!source)return [];
  const signature=s=>`${s.type}:${s.code}:${[...s.modifiers].sort().join(',')}`;
  return Object.entries(data.bindings).filter(([,b])=>signature(b.source)===signature(source)).map(([id])=>id);
}
async function select(id){
  if(data.learning && data.learning.sessionId===ownedLearnSession && data.learning.controlId!==id){busy=true;try{await request('/api/cancel-learn',{sessionId:ownedLearnSession});await refresh();}catch(e){toast(e.message,true);}finally{busy=false;}}
  selected=id;renderEditor();renderBoard();
}
function selectAction(action){currentDraft().action=action;renderEditor();}
function initialize(){
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
    const option=document.createElement('option');option.value=action.id;option.textContent=action.label;groups.get(action.group).append(option);
  }
  for(const key of data.keys){const option=document.createElement('option');option.value=key;option.textContent=keyLabel(key);$('custom-key').append(option);}
  for(const id of ['copy','paste','shot_area','custom']){const button=document.createElement('button');button.textContent={copy:'复制',paste:'粘贴',shot_area:'截图',custom:'自定义'}[id];button.dataset.action=id;button.onclick=()=>selectAction(id);$('quick-actions').append(button);}
  $('action-select').onchange=()=>selectAction($('action-select').value);
  $('custom-key').onchange=()=>{currentDraft().custom.key=$('custom-key').value;renderEditor();};
  for(const button of document.querySelectorAll('[data-mod]'))button.onclick=()=>{
    const mods=currentDraft().custom.modifiers,index=mods.indexOf(button.dataset.mod);
    if(index===-1)mods.push(button.dataset.mod);else mods.splice(index,1);
    renderEditor();
  };
  $('learn-button').onclick=async()=>{
    busy=true;renderEditor();
    try{const result=await request('/api/learn',{controlId:selected});ownedLearnSession=result.learning?.sessionId;await refresh();}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('cancel-learn').onclick=async()=>{try{await request('/api/cancel-learn',{sessionId:data.learning?.sessionId});await refresh();}catch(e){toast(e.message,true);}};
  $('save-button').onclick=async()=>{
    busy=true;renderEditor();
    try{const ids=sharedControls();await request('/api/save',{controlId:selected,...currentDraft(),sharedControlIds:ids});for(const id of ids)drafts.delete(id);await refresh();toast(ids.length>1?`已应用。${ids.length} 个同信号按键的功能已一起更改。`:'已应用。这个按键现在使用新的 Windows 功能。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('restore-button').onclick=async()=>{
    busy=true;renderEditor();
    try{const ids=sharedControls();await request('/api/save',{controlId:selected,action:'original',sharedControlIds:ids});for(const id of ids)drafts.delete(id);await refresh();toast(data.status.mode==='vendor'?'已清除所选位置的功能。':ids.length>1?'已一起恢复这些位置原本的功能。':'已恢复这个位置原本的功能。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('share-button').onclick=async()=>{
    busy=true;renderEditor();
    try{await request('/api/share-source',{controlId:selected,sessionId:data.latestLearn.sessionId});drafts.delete(selected);await refresh();toast('已共用现有功能。之后修改时，这些按键会一起改变。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('mode-toggle').onclick=async()=>{
    busy=true;renderEditor();
    try{const enabled=!data.status.enabled;await request('/api/vendor-enabled',{enabled});await refresh();toast(enabled?'Windows 自定义已启用，未设置功能的位置暂不执行动作。':'已切回 Codex 默认控制，Windows 自定义配置已保留。');}
    catch(e){toast(e.message,true);}finally{busy=false;renderEditor();}
  };
  $('open-setup').onclick=()=>request('/api/open-setup').catch(e=>toast(e.message,true));
  $('confirm-device').onclick=async()=>{if(!confirm('将保存的配置关联到当前小键盘？确认后自定义功能保持关闭，可核对后再启用。'))return;try{await request('/api/confirm-device');await refresh();toast('已确认当前小键盘，请核对配置后启用。');}catch(e){toast(e.message,true);}};
  $('quit-button').onclick=async()=>{try{await request('/api/quit');stopped=true;$('connection-state').textContent='Micro Windows 已退出';$('connection-state').className='status wait';$('mode-banner').hidden=true;data.status.ready=false;data.status.canLearn=false;data.status.connected=false;renderEditor();clearInterval(refreshTimer);toast('已停止 Windows 自定义，设置已保留。');}catch(e){toast(e.message,true);}};
  window.addEventListener('pagehide',()=>{if(ownedLearnSession)fetch('/api/cancel-learn',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({sessionId:ownedLearnSession}),keepalive:true}).catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&ownedLearnSession)request('/api/cancel-learn',{sessionId:ownedLearnSession}).catch(()=>{});});
}
function renderBoard(){
  const control=data.controls.find(c=>c.id===selected);
  for(const c of data.controls.filter(c=>c.kind==='key')){
    const button=$('control-'+c.id),binding=data.bindings[c.id],action=data.actions.find(a=>a.id===binding?.action);
    const assigned=Boolean(binding&&binding.action!=='original');
    button.classList.toggle('selected',c.id===selected);button.setAttribute('aria-pressed',String(c.id===selected));
    button.querySelector('.key-function').textContent=assigned?action?.label||'自定义':binding?(data.status.mode==='vendor'?'未设置':'原功能'):'未配置';
    button.querySelector('.key-function').classList.toggle('empty',!assigned);button.querySelector('.key-assigned').hidden=!assigned;
    button.setAttribute('aria-label',`${c.label}，${assigned?action?.label:binding?(data.status.mode==='vendor'?'已识别，未设置功能':'已识别，保持原功能'):'未识别'}`);
  }
  for(const [id,kind] of [['dial-control','dial'],['stick-control','stick'],['touch-control','touch']]){$(id).classList.toggle('selected',control.kind===kind);$(id).setAttribute('aria-pressed',String(control.kind===kind));}
  $('configured-count').textContent=`${Object.values(data.bindings).filter(b=>b.action!=='original').length} 个动作已配置`;
  $('learned-count').textContent=`${data.controls.filter(c=>c.kind==='key'&&data.bindings[c.id]).length} / 13 个按键已识别`;
}
function renderEditor(){
  if(!data)return;
  const vendor=data.status.mode==='vendor';
  const control=data.controls.find(c=>c.id===selected),binding=data.bindings[selected],draft=currentDraft();
  $('selected-label').textContent=control.label;
  $('selected-location').textContent=control.kind==='key'?`第${['一','二','三','四'][control.row]}排 · 从左数第${['一','二','三','四'][control.col]}个位置`:({dial:'左上角 · 每个动作可分别设置',stick:'右上角 · 每个方向可分别设置',touch:'左下角 · 操作一次黑色触摸点'}[control.kind]);
  const choices=$('direction-choices');choices.hidden=!['dial','stick'].includes(control.kind);
  if(!choices.hidden){
    if(choices.dataset.kind!==control.kind){choices.replaceChildren();choices.dataset.kind=control.kind;for(const c of data.controls.filter(c=>c.kind===control.kind)){const button=document.createElement('button');button.textContent=c.label.split(' · ')[1];button.dataset.control=c.id;button.onclick=()=>select(c.id);choices.append(button);}}
    for(const button of choices.children){button.classList.toggle('active',button.dataset.control===selected);button.setAttribute('aria-pressed',String(button.dataset.control===selected));}
  }
  $('optional-note').hidden=!control.optional;
  $('source-check').textContent=binding?'已识别':'未识别';$('source-check').classList.toggle('known',Boolean(binding));
  $('source-value').textContent=binding?usageLabel(binding.source):'等待与实体按键对应';$('source-value').classList.toggle('muted',!binding);
  $('learn-button').disabled=!data.status.canLearn||busy||Boolean(data.learning);
  $('learn-button').firstChild.textContent=binding?'重新识别这个按键 ':'识别这个按键 ';
  const learningHere=data.learning?.controlId===selected;
  $('learn-progress').hidden=!learningHere;$('learn-button').hidden=learningHere;
  if(learningHere){$('learn-instruction').textContent=data.learning.diagnostics?.received?'已收到信号，请松开所有按键':control.kind==='dial'?'现在转动或按下实体旋钮':control.kind==='stick'?'现在操作实体摇杆':control.kind==='touch'?'现在触碰一次触摸点':'现在按下并松开实体按键';$('learn-countdown').textContent=`${Math.max(0,Math.ceil((data.learning.expires-Date.now())/1000))} 秒内操作 · 识别期间不会执行原动作`;}
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
  for(const button of document.querySelectorAll('[data-mod]'))button.setAttribute('aria-pressed',String(draft.custom.modifiers.includes(button.dataset.mod)));
  for(const button of document.querySelectorAll('[data-action]'))button.classList.toggle('active',button.dataset.action===draft.action);
  const action=data.actions.find(a=>a.id===draft.action),to=draft.action==='custom'?{key_code:draft.custom.key,modifiers:draft.custom.modifiers}:action?.to;
  $('result-label').textContent=vendor&&draft.action==='original'?'未设置功能':action?.label||'选择功能';$('shortcut-preview').textContent=shortcut(to);
  $('save-button').disabled=!data.status.ready||!binding||busy||Boolean(data.learning);
  $('save-button').firstChild.textContent=shared.length>1?`应用到 ${shared.length} 个同信号按键 `:vendor&&!data.status.enabled&&draft.action!=='original'?'应用并启用 Windows 自定义 ':'应用到这个按键 ';
  $('restore-button').disabled=!binding||binding.action==='original'||!data.status.ready||busy||Boolean(data.learning);
  $('restore-button').textContent=vendor?(shared.length>1?'一起清除这些位置的功能':'清除这个位置的功能'):shared.length>1?'一起恢复这些位置的原功能':'恢复这个位置的原功能';
  $('mode-toggle').disabled=busy||Boolean(data.learning)||!data.status.connected||(!data.status.enabled&&!data.status.ready);
}
async function refresh(){
  if(stopped)return;
  try{
    const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('服务暂不可用');
    const incoming=await response.json();if(stopped)return;if(incoming.app!=='codex-micro-windows-panel')throw new Error('本地服务不匹配');
    const first=!data;if(data&&data.status.mode!==incoming.status.mode){drafts.clear();lastResult=null;}data=incoming;if(first)initialize();
    const s=data.status;
    $('connection-state').textContent=s.ready?(s.mode==='vendor'?'Codex Micro · 蓝牙直连':'Codex Micro KB 已连接'):s.connected?'等待系统设置完成':'尚未连接小键盘';
    $('connection-state').className='status'+(s.ready?'':' wait');
    $('setup-banner').hidden=s.ready&&!s.error;
    $('setup-message').textContent=s.error||'请通过 Windows 蓝牙连接小键盘，并切到青灯 Codex 模式。此版本通过独立 HID 通道改键。';
    $('confirm-device').hidden=!s.mismatch;
    $('simulation-banner').hidden=!s.simulation;
    $('mode-banner').hidden=s.mode!=='vendor';
    $('mode-label').textContent=s.enabled?(s.captured?'Windows 自定义已启用':'Windows 自定义等待接管'):'当前使用 Codex 默认控制';
    $('mode-message').textContent=s.enabled?'已配置的键执行 Windows 功能，其余位置暂不执行。可随时关闭自定义，释放小键盘。':'先识别实体按键，再选择功能。启用后会独占小键盘的 HID 通道；若其它应用正在占用，面板会提示。';
    $('preserved-message').textContent='设置保存在这台电脑。关闭网页后服务继续运行；需要停止时使用页面底部或托盘的“退出”。';
    $('mode-toggle').textContent=s.enabled?'切回 Codex 默认控制':'启用 Windows 自定义';
    renderBoard();renderEditor();
    const result=data.latestLearn?.mode===data.status.mode?data.latestLearn:null;
    if(data.latestLearn?.sessionId===ownedLearnSession)ownedLearnSession=null;
    if(result&&result.sessionId!==lastResult){lastResult=result.sessionId;if(result.error)toast(result.error,result.error!=='已取消识别。');else if(result.source)toast(`已识别${data.controls.find(c=>c.id===result.controlId).label}。现在可以为它选择功能。`);}
  }catch(e){if(stopped)return;$('connection-state').textContent='本地面板服务未连接';$('connection-state').className='status error';if(data){data.status.ready=false;data.status.canLearn=false;data.status.connected=false;renderEditor();}}
}
await refresh();
const refreshTimer=setInterval(refresh,900);
