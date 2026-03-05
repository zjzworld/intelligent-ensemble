const FALLBACK_MODELS = [
  { name: "GPT-5.3-Codex", provider: "codex", modelId: "gpt-5.3-codex" },
  { name: "Claude-Opus-4.6", provider: "claude", modelId: "Claude-Opus-4.6" },
  { name: "Qwen-coder-plus", provider: "bailian", modelId: "qwen3-coder-plus" },
  { name: "GLM-5", provider: "bailian", modelId: "glm-5" },
  { name: "Kimi-K2.5", provider: "bailian", modelId: "kimi-k2.5" },
  { name: "MiniMax-M2.5", provider: "bailian", modelId: "MiniMax-M2.5" }
];

const FALLBACK_DEFAULTS = ["GPT-5.3-Codex", "Claude-Opus-4.6"];

const state = {
  allModels: [...FALLBACK_MODELS],
  selected: [...FALLBACK_DEFAULTS],
  running: false
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
  if (!result.ok) return `Failed · ${result.latencyMs || 0} ms`;
  const tokenTotal = Number(result?.usage?.total || 0) || 0;
  return `${result.latencyMs || 0} ms · ${tokenTotal} tokens`;
}

function renderResultSkeletons() {
  const count = Math.max(1, state.selected.length);
  el.resultsGrid.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
  el.resultsGrid.innerHTML = "";
  for (const name of state.selected) {
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
    meta.textContent = state.running ? "Running..." : "Ready";
    head.appendChild(meta);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "result-body result-empty";
    body.textContent = state.running ? "Generating response..." : "Waiting for prompt.";
    card.appendChild(body);

    el.resultsGrid.appendChild(card);
  }
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
    } else if (!result.ok) {
      body.classList.add("result-empty");
      body.textContent = result.error || "Request failed.";
    } else {
      body.textContent = result.reply || "(empty reply)";
    }
    card.appendChild(body);

    el.resultsGrid.appendChild(card);
  }
}

async function runPlayground() {
  const prompt = String(el.promptInput.value || "").trim();
  if (!prompt || state.running) return;

  state.running = true;
  setStatus(`Running ${state.selected.length} model(s)...`);
  renderResultSkeletons();
  el.runBtn.disabled = true;

  try {
    const resp = await fetch("/api/playground/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        models: [...state.selected]
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }

    const byName = new Map((Array.isArray(data.results) ? data.results : []).map((row) => [String(row.name || ""), row]));
    renderResults(byName);
    setStatus(`Completed in ${Number(data.elapsedMs || 0)} ms`);
  } catch (error) {
    setStatus(`Error: ${String(error?.message || error)}`);
    renderResultSkeletons();
  } finally {
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
