import './device-info.js';
import {api,ask,message,syncControls,closeMenus} from './components.js';
const $=id=>document.getElementById(id),host=$('mode-host'),views=new Map(),loads=new Map();
let current=null,route=location.pathname==='/codex'?'/codex':'/',transitioning=false,installing=false,stopped=false;

function keyboardLayout(root){
  const keyboard=root.querySelector('.keyboard-case'),surface=keyboard.closest('.drawing-surface'),frame=document.createElement('div');frame.className='keyboard-frame';keyboard.before(frame);frame.append(keyboard);
  const resize=()=>{if(!root.isConnected)return;const css=getComputedStyle(surface),legend=surface.querySelector('.mapping-legend,.drawing-legend');const width=surface.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight),height=surface.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-(legend?.offsetHeight||0)-24,size=Math.max(1,Math.floor(Math.min(416,width,height)));frame.style.width=frame.style.height=size+'px';keyboard.style.zoom=size/416;keyboard.style.setProperty('--keyboard-scale',Math.max(.5,size/416));};new ResizeObserver(resize).observe(surface);return resize;
}
function preload(path){
  if(!loads.has(path))loads.set(path,Promise.all([fetch(path==='/codex'?'/views/codex':'/views/ordinary').then(r=>{if(!r.ok)throw new Error('界面加载失败，请重试。');return r.text();}),import(path==='/codex'?'/app.js':'/hardware.js')]).catch(e=>{loads.delete(path);throw e;}));return loads.get(path);
}
async function view(path){
  if(views.has(path))return views.get(path);const [html,module]=await preload(path),doc=new DOMParser().parseFromString(html,'text/html'),root=document.createElement('div');root.className='mode-view '+(path==='/'?'ordinary-view':'codex-view');
  for(const child of [...doc.querySelector('.shell').children])if(!child.matches('header,nav'))root.append(document.importNode(child,true));
  for(const child of [...doc.body.children])if(child.matches('dialog,.toast'))root.append(document.importNode(child,true));
  const banner=root.querySelector('#simulation-banner strong');if(banner)banner.textContent='模拟测试 · 当前没有连接或控制真实键盘';
  const controller=await module.mount(root),resize=keyboardLayout(root),entry={root,controller,resize};views.set(path,entry);return entry;
}
function tabs(){for(const a of document.querySelectorAll('.mode-tabs a')){if(new URL(a.href).pathname===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}document.title='Micro Windows · '+(route==='/codex'?'Codex 模式':'普通模式');}
async function navigate(path,{historyMode='push',initial=false}={}){
  if(transitioning||installing||current&&path===route)return false;if(current?.controller.getState().busy)return false;transitioning=true;
  try{
    if(current&&!await current.controller.beforeLeave())return false;
    const next=await view(path);if(current)await current.controller.suspend();closeMenus();
    const swap=()=>{host.replaceChildren(next.root);current=next;route=path;tabs();if(!initial&&historyMode==='push')history.pushState({mode:path},'',path);next.controller.resume();syncControls();next.resize();};
    if(current&&document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const transition=document.startViewTransition(swap);await transition.updateCallbackDone;await transition.finished.catch(()=>{});}else swap();return true;
  }catch(e){message(e.message,true);return false;}finally{transitioning=false;}
}
window.microDesktopState=()=>{const states=[...views.values()].map(v=>v.controller.getState());return {busy:transitioning||states.some(s=>s.busy),dirty:states.some(s=>s.dirty)};};
window.addEventListener('beforeunload',e=>{const s=window.microDesktopState();if(!stopped&&(s.busy||s.dirty)){e.preventDefault();e.returnValue='';}});
document.querySelectorAll('.mode-tabs a').forEach(a=>a.addEventListener('click',e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.button)return;e.preventDefault();navigate(new URL(a.href).pathname);}));
window.addEventListener('popstate',async()=>{const destination=location.pathname;if(destination===route)return;const previous=route;if(!await navigate(destination==='/'?'/':'/codex',{historyMode:'none'}))history.pushState({mode:previous},'',previous);});
document.addEventListener('click',event=>{const opener=event.target.closest('[data-dialog]');if(opener)(current?.root.querySelector('#'+opener.dataset.dialog)||$(opener.dataset.dialog))?.showModal();if(event.target.closest('[data-close]'))event.target.closest('dialog')?.close();});
window.microQuit=async()=>{const state=window.microDesktopState();if(state.busy||installing)return;if(state.dirty){const answer=await ask({title:'退出 Micro Windows',text:'还有未保存的草稿，退出会丢弃这些修改。',choices:[{value:'quit',label:'放弃并退出'},{value:'cancel',label:'继续编辑',primary:true}]});if(answer.value!=='quit')return;}try{await current?.controller.suspend();await api('/api/quit',{});stopped=true;for(const v of views.values())v.controller.stop();message('Micro Windows 已退出。');}catch(e){message(e.message,true);}};

const about=document.createElement('dialog');about.id='about-dialog';about.setAttribute('aria-labelledby','about-title');
about.innerHTML='<h2 id="about-title">Micro Windows</h2><p class="about-version" id="app-version">正在读取版本…</p><p id="update-status" role="status">正在检查更新…</p><progress id="update-progress" class="update-progress" hidden></progress><p id="update-size" class="update-size" hidden></p><div class="update-actions"><button id="cancel-update" class="button" hidden>取消下载</button><button id="download-update" class="button primary" hidden>下载更新</button><button id="install-update" class="button primary" hidden>安装并重启</button></div><p><a class="button" href="https://github.com/CyrusAuyeung/Codex-Micro" target="_blank" rel="noopener">项目主页 ↗</a></p><label class="check-line"><input id="startup-toggle" type="checkbox">开机启动（进入托盘）</label><p id="startup-hint" class="field-help" role="status" hidden></p><div class="dialog-actions"><button id="quit-button" class="button">退出程序</button><button id="check-update" class="button">检查更新</button><button class="button" data-close>关闭</button></div>';
document.body.append(about);let startupRevision=0,release=null,updateState={phase:'idle'},updateTimer=null;
function startupMessage(text=''){const hint=$('startup-hint');hint.textContent=text;hint.hidden=!text;}
$('startup-toggle').onchange=async()=>{startupRevision++;startupMessage();const input=$('startup-toggle'),enabled=input.checked;input.disabled=true;try{input.checked=(await api('/api/startup',{enabled})).enabled;}catch(e){input.checked=!enabled;startupMessage(e.message);}finally{input.disabled=false;}};
$('about-button').onclick=()=>{about.showModal();checkUpdates();startupMessage();const revision=++startupRevision;api('/api/startup').then(s=>{if(revision===startupRevision)$('startup-toggle').checked=s.enabled;}).catch(e=>{if(revision===startupRevision)startupMessage(e.message);});};
$('quit-button').onclick=()=>window.chrome?.webview?window.chrome.webview.postMessage('quit'):window.microQuit();
function renderUpdate(){
  const s=updateState,running=['checking','downloading','verifying','cancelling'].includes(s.phase),ready=s.phase==='ready';
  $('download-update').hidden=running||ready||!release?.available;$('download-update').textContent=s.phase==='error'?'重新下载':'下载更新';$('cancel-update').hidden=!running;$('cancel-update').disabled=s.phase==='cancelling';$('cancel-update').textContent=s.phase==='cancelling'?'取消中…':'取消下载';$('install-update').hidden=!ready;$('check-update').disabled=running||installing;
  $('update-progress').hidden=!running;$('update-size').hidden=!running;if(s.total){$('update-progress').max=s.total;$('update-progress').value=s.received;$('update-size').textContent=(s.received/1048576).toFixed(1)+' / '+(s.total/1048576).toFixed(1)+' MB';}else{$('update-progress').removeAttribute('value');$('update-size').textContent='正在准备下载…';}
  $('update-status').textContent=installing?'正在准备安装并重启…':s.phase==='ready'?s.version+' 已就绪，安装后自动重启。':s.phase==='downloading'?'正在下载 '+s.version+'…':s.phase==='checking'?'正在获取更新信息…':s.phase==='verifying'?'正在校验安装包…':s.phase==='cancelling'?'正在取消下载…':s.error||(release?.available?'发现新版本 '+release.version+'。':release?.error||(release?.simulation?'模拟测试环境':'当前已是最新版本。'));
}
async function pollUpdate(){clearTimeout(updateTimer);try{updateState=await api('/api/updates/status');renderUpdate();if(['checking','downloading','verifying','cancelling'].includes(updateState.phase))updateTimer=setTimeout(pollUpdate,400);}catch(e){$('update-status').textContent=e.message;}}
async function checkUpdates(force=false){$('check-update').disabled=true;try{release=await api('/api/updates',{force});$('app-version').textContent='Windows · '+release.current;$('update-dot').hidden=!release.available;await pollUpdate();}catch{ $('update-status').textContent='暂时无法检查更新，请稍后重试。';}finally{$('check-update').disabled=['checking','downloading','verifying','cancelling'].includes(updateState.phase)||installing;}}
$('check-update').onclick=()=>checkUpdates(true);
$('download-update').onclick=async()=>{try{updateState=await api('/api/updates/download',{});renderUpdate();pollUpdate();}catch(e){$('update-status').textContent=e.message;}};
$('cancel-update').onclick=async()=>{try{updateState=await api('/api/updates/cancel',{});renderUpdate();}catch(e){$('update-status').textContent=e.message;}};
function installFinished(error){installing=false;host.inert=false;document.querySelector('.mode-tabs').inert=false;$('install-update').disabled=false;$('startup-toggle').disabled=false;$('quit-button').disabled=false;renderUpdate();if(error)$('update-status').textContent=error;}
$('install-update').onclick=async()=>{
  if(!window.chrome?.webview){$('update-status').textContent='请在 Micro Windows 桌面窗口中安装更新。';return;}const state=window.microDesktopState();if(state.busy||state.dirty){$('update-status').textContent='请先保存或撤销草稿，并完成当前操作，再安装更新。';return;}
  installing=true;host.inert=true;document.querySelector('.mode-tabs').inert=true;$('install-update').disabled=true;$('startup-toggle').disabled=true;$('quit-button').disabled=true;renderUpdate();window.chrome.webview.postMessage('install-update');
};
window.chrome?.webview?.addEventListener('message',event=>{if(event.data?.kind==='update-install-result')installFinished(event.data.error||'安装流程已完成。');});
fetch('/api/health').then(r=>r.json()).then(info=>$('app-version').textContent='Windows · '+info.version).catch(()=>{});
history.replaceState({mode:route},'',route);tabs();await navigate(route,{initial:true,historyMode:'none'});preload(route==='/'?'/codex':'/').catch(()=>{});checkUpdates();
api('/api/updates/result').then(({result})=>{if(result?.error)message('上次更新未完成：'+result.error,true);}).catch(()=>{});
