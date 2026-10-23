import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const exec=promisify(execFile);
export const criticalWindowsNames=new Set(['system','idle','registry','smss','csrss','wininit','services','lsass','lsaiso','winlogon','svchost','fontdrvhost','dwm','memory compression','secure system']);
export async function powershell(command){
 const executable=join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await exec(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`],{windowsHide:true,maxBuffer:16*1024*1024,timeout:20000});
 return stdout.replace(/^\uFEFF/,'').trim();
}
export function parseWindowsProcesses(output){
 const data=JSON.parse(output);
 return {sessionId:Number(data.sessionId),processes:(Array.isArray(data.processes)?data.processes:data.processes?[data.processes]:[]).map(p=>({pid:Number(p.pid),ppid:Number(p.ppid),name:String(p.name).replace(/\.exe$/i,''),memory:Number(p.memory),cpu:0,cpuSeconds:Number(p.cpuSeconds),identity:p.identity?String(p.identity):null,sessionId:Number(p.sessionId)}))};
}
export async function windowsSnapshot(){
 return parseWindowsProcesses(await powershell(`$sessionId = (Get-Process -Id ${process.pid}).SessionId; $items = @(Get-CimInstance Win32_Process | ForEach-Object { $created = $null; if ($_.CreationDate) { $created = $_.CreationDate.ToUniversalTime().Ticks.ToString() }; [PSCustomObject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; memory = [double]$_.WorkingSetSize; cpuSeconds = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000000; identity = $created; sessionId = $_.SessionId } }); [PSCustomObject]@{ sessionId = $sessionId; processes = $items } | ConvertTo-Json -Depth 4 -Compress`));
}
export async function windowsIdentity(pid){
 if(!Number.isInteger(pid)||pid<1)throw Error('无效 PID');
 return powershell(`$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$p -or !$p.CreationDate) { throw 'Process exited or access denied' }; $p.CreationDate.ToUniversalTime().Ticks.ToString()`);
}
export async function windowsTerminate(pid,expected){
 if(!Number.isInteger(pid)||pid<5||!/^\d+$/.test(expected))throw Error('无效进程身份');
 // Acquire the process handle before checking identity to bind the operation to this process instance.
 await powershell(`$p = Get-Process -Id ${pid}; $handle = $p.Handle; $cim = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$cim -or $cim.CreationDate.ToUniversalTime().Ticks.ToString() -ne '${expected}') { throw 'Process identity changed' }; $owner = Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid; $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $currentSid) { throw 'Only processes owned by the current user can be terminated' }; if ($p.SessionId -eq 0 -or $p.SessionId -ne (Get-Process -Id ${process.pid}).SessionId) { throw 'Protected system session' }; $p.Kill(); $p.WaitForExit(5000) | Out-Null`);
}
