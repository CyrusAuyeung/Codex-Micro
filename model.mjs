import {validateVendorSource,virtualKeys,windowsModifiers,windowsEvent} from './vendor.mjs';
export const MODIFIERS=windowsModifiers;
const positions=[[0,1],[0,2],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2],[2,3],[3,1],[3,2],[3,3]];
export const controls=positions.map(([row,col],i)=>({id:`key${i+1}`,label:`按键 ${i+1}`,short:String(i+1).padStart(2,'0'),kind:'key',row,col}));
controls.push({id:'dial_ccw',label:'旋钮 · 向左转',kind:'dial'},{id:'dial_cw',label:'旋钮 · 向右转',kind:'dial'},{id:'dial_press',label:'旋钮 · 按下',kind:'dial',optional:true},{id:'stick_up',label:'摇杆 · 上',kind:'stick'},{id:'stick_down',label:'摇杆 · 下',kind:'stick'},{id:'stick_left',label:'摇杆 · 左',kind:'stick'},{id:'stick_right',label:'摇杆 · 右',kind:'stick'},{id:'stick_press',label:'摇杆 · 按下',kind:'stick',optional:true},{id:'touch',label:'触摸点',kind:'touch',optional:true,row:3,col:0});
export const controlForCode={...Object.fromEntries(Array.from({length:13},(_,i)=>[(i<6?'AG':'ACT')+String(i).padStart(2,'0'),'key'+(i+1)])),ENC_CW:'dial_cw',ENC_CC:'dial_ccw',ENC:'dial_press',RAD_UP:'stick_up',RAD_DOWN:'stick_down',RAD_LEFT:'stick_left',RAD_RIGHT:'stick_right'};
const key=(key_code,modifiers=[])=>({key_code,...(modifiers.length?{modifiers}:{})});
export const actions=[
  {id:'original',label:'未设置功能',group:'基本',to:null},
  ...[['copy','复制','c'],['paste','粘贴','v'],['cut','剪切','x'],['undo','撤销','z'],['redo','重做','y'],['select_all','全选','a'],['save','保存','s'],['find','查找','f']].map(([id,label,k])=>({id,label,group:'编辑',to:key(k,['left_control'])})),
  ...[['enter','回车','return_or_enter'],['escape','退出 / Esc','escape'],['backspace','退格删除','delete_or_backspace'],['space','空格','spacebar']].map(([id,label,k])=>({id,label,group:'基本',to:key(k)})),
  {id:'shot_area',label:'截取选定区域',group:'Windows',to:key('s',['left_win','left_shift'])},
  {id:'shot_full',label:'截图并保存',group:'Windows',to:key('print_screen',['left_win'])},
  {id:'search',label:'Windows 搜索',group:'Windows',to:key('s',['left_win'])},
  {id:'task_view',label:'任务视图',group:'Windows',to:key('tab',['left_win'])},
  {id:'desktop',label:'显示桌面',group:'Windows',to:key('d',['left_win'])},
  {id:'switch_app',label:'切换窗口',group:'Windows',to:key('tab',['left_alt'])},
  ...[['volume_up','调高音量','volume_increment'],['volume_down','调低音量','volume_decrement'],['mute','静音 / 取消静音','mute'],['play','播放 / 暂停','play_or_pause'],['next_track','下一曲','scan_next_track'],['previous_track','上一曲','scan_previous_track']].map(([id,label,k])=>({id,label,group:'声音',to:{consumer_key_code:k}})),
  ...[['scroll_up','向上滚动','vertical',1],['scroll_down','向下滚动','vertical',-1],['scroll_left','向左滚动','horizontal',-1],['scroll_right','向右滚动','horizontal',1]].map(([id,label,axis,amount])=>({id,label,group:'滚动',to:{scroll:{axis,amount}}})),
  {id:'disabled',label:'禁用这个动作',group:'基本',to:key('vk_none')},
  {id:'custom',label:'自定义快捷键',group:'自定义',to:null}
];
export const keys=[...Object.keys(virtualKeys),'modifiers_only'];
export const sourceSignature=source=>`${source.type}:${source.code}:${[...(source.modifiers||[])].sort().join(',')}`;
export function destination(binding){
  const action=actions.find(a=>a.id===binding?.action);if(!action)throw new Error('请选择有效的功能。');
  if(action.to?.scroll){const step=binding.step??1;if(!Number.isInteger(step)||step<1||step>10)throw new Error('滚动步长需要 1–10。');return {scroll:{...action.to.scroll,amount:action.to.scroll.amount*step}};}
  if(action.id!=='custom')return action.to;
  const c=binding.custom;
  if(!c||!keys.includes(c.key)||!Array.isArray(c.modifiers)||c.modifiers.some(m=>!MODIFIERS.includes(m)))throw new Error('请完整选择 Windows 自定义快捷键。');
  return key(c.key,[...new Set(c.modifiers)]);
}
export function validateBindings(bindings){
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))throw new Error('配置格式无效。');
  const seen=new Map();
  for(const [id,b] of Object.entries(bindings)){
    if(!controls.some(c=>c.id===id))throw new Error('配置包含未知控件。');
    validateVendorSource(b?.source);const to=destination(b);windowsEvent(to);
    if(b.behavior){const v=b.behavior;if(typeof v.repeat!=='boolean'||(v.once!==undefined&&typeof v.once!=='boolean')||!Number.isInteger(v.delay)||v.delay<150||v.delay>2000||!Number.isInteger(v.interval)||v.interval<40||v.interval>1000)throw new Error('连发延迟需要 150–2000 毫秒，间隔需要 40–1000 毫秒。');}
    const sig=sourceSignature(b.source),value=JSON.stringify({to,behavior:b.behavior});
    if(seen.has(sig)&&seen.get(sig)!==value)throw new Error('发出相同信号的位置必须使用相同功能。');
    seen.set(sig,value);
  }
  return bindings;
}
export class CaptureCollector {
  constructor(){this.held=new Set();this.sources=new Map();this.received=0;this.events=[];}
  ingest(event){
    if(typeof event?.down!=='boolean')throw new Error('收到的按键信号无效。');
    validateVendorSource({...event,modifiers:[]});this.received++;
    if(this.events.length<64)this.events.push({code:event.code,down:event.down,type:event.type});
    if(event.down){this.held.add(event.code);const source={type:'vendor_key',code:event.code,modifiers:[]};this.sources.set(sourceSignature(source),source);}else this.held.delete(event.code);
  }
  diagnostics(){return {received:this.received,held:[...this.held],events:[...this.events]};}
  result(){if(this.held.size)return null;if(this.sources.size>1)throw new Error('本次收到了多个动作，请只操作所选位置后重新识别。');return this.sources.size?this.sources.values().next().value:null;}
}
