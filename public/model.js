export const processKey = (p) => `${p.pid}:${p.identity ?? "unknown"}`;
export const formatBytes = (n) =>
  n >= 1073741824
    ? `${(n / 1073741824).toFixed(1)} GB`
    : `${(n / 1048576).toFixed(0)} MB`;
export function sparkPath(values, width = 260, height = 48, ceiling) {
  if (!values.length) return "";
  const clean = values.map((n) => (Number.isFinite(n) ? Math.max(0, n) : 0));
  const max = Math.max(ceiling || 0, ...clean, 1);
  const y = (v) => (height - 3 - (v / max) * (height - 6)).toFixed(2);
  if (clean.length === 1) return `M0,${y(clean[0])}L${width},${y(clean[0])}`;
  return clean
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / (clean.length - 1)) * width).toFixed(2)},${y(v)}`,
    )
    .join("");
}
export function csvFor(processes) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      ["PID", "父进程 PID", "进程名称", "CPU %（单核）", "常驻内存 MB", "状态"],
      ...processes.map((p) => [
        p.pid,
        p.ppid,
        p.name,
        p.cpu.toFixed(1),
        (p.memory / 1048576).toFixed(2),
        p.canKill ? "可结束" : "受保护",
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export class Telemetry {
  constructor(limit = 60) {
    this.limit = limit;
    this.current = new Map();
    this.history = [];
    this.processHistory = new Map();
    this.events = [];
    this.timestamp = 0;
    this.cpuAlarm = false;
    this.memoryAlarm = false;
    this.serial = 0;
    this.starts = 0;
    this.exits = 0;
  }
  event(type, text, timestamp, process = null) {
    this.events.unshift({ id: ++this.serial, type, text, timestamp, process });
    this.events.length = Math.min(this.events.length, 80);
  }
  ingest(data) {
    if (!Number.isFinite(data.timestamp) || data.timestamp <= this.timestamp)
      return false;
    const next = new Map(data.processes.map((p) => [processKey(p), p]));
    let born = 0,
      exited = 0;
    if (this.timestamp) {
      for (const [key, p] of next)
        if (!this.current.has(key)) {
          born++;
          this.event("start", `${p.name} 加入街区`, data.timestamp, p);
        }
      for (const [key, p] of this.current)
        if (!next.has(key)) {
          exited++;
          this.event("exit", `${p.name} 已退出`, data.timestamp, p);
        }
    }
    this.starts += born;
    this.exits += exited;
    const cpu = Math.min(
      100,
      data.processes.reduce((sum, p) => sum + Math.max(0, p.cpu), 0) /
        Math.max(1, data.cores),
    );
    const memory = (data.usedMemory / data.totalMemory) * 100;
    if (!this.cpuAlarm && cpu >= 80)
      this.event(
        "warning",
        "CPU 超过 80% · 城市进入高负载状态",
        data.timestamp,
      );
    if (!this.memoryAlarm && memory >= 85)
      this.event("warning", "物理内存超过 85% · 注意系统压力", data.timestamp);
    this.cpuAlarm = cpu >= (this.cpuAlarm ? 65 : 80);
    this.memoryAlarm = memory >= (this.memoryAlarm ? 78 : 85);
    this.history.push({
      cpu,
      memory,
      count: next.size,
      timestamp: data.timestamp,
      born,
      exited,
    });
    while (
      this.history.length > this.limit ||
      this.history[0]?.timestamp < data.timestamp - 120000
    )
      this.history.shift();
    for (const [key, p] of next) {
      const samples = this.processHistory.get(key) || [];
      samples.push({ cpu: p.cpu, memory: p.memory, timestamp: data.timestamp });
      while (
        samples.length > this.limit ||
        samples[0]?.timestamp < data.timestamp - 120000
      )
        samples.shift();
      this.processHistory.set(key, samples);
    }
    for (const [key, samples] of this.processHistory)
      if (!next.has(key) && data.timestamp - samples.at(-1).timestamp > 120000)
        this.processHistory.delete(key);
    this.current = next;
    this.data = data;
    this.timestamp = data.timestamp;
    return true;
  }
  get latest() {
    return this.history.at(-1);
  }
}
