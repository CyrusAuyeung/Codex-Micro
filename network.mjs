import {networkInterfaces} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const run=promisify(execFile),helper=fileURLToPath(new URL('./MicroNetwork.Windows.exe',import.meta.url));
const target='192.168.4.1';
function ipv4(value){const parts=String(value).split('.');return parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x)&&Number(x)<=255)?parts.reduce((n,x)=>(n*256+Number(x))>>>0,0):null;}
export function localCandidates(table=networkInterfaces()){
  const result=[];
  for(const [name,entries] of Object.entries(table))for(const entry of entries){
    if(entry.family!=='IPv4'||entry.internal)continue;
    const address=ipv4(entry.address),mask=ipv4(entry.netmask),dest=ipv4(target);
    if(address===null||mask===null||mask===0||address===dest||entry.address.startsWith('169.254.'))continue;
    const inverse=(~mask)>>>0;if((inverse&(inverse+1))!==0)continue;
    if(((address&mask)>>>0)===((dest&mask)>>>0))result.push({name,address:entry.address,netmask:entry.netmask,prefix:32-Math.log2(inverse+1)});
  }
  return result.sort((a,b)=>b.prefix-a.prefix);
}
export function describeNetwork(adapters,candidates,helperError=null){
  const config=adapters.filter(a=>a.config),wifi=adapters.filter(a=>a.wireless),apipa=config.find(a=>a.dhcp&&a.addresses.length&&!a.addresses.some(x=>!x.startsWith('169.254.')));
  const candidate=candidates.find(c=>config.some(a=>a.name===c.name))||candidates[0];
  const base={checkedAt:new Date().toISOString(),target,adapters,localAddress:candidate?.address||null,interfaceName:candidate?.name||null,canRepair:false,helperError};
  if(candidate)return {...base,state:'address-ready',summary:candidate.address==='192.168.4.222'?'临时配置地址可用':'配置网段地址已就绪',detail:`通过 ${candidate.name}（${candidate.address}）访问键盘。仍需读取确认设备是否响应。`};
  if(apipa)return {...base,state:'dhcp-missing',summary:'热点已连接，IP 分配失败',canRepair:config.length===1,detail:`${apipa.name} 只有 ${apipa.addresses.join('、')||'尚未分配的 IPv4 地址'}，无法访问 ${target}。可点击“临时修复连接”，补上本次配置所需的地址。`};
  if(config.some(a=>a.dhcp&&!a.addresses.length))return {...base,state:'dhcp-pending',summary:'热点已连接，正在获取 IP',detail:'Windows 正在获取配置热点地址，请保持连接约 10 秒后重新检查。'};
  if(config.length)return {...base,state:'address-mismatch',summary:'热点已连接，IP 地址不匹配',detail:'配置热点未获得 192.168.4.x 地址。请检查此 Wi-Fi 的 IP 分配是否为自动（DHCP）；本程序不会覆盖已有静态地址。'};
  if(wifi.some(a=>a.wifiError===5))return {...base,state:'wifi-permission',summary:'无法读取 Wi-Fi 连接信息',detail:'Windows 未允许读取当前 Wi-Fi 名称。请在系统的“隐私和安全性 → 位置”中检查权限，或手动确认已连接 Codex Micro Config。'};
  if(wifi.some(a=>a.ssid==='其他 Wi-Fi'))return {...base,state:'other-network',summary:'当前连接的是其他 Wi-Fi',detail:'请连接 Codex Micro Config 配置热点后重试。热点不提供互联网；同时上网需要另一条独立连接。'};
  return {...base,state:'unknown',summary:'尚未确认配置连接',detail:'尚未检测到可直接访问 192.168.4.1 的 IPv4 地址。连接配置热点后点击“检查连接”。'};
}
export class DeviceNetwork {
  constructor({data,simulation=false}){this.file=path.join(data,'device-config','last-connection.json');this.simulation=simulation;this.last=null;this.launching=false;}
  async snapshot(){
    if(this.simulation)return this.last={checkedAt:new Date().toISOString(),state:'simulation',summary:'模拟设备连接',detail:'模拟环境不会读取或修改电脑网络。',canRepair:false,localAddress:null,adapters:[]};
    let adapters=[],helperError=null;
    if(process.platform==='win32')try{const {stdout}=await run(helper,['--status'],{windowsHide:true,timeout:4000,maxBuffer:65536,encoding:'utf8'});adapters=JSON.parse(stdout.replace(/^\uFEFF/,'' )).adapters;}catch(e){helperError=e.message;}
    const value=describeNetwork(adapters,localCandidates(),helperError);this.last=value;return value;
  }
  async record(network,extra={}){
    this.last={...network,...extra};
    try{await mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(this.last,null,2)+'\n');await rename(tmp,this.file);}catch(e){this.last.logError=e.message;}
    return this.last;
  }
  async repair(){
    if(this.simulation)throw new Error('模拟环境不允许修改真实网络。');
    if(this.launching)throw new Error('Windows 权限请求尚未结束，请完成或取消已有提示。');
    this.launching=true;
    try{
      const n=await this.snapshot();if(!n.canRepair)throw new Error(n.detail);
      try{await run(helper,['--launch-repair'],{windowsHide:true,timeout:120000,maxBuffer:16384});}
      catch(e){throw new Error(e.stderr?.trim()||'临时修复没有启动：'+e.message);}
      return {message:'临时修复已启动。几秒后点击“读取键盘”。切回其他 Wi-Fi 后会自动移除临时地址。'};
    }finally{this.launching=false;}
  }
}
