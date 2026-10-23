using System;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class MetropolisNative {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Entry {
  public uint Size, Usage, Pid;
  public UIntPtr Heap;
  public uint Module, Threads, ParentPid;
  public int Priority;
  public uint Flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
 }
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll", EntryPoint="Process32FirstW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool First(IntPtr h,ref Entry entry);
 [DllImport("kernel32.dll", EntryPoint="Process32NextW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool Next(IntPtr h,ref Entry entry);
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static Dictionary<int,int> Parents() {
  IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
  if(snapshot==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
  try {
   Dictionary<int,int> result=new Dictionary<int,int>(); Entry e=new Entry(); e.Size=(uint)Marshal.SizeOf(typeof(Entry));
   if(First(snapshot,ref e))do {result[(int)e.Pid]=(int)e.ParentPid;}while(Next(snapshot,ref e));
   return result;
  }finally{CloseHandle(snapshot);}
 }
 public static string OwnerSid(int pid) {
  IntPtr process=OpenProcess(0x1000,false,pid);
  if(process==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  IntPtr token=IntPtr.Zero;
  try {
   if(!OpenProcessToken(process,8,out token))throw new Win32Exception(Marshal.GetLastWin32Error());
   using(WindowsIdentity identity=new WindowsIdentity(token)){return identity.User.Value;}
  }finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
 }
}

public static class Program {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static string Identity(Process p){return p.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture);}
 public static int Main(string[] args){
  Console.OutputEncoding=new UTF8Encoding(false);
  try {
   string command=args.Length==0?"list":args[0];
   if(command=="list"){
    Dictionary<int,int> parents=MetropolisNative.Parents();
    List<object> processes=new List<object>();
    foreach(Process p in Process.GetProcesses())using(p){
     string name;try{name=p.ProcessName;}catch{continue;}
     string identity=null;double cpu=0,memory=0;int session=-1,parent=0;
     try{identity=Identity(p);cpu=p.TotalProcessorTime.TotalSeconds;memory=p.WorkingSet64;session=p.SessionId;}catch{}
     parents.TryGetValue(p.Id,out parent);
     processes.Add(new {pid=p.Id,ppid=parent,name=name,memory=memory,cpuSeconds=cpu,identity=identity,sessionId=session});
    }
    Console.WriteLine(Json.Serialize(new {sessionId=Process.GetCurrentProcess().SessionId,processes=processes}));
    return 0;
   }
   int pid;if(args.Length<2||!int.TryParse(args[1],out pid)||pid<1)throw new ArgumentException("Invalid PID");
   using(Process p=Process.GetProcessById(pid)){
    if(command=="identity"){Console.WriteLine(Identity(p));return 0;}
    if(command!="kill"||args.Length!=3||pid<5)throw new ArgumentException("Invalid operation");
    IntPtr pinnedHandle=p.Handle;
    if(Identity(p)!=args[2])throw new InvalidOperationException("Process identity changed");
    string[] critical={"system","idle","registry","smss","csrss","wininit","services","lsass","lsaiso","winlogon","svchost","fontdrvhost","dwm","memory compression","secure system"};
    if(Array.IndexOf(critical,p.ProcessName.ToLowerInvariant())>=0)throw new InvalidOperationException("Protected system process");
    if(p.SessionId==0||p.SessionId!=Process.GetCurrentProcess().SessionId)throw new InvalidOperationException("Protected system session");
    using(WindowsIdentity current=WindowsIdentity.GetCurrent())if(MetropolisNative.OwnerSid(pid)!=current.User.Value)throw new InvalidOperationException("Only current-user processes can be terminated");
    p.Kill();if(!p.WaitForExit(5000))throw new TimeoutException("Process termination timed out");
    Console.WriteLine("{\"ok\":true}");return 0;
   }
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
