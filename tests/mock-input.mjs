// Explicit simulation only. No Windows input APIs or actual device access.
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
if(process.env.MICRO_WINDOWS_TEST!=='1')throw new Error('Mock input requires MICRO_WINDOWS_TEST=1');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let record=null,last=null;
emit({kind:'status',ready:true,error:null});
createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);if(c.op==='quit')process.exit(0);if(c.op==='record'){record=c.id;emit({kind:'recording',id:record,guarded:true});}if(c.op==='cancel'&&c.id===record)record=null;}).on('close',()=>process.exit(0));
setInterval(async()=>{
  if(!process.env.MICRO_WINDOWS_INPUT_EVENTS)return;
  try{const event=JSON.parse(await readFile(process.env.MICRO_WINDOWS_INPUT_EVENTS,'utf8'));if(!event.id||event.id===last)return;last=event.id;
    if(event.recorded&&record){emit({kind:'recorded',id:record,...event.recorded});record=null;}
    if(event.status)emit({kind:'status',...event.status});
  }catch{}
},100);
