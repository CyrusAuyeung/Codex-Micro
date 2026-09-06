export function validateVendorSource(source){
  if(source?.type!=='vendor_key'||typeof source.code!=='string'||! /^[A-Za-z0-9_]{1,40}$/.test(source.code)||!Array.isArray(source.modifiers)||source.modifiers.length)throw new Error('这个蓝牙按键信号无效，请重新识别。');
  return source;
}

export class VendorDecoder {
  constructor(){this.buffer=Buffer.alloc(0);}
  ingest(report){
    if(!Array.isArray(report)||report.some(x=>!Number.isInteger(x)||x<0||x>255))return [];
    const offset=report[0]===6?1:0;
    if(report[offset]!==2)return [];
    const length=report[offset+1];
    if(!Number.isInteger(length)||length>61||report.length<offset+2+length)return [];
    this.buffer=Buffer.concat([this.buffer,Buffer.from(report.slice(offset+2,offset+2+length))]);
    if(this.buffer.length>65536){this.buffer=Buffer.alloc(0);return [];}
    const messages=[];let depth=0,start=-1,quoted=false,escaped=false,consumed=0;
    for(let i=0;i<this.buffer.length;i++){
      const c=this.buffer[i];
      if(quoted){if(escaped)escaped=false;else if(c===92)escaped=true;else if(c===34)quoted=false;continue;}
      if(c===34)quoted=true;
      else if(c===123){if(depth++===0)start=i;}
      else if(c===125&&depth>0&&--depth===0){
        try{messages.push(JSON.parse(this.buffer.subarray(start,i+1).toString('utf8')));}catch{}
        consumed=i+1;
      }
    }
    this.buffer=this.buffer.subarray(consumed);return messages;
  }
}

export class VendorInputs {
  constructor(){this.direction=null;}
  ingest(message){
    const method=message.m??message.method,p=message.p??message.params;
    if(message.id!==undefined||!p)return [];
    const event=(code,down)=>({type:'vendor_key',code,down});
    if(method==='v.oai.hid'){
      try{validateVendorSource({type:'vendor_key',code:p.k,modifiers:[]});}catch{return [];}
      if(p.act===2)return [event(p.k,true),event(p.k,false)];
      return p.act===0||p.act===1?[event(p.k,p.act===1)]:[];
    }
    if(method!=='v.oai.rad'||!Number.isFinite(p.a)||!Number.isFinite(p.d)||p.a<0||p.a>1||p.d<0||p.d>1)return [];
    const next=p.d<(this.direction?.3:.55)?null:['RAD_RIGHT','RAD_UP','RAD_LEFT','RAD_DOWN'][Math.round(p.a*4)%4];
    if(next===this.direction)return [];
    const events=[];if(this.direction)events.push(event(this.direction,false));if(next)events.push(event(next,true));this.direction=next;return events;
  }
}

export const virtualKeys={...Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz1234567890'].map(c=>[c,c.toUpperCase().charCodeAt(0)])),...Object.fromEntries(Array.from({length:24},(_,i)=>['f'+(i+1),0x70+i])),return_or_enter:0x0D,escape:0x1B,spacebar:0x20,tab:9,delete_or_backspace:8,delete_forward:0x2E,caps_lock:0x14,up_arrow:0x26,down_arrow:0x28,left_arrow:0x25,right_arrow:0x27,home:0x24,end:0x23,page_up:0x21,page_down:0x22,insert:0x2D,print_screen:0x2C,scroll_lock:0x91,pause:0x13,num_lock:0x90,hyphen:0xBD,equal_sign:0xBB,open_bracket:0xDB,close_bracket:0xDD,backslash:0xDC,semicolon:0xBA,quote:0xDE,grave_accent_and_tilde:0xC0,comma:0xBC,period:0xBE,slash:0xBF,left_control:0xA2,right_control:0xA3,left_shift:0xA0,right_shift:0xA1,left_alt:0xA4,right_alt:0xA5,left_win:0x5B,right_win:0x5C,...Object.fromEntries(Array.from({length:10},(_,i)=>['numpad'+i,0x60+i])),numpad_add:0x6B,numpad_subtract:0x6D,numpad_multiply:0x6A,numpad_divide:0x6F,numpad_decimal:0x6E};
export const windowsModifiers=['left_control','left_shift','left_alt','left_win','right_control','right_shift','right_alt','right_win'];
export function windowsEvent(to){
  if(!to||to.key_code==='vk_none')return null;
  if(to.consumer_key_code){const code={volume_increment:0xAF,volume_decrement:0xAE,mute:0xAD,play_or_pause:0xB3,scan_next_track:0xB0,scan_previous_track:0xB1}[to.consumer_key_code];if(code===undefined)throw new Error('暂不支持这个媒体功能。');return {op:'key',code,modifiers:[]};}
  if(!Object.hasOwn(virtualKeys,to.key_code))throw new Error('暂不支持这个 Windows 按键。');
  const modifiers=to.modifiers||[];
  if(!Array.isArray(modifiers)||modifiers.some(m=>!windowsModifiers.includes(m)))throw new Error('Windows 修饰键信息无效。');
  return {op:'key',code:virtualKeys[to.key_code],modifiers:[...new Set(modifiers)].map(m=>virtualKeys[m])};
}
