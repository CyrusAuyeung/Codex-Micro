import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,open,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {APP_VERSION,REPOSITORY} from './app-info.mjs';

const MAX_INSTALLER=256*1024*1024;
export function versionParts(value){return typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)?value.split('.').map(Number):null;}
export function newer(version,current){const a=versionParts(version),b=versionParts(current);if(!a||!b)return false;for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
export function selectRelease(release,current=APP_VERSION){
  const version=release?.tag_name?.replace(/^v/,'');
  if(release?.draft||release?.prerelease||!versionParts(version))throw new Error('发布信息无效');
  const name=`Micro-Windows-${version}-Setup-x64.exe`,base=`${REPOSITORY}/releases/download/${release.tag_name}/`,url=base+name;
  const asset=release.assets?.find(a=>a.name===name&&a.browser_download_url===url&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=MAX_INSTALLER);
  const sums=release.assets?.find(a=>a.name==='SHA256SUMS.txt'&&a.browser_download_url===base+'SHA256SUMS.txt'&&a.size>0&&a.size<=65536);
  return {version,available:newer(version,current)&&!!asset,url:asset?url:null,name,size:asset?.size||0,sha256:/^sha256:[a-f0-9]{64}$/i.test(asset?.digest)?asset.digest.slice(7).toLowerCase():null,checksumUrl:sums?.browser_download_url||null};
}
function fetchRelease(){
  return new Promise((resolve,reject)=>{
    const req=https.get('https://api.github.com/repos/CyrusAuyeung/Codex-Micro/releases/latest',{headers:{'User-Agent':`Micro-Windows/${APP_VERSION}`,Accept:'application/vnd.github+json'}},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error(`GitHub HTTP ${res.statusCode}`));return;}
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>524288)req.destroy(new Error('发布信息过大'));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});
    });
    const deadline=setTimeout(()=>req.destroy(new Error('检查更新超时')),8000);req.on('close',()=>clearTimeout(deadline));req.on('error',reject);
  });
}
export function downloadURL(value){
  let url;try{url=new URL(value);}catch{throw new Error('更新下载地址无效');}
  const official=url.hostname==='github.com'&&url.pathname.startsWith('/CyrusAuyeung/Codex-Micro/releases/download/');
  const assetHost=['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(url.hostname);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(official||assetHost))throw new Error('更新下载地址不属于项目发布源');
  return url;
}
export function downloadStream(value,signal,redirects=0){
  const url=downloadURL(value);
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{signal,headers:{'User-Agent':`Micro-Windows/${APP_VERSION}`,'Accept-Encoding':'identity'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){
        res.resume();if(redirects>=5||!res.headers.location){reject(new Error('更新下载跳转过多'));return;}
        try{resolve(downloadStream(new URL(res.headers.location,url).href,signal,redirects+1));}catch(e){reject(e);}return;
      }
      if(res.statusCode!==200){res.resume();reject(new Error(`下载服务返回 HTTP ${res.statusCode}`));return;}
      res.setTimeout(30000,()=>res.destroy(new Error('下载连接超时，请重试')));resolve(res);
    });
    req.setTimeout(30000,()=>req.destroy(new Error('下载连接超时，请重试')));req.on('error',reject);
  });
}
async function collect(stream,limit,signal){const chunks=[];let size=0;for await(const chunk of stream){signal?.throwIfAborted();size+=chunk.length;if(size>limit){stream.destroy?.();throw new Error('更新文件大小异常');}chunks.push(chunk);}return Buffer.concat(chunks);}

export class Updates{
  constructor({data,simulation=false,fetcher=fetchRelease,downloader=downloadStream,now=Date.now,testFixture=null}){
    this.file=path.join(data,'update-check.json');this.folder=path.join(data,'updates');this.simulation=simulation;this.testFixture=testFixture;
    this.fetcher=fetcher;this.downloader=downloader;this.now=now;this.pending=null;this.lastAttempt=0;this.result=null;
    this.progress={phase:'idle',received:0,total:0,error:null};this.transfer=null;this.controller=null;this.ready=null;
  }
  status(){return {...this.progress,current:APP_VERSION,version:this.ready?.version||this.progress.version||null,simulation:this.simulation};}
  async check(force=false){
    if(this.simulation&&!this.testFixture)return {current:APP_VERSION,available:false,simulation:true};
    if(this.pending)return this.pending;
    if(this.result&&this.now()-this.lastAttempt<(force?15000:86400000))return this.result;
    this.pending=this.run(force).finally(()=>{this.pending=null;});return this.pending;
  }
  async run(force){
    this.lastAttempt=this.now();let cached=null;
    try{const saved=JSON.parse(await readFile(this.file,'utf8'));if(Number.isFinite(saved.checkedAt))cached={...selectRelease(saved.release),checkedAt:saved.checkedAt};if(!force&&cached&&this.now()>=cached.checkedAt&&this.now()-cached.checkedAt<86400000)return this.result={current:APP_VERSION,...cached};}catch{}
    try{
      const release=this.testFixture?.release||await this.fetcher(),result=selectRelease(release),checkedAt=this.now();
      try{const tmp=this.file+'.tmp';await writeFile(tmp,JSON.stringify({checkedAt,release}));await rename(tmp,this.file);}catch{}
      return this.result={current:APP_VERSION,...result,checkedAt};
    }catch{return this.result={current:APP_VERSION,available:false,...cached,error:'暂时无法检查更新，请联网后重试。'};}
  }
  start(){
    if(this.transfer||this.progress.phase==='ready')return this.status();
    if(this.simulation&&!this.testFixture)throw new Error('模拟环境未提供更新包，未访问网络。');
    const control=new AbortController();this.controller=control;this.ready=null;this.progress={phase:'checking',received:0,total:0,error:null};
    this.transfer=this.download(control.signal).catch(e=>{this.ready=null;this.progress={...this.progress,phase:control.signal.aborted?'cancelled':'error',error:control.signal.aborted?'下载已取消。':e.message||'下载失败，请重试。'};}).finally(()=>{this.transfer=null;this.controller=null;});
    return this.status();
  }
  cancel(){if(this.controller){this.controller.abort();this.progress={...this.progress,phase:'cancelling',error:null};}return this.status();}
  async stream(url,signal){
    if(this.simulation){
      const release=selectRelease(this.testFixture?.release);if(url!==release.url)throw new Error('模拟更新地址不匹配。');
      const bytes=await readFile(this.testFixture.file);
      return (async function*(){for(let i=0;i<bytes.length;i+=4096){signal.throwIfAborted();yield bytes.subarray(i,i+4096);}})();
    }
    return this.downloader(url,signal);
  }
  async download(signal){
    const release=await this.check(true);signal.throwIfAborted();
    if(!release.available)throw new Error(release.error||'当前没有可下载的新版本。');
    let digest=release.sha256;
    if(!digest){
      if(!release.checksumUrl)throw new Error('新版未提供校验信息，暂不能在软件内安装。');
      const text=(await collect(await this.stream(release.checksumUrl,signal),65536,signal)).toString('utf8');
      const rows=text.trim().split(/\r?\n/).map(line=>/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line)).filter(row=>row&&row[2]===release.name);
      if(rows.length!==1)throw new Error('更新包校验信息无效。');digest=rows[0][1].toLowerCase();
    }
    await mkdir(this.folder,{recursive:true});signal.throwIfAborted();
    const part=path.join(this.folder,randomUUID()+'.part'),file=path.join(this.folder,release.name);let handle;
    this.progress={phase:'downloading',received:0,total:release.size,version:release.version,error:null};
    const timeout=setTimeout(()=>this.controller?.abort(),10*60*1000);timeout.unref?.();
    try{
      handle=await open(part,'wx');const hash=createHash('sha256');
      for await(const chunk of await this.stream(release.url,signal)){
        signal.throwIfAborted();this.progress.received+=chunk.length;if(this.progress.received>release.size)throw new Error('更新包大小与发布信息不符。');
        hash.update(chunk);await handle.writeFile(chunk);
      }
      await handle.close();handle=null;signal.throwIfAborted();this.progress.phase='verifying';
      if(this.progress.received!==release.size||hash.digest('hex')!==digest)throw new Error('更新包校验失败，请重新下载。');
      await rename(part,file);signal.throwIfAborted();this.ready={file,sha256:digest,version:release.version,size:release.size};this.progress.phase='ready';
    }finally{clearTimeout(timeout);if(handle)await handle.close().catch(()=>{});await unlink(part).catch(()=>{});}
  }
  async prepare(){
    if(this.progress.phase!=='ready'||!this.ready)throw new Error('请先完成更新包下载与校验。');
    const ready=this.ready,info=await stat(ready.file),bytes=await readFile(ready.file);
    if(info.size!==ready.size||createHash('sha256').update(bytes).digest('hex')!==ready.sha256){this.ready=null;this.progress.phase='error';this.progress.error='已下载文件发生变化，请重新下载。';throw new Error(this.progress.error);}
    return {...ready};
  }
}
