import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const criticalWindowsNames=new Set(['system','idle','registry','smss','csrss','wininit','services','lsass','lsaiso','winlogon','svchost','fontdrvhost','dwm','memory compression','secure system']);
let worker,sequence=0;
const pending=new Map();
function rejectPending(error){for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}pending.clear();}
function startWorker(){
 const local=fileURLToPath(new URL('build/windows-helper.exe',import.meta.url));
 const executable=existsSync(local)?local:process.resourcesPath?join(process.resourcesPath,'windows-helper.exe'):null;
 if(!executable||!existsSync(executable))throw Error('Windows monitor helper is missing; run npm run prepare:windows');
 const child=spawn(executable,['server'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 worker=child;let diagnostic='';
 child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-2000);});
 createInterface({input:child.stdout}).on('line',line=>{
  try{const reply=JSON.parse(line);const task=pending.get(reply.id);if(!task)return;pending.delete(reply.id);clearTimeout(task.timer);reply.error?task.reject(Error(reply.error)):task.resolve(typeof reply.result==='string'?reply.result:JSON.stringify(reply.result));}
  catch(error){rejectPending(Error(`Invalid native monitor response: ${error.message}`));child.kill();}
 });
 child.on('error',error=>{if(worker===child)worker=null;rejectPending(error);});
 child.on('exit',code=>{if(worker===child){worker=null;rejectPending(Error(diagnostic||`Native monitor exited (${code})`));}});
 child.stdin.on('error',error=>rejectPending(error));
 child.unref();for(const pipe of [child.stdin,child.stdout,child.stderr])pipe.unref?.();
 return child;
}
async function helper(args){
 const child=worker||startWorker();
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Windows 原生进程采样超时'));child.kill();},15000);
  pending.set(id,{resolve,reject,timer});
  child.stdin.write(JSON.stringify({id,args})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
 });
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
