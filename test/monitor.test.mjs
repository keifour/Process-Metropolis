import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProcesses,snapshot} from '../monitor.mjs';
test('parses process metrics and command names with spaces',()=>{const [p]=parseProcesses(' 42 1 12.5 2048 1000 /Applications/My Browser');assert.equal(p.pid,42);assert.equal(p.memory,2097152);assert.equal(p.name,'My Browser');assert.equal(p.cpu,12.5);assert.deepEqual(parseProcesses(''),[]);});
test('samples real processes and protects monitor and ancestors',async()=>{const result=await snapshot();assert.ok(result.processes.length>0);assert.ok(result.totalMemory>0);const self=result.processes.find(p=>p.pid===process.pid);assert.ok(self);assert.equal(self.canKill,false);assert.ok(self.identity);const parent=result.processes.find(p=>p.pid===process.ppid);if(parent)assert.equal(parent.canKill,false);});
