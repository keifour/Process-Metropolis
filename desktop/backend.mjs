import {startServer} from '../server.mjs';
import {protectProcessTree} from '../monitor.mjs';
protectProcessTree(Number(process.env.PROCESS_METROPOLIS_DESKTOP_PID));
const port=process.parentPort;
try{
 const service=await startServer({port:0});
 port.on('message',async({data})=>{
  try{
   if(data.type==='refresh')port.postMessage({type:'result',id:data.id,value:await service.refresh()});
   else if(data.type==='close'){await service.close();process.exit(0);}
  }catch(error){port.postMessage({type:'result',id:data.id,error:error.message});}
 });
 port.postMessage({type:'ready',url:service.url,pid:process.pid});
}catch(error){port.postMessage({type:'error',error:error.stack});process.exit(1);}
