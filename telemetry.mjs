import {spawn} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export function systemCall(command){return new Promise((resolve,reject)=>{const p=spawn(path.join(root,'MicroSystem.Windows.exe'),[command],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';const timer=setTimeout(()=>{p.kill();reject(new Error('Windows 设备服务响应超时。'));},28000);p.stdout.on('data',b=>{out+=b;if(out.length>65536)p.kill();});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('exit',code=>{clearTimeout(timer);try{const value=JSON.parse(out.trim());if(code!==0)throw new Error(value.error||'设备服务未完成。');resolve(value);}catch(e){reject(e);}});});}
export class Telemetry {
  constructor(data,simulation){this.file=path.join(data,'device-info.json');this.simulation=simulation;this.cache={};this.live={connected:false,devices:[],identities:[]};this.updatedAt=null;this.error=null;this.busy=null;this.lastPoll=0;this.rpc=null;this.startup=false;}
  async init(){try{this.cache=JSON.parse(await readFile(this.file,'utf8'));}catch{}if(this.simulation){try{this.startup=JSON.parse(await readFile(this.file+'.startup','utf8'));}catch{}}}
  async write(){const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(this.cache));await rename(tmp,this.file);}
  signature(live=this.live){return live.ambiguous?null:(live.identities||[]).map(d=>d.name+':'+d.id).sort().join('|')||null;}
  async refresh(force=false){
    if(this.busy)return this.busy;if(!force&&Date.now()-this.lastPoll<30000)return;this.lastPoll=Date.now();
    this.busy=(async()=>{try{
      this.live=this.simulation?{connected:false,devices:[],identities:[]}:await systemCall('--battery');this.updatedAt=Date.now();this.error=this.live.error||null;
      const signature=this.signature(),device=this.live.devices?.length===1?this.live.devices[0]:null;
      if(signature&&device){if(this.cache.signature!==signature)this.cache={signature};if(Number.isInteger(device.battery)&&device.battery>=0&&device.battery<=100){this.cache.battery={value:device.battery,source:device.name+' · 蓝牙电量服务',time:Date.now()};await this.write();}}
    }catch(e){this.live={connected:false,devices:[],identities:[]};this.error=e.message;}finally{this.busy=null;}})();return this.busy;
  }
  async acceptStatus(result,identity){
    if(!result||typeof result!=='object'||!identity)return;
    const signature=this.signature();if(!signature||!this.live.connected||this.live.devices?.[0]?.name!=='Codex Micro')return;
    if(this.cache.signature!==signature)this.cache={signature};
    const time=Date.now(),source='Codex Micro · device.status';
    if(typeof result.version==='string'&&result.version.length<=100)this.cache.version={value:result.version,source,time};
    if(typeof result.is_charging==='boolean')this.cache.charging={value:result.is_charging,source,time};
    if(Number.isInteger(result.battery)&&result.battery>=0&&result.battery<=100)this.cache.battery={value:result.battery,source,time};
    this.cache.vendorId=identity;this.rpc={time,identity};await this.write();
  }
  view(native){
    const signature=this.signature(),safe=signature&&signature===this.cache.signature&&!this.live.ambiguous;
    const connected=this.live.connected,device=connected?this.live.devices?.[0]:null;
    const freshRpc=connected&&device?.name==='Codex Micro'&&native.captured&&this.rpc?.identity===native.device?.location_id&&Date.now()-this.rpc.time<45000;
    const fields={};for(const name of ['battery','version','charging']){const value=safe?this.cache[name]:null;fields[name]=value?{...value,cached:!(name==='battery'&&connected&&device?.battery!=null&&Date.now()-value.time<45000||freshRpc&&value.time===this.rpc?.time)}:null;}
    return {connected,mode:connected?(device.name==='Codex Micro KB'?'普通键盘':'Codex 模式'):null,name:device?.name||null,fields,updatedAt:this.updatedAt,busy:!!this.busy,error:this.error||device?.error||null,ambiguous:!!this.live.ambiguous,rpcAvailable:!!native.captured,simulation:this.simulation};
  }
  async startupState(){return this.simulation?{enabled:this.startup}:systemCall('--startup-state');}
  async setStartup(enabled){if(typeof enabled!=='boolean')throw new Error('开机启动设置无效。');if(this.simulation){await writeFile(this.file+'.startup',JSON.stringify(enabled));this.startup=enabled;return {enabled};}return systemCall(enabled?'--startup-on':'--startup-off');}
}
