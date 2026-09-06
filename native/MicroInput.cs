using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// An explicit recording session previews chords until the user confirms or cancels.
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
    static CaptureSession capture=null;
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
        internal int Mods,Key=-1,ChordMods;
        int mainToken=-1;bool observed;
        internal bool Holding{get{return Mods!=0||blocked.Count>0;}}
        internal bool Finished{get{return observed&&!Holding;}}
        internal int? PreviewKey{get{return mainToken>=0&&blocked.Contains(mainToken)?(int?)Key:null;}}
        readonly HashSet<int> blocked=new HashSet<int>();
        internal ChordCapture(int mods){Mods=mods;ChordMods=mods;observed=mods!=0;}
        internal bool Handle(int vk,int scan,int flags){
            bool up=(flags&1)!=0;int modifier=Modifier(vk,scan,flags),token=(scan<<9)|((flags&2)<<7)|vk;
            if(up){bool suppress=blocked.Remove(token);if(modifier!=0)Mods&=~modifier;return suppress;}
            if(!blocked.Add(token))return true; // Repeats cannot replace a more recently pressed main key.
            observed=true;
            if(modifier!=0){Mods|=modifier;if(Key<0||PreviewKey!=null)ChordMods=Mods;}
            else{Key=KeyCode(vk,scan,flags);ChordMods=Mods;mainToken=token;}
            return true;
        }
    }
    sealed class Candidate {
        internal int Mod,Key,Revision;internal string Error;
    }
    sealed class CaptureSession {
        ChordCapture round;
        internal Candidate Candidate;
        internal int Revision;
        internal int PreviewMod{get{return round.Mods;}}
        internal int? PreviewKey{get{return round.PreviewKey;}}
        internal bool Holding{get{return round.Holding;}}
        internal CaptureSession(int mods){round=new ChordCapture(mods);}
        internal bool Handle(int vk,int scan,int flags){
            bool suppress=round.Handle(vk,scan,flags);
            if(round.Finished){
                Candidate=new Candidate{Mod=round.ChordMods,Key=round.Key<0?0:round.Key,Revision=++Revision,Error=round.Key==0?"此按键无法作为普通主键录入，请重新试按或手动选择。":null};
                round=new ChordCapture(0);
            }
            return suppress;
        }
        internal string ConfirmError(int revision){
            if(Holding)return "请先松开所有按键，再点击使用此组合。";
            if(Candidate==null||revision!=Revision)return "组合键已变化，请核对当前预览后再次确认。";
            return Candidate.Error;
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
            int previousMod=capture.PreviewMod,previousRevision=capture.Revision;int? previousKey=capture.PreviewKey;bool previousHolding=capture.Holding;
            bool suppress=capture.Handle(vk,scan,((llFlags&1)!=0?2:0)|((llFlags&0x80)!=0?1:0));
            if(previousRevision!=capture.Revision){var value=capture.Candidate;NotifyLater(new{kind="candidate",id=recordId,mod=value.Mod,key=value.Key,revision=value.Revision,error=value.Error});}
            else if(previousMod!=capture.PreviewMod||previousKey!=capture.PreviewKey||previousHolding!=capture.Holding)NotifyLater(new{kind="progress",id=recordId,mod=capture.PreviewMod,key=capture.PreviewKey,holding=capture.Holding});
            return suppress?new IntPtr(1):CallNextHookEx(hook,code,w,l);
        }catch{string id=recordId;EndRecord();NotifyLater(new{kind="recorded",id,error="录入检测已停止，请重新开始。"});return CallNextHookEx(IntPtr.Zero,code,w,l);}
    }
    static void StartRecord(string id){
        EndRecord();int mods=0;
        foreach(int vk in new[]{0xA2,0xA0,0xA4,0x5B,0xA3,0xA1,0xA5,0x5C})if((GetAsyncKeyState(vk)&0x8000)!=0)mods|=Modifier(vk,0,0);
        capture=new CaptureSession(mods);recordWindow=GetForegroundWindow();recordId=id;recordDeadline=DateTime.UtcNow.AddSeconds(60);
        hook=SetWindowsHookEx(13,HookCallback,GetModuleHandle(null),0);
        if(hook==IntPtr.Zero){int error=Marshal.GetLastWin32Error();EndRecord();throw new System.ComponentModel.Win32Exception(error);}
        Emit(new{kind="recording",id,guarded=true,confirmRequired=true});
        Emit(new{kind="progress",id,mod=capture.PreviewMod,key=capture.PreviewKey,holding=capture.Holding});
    }
    static void ConfirmRecord(string id,int revision){
        if(id!=recordId||capture==null){Emit(new{kind="confirm-rejected",id,revision,error="录入已结束，请重新开始。"});return;}
        if(GetForegroundWindow()!=recordWindow||DateTime.UtcNow>recordDeadline){EndRecord();Emit(new{kind="recorded",id,error="录入已超时或页面失去焦点，请重新开始。"});return;}
        string error=capture.ConfirmError(revision);
        if(error!=null){Emit(new{kind="confirm-rejected",id,revision,error});return;}
        var value=capture.Candidate;EndRecord();Emit(new{kind="recorded",id,mod=value.Mod,key=value.Key,revision=value.Revision});
    }
    static void ProcessCommands(){string line;while(Commands.TryDequeue(out line)){
        if(line=="quit"){EndRecord();Application.ExitThread();return;}
        try{var c=Json.Deserialize<Dictionary<string,object>>(line);string op=Convert.ToString(c["op"]);
            if(op=="quit"){EndRecord();Application.ExitThread();return;}
            if(op=="heartbeat")heartbeat=DateTime.UtcNow;
            else if(op=="record"){
                Guid id;if(!c.ContainsKey("id")||!Guid.TryParse(Convert.ToString(c["id"]),out id))throw new Exception("无效录入会话。");
                try{StartRecord(id.ToString());}catch(Exception e){Emit(new{kind="recorded",id=id.ToString(),error="Windows 快捷键拦截未启动："+e.Message});}
            }else if(op=="confirm")ConfirmRecord(Convert.ToString(c["id"]),Convert.ToInt32(c["revision"]));
            else if(op=="cancel"&&c.ContainsKey("id")&&Convert.ToString(c["id"])==recordId)EndRecord();
        }catch(Exception e){Emit(new{kind="error",error=e.Message});}
    }}
    sealed class InputWindow:NativeWindow {
        public InputWindow(){CreateHandle(new CreateParams{Caption="Micro Windows Input",Parent=new IntPtr(-3)});}
        protected override void WndProc(ref Message m){try{if(m.Msg==0x8001)ProcessCommands();else if(m.Msg==0x8002)while(Notifications.Count>0)Emit(Notifications.Dequeue());}catch(Exception e){Emit(new{kind="error",error=e.Message});}base.WndProc(ref m);}
    }
    static void Check(bool value,string message){if(!value)throw new Exception(message);}
    static void Feed(CaptureSession value,params int[][] events){foreach(var e in events)Check(value.Handle(e[0],e[1],e[2]),"Owned key event escaped suppression");}
    static void ExpectCandidate(CaptureSession value,int mod,int key){Check(!value.Holding&&value.Candidate!=null&&value.Candidate.Mod==mod&&value.Candidate.Key==key&&value.Candidate.Error==null&&value.ConfirmError(value.Revision)==null,"Wrong released candidate");}
    static int SelfTest(){
        Check(Modifier(0x11,29,2)==16&&Modifier(0x10,54,0)==32&&Modifier(0x5B,0,0)==8,"Modifier mapping failed");
        Check(KeyCode(67,46,0)==6&&KeyCode(13,28,0)==40&&KeyCode(13,28,2)==88&&KeyCode(37,75,2)==80&&KeyCode(103,71,0)==95&&KeyCode(0x87,0,0)==115,"Key mapping failed");
        var single=new CaptureSession(0);Check(!single.Handle(65,30,1)&&single.Candidate==null,"Stray keyup created a candidate");
        Feed(single,new[]{0xA4,56,0});Check(single.PreviewMod==4&&single.PreviewKey==null&&single.Holding,"Alt live preview failed");
        Feed(single,new[]{0xA4,56,1});ExpectCandidate(single,4,0);
        foreach(bool reverse in new[]{false,true}){
            var pair=new CaptureSession(0);Feed(pair,new[]{0xA2,29,0},new[]{0xA4,56,0});
            if(reverse)Feed(pair,new[]{0xA2,29,1},new[]{0xA4,56,1});else Feed(pair,new[]{0xA4,56,1},new[]{0xA2,29,1});
            ExpectCandidate(pair,5,0);
        }
        var releases=new[]{new[]{0xA2,29,1},new[]{0xA4,56,1},new[]{65,30,1}};
        foreach(var order in new[]{new[]{0,1,2},new[]{0,2,1},new[]{1,0,2},new[]{1,2,0},new[]{2,0,1},new[]{2,1,0}}){
            var full=new CaptureSession(0);Feed(full,new[]{0xA2,29,0},new[]{0xA4,56,0},new[]{65,30,0});
            foreach(int i in order)Feed(full,releases[i]);ExpectCandidate(full,5,4);
        }
        var replace=new CaptureSession(0);Feed(replace,new[]{0xA4,56,0},new[]{65,30,0},new[]{65,30,1});
        Check(replace.PreviewMod==4&&replace.PreviewKey==null&&replace.Candidate==null,"Released main key must leave a live Alt preview");
        Feed(replace,new[]{66,48,0});Check(replace.PreviewKey==5,"B did not replace A immediately");
        Feed(replace,new[]{66,48,1},new[]{0xA4,56,1});ExpectCandidate(replace,4,5);
        var repeat=new CaptureSession(0);Feed(repeat,new[]{0xA4,56,0},new[]{65,30,0},new[]{66,48,0},new[]{65,30,0},new[]{65,30,1},new[]{66,48,1},new[]{0xA4,56,1});ExpectCandidate(repeat,4,5);
        var preHeld=new CaptureSession(1);Feed(preHeld,new[]{67,46,0},new[]{67,46,1});Check(preHeld.Holding&&preHeld.Candidate==null,"Pre-held Ctrl ended before release");
        Check(!preHeld.Handle(0xA2,29,1),"Pre-held release was swallowed");ExpectCandidate(preHeld,1,6);
        var repeated=new CaptureSession(0);Feed(repeated,new[]{0xA2,29,0},new[]{65,30,0},new[]{65,30,1},new[]{0xA2,29,1});ExpectCandidate(repeated,1,4);
        Feed(repeated,new[]{0xA4,56,0});Check(repeated.ConfirmError(1)!=null,"Confirmation accepted while a new round was held");
        Feed(repeated,new[]{0xA4,56,1});ExpectCandidate(repeated,4,0);Check(repeated.Revision==2&&repeated.ConfirmError(1)!=null,"Stale preview could be confirmed");
        Feed(repeated,new[]{0xA2,29,0},new[]{0xA0,42,0},new[]{75,37,0},new[]{0xA2,29,1},new[]{75,37,1},new[]{0xA0,42,1});ExpectCandidate(repeated,3,14);Check(repeated.Revision==3,"Repeated rounds did not stay in the session");
        var right=new CaptureSession(0);Feed(right,new[]{0xA3,29,2},new[]{0xA5,56,2},new[]{0xA3,29,3},new[]{0xA5,56,3});ExpectCandidate(right,80,0);
        var changeMod=new CaptureSession(0);Feed(changeMod,new[]{0xA2,29,0},new[]{65,30,0},new[]{0xA2,29,1},new[]{0xA4,56,0},new[]{0xA4,56,1},new[]{65,30,1});ExpectCandidate(changeMod,4,4);
        var invalid=new CaptureSession(0);Feed(invalid,new[]{0xAF,0,0},new[]{0xAF,0,1});Check(invalid.Candidate.Error!=null&&invalid.ConfirmError(1)!=null,"Unknown key was recorded as a modifier-only chord");
        Feed(invalid,new[]{66,48,0},new[]{66,48,1});ExpectCandidate(invalid,0,5);
        Console.WriteLine("Input self-test passed: modifier-only chords, release order, main-key replacement, repeated rounds, confirmation and balanced suppression; no real keys injected or captured.");return 0;
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
