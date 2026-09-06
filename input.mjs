import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const validId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/i.test(s);
const validCombo=m=>Number.isInteger(m.mod)&&m.mod>=0&&m.mod<=255&&Number.isInteger(m.key)&&m.key>=0&&m.key<=65535&&(m.mod>0||m.key>0);
const root=path.dirname(fileURLToPath(import.meta.url));

export class KeyboardInput {
  constructor({simulation=false,helper=process.env.MICRO_WINDOWS_INPUT_HELPER}){
    this.simulation=simulation;this.fixture=simulation?helper:null;
    this.native=null;this.ready=false;this.error=null;this.clients=new Map();
    this.session=null;this.retryAfter=0;
    this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();
  }
  touch(client){if(!validId(client))throw new Error('无效的页面会话，请刷新页面。');this.clients.set(client,Date.now());}
  start(){
    if(this.native||Date.now()<this.retryAfter)return;
    if(this.simulation&&!this.fixture){this.error='模拟环境未提供按键录入组件，请手动选择快捷键。';return;}
    const child=spawn(this.fixture?process.execPath:path.join(root,'MicroInput.Windows.exe'),this.fixture?[this.fixture]:[],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...(this.fixture?{MICRO_WINDOWS_TEST:'1'}:{})}});
    this.native=child;this.ready=false;this.error=null;
    createInterface({input:child.stdout}).on('line',line=>{if(line.length>8192)return;try{this.ingest(JSON.parse(line));}catch{}});
    child.stderr.on('data',()=>{}); // Never store keystroke-related subprocess output in logs.
    child.stdin.on('error',()=>{});
    child.on('error',e=>{this.error='Windows 按键检测未启动：'+e.message;this.ready=false;});
    child.on('close',()=>{if(this.native!==child)return;this.native=null;this.ready=false;this.retryAfter=Date.now()+3000;if(this.session&&!this.session.result)this.session.result={id:this.session.id,error:'按键检测已停止，请重新录入。'};});
  }
  send(command){if(!this.native?.stdin.writable)throw new Error('Windows 按键检测尚未就绪。');this.native.stdin.write(JSON.stringify(command)+'\n');}
  ingest(m){
    if(m.kind==='status'){this.ready=Boolean(m.ready);this.error=m.error||null;}
    if(m.kind==='error')this.error=String(m.error||'按键检测失败。');
    const s=this.session;
    if(!s||s.id!==m.id||s.result||Date.now()>=s.expires)return;
    if(m.kind==='recording'){s.armed=true;s.guarded=m.guarded===true;s.confirmRequired=m.confirmRequired===true;}
    if(m.kind==='progress'&&s.armed){
      if(Number.isInteger(m.mod)&&m.mod>=0&&m.mod<=255&&(m.key===null||(Number.isInteger(m.key)&&m.key>=0&&m.key<=65535))&&typeof m.holding==='boolean')s.progress={id:m.id,mod:m.mod,key:m.key,holding:m.holding};
    }
    if(m.kind==='candidate'&&s.armed&&Number.isInteger(m.revision)&&m.revision>(s.candidate?.revision||0)&&(m.error||validCombo(m))){
      s.candidate=m.error?{id:m.id,revision:m.revision,error:String(m.error)}:{id:m.id,mod:m.mod,key:m.key,revision:m.revision};s.progress=null;
    }
    if(m.kind==='confirm-rejected'&&s.confirming?.revision===m.revision)s.confirming.error=String(m.error||'请核对组合键后再次确认。');
    if(m.kind==='recorded'){
      if(m.error)s.result={id:m.id,error:String(m.error)};
      else if(s.confirming?.revision===m.revision&&s.candidate?.revision===m.revision&&validCombo(m)&&s.candidate.mod===m.mod&&s.candidate.key===m.key)s.result={id:m.id,mod:m.mod,key:m.key,revision:m.revision};
      if(s.result)s.progress=null;
    }
  }
  async begin(client,id){
    this.touch(client);if(!validId(id))throw new Error('无效的录入会话。');
    if(this.session&&!this.session.result&&this.session.expires>Date.now()&&this.session.client!==client)throw new Error('另一个页面正在录入组合键，请先结束那次录入。');
    this.start();
    if(this.session&&!this.session.result)try{this.send({op:'cancel',id:this.session.id});}catch{}
    const session=this.session={client,id,expires:Date.now()+61000,result:null,progress:null,candidate:null,confirming:null,armed:false,guarded:false,confirmRequired:false};
    const readyUntil=Date.now()+2500;while(this.session===session&&!this.ready&&Date.now()<readyUntil&&!this.error)await new Promise(r=>setTimeout(r,25));
    if(this.session!==session)throw new Error('录入已取消。');
    if(!this.ready){const message=this.error||'Windows 按键检测正在启动，请稍后再试。';this.cancel(client,id);throw new Error(message);}
    this.send({op:'record',id});
    const until=Date.now()+2500;while(this.session===session&&!session.armed&&!session.result&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
    if(this.session!==session)throw new Error('录入已取消。');
    if(!session.armed){const message=session.result?.error||'Windows 快捷键拦截未就绪，请重试或手动选择。';this.cancel(client,id);throw new Error(message);}
    if(!session.guarded||!session.confirmRequired){this.cancel(client,id);throw new Error('录入组件版本不匹配，请退出程序并重新启动新版 Micro Windows。');}
    return {id,expires:session.expires,guarded:session.guarded,confirmRequired:true};
  }
  async confirm(client,id,revision){
    this.touch(client);const s=this.session;
    if(!s||s.client!==client||s.id!==id||Date.now()>=s.expires)throw new Error('录入已结束，请重新开始。');
    if(!Number.isInteger(revision)||s.candidate?.revision!==revision||s.candidate.error)throw new Error('组合键已变化，请核对当前预览后再次确认。');
    if(s.result){if(s.result.error)throw new Error(s.result.error);return s.result;}
    if(s.progress?.holding)throw new Error('请先松开所有按键，再点击使用此组合。');
    if(s.confirming)throw new Error('正在确认，请稍候。');
    const pending=s.confirming={revision,error:null};
    try{
      try{this.send({op:'confirm',id,revision});}catch(e){this.cancel(client,id);throw e;}
      const until=Date.now()+2500;while(this.session===s&&!s.result&&!pending.error&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
      if(this.session!==s)throw new Error('录入已取消。');
      if(pending.error)throw new Error(pending.error);
      if(!s.result){this.cancel(client,id);throw new Error('录入确认超时，已停止拦截，请重新录入。');}
      if(s.result.error)throw new Error(s.result.error);
      return s.result;
    }finally{if(s.confirming===pending)s.confirming=null;}
  }
  cancel(client,id){if(this.session?.client!==client||this.session.id!==id)return;try{this.send({op:'cancel',id});}catch{}this.session=null;}
  async state(client){
    this.touch(client);
    return {ready:this.ready,error:this.error,recording:this.session?.client===client?this.session:null,simulation:this.simulation};
  }
  tick(){
    const now=Date.now();for(const [id,time] of this.clients)if(now-time>7000)this.clients.delete(id);
    if(this.session&&(!this.clients.has(this.session.client)||now>this.session.expires))this.cancel(this.session.client,this.session.id);
    if(this.native){if(this.clients.size)try{this.send({op:'heartbeat'});}catch{}else this.stop();}
  }
  stop(){const child=this.native;this.native=null;this.ready=false;this.session=null;if(child){try{child.stdin.end('{"op":"quit"}\n');}catch{}const timer=setTimeout(()=>{if(child.exitCode===null)child.kill();},1500);timer.unref();}}
  close(){clearInterval(this.timer);this.clients.clear();this.stop();}
}
