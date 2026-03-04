const UI = {
  chatboxTitle: "Intelligent Chatbox",
  modelLabel: "Model",
  chatPlaceholder: "Type your message…",
  memoryTitle: "Memory",
  memoryHint: "refresh every 1 minute",
  agentTitle: "Agent",
  agentHint: "refresh every 1 minute",
  mcpTitle: "外部连接",
  mcpHint: "refresh every 1 minute",
  tokenTitle: "Token",
  taskTitle: "Task",
  projectTitle: "Project",
  alertTitle: "Alert",
  workplaceTitle: "Workplace",
  thModel: "Model",
  thRequests: "Requests",
  thTokenDaily: "Daily Tokens",
  thTokenTotal: "Total Tokens",
  thTaskContent: "Content",
  thTaskCadence: "Cadence",
  thAlertTime: "Time",
  thAlertType: "Type",
  thAlertDetail: "Detail",
  thMcpApp: "App",
  thMcpAgent: "Agent",
  thMcpStatus: "Status",
  updatedAt: "Updated",
  modelRequired: "Please select model",
  msgRequired: "Please enter message",
  sending: "Sending…",
  ready: "Ready",
  noData: "No data",
  noWorkplace: "No collaboration records",
  noAlerts: "No active alert"
};

const state = {
  authToken: "",
  unlocked: false,
  initialized: false,
  summary: null,
  agentsStatus: null,
  externalStatus: null,
  models: [],
  workplace: null,
  loadingSummary: false,
  loadingWorkplace: false
};

const el = {
  appShell: document.getElementById("appShell"),
  unlockOverlay: document.getElementById("unlockOverlay"),
  unlockPassword: document.getElementById("unlockPassword"),
  unlockBtn: document.getElementById("unlockBtn"),
  unlockError: document.getElementById("unlockError"),
  notionBtn: document.getElementById("notionBtn"),
  githubBtn: document.getElementById("githubBtn"),
  zjzBtn: document.getElementById("zjzBtn"),
  updatedAt: document.getElementById("updatedAt"),
  chatboxTitle: document.getElementById("chatboxTitle"),
  modelLabel: document.getElementById("modelLabel"),
  modelSelect: document.getElementById("modelSelect"),
  chatboxMessages: document.getElementById("chatboxMessages"),
  chatboxInput: document.getElementById("chatboxInput"),
  sendChatBtn: document.getElementById("sendChatBtn"),
  chatboxStatus: document.getElementById("chatboxStatus"),
  memoryTitle: document.getElementById("memoryTitle"),
  memoryHint: document.getElementById("memoryHint"),
  memoryTierRows: document.getElementById("memoryTierRows"),
  memoryVectorInfo: document.getElementById("memoryVectorInfo"),
  agentTitle: document.getElementById("agentTitle"),
  agentHint: document.getElementById("agentHint"),
  agentStatusList: document.getElementById("agentStatusList"),
  mcpTitle: document.getElementById("mcpTitle"),
  mcpHint: document.getElementById("mcpHint"),
  thMcpApp: document.getElementById("thMcpApp"),
  thMcpAgent: document.getElementById("thMcpAgent"),
  thMcpStatus: document.getElementById("thMcpStatus"),
  mcpTable: document.getElementById("mcpTable"),
  tokenTitle: document.getElementById("tokenTitle"),
  thModel: document.getElementById("thModel"),
  thRequests: document.getElementById("thRequests"),
  thTokenDaily: document.getElementById("thTokenDaily"),
  thTokenTotal: document.getElementById("thTokenTotal"),
  tokenTable: document.getElementById("tokenTable"),
  taskTitle: document.getElementById("taskTitle"),
  thTaskContent: document.getElementById("thTaskContent"),
  thTaskCadence: document.getElementById("thTaskCadence"),
  taskTable: document.getElementById("taskTable"),
  projectTitle: document.getElementById("projectTitle"),
  projectSummary: document.getElementById("projectSummary"),
  projectList: document.getElementById("projectList"),
  alertTitle: document.getElementById("alertTitle"),
  thAlertTime: document.getElementById("thAlertTime"),
  thAlertType: document.getElementById("thAlertType"),
  thAlertDetail: document.getElementById("thAlertDetail"),
  alertTable: document.getElementById("alertTable"),
  workplaceTitle: document.getElementById("workplaceTitle"),
  workplaceMeta: document.getElementById("workplaceMeta"),
  workplaceFeed: document.getElementById("workplaceFeed")
};

function t(key) {
  return UI[key] || key;
}

function formatTime(ts) {
  if (!ts) return "-";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatNum(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString();
}

function statusSymbol(ok) {
  return ok ? "✓" : "✕";
}

function setStatus(text, isError = false) {
  el.chatboxStatus.textContent = text;
  el.chatboxStatus.style.color = isError ? "#b11111" : "#666";
}

function setUnlockError(text) {
  el.unlockError.textContent = text || "";
}

function lockDashboard() {
  state.unlocked = false;
  state.authToken = "";
  el.appShell.classList.add("locked");
  el.unlockOverlay.classList.remove("hidden");
  setUnlockError("");
}

function unlockDashboard(token) {
  state.authToken = String(token || "");
  state.unlocked = true;
  el.appShell.classList.remove("locked");
  el.unlockOverlay.classList.add("hidden");
  setUnlockError("");
  el.unlockPassword.value = "";
}

function applyLabels() {
  document.documentElement.lang = "en";
  el.chatboxTitle.textContent = t("chatboxTitle");
  el.modelLabel.textContent = t("modelLabel");
  el.chatboxInput.placeholder = t("chatPlaceholder");
  el.memoryTitle.textContent = t("memoryTitle");
  el.memoryHint.textContent = t("memoryHint");
  el.agentTitle.textContent = t("agentTitle");
  el.agentHint.textContent = t("agentHint");
  el.mcpTitle.textContent = t("mcpTitle");
  el.mcpHint.textContent = t("mcpHint");
  el.tokenTitle.textContent = t("tokenTitle");
  el.taskTitle.textContent = t("taskTitle");
  el.projectTitle.textContent = t("projectTitle");
  el.alertTitle.textContent = t("alertTitle");
  el.workplaceTitle.textContent = t("workplaceTitle");
  el.thModel.textContent = t("thModel");
  el.thRequests.textContent = t("thRequests");
  el.thTokenDaily.textContent = t("thTokenDaily");
  el.thTokenTotal.textContent = t("thTokenTotal");
  el.thTaskContent.textContent = t("thTaskContent");
  el.thTaskCadence.textContent = t("thTaskCadence");
  el.thAlertTime.textContent = t("thAlertTime");
  el.thAlertType.textContent = t("thAlertType");
  el.thAlertDetail.textContent = t("thAlertDetail");
  el.thMcpApp.textContent = t("thMcpApp");
  el.thMcpAgent.textContent = t("thMcpAgent");
  el.thMcpStatus.textContent = t("thMcpStatus");
}

async function fetchPublicJson(url, options = {}) {
  const resp = await fetch(url, options);
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

async function fetchJson(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    "x-dashboard-token": state.authToken
  };
  const resp = await fetch(url, { ...options, headers });
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (resp.status === 401) {
    lockDashboard();
    throw new Error("dashboard locked");
  }
  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

function renderMemory(memory) {
  const tierCounts = memory?.tierCounts || {};
  el.memoryTierRows.innerHTML = ["T0", "T1", "T2", "T3"]
    .map((tier) => `<div class="row"><span>${tier}</span><b>${formatNum(tierCounts[tier] || 0)}</b></div>`)
    .join("");

  const vector = memory?.vector || {};
  const rate = Number(vector.qualityRate || 0).toFixed(2);
  el.memoryVectorInfo.textContent = `Vector quality ${rate}% ｜ sample ${formatNum(vector.sampleSize)} / pool ${formatNum(vector.poolSize)} ｜ next ${formatTime(vector.nextRunAt)}`;
}

function renderTokens(tokens) {
  if (!tokens || tokens.length === 0) {
    el.tokenTable.innerHTML = `<tr><td colspan="4">${t("noData")}</td></tr>`;
    return;
  }
  el.tokenTable.innerHTML = tokens
    .map(
      (row) =>
        `<tr><td>${row.model}</td><td>${formatNum(row.requests)}</td><td>${formatNum(row.tokensDaily)}</td><td>${formatNum(row.tokensTotal)}</td></tr>`
    )
    .join("");
}

function renderTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    el.taskTable.innerHTML = `<tr><td colspan="2">${t("noData")}</td></tr>`;
    return;
  }
  el.taskTable.innerHTML = tasks
    .map((row) => `<tr><td>${row.content || "-"}</td><td>${row.cadence || "-"}</td></tr>`)
    .join("");
}

function renderProjects(projects) {
  const rows = projects?.rows || [];
  const completed = Number(projects?.completed || 0);
  const total = Number(projects?.total || rows.length);
  el.projectSummary.textContent = `Completed ${completed} / Total ${total}`;
  if (rows.length === 0) {
    el.projectList.innerHTML = `<div class="project-item">${t("noData")}</div>`;
    return;
  }
  el.projectList.innerHTML = rows
    .map(
      (row) =>
        `<div class="project-item">
          <div><b>${row.name}</b></div>
          <div class="meta">${row.status || "-"} · ${formatTime(row.updatedAt)}</div>
          <div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(row.progress || 0)))}%"></i></div>
        </div>`
    )
    .join("");
}

function renderAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    el.alertTable.innerHTML = `<tr><td colspan="3">${t("noAlerts")}</td></tr>`;
    return;
  }
  el.alertTable.innerHTML = alerts
    .map(
      (row) =>
        `<tr class="severity-${(row.severity || "low").toLowerCase()}"><td>${formatTime(row.time)}</td><td>${row.type || "-"}</td><td>${row.detail || "-"}</td></tr>`
    )
    .join("");
}

function renderAgentStatus(payload) {
  state.agentsStatus = payload;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length === 0) {
    el.agentStatusList.innerHTML = `<div class="agent-item">${t("noData")}</div>`;
    return;
  }
  el.agentStatusList.innerHTML = rows
    .map((row) => {
      const ok = row.enabled !== false && !!row.ok;
      const detail = row.username || row.detail || "-";
      return `<div class="agent-item">
        <div class="agent-row">
          <span>${row.label || row.id || "-"}</span>
          <b class="status-symbol">${statusSymbol(ok)}</b>
        </div>
        <div class="agent-meta">${detail} · ${formatTime(row.checkedAt)}</div>
      </div>`;
    })
    .join("");
}

function renderExternalStatus(payload) {
  state.externalStatus = payload;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    el.mcpTable.innerHTML = `<tr><td colspan="3">${t("noData")}</td></tr>`;
    return;
  }
  el.mcpTable.innerHTML = rows
    .map(
      (row) =>
        `<tr><td>${row.app || "-"}</td><td>${row.agent || "-"}</td><td><span class="status-symbol">${statusSymbol(!!row.ok)}</span></td></tr>`
    )
    .join("");
}

function renderSummary(data) {
  state.summary = data;
  el.updatedAt.textContent = `${t("updatedAt")}：${formatTime(data.updatedAt)}`;
  renderMemory(data.memory || {});
  renderTokens(data.tokens || []);
  renderTasks(data.tasks || []);
  renderProjects(data.projects || {});
  renderAlerts(data.alerts || []);
}

function renderWorkplace(data) {
  state.workplace = data;
  const rows = data?.rows || [];
  el.workplaceMeta.textContent = `since ${formatTime(data.startedAt)} ｜ ${rows.length} rows`;

  const atBottom =
    el.workplaceFeed.scrollHeight - el.workplaceFeed.scrollTop - el.workplaceFeed.clientHeight < 20;

  if (!rows.length) {
    el.workplaceFeed.innerHTML = `<div class="work-item">${t("noWorkplace")}</div>`;
    return;
  }

  el.workplaceFeed.innerHTML = rows
    .map((row) => {
      const attachmentHtml = (row.attachments || [])
        .map((a) => `<div class="work-attachment"><a href="${a.url}" target="_blank" rel="noreferrer">${a.filename}</a></div>`)
        .join("");
      return `<div class="work-item">
        <div class="work-meta">${formatTime(row.timestamp)} · ${row.author}</div>
        <div>${row.content || "-"}</div>
        ${attachmentHtml}
      </div>`;
    })
    .join("");

  if (atBottom) {
    el.workplaceFeed.scrollTop = el.workplaceFeed.scrollHeight;
  }
}

function appendBubble(role, text, meta = "") {
  const node = document.createElement("div");
  node.className = `bubble ${role}`;
  if (meta) {
    const metaNode = document.createElement("div");
    metaNode.className = "bubble-meta";
    metaNode.textContent = meta;
    node.appendChild(metaNode);
  }
  const body = document.createElement("div");
  body.textContent = String(text || "");
  node.appendChild(body);
  el.chatboxMessages.appendChild(node);
  el.chatboxMessages.scrollTop = el.chatboxMessages.scrollHeight;
}

async function loadSummary() {
  if (!state.unlocked || state.loadingSummary) return;
  state.loadingSummary = true;
  try {
    const data = await fetchJson("/api/dashboard/summary");
    renderSummary(data);
  } finally {
    state.loadingSummary = false;
  }
}

async function loadAgentsStatus() {
  if (!state.unlocked) return;
  const data = await fetchJson("/api/agents/status");
  renderAgentStatus(data);
}

async function loadExternalStatus() {
  if (!state.unlocked) return;
  const data = await fetchJson("/api/external/status");
  renderExternalStatus(data);
}

async function loadModels() {
  if (!state.unlocked) return;
  const data = await fetchJson("/api/chat/models");
  const models = data.models || [];
  state.models = models;
  el.modelSelect.innerHTML = models
    .map((model) => `<option value="${model.key}">${model.label}</option>`)
    .join("");
}

async function loadWorkplace() {
  if (!state.unlocked || state.loadingWorkplace) return;
  state.loadingWorkplace = true;
  try {
    const data = await fetchJson("/api/workplace/messages?limit=120");
    renderWorkplace(data);
  } finally {
    state.loadingWorkplace = false;
  }
}

async function bootstrapDashboard() {
  if (!state.unlocked) return;
  if (!state.initialized) {
    state.initialized = true;
    setInterval(async () => {
      try {
        await loadSummary();
      } catch {
        return;
      }
    }, 1000);

    setInterval(async () => {
      try {
        await loadWorkplace();
      } catch {
        return;
      }
    }, 5000);

    setInterval(async () => {
      try {
        await loadAgentsStatus();
      } catch {
        return;
      }
    }, 60_000);

    setInterval(async () => {
      try {
        await loadExternalStatus();
      } catch {
        return;
      }
    }, 60_000);
  }

  await Promise.all([loadModels(), loadSummary(), loadAgentsStatus(), loadExternalStatus(), loadWorkplace()]);
  setStatus(t("ready"));
}

async function handleUnlock() {
  const password = String(el.unlockPassword.value || "").trim();
  if (!/^\d{6}$/.test(password)) {
    setUnlockError("Password must be 6 digits");
    return;
  }
  el.unlockBtn.disabled = true;
  setUnlockError("");
  try {
    const data = await fetchPublicJson("/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    unlockDashboard(data.token);
    await bootstrapDashboard();
  } catch (error) {
    setUnlockError(String(error.message || error));
  } finally {
    el.unlockBtn.disabled = false;
  }
}

async function handleSendChat() {
  const model = el.modelSelect.value;
  const message = el.chatboxInput.value.trim();
  if (!model) {
    setStatus(t("modelRequired"), true);
    return;
  }
  if (!message) {
    setStatus(t("msgRequired"), true);
    return;
  }

  appendBubble("user", message, model);

  const form = new FormData();
  form.append("model", model);
  form.append("message", message);

  setStatus(t("sending"));
  el.sendChatBtn.disabled = true;
  try {
    const resp = await fetch("/api/chat/intelligent", {
      method: "POST",
      headers: { "x-dashboard-token": state.authToken },
      body: form
    });
    const data = await resp.json();
    if (resp.status === 401) {
      lockDashboard();
      throw new Error("dashboard locked");
    }
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    const usage = data.usage || {};
    const meta = `${model} · in ${formatNum(usage.input)} · out ${formatNum(usage.output)} · total ${formatNum(usage.total)}`;
    appendBubble("assistant", data.reply || "-", meta);
    setStatus(t("ready"));
    el.chatboxInput.value = "";
    await loadSummary();
  } catch (error) {
    appendBubble("system", String(error.message || error));
    setStatus(String(error.message || error), true);
  } finally {
    el.sendChatBtn.disabled = false;
  }
}

function bindEvents() {
  el.unlockBtn.addEventListener("click", handleUnlock);
  el.unlockPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleUnlock();
    }
  });

  el.notionBtn.addEventListener("click", () => setStatus("Notion button ready (link pending)."));
  el.githubBtn.addEventListener("click", () => setStatus("GitHub button ready (link pending)."));
  el.zjzBtn.addEventListener("click", () => setStatus("zjz.world button ready (link pending)."));

  el.sendChatBtn.addEventListener("click", handleSendChat);
  el.chatboxInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSendChat();
    }
  });
}

function init() {
  applyLabels();
  bindEvents();
  lockDashboard();
  setStatus("Locked. Enter password to unlock.");
}

init();
