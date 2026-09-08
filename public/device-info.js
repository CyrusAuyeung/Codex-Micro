import {api,message} from './components.js';
const summary=document.createElement('button');summary.className='device-summary';summary.id='device-summary';summary.textContent='设备信息 · 正在读取…';document.querySelector('.header-tools').prepend(summary);
const dialog=document.createElement('dialog');dialog.id='device-info-dialog';dialog.setAttribute('aria-labelledby','device-info-title');dialog.innerHTML='<h2 id="device-info-title">设备信息</h2><p id="device-info-connection"></p><dl class="info-fields"></dl><p class="field-help" id="device-info-note" hidden></p><div class="dialog-actions"><button class="button" data-close>关闭</button><button class="button" id="refresh-device-info">刷新设备信息</button></div>';document.body.append(dialog);
const fields=dialog.querySelector('dl'),refresh=dialog.querySelector('#refresh-device-info');
function render(info){
  const battery=info.fields.battery;summary.textContent=(info.mode||'设备未连接')+(battery?' · '+battery.value+'%'+(battery.cached?'（上次）':''):' · 电量未知');
  summary.classList.toggle('connected',info.connected);dialog.querySelector('#device-info-connection').textContent=info.connected?info.name+' · '+info.mode:info.ambiguous?'设备身份待确认':'未检测到已连接的键盘';fields.replaceChildren();
  for(const [name,label] of [['battery','电量'],['charging','充电状态'],['version','固件版本']]){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');const field=info.fields[name];const value=document.createElement('strong');value.textContent=field?(name==='battery'?field.value+'%':name==='charging'?(field.value?'正在充电':'未在充电'):field.value):'尚未获取';dd.append(value);if(field){const small=document.createElement('small');small.textContent=(field.cached?'上次读取':'本次读取')+' · '+new Date(field.time).toLocaleString();dd.append(small);}fields.append(dt,dd);}
  const note=dialog.querySelector('#device-info-note');note.textContent=info.error||'';note.hidden=!info.error;
  refresh.disabled=info.busy;
}
async function poll(force=false){try{render(await api(force?'/api/telemetry/refresh':'/api/telemetry',force?{}:undefined));}catch(e){summary.textContent='设备信息暂不可用';if(force)message(e.message,true);}}
summary.onclick=()=>{dialog.showModal();poll();};refresh.onclick=()=>poll(true);poll();const timer=setInterval(()=>{if(!document.hidden)poll();},5000);window.addEventListener('pagehide',()=>clearInterval(timer));
