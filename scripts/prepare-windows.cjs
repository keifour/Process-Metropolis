const {existsSync,mkdirSync,statSync}=require('node:fs');
const {join}=require('node:path');
const {execFileSync}=require('node:child_process');
function prepareWindows(root=join(__dirname,'..')){
 if(process.platform!=='win32')return;
 const source=join(root,'desktop','windows-helper.cs');const output=join(root,'build','windows-helper.exe');
 if(existsSync(output)&&statSync(output).mtimeMs>=statSync(source).mtimeMs)return;
 const compiler=join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 if(!existsSync(compiler))throw Error('Windows .NET Framework 4 compiler is required to build the native monitor helper');
 mkdirSync(join(root,'build'),{recursive:true});
 execFileSync(compiler,['/nologo','/optimize+','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll',`/out:${output}`,source],{stdio:'inherit',windowsHide:true});
}
module.exports=prepareWindows;
if(require.main===module)prepareWindows();
