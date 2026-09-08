import {destination,controlForCode} from './model.mjs';
import {windowsEvent} from './vendor.mjs';

// A direction owns its timer and output until neutral, a mode change, or disconnect.
export class ActionOutput {
  constructor(send){this.send=send;this.held=new Map();}
  input(event,bindings,motion){
    if(!event.down){this.up(event.code);return;}
    if(this.held.has(event.code))return;
    const entry=Object.entries(bindings).find(([,b])=>b.source.code===event.code);
    const id=entry?.[0]||controlForCode[event.code];if(!id)return;let binding=entry?.[1];
    const reverse=id.startsWith('dial_')?motion.dialReverse:id.startsWith('stick_')?motion.stickReverse:false;
    if(reverse){const opposite={dial_cw:'dial_ccw',dial_ccw:'dial_cw',stick_up:'stick_down',stick_down:'stick_up',stick_left:'stick_right',stick_right:'stick_left'}[id];if(opposite)binding=bindings[opposite];}
    if(!binding)return;
    const output=windowsEvent(destination(binding));if(!output)return;
    const options=binding.behavior||{},pulse=output.op==='scroll'||options.repeat===true||id.startsWith('stick_')&&options.once===true;
    const record={output,timer:null,pulse};this.held.set(event.code,record);
    const fire=()=>{if(output.op==='scroll')this.send(output);else{this.send({...output,id:event.code,down:true});if(pulse)this.send({...output,id:event.code,down:false});}};
    fire();
    if(options.repeat===true){record.timer=setTimeout(()=>{if(!this.held.has(event.code))return;fire();record.timer=setInterval(fire,options.interval??100);},options.delay??400);}
  }
  up(code){const record=this.held.get(code);if(!record)return;clearTimeout(record.timer);clearInterval(record.timer);if(!record.pulse)this.send({...record.output,id:code,down:false});this.held.delete(code);}
  release(){for(const r of this.held.values()){clearTimeout(r.timer);clearInterval(r.timer);}this.held.clear();this.send({op:'release'});}
}
