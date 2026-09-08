using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Runs from the data directory so the installer can replace every application binary.
internal static class MicroUpdate {
    private static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    internal static bool ValidVersion(string value){return value!=null&&Regex.IsMatch(value,@"^\d{1,5}\.\d{1,5}\.\d{1,5}$");}
    internal static string Hash(Stream stream){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    private static string Text(Dictionary<string,object> ticket,string key){object value;if(!ticket.TryGetValue(key,out value)||!(value is string))throw new Exception("更新任务缺少 "+key+"。");return (string)value;}
    private static bool Same(string a,string b){return String.Equals(Path.GetFullPath(a).TrimEnd('\\'),Path.GetFullPath(b).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);}
    private static bool Alive(int pid,long start){try{using(var p=Process.GetProcessById(pid))return !p.HasExited&&p.StartTime.ToUniversalTime().Ticks==start;}catch{return false;}}
    private static int Main(string[] args){
        if(args.Length==1&&args[0]=="--self-test")return ValidVersion("2.1.0")&&!ValidVersion("../2.1.0")&&!ValidVersion("2.1")?0:1;
        if(args.Length!=1)return 2;
        string result=null,app=null,version=null,error=null;bool restart=false,parentExited=false;
        try{
            var ticketPath=Path.GetFullPath(args[0]);if(!File.Exists(ticketPath)||new FileInfo(ticketPath).Length>16384)throw new Exception("更新任务无效。");
            var ticket=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(ticketPath));
            var runner=Path.GetDirectoryName(ticketPath);var updates=Directory.GetParent(runner).FullName;
            if(!Path.GetFileName(runner).StartsWith("runner-",StringComparison.Ordinal)||!Same(runner,AppDomain.CurrentDomain.BaseDirectory))throw new Exception("更新程序位置无效。");
            version=Text(ticket,"version");if(!ValidVersion(version))throw new Exception("更新版本无效。");
            var installer=Path.GetFullPath(Text(ticket,"file"));var digest=Text(ticket,"sha256");var directory=Path.GetFullPath(Text(ticket,"appDirectory"));
            if(!Same(Path.GetDirectoryName(installer),updates)||Path.GetFileName(installer)!="Micro-Windows-"+version+"-Setup-x64.exe"||!Regex.IsMatch(digest,@"^[a-f0-9]{64}$"))throw new Exception("更新包路径或校验信息无效。");
            if(directory.Contains("\"")||!File.Exists(Path.Combine(directory,"unins000.exe")))throw new Exception("请从已安装的 Micro Windows 中执行更新。");
            app=Path.Combine(directory,"Micro Windows.exe");if(!File.Exists(app))throw new Exception("找不到原程序，未安装更新。");
            result=Path.Combine(updates,"install-result.json");restart=ticket.ContainsKey("restart")&&(bool)ticket["restart"];
            int pid=Convert.ToInt32(ticket["parentPid"]);long start=long.Parse(Text(ticket,"parentStart"));
            var wait=Stopwatch.StartNew();while(Alive(pid,start)){if(wait.Elapsed.TotalSeconds>120)throw new Exception("旧程序尚未退出，更新已取消。");System.Threading.Thread.Sleep(200);}parentExited=true;
            // Keep the verified file open without write/delete sharing through installation.
            using(var stream=new FileStream(installer,FileMode.Open,FileAccess.Read,FileShare.Read)){
                if(stream.Length!=Convert.ToInt64(ticket["size"])||Hash(stream)!=digest)throw new Exception("安装包校验失败，请重新下载。");
                var command=new ProcessStartInfo(installer,"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=\""+directory+"\""){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=updates};
                using(var process=Process.Start(command)){process.WaitForExit();if(process.ExitCode!=0)throw new Exception("安装程序返回错误 "+process.ExitCode+"，原配置已保留。");}
            }
            if(AssemblyName.GetAssemblyName(app).Version.ToString(3)!=version)throw new Exception("安装后的版本与预期不同，请重新打开软件检查。");
        }catch(Exception e){error=e.Message;}
        if(result!=null)try{File.WriteAllText(result,Json.Serialize(new {version=version,error=error,time=DateTime.UtcNow.ToString("o")}),new UTF8Encoding(false));}catch{}
        if(restart&&parentExited&&app!=null&&File.Exists(app))try{Process.Start(new ProcessStartInfo(app){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(app)});}catch(Exception e){error="更新完成，但未能重新打开软件："+e.Message;if(result!=null)try{File.WriteAllText(result,Json.Serialize(new {version=version,error=error,time=DateTime.UtcNow.ToString("o")}));}catch{}}
        return error==null?0:1;
    }
}
