import {app,BrowserWindow,dialog,session} from 'electron';
import {writeFile} from 'node:fs/promises';
import {startServer} from '../server.mjs';
let window,service;
const smokePath=process.env.PROCESS_METROPOLIS_SMOKE_REPORT;
if(smokePath){app.disableHardwareAcceleration();app.commandLine.appendSwitch('enable-unsafe-swiftshader');}
if(!app.requestSingleInstanceLock()) app.quit();
else {
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  service=await startServer({port:0});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window=new BrowserWindow({width:smokePath?1024:1440,height:smokePath?768:1000,minWidth:960,minHeight:700,backgroundColor:'#080e14',title:'Process Metropolis · 进程大都会',autoHideMenuBar:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.removeMenu();
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==service.url && url!==service.url+'/')event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{callback({cancel:!details.url.startsWith(service.url+'/')});});
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(service.url);
  if(smokePath){
   const ui=await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<120;i++){if(document.querySelectorAll('.row').length && document.querySelector('#connection').textContent==='实时连接'){const webgl=!!document.querySelector('#scene').getContext('webgl2');document.querySelector('.row').click();const selected=!!document.querySelector('#detail h3').textContent;return {rows:document.querySelectorAll('.row').length,webgl,selected};}await new Promise(r=>setTimeout(r,500));}throw Error('Desktop telemetry did not become ready');})()`);
   if(!ui.webgl||!ui.selected)throw Error('Desktop renderer validation failed');
   const data=await service.refresh();
   const report={ok:true,version:app.getVersion(),platform:process.platform,packaged:app.isPackaged,processCount:data.processes.length,selfProtected:data.processes.find(p=>p.pid===process.pid)?.canKill===false,ui};
   if(!report.selfProtected)throw Error('Desktop main process is not protected');
   await writeFile(smokePath,JSON.stringify(report,null,2));
   app.quit();
  }
 }).catch(async error=>{if(smokePath){await writeFile(smokePath,JSON.stringify({ok:false,error:error.stack})).catch(()=>{});app.exit(1);}else{dialog.showErrorBox('Process Metropolis 启动失败',error.message);app.quit();}});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{service?.close().catch(()=>{});});
}
