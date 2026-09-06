import test from 'node:test';
import assert from 'node:assert/strict';
import {describeNetwork,localCandidates} from '../network.mjs';
import {DeviceMapping} from '../device-mapping.mjs';
const wifi=(addresses,extra={})=>({name:'WLAN',config:true,dhcp:true,wireless:true,addresses,...extra});
const entry=(address,netmask='255.255.255.0')=>({family:'IPv4',internal:false,address,netmask});
test('connected hotspot with failed DHCP is distinguished from ordinary Wi-Fi and static configuration',()=>{
  let r=describeNetwork([wifi(['169.254.243.61'])],[]);assert.equal(r.state,'dhcp-missing');assert.equal(r.canRepair,true);assert.match(r.detail,/169.254.243.61/);
  r=describeNetwork([wifi([], {dhcp:false})],[]);assert.equal(r.state,'address-mismatch');assert.equal(r.canRepair,false);
  r=describeNetwork([wifi(['10.4.159.142'],{config:false,ssid:'其他 Wi-Fi'})],[]);assert.equal(r.state,'other-network');assert.equal(r.canRepair,false);
  r=describeNetwork([wifi([],{config:false,wifiError:5})],[]);assert.equal(r.state,'wifi-permission');assert.equal(r.canRepair,false);
  r=describeNetwork([wifi([])],[]);assert.equal(r.state,'dhcp-pending');assert.equal(r.canRepair,false);
  r=describeNetwork([wifi(['169.254.2.1']),wifi(['169.254.2.2'],{name:'WLAN 2'})],[]);assert.equal(r.canRepair,false);
});
test('device requests bind only to an IPv4 address on the destination subnet, preferring the connected hotspot',()=>{
  const table={WLAN:[entry('169.254.243.61','255.255.0.0'),entry('192.168.4.222')],Internet:[entry('10.4.159.142','255.255.252.0')],VMware:[entry('192.168.190.1')],Bad:[entry('192.168.4.8','255.0.255.0')],VPN:[entry('192.168.10.3','255.255.0.0')]};
  const candidates=localCandidates(table);assert.deepEqual(candidates.map(x=>x.address),['192.168.4.222','192.168.10.3']);
  const r=describeNetwork([wifi(['169.254.243.61','192.168.4.222'])],candidates);assert.equal(r.localAddress,'192.168.4.222');assert.equal(r.state,'address-ready');assert.equal(r.canRepair,false);
});
test('overlapping VPN routes cannot hide missing DHCP or a pending address on the connected keyboard hotspot',()=>{
  const candidates=localCandidates({VPN:[entry('192.168.10.3','255.255.0.0')]});
  for(const [addresses,state,canRepair] of [[['169.254.10.20'],'dhcp-missing',true],[[],'dhcp-pending',false],[['10.20.30.40'],'address-mismatch',false]]){
    const result=describeNetwork([wifi(addresses)],candidates);
    assert.equal(result.state,state);assert.equal(result.localAddress,null);assert.equal(result.canRepair,canRepair);
  }
  const restored=describeNetwork([wifi(['192.168.4.2'])],localCandidates({VPN:[entry('192.168.10.3','255.255.0.0')],WLAN:[entry('192.168.4.2')]}));
  assert.equal(restored.localAddress,'192.168.4.2');assert.equal(restored.state,'address-ready');
});
test('failed DHCP stops before HTTP, reports evidence, and a new attempt redetects the connection',async()=>{
  const s=new DeviceMapping({data:'unused',simulation:true});let calls=[];
  s.network.snapshot=async()=>describeNetwork([wifi(['169.254.243.61'])],[]);
  s.network.record=async(n,e)=>s.network.last={...n,...e};
  s.request=async(...args)=>{calls.push(args);if(args[0]==='/')return '<title>Codex Micro 键位配置</title>/api/mapping';return JSON.stringify({mod:Array(16).fill(0),key:Array(16).fill(4)});};
  await assert.rejects(()=>s.current(),e=>e.network.state==='dhcp-missing');assert.equal(calls.length,0);
  s.network.snapshot=async()=>describeNetwork([wifi(['192.168.4.222'])],[{name:'WLAN',address:'192.168.4.222'}]);
  await s.current();assert.equal(calls.length,2);assert.ok(calls.every(c=>c[3]==='192.168.4.222'));assert.equal(s.network.last.reachable,true);
  s.network.snapshot=async()=>describeNetwork([wifi(['192.168.4.3'])],[{name:'WLAN',address:'192.168.4.3'}]);await s.current();assert.equal(calls[2][3],'192.168.4.3');
});
test('simulation never invokes Windows network repair',async()=>{
  const s=new DeviceMapping({data:'unused',simulation:true});assert.equal((await s.network.snapshot()).state,'simulation');await assert.rejects(()=>s.network.repair(),/模拟环境不允许/);
});
