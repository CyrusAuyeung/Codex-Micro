import {readFile,writeFile,mkdir,rename,copyFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateBindings} from './model.mjs';

export const defaultMotion=Object.freeze({dialReverse:false,stickReverse:false,engage:.55,release:.30});
export function validateMotion(value=defaultMotion){
  if(!value||typeof value!=='object'||typeof value.dialReverse!=='boolean'||typeof value.stickReverse!=='boolean'||!Number.isFinite(value.engage)||!Number.isFinite(value.release)||value.engage<.2||value.engage>.95||value.release<.05||value.release>=value.engage)throw new Error('摇杆触发阈值应为 0.20–0.95，回中阈值应为 0.05 至触发阈值之间。');
  return {...defaultMotion,...value};
}
export function profileName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>40)throw new Error('配置名称需要 1–40 个字符。');return name.trim();}
export function normalizeStore(raw){
  if(!raw||typeof raw.enabled!=='boolean')throw new Error('配置启用状态无效，原文件已保留。');
  if(raw.version===1){validateBindings(raw.bindings);const id=randomUUID();raw={version:2,device:raw.device||null,enabled:raw.enabled,activeProfileId:id,profiles:[{id,name:'当前配置',bindings:raw.bindings,motion:{...defaultMotion}}]};}
  if(raw.version!==2||!Array.isArray(raw.profiles)||!raw.profiles.length||raw.profiles.length>100)throw new Error('配置版本或方案数量无效。');
  const ids=new Set();const profiles=raw.profiles.map(p=>{
    if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)||ids.has(p.id))throw new Error('配置方案标识无效或重复。');ids.add(p.id);
    return {id:p.id,name:profileName(p.name),bindings:structuredClone(validateBindings(p.bindings)),motion:validateMotion(p.motion)};
  });
  const active=profiles.find(p=>p.id===raw.activeProfileId);if(!active)throw new Error('当前方案不存在。');
  return {version:2,device:raw.device||null,enabled:raw.enabled,activeProfileId:active.id,profiles,bindings:active.bindings,motion:active.motion};
}
export class ProfileStore {
  constructor(data){this.file=path.join(data,'bindings.json');this.backups=path.join(data,'backups');this.state=null;}
  async init(){
    await mkdir(this.backups,{recursive:true});let raw;
    try{raw=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('配置无法读取，原文件已保留：'+e.message);raw={version:1,bindings:{},device:null,enabled:false};}
    this.state=normalizeStore(raw);if(raw.version===1)await this.save(this.state,'升级至 2.1 · 迁移旧配置');return this.state;
  }
  async save(next,reason='应用配置'){
    // Top-level bindings and motion are the active-profile view used by the runtime.
    const source=structuredClone(next);const active=source.profiles.find(p=>p.id===source.activeProfileId);
    if(active){active.bindings=source.bindings;active.motion=source.motion;}
    const clean=normalizeStore(source);
    const id=Date.now()+'.'+randomUUID();
    try{await copyFile(this.file,path.join(this.backups,id+'.json'));await writeFile(path.join(this.backups,id+'.meta.json'),JSON.stringify({reason,time:Date.now()}));}catch(e){if(e.code!=='ENOENT')throw e;}
    const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(clean,null,2)+'\n');await rename(temp,this.file);this.state=clean;return clean;
  }
  view(state=this.state){return {activeProfileId:state.activeProfileId,profiles:state.profiles.map(p=>({id:p.id,name:p.name,bindingCount:Object.keys(p.bindings).length})),motion:state.motion};}
  export(all=false){return {format:'micro-windows-codex-profiles',version:1,exportedAt:new Date().toISOString(),profiles:structuredClone(all?this.state.profiles:this.state.profiles.filter(p=>p.id===this.state.activeProfileId))};}
  import(data){
    if(data?.format!=='micro-windows-codex-profiles'||data.version!==1||!Array.isArray(data.profiles)||!data.profiles.length)throw new Error('请选择 Micro Windows 的 Codex 配置文件。');
    const names=new Set(this.state.profiles.map(p=>p.name));
    const imported=data.profiles.map(p=>{const base=profileName(p.name);let name=base,index=1;while(names.has(name))name=base.slice(0,28)+'（导入 '+index+++'）';names.add(name);return {id:randomUUID(),name,bindings:p.bindings,motion:p.motion};});
    const next=structuredClone(this.state);next.profiles.push(...imported);normalizeStore(next);return next;
  }
  async listBackups(){
    const files=(await readdir(this.backups)).filter(f=>/^[0-9]+\.[a-f0-9-]+\.json$/.test(f)).sort().reverse();
    const result=[];for(const file of files){try{const s=await stat(path.join(this.backups,file));let meta={};try{meta=JSON.parse(await readFile(path.join(this.backups,file.replace('.json','.meta.json')),'utf8'));}catch{}result.push({id:file,time:meta.time||s.mtimeMs,reason:meta.reason||'历史配置备份'});}catch{}}
    return result;
  }
  async readBackup(id){if(typeof id!=='string'||!/^[0-9]+\.[a-f0-9-]+\.json$/.test(id))throw new Error('备份标识无效。');return normalizeStore(JSON.parse(await readFile(path.join(this.backups,id),'utf8')));}
}
