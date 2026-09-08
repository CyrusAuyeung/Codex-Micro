import './mapping-core.js';
import {api,message} from './components.js';
const C=globalThis.MicroMapping;
export class ShortcutRecorder {
  constructor(onResult,onState=()=>{}){
    this.onResult=onResult;this.onState=onState;this.client=crypto.randomUUID();this.id=null;this.polling=false;
    this.dialog=document.createElement('dialog');this.dialog.className='record-dialog';this.dialog.setAttribute('aria-labelledby','codex-record-title');
    this.dialog.innerHTML='<h2 id="codex-record-title">录入组合键</h2><label for="codex-record-target" class="field-label">实时预览</label><input id="codex-record-target" aria-label="组合键录入框" readonly placeholder="等待按键…"><p role="status"></p><div class="dialog-actions"><button class="button cancel-record">取消录入</button><button class="button primary confirm-record" disabled>使用此组合</button></div>';
    document.body.append(this.dialog);this.input=this.dialog.querySelector('input');this.hint=this.dialog.querySelector('[role=status]');this.confirm=this.dialog.querySelector('.confirm-record');
    this.dialog.querySelector('.cancel-record').onclick=()=>this.stop();this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.stop();});this.confirm.onclick=()=>this.use();
    for(const event of ['pagehide','micro-window-hiding','blur'])window.addEventListener(event,()=>this.stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
  }
  async start(){
    if(this.id)return;this.id=crypto.randomUUID();const id=this.id;this.ready=false;this.candidate=null;this.confirm.disabled=true;this.input.value='';this.hint.textContent='正在准备，请稍候…';this.dialog.showModal();this.input.focus();this.onState(true);
    this.timer=setInterval(()=>this.poll(),60);this.timeout=setTimeout(()=>{this.stop();message('录入已超时，试按结果未应用。');},60000);
    try{const result=await api('/api/input/record',{client:this.client,id});if(this.id!==id){api('/api/input/cancel',{client:this.client,id}).catch(()=>{});return;}if(!result.guarded||!result.confirmRequired)throw new Error('录入组件版本不匹配，请重新启动新版。');this.ready=true;this.hint.textContent='请按下组合键。';}catch(e){if(this.id===id){this.stop();message(e.message,true);}}
  }
  async poll(){
    if(this.polling||!this.id)return;this.polling=true;const id=this.id;
    try{const state=await api('/api/input/state',{client:this.client});if(this.id!==id||!this.ready)return;const session=state.recording;if(!session||session.id!==id)throw new Error('录入已结束，请重新试按。');if(session.result?.error)throw new Error(session.result.error);
      if(session.result&&this.confirming)return;
      this.candidate=session.candidate;const progress=session.progress,holding=progress?.holding===true,value=holding?progress:this.candidate;
      this.input.value=value&&!value.error?C.parts({mod:[value.mod],key:[value.key??0]},0).join(' + '):value?.error?'未识别按键':'';
      this.confirm.disabled=this.confirming||holding||!this.candidate||!!this.candidate.error;
    this.hint.textContent=this.confirming?'正在确认组合键…':holding?'请松开全部按键后确认。':this.candidate?.error|| (this.candidate?'可继续试按，或点击“使用此组合”。':'请按下组合键。');
    }catch(e){if(this.id===id){this.stop();message(e.message,true);}}finally{this.polling=false;}
  }
  async use(){if(this.confirm.disabled||!this.id)return;const id=this.id;this.confirming=true;this.confirm.disabled=true;try{const result=await api('/api/input/confirm',{client:this.client,id,revision:this.candidate.revision});if(this.id===id)this.finish(result);}catch(e){if(this.id===id){this.confirming=false;this.hint.textContent=e.message;}}}
  finish(result){this.stop();this.onResult(result);}
  stop(){if(!this.id)return;const id=this.id;this.id=null;this.confirming=false;this.ready=false;clearInterval(this.timer);clearTimeout(this.timeout);this.dialog.close();this.onState(false);fetch('/api/input/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify({client:this.client,id}),keepalive:true}).catch(()=>{});}
}
// Native recorder uses USB HID usages. The Codex output model uses named Windows keys.
export function recordedShortcut(combo){
  const modifiers=['left_control','left_shift','left_alt','left_win','right_control','right_shift','right_alt','right_win'].filter((_,i)=>combo.mod&(1<<i));const n=Number(combo.key);
  let key=n===0?'modifiers_only':n>=4&&n<=29?String.fromCharCode(n+93):n>=30&&n<=38?String(n-29):n===39?'0':n>=58&&n<=69?'f'+(n-57):n>=104&&n<=115?'f'+(n-91):n>=89&&n<=97?'numpad'+(n-88):null;
  key=key||({40:'return_or_enter',41:'escape',42:'delete_or_backspace',43:'tab',44:'spacebar',45:'hyphen',46:'equal_sign',47:'open_bracket',48:'close_bracket',49:'backslash',51:'semicolon',52:'quote',53:'grave_accent_and_tilde',54:'comma',55:'period',56:'slash',57:'caps_lock',70:'print_screen',71:'scroll_lock',72:'pause',73:'insert',74:'home',75:'page_up',76:'delete_forward',77:'end',78:'page_down',79:'right_arrow',80:'left_arrow',81:'down_arrow',82:'up_arrow',83:'num_lock',84:'numpad_divide',85:'numpad_multiply',86:'numpad_subtract',87:'numpad_add',88:'return_or_enter',98:'numpad0',99:'numpad_decimal',224:'left_control',225:'left_shift',226:'left_alt',227:'left_win',228:'right_control',229:'right_shift',230:'right_alt',231:'right_win'})[n];
  if(!key)throw new Error('这个主键暂不支持在 Codex 模式输出，请手动选择。');return {key,modifiers};
}
