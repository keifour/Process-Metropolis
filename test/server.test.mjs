import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
test('HTTP workflow and controlled process termination',async t=>{
 const base='http://127.0.0.1:3219';
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'3219'},stdio:['ignore','pipe','pipe']});
 t.after(()=>server.kill());
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`server exited ${code}`)));});
 for(const path of ['/','/app.js','/style.css','/vendor/three.js','/vendor/three.core.js','/vendor/OrbitControls.js'])assert.equal((await fetch(base+path)).status,200,path);
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>child.kill());
 await new Promise(r=>setTimeout(r,2200));
 const state=await(await fetch(base+'/api/processes')).json();assert.ok(state.processes.length);
 const headers={'Content-Type':'application/json',Origin:base,'X-Control-Token':state.token};
 const post=(body,h=headers)=>fetch(base+'/api/kill',{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await post({},{})).status,403);
 assert.equal((await post({},{...headers,'X-Control-Token':'bad'})).status,403);
 assert.equal((await post({pid:1,identity:'x'})).status,400);
 await new Promise((resolve,reject)=>http.get(base+'/api/processes',{headers:{Host:'attacker.example'}},res=>{res.resume();try{assert.equal(res.statusCode,403);resolve();}catch(e){reject(e);}}).on('error',reject));
 const self=state.processes.find(p=>p.pid===server.pid);assert.equal(self.canKill,false);assert.equal((await post({pid:self.pid,identity:self.identity})).status,409);
 if(process.getuid()!==0){const target=state.processes.find(p=>p.pid===child.pid);assert.ok(target.canKill);assert.equal((await post({pid:target.pid,identity:'stale'})).status,409);const exit=new Promise(resolve=>child.once('exit',(_,signal)=>resolve(signal)));assert.equal((await post({pid:target.pid,identity:target.identity})).status,200);assert.equal(await exit,'SIGKILL');}
});
