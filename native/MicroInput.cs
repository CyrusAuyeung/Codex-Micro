using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// A short-lived hook records one explicit chord. No passive keyboard monitoring.
// No keys are injected and no HID device is opened; ordinary typing is never logged.
internal static class MicroInput {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,int message,IntPtr w,IntPtr l);
    delegate IntPtr KeyboardHook(int code,IntPtr w,IntPtr l);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,KeyboardHook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly ConcurrentQueue<string> Commands=new ConcurrentQueue<string>();
    static DateTime heartbeat=DateTime.UtcNow,recordDeadline=DateTime.MinValue;
    static string recordId=null;
    static readonly KeyboardHook HookCallback=OnHook;
    static readonly Queue<object> Notifications=new Queue<object>();
    static IntPtr hook=IntPtr.Zero,recordWindow=IntPtr.Zero;
    static ChordCapture capture=null;
    static InputWindow window;
    static void Emit(object value){Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}
    static int Modifier(int vk,int scan,int flags){
        if(vk==0x10)vk=scan==0x36?0xA1:0xA0;
        if(vk==0x11)vk=(flags&2)!=0?0xA3:0xA2;
        if(vk==0x12)vk=(flags&2)!=0?0xA5:0xA4;
        switch(vk){case 0xA2:return 1;case 0xA0:return 2;case 0xA4:return 4;case 0x5B:return 8;case 0xA3:return 16;case 0xA1:return 32;case 0xA5:return 64;case 0x5C:return 128;default:return 0;}
    }
    static readonly Dictionary<int,int> ScanKeys=new Dictionary<int,int>{{1,41},{12,45},{13,46},{14,42},{15,43},{26,47},{27,48},{28,40},{39,51},{40,52},{41,53},{43,49},{51,54},{52,55},{53,56},{55,85},{57,44},{58,57},{69,83},{70,71},{71,95},{72,96},{73,97},{74,86},{75,92},{76,93},{77,94},{78,87},{79,89},{80,90},{81,91},{82,98},{83,99},{86,100},{87,68},{88,69}};
    static readonly Dictionary<int,int> ExtendedKeys=new Dictionary<int,int>{{28,88},{53,84},{71,74},{72,82},{73,75},{75,80},{77,79},{79,77},{80,81},{81,78},{82,73},{83,76}};
    static int KeyCode(int vk,int scan,int flags){
        if(vk==0x13)return 72;if(vk==0x2C)return 70;
        if(vk>=0x7C&&vk<=0x87)return 104+vk-0x7C;
        int key;if((flags&2)!=0&&ExtendedKeys.TryGetValue(scan,out key))return key;
        if(scan>=2&&scan<=11)return 30+scan-2;
        if(scan>=0x3B&&scan<=0x44)return 58+scan-0x3B;
        foreach(var row in new[]{new{start=16,text="qwertyuiop"},new{start=30,text="asdfghjkl"},new{start=44,text="zxcvbnm"}})if(scan>=row.start&&scan<row.start+row.text.Length)return 4+row.text[scan-row.start]-'a';
        if(ScanKeys.TryGetValue(scan,out key))return key;
        if(vk>=65&&vk<=90)return 4+vk-65;
        if(vk>=49&&vk<=57)return 30+vk-49;if(vk==48)return 39;
        if(vk>=0x70&&vk<=0x7B)return 58+vk-0x70;
        return 0;
    }
    sealed class ChordCapture {
        internal int Mods,Key=-1,ChordMods;internal bool Finished;
        internal int PreviewMod{get{return Key<0?Mods:ChordMods;}}
        internal int? PreviewKey{get{return Key<0?(int?)null:Key;}}
        readonly HashSet<int> blocked=new HashSet<int>();
        internal ChordCapture(int mods){Mods=mods;}
        internal bool Handle(int vk,int scan,int flags){
            bool up=(flags&1)!=0;int modifier=Modifier(vk,scan,flags),token=(scan<<9)|((flags&2)<<7)|vk;
            bool suppress;
            if(up){suppress=blocked.Remove(token);if(modifier!=0)Mods&=~modifier;}
            else{blocked.Add(token);suppress=true;if(modifier!=0)Mods|=modifier;else if(Key<0){Key=KeyCode(vk,scan,flags);ChordMods=Mods;}}
            Finished=Key>=0&&blocked.Count==0;return suppress;
        }
    }
    static void EndRecord(){if(hook!=IntPtr.Zero){UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}recordId=null;capture=null;}
    static void NotifyLater(object value){Notifications.Enqueue(value);PostMessage(window.Handle,0x8002,IntPtr.Zero,IntPtr.Zero);}
    static IntPtr OnHook(int code,IntPtr w,IntPtr l){
        if(code<0||recordId==null||capture==null)return CallNextHookEx(hook,code,w,l);
        try{
            if(GetForegroundWindow()!=recordWindow||DateTime.UtcNow>recordDeadline){string id=recordId;EndRecord();NotifyLater(new{kind="recorded",id,error="录入已结束，请保持页面在前台并重新开始。"});return CallNextHookEx(IntPtr.Zero,code,w,l);}
            int vk=Marshal.ReadInt32(l),scan=Marshal.ReadInt32(l,4),llFlags=Marshal.ReadInt32(l,8);
            if(vk<=0||vk>=255)return CallNextHookEx(hook,code,w,l);
            int previousMod=capture.PreviewMod;int? previousKey=capture.PreviewKey;
            bool suppress=capture.Handle(vk,scan,((llFlags&1)!=0?2:0)|((llFlags&0x80)!=0?1:0));
            if(capture.Finished){string id=recordId;int key=capture.Key,mod=capture.ChordMods;EndRecord();NotifyLater(new{kind="recorded",id,mod,key,error=key==0?"此按键无法作为普通键盘主键录入，请手动选择。":null});}
            else if(previousMod!=capture.PreviewMod||previousKey!=capture.PreviewKey)NotifyLater(new{kind="progress",id=recordId,mod=capture.PreviewMod,key=capture.PreviewKey});
            return suppress?new IntPtr(1):CallNextHookEx(hook,code,w,l);
        }catch{string id=recordId;EndRecord();NotifyLater(new{kind="recorded",id,error="录入检测已停止，请重新开始。"});return CallNextHookEx(IntPtr.Zero,code,w,l);}
    }
    static void StartRecord(string id){
        EndRecord();int mods=0;
        foreach(int vk in new[]{0xA2,0xA0,0xA4,0x5B,0xA3,0xA1,0xA5,0x5C})if((GetAsyncKeyState(vk)&0x8000)!=0)mods|=Modifier(vk,0,0);
        capture=new ChordCapture(mods);recordWindow=GetForegroundWindow();recordId=id;recordDeadline=DateTime.UtcNow.AddSeconds(20);
        hook=SetWindowsHookEx(13,HookCallback,GetModuleHandle(null),0);
        if(hook==IntPtr.Zero){int error=Marshal.GetLastWin32Error();EndRecord();throw new System.ComponentModel.Win32Exception(error);}
        Emit(new{kind="recording",id,guarded=true});
        Emit(new{kind="progress",id,mod=capture.PreviewMod,key=capture.PreviewKey});
    }
    static void ProcessCommands(){string line;while(Commands.TryDequeue(out line)){
        if(line=="quit"){EndRecord();Application.ExitThread();return;}
        try{var c=Json.Deserialize<Dictionary<string,object>>(line);string op=Convert.ToString(c["op"]);
            if(op=="quit"){EndRecord();Application.ExitThread();return;}
            if(op=="heartbeat")heartbeat=DateTime.UtcNow;
            else if(op=="record"){
                Guid id;if(!c.ContainsKey("id")||!Guid.TryParse(Convert.ToString(c["id"]),out id))throw new Exception("无效录入会话。");
                try{StartRecord(id.ToString());}catch(Exception e){Emit(new{kind="recorded",id=id.ToString(),error="Windows 快捷键拦截未启动："+e.Message});}
            }else if(op=="cancel"&&c.ContainsKey("id")&&Convert.ToString(c["id"])==recordId)EndRecord();
        }catch(Exception e){Emit(new{kind="error",error=e.Message});}
    }}
    sealed class InputWindow:NativeWindow {
        public InputWindow(){CreateHandle(new CreateParams{Caption="Micro Windows Input",Parent=new IntPtr(-3)});}
        protected override void WndProc(ref Message m){try{if(m.Msg==0x8001)ProcessCommands();else if(m.Msg==0x8002)while(Notifications.Count>0)Emit(Notifications.Dequeue());}catch(Exception e){Emit(new{kind="error",error=e.Message});}base.WndProc(ref m);}
    }
    static int SelfTest(){
        if(Modifier(0x11,29,2)!=16||Modifier(0x10,54,0)!=32||Modifier(0x5B,0,0)!=8)throw new Exception("Modifier mapping failed");
        if(KeyCode(67,46,0)!=6||KeyCode(13,28,0)!=40||KeyCode(13,28,2)!=88||KeyCode(37,75,2)!=80||KeyCode(103,71,0)!=95||KeyCode(0x87,0,0)!=115)throw new Exception("Key mapping failed");
        var altA=new ChordCapture(0);
        if(!altA.Handle(0xA4,56,0)||!altA.Handle(65,30,0)||!altA.Handle(65,30,0)||!altA.Handle(65,30,1)||altA.Finished||!altA.Handle(0xA4,56,1)||!altA.Finished||altA.Key!=4||altA.ChordMods!=4)throw new Exception("Alt+A suppression or balanced release failed");
        var preHeld=new ChordCapture(1);preHeld.Handle(67,46,0);if(preHeld.Handle(0xA2,29,1)||preHeld.Finished||!preHeld.Handle(67,46,1)||!preHeld.Finished||preHeld.ChordMods!=1)throw new Exception("Pre-held modifier release failed");
        var live=new ChordCapture(0);
        live.Handle(0xA2,29,0);if(live.PreviewMod!=1||live.PreviewKey!=null||live.Finished)throw new Exception("Live Ctrl preview failed");
        live.Handle(0xA0,42,0);if(live.PreviewMod!=3||live.PreviewKey!=null)throw new Exception("Live Ctrl+Shift preview failed");
        live.Handle(0xA0,42,1);live.Handle(0xA2,29,1);if(live.PreviewMod!=0||live.PreviewKey!=null||live.Finished)throw new Exception("Released modifiers must clear preview without finishing");
        live.Handle(0xA4,56,0);live.Handle(65,30,0);if(live.PreviewMod!=4||live.PreviewKey!=4||live.Finished)throw new Exception("Main key must appear before release");
        live.Handle(0xA4,56,1);if(live.PreviewMod!=4||live.PreviewKey!=4||live.Finished)throw new Exception("Chord preview must stay stable during release");
        live.Handle(65,30,1);if(!live.Finished||live.ChordMods!=4||live.Key!=4)throw new Exception("Live preview changed final chord");
        Console.WriteLine("Input self-test passed: live preview, chords, Alt+A suppression and balanced release; no real keys injected or captured.");return 0;
    }
    [STAThread] static int Main(string[] args){
        Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=new UTF8Encoding(false);
        try{
            if(args.Length==1&&args[0]=="--self-test")return SelfTest();
            if(args.Length==1&&args[0]=="--check-hook"){
                // No recording session exists: the callback passes through every key.
                hook=SetWindowsHookEx(13,HookCallback,GetModuleHandle(null),0);
                if(hook==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                EndRecord();Console.WriteLine("Windows shortcut hook available; no keys captured or suppressed.");return 0;
            }
            window=new InputWindow();
            Emit(new{kind="status",ready=true,error=(string)null});
            var timer=new System.Windows.Forms.Timer{Interval=100};
            timer.Tick+=(s,e)=>{if((DateTime.UtcNow-heartbeat).TotalSeconds>12){EndRecord();Application.ExitThread();return;}if(recordId!=null&&(DateTime.UtcNow>recordDeadline||GetForegroundWindow()!=recordWindow)){string id=recordId;EndRecord();Emit(new{kind="recorded",id,error="录入已超时或页面失去焦点，请重新开始。"});}};timer.Start();
            new Thread(()=>{string line;while((line=Console.ReadLine())!=null){Commands.Enqueue(line);PostMessage(window.Handle,0x8001,IntPtr.Zero,IntPtr.Zero);}Commands.Enqueue("quit");PostMessage(window.Handle,0x8001,IntPtr.Zero,IntPtr.Zero);}){IsBackground=true}.Start();
            Application.Run();timer.Dispose();window.DestroyHandle();return 0;
        }catch(Exception e){Emit(new{kind="error",error=e.Message});return 1;}finally{EndRecord();}
    }
}
