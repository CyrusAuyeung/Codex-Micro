using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

internal sealed class KeyboardOutput {
    [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { internal ushort Vk,Scan; internal uint Flags,Time; internal UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct Mouse { internal int X,Y; internal uint Data,Flags,Time; internal UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)] internal struct Payload { [FieldOffset(0)] internal Keyboard Key; [FieldOffset(0)] internal Mouse Mouse; }
    [StructLayout(LayoutKind.Sequential)] internal struct Input { internal uint Type; internal Payload Data; }
    [DllImport("user32.dll",SetLastError=true)] internal static extern uint SendInput(uint count,Input[] input,int size);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    private readonly Dictionary<string,int[]> held=new Dictionary<string,int[]>();
    private readonly Dictionary<int,int> counts=new Dictionary<int,int>();
    private readonly HashSet<int> owned=new HashSet<int>();
    private readonly object gate=new object();
    private readonly Func<int,bool,bool> output;
    private readonly Func<int,bool> physicallyDown;
    internal KeyboardOutput() : this(Post,k=>GetAsyncKeyState(k)<0) {}
    internal KeyboardOutput(Func<int,bool,bool> post,Func<int,bool> physical) { output=post; physicallyDown=physical; }
    internal static bool Extended(int key) { return (key>=0x21&&key<=0x2E)||key==0x5B||key==0x5C||key==0xA3||key==0xA5||key==0x6F||key==0x90||(key>=0xA6&&key<=0xB7); }
    private static bool Post(int key,bool down) {
        var input=new Input { Type=1,Data=new Payload { Key=new Keyboard { Vk=(ushort)key,Flags=(down?0u:2u)|(Extended(key)?1u:0u),Extra=new UIntPtr(0x4D435257) } } };
        return SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))==1;
    }
    internal void Set(string id,int code,int[] modifiers,bool down) {
        lock(gate) {
            if(!down) { Up(id);return; }
            if(held.ContainsKey(id))return;
            if(String.IsNullOrEmpty(id)||id.Length>40||code<1||code>255||modifiers.Any(k=>!new[]{0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0x5B,0x5C}.Contains(k)))throw new ArgumentException("Invalid output key");
            var keys=modifiers.Concat(new[]{code}).Distinct().ToArray();
            var applied=new List<int>();
            try {
                foreach(int key in keys) {
                    int count;counts.TryGetValue(key,out count);
                    if(count==0 && !physicallyDown(key)) {
                        if(!output(key,true))throw new InvalidOperationException("Windows 未接受模拟按键。目标窗口可能以管理员身份运行。");
                        owned.Add(key);
                    }
                    counts[key]=count+1;applied.Add(key);
                }
                held[id]=keys;
            } catch { held[id]=applied.ToArray();Up(id);throw; }
        }
    }
    private void Up(string id) {
        int[] keys;if(!held.TryGetValue(id,out keys))return;
        held.Remove(id);
        foreach(int key in keys.Reverse()) {
            int count=counts[key]-1;
            if(count>0){counts[key]=count;continue;}
            counts.Remove(key);
            if(owned.Contains(key) && output(key,false))owned.Remove(key);
        }
    }
    internal void Release() {
        lock(gate) {
            foreach(string id in held.Keys.ToArray())Up(id);
            foreach(int key in owned.ToArray())if(output(key,false))owned.Remove(key);
        }
    }
    internal void Scroll(string axis,int amount){
        if((axis!="vertical"&&axis!="horizontal")||amount==0||Math.Abs(amount)>10)throw new ArgumentException("Invalid scroll amount");
        var input=new Input {Type=0,Data=new Payload {Mouse=new Mouse {Data=unchecked((uint)(amount*120)),Flags=axis=="horizontal"?0x1000u:0x0800u,Extra=new UIntPtr(0x4D435257)}}};
        if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new InvalidOperationException("Windows 未接受滚动操作。");
    }
    internal static void SelfTest() {
        var events=new List<string>();var k=new KeyboardOutput((key,down)=>{events.Add(key+":"+down);return true;},key=>false);
        k.Set("a",67,new[]{162},true);k.Set("b",86,new[]{162},true);k.Set("a",67,new[]{162},true);
        k.Set("a",67,new int[0],false);k.Set("b",86,new int[0],false);
        if(String.Join(",",events)!="162:True,67:True,86:True,67:False,86:False,162:False")throw new Exception("Shared modifiers or duplicate-down failed");
        events.Clear();k=new KeyboardOutput((key,down)=>{events.Add(key+":"+down);return true;},key=>key==162);
        k.Set("a",67,new[]{162},true);k.Release();if(String.Join(",",events)!="67:True,67:False")throw new Exception("Physical modifier preservation failed");
        events.Clear();k=new KeyboardOutput((key,down)=>{events.Add(key+":"+down);return key!=67;},key=>false);
        try{k.Set("a",67,new[]{162},true);throw new Exception("Expected output failure");}catch(InvalidOperationException){}
        if(!events.Contains("162:False"))throw new Exception("Failed output cleanup failed");
        if(Marshal.SizeOf(typeof(Input))!=(IntPtr.Size==8?40:28))throw new Exception("INPUT ABI size mismatch");
    }
}
