// Robotics Manufacturing Hub (static, GitHub Pages)
// Data: /data/files.json, /data/bom.json, /data/tasks.json
// Progress/state: localStorage + Export/Import snapshot

const LS_KEY = "rmh_state_v1";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

const state = {
  // progress for BOM: { partId: doneQty }
  bomDone: {},
  // task statuses override: { taskId: "todo|doing|done|blocked" }
  taskStatus: {}
};

let filesData = null;
let bomData = null;
let tasksData = null;

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      state.bomDone = parsed.bomDone || {};
      state.taskStatus = parsed.taskStatus || {};
    }
  } catch (e) {
    console.warn("State load failed", e);
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  renderGlobalStats();
}

function resetState() {
  state.bomDone = {};
  state.taskStatus = {};
  saveState();
  renderAll();
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function mergeImported(imported) {
  // conservative merge: keep imported values (they win)
  if (imported?.bomDone) state.bomDone = { ...state.bomDone, ...imported.bomDone };
  if (imported?.taskStatus) state.taskStatus = { ...state.taskStatus, ...imported.taskStatus };
  saveState();
  renderAll();
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed: ${path} (${r.status})`);
  return await r.json();
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function fmtDate(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return d;
  return x.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const A = new Date(a); const B = new Date(b);
  const ms = (B - A);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function setTab(name) {
  $$(".tab").forEach(btn => btn.classList.toggle("is-active", btn.dataset.tab === name));
  $$(".tabpane").forEach(p => p.classList.toggle("is-active", p.id === `tab-${name}`));
  $$(".tab").forEach(btn => btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false"));
}

// ---------- Render: Files ----------
function buildAssemblyOptions() {
  const sel = $("#filterAssembly");
  const set = new Set();
  filesData.items.forEach(it => { if (it.assembly) set.add(it.assembly); });
  const assemblies = Array.from(set).sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = `<option value="all">Todos</option>` + assemblies.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
}

function renderFiles() {
  const q = ($("#qFiles").value || "").toLowerCase().trim();
  const type = $("#filterType").value;
  const assembly = $("#filterAssembly").value;

  const filtered = filesData.items.filter(it => {
    if (type !== "all" && it.type !== type) return false;
    if (assembly !== "all" && (it.assembly || "") !== assembly) return false;

    if (!q) return true;
    const hay = [
      it.name, it.id, it.desc, it.assembly,
      ...(it.tags || [])
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  const plans = filtered.filter(x => x.type === "plan");
  const gcodes = filtered.filter(x => x.type === "gcode");

  $("#countPlans").textContent = `${plans.length} item(s)`;
  $("#countGcode").textContent = `${gcodes.length} item(s)`;

  $("#plansList").innerHTML = plans.map(renderFileItem).join("") || emptyMsg("Sin resultados");
  $("#gcodeList").innerHTML = gcodes.map(renderFileItem).join("") || emptyMsg("Sin resultados");

  // hook buttons
  $$(".btnCopy").forEach(b => b.onclick = () => {
    const url = b.dataset.url;
    navigator.clipboard?.writeText(url);
    b.textContent = "Copiado";
    setTimeout(()=> b.textContent="Copiar link", 900);
  });
}

function renderFileItem(it) {
  const tags = (it.tags || []).slice(0, 4).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join(" ");
  const meta = [
    it.id ? `<code>${escapeHtml(it.id)}</code>` : null,
    it.assembly ? `Ensamble: <strong>${escapeHtml(it.assembly)}</strong>` : null
  ].filter(Boolean).join(" • ");

  // URL relative to site
  const url = it.path;

  return `
  <div class="item">
    <div class="item__main">
      <div class="item__title">${escapeHtml(it.name)} ${tags ? `<span class="small"> ${tags}</span>` : ""}</div>
      <div class="item__meta">${meta}</div>
      ${it.desc ? `<div class="item__meta">${escapeHtml(it.desc)}</div>` : ""}
    </div>
    <div class="item__actions">
      <a class="btn btn--small" href="${escapeAttr(url)}" target="_blank" rel="noopener">Abrir</a>
      <a class="btn btn--small" href="${escapeAttr(url)}" download>Descargar</a>
      <button class="btn btn--small btnCopy" data-url="${escapeAttr(location.origin + location.pathname.replace(/\/index\.html$/, "/") + url.replace(/^\//,''))}">Copiar link</button>
    </div>
  </div>`;
}

// ---------- Render: BOM ----------
function getDone(partId) {
  return Number(state.bomDone[partId] || 0);
}

function setDone(partId, done) {
  if (done <= 0) delete state.bomDone[partId];
  else state.bomDone[partId] = done;
  saveState();
}

function bomTotals() {
  let req = 0, done = 0;
  for (const a of bomData.assemblies) {
    for (const p of a.parts) {
      req += p.qty;
      done += clamp(getDone(p.id), 0, p.qty);
    }
  }
  return { req, done, remaining: Math.max(0, req - done) };
}

function renderBOM() {
  const q = ($("#qBom").value || "").toLowerCase().trim();
  const view = $("#bomView").value;
  const filter = $("#bomOnlyPending").value;

  const { req, done, remaining } = bomTotals();
  const pct = req > 0 ? Math.round((done / req) * 100) : 0;

  $("#bomStats").innerHTML = `
    <span class="pill"><span class="k">BOM</span> <strong>${done}</strong>/<strong>${req}</strong> completadas</span>
    <span class="pill"><span class="k">Faltan</span> <strong>${remaining}</strong></span>
    <span class="pill"><span class="k">Avance</span> <strong>${pct}%</strong></span>
    <span class="pill"><div class="progress" aria-label="avance"><div style="width:${pct}%"></div></div></span>
  `;

  const container = $("#bomContainer");
  container.innerHTML = "";

  if (view === "flat") {
    const allParts = bomData.assemblies.flatMap(a => a.parts.map(p => ({...p, assembly:a.name})));
    const filtered = allParts.filter(p => bomPartMatches(p, q, filter));
    container.innerHTML = `
      <div class="subcard">
        <div class="subcard__head">
          <h2 class="h2">Piezas</h2>
          <span class="muted">${filtered.length} item(s)</span>
        </div>
        <div class="list">
          ${filtered.map(renderBomPartRow).join("") || emptyMsg("Sin resultados")}
        </div>
      </div>`;
  } else {
    // by assemblies (exploded)
    const blocks = bomData.assemblies.map(a => renderAssemblyBlock(a, q, filter)).join("");
    container.innerHTML = blocks || emptyMsg("Sin resultados");
    // collapsible handlers
    $$(".sectionTitle").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.target;
        const body = document.getElementById(id);
        const open = body.dataset.open === "1";
        body.dataset.open = open ? "0" : "1";
        body.style.display = open ? "none" : "block";
      };
    });
  }

  // qty handlers
  $$(".btnInc").forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const max = Number(b.dataset.max);
    const next = clamp(getDone(id) + 1, 0, max);
    setDone(id, next);
    renderBOM();
  });
  $$(".btnDec").forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const max = Number(b.dataset.max);
    const next = clamp(getDone(id) - 1, 0, max);
    setDone(id, next);
    renderBOM();
  });
  $$(".btnMax").forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const max = Number(b.dataset.max);
    setDone(id, max);
    renderBOM();
  });
}

function bomPartMatches(p, q, filter) {
  const done = clamp(getDone(p.id), 0, p.qty);
  const isDone = done >= p.qty;
  if (filter === "pending" && isDone) return false;
  if (filter === "done" && !isDone) return false;

  if (!q) return true;
  const hay = [
    p.id, p.name, p.material, p.process, p.notes, p.assembly
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

function renderAssemblyBlock(a, q, filter) {
  const parts = a.parts
    .map(p => ({...p, assembly:a.name}))
    .filter(p => bomPartMatches(p, q, filter));

  if (q && parts.length === 0) return "";

  // progress assembly
  let req = 0, done = 0;
  for (const p of a.parts) {
    req += p.qty;
    done += clamp(getDone(p.id), 0, p.qty);
  }
  const pct = req > 0 ? Math.round((done / req) * 100) : 0;
  const bodyId = `asm_${slug(a.name)}`;

  return `
    <div class="sectionTitle" data-target="${escapeAttr(bodyId)}">
      <div class="pair">
        <strong>${escapeHtml(a.name)}</strong>
        <span class="badge">${done}/${req}</span>
        <span class="muted small">${pct}%</span>
      </div>
      <div class="pair">
        <div class="progress" title="avance"><div style="width:${pct}%"></div></div>
        <span class="muted">click</span>
      </div>
    </div>

    <div class="sectionBody" id="${escapeAttr(bodyId)}" data-open="1" style="display:block;">
      <div class="list">
        ${parts.map(renderBomPartRow).join("") || emptyMsg("Sin piezas para este filtro")}
      </div>
    </div>
  `;
}

function renderBomPartRow(p) {
  const done = clamp(getDone(p.id), 0, p.qty);
  const remaining = Math.max(0, p.qty - done);
  const statusBadge = remaining === 0
    ? `<span class="badge" style="border-color: rgba(111,230,183,.45); color:#d9fff0;">OK</span>`
    : `<span class="badge" style="border-color: rgba(255,211,122,.45); color:#fff2d7;">PEND</span>`;

  const meta = [
    p.id ? `<code>${escapeHtml(p.id)}</code>` : null,
    p.assembly ? `Ensamble: <strong>${escapeHtml(p.assembly)}</strong>` : null,
    p.material ? `Mat: <strong>${escapeHtml(p.material)}</strong>` : null,
    p.process ? `Proc: <strong>${escapeHtml(p.process)}</strong>` : null
  ].filter(Boolean).join(" • ");

  return `
    <div class="item">
      <div class="item__main">
        <div class="item__title">${escapeHtml(p.name)} ${statusBadge}</div>
        <div class="item__meta">${meta}</div>
        ${p.notes ? `<div class="item__meta">${escapeHtml(p.notes)}</div>` : ""}
      </div>
      <div class="item__actions">
        <span class="badge">Req: ${p.qty}</span>
        <span class="badge">Faltan: ${remaining}</span>
        <span class="qty">
          <button class="btn btn--small btnDec" data-id="${escapeAttr(p.id)}" data-max="${p.qty}">-</button>
          <span class="num">${done}</span>
          <button class="btn btn--small btnInc" data-id="${escapeAttr(p.id)}" data-max="${p.qty}">+</button>
        </span>
        <button class="btn btn--small btnMax" data-id="${escapeAttr(p.id)}" data-max="${p.qty}">Completar</button>
      </div>
    </div>
  `;
}

// ---------- Render: Gantt ----------
function getTaskStatus(id, fallback) {
  return state.taskStatus[id] || fallback || "todo";
}
function setTaskStatus(id, status) {
  if (!status) return;
  state.taskStatus[id] = status;
  saveState();
}

function listAssignees() {
  const set = new Set(tasksData.tasks.map(t => t.assignee).filter(Boolean));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function renderGantt() {
  const assignee = $("#filterAssignee").value;
  const status = $("#filterStatus").value;
  const zoom = $("#ganttZoom").value; // day|week

  const tasks = tasksData.tasks
    .map(t => ({...t, status: getTaskStatus(t.id, t.status)}))
    .filter(t => assignee === "all" ? true : (t.assignee === assignee))
    .filter(t => status === "all" ? true : (t.status === status));

  $("#taskCount").textContent = `${tasks.length} tarea(s)`;

  // Task list
  $("#taskList").innerHTML = tasks.map(t => renderTaskRow(t)).join("") || emptyMsg("Sin tareas para este filtro");

  $$(".taskStatus").forEach(sel => {
    sel.onchange = () => {
      const id = sel.dataset.id;
      setTaskStatus(id, sel.value);
      renderGantt(); // refresh chart + list
      renderGlobalStats();
    };
  });

  // Build chart horizon
  if (tasks.length === 0) { $("#gantt").innerHTML = emptyMsg("Nada que graficar"); return; }

  const starts = tasks.map(t => t.start);
  const ends = tasks.map(t => t.end);

  const minStart = starts.reduce((a,b)=> a < b ? a : b);
  const maxEnd = ends.reduce((a,b)=> a > b ? a : b);

  // Pad window a bit
  const windowStart = addDays(minStart, -2);
  const windowEnd = addDays(maxEnd, 2);

  const dayWidth = zoom === "day" ? 22 : 10; // pixels per day
  const rowH = 34;
  const labelW = 260;
  const topH = 34;

  const totalDays = daysBetween(windowStart, windowEnd) + 1;
  const width = labelW + (totalDays * dayWidth) + 20;
  const height = topH + (tasks.length * rowH) + 18;

  const today = fmtDate(new Date().toISOString().slice(0,10));
  const todayX = labelW + (daysBetween(windowStart, today) * dayWidth);

  // Header ticks
  const ticks = [];
  for (let i=0;i<totalDays;i++){
    const d = addDays(windowStart, i);
    const show = zoom === "day"
      ? true
      : (new Date(d).getDay() === 1); // Mondays for week view
    if (!show) continue;
    ticks.push({ d, x: labelW + i*dayWidth });
  }

  const svg = [];
  svg.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gantt">`);
  // background
  svg.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(15,19,24,.15)" />`);

  // header area
  svg.push(`<rect x="0" y="0" width="${width}" height="${topH}" fill="rgba(15,19,24,.35)" />`);
  svg.push(`<line x1="0" y1="${topH}" x2="${width}" y2="${topH}" stroke="rgba(31,42,56,.85)" />`);
  svg.push(`<text x="14" y="22" fill="rgba(169,180,196,.95)" font-size="12" font-family="ui-monospace, Menlo, monospace">Tarea</text>`);

  // grid vertical lines + labels
  for (let i=0;i<totalDays;i++){
    const x = labelW + i*dayWidth;
    const d = addDays(windowStart, i);
    const isWeekend = [0,6].includes(new Date(d).getDay());
    if (zoom === "week" && !isWeekend && new Date(d).getDay() !== 1) {
      // lighter grid for week zoom
      svg.push(`<line x1="${x}" y1="${topH}" x2="${x}" y2="${height}" stroke="rgba(31,42,56,.18)" />`);
    } else {
      svg.push(`<line x1="${x}" y1="${topH}" x2="${x}" y2="${height}" stroke="${isWeekend ? "rgba(255,211,122,.10)" : "rgba(31,42,56,.26)"}" />`);
    }
  }

  ticks.forEach(t => {
    const label = zoom === "day" ? t.d.slice(5) : t.d.slice(5); // MM-DD
    svg.push(`<text x="${t.x+4}" y="22" fill="rgba(169,180,196,.8)" font-size="11" font-family="ui-monospace, Menlo, monospace">${label}</text>`);
  });

  // today line
  if (today >= windowStart && today <= windowEnd) {
    svg.push(`<line x1="${todayX}" y1="${topH}" x2="${todayX}" y2="${height}" stroke="rgba(106,169,255,.55)" stroke-width="2" />`);
    svg.push(`<text x="${todayX+6}" y="${topH+14}" fill="rgba(106,169,255,.9)" font-size="11" font-family="ui-monospace, Menlo, monospace">hoy</text>`);
  }

  // rows
  tasks.forEach((t, idx) => {
    const y = topH + idx*rowH;
    const barY = y + 9;
    const startOffset = clamp(daysBetween(windowStart, t.start), 0, totalDays-1);
    const endOffset = clamp(daysBetween(windowStart, t.end), 0, totalDays-1);
    const x = labelW + startOffset*dayWidth;
    const w = Math.max(dayWidth, (endOffset - startOffset + 1) * dayWidth);

    // row separator
    svg.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(31,42,56,.35)" />`);

    // task label
    const label = escapeXml(t.name.length > 34 ? t.name.slice(0, 34) + "…" : t.name);
    const meta = escapeXml(`${t.assignee || "—"} • ${t.start}→${t.end}`);
    svg.push(`<text x="14" y="${y+21}" fill="rgba(233,238,247,.92)" font-size="12">${label}</text>`);
    svg.push(`<text x="14" y="${y+33}" fill="rgba(169,180,196,.78)" font-size="11" font-family="ui-monospace, Menlo, monospace">${meta}</text>`);

    const c = statusColor(t.status);
    svg.push(`<rect x="${x}" y="${barY}" width="${w}" height="16" rx="6" fill="${c.fill}" stroke="${c.stroke}" />`);
    svg.push(`<text x="${x+8}" y="${barY+12}" fill="rgba(11,13,16,.9)" font-size="11" font-weight="700">${escapeXml(t.status)}</text>`);
  });

  svg.push(`</svg>`);
  $("#gantt").innerHTML = svg.join("");
}

function statusColor(s) {
  switch (s) {
    case "done": return { fill: "rgba(111,230,183,.78)", stroke: "rgba(111,230,183,.95)" };
    case "doing": return { fill: "rgba(255,211,122,.78)", stroke: "rgba(255,211,122,.95)" };
    case "blocked": return { fill: "rgba(255,122,122,.78)", stroke: "rgba(255,122,122,.95)" };
    default: return { fill: "rgba(106,169,255,.60)", stroke: "rgba(106,169,255,.85)" };
  }
}

function renderTaskRow(t) {
  const meta = `${t.assignee || "—"} • ${t.start}→${t.end}`;
  return `
    <div class="item">
      <div class="item__main">
        <div class="item__title">${escapeHtml(t.name)}</div>
        <div class="item__meta"><code>${escapeHtml(t.id)}</code> • ${escapeHtml(meta)}</div>
      </div>
      <div class="item__actions">
        <select class="select taskStatus" data-id="${escapeAttr(t.id)}" style="min-width:160px;">
          ${["todo","doing","done","blocked"].map(s => `<option value="${s}" ${t.status===s?"selected":""}>${labelStatus(s)}</option>`).join("")}
        </select>
      </div>
    </div>
  `;
}

function labelStatus(s){
  if (s==="todo") return "Por hacer";
  if (s==="doing") return "En proceso";
  if (s==="done") return "Hecho";
  if (s==="blocked") return "Bloqueado";
  return s;
}

// ---------- Global ----------
function renderGlobalStats() {
  if (!bomData || !tasksData) return;

  const bom = bomTotals();
  const pct = bom.req > 0 ? Math.round((bom.done / bom.req) * 100) : 0;

  const tasks = tasksData.tasks.map(t => ({...t, status: getTaskStatus(t.id, t.status)}));
  const counts = tasks.reduce((acc,t)=>{ acc[t.status]=(acc[t.status]||0)+1; return acc; }, {});
  const done = counts.done || 0;
  const total = tasks.length;

  $("#globalStats").innerHTML = `
    <span class="pill"><span class="k">BOM</span> <strong>${bom.done}</strong>/<strong>${bom.req}</strong> <span class="muted">(${pct}%)</span></span>
    <span class="pill"><span class="k">Faltan</span> <strong>${bom.remaining}</strong></span>
    <span class="pill"><span class="k">Tareas</span> <strong>${done}</strong>/<strong>${total}</strong> <span class="muted">(done)</span></span>
    <span class="pill"><span class="k">Bloq</span> <strong>${counts.blocked||0}</strong></span>
  `;
}

function renderAll() {
  renderFiles();
  renderBOM();
  renderGantt();
  renderGlobalStats();
}

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function escapeAttr(s="") { return escapeHtml(s); }
function escapeXml(s="") { return escapeHtml(s); }
function slug(s="") {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}
function emptyMsg(txt) {
  return `<div class="item"><div class="item__main"><div class="item__meta">${escapeHtml(txt)}</div></div></div>`;
}

// ---------- Init ----------
function wireUI() {
  // Tabs
  $$(".tab").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  // Filters
  ["qFiles","filterType","filterAssembly"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", renderFiles);
    el.addEventListener("change", renderFiles);
  });

  ["qBom","bomView","bomOnlyPending"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", renderBOM);
    el.addEventListener("change", renderBOM);
  });

  ["filterAssignee","filterStatus","ganttZoom"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("change", renderGantt);
  });

  // Export/Import/Reset
  $("#btnExport").onclick = () => downloadJSON("rmh_progress.json", state);

  $("#importFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const imported = JSON.parse(text);
      mergeImported(imported);
    } catch (err) {
      alert("Import falló: archivo inválido.");
      console.error(err);
    } finally {
      e.target.value = "";
    }
  });

  $("#btnReset").onclick = () => {
    if (confirm("Esto borra el progreso guardado en ESTE navegador. ¿Seguro?")) resetState();
  };
}

async function init() {
  loadState();
  wireUI();

  try {
    [filesData, bomData, tasksData] = await Promise.all([
      fetchJSON("data/files.json"),
      fetchJSON("data/bom.json"),
      fetchJSON("data/tasks.json")
    ]);

    // populate selects
    buildAssemblyOptions();

    const assignees = listAssignees();
    $("#filterAssignee").innerHTML = `<option value="all">Todos</option>` +
      assignees.map(a => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join("");

    renderAll();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `
      <div class="wrap" style="padding:28px;">
        <div class="card" style="padding:18px;">
          <h1 class="h1">Error cargando datos</h1>
          <p class="muted">Revisa que existan: <code>data/files.json</code>, <code>data/bom.json</code>, <code>data/tasks.json</code>.</p>
          <p class="muted">Detalle: <code>${escapeHtml(e.message || String(e))}</code></p>
        </div>
      </div>`;
  }
}

init();