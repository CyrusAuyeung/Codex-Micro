using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Launcher {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    internal const string AppId="codex-micro-windows-panel";
    internal static readonly string Version=Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
    internal static string Origin="http://127.0.0.1:18414",Data,PipeName,MutexName;
    internal static bool TestMode;
    private static Process server;
    private static bool serverStarted;
    private static StreamWriter log;
    private static readonly object logLock=new object();
    internal static Dictionary<string,object> Health() {
        try {
            var r=(HttpWebRequest)WebRequest.Create(Origin+"/api/health");r.Timeout=700;r.Proxy=null;
            using(var response=r.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
                var state=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
                return state.ContainsKey("app")&&(string)state["app"]==AppId&&state.ContainsKey("simulation")&&(bool)state["simulation"]==TestMode?state:null;
            }
        } catch { return null; }
    }
    internal static bool Running(){var h=Health();return h!=null&&(string)h["version"]==Version;}
    private static bool FilesReady(){
        foreach(var name in new[]{"runtime/node.exe","MicroHID.Windows.exe","MicroNetwork.Windows.exe","MicroInput.Windows.exe","package.json","app-info.mjs","updates.mjs","server.mjs","model.mjs","vendor.mjs","network.mjs","input.mjs","device-mapping.mjs","public/hardware.html","public/hardware.js","public/hardware.css","public/mapping-core.js","public/index.html","public/app.js","public/style.css","public/desktop.css","public/desktop.js","public/keyboard.css","public/micro.svg","Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.WinForms.dll","WebView2Loader.dll"})
            if(!File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,name)))return false;
        return true;
    }
    internal static bool Stop() {
        try {
            var r=(HttpWebRequest)WebRequest.Create(Origin+"/api/quit");r.Method="POST";r.Proxy=null;r.Timeout=3000;
            r.Headers["Origin"]=Origin;r.Headers["X-Micro-Panel"]="1";r.ContentType="application/json";
            var bytes=Encoding.UTF8.GetBytes("{}");r.ContentLength=bytes.Length;
            using(var stream=r.GetRequestStream())stream.Write(bytes,0,bytes.Length);using(r.GetResponse()){}return true;
        }catch{return false;}
    }
    private static void Log(object sender,DataReceivedEventArgs e){if(e.Data!=null)lock(logLock){if(log!=null){log.WriteLine(DateTime.Now.ToString("s")+" "+e.Data);log.Flush();}}}
    private static int Signal(string command) {
        try {
            using(var pipe=new NamedPipeClientStream(".",PipeName,PipeDirection.InOut,PipeOptions.Asynchronous)){
                pipe.Connect(5000);
                using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true))using(var reader=new StreamReader(pipe,Encoding.UTF8,false,1024,true)){
                    writer.AutoFlush=true;writer.WriteLine(command);
                    var read=reader.ReadLineAsync();if(!read.Wait(90000))return 3;
                    return read.Result=="ok"?0:3;
                }
            }
        }catch{return 4;}
    }
    private static void WaitForLegacyTray(string version){
        var names=new Dictionary<string,string>{{"1.0.0","MicroWindowsLauncher"},{"1.1.0","MicroWindowsLauncher11"},{"1.1.1","MicroWindowsLauncher111"},{"1.1.2","MicroWindowsLauncher112"},{"1.1.3","MicroWindowsLauncher113"},{"1.1.4","MicroWindowsLauncher114"},{"1.1.5","MicroWindowsLauncher115"},{"1.1.6","MicroWindowsLauncher116"}};
        string name;if(!names.TryGetValue(version,out name))return;
        try{using(var previous=Mutex.OpenExisting("Local\\"+name)){
            bool acquired=false;
            try{acquired=previous.WaitOne(7000);}catch(AbandonedMutexException){acquired=true;}
            finally{if(acquired)previous.ReleaseMutex();}
            if(!acquired)throw new Exception("旧版托盘仍在退出，请稍后重试。设置已保留。");
        }}catch(WaitHandleCannotBeOpenedException){}
    }
    [STAThread] private static int Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        SetCurrentProcessExplicitAppUserModelID("CyrusAuyeung.MicroWindows");
        if(Array.IndexOf(args,"--check-files")>=0)return FilesReady()?0:2;
        if(Array.IndexOf(args,"--self-test")>=0)return DesktopPolicy.SelfTest();
        TestMode=Array.IndexOf(args,"--ui-test")>=0;
        var port=TestMode?Environment.GetEnvironmentVariable("MICRO_WINDOWS_PORT"):"18414";
        int number;if(!int.TryParse(port,out number)||number<1024||number>65535)return 2;
        Origin="http://127.0.0.1:"+number;
        var suffix=WindowsIdentity.GetCurrent().User.Value+(TestMode?"-test-"+port:"");
        PipeName="MicroWindowsDesktop-"+suffix;MutexName="Local\\MicroWindowsDesktop-"+suffix;
        Data=TestMode?Environment.GetEnvironmentVariable("MICRO_WINDOWS_DATA"):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Micro Windows");
        if(String.IsNullOrEmpty(Data))return 2;
        bool quit=Array.IndexOf(args,"--shutdown-for-update")>=0||Array.IndexOf(args,"--shutdown-if-idle")>=0;
        string command=quit?(Array.IndexOf(args,"--shutdown-if-idle")>=0?"quit-if-idle":"quit"):"activate";
        if(TestMode&&Array.IndexOf(args,"--test-window-hidden")>=0)command="test-hidden";
        if(TestMode&&Array.IndexOf(args,"--test-window-visible")>=0)command="test-visible";
        try {
            bool first;using(var single=new Mutex(true,MutexName,out first)) {
                if(!first){int code=Signal(command);if(code==0&&quit){try{if(single.WaitOne(15000))single.ReleaseMutex();else return 3;}catch(AbandonedMutexException){single.ReleaseMutex();}}return code;}
                if(quit)return 0;
                var previous=Health();
                if(previous!=null){
                    // Portable 1.x releases used a browser and their own per-version tray mutex.
                    var old=(string)previous["version"];
                    if(!old.StartsWith("1.0.")&&!old.StartsWith("1.1."))throw new Exception("已有本地服务正在运行，请先从旧程序托盘退出。");
                    if(!Stop())throw new Exception("旧版正在与键盘通信，请完成后再启动。");
                    for(int i=0;i<40&&Health()!=null;i++)Thread.Sleep(150);
                    WaitForLegacyTray(old);
                }
                if(!FilesReady())throw new Exception("程序文件不完整，请重新安装 Micro Windows。");
                string root=AppDomain.CurrentDomain.BaseDirectory;Directory.CreateDirectory(Data);
                log=new StreamWriter(Path.Combine(Data,"panel.log"),true,new UTF8Encoding(false));
                var start=new ProcessStartInfo(Path.Combine(root,"runtime/node.exe"),"\""+Path.Combine(root,"server.mjs")+"\""){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
                start.EnvironmentVariables["MICRO_WINDOWS_DATA"]=Data;start.EnvironmentVariables["MICRO_WINDOWS_PORT"]=port;
                if(!TestMode)foreach(var name in new[]{"MICRO_WINDOWS_TEST","MICRO_WINDOWS_HELPER","MICRO_WINDOWS_DEVICE_ORIGIN","MICRO_WINDOWS_INPUT_HELPER","NODE_OPTIONS","NODE_PATH"})start.EnvironmentVariables.Remove(name);
                else start.EnvironmentVariables["MICRO_WINDOWS_TEST"]="1";
                server=new Process{StartInfo=start};server.OutputDataReceived+=Log;server.ErrorDataReceived+=Log;server.Start();serverStarted=true;server.BeginOutputReadLine();server.BeginErrorReadLine();
                for(int i=0;i<60&&!Running();i++){if(server.HasExited)throw new Exception("本地服务启动失败。日志："+Path.Combine(Data,"panel.log"));Thread.Sleep(150);}
                if(!Running())throw new Exception("本地服务未就绪，端口可能被占用。日志："+Path.Combine(Data,"panel.log"));
                using(var context=new DesktopContext()){Application.Run(context);}
                if(!server.HasExited)server.WaitForExit(4000);
                return 0;
            }
        }catch(Exception e){if(TestMode){Directory.CreateDirectory(Data);File.WriteAllText(Path.Combine(Data,"desktop-error.txt"),e.ToString());}else MessageBox.Show(e.Message,"Micro Windows",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
        finally{if(serverStarted&&!server.HasExited){Stop();if(!server.WaitForExit(4000))server.Kill();}lock(logLock){if(log!=null){log.Dispose();log=null;}}}
    }
    private sealed class DesktopContext:ApplicationContext {
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
        [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first,IntPtr second);
        private readonly Form window;
        private readonly WebView2 web;
        private readonly NotifyIcon icon;
        private readonly Icon appIcon;
        private readonly System.Windows.Forms.Timer timer;
        private bool exiting,ready,quitting;
        internal DesktopContext(){
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("MicroWindows.Icon"))using(var source=new Icon(stream)){appIcon=(Icon)source.Clone();}
            window=new Form{Text="Micro Windows",Icon=appIcon,StartPosition=FormStartPosition.CenterScreen};
            window.SuspendLayout();
            window.AutoScaleDimensions=new SizeF(96,96);window.AutoScaleMode=AutoScaleMode.Dpi;
            window.ClientSize=new Size(1100,720);
            if(TestMode){window.ShowInTaskbar=false;window.StartPosition=FormStartPosition.Manual;window.Location=new Point(-20000,-20000);}
            web=new WebView2{Dock=DockStyle.Fill,DefaultBackgroundColor=Color.FromArgb(246,245,241)};window.Controls.Add(web);
            window.ResumeLayout(false);
            window.FormClosing+=(s,e)=>{if(!exiting&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;HideWindow();}};
            window.DpiChanged+=(s,e)=>SetMinimumSize(e.DeviceDpiNew);
            window.Shown+=async(s,e)=>{
                SetMinimumSize(GetDpiForWindow(window.Handle));
                var area=Screen.FromControl(window).WorkingArea;window.Size=new Size(Math.Min(window.Width,area.Width-24),Math.Min(window.Height,area.Height-24));
                await Initialize();
            };
            var menu=new ContextMenuStrip();menu.Items.Add("打开 Micro Windows",null,(s,e)=>Activate());menu.Items.Add("退出",null,async(s,e)=>await Quit(false));
            icon=new NotifyIcon{Icon=appIcon,Text="Micro Windows",ContextMenuStrip=menu,Visible=!TestMode};icon.DoubleClick+=(s,e)=>Activate();
            timer=new System.Windows.Forms.Timer{Interval=1000};timer.Tick+=(s,e)=>{if(server.HasExited){exiting=true;window.Close();ExitThread();}};timer.Start();
            window.Show();Task.Run((Action)Listen);
        }
        private void SetMinimumSize(double dpi){var scale=dpi/96.0;window.MinimumSize=new Size((int)Math.Round(820*scale),(int)Math.Round(570*scale));}
        private async Task Initialize(){
            try{
                var options=new CoreWebView2EnvironmentOptions();
                if(TestMode){int debug;if(int.TryParse(Environment.GetEnvironmentVariable("MICRO_WINDOWS_DEBUG_PORT"),out debug)&&debug>=1024&&debug<=65535)options.AdditionalBrowserArguments="--remote-debugging-port="+debug;}
                else {Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",null);Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",null);}
                var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Data,"WebView2"),options);
                await web.EnsureCoreWebView2Async(environment);
                var core=web.CoreWebView2;core.Settings.AreDevToolsEnabled=TestMode;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.AreBrowserAcceleratorKeysEnabled=false;core.Settings.IsStatusBarEnabled=false;
                core.NavigationStarting+=(s,e)=>{
                    if(e.Uri.StartsWith("blob:"+Origin+"/")&&DesktopPolicy.LocalPage(core.Source,Origin))return;
                    if(!DesktopPolicy.LocalPage(e.Uri,Origin)){e.Cancel=true;if(e.IsUserInitiated)OpenExternal(e.Uri);}
                };
                core.NewWindowRequested+=(s,e)=>{e.Handled=true;if(e.IsUserInitiated)OpenExternal(e.Uri);};
                core.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
                core.DownloadStarting+=(s,e)=>{
                    var name=Path.GetFileName(e.ResultFilePath);
                    if(!e.DownloadOperation.Uri.StartsWith("blob:"+Origin+"/")||!name.StartsWith("codex-micro-")||!name.EndsWith(".json",StringComparison.OrdinalIgnoreCase)){e.Cancel=true;return;}
                    e.Handled=true;var deferral=e.GetDeferral();
                    window.BeginInvoke((Action)(()=>{
                        try{
                            if(TestMode){var folder=Path.Combine(Data,"exports");Directory.CreateDirectory(folder);e.ResultFilePath=Path.Combine(folder,name);}
                            else using(var dialog=new SaveFileDialog{FileName=name,Filter="键位配置 (*.json)|*.json",DefaultExt="json",AddExtension=true}){if(dialog.ShowDialog(window)==DialogResult.OK)e.ResultFilePath=dialog.FileName;else e.Cancel=true;}
                        }catch{e.Cancel=true;}finally{deferral.Complete();}
                    }));
                };
                core.WebMessageReceived+=async(s,e)=>{
                    if(!DesktopPolicy.LocalPage(e.Source,Origin))return;
                    string message;try{message=e.TryGetWebMessageAsString();}catch{return;}
                    if(message=="quit")await Quit(false);
                    else if(TestMode&&message=="test-hide")HideWindow();
                };
                core.NavigationCompleted+=(s,e)=>{
                    ready=e.IsSuccess;
                    if(TestMode)File.WriteAllText(Path.Combine(Data,"display.json"),new JavaScriptSerializer().Serialize(new {
                        dpi=GetDpiForWindow(window.Handle),perMonitorV2=AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window.Handle),new IntPtr(-4)),
                        width=web.ClientSize.Width,height=web.ClientSize.Height,zoom=web.ZoomFactor,
                        targetFramework=AppDomain.CurrentDomain.SetupInformation.TargetFrameworkName,icon=window.Icon!=null
                    }));
                };core.Navigate(Origin+"/");
            }catch(Exception e){
                if(TestMode)File.WriteAllText(Path.Combine(Data,"desktop-error.txt"),e.ToString());
                else MessageBox.Show(window,"桌面窗口无法启动。请重新运行安装程序以检查 WebView2。\n\n"+e.Message,"Micro Windows",MessageBoxButtons.OK,MessageBoxIcon.Error);
                Stop();exiting=true;window.Close();ExitThread();
            }
        }
        private void OpenExternal(string url){if(DesktopPolicy.External(url))Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}
        private void Activate(){if(!TestMode){window.Show();if(window.WindowState==FormWindowState.Minimized)window.WindowState=FormWindowState.Normal;window.Activate();}else window.Show();}
        private async void HideWindow(){if(ready)try{await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('micro-window-hiding'))");}catch{}window.Hide();}
        private async Task<bool> Quit(bool idleOnly){
            if(quitting)return false;quitting=true;
            try{
                if(ready){
                    var json=await web.CoreWebView2.ExecuteScriptAsync("window.microDesktopState ? window.microDesktopState() : ({busy:true,dirty:false})");
                    var state=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json);
                    if(state==null||!state.ContainsKey("busy")||(bool)state["busy"]){if(!idleOnly&&!TestMode){Activate();MessageBox.Show(window,"正在与键盘通信，请完成后再退出。","Micro Windows");}return false;}
                    if(state.ContainsKey("dirty")&&(bool)state["dirty"]){if(idleOnly||TestMode)return false;Activate();if(MessageBox.Show(window,"还有未保存的修改。退出会丢弃这些修改，是否继续？","Micro Windows",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return false;}
                }
                if(!Stop()&&!server.HasExited)return false;
                // Give the installer IPC reply time to flush before the process exits.
                var closing=new System.Windows.Forms.Timer{Interval=500};closing.Tick+=(s,e)=>{closing.Stop();closing.Dispose();exiting=true;window.Close();ExitThread();};closing.Start();return true;
            }catch{return false;}finally{quitting=false;}
        }
        private void Listen(){
            while(!exiting){
                try{
                    using(var pipe=new NamedPipeServerStream(PipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous)){
                        pipe.WaitForConnection();
                        using(var reader=new StreamReader(pipe,Encoding.UTF8,false,1024,true))using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true)){
                            var read=reader.ReadLineAsync();if(!read.Wait(3000))continue;var command=read.Result;var result=new TaskCompletionSource<bool>();
                            window.BeginInvoke((Action)(async()=>{if(command=="activate"){Activate();result.TrySetResult(true);}else if(TestMode&&command=="test-hidden")result.TrySetResult(!window.Visible);else if(TestMode&&command=="test-visible")result.TrySetResult(window.Visible);else if(command=="quit"||command=="quit-if-idle")result.TrySetResult(await Quit(command=="quit-if-idle"));else result.TrySetResult(false);}));
                            if(result.Task.Wait(85000)){writer.WriteLine(result.Task.Result?"ok":"busy");writer.Flush();}
                        }
                    }
                }catch{if(!exiting)Thread.Sleep(100);}
            }
        }
        protected override void Dispose(bool disposing){if(disposing){exiting=true;timer.Dispose();icon.Visible=false;icon.Dispose();web.Dispose();window.Dispose();appIcon.Dispose();}base.Dispose(disposing);}
    }
}

internal static class DesktopPolicy {
    internal static bool LocalPage(string value,string origin){Uri u;if(!Uri.TryCreate(value,UriKind.Absolute,out u))return false;return u.GetLeftPart(UriPartial.Authority)==origin&&(u.AbsolutePath=="/"||u.AbsolutePath=="/codex")&&u.UserInfo=="";}
    internal static bool External(string value){Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u)&&u.Scheme=="https"&&u.Host=="github.com"&&u.IsDefaultPort&&u.UserInfo==""&&(u.AbsolutePath=="/CyrusAuyeung/Codex-Micro"||u.AbsolutePath.StartsWith("/CyrusAuyeung/Codex-Micro/",StringComparison.Ordinal));}
    internal static int SelfTest(){
        if(!LocalPage("http://127.0.0.1:18414/codex","http://127.0.0.1:18414")||LocalPage("http://127.0.0.1:18414/api/quit","http://127.0.0.1:18414")||LocalPage("http://127.0.0.1:18415/","http://127.0.0.1:18414"))return 1;
        if(!External("https://github.com/CyrusAuyeung/Codex-Micro/releases/latest")||External("file:///C:/Windows/notepad.exe")||External("https://github.com.evil.test/CyrusAuyeung/Codex-Micro")||External("https://github.com/CyrusAuyeung/Codex-Micro-other"))return 1;return 0;
    }
}
