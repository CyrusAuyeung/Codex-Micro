// Test fixture only. This program never opens hardware or injects keyboard input.
import {readFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
if(process.env.MICRO_WINDOWS_TEST!=='1')throw new Error('Fixture requires explicit simulation mode');
const file=process.env.MICRO_WINDOWS_FIXTURE,log=process.env.MICRO_WINDOWS_COMMANDS;
let settings=JSON.parse(readFileSync(file,'utf8')),generation=1,captured=false,sequence=settings.sequence;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const status=()=>emit({kind:'status',connected:settings.connected!==false,captured,canPost:true,generation,device:{product:'模拟 Codex Micro',vendor_id:12346,product_id:33632,location_id:settings.device||'fixture-1',usage_page:65280,usage:1,input_length:64}});
function report(act=2){if(!captured||settings.connected===false)return;const bytes=Buffer.from(JSON.stringify({m:'v.oai.hid',p:{k:settings.code||'AG00',act}}));for(let i=0;i<bytes.length;i+=40){const p=[...bytes.subarray(i,i+40)];emit({kind:'report',generation,data:[6,2,p.length,...p]});}}
status();
const timer=setInterval(()=>{let next;try{next=JSON.parse(readFileSync(file,'utf8'));}catch{return;}if(next.sequence===sequence)return;sequence=next.sequence;const reconnect=next.device!==settings.device||next.connected!==settings.connected;settings=next;if(reconnect){captured=false;generation++;status();}if(settings.tap)report(settings.act??2);},40);
createInterface({input:process.stdin}).on('line',line=>{
  const c=JSON.parse(line);if(c.op!=='heartbeat'&&log)appendFileSync(log,JSON.stringify(c)+'\n');
  if(c.op==='capture'){
    const ok=!c.value||(!settings.deny&&settings.connected!==false);
    if(ok){if(Boolean(c.value)!==captured)generation++;captured=Boolean(c.value);}status();emit({kind:'ack',requestId:c.requestId,ok,error:ok?null:'模拟设备被占用'});
    if(ok&&c.value&&settings.autoTap!==false)setTimeout(()=>report(),60);
  }else if(c.op==='quit'){clearInterval(timer);process.exit(0);}
}).on('close',()=>{clearInterval(timer);process.exit(0);});
