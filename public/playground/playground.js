const FALLBACK_MODELS = [
  { name: "GPT-5.3-Codex", provider: "codex", modelId: "gpt-5.3-codex" },
  { name: "Claude-Opus-4.6", provider: "claude", modelId: "claude-opus-4-6" },
  { name: "Qwen-coder-plus", provider: "bailian", modelId: "qwen3-coder-plus" },
  { name: "GLM-5", provider: "bailian", modelId: "glm-5" },
  { name: "Kimi-K2.5", provider: "bailian", modelId: "kimi-k2.5" },
  { name: "MiniMax-M2.5", provider: "bailian", modelId: "MiniMax-M2.5" }
];

const FALLBACK_DEFAULTS = ["GPT-5.3-Codex", "Claude-Opus-4.6"];
const STREAM_IDLE_TIMEOUT_MS = 25000;

const state = {
  allModels: [...FALLBACK_MODELS],
  selected: [...FALLBACK_DEFAULTS],
  running: false,
  resultsByName: new Map(),
  streamDone: false,
  lastStreamEventAt: 0
};

const el = {
  promptInput: document.getElementById("promptInput"),
  selectedModels: document.getElementById("selectedModels"),
  modelSelect: document.getElementById("modelSelect"),
  addModelBtn: document.getElementById("addModelBtn"),
  runBtn: document.getElementById("runBtn"),
  resultsGrid: document.getElementById("resultsGrid"),
  statusText: document.getElementById("statusText")
};

function setStatus(text) {
  el.statusText.textContent = text;
}

function autosizePrompt() {
  el.promptInput.style.height = "auto";
  const minHeight = 74;
  el.promptInput.style.height = `${Math.max(minHeight, el.promptInput.scrollHeight)}px`;
}

function availableModels() {
  const selectedSet = new Set(state.selected);
  return state.allModels.filter((row) => !selectedSet.has(row.name));
}

function renderModelSelect() {
  const available = availableModels();
  el.modelSelect.innerHTML = "";
  if (!available.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "All 6 models selected";
    el.modelSelect.appendChild(option);
    el.modelSelect.disabled = true;
    el.addModelBtn.disabled = true;
    return;
  }

  for (const row of available) {
    const option = document.createElement("option");
    option.value = row.name;
    option.textContent = row.name;
    el.modelSelect.appendChild(option);
  }
  el.modelSelect.disabled = false;
  el.addModelBtn.disabled = false;
}

function renderSelectedModels() {
  el.selectedModels.innerHTML = "";
  for (const name of state.selected) {
    const pill = document.createElement("div");
    pill.className = "model-pill";

    const label = document.createElement("span");
    label.textContent = name;
    pill.appendChild(label);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.title = `Remove ${name}`;
    remove.addEventListener("click", () => {
      if (state.selected.length <= 1) return;
      state.selected = state.selected.filter((item) => item !== name);
      renderSelectedModels();
      renderModelSelect();
      renderResultSkeletons();
    });
    pill.appendChild(remove);
    el.selectedModels.appendChild(pill);
  }
}

function resultMetaText(result) {
  if (!result) return "";
  if (result.status === "queued") return "Queued";
  if (result.status === "running") return "In response...";
  if (result.status === "failed" || result.ok === false) return `Failed · ${result.latencyMs || 0} ms`;
  if (result.status !== "done" && result.ok !== true) return "Ready";
  const tokenTotal = Number(result?.usage?.total || 0) || 0;
  return `${result.latencyMs || 0} ms · ${tokenTotal} tokens`;
}

function emptyResult(name) {
  return {
    name,
    status: "idle",
    ok: null,
    reply: "",
    error: "",
    modelId: "",
    latencyMs: 0,
    usage: { input: 0, output: 0, total: 0 },
    startedAt: 0
  };
}

function ensureSelectedResultRows(status = "idle") {
  const next = new Map();
  for (const name of state.selected) {
    const existing = state.resultsByName.get(name) || emptyResult(name);
    next.set(name, { ...existing, status: existing.status === "done" || existing.status === "failed" ? existing.status : status });
  }
  state.resultsByName = next;
}

function renderResultSkeletons() {
  ensureSelectedResultRows(state.running ? "queued" : "idle");
  renderResults(state.resultsByName);
}

function renderResults(resultsByName) {
  const count = Math.max(1, state.selected.length);
  el.resultsGrid.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
  el.resultsGrid.innerHTML = "";
  for (const name of state.selected) {
    const result = resultsByName.get(name) || null;
    const card = document.createElement("article");
    card.className = "result-card";

    const head = document.createElement("div");
    head.className = "result-head";

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = name;
    head.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = resultMetaText(result);
    head.appendChild(meta);

    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "result-body";
    if (!result) {
      body.classList.add("result-empty");
      body.textContent = "No response.";
    } else if (result.status === "queued") {
      body.classList.add("result-empty");
      body.textContent = "Queued...";
    } else if (result.status === "running") {
      body.textContent = result.reply ? `${result.reply}▌` : "In response...";
    } else if (result.status === "failed" || result.ok === false) {
      body.classList.add("result-empty");
      body.textContent = result.error || "Request failed.";
    } else if (result.status !== "done" && result.ok !== true) {
      body.classList.add("result-empty");
      body.textContent = "Waiting for prompt.";
    } else {
      body.textContent = result.reply || "(empty reply)";
    }
    card.appendChild(body);

    el.resultsGrid.appendChild(card);
  }
}

function patchResult(name, patch) {
  const current = state.resultsByName.get(name) || emptyResult(name);
  state.resultsByName.set(name, { ...current, ...patch });
}

function processSseFrame(frame) {
  state.lastStreamEventAt = Date.now();
  const lines = String(frame || "").split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  const raw = dataLines.join("\n").trim();
  if (!raw) return;
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  if (event === "init") {
    ensureSelectedResultRows("queued");
    renderResults(state.resultsByName);
    return;
  }

  if (event === "model_start") {
    patchResult(String(payload?.name || ""), {
      status: "running",
      ok: null,
      error: "",
      startedAt: Date.now(),
      modelId: String(payload?.modelId || "")
    });
    renderResults(state.resultsByName);
    return;
  }

  if (event === "model_delta") {
    const name = String(payload?.name || "");
    const row = state.resultsByName.get(name) || emptyResult(name);
    patchResult(name, {
      status: "running",
      reply: `${row.reply || ""}${String(payload?.delta || "")}`
    });
    renderResults(state.resultsByName);
    return;
  }

  if (event === "model_end") {
    const name = String(payload?.name || "");
    const row = state.resultsByName.get(name) || emptyResult(name);
    const incomingReply = String(payload?.reply || "");
    const mergedReply =
      incomingReply && incomingReply.startsWith(row.reply || "") ? incomingReply : String(row.reply || incomingReply || "");
    patchResult(name, {
      status: payload?.ok ? "done" : "failed",
      ok: !!payload?.ok,
      error: String(payload?.error || ""),
      reply: mergedReply,
      modelId: String(payload?.modelId || row.modelId || ""),
      latencyMs: Number(payload?.latencyMs || 0) || 0,
      usage: payload?.usage || row.usage || { input: 0, output: 0, total: 0 }
    });
    renderResults(state.resultsByName);
    return;
  }

  if (event === "complete") {
    state.streamDone = true;
    setStatus(`Completed in ${Number(payload?.elapsedMs || 0)} ms`);
    return;
  }

  if (event === "error") {
    setStatus(`Error: ${String(payload?.error || "stream failed")}`);
  }
}

function finalizePendingRows(reason = "Stream ended before completion.") {
  for (const name of state.selected) {
    const row = state.resultsByName.get(name) || emptyResult(name);
    if (row.status === "done" || row.status === "failed") continue;
    const hasPartial = String(row.reply || "").trim().length > 0;
    patchResult(name, {
      status: hasPartial ? "done" : "failed",
      ok: hasPartial,
      error: hasPartial ? "" : reason
    });
  }
  renderResults(state.resultsByName);
}

async function consumeEventStream(resp) {
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("stream not available");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processSseFrame(frame);
      idx = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) {
    processSseFrame(buffer);
  }
}

async function runPlayground() {
  const prompt = String(el.promptInput.value || "").trim();
  if (!prompt || state.running) return;

  state.running = true;
  state.streamDone = false;
  state.lastStreamEventAt = Date.now();
  state.resultsByName = new Map(state.selected.map((name) => [name, { ...emptyResult(name), status: "queued" }]));
  setStatus(`Running ${state.selected.length} model(s)...`);
  renderResults(state.resultsByName);
  el.runBtn.disabled = true;
  const abortController = new AbortController();
  const idleWatchdog = setInterval(() => {
    if (!state.running) return;
    if (Date.now() - Number(state.lastStreamEventAt || 0) > STREAM_IDLE_TIMEOUT_MS) {
      abortController.abort(`stream idle timeout (${Math.floor(STREAM_IDLE_TIMEOUT_MS / 1000)}s)`);
    }
  }, 1000);

  try {
    const resp = await fetch("/api/playground/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json"
      },
      signal: abortController.signal,
      body: JSON.stringify({
        prompt,
        models: [...state.selected],
        stream: true
      })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }

    const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      await consumeEventStream(resp);
      if (!state.streamDone) {
        finalizePendingRows("Stream closed unexpectedly.");
        setStatus("Stream closed unexpectedly.");
      }
    } else {
      throw new Error("stream required but server returned non-stream response");
    }
  } catch (error) {
    const errorText = String(error?.message || error);
    for (const name of state.selected) {
      const row = state.resultsByName.get(name) || emptyResult(name);
      if (row.status === "done") continue;
      patchResult(name, {
        status: "failed",
        ok: false,
        error: row.error || errorText
      });
    }
    setStatus(`Error: ${errorText}`);
    renderResults(state.resultsByName);
  } finally {
    clearInterval(idleWatchdog);
    state.running = false;
    el.runBtn.disabled = false;
  }
}

function bindEvents() {
  el.promptInput.addEventListener("input", autosizePrompt);
  el.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      runPlayground();
    }
  });

  el.addModelBtn.addEventListener("click", () => {
    const name = String(el.modelSelect.value || "").trim();
    if (!name) return;
    if (!state.selected.includes(name) && state.selected.length < 6) {
      state.selected.push(name);
      renderSelectedModels();
      renderModelSelect();
      renderResultSkeletons();
    }
  });

  el.runBtn.addEventListener("click", runPlayground);
}

async function loadModelCatalog() {
  try {
    const resp = await fetch("/api/playground/models");
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !Array.isArray(data?.models) || !data.models.length) {
      return;
    }
    state.allModels = data.models
      .map((row) => ({
        name: String(row?.name || "").trim(),
        provider: String(row?.provider || "").trim(),
        modelId: String(row?.modelId || "").trim()
      }))
      .filter((row) => row.name);

    const defaults = Array.isArray(data.defaults) ? data.defaults.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const selected = defaults.length ? defaults : [...FALLBACK_DEFAULTS];
    state.selected = selected.filter((name) => state.allModels.some((row) => row.name === name)).slice(0, 6);
    if (!state.selected.length && state.allModels.length) {
      state.selected = state.allModels.slice(0, 2).map((row) => row.name);
    }
  } catch {
    return;
  }
}

async function init() {
  await loadModelCatalog();
  bindEvents();
  renderSelectedModels();
  renderModelSelect();
  renderResultSkeletons();
  autosizePrompt();
  setStatus("Ready");
}

init();
