(function (root) {
  'use strict';
  const POS = ['ENC','AG00','AG01','','AG02','AG03','AG04','AG05','ACT06','ACT07','ACT08','ACT09','MODE','ACT10','ACT11','ACT12'];
  const MODS = [{v:1,label:'Ctrl'},{v:2,label:'Shift'},{v:4,label:'Alt'},{v:8,label:'Win'}];
  const keys = [];
  function add(n, label, code, group) { keys.push({n:n, label:label, code:code, group:group}); }
  add(0,'无主键','', '常用');
  [[40,'Enter','Enter'],[41,'Esc','Escape'],[42,'退格','Backspace'],[43,'Tab','Tab'],[44,'空格','Space']].forEach(k=>add(k[0],k[1],k[2],'常用'));
  for(let i=0;i<26;i++) add(4+i,String.fromCharCode(65+i),'Key'+String.fromCharCode(65+i),'字母');
  for(let i=1;i<=9;i++) add(29+i,String(i),'Digit'+i,'数字');
  add(39,'0','Digit0','数字');
  for(let i=1;i<=12;i++) add(57+i,'F'+i,'F'+i,'功能键');
  for(let i=13;i<=24;i++) add(104+i-13,'F'+i,'F'+i,'功能键');
  [[45,'-','Minus'],[46,'=','Equal'],[47,'[','BracketLeft'],[48,']','BracketRight'],[49,'\\','Backslash'],[51,';','Semicolon'],[52,"'",'Quote'],[53,'反引号','Backquote'],[54,',','Comma'],[55,'.','Period'],[56,'/','Slash']].forEach(k=>add(k[0],k[1],k[2],'符号'));
  [[57,'Caps Lock','CapsLock'],[70,'Print Screen','PrintScreen'],[71,'Scroll Lock','ScrollLock'],[72,'Pause','Pause'],[73,'Insert','Insert'],[74,'Home','Home'],[75,'Page Up','PageUp'],[76,'Delete','Delete'],[77,'End','End'],[78,'Page Down','PageDown'],[79,'→','ArrowRight'],[80,'←','ArrowLeft'],[81,'↓','ArrowDown'],[82,'↑','ArrowUp'],[83,'Num Lock','NumLock']].forEach(k=>add(k[0],k[1],k[2],'导航与锁定'));
  [[84,'小键盘 /','NumpadDivide'],[85,'小键盘 *','NumpadMultiply'],[86,'小键盘 -','NumpadSubtract'],[87,'小键盘 +','NumpadAdd'],[88,'小键盘 Enter','NumpadEnter'],[98,'小键盘 0','Numpad0'],[99,'小键盘 .','NumpadDecimal']].forEach(k=>add(k[0],k[1],k[2],'小键盘'));
  for(let i=1;i<=9;i++) add(88+i,'小键盘 '+i,'Numpad'+i,'小键盘');
  const clone = value => JSON.parse(JSON.stringify(value));
  function keyNumber(value) {
    if (typeof value === 'number') return Number.isInteger(value) && value>=0 && value<=65535 ? value : null;
    if (typeof value !== 'string' || !/^(0x[0-9a-f]{1,4}|[0-9]{1,5})$/i.test(value)) return null;
    const n=Number(value); return Number.isInteger(n) && n<=65535 ? n : null;
  }
  const hex = n => '0x'+n.toString(16).toUpperCase().padStart(2,'0');
  function validate(value, allowIncomplete) {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象。');
    if (!Array.isArray(value.mod) || !Array.isArray(value.key) || value.mod.length!==16 || value.key.length!==16) throw new Error('配置必须包含 16 项 mod 和 16 项 key。');
    for(let i=0;i<16;i++) {
      if (!(allowIncomplete && value.mod[i]===null) && !(Number.isInteger(value.mod[i]) && value.mod[i]>=0 && value.mod[i]<=255)) throw new Error('#'+i+' 的修饰键数值无效。');
      if (!(allowIncomplete && value.key[i]===null) && keyNumber(value.key[i])===null) throw new Error('#'+i+' 的主键数值无效。');
    }
    return clone(value);
  }
  const missing = d => POS.map((_,i)=>i).filter(i=>d.mod[i]===null || keyNumber(d.key[i])===null);
  const equalSlot = (a,b,i) => a.mod[i]===b.mod[i] && keyNumber(a.key[i])===keyNumber(b.key[i]);
  const changed = (a,b) => POS.map((_,i)=>i).filter(i=>!equalSlot(a,b,i));
  function payload(baseline,draft,fresh) {
    validate(baseline,false); validate(draft,false); validate(fresh,false);
    const changes=changed(baseline,draft);
    const conflicts=changes.filter(i=>!equalSlot(baseline,fresh,i) && !equalSlot(draft,fresh,i));
    if(conflicts.length) throw new Error('键盘上的 '+conflicts.map(i=>'#'+i).join('、')+' 已被其他操作修改。请导出本页配置，再重新读取键盘。');
    const result=clone(fresh);
    changes.forEach(i=>{result.mod[i]=draft.mod[i]; result.key[i]=draft.key[i];});
    return result;
  }
  function keyLabel(value) {
    const n=keyNumber(value); if(n===null) return '未读取';
    const item=keys.find(k=>k.n===n); return item ? item.label : '未知键 '+hex(n);
  }
  function parts(d,i) {
    if(d.mod[i]===null || keyNumber(d.key[i])===null) return ['未读取'];
    const labels=['Ctrl','Shift','Alt','Win','右 Ctrl','右 Shift','右 Alt','右 Win'];
    const result=labels.filter((_,bit)=>(d.mod[i] & (1<<bit))!==0);
    if(keyNumber(d.key[i])!==0 || result.length===0) result.push(keyLabel(d.key[i]));
    return result;
  }
  function fromEvent(e) {
    if(e.isComposing) return {error:'正在使用输入法，请结束输入后重新录入。'};
    if(/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return {modifierOnly:true};
    const item=keys.find(k=>k.code===e.code && k.code!=='');
    if(!item) return {error:'未识别这个按键，请用下方选项手动设置。'};
    return {key:hex(item.n), mod:(e.ctrlKey?1:0)|(e.shiftKey?2:0)|(e.altKey?4:0)|(e.metaKey?8:0)};
  }
  function parseImport(text) {
    let value; try { value=JSON.parse(text); } catch (_) { throw new Error('文件不是有效的 JSON 配置。'); }
    if(value && value.format==='codex-micro-ui-draft') {
      if(value.version!==1) throw new Error('不支持这个草稿版本。');
      return {mapping:validate(value.mapping,true),draft:true};
    }
    return {mapping:validate(value,false),draft:false};
  }
  function exportValue(data) {
    validate(data,true);
    return missing(data).length ? {format:'codex-micro-ui-draft',version:1,mapping:clone(data),unknownSlots:missing(data)} : clone(data);
  }
  const api={POS:POS,MODS:MODS,KEYS:keys,clone:clone,keyNumber:keyNumber,hex:hex,validate:validate,missing:missing,equalSlot:equalSlot,changed:changed,payload:payload,keyLabel:keyLabel,parts:parts,fromEvent:fromEvent,parseImport:parseImport,exportValue:exportValue};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.MicroMapping=api;
})(globalThis);
