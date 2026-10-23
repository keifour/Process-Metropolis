import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export const criticalWindowsNames=new Set(['system','idle','registry','smss','csrss','wininit','services','lsass','lsaiso','winlogon','svchost','fontdrvhost','dwm','memory compression','secure system']);
async function helper(args){
 const local=fileURLToPath(new URL('build/windows-helper.exe',import.meta.url));
 const executable=existsSync(local)?local:process.resourcesPath?join(process.resourcesPath,'windows-helper.exe'):null;
 if(!executable||!existsSync(executable))throw Error('Windows monitor helper is missing; run npm run prepare:windows');
 try{
  const {stdout}=await exec(executable,args,{windowsHide:true,maxBuffer:16*1024*1024,timeout:15000});return stdout.replace(/^\uFEFF/,'').trim();
 }catch(error){throw Error(error.killed?'Windows 原生进程采样超时':error.stderr?.trim()||error.message);}
}
export function parseWindowsProcesses(output){
 const data=JSON.parse(output);
 return {sessionId:Number(data.sessionId),processes:(Array.isArray(data.processes)?data.processes:data.processes?[data.processes]:[]).map(p=>({pid:Number(p.pid),ppid:Number(p.ppid),name:String(p.name).replace(/\.exe$/i,''),memory:Number(p.memory),cpu:0,cpuSeconds:Number(p.cpuSeconds),identity:p.identity?String(p.identity):null,sessionId:Number(p.sessionId)}))};
}
export async function windowsSnapshot(){return parseWindowsProcesses(await helper(['list']));}
export async function windowsIdentity(pid){
 if(!Number.isInteger(pid)||pid<1)throw Error('无效 PID');
 return helper(['identity',String(pid)]);
}
export async function windowsTerminate(pid,expected){
 if(!Number.isInteger(pid)||pid<5||!/^\d+$/.test(expected))throw Error('无效进程身份');
 await helper(['kill',String(pid),expected]);
}
