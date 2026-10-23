import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {nativeProcessApi} from './windows-native.mjs';
const exec=promisify(execFile);
export const criticalWindowsNames=new Set(['system','idle','registry','smss','csrss','wininit','services','lsass','lsaiso','winlogon','svchost','fontdrvhost','dwm','memory compression','secure system']);
export async function powershell(command){
 const executable=join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 let stdout;
 try { ({stdout}=await exec(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`],{windowsHide:true,maxBuffer:16*1024*1024,timeout:60000})); } catch(error) {
  throw new Error(error.killed ? 'Windows PowerShell 进程采样超时（60 秒）' : `Windows PowerShell 采样失败：${error.stderr || error.message}`, {cause:error});
 }
 return stdout.replace(/^\uFEFF/,'').trim();
}
export function parseWindowsProcesses(output){
 const data=JSON.parse(output);
 return {sessionId:Number(data.sessionId),processes:(Array.isArray(data.processes)?data.processes:data.processes?[data.processes]:[]).map(p=>({pid:Number(p.pid),ppid:Number(p.ppid),name:String(p.name).replace(/\.exe$/i,''),memory:Number(p.memory),cpu:0,cpuSeconds:Number(p.cpuSeconds),identity:p.identity?String(p.identity):null,sessionId:Number(p.sessionId)}))};
}
export async function windowsSnapshot(){
 return parseWindowsProcesses(await powershell(`${nativeProcessApi}
$sessionId = (Get-Process -Id ${process.pid}).SessionId; $parents = [MetropolisNative]::Parents(); $items = @(Get-Process | ForEach-Object { $p = $_; $created = $null; $cpu = 0; $memory = 0; $session = -1; try { $created = $p.StartTime.ToUniversalTime().Ticks.ToString(); $cpu = $p.TotalProcessorTime.TotalSeconds; $memory = $p.WorkingSet64; $session = $p.SessionId } catch {}; [PSCustomObject]@{ pid = $p.Id; ppid = $parents[[int]$p.Id]; name = $p.ProcessName; memory = [double]$memory; cpuSeconds = [double]$cpu; identity = $created; sessionId = $session } }); [PSCustomObject]@{ sessionId = $sessionId; processes = $items } | ConvertTo-Json -Depth 4 -Compress`));
}
export async function windowsIdentity(pid){
 if(!Number.isInteger(pid)||pid<1)throw Error('无效 PID');
 return powershell(`$p = Get-Process -Id ${pid}; $p.StartTime.ToUniversalTime().Ticks.ToString()`);
}
export async function windowsTerminate(pid,expected){
 if(!Number.isInteger(pid)||pid<5||!/^\d+$/.test(expected))throw Error('无效进程身份');
 // Acquire the process handle before checking identity to bind the operation to this process instance.
 await powershell(`${nativeProcessApi}
$p = Get-Process -Id ${pid}; $handle = $p.Handle; if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne '${expected}') { throw 'Process identity changed' }; $owner = [MetropolisNative]::OwnerSid(${pid}); $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if ($owner -ne $currentSid) { throw 'Only processes owned by the current user can be terminated' }; if ($p.SessionId -eq 0 -or $p.SessionId -ne (Get-Process -Id ${process.pid}).SessionId) { throw 'Protected system session' }; $p.Kill(); $p.WaitForExit(5000) | Out-Null`);
}
