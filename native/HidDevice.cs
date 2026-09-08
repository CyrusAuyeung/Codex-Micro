using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal sealed class DeviceInfo {
    internal string Path, Product, Id;
    internal ushort Vendor, ProductId, Page, Usage, InputLength, OutputLength;
    internal object Public() { return new { product=Product, vendor_id=Vendor, product_id=ProductId, location_id=Id, usage_page=Page, usage=Usage, input_length=InputLength }; }
}

internal static class Hid {
    internal const uint Read=0x80000000, Share=3, Overlapped=0x40000000;
    internal static readonly IntPtr Invalid=new IntPtr(-1);
    [StructLayout(LayoutKind.Sequential)] internal struct InterfaceData { internal int cbSize; internal Guid ClassGuid; internal int Flags; internal IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] internal struct Attributes { internal int Size; internal ushort VendorID,ProductID,VersionNumber; }
    [StructLayout(LayoutKind.Sequential)] internal struct Caps {
        internal ushort Usage,UsagePage,InputReportByteLength,OutputReportByteLength,FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=17)] internal ushort[] Reserved;
        internal ushort NumberLinkCollectionNodes,NumberInputButtonCaps,NumberInputValueCaps,NumberInputDataIndices,NumberOutputButtonCaps,NumberOutputValueCaps,NumberOutputDataIndices,NumberFeatureButtonCaps,NumberFeatureValueCaps,NumberFeatureDataIndices;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Overlap { internal UIntPtr Internal,InternalHigh; internal uint Offset,OffsetHigh; internal IntPtr Event; }
    [DllImport("hid.dll")] internal static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll")] [return:MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetAttributes(SafeFileHandle h,ref Attributes a);
    [DllImport("hid.dll")] [return:MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetPreparsedData(SafeFileHandle h,out IntPtr p);
    [DllImport("hid.dll")] [return:MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_FreePreparsedData(IntPtr p);
    [DllImport("hid.dll")] internal static extern int HidP_GetCaps(IntPtr p,out Caps caps);
    [DllImport("hid.dll",CharSet=CharSet.Unicode)] [return:MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetProductString(SafeFileHandle h,StringBuilder text,int length);
    [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr SetupDiGetClassDevs(ref Guid guid,IntPtr enumerator,IntPtr parent,uint flags);
    [DllImport("setupapi.dll",SetLastError=true)] internal static extern bool SetupDiEnumDeviceInterfaces(IntPtr set,IntPtr info,ref Guid guid,uint index,ref InterfaceData data);
    [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set,ref InterfaceData data,IntPtr detail,uint size,out uint required,IntPtr info);
    [DllImport("setupapi.dll")] internal static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool ReadFile(SafeFileHandle file,IntPtr bytes,uint size,out uint read,IntPtr overlap);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool WriteFile(SafeFileHandle file,IntPtr bytes,uint size,out uint written,IntPtr overlap);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetOverlappedResult(SafeFileHandle file,IntPtr overlap,out uint bytes,bool wait);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool CancelIoEx(SafeFileHandle file,IntPtr overlap);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] internal static extern IntPtr CreateEvent(IntPtr security,bool manual,bool initial,string name);
    [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll")] internal static extern bool ResetEvent(IntPtr handle);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("cfgmgr32.dll")] internal static extern uint CM_Get_Parent(out uint parent,uint node,uint flags);
    [DllImport("cfgmgr32.dll",CharSet=CharSet.Unicode)] internal static extern uint CM_Get_DevNode_Registry_Property(uint node,uint property,out uint type,byte[] data,ref uint size,uint flags);
    private static string CodexAncestor(uint node) {
        for(int depth=0;depth<8;depth++) {
            foreach(uint property in new uint[]{13,1}) {
                var bytes=new byte[2048];uint size=(uint)bytes.Length,type;
                if(CM_Get_DevNode_Registry_Property(node,property,out type,bytes,ref size,0)==0 && type==1) {
                    string name=Encoding.Unicode.GetString(bytes,0,(int)size).TrimEnd('\0');
                    if(name.IndexOf("Codex Micro",StringComparison.OrdinalIgnoreCase)>=0)return name;
                }
            }
            uint parent;if(CM_Get_Parent(out parent,node,0)!=0)break;node=parent;
        }
        return null;
    }

    internal static List<DeviceInfo> Inventory(bool all=false) {
        var result=new List<DeviceInfo>(); Guid guid;HidD_GetHidGuid(out guid);
        IntPtr set=SetupDiGetClassDevs(ref guid,IntPtr.Zero,IntPtr.Zero,18);
        if(set==Invalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            for(uint i=0;;i++) {
                var data=new InterfaceData { cbSize=Marshal.SizeOf(typeof(InterfaceData)) };
                if(!SetupDiEnumDeviceInterfaces(set,IntPtr.Zero,ref guid,i,ref data))break;
                uint required; SetupDiGetDeviceInterfaceDetail(set,ref data,IntPtr.Zero,0,out required,IntPtr.Zero);
                if(required<8||required>32768)continue;
                IntPtr detail=Marshal.AllocHGlobal((int)required),info=Marshal.AllocHGlobal(IntPtr.Size==8?32:28);
                try {
                    Marshal.WriteInt32(detail,IntPtr.Size==8?8:6);
                    Marshal.WriteInt32(info,IntPtr.Size==8?32:28);
                    if(!SetupDiGetDeviceInterfaceDetail(set,ref data,detail,required,out required,info))continue;
                    string devicePath=Marshal.PtrToStringUni(IntPtr.Add(detail,4));
                    using(var handle=CreateFile(devicePath,0,Share,IntPtr.Zero,3,0,IntPtr.Zero)) {
                        if(handle.IsInvalid)continue;
                        var a=new Attributes { Size=Marshal.SizeOf(typeof(Attributes)) };
                        if(!HidD_GetAttributes(handle,ref a))continue;
                        var product=new StringBuilder(128); HidD_GetProductString(handle,product,256);
                        string name=product.ToString();
                        if(name.IndexOf("Codex Micro",StringComparison.OrdinalIgnoreCase)<0)name=CodexAncestor((uint)Marshal.ReadInt32(info,20))??name;
                        if(!all && !(a.VendorID==741&&a.ProductID==1) && name.IndexOf("Codex Micro",StringComparison.OrdinalIgnoreCase)<0)continue;
                        IntPtr preparsed;if(!HidD_GetPreparsedData(handle,out preparsed))continue;
                        Caps caps;try { if(HidP_GetCaps(preparsed,out caps)!=0x110000)continue; }finally{HidD_FreePreparsedData(preparsed);}
                        string id;using(var sha=SHA256.Create()){id=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(devicePath.ToLowerInvariant()))).Replace("-","").Substring(0,24);}
                        result.Add(new DeviceInfo { Path=devicePath,Product=name,Id=id,Vendor=a.VendorID,ProductId=a.ProductID,Page=caps.UsagePage,Usage=caps.Usage,InputLength=caps.InputReportByteLength,OutputLength=caps.OutputReportByteLength });
                    }
                }finally{Marshal.FreeHGlobal(detail);Marshal.FreeHGlobal(info);}
            }
        }finally{SetupDiDestroyDeviceInfoList(set);}
        return result;
    }
}
