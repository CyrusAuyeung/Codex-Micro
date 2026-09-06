using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

internal sealed class AdapterInfo {
    public string id,name,ssid;
    public int index,wifiError;
    public bool wireless,dhcp,config;
    public List<string> addresses=new List<string>();
}
internal static class NetworkInfo {
    [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version,IntPtr reserved,out uint negotiated,out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle,IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle,ref Guid guid,int opcode,IntPtr reserved,out uint size,out IntPtr data,out int valueType);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);
    internal static bool IsConfig(string ssid){return ssid=="Codex Micro Config"||ssid=="CodexMicro Config";}
    static string Ssid(IntPtr handle,Guid id,out int error){
        IntPtr p=IntPtr.Zero;uint size;int type;error=0;
        try{
            uint result=WlanQueryInterface(handle,ref id,7,IntPtr.Zero,out size,out p,out type);
            if(result!=0){error=(int)result;return null;}
            // WLAN_CONNECTION_ATTRIBUTES: state, mode, WCHAR profile[256], DOT11_SSID.
            if(size<556||Marshal.ReadInt32(p)!=1)return null;
            int length=Marshal.ReadInt32(p,520);if(length<0||length>32)return null;
            var bytes=new byte[length];Marshal.Copy(IntPtr.Add(p,524),bytes,0,length);return Encoding.UTF8.GetString(bytes);
        }finally{if(p!=IntPtr.Zero)WlanFreeMemory(p);}
    }
    internal static List<AdapterInfo> Read(){
        var result=new List<AdapterInfo>();IntPtr handle=IntPtr.Zero;uint version;
        uint opened=WlanOpenHandle(2,IntPtr.Zero,out version,out handle);
        try{foreach(var nic in NetworkInterface.GetAllNetworkInterfaces()){
            if(nic.OperationalStatus!=OperationalStatus.Up||nic.NetworkInterfaceType==NetworkInterfaceType.Loopback)continue;
            var ip=nic.GetIPProperties();var addresses=ip.UnicastAddresses.Where(a=>a.Address.AddressFamily==AddressFamily.InterNetwork).Select(a=>a.Address.ToString()).ToList();
            bool wireless=nic.NetworkInterfaceType==NetworkInterfaceType.Wireless80211;
            if(!addresses.Any()&&!wireless)continue;
            var ipv4=ip.GetIPv4Properties();if(ipv4==null)continue;
            var item=new AdapterInfo{id=nic.Id,name=nic.Name,index=ipv4.Index,wireless=wireless,dhcp=ipv4.IsDhcpEnabled,addresses=addresses};
            if(wireless){Guid id;if(opened==0&&Guid.TryParse(nic.Id,out id)){string ssid=Ssid(handle,id,out item.wifiError);item.config=IsConfig(ssid);item.ssid=item.config?ssid:(ssid==null?null:"其他 Wi-Fi");}else item.wifiError=(int)opened;}
            result.Add(item);
        }}finally{if(opened==0)WlanCloseHandle(handle,IntPtr.Zero);}
        return result;
    }
    internal static bool HasDeviceAddress(AdapterInfo a){return a.addresses.Any(x=>x.StartsWith("192.168.4.")&&x!="192.168.4.1"&&x!="192.168.4.0"&&x!="192.168.4.255");}
    internal static bool NeedsRepair(AdapterInfo a){return a.config&&a.dhcp&&a.addresses.Any()&&!HasDeviceAddress(a)&&a.addresses.All(x=>x.StartsWith("169.254."));}
}
