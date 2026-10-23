// Win32 process-tree and token access; no WMI provider or administrator elevation required.
export const nativeProcessApi=`
Add-Type -TypeDefinition @'
using System;
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
'@
`;
