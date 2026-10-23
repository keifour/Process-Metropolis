import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWindowsProcesses,criticalWindowsNames} from '../windows-monitor.mjs';
test('Windows process metrics preserve creation identity and names',()=>{
 const sample=parseWindowsProcesses(JSON.stringify({sessionId:2,processes:[{pid:42,ppid:10,name:'浏览器.exe',memory:2097152,cpuSeconds:1.5,identity:'638969530000000001',sessionId:2}]}));
 assert.equal(sample.sessionId,2);assert.equal(sample.processes[0].name,'浏览器');assert.equal(sample.processes[0].identity,'638969530000000001');assert.equal(sample.processes[0].memory,2097152);assert.equal(sample.processes[0].cpuSeconds,1.5);
 assert.equal(parseWindowsProcesses('{"sessionId":1,"processes":null}').processes.length,0);
 assert.ok(criticalWindowsNames.has('csrss'));assert.ok(criticalWindowsNames.has('lsass'));
});
