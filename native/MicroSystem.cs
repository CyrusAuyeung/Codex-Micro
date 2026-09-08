using System;
using System.Linq;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Windows.Foundation;
using Windows.Devices.Enumeration;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

// Standard battery reads and this app's per-user startup entry only.
internal static class MicroSystem {
    const string RunKey="Software\\Microsoft\\Windows\\CurrentVersion\\Run", ValueName="Micro Windows";
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static string Hash(string s){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(s))).Replace("-","").Substring(0,24);}
    static string StartupCommand(){return "\""+Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Micro Windows.exe")+"\" --background";}
    static async Task<T> Await<T>(IAsyncOperation<T> op){var task=op.AsTask();if(await Task.WhenAny(task,Task.Delay(5000))!=task){op.Cancel();throw new TimeoutException("蓝牙读取超时，请稍后重试。");}return await task;}
    static async Task<object> Battery(){
        var paired=await Await(DeviceInformation.FindAllAsync(BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)));
        var matches=paired.Where(d=>d.Name=="Codex Micro"||d.Name=="Codex Micro KB").ToArray();
        var identities=matches.Select(d=>new {name=d.Name,id=Hash(d.Id)}).ToArray();
        if(matches.Count(d=>d.Name=="Codex Micro")>1||matches.Count(d=>d.Name=="Codex Micro KB")>1)return new {identities,connected=false,ambiguous=true,error="发现多把同名键盘，暂不合并历史设备信息。"};
        var connected=new System.Collections.Generic.List<object>();
        foreach(var info in matches)using(var device=await Await(BluetoothLEDevice.FromIdAsync(info.Id))){
            if(device==null||device.ConnectionStatus!=BluetoothConnectionStatus.Connected)continue;
            int? battery=null;string error=null;
            try{
                // Service discovery uses Windows' per-device cache; the value itself is read live.
                // Re-discovering an active HID keyboard's service database can fail with ERROR_BAD_COMMAND.
                var services=await Await(device.GetGattServicesForUuidAsync(GattServiceUuids.Battery,BluetoothCacheMode.Cached));
                if(services.Status!=GattCommunicationStatus.Success)throw new Exception("电量服务暂不可读："+services.Status);
                foreach(var service in services.Services)using(service){
                    var chars=await Await(service.GetCharacteristicsForUuidAsync(GattCharacteristicUuids.BatteryLevel,BluetoothCacheMode.Cached));
                    if(chars.Status!=GattCommunicationStatus.Success)continue;
                    foreach(var ch in chars.Characteristics){var read=await Await(ch.ReadValueAsync(BluetoothCacheMode.Uncached));if(read.Status==GattCommunicationStatus.Success&&read.Value.Length==1)using(var reader=DataReader.FromBuffer(read.Value)){int b=reader.ReadByte();if(b<=100)battery=b;}}
                }
                if(!battery.HasValue)error="设备未返回有效电量。";
            }catch(Exception e){error=e.Message;}
            connected.Add(new {name=info.Name,id=Hash(info.Id),battery,error});
        }
        return new {identities,connected=connected.Count==1,ambiguous=connected.Count>1,devices=connected.ToArray(),error=connected.Count>1?"两个模式同时显示连接中，请稍后刷新。":null};
    }
    [MTAThread] static int Main(string[] args){
        Console.OutputEncoding=new UTF8Encoding(false);
        try{
            var command=args.Length==0?"--battery":args[0];
            if(command=="--self-test"){if(!StartupCommand().StartsWith("\"")||!StartupCommand().EndsWith("\" --background"))return 1;Console.WriteLine("{\"ok\":true}");return 0;}
            if(command=="--startup-state"||command=="--startup-on"||command=="--startup-off"){
                if(command=="--startup-state")using(var current=Registry.CurrentUser.OpenSubKey(RunKey)){
                    Console.WriteLine(Json.Serialize(new {enabled=current!=null&&String.Equals(current.GetValue(ValueName) as string,StartupCommand(),StringComparison.OrdinalIgnoreCase)}));return 0;
                }
                using(var key=Registry.CurrentUser.CreateSubKey(RunKey)){
                    if(command=="--startup-on")key.SetValue(ValueName,StartupCommand(),RegistryValueKind.String);
                    if(command=="--startup-off")key.DeleteValue(ValueName,false);
                    Console.WriteLine(Json.Serialize(new {enabled=String.Equals(key.GetValue(ValueName) as string,StartupCommand(),StringComparison.OrdinalIgnoreCase)}));return 0;
                }
            }
            if(command!="--battery")throw new ArgumentException("Unknown operation");
            var task=Battery();if(!task.Wait(25000))throw new TimeoutException("设备信息读取超时。");Console.WriteLine(Json.Serialize(task.Result));return 0;
        }catch(Exception e){Console.WriteLine(Json.Serialize(new {error=e.GetBaseException().Message}));return 1;}
    }
}
