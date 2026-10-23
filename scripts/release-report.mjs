// Publish a small build receipt over Git so release results remain inspectable when API access is unavailable.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
const ref=process.env.GITHUB_REF_NAME;
const branch=`release-reports/${ref}`;
const git=(args,input)=>execFileSync('git',args,{input,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'github-actions[bot]',GIT_AUTHOR_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',GIT_COMMITTER_NAME:'github-actions[bot]',GIT_COMMITTER_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com'}}).trim();
const report={status:process.env.BUILD_STATUS,commit:process.env.GITHUB_SHA,ref,run:`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,timestamp:new Date().toISOString()};
const entries=[];
const add=(name,body)=>{const hash=git(['hash-object','-w','--stdin'],body);entries.push(`100644 blob ${hash}\t${name}`);};
add('report.json',JSON.stringify(report,null,2));
for(const name of ['tests.log','build.log','smoke.log','publish.log','release.json','smoke-desktop.json','smoke-portable.json','SHA256SUMS.txt']){
 const path=`artifacts/${name}`;if(existsSync(path))add(name,readFileSync(path));
}
const tree=git(['mktree'],entries.join('\n')+'\n');
const remote=git(['ls-remote','--heads','origin',`refs/heads/${branch}`]);
const parent=[];
if(remote){git(['fetch','origin',`refs/heads/${branch}`]);parent.push('-p',git(['rev-parse','FETCH_HEAD']));}
const commit=git(['commit-tree',tree,...parent],`Build receipt for ${ref} (${report.status})\n`);
git(['push','origin',`${commit}:refs/heads/${branch}`]);
console.log(`Saved build receipt: ${branch}`);
