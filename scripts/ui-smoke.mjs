import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, writeFile, readFile, readdir} from 'node:fs/promises';
import {mockDevice} from '../tests/mock-device.mjs';
import {APP_VERSION} from '../app-info.mjs';
import {createHash} from 'node:crypto';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MICRO_PLAYWRIGHT || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const native = process.argv.includes('--native');
const artifactRoot = process.env.MICRO_UI_ARTIFACTS || process.env.RUNNER_TEMP;
assert.ok(artifactRoot && path.isAbsolute(artifactRoot), 'Set MICRO_UI_ARTIFACTS to an absolute directory outside the repository');
assert.ok(!path.resolve(artifactRoot).toLowerCase().startsWith(root.toLowerCase() + path.sep));
await mkdir(artifactRoot, {recursive:true});
const work = await mkdtemp(path.join(artifactRoot, native ? 'desktop-' : 'browser-'));
const reserve = async () => {const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
const port = await reserve(), debug = await reserve(), origin = `http://127.0.0.1:${port}`;
const device = await mockDevice(), inputFile = path.join(work,'input.json'), fixture = path.join(work,'hid.json');
await writeFile(fixture, JSON.stringify({sequence:1,autoTap:true}));
const updateVersion=APP_VERSION.split('.').map((n,i)=>Number(n)+(i===1?1:0)).join('.'),updateName=`Micro-Windows-${updateVersion}-Setup-x64.exe`,updateFile=path.join(work,updateName),updateFixture=path.join(work,'update.json'),updateBytes=Buffer.alloc(65536,42);
await writeFile(updateFile,updateBytes);await writeFile(updateFixture,JSON.stringify({file:updateFile,release:{tag_name:'v'+updateVersion,assets:[{name:updateName,size:updateBytes.length,digest:'sha256:'+createHash('sha256').update(updateBytes).digest('hex'),browser_download_url:`https://github.com/CyrusAuyeung/Codex-Micro/releases/download/v${updateVersion}/${updateName}`}]}}));
const env = {...process.env, MICRO_WINDOWS_PORT:String(port), MICRO_WINDOWS_DATA:path.join(work,'data'), MICRO_WINDOWS_TEST:'1', MICRO_WINDOWS_DEBUG_PORT:String(debug),
  MICRO_WINDOWS_DEVICE_ORIGIN:device.origin, MICRO_WINDOWS_INPUT_HELPER:path.join(root,'tests/mock-input.mjs'), MICRO_WINDOWS_INPUT_EVENTS:inputFile,
  MICRO_WINDOWS_HELPER:path.join(root,'tests/mock-hid.mjs'), MICRO_WINDOWS_FIXTURE:fixture,MICRO_WINDOWS_UPDATE_FIXTURE:updateFixture};
const background=process.argv.includes('--background');
const child = spawn(native?path.join(root,'Micro Windows.exe'):process.execPath,native?['--ui-test',...(background?['--background']:[])]:[path.join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const exit = new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
let browser;
async function until(fn, timeout=15000){const start=Date.now();while(Date.now()-start<timeout){try{const result=await fn();if(result)return result;}catch{}if(child.exitCode!==null)throw new Error('App exited: '+output);await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+output);}
async function signal(arg){return new Promise((resolve,reject)=>{const p=spawn(path.join(root,'Micro Windows.exe'),['--ui-test',arg],{cwd:root,env,windowsHide:true,stdio:'ignore'});p.on('exit',resolve);p.on('error',reject);});}
const errors=[];
try {
  await until(async()=>{const r=await fetch(origin+'/api/health');return r.ok;});
  let context,page;
  if(native){await until(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json/version`);return r.ok;},30000);browser=await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);context=browser.contexts()[0];page=await until(()=>context.pages().find(p=>p.url().startsWith(origin)));}
  else{browser=await chromium.launch({...(process.env.MICRO_BROWSER_CHANNEL?{channel:process.env.MICRO_BROWSER_CHANNEL}:{}),headless:true});context=await browser.newContext({viewport:{width:1100,height:720}});page=await context.newPage();}
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
  page.on('response',async r=>{if(r.status()>=400&&r.url().startsWith(origin))errors.push(r.url()+' '+await r.text().catch(()=>''));});
  if(!native)await page.goto(origin);await page.locator('#mapping-key13').waitFor();
  if(native&&background){assert.equal(await signal('--test-window-hidden'),0,'login startup must not show a window');assert.equal(await signal('--test-tray-left-click'),0,'single left click must restore the tray window');assert.equal(await signal('--test-window-visible'),0);}
  const navigationOrigin=await page.evaluate(()=>performance.timeOrigin);await page.evaluate(()=>document.querySelector('.masthead').dataset.retained='yes');
  if(native){
    const display=await until(async()=>JSON.parse(await readFile(path.join(work,'data/display.json'),'utf8')));
    const renderer=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
    assert.equal(display.perMonitorV2,true,'The real WinForms HWND must be per-monitor V2, not bitmap-scaled by Windows');
    assert.equal(display.targetFramework,'.NETFramework,Version=v4.8');assert.equal(display.icon,true);assert.equal(display.zoom,1);
    assert.ok(Math.abs(renderer.dpr-display.dpi/96)<0.01,JSON.stringify({display,renderer}));
    assert.ok(Math.abs(renderer.width*renderer.dpr-display.width)<=2,JSON.stringify({display,renderer}));
    assert.ok(Math.abs(renderer.height*renderer.dpr-display.height)<=2,JSON.stringify({display,renderer}));
    console.log('Actual native display: '+JSON.stringify({display,renderer}));
  }
  async function visibleInViewport(selector){const r=await page.locator(selector).boundingBox();const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.ok(r&&r.x>=0&&r.y>=0&&r.x+r.width<=size.w+1&&r.y+r.height<=size.h+1,`${selector} outside ${JSON.stringify(size)}: ${JSON.stringify(r)}`);}
  async function keyboardGeometry(){
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return page.evaluate(()=>{
      const selectors=['.shell','.masthead','.mode-tabs','.hardware-toolbar,.mode-banner','.drawing-surface','.section-head','.keyboard-case','.keyboard-grid','.dial-rim','.dial-face','.stick-base','.stick-cap','.stick-cap i','.stick-cap b','.touch-dot','.screw.tl','.screw.br','.orientation','.case-caption'];
      for(let i=1;i<=13;i++)selectors.push('.hardware:has(.key-number):nth-child('+(i+3)+')');
      return selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),c=getComputedStyle(el);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,padding:c.padding,border:c.borderWidth,radius:c.borderRadius};});
    });
  }
  async function compareModes(label){
    await until(()=>page.locator('#simulation-banner').isVisible());await until(()=>page.evaluate(()=>!window.microDesktopState().busy));const ordinary=await keyboardGeometry();
    await page.locator('.mode-tabs a[href="/codex"]').click();await page.locator('#control-key13').waitFor();await until(()=>page.locator('#mode-banner').isVisible());
    assert.equal(await page.evaluate(()=>performance.timeOrigin),navigationOrigin,'mode switch must not reload the document');assert.equal(await page.locator('.masthead').getAttribute('data-retained'),'yes');
    for(const id of ['save-button','undo-button'])assert.equal(await page.locator('#'+id).textContent(),id==='save-button'?'保存修改':'撤销修改');
    const primary=await page.locator('#save-button').boundingBox(),secondary=await page.locator('#undo-button').boundingBox();for(const field of ['height','width','y'])assert.ok(Math.abs(primary[field]-secondary[field])<.1,'footer buttons differ in '+field);
    await until(()=>page.evaluate(()=>!window.microDesktopState().busy));await visibleInViewport('#control-key13');await visibleInViewport('#save-button');const codex=await keyboardGeometry();
    for(let i=0;i<ordinary.length;i++)for(const field of Object.keys(ordinary[i])){
      const a=ordinary[i][field],b=codex[i][field];if(typeof a==='number')assert.ok(Math.abs(a-b)<0.1,`${label}: ${ordinary[i].selector} ${field} differs: ${a} vs ${b}`);else assert.equal(a,b,`${label}: ${ordinary[i].selector} ${field}`);
    }
    await page.screenshot({path:path.join(work,`codex-${label}.png`)});
    await page.locator('.mode-tabs a[href="/"]').click();await page.locator('#mapping-key13').waitFor();await until(()=>page.evaluate(()=>!window.microDesktopState().busy));
  }
  for(const size of (native?[null]:[{width:1100,height:720},{width:900,height:570},{width:820,height:570},{width:1366,height:768}])){
    if(size)await page.setViewportSize(size);
    await visibleInViewport('#mapping-key13');await visibleInViewport('#record-button');await visibleInViewport('#save-button');
    const shape=await page.locator('.keyboard-case').boundingBox();assert.ok(Math.abs(shape.width-shape.height)<1,'keyboard must retain its square proportions');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(work,`ordinary-${size?.width||'native'}.png`)});
    await compareModes(size?.width||'native');
  }
  if(!native){
    const protocol=await context.newCDPSession(page);
    for(const dpr of [1.25,1.5,1.75,2]){
      await protocol.send('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:dpr,mobile:false});
      await compareModes('scale-'+dpr);await page.screenshot({path:path.join(work,`ordinary-scale-${dpr}.png`)});
    }
    await protocol.send('Emulation.clearDeviceMetricsOverride');await protocol.detach();
  }
  if(!native)await page.setViewportSize({width:1100,height:720});
  await page.locator('[data-dialog="help-dialog"]').click();await page.locator('#help-dialog [data-close]').click();
  await page.locator('[data-dialog="network-dialog"]').click();await page.locator('#diagnose-button').click();await page.locator('#network-title').filter({hasText:'可用'}).waitFor();await page.locator('#network-dialog [data-close]').click();
  await page.locator('#read-button').click();await until(()=>page.locator('#shortcut-preview').textContent().then(t=>t==='Ctrl + C'));
  await page.locator('#mapping-key13').click();await page.locator('#record-button').click();
  await until(()=>page.locator('#record-status').textContent().then(t=>t.includes('请按下组合键')));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),progress:{holding:true,mod:4,key:4}}));
  await until(()=>page.locator('#record-target').inputValue().then(v=>v==='Alt + A'));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),progress:{holding:true,mod:4,key:5}}));
  await until(()=>page.locator('#record-target').inputValue().then(v=>v==='Alt + B'));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),candidate:{mod:4,key:5}}));
  await until(()=>page.locator('#confirm-record').isEnabled());await page.locator('#confirm-record').click();
  await until(()=>page.locator('#shortcut-preview').textContent().then(v=>v==='Alt + B'));
  assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),true);
  if(native)assert.equal(await signal('--shutdown-if-idle'),3,'installer must not discard unsaved draft');
  await page.locator('#save-button').click();await until(()=>page.evaluate(()=>!window.microDesktopState().busy&&!window.microDesktopState().dirty));assert.equal(device.state.posts.length,0,'save must only persist the local profile');await page.locator('#write-button').click();await page.locator('#confirm-save').click();
  await until(()=>device.state.posts.length===1);await until(()=>page.locator('#read-button').isEnabled());await page.locator('#read-button').click();
  await until(()=>page.locator('#save-detail').textContent().then(t=>t.includes('已核对')));assert.equal(await page.locator('#save-state').textContent(),'配置已保存');
  assert.equal(Number(device.state.mapping.key[15]),5);assert.equal(device.state.mapping.mod[15],4);
  await page.locator('#manage-profiles').click();
  if(!native){const download=page.waitForEvent('download');await page.locator('#export-profile').click();const file=await download;assert.match(file.suggestedFilename(),/^codex-micro-ordinary-profiles-.*\.json$/);assert.equal(Number(JSON.parse(await readFile(await file.path(),'utf8')).profiles[0].mapping.key[15]),5);}
  else{const protocol=await browser.newBrowserCDPSession();await protocol.send('Browser.setDownloadBehavior',{behavior:'default'});await protocol.detach();await page.locator('#export-profile').click();const folder=path.join(work,'data/exports');const name=await until(async()=>{const names=await readdir(folder);return names.find(n=>n.endsWith('.json'));});const saved=await until(async()=>JSON.parse(await readFile(path.join(folder,name),'utf8')));assert.equal(Number(saved.profiles[0].mapping.key[15]),5);}
  await until(()=>page.evaluate(()=>!window.microDesktopState().busy));await page.getByRole('button',{name:'复制当前',exact:true}).click();await page.getByRole('textbox',{name:'配置名称'}).fill('普通工作配置');await page.locator('.choice-dialog').getByRole('button',{name:'保存',exact:true}).click();await until(async()=>(await(await fetch(origin+'/api/ordinary/profiles')).json()).profiles.length===2);
  await page.locator('#profile-select + .select-trigger').click();await page.getByRole('option',{name:'普通工作配置',exact:true}).click();await until(()=>page.locator('#profile-select').inputValue().then(async v=>v===(await(await fetch(origin+'/api/ordinary/profiles')).json()).activeProfileId));assert.equal(device.state.posts.length,1);
  await page.locator('#manage-profiles').click();await page.locator('#backup-profiles').click();await until(()=>page.locator('.backup-row').count().then(n=>n>0));await until(()=>page.evaluate(()=>!window.microDesktopState().busy));
  const importedFile=path.join(work,'ordinary-import.json');await writeFile(importedFile,JSON.stringify(await(await fetch(origin+'/api/ordinary/profiles/export')).json()));await page.locator('#profiles-file').setInputFiles(importedFile);await until(async()=>(await(await fetch(origin+'/api/ordinary/profiles')).json()).profiles.length===3);await until(()=>page.evaluate(()=>!window.microDesktopState().busy));await page.locator('.backup-row button').first().click();await page.getByRole('button',{name:'恢复此备份',exact:true}).click();await until(async()=>(await(await fetch(origin+'/api/ordinary/profiles')).json()).profiles.length===2);await until(()=>page.evaluate(()=>!window.microDesktopState().busy));
  await page.locator('#read-button').click();await until(()=>page.evaluate(()=>!window.microDesktopState().busy));
  await page.locator('#restore-button').click();assert.equal(await page.locator('#shortcut-preview').textContent(),'—');assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),true);assert.equal(Number((await(await fetch(origin+'/api/ordinary/profiles')).json()).mapping.key[15]),5);await page.locator('#undo-button').click();assert.equal(await page.locator('#shortcut-preview').textContent(),'Alt + B');assert.equal(device.state.posts.length,1);
  await page.locator('.mode-tabs a[href="/codex"]').click();await page.locator('#control-key13').waitFor();
  await visibleInViewport('#control-key13');await visibleInViewport('#save-button');
  if(!native){await page.setViewportSize({width:900,height:570});await visibleInViewport('#control-key13');await visibleInViewport('#learn-button');await visibleInViewport('#save-button');const shape=await page.locator('.keyboard-case').boundingBox();assert.ok(Math.abs(shape.width-shape.height)<1);await page.screenshot({path:path.join(work,'codex-900.png')});await page.setViewportSize({width:1100,height:720});}
  await page.locator('#dial-control').click();await page.locator('[data-control="dial_cw"]').click();await page.locator('#learn-button').click();
  await until(()=>page.locator('#source-check').textContent().then(t=>t==='已识别'));
  await page.locator('#action-select + .select-trigger').click();await page.getByRole('searchbox',{name:'搜索选项'}).count().then(async count=>{if(count)await page.getByRole('searchbox',{name:'搜索选项'}).fill('复制');else await page.locator('.select-popup input').fill('复制');});await page.getByRole('option',{name:'复制',exact:true}).click();await page.locator('#save-button').click();await until(()=>page.evaluate(()=>!window.microDesktopState().dirty));
  await page.screenshot({path:path.join(work,'codex.png')});
  assert.equal(await page.locator('#save-button').isDisabled(),true,'unchanged apply must stay disabled');
  await page.locator('#record-button').click();
  await until(()=>page.locator('.record-dialog [role="status"]').textContent().then(t=>t.includes('请按下组合键')));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),candidate:{mod:132,key:115}}));await until(()=>page.locator('.confirm-record').isEnabled());await page.locator('.confirm-record').click();
  await until(()=>page.locator('#shortcut-preview').textContent().then(t=>t.includes('右 Win')&&t.includes('F24')));
  await page.locator('.mode-tabs a[href="/"]').click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.ok(page.url().endsWith('/codex'));assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),true);
  await page.locator('#save-button').click();await until(()=>page.evaluate(()=>!window.microDesktopState().busy&&!window.microDesktopState().dirty));
  const savedBindings=(await(await fetch(origin+'/api/state')).json()).bindings;
  await page.locator('[data-action="copy"]').click();await page.locator('#direction-reverse').check();
  assert.equal(await page.locator('#undo-button').isEnabled(),true);await page.locator('#undo-button').click();
  assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),false);assert.equal(await page.locator('#direction-reverse').isChecked(),false);
  assert.ok((await page.locator('#shortcut-preview').textContent()).includes('F24'));assert.deepEqual((await(await fetch(origin+'/api/state')).json()).bindings,savedBindings);
  await page.locator('#restore-button').click();assert.equal(await page.locator('#result-label').textContent(),'未设置功能');assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),true);assert.deepEqual((await(await fetch(origin+'/api/state')).json()).bindings,savedBindings);await page.locator('#undo-button').click();
  await page.locator('#test-toggle').click();await until(()=>page.locator('#test-toggle').textContent().then(t=>t==='结束测试'));
  await writeFile(fixture,JSON.stringify({sequence:2,autoTap:false,tap:true,code:'AG00',act:1}));await until(()=>page.locator('#dial-control').getAttribute('class').then(t=>t.includes('pressed')));
  await writeFile(fixture,JSON.stringify({sequence:3,autoTap:false,tap:true,code:'AG00',act:0}));await until(()=>page.locator('#dial-control').getAttribute('class').then(t=>!t.includes('pressed')));
  await page.locator('.mode-tabs a[href="/"]').click();await page.locator('#mapping-key13').waitFor();await until(async()=>!(await(await fetch(origin+'/api/state')).json()).status.testing);assert.equal(await page.locator('#selected-label').textContent(),'按键 13','ordinary selection survives mode switches');assert.match(await page.locator('#connection-state').textContent(),/已读取/);assert.equal(await page.evaluate(()=>performance.timeOrigin),navigationOrigin);await page.locator('.mode-tabs a[href="/codex"]').click();await page.locator('#control-key13').waitFor();await until(()=>page.locator('#test-toggle').textContent().then(t=>t==='仅测试'));
  await page.locator('#manage-profiles').click();await page.getByRole('button',{name:'复制当前',exact:true}).click();await page.getByRole('textbox',{name:'配置名称'}).fill('工作方案');await page.locator('.choice-dialog').getByRole('button',{name:'保存',exact:true}).click();
  await until(async()=>{const s=await(await fetch(origin+'/api/state')).json();return s.profiles.length===2;});
  await page.locator('#profile-select + .select-trigger').click();await page.getByRole('option',{name:'工作方案',exact:true}).click();await until(()=>page.locator('#profile-select + .select-trigger').textContent().then(t=>t==='工作方案'));
  await page.locator('#manage-profiles').click();await page.locator('#backup-profiles').click();await until(()=>page.locator('.backup-row').count().then(n=>n>0));await page.locator('#profiles-dialog [data-close]').click();
  await page.locator('#device-summary').click();assert.equal(await page.locator('.info-fields dd').count(),3);await page.locator('#device-info-dialog [data-close]').click();
  await page.screenshot({path:path.join(work,'codex-next.png')});
  await page.locator('#about-button').click();assert.ok((await page.locator('#app-version').textContent()).includes(APP_VERSION));await page.locator('#check-update').click();
  await until(()=>page.locator('#download-update').isVisible());await page.locator('#download-update').click();await until(()=>page.locator('#install-update').isVisible());assert.equal((await(await fetch(origin+'/api/updates/status')).json()).phase,'ready');
  if(native){await page.locator('#about-dialog [data-close]').click();await page.locator('[data-action="copy"]').click();await page.locator('#about-button').click();await until(()=>page.locator('#check-update').isEnabled());await page.locator('#install-update').click();assert.match(await page.locator('#update-status').textContent(),/先保存或撤销/);await assert.rejects(readFile(path.join(work,'data/update-install-test.json')),{code:'ENOENT'});await page.locator('#about-dialog [data-close]').click();await page.locator('#undo-button').click();await page.locator('#about-button').click();await until(()=>page.locator('#check-update').isEnabled());await page.locator('#install-update').click();const result=await until(async()=>JSON.parse(await readFile(path.join(work,'data/update-install-test.json'),'utf8')));assert.equal(result.verified,true);assert.equal(result.executed,false);assert.equal(result.version,updateVersion);await until(()=>page.locator('#install-update').isEnabled());}
  else{await page.locator('#install-update').click();assert.match(await page.locator('#update-status').textContent(),/桌面窗口中安装/);}
  await page.locator('#startup-toggle').check();await until(async()=>{const s=await(await fetch(origin+'/api/startup')).json();return s.enabled;});await until(()=>page.locator('#startup-toggle').isEnabled());await page.locator('#startup-toggle').uncheck();await until(async()=>{const s=await(await fetch(origin+'/api/startup')).json();return !s.enabled;});
  await page.locator('#about-dialog [data-close]').click();
  if(native){await page.evaluate(()=>window.chrome.webview.postMessage('test-hide'));await until(async()=>await signal('--test-window-hidden')===0);const hiddenState=await(await fetch(origin+'/api/state')).json();assert.equal(hiddenState.status.enabled,true,'closing the window must preserve local remapping');assert.equal(await signal('--test-tray-left-click'),0);assert.equal(await signal('--test-window-visible'),0);assert.equal(await signal('--shutdown-if-idle'),0);assert.equal(await exit,0);}
  else{await page.setViewportSize({width:430,height:760});await page.screenshot({path:path.join(work,'narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await fetch(origin+'/api/quit',{method:'POST',headers:{Origin:origin,'X-Micro-Panel':'1','Content-Type':'application/json'},body:'{}'});await exit;}
  assert.deepEqual(errors,[]);
  console.log(`${native?'Desktop WebView2':'Browser'} UI passed: persistent mode switching, identical geometry and buttons, DPI rendering, dual profile managers, local save vs device write, recording, save/readback, rotary mapping, guarded drafts, test cleanup and verified update download${native?', native install handoff, single tray click and shutdown':''}. Artifacts: ${work}`);
}finally{if(child.exitCode===null){await fetch(origin+'/api/quit',{method:'POST',headers:{Origin:origin,'X-Micro-Panel':'1','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)}).catch(()=>{});await Promise.race([exit,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill();}if(browser)await browser.close().catch(()=>{});await device.close();}
