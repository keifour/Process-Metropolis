import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {snapshot,identity} from './monitor.mjs';
const port = Number(process.env.PORT || 3000);
const token=randomBytes(32).toString('hex');
let state, failure;
async function sample(){try{state=await snapshot();failure=null;}catch(e){failure=e.message;}}
await sample();
setInterval(sample,2000).unref();
const files={'/':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css','/vendor/three.js':'node_modules/three/build/three.module.js','/vendor/three.core.js':'node_modules/three/build/three.core.js','/vendor/OrbitControls.js':'node_modules/three/examples/jsm/controls/OrbitControls.js'};
const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`].includes(host)) return json(403,{error:'仅允许本机访问'});
  const path=new URL(req.url,`http://${host}`).pathname;
  if(path==='/api/processes' && req.method==='GET') return failure?json(503,{error:failure}):json(200,{...state,token});
  if(path==='/api/kill' && req.method==='POST') {
    if(req.headers.origin!==`http://${host}`) return json(403,{error:'来源校验失败'});
    const supplied=Buffer.from(req.headers['x-control-token']||'');
    if(supplied.length!==token.length || !timingSafeEqual(supplied,Buffer.from(token))) return json(403,{error:'会话校验失败'});
    try {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return json(413,{error:'请求过大'});}
      const {pid,identity:expected}=JSON.parse(body);
      if(!Number.isInteger(pid)||pid<2) return json(400,{error:'无效 PID'});
      const fresh=await snapshot();const p=fresh.processes.find(p=>p.pid===pid);
      if(!p?.canKill || p.identity!==expected || await identity(pid)!==expected) return json(409,{error:'进程已变化、已退出或受保护，请刷新后重试'});
      process.kill(pid,'SIGKILL');await sample();return json(200,{ok:true,pid});
    }catch(e){return json(400,{error:e.code==='ESRCH'?'进程已退出':e.message});}
  }
  if(req.method!=='GET'||!files[path])return json(404,{error:'Not found'});
  try{const body=await readFile(new URL(files[path],import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);}catch{json(500,{error:'资源未安装，请运行 npm ci'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Process Metropolis: http://127.0.0.1:${port}`));
