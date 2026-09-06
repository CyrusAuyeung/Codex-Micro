import http from 'node:http';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DeviceNetwork} from './network.mjs';
const C=createRequire(import.meta.url)('./public/mapping-core.js');

const DEVICE='http://192.168.4.1';
const waiting=s=>['sending','awaiting-verification','uncertain'].includes(s);
const equal=(a,b)=>C.changed(a,b).length===0;

export class DeviceMapping {
  constructor({data,simulation=false,testOrigin,timeout=5000}) {
    this.origin=simulation?null:DEVICE;
    if(testOrigin){
      const url=new URL(testOrigin);
      if(!simulation||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('模拟设备地址仅允许本机 HTTP。');
      this.origin=url.origin;
    }
    this.simulation=Boolean(simulation);this.timeout=timeout;
    this.network=new DeviceNetwork({data,simulation:this.simulation});
    this.dir=path.join(data,'device-config');this.journalFile=path.join(this.dir,'last-write.json');
    this.journal=null;this.reads=new Map();this.prepared=new Map();
  }
  async init(){
    try{this.journal=JSON.parse(await readFile(this.journalFile,'utf8'));if(this.journal.version!==1||!['sending','awaiting-verification','uncertain','verified','not-applied','different'].includes(this.journal.state))throw new Error('记录版本或状态无效。');C.validate(this.journal.before,false);C.validate(this.journal.expected,false);}
    catch(e){if(e.code!=='ENOENT')throw new Error('设备写入记录无法读取，原文件已保留：'+e.message);}
  }
  async atomic(file,value){
    await mkdir(path.dirname(file),{recursive:true});
    const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);
  }
  async record(journal){await this.atomic(this.journalFile,journal);this.journal=journal;}
  status(){
    const j=this.journal;
    return {origin:this.origin,simulation:this.simulation,state:j?.state||'idle',attemptedAt:j?.attemptedAt||null,verifiedAt:j?.verifiedAt||null,backup:j?.backup||null,differences:j?.differences||[],error:j?.error||null};
  }
  request(route,method='GET',body,localAddress){
    if(!this.origin)return Promise.reject(new Error('模拟设备未配置；测试模式不会访问真实键盘。'));
    const url=new URL(route,this.origin);
    return new Promise((resolve,reject)=>{
      const data=body===undefined?null:Buffer.from(JSON.stringify(body));let timer;
      const req=http.request(url,{method,agent:false,family:4,localAddress,headers:{Accept:route==='/'?'text/html':'application/json',...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{
        const chunks=[];let size=0;
        res.on('data',b=>{size+=b.length;if(size>262144)req.destroy(new Error('键盘响应过大，已停止读取。'));else chunks.push(b);});
        res.on('error',e=>{clearTimeout(timer);reject(e);});
        res.on('end',()=>{
          clearTimeout(timer);
          if(res.statusCode<200||res.statusCode>=300){reject(new Error('键盘接口返回 HTTP '+res.statusCode+'，没有跟随重定向。'));return;}
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
      timer=setTimeout(()=>req.destroy(Object.assign(new Error('键盘未在限定时间内响应。'),{code:'ETIMEDOUT'})),this.timeout);
      req.on('error',e=>{clearTimeout(timer);reject(e);});
      req.end(data);
    });
  }
  async current(){
    const network=await this.network.snapshot();
    try{
      if(['dhcp-missing','dhcp-pending','other-network','address-mismatch'].includes(network.state))throw Object.assign(new Error(network.detail),{code:'NETWORK_SETUP'});
      const html=await this.request('/', 'GET', undefined,network.localAddress||undefined);
      if(!/<title>\s*Codex Micro 键位配置\s*<\/title>/i.test(html)||!html.includes('/api/mapping'))throw new Error('目标地址不是已知的 Codex Micro 键位配置页。请进入 Config 配置模式，不要进入 OTA 模式。');
      let value;try{value=JSON.parse(await this.request('/api/mapping','GET',undefined,network.localAddress||undefined));}catch(e){if(e instanceof SyntaxError)throw new Error('键盘没有返回有效的配置 JSON。');throw e;}
      const mapping=C.validate(value,false);await this.network.record(network,{reachable:true,message:this.simulation?'已读取模拟配置接口。':'已读取真实配置接口。'});return mapping;
    }catch(e){
      const hints={ENETUNREACH:'Windows 没有可用的网络路径到达键盘。',EHOSTUNREACH:'Windows 无法到达键盘地址。',EADDRNOTAVAIL:'配置连接的 IP 已变化，请重新读取。',ETIMEDOUT:'已尝试连接，但键盘没有响应。请确认处于红灯 Config 模式，必要时重新进入该模式。',ECONNREFUSED:'键盘地址拒绝连接，请确认进入的是 Config 配置模式。'};
      if(hints[e.code])e.message=hints[e.code]+' '+network.detail;
      e.network=await this.network.record(network,{reachable:false,code:e.code||'DEVICE_RESPONSE',message:e.message});throw e;
    }
  }
  trim(){
    const now=Date.now();
    for(const collection of [this.reads,this.prepared])for(const [id,v] of collection)if(v.expires<now)collection.delete(id);
    while(this.reads.size>=32)this.reads.delete(this.reads.keys().next().value);
    while(this.prepared.size>=16)this.prepared.delete(this.prepared.keys().next().value);
  }
  async read(){
    const mapping=await this.current();
    if(this.journal&&waiting(this.journal.state)){
      const j=this.journal;
      const state=equal(mapping,j.expected)?'verified':equal(mapping,j.before)?'not-applied':'different';
      await this.record({...j,state,verifiedAt:new Date().toISOString(),differences:C.changed(j.expected,mapping),error:null});
    }
    const readAt=new Date().toISOString();await this.atomic(path.join(this.dir,'last-read.json'),{readAt,mapping});
    this.trim();const readToken=randomUUID();this.reads.set(readToken,{mapping:C.clone(mapping),expires:Date.now()+30*60*1000});
    return {mapping,readToken,readAt,verification:this.status(),network:this.network.last};
  }
  async prepare({readToken,draft}){
    this.trim();
    if(this.journal&&waiting(this.journal.state))throw new Error('上次写入还没有核对。请先读取键盘，不会自动重复写入。');
    const read=this.reads.get(readToken);if(!read)throw new Error('读取记录已过期，请重新读取键盘。');
    C.validate(draft,false);
    const fresh=await this.current(),outgoing=C.payload(read.mapping,draft,fresh);
    const changes=C.changed(fresh,outgoing).map(index=>({index,label:C.POS[index]||'未命名',before:C.parts(fresh,index).join(' + '),after:C.parts(outgoing,index).join(' + ')}));
    const token=randomUUID();this.prepared.set(token,{fresh,outgoing,expires:Date.now()+120000});
    return {token,expires:Date.now()+120000,changes,simulation:this.simulation};
  }
  async commit({token}){
    this.trim();const tx=this.prepared.get(token);if(!tx)throw new Error('保存确认已过期或已使用，请重新预览修改。');
    this.prepared.delete(token);
    if(this.journal&&waiting(this.journal.state))throw new Error('上次写入还没有核对，请先读取键盘。');
    const fresh=await this.current(),outgoing=C.payload(tx.fresh,tx.outgoing,fresh);
    if(equal(fresh,outgoing))return {state:'unchanged',message:'键盘已包含这些设置，没有重复写入。'};
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
    const backup=id+'-before.json';
    await this.atomic(path.join(this.dir,'backups',backup),fresh);
    const journal={version:1,id,state:'sending',attemptedAt:new Date().toISOString(),backup,before:fresh,expected:outgoing};
    await this.record(journal);
    this.reads.clear();this.prepared.clear();
    let response;
    try{
      response=JSON.parse(await this.request('/api/mapping','POST',outgoing,this.network.last?.localAddress||undefined));
      if(!response||typeof response!=='object'||Array.isArray(response)||response.ok===false||response.success===false||response.error||response.status==='error')throw new Error('键盘保存响应未能确认。');
    }catch(e){
      await this.record({...journal,state:'uncertain',error:e.message});
      return {state:'uncertain',message:'写入结果尚未确认：'+e.message+' 请重新进入配置热点并读取核对，不会自动重试。',backup};
    }
    await this.record({...journal,state:'awaiting-verification'});
    return {state:'awaiting-verification',message:'键盘已响应保存请求。重新进入配置热点后，读取并核对，才能确认保存结果。',backup};
  }
}
