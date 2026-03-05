const UI = {
  chatboxTitle: "Karina Central Chat",
  chatAgentBadge: "Karina - Orchestrator",
  chatPlaceholder: "Type your message…",
  hooksTitle: "Hooks",
  skillsTitle: "Skills",
  rulesTitle: "Rules",
  memoryTitle: "Memory",
  agentTitle: "Agent",
  agentHint: "refresh every 1 minute",
  mcpTitle: "MCP",
  mcpHint: "refresh every 1 minute",
  tokenTitle: "Token",
  taskTitle: "Cron",
  projectTitle: "Project",
  workplaceTitle: "Workplace",
  thModel: "Model",
  thTokenDaily: "Daily Tokens",
  thTokenTotal: "Total Tokens",
  thAgentName: "Name",
  thAgentCharacter: "Character",
  thAgentModel: "Model",
  thAgentStatus: "Status",
  thTaskContent: "Task",
  thTaskCadence: "Cadence",
  thMcpApp: "App",
  thMcpAgent: "Agent",
  thMcpMethod: "Method",
  updatedAt: "Updated",
  modelRequired: "Please select model",
  msgRequired: "Please enter message",
  sending: "Sending…",
  ready: "Ready",
  noData: "No data",
  noWorkplace: "No collaboration records"
};

const API_BASE = "/api";

function apiUrl(path) {
  const clean = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
  return `${API_BASE}${clean}`;
}

const state = {
  authToken: "",
  unlocked: false,
  unlocking: false,
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
  unlockCard: document.querySelector(".unlock-card"),
  unlockDigits: document.getElementById("unlockDigits"),
  unlockError: document.getElementById("unlockError"),
  notionBtn: document.getElementById("notionBtn"),
  githubBtn: document.getElementById("githubBtn"),
  zjzBtn: document.getElementById("zjzBtn"),
  updatedAt: document.getElementById("updatedAt"),
  chatboxTitle: document.getElementById("chatboxTitle"),
  chatAgentBadge: document.getElementById("chatAgentBadge"),
  hooksTitle: document.getElementById("hooksTitle"),
  skillsTitle: document.getElementById("skillsTitle"),
  rulesTitle: document.getElementById("rulesTitle"),
  hooksList: document.getElementById("hooksList"),
  skillsList: document.getElementById("skillsList"),
  rulesList: document.getElementById("rulesList"),
  chatboxMessages: document.getElementById("chatboxMessages"),
  chatboxInput: document.getElementById("chatboxInput"),
  sendChatBtn: document.getElementById("sendChatBtn"),
  chatboxStatus: document.getElementById("chatboxStatus"),
  errorCode: document.getElementById("errorCode"),
  memoryTitle: document.getElementById("memoryTitle"),
  memoryTierRows: document.getElementById("memoryTierRows"),
  memoryVectorInfo: document.getElementById("memoryVectorInfo"),
  agentTitle: document.getElementById("agentTitle"),
  agentHint: document.getElementById("agentHint"),
  thAgentName: document.getElementById("thAgentName"),
  thAgentCharacter: document.getElementById("thAgentCharacter"),
  thAgentModel: document.getElementById("thAgentModel"),
  thAgentStatus: document.getElementById("thAgentStatus"),
  agentTable: document.getElementById("agentTable"),
  mcpTitle: document.getElementById("mcpTitle"),
  mcpHint: document.getElementById("mcpHint"),
  thMcpApp: document.getElementById("thMcpApp"),
  thMcpAgent: document.getElementById("thMcpAgent"),
  thMcpMethod: document.getElementById("thMcpMethod"),
  mcpTable: document.getElementById("mcpTable"),
  tokenTitle: document.getElementById("tokenTitle"),
  thModel: document.getElementById("thModel"),
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
  workplaceTitle: document.getElementById("workplaceTitle"),
  workplaceMeta: document.getElementById("workplaceMeta"),
  workplaceFeed: document.getElementById("workplaceFeed")
};
el.unlockDigitInputs = Array.from(document.querySelectorAll(".unlock-digit"));

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

function normalizeModelDisplay(raw) {
  const text = String(raw || "").trim();
  if (!text) return "-";
  const core = text.includes("::") ? text.split("::").slice(1).join("::") : text.split("·")[0].trim();
  const lower = core.toLowerCase();
  if (lower.includes("gpt-5.3-codex")) return "GPT-5.3-Codex";
  if (lower.includes("claude-opus-4.6")) return "Claude-Opus-4.6";
  if (lower.includes("qwen3.5-plus")) return "Qwen3.5-plus";
  if (lower.includes("qwen3-max-2026-01-23")) return "Qwen3-max-2026-01-23";
  if (lower.includes("qwen3-coder-next")) return "Qwen3-coder-next";
  if (lower.includes("qwen3-coder-plus")) return "Qwen3-coder-plus";
  if (lower.includes("minimax-m2.5")) return "Minimax-M2.5";
  if (lower.includes("glm-5")) return "Glm-5";
  if (lower.includes("glm-4.7")) return "Glm-4.7";
  if (lower.includes("kimi-k2.5")) return "Kimi-K2.5";
  return core;
}

function statusSymbol(ok) {
  return ok ? "✓" : "✕";
}

function extractErrorCode(text) {
  const raw = String(text || "");
  const directCode = raw.match(/\b[A-Z][A-Z0-9_]{2,}\b/);
  if (directCode) return directCode[0];
  const httpCode = raw.match(/\bHTTP\s*(\d{3})\b/i);
  if (httpCode) return `HTTP_${httpCode[1]}`;
  return raw ? "ERR_RUNTIME" : "-";
}

function setErrorCode(text = "") {
  if (!el.errorCode) return;
  const code = extractErrorCode(text);
  el.errorCode.textContent = code === "-" ? "-" : `Error: ${code}`;
}

function setStatus(text, isError = false) {
  el.chatboxStatus.textContent = text;
  el.chatboxStatus.style.color = isError ? "#b11111" : "#666";
  if (isError) {
    setErrorCode(text);
  } else if (!String(text || "").trim()) {
    setErrorCode("-");
  }
}

function setUnlockError(text) {
  if (!el.unlockError) return;
  el.unlockError.textContent = text || "";
}

function getUnlockPassword() {
  return el.unlockDigitInputs.map((input) => String(input.value || "").trim()).join("");
}

function clearUnlockDigits() {
  for (const input of el.unlockDigitInputs) {
    input.value = "";
  }
}

function focusUnlockDigit(preferEmpty = true) {
  const target =
    (preferEmpty ? el.unlockDigitInputs.find((input) => !String(input.value || "").trim()) : null) || el.unlockDigitInputs[0];
  target?.focus();
  target?.select?.();
}

function setAppLockedState(locked) {
  if (!el.appShell) return;
  if (locked) {
    el.appShell.setAttribute("inert", "");
    el.appShell.setAttribute("aria-hidden", "true");
  } else {
    el.appShell.removeAttribute("inert");
    el.appShell.removeAttribute("aria-hidden");
  }
}

function trapUnlockTab(event) {
  if (state.unlocked || event.key !== "Tab") return;
  const inputs = el.unlockDigitInputs;
  if (!inputs.length) return;
  const activeIndex = inputs.indexOf(document.activeElement);
  if (activeIndex === -1) {
    event.preventDefault();
    focusUnlockDigit();
    return;
  }
  if (event.shiftKey && activeIndex === 0) {
    event.preventDefault();
    inputs[inputs.length - 1]?.focus();
    return;
  }
  if (!event.shiftKey && activeIndex === inputs.length - 1) {
    event.preventDefault();
    inputs[0]?.focus();
  }
}

function enforceUnlockFocus(event) {
  if (state.unlocked) return;
  if (!el.unlockOverlay.contains(event.target)) {
    event.stopPropagation();
    focusUnlockDigit();
  }
}

function shakeUnlockCard() {
  el.unlockCard?.classList.remove("shake");
  void el.unlockCard?.offsetWidth;
  el.unlockCard?.classList.add("shake");
  setTimeout(() => {
    el.unlockCard?.classList.remove("shake");
  }, 320);
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(120);
  }
}

function lockDashboard() {
  state.unlocked = false;
  state.unlocking = false;
  state.authToken = "";
  setAppLockedState(true);
  el.appShell.classList.add("locked");
  el.unlockOverlay.classList.remove("hidden");
  setUnlockError("");
  clearUnlockDigits();
  setTimeout(() => {
    focusUnlockDigit();
  }, 0);
}

function unlockDashboard(token) {
  state.authToken = String(token || "");
  state.unlocked = true;
  setAppLockedState(false);
  el.appShell.classList.remove("locked");
  el.unlockOverlay.classList.add("hidden");
  setUnlockError("");
  clearUnlockDigits();
}

function applyLabels() {
  document.documentElement.lang = "en";
  el.chatboxTitle.textContent = t("chatboxTitle");
  el.chatAgentBadge.textContent = t("chatAgentBadge");
  el.chatboxInput.placeholder = t("chatPlaceholder");
  el.hooksTitle.textContent = t("hooksTitle");
  el.skillsTitle.textContent = t("skillsTitle");
  el.rulesTitle.textContent = t("rulesTitle");
  el.hooksList.innerHTML =
    '<div class="meta-item"><span class="meta-name">Post-run audit</span><span class="meta-detail">Verify delivery quality</span></div>' +
    '<div class="meta-item"><span class="meta-name">Token sync ingest</span><span class="meta-detail">Merge local/cloud usage</span></div>' +
    '<div class="meta-item"><span class="meta-name">Discord relay</span><span class="meta-detail">Mirror when enabled</span></div>';
  el.skillsList.innerHTML =
    '<div class="meta-item"><span class="meta-name">Planner</span><span class="meta-detail">Task split and sequencing</span></div>' +
    '<div class="meta-item"><span class="meta-name">Reviewer loop</span><span class="meta-detail">Quality and rollback check</span></div>' +
    '<div class="meta-item"><span class="meta-name">Deployment</span><span class="meta-detail">Git + Cloudflare release</span></div>';
  el.rulesList.innerHTML =
    '<div class="meta-item"><span class="meta-name">收到后执行</span><span class="meta-detail">默认立即开始处理</span></div>' +
    '<div class="meta-item"><span class="meta-name">完成再交接</span><span class="meta-detail">节点完成才交给下个角色</span></div>' +
    '<div class="meta-item"><span class="meta-name">短句交接</span><span class="meta-detail">交接语句随机短句池</span></div>';
  el.memoryTitle.textContent = t("memoryTitle");
  el.agentTitle.textContent = t("agentTitle");
  el.agentHint.textContent = t("agentHint");
  el.mcpTitle.textContent = t("mcpTitle");
  el.mcpHint.textContent = t("mcpHint");
  el.tokenTitle.textContent = t("tokenTitle");
  el.taskTitle.textContent = t("taskTitle");
  el.projectTitle.textContent = t("projectTitle");
  el.workplaceTitle.textContent = t("workplaceTitle");
  el.thModel.textContent = t("thModel");
  el.thTokenDaily.textContent = t("thTokenDaily");
  el.thTokenTotal.textContent = t("thTokenTotal");
  el.thAgentName.textContent = t("thAgentName");
  el.thAgentCharacter.textContent = t("thAgentCharacter");
  el.thAgentModel.textContent = t("thAgentModel");
  el.thAgentStatus.textContent = t("thAgentStatus");
  el.thTaskContent.textContent = t("thTaskContent");
  el.thTaskCadence.textContent = t("thTaskCadence");
  el.thMcpApp.textContent = t("thMcpApp");
  el.thMcpAgent.textContent = t("thMcpAgent");
  el.thMcpMethod.textContent = t("thMcpMethod");
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
  el.memoryVectorInfo.textContent = `Vector Quality: ${rate}%`;
}

function renderTokens(tokens) {
  if (!tokens || tokens.length === 0) {
    el.tokenTable.innerHTML = `<tr><td colspan="3">${t("noData")}</td></tr>`;
    return;
  }
  const merged = new Map();
  for (const row of tokens) {
    const modelName = normalizeModelDisplay(row.model);
    if (!merged.has(modelName)) {
      merged.set(modelName, { model: modelName, requests: 0, tokensDaily: 0, tokensTotal: 0 });
    }
    const target = merged.get(modelName);
    target.requests += Number(row.requests || 0);
    target.tokensDaily += Number(row.tokensDaily || 0);
    target.tokensTotal += Number(row.tokensTotal || 0);
  }
  const rows = [...merged.values()].sort((a, b) => b.tokensTotal - a.tokensTotal || b.requests - a.requests);
  el.tokenTable.innerHTML = rows
    .map(
      (row) =>
        `<tr><td>${row.model}</td><td>${formatNum(row.tokensDaily)}</td><td>${formatNum(row.tokensTotal)}</td></tr>`
    )
    .join("");
}

function renderTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    el.taskTable.innerHTML = `<tr><td colspan="2">${t("noData")}</td></tr>`;
    return;
  }
  el.taskTable.innerHTML = tasks
    .slice(0, 5)
    .map((row) => `<tr><td>${row.content || "-"}</td><td>${row.cadence || "-"}</td></tr>`)
    .join("");
}

function renderProjects(projects) {
  const rows = (projects?.rows || []).slice(0, 5);
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

function renderAlertCode(alerts) {
  if (!Array.isArray(alerts) || !alerts.length) {
    setErrorCode("-");
    return;
  }
  const first = alerts[0] || {};
  if (String(first.type || "").toUpperCase() === "OK") {
    setErrorCode("-");
    return;
  }
  const detail = [first.type, first.detail].filter(Boolean).join(" ");
  setErrorCode(detail || "ERR_RUNTIME");
}

function renderAgentStatus(payload) {
  state.agentsStatus = payload;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length === 0) {
    el.agentTable.innerHTML = `<tr><td colspan="4">${t("noData")}</td></tr>`;
    return;
  }
  const defaultModelByName = {
    Karina: "Qwen3.5-plus",
    Goeun: "Qwen3-max-2026-01-23",
    Suzy: "Qwen3-coder-plus",
    Jisoo: "Qwen3-coder-next"
  };
  el.agentTable.innerHTML = rows
    .map((row) => {
      const label = String(row.label || row.id || "-");
      const parts = label.split(" - ");
      const name = parts[0] || label;
      const character = parts.slice(1).join(" - ") || "Specialist";
      const model = row.model || defaultModelByName[name] || "Qwen3.5-plus";
      const ok = row.enabled !== false && !!row.ok;
      return `<tr>
        <td>${name}</td>
        <td>${character}</td>
        <td>${model}</td>
        <td><span class="status-symbol">${statusSymbol(ok)}</span></td>
      </tr>`;
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
  const inferMethod = (row) => {
    const text = `${row?.app || ""} ${row?.detail || ""}`.toLowerCase();
    if (text.includes("oauth")) return "OAuth";
    return "API";
  };
  el.mcpTable.innerHTML = rows
    .map((row) => `<tr><td>${row.app || "-"}</td><td>${row.agent || "-"}</td><td>${inferMethod(row)}</td></tr>`)
    .join("");
}

function renderSummary(data) {
  state.summary = data;
  el.updatedAt.textContent = `${t("updatedAt")}：${formatTime(data.updatedAt)}`;
  renderMemory(data.memory || {});
  renderTokens(data.tokens || []);
  renderTasks(data.tasks || []);
  renderProjects(data.projects || {});
  renderAlertCode(data.alerts || []);
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
    const data = await fetchJson(apiUrl("/dashboard/summary"));
    renderSummary(data);
  } finally {
    state.loadingSummary = false;
  }
}

async function loadAgentsStatus() {
  if (!state.unlocked) return;
  const data = await fetchJson(apiUrl("/agents/status"));
  renderAgentStatus(data);
}

async function loadExternalStatus() {
  if (!state.unlocked) return;
  const data = await fetchJson(apiUrl("/external/status"));
  renderExternalStatus(data);
}

async function loadModels() {
  return;
}

async function loadWorkplace() {
  if (!state.unlocked || state.loadingWorkplace) return;
  state.loadingWorkplace = true;
  try {
    const data = await fetchJson(apiUrl("/workplace/messages?limit=120"));
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

  await Promise.all([loadSummary(), loadAgentsStatus(), loadExternalStatus(), loadWorkplace()]);
  setStatus(t("ready"));
}

async function handleUnlock() {
  if (state.unlocking) return;
  const password = getUnlockPassword();
  if (!/^\d{6}$/.test(password)) {
    shakeUnlockCard();
    clearUnlockDigits();
    focusUnlockDigit(false);
    return;
  }
  state.unlocking = true;
  setUnlockError("");
  try {
    const data = await fetchPublicJson(apiUrl("/auth/unlock"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    unlockDashboard(data.token);
    await bootstrapDashboard();
  } catch (error) {
    shakeUnlockCard();
    clearUnlockDigits();
    focusUnlockDigit(false);
  } finally {
    state.unlocking = false;
  }
}

function maybeAutoUnlock() {
  const password = getUnlockPassword();
  if (/^\d{6}$/.test(password)) {
    handleUnlock();
  }
}

async function handleSendChat() {
  const message = el.chatboxInput.value.trim();
  if (!message) {
    setStatus(t("msgRequired"), true);
    return;
  }

  appendBubble("user", message, "Karina");

  setStatus(t("sending"));
  el.sendChatBtn.disabled = true;
  try {
    const resp = await fetch(apiUrl("/chat/karina"), {
      method: "POST",
      headers: {
        "x-dashboard-token": state.authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });
    const data = await resp.json();
    if (resp.status === 401) {
      lockDashboard();
      throw new Error("dashboard locked");
    }
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    appendBubble("assistant", data.reply || "已发送给 Karina。", "Karina");
    setStatus(t("ready"));
    el.chatboxInput.value = "";
    await Promise.all([loadSummary(), loadWorkplace()]);
  } catch (error) {
    appendBubble("system", String(error.message || error));
    setStatus(String(error.message || error), true);
  } finally {
    el.sendChatBtn.disabled = false;
  }
}

function bindEvents() {
  el.unlockDigitInputs.forEach((input, index) => {
    input.addEventListener("focus", () => {
      input.select?.();
    });

    input.addEventListener("input", () => {
      const digits = String(input.value || "").replace(/\D+/g, "");
      if (!digits) {
        input.value = "";
        maybeAutoUnlock();
        return;
      }
      if (digits.length === 1) {
        input.value = digits;
        if (index < el.unlockDigitInputs.length - 1) {
          el.unlockDigitInputs[index + 1].focus();
        }
        maybeAutoUnlock();
        return;
      }
      const maxFill = el.unlockDigitInputs.length - index;
      const fill = digits.slice(0, maxFill).split("");
      fill.forEach((char, offset) => {
        const target = el.unlockDigitInputs[index + offset];
        if (target) target.value = char;
      });
      const nextIndex = index + fill.length;
      if (nextIndex < el.unlockDigitInputs.length) {
        el.unlockDigitInputs[nextIndex]?.focus();
      } else {
        el.unlockDigitInputs[el.unlockDigitInputs.length - 1]?.focus();
      }
      maybeAutoUnlock();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleUnlock();
        return;
      }
      if (event.key === "Backspace" && !input.value && index > 0) {
        el.unlockDigitInputs[index - 1].focus();
      }
    });

    input.addEventListener("paste", (event) => {
      const text = String(event.clipboardData?.getData("text") || "").replace(/\D+/g, "").slice(0, 6);
      if (!text) return;
      event.preventDefault();
      text.split("").forEach((char, offset) => {
        const target = el.unlockDigitInputs[index + offset];
        if (target) target.value = char;
      });
      const nextIndex = index + text.length;
      if (nextIndex < el.unlockDigitInputs.length) {
        el.unlockDigitInputs[nextIndex]?.focus();
      } else {
        el.unlockDigitInputs[el.unlockDigitInputs.length - 1]?.focus();
      }
      maybeAutoUnlock();
    });
  });

  document.addEventListener("keydown", trapUnlockTab, true);
  document.addEventListener("focusin", enforceUnlockFocus, true);
  el.unlockOverlay.addEventListener("pointerdown", (event) => {
    if (state.unlocked) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("unlock-digit")) return;
    event.preventDefault();
    focusUnlockDigit();
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
  setStatus("");
  setErrorCode("-");
}

init();
