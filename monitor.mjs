import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
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
  if (process.platform === 'linux') {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
  }
  return (await exec('ps',['-p',String(pid),'-o','lstart='])).stdout.trim();
}
export async function snapshot() {
  if (process.platform === 'win32') throw new Error('当前版本支持 Linux 和 macOS；Windows 请在 WSL 中运行。');
  const {stdout} = await exec('ps',['-axo','pid=,ppid=,%cpu=,rss=,uid=,comm='],{maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C'}});
  const processes = parseProcesses(stdout);
  const now = performance.now();
  await Promise.all(processes.map(async p => {
    try {
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
  for(const p of processes) p.canKill = !!p.identity && !protectedPids.has(p.pid) && p.uid === process.getuid() && p.uid !== 0;
  return {processes:processes.sort((a,b)=>b.memory-a.memory),totalMemory:os.totalmem(),usedMemory:os.totalmem()-os.freemem(),cores:os.cpus().length,platform:process.platform,hostname:os.hostname(),timestamp:Date.now()};
}
