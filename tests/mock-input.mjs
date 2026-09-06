// Explicit simulation only. No Windows input APIs or actual device access.
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
if(process.env.MICRO_WINDOWS_TEST!=='1')throw new Error('Mock input requires MICRO_WINDOWS_TEST=1');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let record=null,last=null,candidate=null,holding=false,revision=0,recordStarted=0;
emit({kind:'status',ready:true,error:null});
createInterface({input:process.stdin}).on('line',line=>{
  const c=JSON.parse(line);if(c.op==='quit')process.exit(0);
  if(c.op==='record'){record=c.id;candidate=null;holding=false;revision=0;recordStarted=Date.now();emit({kind:'recording',id:record,guarded:true,confirmRequired:true});}
  if(c.op==='confirm'){
    if(c.id!==record||holding||!candidate||candidate.error||c.revision!==candidate.revision)emit({kind:'confirm-rejected',id:c.id,revision:c.revision,error:'请松开按键并核对当前预览。'});
    else{emit({kind:'recorded',id:record,...candidate});record=null;}
  }
  if(c.op==='cancel'&&c.id===record)record=null;
}).on('close',()=>process.exit(0));
setInterval(async()=>{
  if(!process.env.MICRO_WINDOWS_INPUT_EVENTS)return;
  try{const event=JSON.parse(await readFile(process.env.MICRO_WINDOWS_INPUT_EVENTS,'utf8'));if(!event.id||event.id===last)return;last=event.id;
    if(typeof event.id==='number'&&event.id<recordStarted)return;
    if(event.progress&&record){holding=event.progress.holding;emit({kind:'progress',id:record,...event.progress});}
    if(event.candidate&&record){candidate={revision:++revision,...event.candidate};holding=false;emit({kind:'candidate',id:record,...candidate});}
    if(event.recorded&&record){emit({kind:'recorded',id:record,...event.recorded});record=null;}
    if(event.status)emit({kind:'status',...event.status});
  }catch{}
},100);
