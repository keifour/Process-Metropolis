import {spawn} from 'node:child_process';
import {readFile,mkdir,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const exeIndex=process.argv.indexOf('--exe');
const reportIndex=process.argv.indexOf('--report');
const report=resolve(reportIndex<0?'artifacts/smoke-desktop.json':process.argv[reportIndex+1]);
await mkdir(resolve('artifacts'),{recursive:true});await unlink(report).catch(()=>{});
const executable=exeIndex<0?(await import('electron')).default:resolve(process.argv[exeIndex+1]);
const args=[...(exeIndex<0?['.']:[]),...(process.platform==='linux'?['--no-sandbox']:[])];
const child=spawn(executable,args,{env:{...process.env,PROCESS_METROPOLIS_SMOKE_REPORT:report},stdio:'inherit'});
let spawnError;child.on('error',error=>{spawnError=error;});
try{
 const started=Date.now();let result;
 while(Date.now()-started<120000){
  if(spawnError)throw spawnError;
  try{result=JSON.parse(await readFile(report,'utf8'));break;}catch{}
  if(child.signalCode!==null)throw Error(`Desktop crashed: ${child.signalCode}`);
  if(child.exitCode!==null && child.exitCode!==0)throw Error(`Desktop exited with ${child.exitCode}`);
  await new Promise(r=>setTimeout(r,500));
 }
 if(!result?.ok)throw Error(result?.error||'Desktop smoke test timed out');
 if(exeIndex>=0 && !result.packaged)throw Error('Expected a packaged application');
 console.log(JSON.stringify(result,null,2));
 await new Promise(r=>setTimeout(r,1000));
}finally{
 if(child.exitCode===null && child.pid){
  if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'}).on('error',()=>{});
  else child.kill();
 }
}
