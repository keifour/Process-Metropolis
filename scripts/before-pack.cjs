const {mkdir,copyFile}=require('node:fs/promises');
const path=require('node:path');
module.exports=async context=>{
 const target=path.join(context.packager.info.appDir,'public','vendor');
 await mkdir(target,{recursive:true});
 // electron-builder excludes dependency examples by default; retain the one runtime module we use.
 await copyFile(path.join(context.packager.info.appDir,'node_modules','three','examples','jsm','controls','OrbitControls.js'),path.join(target,'OrbitControls.js'));
};
