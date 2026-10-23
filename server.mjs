import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {snapshot,terminateProcess} from './monitor.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export async function startServer({port = Number(process.env.PORT || 3000)} = {}) {
const token=randomBytes(32).toString('hex');
let state, failure, sampling;
function sample(){
 if(sampling)return sampling;
 sampling=(async()=>{try{state=await snapshot();failure=null;}catch(e){failure=e.message;}finally{sampling=null;}})();
 return sampling;
}
await sample();
const interval=setInterval(sample,2000);interval.unref();
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
      try { await terminateProcess(pid,expected); } catch(e) { return json(409,{error:e.message}); }
      await sample();return json(200,{ok:true,pid});
    }catch(e){return json(400,{error:e.code==='ESRCH'?'进程已退出':e.message});}
  }
  if(req.method!=='GET'||!files[path])return json(404,{error:'Not found'});
  try{const body=path==='/vendor/OrbitControls.js' ? await readFile(new URL('public/vendor/OrbitControls.js',import.meta.url)).catch(()=>readFile(new URL(files[path],import.meta.url))) : await readFile(new URL(files[path],import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);}catch{json(500,{error:'资源未安装，请运行 npm ci'});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
port=server.address().port;
return {url:`http://127.0.0.1:${port}`,close:()=>{clearInterval(interval);server.closeAllConnections();return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const service=await startServer();console.log(`Process Metropolis: ${service.url}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
}
