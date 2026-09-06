import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const validId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/i.test(s);
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
    if(this.simulation&&!this.fixture){this.error='模拟环境未连接实体键盘，组合键可使用网页录入。';return;}
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
    if(m.kind==='recording'&&this.session?.id===m.id){this.session.armed=true;this.session.guarded=m.guarded===true;}
    if(m.kind==='recorded'&&this.session?.id===m.id&&!this.session.result&&Date.now()<this.session.expires){
      if(m.error)this.session.result={id:m.id,error:String(m.error)};
      else if(Number.isInteger(m.mod)&&m.mod>=0&&m.mod<=255&&Number.isInteger(m.key)&&m.key>0&&m.key<=65535)this.session.result={id:m.id,mod:m.mod,key:m.key};
    }
  }
  async begin(client,id){
    this.touch(client);if(!validId(id))throw new Error('无效的录入会话。');
    if(this.session&&!this.session.result&&this.session.expires>Date.now()&&this.session.client!==client)throw new Error('另一个页面正在录入组合键，请先结束那次录入。');
    this.start();
    if(this.session&&!this.session.result)try{this.send({op:'cancel',id:this.session.id});}catch{}
    const session=this.session={client,id,expires:Date.now()+21000,result:null,armed:false,guarded:false};
    const readyUntil=Date.now()+2500;while(this.session===session&&!this.ready&&Date.now()<readyUntil&&!this.error)await new Promise(r=>setTimeout(r,25));
    if(this.session!==session)throw new Error('录入已取消。');
    if(!this.ready){const message=this.error||'Windows 按键检测正在启动，请稍后再试。';this.cancel(client,id);throw new Error(message);}
    this.send({op:'record',id});
    const until=Date.now()+2500;while(this.session===session&&!session.armed&&!session.result&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
    if(this.session!==session)throw new Error('录入已取消。');
    if(!session.armed){const message=session.result?.error||'Windows 快捷键拦截未就绪，请重试或手动选择。';this.cancel(client,id);throw new Error(message);}
    return {id,expires:session.expires,guarded:session.guarded};
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
