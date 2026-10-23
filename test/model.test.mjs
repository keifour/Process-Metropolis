import test from "node:test";
import assert from "node:assert/strict";
import { Telemetry, processKey, sparkPath, csvFor } from "../public/model.js";
const p = (pid, identity = "start-a", cpu = 2) => ({
  pid,
  ppid: 1,
  identity,
  name: `process-${pid}`,
  cpu,
  memory: 1048576,
  canKill: true,
});
const snapshot = (timestamp, processes) => ({
  timestamp,
  processes,
  cores: 4,
  totalMemory: 100,
  usedMemory: 40,
});
test("telemetry distinguishes resource reordering, exits and PID reuse", () => {
  const m = new Telemetry();
  m.ingest(snapshot(1000, [p(1), p(2)]));
  m.ingest(snapshot(3000, [p(2), p(1)]));
  assert.equal(m.events.length, 0);
  m.ingest(snapshot(5000, [p(2), p(1, "start-b")]));
  assert.equal(m.starts, 1);
  assert.equal(m.exits, 1);
  assert.equal(m.events.filter((e) => e.type === "start").length, 1);
  assert.equal(m.events.filter((e) => e.type === "exit").length, 1);
  assert.ok(m.current.has(processKey(p(1, "start-b"))));
  assert.equal(m.current.has(processKey(p(1))), false);
});
test("history ignores repeated snapshots, bounds memory and expires old samples", () => {
  const m = new Telemetry(3);
  m.ingest(snapshot(1000, [p(1)]));
  assert.equal(m.ingest(snapshot(1000, [p(1)])), false);
  for (let i = 1; i <= 5; i++) m.ingest(snapshot(1000 + i * 2000, [p(1)]));
  assert.equal(m.history.length, 3);
  assert.equal(m.processHistory.get(processKey(p(1))).length, 3);
  m.ingest(snapshot(200000, [p(2)]));
  assert.equal(m.history.length, 1);
  assert.equal(m.processHistory.has(processKey(p(1))), false);
});
test("CPU is normalized by cores and warnings have hysteresis", () => {
  const m = new Telemetry();
  m.ingest(snapshot(1000, [p(1, "a", 340)]));
  assert.equal(m.latest.cpu, 85);
  assert.equal(m.events.filter((e) => e.type === "warning").length, 1);
  m.ingest(snapshot(3000, [p(1, "a", 320)]));
  assert.equal(m.events.filter((e) => e.type === "warning").length, 1);
  m.ingest(snapshot(5000, [p(1, "a", 200)]));
  m.ingest(snapshot(7000, [p(1, "a", 340)]));
  assert.equal(m.events.filter((e) => e.type === "warning").length, 2);
});
test("CSV handles Chinese names, quotes and spreadsheet formula injection", () => {
  const csv = csvFor([{ ...p(7), name: ' =HYPERLINK("恶意")' }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\' =HYPERLINK(""恶意"")"'));
  assert.ok(csv.includes("父进程 PID"));
});
test("sparklines handle an empty or constant history and invalid values", () => {
  assert.equal(sparkPath([]), "");
  assert.match(sparkPath([0]), /^M0,.*L260,/);
  assert.doesNotMatch(sparkPath([Infinity, NaN, 2]), /NaN|Infinity/);
  assert.match(sparkPath([10, 20]), /L260\.00,/);
});
