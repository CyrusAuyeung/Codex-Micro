import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function mockDevice(port=0){
  const state={mapping:{mod:Array(16).fill(0),key:Array(16).fill('0x28'),firmware:'simulated',extra:{preserve:true}},posts:[],mode:'ok'};
  state.mapping.mod[1]=1;state.mapping.key[1]='0x06';state.mapping.mod[2]=1;state.mapping.key[2]='0x19';
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/'){
      if(state.mode==='redirect'){res.writeHead(302,{Location:'http://192.168.4.1/'});res.end();return;}
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<title>'+ (state.mode==='wrong-page'?'Codex Micro OTA 固件更新':'Codex Micro 键位配置')+'</title><p>/api/mapping</p>');return;
    }
    if(req.url==='/test-status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({posts:state.posts.length,mapping:state.mapping,mode:state.mode}));return;}
    if(req.url!=='/api/mapping'){res.writeHead(404);res.end();return;}
    if(req.method==='GET'){
      res.setHeader('Content-Type','application/json');
      if(state.mode==='invalid-json'){res.end('not json');return;}
      if(state.mode==='incomplete'){res.end(JSON.stringify({mod:[0],key:['0x28']}));return;}
      res.end(JSON.stringify(state.mapping));return;
    }
    if(req.method!=='POST'){res.writeHead(405);res.end();return;}
    let text='';for await(const b of req)text+=b;
    const value=JSON.parse(text);state.posts.push(value);
    if(state.mode==='reject'){res.writeHead(500);res.end('{"ok":false}');return;}
    if(state.mode!=='no-apply')state.mapping=value;
    if(state.mode==='drop'){req.socket.destroy();return;}
    res.setHeader('Content-Type','application/json');res.end('{"ok":true}');
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {state,server,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.MICRO_WINDOWS_TEST!=='1')throw new Error('此模拟设备仅用于测试。');
  const mock=await mockDevice(Number(process.env.MICRO_MOCK_DEVICE_PORT||18417));console.log('SIMULATED keyboard: '+mock.origin+' (never accesses hardware)');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>mock.close().then(()=>process.exit(0)));
}
