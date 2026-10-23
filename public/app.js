import { City } from "./city.js";
import {
  Telemetry,
  processKey,
  formatBytes,
  sparkPath,
  csvFor,
} from "./model.js";
const $ = (id) => document.getElementById(id);
const model = new Telemetry();
const started = Date.now(),
  rows = new Map(),
  pinned = new Set();
let city,
  selected,
  filter = "all",
  sortBy = "memory",
  mode = "memory",
  chartMode = "cpu",
  connected = false,
  pendingKill,
  killing = false,
  lastError = "",
  stats = {};
let settings = {
  quality: "auto",
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
};
try {
  const saved = JSON.parse(localStorage.getItem("metropolis-settings") || "{}");
  if (["auto", "smooth", "sharp"].includes(saved.quality))
    settings.quality = saved.quality;
  if (typeof saved.motion === "boolean") settings.motion = saved.motion;
} catch {}
const text = (node, value) => {
  if (node.textContent !== String(value)) node.textContent = value;
};
const time = (stamp) =>
  new Date(stamp).toLocaleTimeString("zh-CN", { hour12: false });
const duration = (ms) =>
  [
    Math.floor(ms / 3600000),
    Math.floor(ms / 60000) % 60,
    Math.floor(ms / 1000) % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
const healthy = () =>
  connected && model.timestamp && Date.now() - model.timestamp < 8000;
function saveSettings() {
  try {
    localStorage.setItem("metropolis-settings", JSON.stringify(settings));
  } catch {}
}
function toast(message) {
  text($("toast"), message);
  $("toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").style.display = "none"), 4200);
}
function matchingProcesses() {
  const query = $("search").value.trim().toLocaleLowerCase();
  return [...model.current.values()]
    .filter(
      (p) =>
        (!query ||
          p.name.toLocaleLowerCase().includes(query) ||
          String(p.pid).includes(query)) &&
        (filter !== "active" || p.cpu >= 1) &&
        (filter !== "manageable" || p.canKill),
    )
    .sort(
      (a, b) =>
        Number(pinned.has(processKey(b))) - Number(pinned.has(processKey(a))) ||
        (sortBy === "name"
          ? a.name.localeCompare(b.name)
          : b[sortBy] - a[sortBy]) ||
        a.pid - b.pid,
    );
}
function makeRow() {
  const row = document.createElement("button");
  row.className = "row";
  row.type = "button";
  const icon = document.createElement("span");
  icon.className = "row-icon";
  icon.textContent = "▥";
  icon.setAttribute("aria-hidden", "true");
  const nameWrap = document.createElement("div");
  nameWrap.className = "row-name";
  const name = document.createElement("span"),
    pid = document.createElement("small");
  nameWrap.append(name, pid);
  const resource = document.createElement("div");
  resource.className = "row-mem";
  const value = document.createElement("span"),
    cpu = document.createElement("small");
  resource.append(value, cpu);
  row.append(icon, nameWrap, resource);
  row.parts = { name, pid, value, cpu };
  row.onclick = () => select(row.process);
  return row;
}
function renderList() {
  const list = matchingProcesses(),
    keys = new Set(list.map(processKey)),
    container = $("process-list");
  for (const [key, row] of rows)
    if (!keys.has(key)) {
      row.remove();
      rows.delete(key);
    }
  let cursor = container.firstElementChild;
  for (const p of list) {
    const key = processKey(p);
    let row = rows.get(key);
    if (!row) {
      row = makeRow();
      rows.set(key, row);
    }
    row.process = p;
    row.dataset.pid = p.pid;
    row.dataset.hot = String(p.cpu > 75);
    row.classList.toggle("selected", selected?.key === key);
    row.classList.toggle("row-pinned", pinned.has(key));
    row.setAttribute("aria-pressed", String(selected?.key === key));
    text(row.parts.name, p.name);
    text(row.parts.pid, `PID ${p.pid}${p.canKill ? "" : " · 受保护"}`);
    text(row.parts.value, formatBytes(p.memory));
    text(row.parts.cpu, `${p.cpu.toFixed(1)}% CPU`);
    row.title = `${p.name} · PID ${p.pid}`;
    // Keep nodes, keyboard focus and scroll position instead of rebuilding the list every sample.
    if (row !== cursor) container.insertBefore(row, cursor);
    else cursor = cursor.nextElementSibling;
  }
  $("list-empty").hidden = list.length > 0;
  text(
    $("list-summary"),
    list.length === model.current.size
      ? "进程名称 / PID"
      : `筛选结果 ${list.length} / ${model.current.size}`,
  );
}
function select(process) {
  if (!process) {
    selected = null;
    city?.select(null);
    renderList();
    renderDetail();
    return;
  }
  const key = processKey(process),
    live = model.current.get(key);
  selected = { ...(live || process), key, alive: !!live };
  city?.select(key);
  if (city && selected.alive && !city.buildings.has(key)) updateCity();
  $("scene-tooltip").hidden = true;
  renderList();
  renderDetail();
}
function updateDetailAvailability() {
  const live = selected?.alive && healthy();
  $("kill").disabled = !live || !selected?.canKill || killing;
  text(
    $("kill"),
    killing
      ? "正在结束…"
      : !selected?.alive
        ? "进程已退出"
        : !healthy()
          ? "等待实时连接"
          : selected.canKill
            ? "结束进程"
            : "受保护",
  );
  $("detail-focus").disabled = !selected?.alive || !city;
  $("focus").disabled = !selected?.alive || !city;
}
function renderDetail() {
  const has = !!selected;
  $("detail-empty").hidden = has;
  $("detail-content").hidden = !has;
  $("pin").disabled = !has || !selected.alive;
  if (!has) {
    updateDetailAvailability();
    return;
  }
  text($("detail-name"), selected.name);
  $("detail-name").title = selected.name;
  const status = $("detail-status");
  text(status, selected.alive ? "运行中" : "已退出");
  status.classList.toggle("exited", !selected.alive);
  text(
    $("detail-meta"),
    `PID ${selected.pid}  /  PPID ${selected.ppid}${selected.sessionId !== undefined ? `  /  会话 ${selected.sessionId}` : `  /  UID ${selected.uid}`}`,
  );
  text($("detail-cpu"), `${selected.cpu.toFixed(1)}%`);
  text($("detail-memory"), formatBytes(selected.memory));
  const samples = model.processHistory.get(selected.key) || [];
  $("detail-spark").setAttribute(
    "d",
    sparkPath(
      samples.map((s) => s[chartMode]),
      300,
      46,
    ),
  );
  $("detail-spark").style.stroke =
    chartMode === "cpu" ? "var(--cyan)" : "var(--purple)";
  text(
    $("detail-history"),
    samples.length < 2
      ? "趋势累积中"
      : `${Math.round((samples.at(-1).timestamp - samples[0].timestamp) / 1000)} 秒 · ${samples.length} 个采样`,
  );
  text(
    $("detail-chart-label"),
    chartMode === "cpu" ? "CPU 趋势 · 单核基准" : "常驻内存趋势",
  );
  text($("chart-mode"), chartMode === "cpu" ? "切换到内存 ↗" : "切换到 CPU ↗");
  const pin = pinned.has(selected.key);
  text($("pin"), pin ? "★" : "☆");
  $("pin").setAttribute("aria-pressed", String(pin));
  $("pin").title = pin ? "取消置顶" : "置顶此进程";
  $("pin").setAttribute("aria-label", $("pin").title);
  updateDetailAvailability();
}
function renderEvents() {
  text($("event-count"), model.events.length);
  text($("nav-event-count"), model.events.length);
  $("events-empty").hidden = model.events.length > 0;
  const existing = new Map(
    [...$("event-list").children].map((el) => [Number(el.dataset.id), el]),
  );
  const ids = new Set(model.events.map((e) => e.id));
  for (const [id, node] of existing) if (!ids.has(id)) node.remove();
  let cursor = $("event-list").firstElementChild;
  for (const event of model.events) {
    let row = existing.get(event.id);
    if (!row) {
      row = document.createElement("div");
      row.className = "event-row";
      row.dataset.id = event.id;
      row.dataset.type = event.type;
      const icon = document.createElement("span");
      icon.className = "event-icon";
      icon.textContent =
        event.type === "start" ? "↗" : event.type === "exit" ? "↘" : "△";
      const content = document.createElement("div"),
        label = document.createElement(event.process ? "button" : "p");
      label.textContent = event.text;
      if (event.process) {
        label.className = "event-process";
        label.onclick = () => select(event.process);
        label.title = "查看此进程详情";
      }
      const meta = document.createElement("small");
      meta.textContent = `${time(event.timestamp)}${event.process ? ` · PID ${event.process.pid}` : ""}`;
      content.append(label, meta);
      row.append(icon, content);
    }
    if (row !== cursor) $("event-list").insertBefore(row, cursor);
    else cursor = cursor.nextElementSibling;
  }
}
function renderDashboard() {
  const sample = model.latest,
    previous = model.history.at(-2),
    data = model.data;
  text($("cpu"), `${sample.cpu.toFixed(1)}%`);
  text($("cores"), `${data.cores} 逻辑核`);
  text(
    $("cpu-change"),
    previous
      ? `${sample.cpu >= previous.cpu ? "↗" : "↘"} ${Math.abs(sample.cpu - previous.cpu).toFixed(1)}% 较上次`
      : "首个采样",
  );
  text($("memory"), `${sample.memory.toFixed(1)}%`);
  text(
    $("memory-detail"),
    `${formatBytes(data.usedMemory)} / ${formatBytes(data.totalMemory)}`,
  );
  text($("total-processes"), sample.count);
  text($("count"), sample.count);
  text($("born-count"), `↑ ${model.starts} 新增`);
  text($("exit-count"), `↓ ${model.exits} 退出`);
  text(
    $("quake"),
    sample.cpu >= 80
      ? "高负载 · 城市震动预警"
      : "最近 2 分钟 · 按逻辑核数归一化",
  );
  $("cpu-spark").setAttribute(
    "d",
    sparkPath(
      model.history.map((s) => s.cpu),
      260,
      34,
      100,
    ),
  );
  $("memory-spark").setAttribute(
    "d",
    sparkPath(
      model.history.map((s) => s.memory),
      260,
      34,
      100,
    ),
  );
  $("count-spark").setAttribute(
    "d",
    sparkPath(
      model.history.map((s) => s.count),
      260,
      34,
    ),
  );
  const pressure = sample.cpu >= 80 || sample.memory >= 85;
  text(
    $("health"),
    sample.memory >= 85
      ? "内存压力偏高"
      : sample.cpu >= 80
        ? "系统负载偏高"
        : "城市平稳运行",
  );
  $("health").style.color = pressure ? "var(--amber)" : "var(--text)";
  $("health-icon").style.color = pressure ? "var(--amber)" : "var(--cyan)";
  $("health-bar").style.width =
    `${Math.max(4, 100 - Math.max(sample.cpu, sample.memory))}%`;
  $("health-bar").style.background = pressure ? "var(--amber)" : "";
  text(
    $("history-label"),
    `${model.history.length} 个采样 · 最多保留 2 分钟 · 仅本次会话`,
  );
  if (data.version) text($("app-version"), data.version);
  text($("host"), data.hostname);
  text($("system"), data.platform.toUpperCase());
}
function updateCity() {
  if (!city || !model.data) return;
  city.update([...model.current.values()], {
    cpu: model.latest.cpu,
    memory: model.latest.memory,
    mode,
    selected: selected?.key,
  });
  text(
    $("visible-count"),
    `${city.buildings.size} / ${Math.min(100, model.current.size)}`,
  );
  text(
    $("scene-status"),
    `${city.buildings.size} 座建筑 / ${model.current.size} 个进程`,
  );
}
function activateTab(tab) {
  const events = tab === "events";
  $("events-panel").hidden = !events;
  $("process-panel").hidden = events;
  for (const [id, on] of [
    ["tab-events", events],
    ["tab-processes", !events],
  ]) {
    $(id).classList.toggle("active", on);
    $(id).setAttribute("aria-selected", String(on));
  }
  $("nav-city").classList.toggle("active", !events);
  $("nav-events").classList.toggle("active", events);
}
function tick() {
  text($("clock"), time(Date.now()));
  text($("uptime"), duration(Date.now() - started));
  const age = model.timestamp
    ? Math.max(0, Math.floor((Date.now() - model.timestamp) / 1000))
    : null;
  const ok = healthy();
  text(
    $("connection"),
    !model.timestamp
      ? "正在连接"
      : !connected
        ? "连接中断"
        : ok
          ? "实时连接"
          : "采样延迟",
  );
  $("connection").parentElement.classList.toggle(
    "offline",
    !!model.timestamp && !ok,
  );
  text($("sample-age"), age === null ? "等待遥测" : `${age} 秒前更新`);
  updateDetailAvailability();
}
async function poll() {
  try {
    const response = await fetch("/api/processes", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }),
      data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    connected = true;
    lastError = "";
    if (model.ingest(data)) {
      if (selected) {
        const live = model.current.get(selected.key);
        selected = live
          ? { ...live, key: selected.key, alive: true }
          : { ...selected, alive: false };
      }
      renderDashboard();
      renderList();
      renderDetail();
      renderEvents();
      updateCity();
    }
    if (city) $("empty-city").hidden = true;
  } catch (error) {
    connected = false;
    if (lastError !== error.message) {
      lastError = error.message;
      toast(`连接暂时不可用：${error.message}`);
    }
    if (city) {
      $("empty-city").hidden = false;
      text($("empty-city"), "遥测连接中断，正在重连。保留最后一次城市快照。");
    }
  } finally {
    tick();
    setTimeout(poll, 2000);
  }
}
$("search").addEventListener("input", renderList);
for (const button of document.querySelectorAll("[data-filter]"))
  button.onclick = () => {
    filter = button.dataset.filter;
    for (const other of document.querySelectorAll("[data-filter]")) {
      const on = other === button;
      other.classList.toggle("active", on);
      other.setAttribute("aria-pressed", String(on));
    }
    renderList();
  };
$("sort").onclick = () => {
  const modes = ["memory", "cpu", "name"];
  sortBy = modes[(modes.indexOf(sortBy) + 1) % modes.length];
  text($("sort"), { memory: "内存 ↓", cpu: "CPU ↓", name: "名称 A–Z" }[sortBy]);
  renderList();
};
for (const button of document.querySelectorAll("[data-mode]"))
  button.onclick = () => {
    mode = button.dataset.mode;
    for (const other of document.querySelectorAll("[data-mode]")) {
      const on = other === button;
      other.classList.toggle("active", on);
      other.setAttribute("aria-pressed", String(on));
    }
    text(
      $("mapping-label"),
      mode === "memory"
        ? "建筑高度映射常驻内存"
        : "建筑高度与色温映射 CPU · 单核基准",
    );
    updateCity();
  };
$("tab-events").onclick = $("nav-events").onclick = () => activateTab("events");
$("tab-processes").onclick = $("nav-city").onclick = () =>
  activateTab("processes");
$("pin").onclick = () => {
  if (!selected) return;
  pinned.has(selected.key)
    ? pinned.delete(selected.key)
    : pinned.add(selected.key);
  renderList();
  renderDetail();
};
$("chart-mode").onclick = () => {
  chartMode = chartMode === "cpu" ? "memory" : "cpu";
  renderDetail();
};
function focusSelected() {
  if (!selected?.alive) return;
  if (!city?.focus(selected.key)) {
    updateCity();
    city?.focus(selected.key);
  }
}
$("focus").onclick = $("detail-focus").onclick = focusSelected;
$("home").onclick = () => city?.home();
$("orbit").onclick = () => {
  if (!city) return;
  city.autoRotate = !city.autoRotate;
  if (city.autoRotate && !settings.motion) toggleMotion();
  $("orbit").setAttribute("aria-pressed", String(city.autoRotate));
};
function toggleMotion() {
  settings.motion = !settings.motion;
  if (city) city.motion = settings.motion;
  $("motion").setAttribute("aria-pressed", String(settings.motion));
  text(
    $("motion").querySelector("span"),
    settings.motion ? "动态开启" : "安静模式",
  );
  saveSettings();
}
$("motion").onclick = toggleMotion;
$("quality").value = settings.quality;
$("quality").onchange = () => {
  settings.quality = $("quality").value;
  city?.setQuality(settings.quality);
  saveSettings();
};
$("help").onclick = () => $("help-dialog").showModal();
$("export").onclick = () => {
  if (!model.data) return toast("等待采样后即可导出");
  const list = matchingProcesses();
  const url = URL.createObjectURL(
    new Blob([csvFor(list)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `process-metropolis-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${list.length} 个进程的当前快照`);
};
$("kill").onclick = () => {
  if (!selected?.alive || !selected.canKill || !healthy()) return;
  pendingKill = { ...selected };
  text(
    $("confirm-text"),
    `${selected.name} · PID ${selected.pid} · ${formatBytes(selected.memory)}`,
  );
  $("confirm").returnValue = "";
  $("confirm").showModal();
};
$("confirm").addEventListener("close", async () => {
  const target = pendingKill;
  pendingKill = null;
  if ($("confirm").returnValue !== "kill" || !target) return;
  if (!healthy()) return toast("实时数据已过期，请等待重新连接");
  killing = true;
  updateDetailAvailability();
  try {
    const response = await fetch("/api/kill", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Control-Token": model.data.token,
      },
      body: JSON.stringify({ pid: target.pid, identity: target.identity }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    toast(`${target.name} 已结束，等待城市更新`);
  } catch (error) {
    toast(`无法结束进程：${error.message}`);
  } finally {
    killing = false;
    updateDetailAvailability();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target.closest("input,select,textarea,dialog") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.key === "/") {
    event.preventDefault();
    activateTab("processes");
    $("search").focus();
  } else if (event.key === "?") $("help-dialog").showModal();
  else if (event.code === "Space") {
    if (event.target.closest("button,a")) return;
    event.preventDefault();
    toggleMotion();
  } else if (event.key === "Escape") {
    select(null);
  } else if (event.key.toLowerCase() === "h") city?.home();
  else if (event.key.toLowerCase() === "f") focusSelected();
});
try {
  city = new City($("scene"), {
    onSelect: select,
    onHover: (process, event) => {
      const tip = $("scene-tooltip");
      tip.hidden = !process;
      if (!process) return;
      text(
        tip,
        `${process.name}\nPID ${process.pid} · ${formatBytes(process.memory)}\nCPU ${process.cpu.toFixed(1)}% · 双击聚焦`,
      );
      const rect = $("scene").getBoundingClientRect();
      tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 245)}px`;
      tip.style.top = `${Math.min(event.clientY - rect.top + 12, rect.height - 175)}px`;
    },
    onStats: (value) => {
      stats = value;
      text($("fps"), `${value.fps} FPS`);
      $("fps").title = value.software
        ? "软件图形模式 · 可选择流畅画质"
        : "硬件图形模式 · 自动平衡清晰度与帧率";
    },
  });
  city.motion = settings.motion;
  city.setQuality(settings.quality);
  $("motion").setAttribute("aria-pressed", String(settings.motion));
  text(
    $("motion").querySelector("span"),
    settings.motion ? "动态开启" : "安静模式",
  );
} catch (error) {
  $("empty-city").hidden = false;
  text(
    $("empty-city"),
    `3D 视图暂不可用：${error.message}。右侧监控仍可使用。`,
  );
  for (const id of ["home", "focus", "orbit", "motion", "quality"])
    $(id).disabled = true;
}
Object.defineProperty(window, "__metropolisDiagnostics", {
  get: () => ({
    ...stats,
    samples: model.history.length,
    events: model.events.length,
    mode,
  }),
});
window.addEventListener("pagehide", () => city?.destroy(), { once: true });
tick();
setInterval(tick, 1000);
poll();
