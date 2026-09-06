using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class MicroHID {
    private static readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=65536 };
    private static readonly object emitLock=new object(),gate=new object();
    private static readonly KeyboardOutput keyboard=new KeyboardOutput();
    private static DeviceInfo device;
    private static List<DeviceInfo> inventory=new List<DeviceInfo>();
    private static SafeFileHandle handle;
    private static Thread reader;
    private static ManualResetEvent readerClosed;
    private static int generation;
    private static bool captured,wanted,stopping;
    private static string error;
    private static DateTime heartbeat=DateTime.UtcNow;
    private static void Emit(object value){lock(emitLock)Console.WriteLine(json.Serialize(value));}
    private static void Status(){Emit(new{kind="status",connected=device!=null,captured=captured,canPost=true,generation=generation,device=device==null?null:device.Public(),error=error,devices=inventory.Select(d=>d.Public()).ToArray()});}
    private static string Get(Dictionary<string,object> c,string key){object value;return c.TryGetValue(key,out value)?Convert.ToString(value):null;}
    private static void StopRead() {
        captured=false;generation++;keyboard.Release();
        if(handle!=null){try{Hid.CancelIoEx(handle,IntPtr.Zero);}catch{}handle=null;if(readerClosed.WaitOne(1500))readerClosed.Dispose();}
    }
    private static bool Open() {
        if(captured)return true;
        if(device==null){error="没有找到 Codex 模式的独立 HID 接口。";return false;}
        var h=Hid.CreateFile(device.Path,Hid.Read,0,IntPtr.Zero,3,Hid.Overlapped,IntPtr.Zero);
        if(h.IsInvalid){int code=Marshal.GetLastWin32Error();h.Dispose();error="无法独占接收小键盘（Windows 错误 "+code+"）。请关闭占用此设备的其它控制程序后重试。";return false;}
        handle=h;captured=true;error=null;int gen=++generation;int length=device.InputLength;
        var closed=new ManualResetEvent(false);readerClosed=closed;
        reader=new Thread(()=>ReadLoop(h,length,gen,closed)){IsBackground=true};reader.Start();return true;
    }
    private static void ReadLoop(SafeFileHandle h,int length,int gen,ManualResetEvent closed) {
        IntPtr buffer=Marshal.AllocHGlobal(length),overlap=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Hid.Overlap)));
        IntPtr signal=Hid.CreateEvent(IntPtr.Zero,true,false,null);
        string failure=null;
        try {
            while(!stopping && gen==generation && !h.IsClosed) {
                Hid.ResetEvent(signal);Marshal.StructureToPtr(new Hid.Overlap { Event=signal },overlap,false);
                uint count;bool completed=Hid.ReadFile(h,buffer,(uint)length,out count,overlap);
                if(!completed) {
                    int code=Marshal.GetLastWin32Error();if(code!=997)throw new System.ComponentModel.Win32Exception(code);
                    while(Hid.WaitForSingleObject(signal,250)==258 && !stopping && gen==generation && !h.IsClosed){}
                    if(h.IsClosed||stopping||gen!=generation)break;
                    if(!Hid.GetOverlappedResult(h,overlap,out count,false))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }
                if(count==0||count>length)continue;
                var data=new byte[count];Marshal.Copy(buffer,data,0,(int)count);
                Emit(new {kind="report",generation=gen,data=data.Select(b=>(int)b).ToArray()});
            }
        }catch(Exception e){if(!h.IsClosed&&!stopping)failure=e.Message;}
        finally {
            // Cancel and finish pending I/O before freeing its native buffers.
            if(!h.IsClosed){try{Hid.CancelIoEx(h,overlap);uint ignored;Hid.GetOverlappedResult(h,overlap,out ignored,true);}catch{}}
            h.Dispose();closed.Set();Hid.CloseHandle(signal);Marshal.FreeHGlobal(overlap);Marshal.FreeHGlobal(buffer);
            lock(gate){if(generation==gen){StopRead();error="蓝牙接收已断开"+(failure==null?"。":"："+failure);device=null;Status();}}
        }
    }
    private static void Refresh() {
        lock(gate) {
            if(stopping)return;
            if((DateTime.UtcNow-heartbeat).TotalSeconds>7){wanted=false;StopRead();error="面板心跳已停止，已释放小键盘。";Status();return;}
            if(captured)return;
            try {
                inventory=Hid.Inventory();
                var candidates=inventory.Where(d=>d.Page>=0xFF00&&d.InputLength>=4&&d.InputLength<=4096).ToArray();
                DeviceInfo next=candidates.Length==1?candidates[0]:null;
                string nextError=candidates.Length>1?"发现多个 Codex HID 接口，请只连接一只小键盘。":next==null?(inventory.Count>0?"当前未发现独立 HID 通道。请将小键盘切到青灯 Codex 模式并连接蓝牙。":"未找到小键盘。请在 Windows 蓝牙设置中连接 Codex Micro。"):null;
                bool changed=(device==null?null:device.Id)!=(next==null?null:next.Id)||error!=nextError;
                device=next;if(!wanted)error=nextError;
                if(wanted&&device!=null)Open();
                if(changed||wanted)Status();
            }catch(Exception e){error="设备检查失败："+e.Message;Status();}
        }
    }
    private static void Command(Dictionary<string,object> c) {
        string op=Get(c,"op");
        lock(gate) {
            if(op=="heartbeat"){heartbeat=DateTime.UtcNow;return;}
            if(op=="release"){keyboard.Release();return;}
            if(op=="capture") {
                if(!(c.ContainsKey("value")&&c["value"] is bool))throw new ArgumentException("Invalid capture flag");
                bool value=(bool)c["value"];wanted=value;bool ok=true;
                if(value){ok=Open();if(!ok)wanted=false;}else{StopRead();error=null;}
                Status();Emit(new{kind="ack",requestId=Get(c,"requestId"),ok=ok,error=error});return;
            }
            if(op=="key") {
                if(!captured)return;
                object[] mods=c.ContainsKey("modifiers")?(object[])c["modifiers"]:new object[0];
                keyboard.Set(Get(c,"id"),Convert.ToInt32(c["code"]),mods.Select(Convert.ToInt32).ToArray(),(bool)c["down"]);return;
            }
            if(op=="quit"){stopping=true;StopRead();return;}
            throw new ArgumentException("Unknown command");
        }
    }
    private static int Main(string[] args) {
        Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=new UTF8Encoding(false);
        if(args.Contains("--list")){Emit(Hid.Inventory().Select(d=>d.Public()).ToArray());return 0;}
        if(args.Contains("--self-test")){KeyboardOutput.SelfTest();Emit(new{ok=true,tests="modifier sharing, physical key preservation, failure cleanup, native ABI; no keys injected"});return 0;}
        Refresh();using(var timer=new Timer(_=>Refresh(),null,1500,1500)) {
            string line;
            while(!stopping&&(line=Console.ReadLine())!=null) {
                if(line.Length>16000)continue;
                try{Command((Dictionary<string,object>)json.DeserializeObject(line));}
                catch(Exception e){keyboard.Release();Emit(new{kind="output-error",error=e.Message});}
            }
            lock(gate){stopping=true;StopRead();}
        }
        return 0;
    }
}
