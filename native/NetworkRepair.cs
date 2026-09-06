using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class NetworkRepair {
    internal const string Address="192.168.4.222";
    // MIB_UNICASTIPADDRESS_ROW, Windows x64 ABI; SOCKADDR_INET occupies 28 bytes.
    [StructLayout(LayoutKind.Explicit,Size=80)] internal struct IpRow {
        [FieldOffset(0)] public ushort Family;
        [FieldOffset(4)] public uint Ip;
        [FieldOffset(32)] public ulong Luid;
        [FieldOffset(40)] public uint Index;
        [FieldOffset(44)] public uint PrefixOrigin;
        [FieldOffset(48)] public uint SuffixOrigin;
        [FieldOffset(52)] public uint ValidLifetime;
        [FieldOffset(56)] public uint PreferredLifetime;
        [FieldOffset(60)] public byte PrefixLength;
        [FieldOffset(61)] public byte SkipAsSource;
        [FieldOffset(64)] public uint DadState;
    }
    [DllImport("iphlpapi.dll")] static extern void InitializeUnicastIpAddressEntry(out IpRow row);
    [DllImport("iphlpapi.dll")] static extern uint CreateUnicastIpAddressEntry(ref IpRow row);
    [DllImport("iphlpapi.dll")] static extern uint GetUnicastIpAddressEntry(ref IpRow row);
    [DllImport("iphlpapi.dll")] static extern uint SetUnicastIpAddressEntry(ref IpRow row);
    [DllImport("iphlpapi.dll")] static extern uint DeleteUnicastIpAddressEntry(ref IpRow row);
    static bool Admin(){return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);}
    static void Check(uint code,string action){if(code!=0)throw new Exception(action+"失败："+new Win32Exception((int)code).Message+" ("+code+")");}
    static bool DhcpRecovered(string id){return NetworkInfo.Read().Any(a=>a.id==id&&a.config&&a.addresses.Any(x=>x.StartsWith("192.168.4.")&&x!=Address&&x!="192.168.4.1"));}
    internal static IpRow NewRow(AdapterInfo a){IpRow r;InitializeUnicastIpAddressEntry(out r);r.Family=2;r.Ip=BitConverter.ToUInt32(IPAddress.Parse(Address).GetAddressBytes(),0);r.Index=(uint)a.index;r.PrefixOrigin=1;r.SuffixOrigin=1;r.PrefixLength=24;r.SkipAsSource=1;r.ValidLifetime=90;r.PreferredLifetime=90;return r;}
    static int Repair(bool wait){
        if(!Admin())throw new Exception("临时地址需要 Windows 管理员权限。请从面板启动并允许 Windows 权限提示。");
        bool first;using(var mutex=new Mutex(true,"Local\\MicroWindowsNetworkRepair",out first)){
            if(!first)return 0;
            AdapterInfo adapter=null;var deadline=DateTime.UtcNow.AddSeconds(wait?180:1);
            do{var snapshot=NetworkInfo.Read();if(snapshot.Any(a=>a.config&&NetworkInfo.HasDeviceAddress(a)))return 0;var choices=snapshot.Where(NetworkInfo.NeedsRepair).ToList();if(choices.Count==1){adapter=choices[0];break;}if(choices.Count>1)throw new Exception("检测到多个配置热点连接，请只保留一个后重试。");if(!wait)break;Thread.Sleep(1000);}while(DateTime.UtcNow<deadline);
            if(adapter==null)throw new Exception("没有需要修复的 Codex Micro Config 连接。只有已连接此热点、开启 DHCP 且未获得正常 IPv4 地址时才会添加临时地址。");
            var row=NewRow(adapter);bool created=false;
            try{
                // Allow an in-progress DHCP handshake to finish before adding anything.
                Thread.Sleep(5000);if(DhcpRecovered(adapter.id))return 0;
                // Recheck immediately before the only mutation; no gateway, DNS or DHCP changes.
                var check=NetworkInfo.Read().SingleOrDefault(x=>x.id==adapter.id&&NetworkInfo.NeedsRepair(x));
                if(check==null)throw new Exception("连接已改变，未修改网络。");
                Check(CreateUnicastIpAddressEntry(ref row),"添加临时地址");created=true;
                var dadEnd=DateTime.UtcNow.AddSeconds(10);
                while(DateTime.UtcNow<dadEnd){Thread.Sleep(500);if(DhcpRecovered(adapter.id))return 0;Check(GetUnicastIpAddressEntry(ref row),"检查临时地址");if(row.DadState==4)break;if(row.DadState!=1)throw new Exception("临时地址发生冲突或不可用，已停止修复。");}
                if(row.DadState!=4)throw new Exception("临时地址验证超时。");
                var end=DateTime.UtcNow.AddMinutes(30);var refresh=DateTime.UtcNow.AddSeconds(25);
                while(DateTime.UtcNow<end){
                    Thread.Sleep(1000);var current=NetworkInfo.Read().SingleOrDefault(x=>x.id==adapter.id&&x.config);
                    if(current==null||!current.addresses.Contains(Address))break;
                    if(current.addresses.Any(x=>x!=Address&&!x.StartsWith("169.254.")))break;
                    if(DateTime.UtcNow>refresh){Check(GetUnicastIpAddressEntry(ref row),"检查临时地址");row.ValidLifetime=90;row.PreferredLifetime=90;Check(SetUnicastIpAddressEntry(ref row),"续用临时地址");refresh=DateTime.UtcNow.AddSeconds(25);}
                }
                return 0;
            }finally{if(created){uint code=DeleteUnicastIpAddressEntry(ref row);if(code!=0&&code!=1168)MessageBox.Show("临时地址清理返回 "+code+"，地址将在约 90 秒内失效。请稍后检查。","Micro Windows",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
        }
    }
    internal static int SelfTest(){
        if(Marshal.SizeOf(typeof(IpRow))!=80||Marshal.OffsetOf(typeof(IpRow),"Index").ToInt32()!=40)throw new Exception("IP row ABI mismatch");
        var a=new AdapterInfo{config=true,dhcp=true,index=19};a.addresses.Add("169.254.243.61");if(!NetworkInfo.NeedsRepair(a))throw new Exception("APIPA not detected");
        a.config=false;if(NetworkInfo.NeedsRepair(a))throw new Exception("Unrelated network accepted");a.config=true;a.addresses.Add("10.4.159.142");if(NetworkInfo.NeedsRepair(a))throw new Exception("Internet address accepted");
        a.addresses.Clear();a.addresses.Add("192.168.4.2");if(NetworkInfo.NeedsRepair(a))throw new Exception("Working address accepted");a.addresses.Clear();if(NetworkInfo.NeedsRepair(a))throw new Exception("Pending DHCP accepted");a.addresses.Add("169.254.243.61");a.dhcp=false;if(NetworkInfo.NeedsRepair(a))throw new Exception("Static adapter accepted");
        var r=NewRow(a);if(r.ValidLifetime!=90||r.SkipAsSource!=1||r.PrefixLength!=24||r.Index!=19)throw new Exception("Invalid repair settings");
        if(!NetworkInfo.IsConfig("Codex Micro Config")||!NetworkInfo.IsConfig("CodexMicro Config")||NetworkInfo.IsConfig("Codex Micro OTA"))throw new Exception("Invalid SSID guard");
        Console.WriteLine("Network repair self-test passed; no network changes.");return 0;
    }
    [STAThread] static int Main(string[] args){
        try{
            if(args.Length==1&&args[0]=="--status"){Console.OutputEncoding=System.Text.Encoding.UTF8;Console.WriteLine(new JavaScriptSerializer().Serialize(new{adapters=NetworkInfo.Read(),temporaryAddress=Address}));return 0;}
            if(args.Length==1&&args[0]=="--self-test")return SelfTest();
            if(args.Length==1&&(args[0]=="--launch-repair"||args[0]=="--launch-wait")){
                try{Process.Start(new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location,args[0]=="--launch-wait"?"--repair-wait":"--repair"){UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden});return 0;}
                catch(Win32Exception e){if(e.NativeErrorCode==1223){Console.Error.WriteLine("已取消 Windows 权限请求，没有修改网络。");return 3;}throw;}
            }
            if(args.Length==1&&(args[0]=="--repair"||args[0]=="--repair-wait"))return Repair(args[0]=="--repair-wait");
            throw new Exception("请从 Micro Windows 面板启动连接修复。");
        }catch(Exception e){if(args.Contains("--repair")||args.Contains("--repair-wait"))MessageBox.Show(e.Message,"Micro Windows · 连接修复",MessageBoxButtons.OK,MessageBoxIcon.Information);else Console.Error.WriteLine(e.Message);return 1;}
    }
}
