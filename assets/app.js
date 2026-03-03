// Robotics Manufacturing Hub - v4 (Gantt editable + attachments)
const LS_KEY = "rmh_state_v4";
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const on = (el, evt, fn) => { if (el) el.addEventListener(evt, fn); };

let filesData = { items: [] };
let bomData = null;
let tasksTemplate = { tasks: [] };

const state = {
  bomDone: {},
  tasksLocal: null,   // si null => usa tasksTemplate
};

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.bomDone = parsed.bomDone || {};
    state.tasksLocal = parsed.tasksLocal || null;
  } catch {}
}
function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  renderGlobalStats();
}
function resetState() {
  state.bomDone = {};
  state.tasksLocal = null;
  saveState();
  clearTaskForm();
  renderAll();
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed: ${path} (${r.status})`);
  const text = await r.text();
  if (!text.trim()) throw new Error(`Empty JSON: ${path}`);
  return JSON.parse(text);
}

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function escapeAttr(s="") { return escapeHtml(s); }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function emptyMsg(txt){
  return `<div class="item"><div class="item__main"><div class="item__meta">${escapeHtml(txt)}</div></div></div>`;
}

/* ---------- Tabs ---------- */
function setTab(name) {
  $$(".tab").forEach(btn => btn.classList.toggle("is-active", btn.dataset.tab === name));
  $$(".tabpane").forEach(p => p.classList.toggle("is-active", p.id === `tab-${name}`));
  $$(".tab").forEach(btn => btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false"));
}

/* ---------- BOM ---------- */
function getDone(partId){ return Number(state.bomDone[partId] || 0); }
function setDone(partId, done){
  if (done <= 0) delete state.bomDone[partId];
  else state.bomDone[partId] = done;
  saveState();
}
function isPartDone(p){
  return clamp(getDone(p.id), 0, p.qty) >= p.qty;
}
function bomTotalsAll(){
  let req=0, done=0;
  for (const g of (bomData?.groups || [])){
    for (const s of (g.sections || [])){
      for (const p of (s.parts || [])){
        req += p.qty;
        done += clamp(getDone(p.id), 0, p.qty);
      }
    }
  }
  return { req, done, remaining: Math.max(0, req-done) };
}
function sectionTotals(groupKey, sectionKey){
  const g = (bomData?.groups || []).find(x => x.key === groupKey);
  const s = g?.sections?.find(x => x.key === sectionKey);
  if (!s) return { req:0, done:0, remaining:0 };
  let req=0, done=0;
  for (const p of (s.parts || [])){
    req += p.qty;
    done += clamp(getDone(p.id), 0, p.qty);
  }
  return { req, done, remaining: Math.max(0, req-done) };
}

/* ---------- Files (solo lectura) ---------- */
function inferGroup(it){
  const g = (it.group || it.assembly || "").toString().toLowerCase();
  if (g.includes("flipper")) return "flipper";
  if (g.includes("chasis")) return "chasis";
  const tags = (it.tags || []).map(t => String(t).toLowerCase());
  if (tags.includes("flipper")) return "flipper";
  if (tags.includes("chasis")) return "chasis";
  return "";
}
function inferSection(it){
  const s = (it.section || "").toString().toLowerCase();
  if (s) return s;
  const t = (it.type || "").toString().toLowerCase();
  const tags = (it.tags || []).map(x => String(x).toLowerCase());
  if (t === "stl") return "print3d";
  if (tags.includes("print3d") || tags.includes("3d") || tags.includes("stl")) return "print3d";
  return "machining";
}
function inferType(it){
  return (it.type || it.fileType || "").toString().toLowerCase();
}
function renderFileItem(it){
  const url = it.path;
  return `
    <div class="item">
      <div class="item__main">
        <div class="item__title">${escapeHtml(it.name)}</div>
        <div class="item__meta">${it.id ? `<code>${escapeHtml(it.id)}</code>` : ""} ${it.path ? `• <code>${escapeHtml(it.path)}</code>` : ""}</div>
      </div>
      <div class="item__actions">
        <a class="btn btn--small" href="${escapeAttr(url)}" target="_blank" rel="noopener">Abrir</a>
      </div>
    </div>
  `;
}
function renderFilesBlock(groupKey, sectionKey){
  const items = (filesData?.items || [])
    .filter(it => inferGroup(it) === groupKey)
    .filter(it => inferSection(it) === sectionKey);

  const is3d = sectionKey === "print3d";
  const a = is3d
    ? { leftLabel: "STL", leftType: "stl", rightLabel:"G-code (impresora)", rightMatch: (t)=> t.includes("gcode") }
    : { leftLabel: "Planos", leftType: "plan", rightLabel:"G-code (CNC)", rightMatch: (t)=> t.includes("gcode") || t.includes("nc") };

  const left = items.filter(it => inferType(it) === a.leftType);
  const right = items.filter(it => a.rightMatch(inferType(it)));

  return `
    <div class="subcard">
      <div class="subcard__head">
        <h2 class="h2">Archivos</h2>
        <span class="muted">${items.length} item(s)</span>
      </div>
      <div class="duo">
        <div>
          <div class="minihead"><span>${a.leftLabel}</span><span class="muted">${left.length}</span></div>
          <div class="list">${left.map(renderFileItem).join("") || emptyMsg("Sin archivos")}</div>
        </div>
        <div>
          <div class="minihead"><span>${a.rightLabel}</span><span class="muted">${right.length}</span></div>
          <div class="list">${right.map(renderFileItem).join("") || emptyMsg("Sin archivos")}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------- BOM render ---------- */
function partMatches(p, q, filter){
  const done = isPartDone(p);
  if (filter === "pending" && done) return false;
  if (filter === "done" && !done) return false;
  if (!q) return true;
  const hay = `${p.id} ${p.name}`.toLowerCase();
  return hay.includes(q);
}
function renderBomPartRow(p){
  const done = clamp(getDone(p.id), 0, p.qty);
  const rem = Math.max(0, p.qty - done);
  const status = rem === 0
    ? `<span class="badge" style="border-color: rgba(111,230,183,.45); color:#d9fff0;">OK</span>`
    : `<span class="badge" style="border-color: rgba(255,211,122,.45); color:#fff2d7;">PEND</span>`;
  return `
    <div class="item">
      <div class="item__main">
        <div class="item__title">${escapeHtml(p.name)} ${status}</div>
        <div class="item__meta"><code>${escapeHtml(p.id)}</code></div>
      </div>
      <div class="item__actions">
        <span class="badge">Req: ${p.qty}</span>
        <span class="badge">Faltan: ${rem}</span>
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
function renderBomBlock(groupKey, sectionKey, q, filter){
  const g = (bomData?.groups || []).find(x => x.key === groupKey);
  const s = g?.sections?.find(x => x.key === sectionKey);
  const parts = (s?.parts || []).filter(p => partMatches(p, q, filter));

  const totals = sectionTotals(groupKey, sectionKey);
  const pct = totals.req ? Math.round((totals.done/totals.req)*100) : 0;

  return `
    <div class="subcard">
      <div class="subcard__head">
        <h2 class="h2">BOM (${escapeHtml(s?.name || sectionKey)})</h2>
        <span class="muted">${totals.done}/${totals.req} • ${pct}%</span>
      </div>
      <div style="padding:12px; border-bottom:1px solid rgba(31,42,56,.65);">
        <div class="progress" style="width:100%;"><div style="width:${pct}%"></div></div>
      </div>
      <div class="list">${parts.map(renderBomPartRow).join("") || emptyMsg("Sin resultados")}</div>
    </div>
  `;
}
function renderGroup(groupKey){
  const container = groupKey === "flipper" ? $("#flipperContent") : $("#chasisContent");
  if (!container) return;
  if (!bomData) { container.innerHTML = emptyMsg("Cargando BOM…"); return; }

  const qEl = groupKey === "flipper" ? $("#qFlipper") : $("#qChasis");
  const fEl = groupKey === "flipper" ? $("#filterFlipper") : $("#filterChasis");
  const q = (qEl?.value || "").toLowerCase().trim();
  const filter = (fEl?.value || "all");

  const g = (bomData.groups || []).find(x => x.key === groupKey);
  if (!g) { container.innerHTML = emptyMsg("No existe este grupo en bom.json"); return; }

  const machiningTotals = sectionTotals(groupKey, "machining");
  const printTotals = sectionTotals(groupKey, "print3d");

  container.innerHTML = `
    <div class="sectionHeader">
      <div class="pair">
        <strong>${escapeHtml(g.name)}</strong>
        <span class="badge">Maquinado: ${machiningTotals.done}/${machiningTotals.req}</span>
        <span class="badge">Print3D: ${printTotals.done}/${printTotals.req}</span>
      </div>
      <div class="muted small">Archivos en data/files.json</div>
    </div>

    <div class="sectionHeader"><strong>Maquinado</strong><span class="muted small">Planos + G-code CNC</span></div>
    <div class="sectionGrid">
      ${renderFilesBlock(groupKey, "machining")}
      ${renderBomBlock(groupKey, "machining", q, filter)}
    </div>

    <div class="sectionHeader"><strong>Print 3D</strong><span class="muted small">STL + G-code impresora</span></div>
    <div class="sectionGrid">
      ${renderFilesBlock(groupKey, "print3d")}
      ${renderBomBlock(groupKey, "print3d", q, filter)}
    </div>
  `;

  // botones qty
  container.querySelectorAll(".btnInc").forEach(b => b.onclick = () => {
    const id = b.dataset.id; const max = Number(b.dataset.max);
    setDone(id, clamp(getDone(id)+1, 0, max));
    renderGroup(groupKey);
  });
  container.querySelectorAll(".btnDec").forEach(b => b.onclick = () => {
    const id = b.dataset.id; const max = Number(b.dataset.max);
    setDone(id, clamp(getDone(id)-1, 0, max));
    renderGroup(groupKey);
  });
  container.querySelectorAll(".btnMax").forEach(b => b.onclick = () => {
    const id = b.dataset.id; const max = Number(b.dataset.max);
    setDone(id, max);
    renderGroup(groupKey);
  });
}

/* ---------- Tasks CRUD + attachments ---------- */
function getTasks() { return state.tasksLocal || (tasksTemplate?.tasks || []); }
function setTasks(tasks) { state.tasksLocal = tasks; saveState(); }

let selectedTaskId = null;

function genTaskId(tasks) {
  const nums = tasks.map(t => (t.id||"").match(/^T-(\d+)$/)).filter(Boolean).map(m => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `T-${String(next).padStart(3,"0")}`;
}
function clearTaskForm(){
  selectedTaskId = null;
  if ($("#taskId")) $("#taskId").value = "";
  if ($("#taskName")) $("#taskName").value = "";
  if ($("#taskAssignee")) $("#taskAssignee").value = "";
  if ($("#taskStatusEdit")) $("#taskStatusEdit").value = "todo";
  if ($("#taskStart")) $("#taskStart").value = "";
  if ($("#taskEnd")) $("#taskEnd").value = "";
  if ($("#taskAttach")) $("#taskAttach").value = "";
  renderAttachList([]);
}
function loadTaskToForm(id){
  const t = getTasks().find(x => x.id === id);
  if (!t) return;
  selectedTaskId = id;
  $("#taskId").value = t.id;
  $("#taskName").value = t.name || "";
  $("#taskAssignee").value = t.assignee || "";
  $("#taskStatusEdit").value = t.status || "todo";
  $("#taskStart").value = t.start || "";
  $("#taskEnd").value = t.end || "";
  renderAttachList(t.attachments || []);
}
function renderAttachList(arr){
  const list = $("#attachList");
  if (!list) return;
  $("#attachCount").textContent = String(arr.length);
  list.innerHTML = arr.length ? arr.map((p,i)=>`
    <div class="item">
      <div class="item__main"><div class="item__title">${escapeHtml(p)}</div></div>
      <div class="item__actions">
        <a class="btn btn--small" href="${escapeAttr(p)}" target="_blank" rel="noopener">Abrir</a>
        <button class="btn btn--small btnAttachDel" data-i="${i}">Quitar</button>
      </div>
    </div>
  `).join("") : emptyMsg("Sin adjuntos");

  list.querySelectorAll(".btnAttachDel").forEach(b => b.onclick = () => {
    if (!selectedTaskId) return;
    const tasks = [...getTasks()];
    const idx = tasks.findIndex(t => t.id === selectedTaskId);
    if (idx < 0) return;
    const at = [...(tasks[idx].attachments || [])];
    at.splice(Number(b.dataset.i), 1);
    tasks[idx] = { ...tasks[idx], attachments: at };
    setTasks(tasks);
    loadTaskToForm(selectedTaskId);
    renderAll();
  });
}
function addTask(){
  const tasks = [...getTasks()];
  const name = $("#taskName").value.trim();
  const assignee = $("#taskAssignee").value.trim();
  const status = $("#taskStatusEdit").value;
  const start = $("#taskStart").value;
  const end = $("#taskEnd").value;

  if (!name) return alert("Pon nombre.");
  if (!start || !end) return alert("Pon fechas.");
  if (start > end) return alert("Inicio no puede ser después de fin.");

  const id = genTaskId(tasks);
  tasks.push({ id, name, assignee, status, start, end, attachments: [] });
  setTasks(tasks);
  loadTaskToForm(id);
  renderAll();
}
function updateTask(){
  if (!selectedTaskId) return alert("Selecciona una tarea (Editar).");
  const tasks = [...getTasks()];
  const idx = tasks.findIndex(t => t.id === selectedTaskId);
  if (idx < 0) return;

  const name = $("#taskName").value.trim();
  const assignee = $("#taskAssignee").value.trim();
  const status = $("#taskStatusEdit").value;
  const start = $("#taskStart").value;
  const end = $("#taskEnd").value;

  if (!name) return alert("Pon nombre.");
  if (!start || !end) return alert("Pon fechas.");
  if (start > end) return alert("Inicio no puede ser después de fin.");

  tasks[idx] = { ...tasks[idx], name, assignee, status, start, end };
  setTasks(tasks);
  loadTaskToForm(selectedTaskId);
  renderAll();
}
function deleteTask(){
  if (!selectedTaskId) return alert("No hay tarea seleccionada.");
  if (!confirm("¿Borrar esta tarea?")) return;

  const tasks = [...getTasks()].filter(t => t.id !== selectedTaskId);
  setTasks(tasks);
  clearTaskForm();
  renderAll();
}
function addAttachment(){
  if (!selectedTaskId) return alert("Selecciona una tarea primero.");
  const path = $("#taskAttach").value.trim();
  if (!path) return;

  const tasks = [...getTasks()];
  const idx = tasks.findIndex(t => t.id === selectedTaskId);
  if (idx < 0) return;

  const at = [...(tasks[idx].attachments || [])];
  at.push(path);
  tasks[idx] = { ...tasks[idx], attachments: at };
  setTasks(tasks);

  $("#taskAttach").value = "";
  loadTaskToForm(selectedTaskId);
  renderAll();
}

/* ---------- Export/import tasks.json ---------- */
function downloadJSON(filename, obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}
function exportTasks(){
  downloadJSON("tasks.json", { tasks: getTasks() });
}
async function importTasks(file){
  const parsed = JSON.parse(await file.text());
  if (!parsed?.tasks || !Array.isArray(parsed.tasks)) throw new Error("Formato inválido.");
  state.tasksLocal = parsed.tasks;
  saveState();
  clearTaskForm();
  renderAll();
}

/* ---------- Global stats ---------- */
function renderGlobalStats(){
  const el = $("#globalStats");
  if (!el || !bomData) return;

  const bom = bomTotalsAll();
  const pct = bom.req ? Math.round((bom.done/bom.req)*100) : 0;

  const tasks = getTasks();
  const counts = tasks.reduce((acc,t)=>{ acc[t.status]=(acc[t.status]||0)+1; return acc; }, {});

  el.innerHTML = `
    <span class="pill"><span class="k">BOM</span> <strong>${bom.done}</strong>/<strong>${bom.req}</strong> <span class="muted">(${pct}%)</span></span>
    <span class="pill"><span class="k">Faltan</span> <strong>${bom.remaining}</strong></span>
    <span class="pill"><span class="k">Tareas</span> <strong>${counts.done||0}</strong>/<strong>${tasks.length}</strong></span>
    <span class="pill"><span class="k">Bloq</span> <strong>${counts.blocked||0}</strong></span>
  `;
}

/* ---------- Gantt render ---------- */
function fmtDate(d){ const x=new Date(d); if(Number.isNaN(x.getTime())) return d; return x.toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/(1000*60*60*24)); }
function addDays(dateStr,days){ const d=new Date(dateStr); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }

function statusColor(s){
  switch(s){
    case "done": return { fill:"rgba(111,230,183,.78)", stroke:"rgba(111,230,183,.95)" };
    case "doing": return { fill:"rgba(255,211,122,.78)", stroke:"rgba(255,211,122,.95)" };
    case "blocked": return { fill:"rgba(255,122,122,.78)", stroke:"rgba(255,122,122,.95)" };
    default: return { fill:"rgba(106,169,255,.60)", stroke:"rgba(106,169,255,.85)" };
  }
}
function listAssignees(tasks){
  const set = new Set(tasks.map(t => t.assignee).filter(Boolean));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function taskRow(t){
  const meta = `${t.assignee || "—"} • ${t.start}→${t.end}`;
  const badge = `<span class="badge">${escapeHtml(t.status||"todo")}</span>`;
  return `
    <div class="item">
      <div class="item__main">
        <div class="item__title">${escapeHtml(t.name)} ${badge}</div>
        <div class="item__meta"><code>${escapeHtml(t.id)}</code> • ${escapeHtml(meta)}</div>
      </div>
      <div class="item__actions">
        <button class="btn btn--small btnEditTask" data-id="${escapeAttr(t.id)}">Editar</button>
      </div>
    </div>
  `;
}

function renderGantt(){
  const tasksAll = getTasks();

  // filtros
  const selA = $("#filterAssignee");
  if (selA){
    const list = listAssignees(tasksAll);
    const current = selA.value || "all";
    selA.innerHTML = `<option value="all">Todos</option>` + list.map(a => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join("");
    selA.value = list.includes(current) ? current : "all";
  }

  const assignee = $("#filterAssignee")?.value || "all";
  const status = $("#filterStatus")?.value || "all";
  const zoom = $("#ganttZoom")?.value || "week";

  const tasks = tasksAll
    .filter(t => assignee==="all" ? true : t.assignee===assignee)
    .filter(t => status==="all" ? true : t.status===status);

  $("#taskCount").textContent = `${tasksAll.length} total`;
  $("#taskListCount").textContent = `${tasks.length} visibles`;

  const list = $("#taskList");
  if (list){
    list.innerHTML = tasks.map(taskRow).join("") || emptyMsg("Sin tareas");
    list.querySelectorAll(".btnEditTask").forEach(b => b.onclick = () => loadTaskToForm(b.dataset.id));
  }

  const gantt = $("#gantt");
  if (!gantt) return;
  if (tasks.length === 0) { gantt.innerHTML = emptyMsg("Nada que graficar"); return; }

  const minStart = tasks.map(t=>t.start).reduce((a,b)=>a<b?a:b);
  const maxEnd = tasks.map(t=>t.end).reduce((a,b)=>a>b?a:b);
  const windowStart = addDays(minStart,-2);
  const windowEnd = addDays(maxEnd,2);

  const dayWidth = zoom==="day" ? 22 : 10;
  const rowH = 34, labelW = 260, topH = 34;
  const totalDays = daysBetween(windowStart, windowEnd) + 1;
  const width = labelW + (totalDays*dayWidth) + 20;
  const height = topH + (tasks.length*rowH) + 18;

  const today = fmtDate(new Date().toISOString().slice(0,10));
  const todayX = labelW + (daysBetween(windowStart, today) * dayWidth);

  const svg=[];
  svg.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
  svg.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(15,19,24,.15)" />`);
  svg.push(`<rect x="0" y="0" width="${width}" height="${topH}" fill="rgba(15,19,24,.35)" />`);
  svg.push(`<line x1="0" y1="${topH}" x2="${width}" y2="${topH}" stroke="rgba(31,42,56,.85)" />`);
  svg.push(`<text x="14" y="22" fill="rgba(169,180,196,.95)" font-size="12" font-family="ui-monospace, Menlo, monospace">Tarea</text>`);

  for(let i=0;i<totalDays;i++){
    const x=labelW+i*dayWidth;
    const d=addDays(windowStart,i);
    const isWeekend=[0,6].includes(new Date(d).getDay());
    svg.push(`<line x1="${x}" y1="${topH}" x2="${x}" y2="${height}" stroke="${isWeekend?"rgba(255,211,122,.10)":"rgba(31,42,56,.26)"}" />`);
  }

  if (today >= windowStart && today <= windowEnd) {
    svg.push(`<line x1="${todayX}" y1="${topH}" x2="${todayX}" y2="${height}" stroke="rgba(106,169,255,.55)" stroke-width="2" />`);
    svg.push(`<text x="${todayX+6}" y="${topH+14}" fill="rgba(106,169,255,.9)" font-size="11" font-family="ui-monospace, Menlo, monospace">hoy</text>`);
  }

  tasks.forEach((t,idx)=>{
    const y=topH+idx*rowH;
    const barY=y+9;
    const startOffset=clamp(daysBetween(windowStart,t.start),0,totalDays-1);
    const endOffset=clamp(daysBetween(windowStart,t.end),0,totalDays-1);
    const x=labelW+startOffset*dayWidth;
    const w=Math.max(dayWidth,(endOffset-startOffset+1)*dayWidth);

    svg.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(31,42,56,.35)" />`);
    const label = escapeHtml(t.name.length>34 ? t.name.slice(0,34)+"…" : t.name);
    const meta = escapeHtml(`${t.assignee||"—"} • ${t.start}→${t.end}`);
    svg.push(`<text x="14" y="${y+21}" fill="rgba(233,238,247,.92)" font-size="12">${label}</text>`);
    svg.push(`<text x="14" y="${y+33}" fill="rgba(169,180,196,.78)" font-size="11" font-family="ui-monospace, Menlo, monospace">${meta}</text>`);
    const c=statusColor(t.status||"todo");
    svg.push(`<rect x="${x}" y="${barY}" width="${w}" height="16" rx="6" fill="${c.fill}" stroke="${c.stroke}" />`);
    svg.push(`<text x="${x+8}" y="${barY+12}" fill="rgba(11,13,16,.9)" font-size="11" font-weight="700">${escapeHtml(t.status||"todo")}</text>`);
  });

  svg.push(`</svg>`);
  gantt.innerHTML = svg.join("");
}

/* ---------- Export/import global ---------- */
function downloadProgress(){
  downloadJSON("rmh_progress.json", state);
}
async function importProgress(file){
  const parsed = JSON.parse(await file.text());
  state.bomDone = parsed.bomDone || state.bomDone;
  state.tasksLocal = parsed.tasksLocal || state.tasksLocal;
  saveState();
  clearTaskForm();
  renderAll();
}

/* ---------- Wire + init ---------- */
function wireUI(){
  $$(".tab").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  on($("#qFlipper"), "input", () => renderGroup("flipper"));
  on($("#filterFlipper"), "change", () => renderGroup("flipper"));
  on($("#qChasis"), "input", () => renderGroup("chasis"));
  on($("#filterChasis"), "change", () => renderGroup("chasis"));

  ["filterAssignee","filterStatus","ganttZoom"].forEach(id => on($("#"+id), "change", renderGantt));

  on($("#btnTaskAdd"), "click", addTask);
  on($("#btnTaskUpdate"), "click", updateTask);
  on($("#btnTaskDelete"), "click", deleteTask);
  on($("#btnTaskClear"), "click", clearTaskForm);
  on($("#btnAttachAdd"), "click", addAttachment);

  on($("#btnTasksExport"), "click", exportTasks);
  on($("#tasksImportFile"), "change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { await importTasks(f); }
    catch(err){ alert(`Import tasks falló: ${err.message}`); }
    finally{ e.target.value=""; }
  });

  on($("#btnExport"), "click", downloadProgress);
  on($("#importFile"), "change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { await importProgress(f); }
    catch{ alert("Import falló: JSON inválido."); }
    finally{ e.target.value=""; }
  });

  on($("#btnReset"), "click", () => {
    if (confirm("Esto borra el progreso guardado en ESTE navegador. ¿Seguro?")) resetState();
  });
}

function renderAll(){
  renderGroup("flipper");
  renderGroup("chasis");
  renderGantt();
  renderGlobalStats();
}

async function init(){
  loadState();
  wireUI();

  try{
    [filesData, bomData, tasksTemplate] = await Promise.all([
      fetchJSON("data/files.json"),
      fetchJSON("data/bom.json"),
      fetchJSON("data/tasks.json")
    ]);

    // Inicializa form con vacío
    clearTaskForm();
    renderAll();
  }catch(e){
    document.body.innerHTML = `
      <div class="wrap" style="padding:28px;">
        <div class="card" style="padding:18px;">
          <h1 class="h1">Error cargando datos</h1>
          <p class="muted">Detalle: <code>${escapeHtml(e.message || String(e))}</code></p>
        </div>
      </div>`;
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);