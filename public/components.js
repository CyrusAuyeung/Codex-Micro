const $=id=>document.getElementById(id);
export async function api(route,body){const response=await fetch(route,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Micro-Panel':'1'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成。');return result;}
export function message(text,error=false){let toast=$('shared-toast');if(!toast){toast=document.createElement('div');toast.id='shared-toast';toast.className='toast';toast.setAttribute('role','status');document.body.append(toast);}toast.textContent=text;toast.classList.toggle('error',error);toast.hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>toast.hidden=true,error?10000:4500);}
export function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ask({title,text,choices,input}){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='choice-dialog';const h=document.createElement('h2');h.textContent=title;h.id='choice-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',h.id);dialog.append(h);if(text){const p=document.createElement('p');p.textContent=text;dialog.append(p);}
    let field;if(input!==undefined){field=document.createElement('input');field.value=input;field.maxLength=40;field.setAttribute('aria-label','配置名称');dialog.append(field);}
    const row=document.createElement('div');row.className='dialog-actions';for(const choice of choices){const button=document.createElement('button');button.className='button'+(choice.primary?' primary':'');button.textContent=choice.label;button.onclick=()=>{resolve({value:choice.value,input:field?.value});dialog.close();};row.append(button);}dialog.append(row);
    dialog.addEventListener('cancel',()=>resolve({value:'cancel'}));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();if(field){field.focus();field.select();}
  });
}

const enhanced=new Map();let closeActive=null;
function enhance(select){
  if(enhanced.has(select)||select.multiple)return;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const selectedLabel=document.createElement('span');selectedLabel.className='select-label';
  const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');chevron.classList.add('select-chevron');chevron.setAttribute('viewBox','0 0 20 20');chevron.setAttribute('aria-hidden','true');chevron.setAttribute('focusable','false');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M4.5 7.25 10 12.75 15.5 7.25');chevron.append(path);trigger.append(selectedLabel,chevron);
  select.classList.add('enhanced-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(trigger);
  const sync=()=>{const label=(select.closest('.mode-view')||document).querySelector(`label[for="${CSS.escape(select.id)}"]`)?.textContent||select.getAttribute('aria-label')||'选择';selectedLabel.textContent=select.selectedOptions[0]?.textContent||'请选择';trigger.setAttribute('aria-label',label+'：'+selectedLabel.textContent);trigger.disabled=select.disabled;};enhanced.set(select,sync);sync();
  function open(){
    if(trigger.disabled)return;closeActive?.();
    const popup=document.createElement('div');popup.className='select-popup';popup.setAttribute('popover','manual');
    const search=document.createElement('input');search.type='search';search.placeholder='搜索选项…';search.setAttribute('aria-label','搜索选项');search.setAttribute('role','combobox');search.setAttribute('aria-expanded','true');search.setAttribute('aria-autocomplete','list');
    const list=document.createElement('div');list.className='select-options';list.id='options-'+crypto.randomUUID();list.setAttribute('role','listbox');list.setAttribute('aria-label',trigger.getAttribute('aria-label'));search.setAttribute('aria-controls',list.id);trigger.setAttribute('aria-controls',list.id);popup.append(search,list);
    (select.closest('dialog')||document.body).append(popup);popup.showPopover();trigger.setAttribute('aria-expanded','true');
    let options=[],index=0;
    const focus=()=>{options.forEach((b,i)=>b.classList.toggle('focused',i===index));if(options[index]){search.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}else search.removeAttribute('aria-activedescendant');};
    const close=(restore=true)=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize);popup.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');closeActive=null;if(restore)trigger.focus();};
    const outside=e=>{if(!popup.contains(e.target)&&!trigger.contains(e.target))close(false);};const resize=()=>close(false);closeActive=close;
    const choose=option=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();};
    const render=()=>{list.replaceChildren();options=[];let group=null;
      for(const option of select.options){if(option.disabled||!option.textContent.toLowerCase().includes(search.value.toLowerCase()))continue;const parent=option.parentElement.tagName==='OPTGROUP'?option.parentElement.label:null;if(parent&&parent!==group){const label=document.createElement('div');label.className='select-group';label.textContent=parent;list.append(label);group=parent;}
        const button=document.createElement('div');button.id=list.id+'-'+options.length;button.className='select-option';button.setAttribute('role','option');button.setAttribute('aria-label',option.textContent);button.setAttribute('aria-selected',String(option.selected));button.textContent=option.textContent;button.onpointerdown=e=>e.preventDefault();button.onclick=()=>choose(option);button.dataset.value=option.value;list.append(button);options.push(button);
      }if(!options.length){const empty=document.createElement('p');empty.textContent='没有匹配的选项';list.append(empty);}index=Math.max(0,options.findIndex(b=>b.dataset.value===select.value));focus();
    };
    render();const rect=trigger.getBoundingClientRect(),below=innerHeight-rect.bottom-10,above=rect.top-10,up=below<220&&above>below,height=Math.max(90,Math.min(320,up?above:below));
    popup.style.width=Math.min(Math.max(rect.width,240),innerWidth-24)+'px';popup.style.maxHeight=height+'px';popup.style.left=Math.max(12,Math.min(rect.left,innerWidth-popup.offsetWidth-12))+'px';popup.style.top=(up?Math.max(10,rect.top-popup.offsetHeight-6):rect.bottom+6)+'px';
    search.oninput=render;search.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();index=Math.max(0,Math.min(options.length-1,index+(e.key==='ArrowDown'?1:-1)));focus();}else if(e.key==='Enter'){e.preventDefault();options[index]?.click();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab')close();else if(e.key==='Home'){index=0;focus();}else if(e.key==='End'){index=options.length-1;focus();}};
    search.focus();focus();document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',resize);
  }
  trigger.onclick=()=>closeActive?closeActive():open();trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}};
  new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true});select.addEventListener('change',sync);
}
export function syncControls(){for(const select of document.querySelectorAll('select'))enhance(select);for(const sync of enhanced.values())sync();}
export function closeMenus(){closeActive?.(false);}
document.addEventListener('micro-render',syncControls);new MutationObserver(()=>{for(const select of document.querySelectorAll('select'))enhance(select);}).observe(document.body,{childList:true,subtree:true});syncControls();
