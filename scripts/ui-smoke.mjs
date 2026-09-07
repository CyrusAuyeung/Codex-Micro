import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, writeFile, readFile, readdir} from 'node:fs/promises';
import {mockDevice} from '../tests/mock-device.mjs';
import {APP_VERSION} from '../app-info.mjs';

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
const env = {...process.env, MICRO_WINDOWS_PORT:String(port), MICRO_WINDOWS_DATA:path.join(work,'data'), MICRO_WINDOWS_TEST:'1', MICRO_WINDOWS_DEBUG_PORT:String(debug),
  MICRO_WINDOWS_DEVICE_ORIGIN:device.origin, MICRO_WINDOWS_INPUT_HELPER:path.join(root,'tests/mock-input.mjs'), MICRO_WINDOWS_INPUT_EVENTS:inputFile,
  MICRO_WINDOWS_HELPER:path.join(root,'tests/mock-hid.mjs'), MICRO_WINDOWS_FIXTURE:fixture};
const child = spawn(native?path.join(root,'Micro Windows.exe'):process.execPath,native?['--ui-test']:[path.join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
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
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(origin);await page.locator('#mapping-key13').waitFor();
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
    await until(()=>page.locator('#simulation-banner').isVisible());const ordinary=await keyboardGeometry();
    await page.locator('.mode-tabs a[href="/codex"]').click();await page.locator('#control-key13').waitFor();await until(()=>page.locator('#mode-banner').isVisible());
    await visibleInViewport('#control-key13');await visibleInViewport('#save-button');const codex=await keyboardGeometry();
    for(let i=0;i<ordinary.length;i++)for(const field of Object.keys(ordinary[i])){
      const a=ordinary[i][field],b=codex[i][field];if(typeof a==='number')assert.ok(Math.abs(a-b)<0.1,`${label}: ${ordinary[i].selector} ${field} differs: ${a} vs ${b}`);else assert.equal(a,b,`${label}: ${ordinary[i].selector} ${field}`);
    }
    await page.screenshot({path:path.join(work,`codex-${label}.png`)});
    await page.locator('.mode-tabs a[href="/"]').click();await page.locator('#mapping-key13').waitFor();
  }
  for(const size of (native?[null]:[{width:1100,height:720},{width:900,height:570},{width:1366,height:768}])){
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
  await until(()=>page.locator('#record-status').textContent().then(t=>t.includes('拦截已就绪')));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),progress:{holding:true,mod:4,key:4}}));
  await until(()=>page.locator('#record-target').inputValue().then(v=>v==='Alt + A'));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),progress:{holding:true,mod:4,key:5}}));
  await until(()=>page.locator('#record-target').inputValue().then(v=>v==='Alt + B'));
  await writeFile(inputFile,JSON.stringify({id:Date.now(),candidate:{mod:4,key:5}}));
  await until(()=>page.locator('#confirm-record').isEnabled());await page.locator('#confirm-record').click();
  await until(()=>page.locator('#shortcut-preview').textContent().then(v=>v==='Alt + B'));
  assert.equal(await page.evaluate(()=>window.microDesktopState().dirty),true);
  if(native)assert.equal(await signal('--shutdown-if-idle'),3,'installer must not discard unsaved draft');
  await page.locator('#save-button').click();await page.locator('#confirm-save').click();
  await until(()=>device.state.posts.length===1);await until(()=>page.locator('#read-button').isEnabled());await page.locator('#read-button').click();
  await until(()=>page.locator('#save-state').textContent().then(t=>t.includes('已核对')));
  assert.equal(Number(device.state.mapping.key[15]),5);assert.equal(device.state.mapping.mod[15],4);
  await page.locator('#export-button').click();assert.equal(Number(JSON.parse(await page.locator('#export-json').inputValue()).key[15]),5);
  if(!native){const download=page.waitForEvent('download');await page.locator('#download-export').click();const file=await download;assert.match(file.suggestedFilename(),/^codex-micro-mapping-.*\.json$/);}
  else{const protocol=await browser.newBrowserCDPSession();await protocol.send('Browser.setDownloadBehavior',{behavior:'default'});await protocol.detach();await page.locator('#download-export').click();const folder=path.join(work,'data/exports');const name=await until(async()=>{const names=await readdir(folder);return names.find(n=>n.endsWith('.json'));});const saved=await until(async()=>JSON.parse(await readFile(path.join(folder,name),'utf8')));assert.equal(Number(saved.key[15]),5);}
  await page.locator('#close-export').click();
  await page.locator('.mode-tabs a[href="/codex"]').click();await page.locator('#control-key13').waitFor();
  await visibleInViewport('#control-key13');await visibleInViewport('#save-button');
  if(!native){await page.setViewportSize({width:900,height:570});await visibleInViewport('#control-key13');await visibleInViewport('#learn-button');await visibleInViewport('#save-button');const shape=await page.locator('.keyboard-case').boundingBox();assert.ok(Math.abs(shape.width-shape.height)<1);await page.screenshot({path:path.join(work,'codex-900.png')});await page.setViewportSize({width:1100,height:720});}
  await page.locator('#dial-control').click();await page.locator('[data-control="dial_cw"]').click();await page.locator('#learn-button').click();
  await until(()=>page.locator('#source-check').textContent().then(t=>t==='已识别'));
  await page.locator('#action-select').selectOption('copy');await page.locator('#save-button').click();await until(()=>page.evaluate(()=>!window.microDesktopState().dirty));
  await page.screenshot({path:path.join(work,'codex.png')});
  await page.locator('#about-button').click();assert.ok((await page.locator('#app-version').textContent()).includes(APP_VERSION));await page.locator('#check-update').click();await page.locator('#about-dialog [data-close]').click();
  if(native){await page.evaluate(()=>window.chrome.webview.postMessage('test-hide'));await until(async()=>await signal('--test-window-hidden')===0);const hiddenState=await(await fetch(origin+'/api/state')).json();assert.equal(hiddenState.status.enabled,true,'closing the window must preserve local remapping');assert.equal(await signal('--activate'),0);assert.equal(await signal('--test-window-visible'),0);assert.equal(await signal('--shutdown-if-idle'),0);assert.equal(await exit,0);}
  else{await page.setViewportSize({width:430,height:760});await page.screenshot({path:path.join(work,'narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await fetch(origin+'/api/quit',{method:'POST',headers:{Origin:origin,'X-Micro-Panel':'1','Content-Type':'application/json'},body:'{}'});await exit;}
  assert.deepEqual(errors,[]);
  console.log(`${native?'Desktop WebView2':'Browser'} UI passed: identical mode geometry, DPI rendering, first viewport, help, diagnostics, recording, save/readback, rotary mapping, update UI${native?', draft protection, hide/restore and shutdown':''}. Artifacts: ${work}`);
}finally{if(child.exitCode===null){await fetch(origin+'/api/quit',{method:'POST',headers:{Origin:origin,'X-Micro-Panel':'1','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)}).catch(()=>{});await Promise.race([exit,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill();}if(browser)await browser.close().catch(()=>{});await device.close();}
