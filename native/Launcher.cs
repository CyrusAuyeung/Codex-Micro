using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

internal static class Launcher {
    private const string Origin="http://127.0.0.1:18414",AppId="codex-micro-windows-panel";
    private static Process server;
    private static StreamWriter log;
    private static readonly object logLock=new object();
    internal static bool Running() {
        try {
            var request=(HttpWebRequest)WebRequest.Create(Origin+"/api/health");request.Timeout=750;request.Proxy=null;
            using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
                var state=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(reader.ReadToEnd());
                return state.ContainsKey("app")&&(string)state["app"]==AppId&&state.ContainsKey("simulation")&&!(bool)state["simulation"];
            }
        }catch{return false;}
    }
    internal static void Open(){Process.Start(new ProcessStartInfo(Origin){UseShellExecute=true});}
    internal static void Stop() {
        try {
            var request=(HttpWebRequest)WebRequest.Create(Origin+"/api/quit");request.Method="POST";request.Proxy=null;request.Timeout=1500;
            request.Headers["Origin"]=Origin;request.Headers["X-Micro-Panel"]="1";request.ContentType="application/json";
            var bytes=Encoding.UTF8.GetBytes("{}");request.ContentLength=bytes.Length;
            using(var s=request.GetRequestStream())s.Write(bytes,0,bytes.Length);using(request.GetResponse()){}
        }catch{}
    }
    private static void Log(object sender,DataReceivedEventArgs e){if(e.Data!=null)lock(logLock){log.WriteLine(DateTime.Now.ToString("s")+" "+e.Data);log.Flush();}}
    [STAThread] private static int Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        if(args.Length==1&&args[0]=="--check-files")return File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"runtime/node.exe"))&&File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"MicroHID.Windows.exe"))?0:2;
        try {
            if(Running()){Open();return 0;}
            bool first;using(var single=new Mutex(true,"Local\\MicroWindowsLauncher",out first)) {
                if(!first){for(int i=0;i<30&&!Running();i++)Thread.Sleep(200);if(Running()){Open();return 0;}throw new Exception("另一个 Micro Windows 正在启动，请稍后重试。");}
                string root=AppDomain.CurrentDomain.BaseDirectory,node=Path.Combine(root,"runtime/node.exe"),script=Path.Combine(root,"server.mjs");
                if(!File.Exists(node)||!File.Exists(script)||!File.Exists(Path.Combine(root,"MicroHID.Windows.exe")))throw new Exception("文件不完整。请先解压整个 Micro Windows 文件夹，再双击启动程序。");
                string data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Micro Windows");Directory.CreateDirectory(data);
                log=new StreamWriter(Path.Combine(data,"panel.log"),true,new UTF8Encoding(false));
                var start=new ProcessStartInfo(node,"\""+script+"\""){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
                start.EnvironmentVariables["MICRO_WINDOWS_DATA"]=data;start.EnvironmentVariables["MICRO_WINDOWS_PORT"]="18414";
                start.EnvironmentVariables.Remove("MICRO_WINDOWS_TEST");start.EnvironmentVariables.Remove("MICRO_WINDOWS_HELPER");
                server=new Process{StartInfo=start};server.OutputDataReceived+=Log;server.ErrorDataReceived+=Log;server.Start();server.BeginOutputReadLine();server.BeginErrorReadLine();
                for(int i=0;i<50&&!Running();i++){if(server.HasExited)throw new Exception("本地服务启动失败。日志："+Path.Combine(data,"panel.log"));Thread.Sleep(150);}
                if(!Running()){if(!server.HasExited)server.Kill();throw new Exception("本地服务未就绪，端口 18414 可能被占用。日志："+Path.Combine(data,"panel.log"));}
                Open();using(var tray=new TrayContext()){Application.Run(tray);}
                log.Dispose();return 0;
            }
        }catch(Exception e){MessageBox.Show(e.Message,"Micro Windows",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
    private sealed class TrayContext:ApplicationContext {
        private readonly NotifyIcon icon;
        private readonly System.Windows.Forms.Timer timer;
        internal TrayContext(){
            var menu=new ContextMenuStrip();menu.Items.Add("打开键位配置",null,(s,e)=>Open());menu.Items.Add("退出 Micro Windows",null,(s,e)=>{Stop();ExitThread();});
            icon=new NotifyIcon{Icon=SystemIcons.Application,Text="Micro Windows · 小键盘配置",ContextMenuStrip=menu,Visible=true};icon.DoubleClick+=(s,e)=>Open();
            timer=new System.Windows.Forms.Timer{Interval=2000};timer.Tick+=(s,e)=>{if(server.HasExited)ExitThread();};timer.Start();
        }
        protected override void Dispose(bool disposing){if(disposing){timer.Dispose();icon.Visible=false;icon.Dispose();}base.Dispose(disposing);}
    }
}
