import {readFile,writeFile,mkdir,rename,copyFile,readdir,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {profileName} from './profiles.mjs';
const C=createRequire(import.meta.url)('./public/mapping-core.js');
const empty=()=>({mod:Array(16).fill(null),key:Array(16).fill(null)});
export function ordinaryMapping(value){const mapping=C.validate(value,true);return {mod:[...mapping.mod],key:mapping.key.map(k=>k===null?null:C.hex(C.keyNumber(k)))};}
export function normalizeOrdinary(raw){
  if(raw?.version!==1||!Array.isArray(raw.profiles)||!raw.profiles.length||raw.profiles.length>100)throw new Error('普通模式配置文件或数量无效。');
  const ids=new Set(),profiles=raw.profiles.map(p=>{if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)||ids.has(p.id))throw new Error('配置标识无效或重复。');ids.add(p.id);return {id:p.id,name:profileName(p.name),mapping:ordinaryMapping(p.mapping)};});
  if(!ids.has(raw.activeProfileId))throw new Error('当前普通模式配置不存在。');return {version:1,activeProfileId:raw.activeProfileId,profiles};
}
export class OrdinaryProfiles{
  constructor(data){this.data=data;this.file=path.join(data,'ordinary-profiles.json');this.backups=path.join(data,'ordinary-backups');this.state=null;}
  async init(){
    await mkdir(this.backups,{recursive:true});let raw;
    try{raw=JSON.parse(await readFile(this.file,'utf8'));}catch(e){
      if(e.code!=='ENOENT')throw new Error('普通模式配置无法读取，原文件已保留：'+e.message);
      let mapping=empty();try{mapping=ordinaryMapping(JSON.parse(await readFile(path.join(this.data,'device-config/last-read.json'),'utf8')).mapping);}catch{}
      const id=randomUUID();raw={version:1,activeProfileId:id,profiles:[{id,name:'当前配置',mapping}]};await writeFile(this.file,JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
    }
    this.state=normalizeOrdinary(raw);return this.state;
  }
  active(){return this.state.profiles.find(p=>p.id===this.state.activeProfileId);}
  view(raw=this.state){const state=normalizeOrdinary(raw);return {activeProfileId:state.activeProfileId,profiles:state.profiles.map(p=>({id:p.id,name:p.name,bindingCount:16-C.missing(p.mapping).length})),mapping:state.profiles.find(p=>p.id===state.activeProfileId).mapping};}
  async save(raw,reason){
    const clean=normalizeOrdinary(raw),id=Date.now()+'.'+randomUUID();
    try{await copyFile(this.file,path.join(this.backups,id+'.json'));await writeFile(path.join(this.backups,id+'.meta.json'),JSON.stringify({reason,time:Date.now()}));}catch(e){if(e.code!=='ENOENT')throw e;}
    const temporary=this.file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(clean,null,2)+'\n');await rename(temporary,this.file);this.state=clean;return this.view();
  }
  async change({operation,id,name,mapping}){
    const next=structuredClone(this.state),active=next.profiles.find(p=>p.id===next.activeProfileId);
    if(['create','copy','rename'].includes(operation)&&next.profiles.some(p=>p.name===name?.trim()&&(operation!=='rename'||p.id!==active.id)))throw new Error('这个配置名称已存在，请换一个名称。');
    if(operation==='save')active.mapping=ordinaryMapping(mapping);
    else if(operation==='create'||operation==='copy')next.profiles.push({id:randomUUID(),name:profileName(name),mapping:operation==='copy'?structuredClone(active.mapping):empty()});
    else if(operation==='rename')active.name=profileName(name);
    else if(operation==='delete'){if(next.profiles.length===1)throw new Error('至少保留一套配置。');next.profiles=next.profiles.filter(p=>p.id!==active.id);next.activeProfileId=next.profiles[0].id;}
    else if(operation==='switch'){if(!next.profiles.some(p=>p.id===id))throw new Error('配置不存在。');next.activeProfileId=id;}
    else if(operation!=='backup')throw new Error('未知配置操作。');
    return this.save(next,{save:'保存配置',create:'新建配置',copy:'复制配置',rename:'重命名配置',delete:'删除前备份',switch:'切换配置',backup:'手动备份'}[operation]);
  }
  export(all=false){return {format:'micro-windows-ordinary-profiles',version:1,exportedAt:new Date().toISOString(),profiles:structuredClone(all?this.state.profiles:[this.active()])};}
  async import(value){
    let entries;
    if(value?.format==='micro-windows-ordinary-profiles'){if(value.version!==1||!Array.isArray(value.profiles)||!value.profiles.length)throw new Error('配置文件无效。');entries=value.profiles;}
    else{if(value?.format==='micro-windows-codex-profiles')throw new Error('这是 Codex 模式配置，请切到 Codex 模式导入。');entries=[{name:'导入配置',mapping:C.parseImport(JSON.stringify(value)).mapping}];}
    const next=structuredClone(this.state),names=new Set(next.profiles.map(p=>p.name));
    for(const entry of entries){const base=profileName(entry.name);let name=base,index=1;while(names.has(name))name=base.slice(0,28)+'（导入 '+index+++'）';names.add(name);next.profiles.push({id:randomUUID(),name,mapping:ordinaryMapping(entry.mapping)});}
    return this.save(next,'导入配置');
  }
  async listBackups(){
    const files=(await readdir(this.backups)).filter(f=>/^[0-9]+\.[a-f0-9-]+\.json$/.test(f)).sort().reverse(),result=[];
    for(const id of files){const info=await stat(path.join(this.backups,id));let meta={};try{meta=JSON.parse(await readFile(path.join(this.backups,id.replace('.json','.meta.json')),'utf8'));}catch{}result.push({id,time:meta.time||info.mtimeMs,reason:meta.reason||'历史配置备份'});}return result;
  }
  async readBackup(id){if(typeof id!=='string'||!/^\d+\.[a-f0-9-]+\.json$/.test(id))throw new Error('备份标识无效。');return normalizeOrdinary(JSON.parse(await readFile(path.join(this.backups,id),'utf8')));}
  async restore(id){return this.save(await this.readBackup(id),'恢复前备份');}
}
