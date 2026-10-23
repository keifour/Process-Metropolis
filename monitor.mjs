import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import {windowsSnapshot, windowsIdentity, windowsTerminate, criticalWindowsNames} from './windows-monitor.mjs';
const exec = promisify(execFile);
let previous = new Map();
export function parseProcesses(output) {
  return output.trim().split('\n').filter(Boolean).map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) return null;
    return {pid:+m[1],ppid:+m[2],cpu:+m[3],memory:+m[4]*1024,uid:+m[5],name:m[6].split('/').pop()};
  }).filter(Boolean);
}
export async function identity(pid) {
  if (process.platform === 'win32') return windowsIdentity(pid);
  if (process.platform === 'linux') {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
  }
  return (await exec('ps',['-p',String(pid),'-o','lstart='])).stdout.trim();
}
export async function snapshot() {
  let processes, sessionId;
  if (process.platform === 'win32') ({processes, sessionId} = await windowsSnapshot());
  else {
  const {stdout} = await exec('ps',['-axo','pid=,ppid=,%cpu=,rss=,uid=,comm='],{maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C'}});
  processes = parseProcesses(stdout);
  }
  const now = performance.now();
  await Promise.all(processes.map(async p => {
    try {
      if (process.platform === 'win32') {
        const before=previous.get(p.pid);
        if(before && before.identity===p.identity) p.cpu=Math.max(0,(p.cpuSeconds-before.cpuSeconds)/(now-before.time)*100000);
        previous.set(p.pid,{cpuSeconds:p.cpuSeconds,time:now,identity:p.identity});
        return;
      }
      p.identity = await identity(p.pid);
      if (process.platform === 'linux') {
        const raw = await readFile(`/proc/${p.pid}/stat`,'utf8');
        const fields = raw.slice(raw.lastIndexOf(')')+2).split(' ');
        const ticks = +fields[11] + +fields[12];
        const before = previous.get(p.pid);
        // Linux USER_HZ is 100 for supported Linux architectures.
        if(before && before.identity === p.identity) p.cpu = Math.max(0,(ticks-before.ticks)/(now-before.time)*1000);
        previous.set(p.pid,{ticks,time:now,identity:p.identity});
      }
    } catch { p.identity = null; }
  }));
  const alive = new Set(processes.map(p=>p.pid));
  for(const pid of previous.keys()) if(!alive.has(pid)) previous.delete(pid);
  const protectedPids = new Set([1,process.pid]);
  let parent = process.ppid;
  while(parent && !protectedPids.has(parent)) { protectedPids.add(parent); parent=processes.find(p=>p.pid===parent)?.ppid; }
  // Protect the desktop renderer, GPU and other descendants as well as ancestors.
  let added=true;
  const desktopPids=new Set([process.pid]);
  while(added){added=false;for(const p of processes) if(desktopPids.has(p.ppid)&&!desktopPids.has(p.pid)){desktopPids.add(p.pid);added=true;}}
  for(const pid of desktopPids) protectedPids.add(pid);
  for(const p of processes) p.canKill = !!p.identity && !protectedPids.has(p.pid) && (process.platform === 'win32' ? p.pid>4 && p.sessionId>0 && p.sessionId===sessionId && !criticalWindowsNames.has(p.name.toLowerCase()) : p.uid === process.getuid() && p.uid !== 0);
  return {processes:processes.sort((a,b)=>b.memory-a.memory),totalMemory:os.totalmem(),usedMemory:os.totalmem()-os.freemem(),cores:os.cpus().length,platform:process.platform,hostname:os.hostname(),timestamp:Date.now()};
}

export async function terminateProcess(pid, expected) {
  if(!Number.isInteger(pid)||pid<2) throw Error('无效 PID');
  const fresh=await snapshot();
  const p=fresh.processes.find(p=>p.pid===pid);
  if(!p?.canKill || p.identity!==expected || await identity(pid)!==expected) throw Error('进程已变化、已退出或受保护，请刷新后重试');
  if(process.platform==='win32') await windowsTerminate(pid,expected);
  else process.kill(pid,'SIGKILL');
}
