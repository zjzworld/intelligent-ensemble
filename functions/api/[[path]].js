const DEFAULT_PASSWORD = "592909";
const DEFAULT_AUTH_SECRET = "intelligent-ensemble-auth-secret";
const AUTH_TTL_MS = 12 * 60 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 1000;

const AGENTS = [
  "Karina - Orchestrator",
  "Goeun - Architect",
  "Suzy - Frontend",
  "Jisoo - Backend",
  "Jiwon - Designer",
  "Seunggi - DevOps",
  "Boyoung - QA",
  "YoonA - Reviewer",
  "Minji - Memory Curator",
  "Danielle - Data/Security",
  "Haerin - DocOps"
];

const FALLBACK_BAILIAN_MODELS = [
  "qwen3-max-2026-01-23",
  "qwen3.5-plus",
  "qwen3-coder-plus",
  "qwen3-coder-next",
  "glm-5",
  "glm-4.7",
  "MiniMax-M2.5",
  "kimi-k2.5"
];

const FALLBACK_CODEX_MODELS = ["gpt-5.3-codex", "gpt-5-codex"];

const STATIC_EXTERNAL_APPS = [
  { app: "Cloudflare Pages", agent: "Karina - Orchestrator", ok: true, detail: "active" },
  { app: "GitHub", agent: "Seunggi - DevOps", ok: true, detail: "connected" },
  { app: "Notion", agent: "Haerin - DocOps", ok: false, detail: "not configured" },
  { app: "Discord API", agent: "Karina - Orchestrator", ok: false, detail: "not configured" }
];

function getState() {
  if (!globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE) {
    globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE = {
      startedAt: new Date().toISOString(),
      tokenEvents: [],
      alerts: [],
      workplace: [],
      modelCatalog: [],
      modelCatalogRefreshedAt: 0,
      modelSourceStatus: {}
    };
  }
  return globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\/+$/, "");
}

function makeModelKey(provider, modelId) {
  return `${provider}::${modelId}`;
}

function parseModelKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.includes("::")) {
    const [provider, ...rest] = text.split("::");
    const modelId = rest.join("::");
    if (!provider || !modelId) return null;
    return { provider, modelId, key: text };
  }
  return { provider: "legacy", modelId: text, key: text };
}

function providerConfig(env) {
  const bailian = {
    name: "bailian",
    label: "Bailian",
    baseUrl: normalizeBaseUrl(env.BAILIAN_BASE_URL || ""),
    apiKey: String(env.BAILIAN_API_KEY || "").trim(),
    modelPath: String(env.BAILIAN_MODEL_PATH || "/models").trim(),
    chatPath: String(env.BAILIAN_CHAT_PATH || "/chat/completions").trim(),
    fallbackModels: parseCsv(env.BAILIAN_MODELS).length ? parseCsv(env.BAILIAN_MODELS) : FALLBACK_BAILIAN_MODELS
  };

  const codex = {
    name: "codex",
    label: "Codex",
    baseUrl: normalizeBaseUrl(env.CODEX_BASE_URL || ""),
    apiKey: String(env.CODEX_API_KEY || "").trim(),
    modelPath: String(env.CODEX_MODEL_PATH || "/models").trim(),
    chatPath: String(env.CODEX_CHAT_PATH || "/chat/completions").trim(),
    fallbackModels: parseCsv(env.CODEX_MODELS).length ? parseCsv(env.CODEX_MODELS) : FALLBACK_CODEX_MODELS
  };

  return { bailian, codex };
}

function buildModelRows(providerName, providerLabel, modelIds) {
  const uniqueIds = [...new Set((modelIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  return uniqueIds.map((modelId) => ({
    key: makeModelKey(providerName, modelId),
    modelId,
    provider: providerName,
    label: `${modelId} · ${providerLabel}`,
    supportsImage: false
  }));
}

function pickModelIds(payload) {
  const listCandidates = [
    payload,
    payload?.data,
    payload?.models,
    payload?.result,
    payload?.result?.data,
    payload?.result?.models
  ];
  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue;
    const ids = candidate
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return item.id || item.model || item.name || item.key || "";
      })
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (ids.length) return ids;
  }
  return [];
}

function bytesToBase64Url(bytes) {
  let bin = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of view) bin += String.fromCharCode(value);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToText(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(sig);
}

function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let result = 0;
  for (let i = 0; i < x.length; i += 1) {
    result |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return result === 0;
}

async function issueAuthToken(secret) {
  const payload = {
    iat: Date.now(),
    exp: Date.now() + AUTH_TTL_MS
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(payloadB64, secret);
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(payload.exp).toISOString()
  };
}

async function verifyAuthToken(token, secret) {
  const normalized = String(token || "").trim();
  if (!normalized || !normalized.includes(".")) return false;
  const [payloadB64, sig] = normalized.split(".", 2);
  if (!payloadB64 || !sig) return false;
  const expected = await hmacSign(payloadB64, secret);
  if (!safeEqual(sig, expected)) return false;
  const payloadText = base64UrlToText(payloadB64);
  if (!payloadText) return false;
  let payload = null;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return false;
  }
  const exp = Number(payload?.exp || 0);
  return Number.isFinite(exp) && exp > Date.now();
}

function recordAlert(state, type, detail, severity = "medium") {
  state.alerts.push({
    time: nowIso(),
    type,
    detail,
    severity
  });
  if (state.alerts.length > 200) {
    state.alerts.splice(0, state.alerts.length - 200);
  }
}

function normalizeReplyContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return item.text || item.content || "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return String(content.text || content.content || "").trim();
  }
  return "";
}

function normalizeUsage(payload, inputText, outputText) {
  const usage = payload?.usage || {};
  const input =
    Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? usage.input ?? 0) || 0;
  const output =
    Number(
      usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? usage.output ?? 0
    ) || 0;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? usage.total ?? input + output) || input + output;
  if (input > 0 || output > 0 || total > 0) {
    return { input, output, total };
  }
  return estimateUsage(inputText, outputText);
}

async function fetchProviderModels(config) {
  if (!config.baseUrl || !config.apiKey) {
    return {
      ok: false,
      detail: "missing base url or api key",
      models: buildModelRows(config.name, config.label, config.fallbackModels)
    };
  }
  const target = `${config.baseUrl}${config.modelPath}`;
  try {
    const resp = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      }
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = payload?.error?.message || payload?.message || `HTTP ${resp.status}`;
      return {
        ok: false,
        detail: `models failed: ${err}`,
        models: buildModelRows(config.name, config.label, config.fallbackModels)
      };
    }
    const ids = pickModelIds(payload);
    if (!ids.length) {
      return {
        ok: false,
        detail: "models empty, fallback used",
        models: buildModelRows(config.name, config.label, config.fallbackModels)
      };
    }
    let finalIds = ids;
    if (config.name === "codex") {
      const codexOnly = ids.filter((id) => /codex/i.test(id));
      if (codexOnly.length) finalIds = codexOnly;
    }
    return {
      ok: true,
      detail: `${finalIds.length} models`,
      models: buildModelRows(config.name, config.label, finalIds)
    };
  } catch (error) {
    return {
      ok: false,
      detail: `models error: ${String(error?.message || error)}`,
      models: buildModelRows(config.name, config.label, config.fallbackModels)
    };
  }
}

async function refreshModelCatalog(state, env, force = false) {
  const now = Date.now();
  if (!force && state.modelCatalog.length && now - Number(state.modelCatalogRefreshedAt || 0) < MODEL_CACHE_TTL_MS) {
    return state.modelCatalog;
  }

  const providers = providerConfig(env);
  const [bailianResult, codexResult] = await Promise.all([
    fetchProviderModels(providers.bailian),
    fetchProviderModels(providers.codex)
  ]);

  const merged = [...(bailianResult.models || []), ...(codexResult.models || [])];
  state.modelCatalog = merged;
  state.modelCatalogRefreshedAt = now;
  state.modelSourceStatus = {
    bailian: { ok: bailianResult.ok, detail: bailianResult.detail },
    codex: { ok: codexResult.ok, detail: codexResult.detail }
  };
  return state.modelCatalog;
}

function resolveCatalogModel(catalog, rawValue) {
  const parsed = parseModelKey(rawValue);
  if (!parsed) return null;
  const row = (catalog || []).find((item) => item.key === parsed.key);
  if (row) return row;
  if (parsed.provider === "legacy") {
    const legacyMatch = (catalog || []).find((item) => item.modelId === parsed.modelId);
    if (legacyMatch) return legacyMatch;
  }
  return null;
}

async function callProviderChat(config, modelId, message) {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error(`${config.label} gateway not configured`);
  }
  const endpoint = `${config.baseUrl}${config.chatPath}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: message }],
      stream: false
    })
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = payload?.error?.message || payload?.message || `HTTP ${resp.status}`;
    throw new Error(`${config.label} chat failed: ${err}`);
  }
  const content = payload?.choices?.[0]?.message?.content ?? payload?.output?.text ?? "";
  const reply = normalizeReplyContent(content) || "(empty reply)";
  const usage = normalizeUsage(payload, message, reply);
  return { reply, usage };
}

function buildTokenRows(state, modelCatalog = []) {
  const map = new Map();
  const order = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const row of modelCatalog) {
    if (!row?.key || map.has(row.key)) continue;
    map.set(row.key, { model: row.label || row.key, requests: 0, tokensDaily: 0, tokensTotal: 0 });
    order.push(row.key);
  }

  for (const row of state.tokenEvents) {
    const key = row.modelKey || row.model || "unknown";
    if (!map.has(key)) {
      map.set(key, { model: row.modelLabel || key, requests: 0, tokensDaily: 0, tokensTotal: 0 });
      order.push(key);
    }
    const target = map.get(key);
    target.requests += 1;
    target.tokensTotal += Number(row.totalTokens || 0);
    if (String(row.ts || "").slice(0, 10) === today) {
      target.tokensDaily += Number(row.totalTokens || 0);
    }
  }
  return order.map((key) => map.get(key)).filter(Boolean);
}

function buildSummary(state) {
  const alerts = [...state.alerts].sort((a, b) => Date.parse(b.time || "") - Date.parse(a.time || "")).slice(0, 20);
  return {
    updatedAt: nowIso(),
    memory: {
      tierCounts: { T0: 6, T1: 103, T2: 30, T3: 605 },
      vector: {
        qualityRate: 92.4,
        sampleSize: 30,
        poolSize: 824,
        lastRunAt: nowIso(),
        nextRunAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      },
      totalFiles: 744
    },
    tokens: buildTokenRows(state, state.modelCatalog || []),
    tasks: [
      { content: "Pipeline memory sync", cadence: "Every 1m" },
      { content: "Vector quality probe", cadence: "Every 30m" },
      { content: "Discord workplace sync", cadence: "Every 5s" }
    ],
    projects: {
      completed: 0,
      total: 1,
      rows: [
        {
          name: "Intelligent Ensemble",
          progress: 82,
          status: "in_progress",
          updatedAt: nowIso()
        }
      ]
    },
    alerts: alerts.length
      ? alerts
      : [
          {
            time: nowIso(),
            type: "OK",
            severity: "low",
            detail: "No active alert"
          }
        ],
    workplace: {
      projectStartedAt: state.startedAt
    }
  };
}

function buildAgentsStatus() {
  const checkedAt = nowIso();
  return {
    updatedAt: checkedAt,
    rows: AGENTS.map((label, index) => ({
      id: `agent_${index + 1}`,
      label,
      enabled: true,
      checkedAt,
      ok: true,
      username: "",
      detail: "edge api ok"
    }))
  };
}

function buildExternalStatus() {
  const checkedAt = nowIso();
  const source = getState().modelSourceStatus || {};
  const modelSources = [
    {
      app: "Bailian Models API",
      agent: "Karina - Orchestrator",
      ok: !!source?.bailian?.ok,
      detail: source?.bailian?.detail || "not checked"
    },
    {
      app: "Codex Models API",
      agent: "Karina - Orchestrator",
      ok: !!source?.codex?.ok,
      detail: source?.codex?.detail || "not checked"
    }
  ];
  return {
    updatedAt: checkedAt,
    rows: [...STATIC_EXTERNAL_APPS, ...modelSources].map((row) => ({ ...row, checkedAt }))
  };
}

function buildWorkplace(state, limit = 120) {
  return {
    ok: true,
    startedAt: state.startedAt,
    rows: state.workplace.slice(-Math.max(1, Math.min(200, Number(limit) || 120)))
  };
}

function addWorkplaceRow(state, author, content) {
  state.workplace.push({
    id: crypto.randomUUID(),
    timestamp: nowIso(),
    author,
    content,
    attachments: []
  });
  if (state.workplace.length > 500) {
    state.workplace.splice(0, state.workplace.length - 500);
  }
}

function estimateUsage(input, output) {
  const inTokens = Math.max(1, Math.ceil(String(input || "").length / 2));
  const outTokens = Math.max(1, Math.ceil(String(output || "").length / 2));
  return {
    input: inTokens,
    output: outTokens,
    total: inTokens + outTokens
  };
}

async function readPayload(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      return {
        model: form.get("model"),
        message: form.get("message")
      };
    } catch {
      return {};
    }
  }
  return {};
}

export const onRequest = async (context) => {
  const { request, env } = context;
  const state = getState();
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const routeMatch = pathname.match(/\/api(\/.*)?$/);
  const route = routeMatch ? routeMatch[1] || "/" : pathname.replace(/^\/api/, "") || "/";
  const password = String(env.DASHBOARD_PASSWORD || DEFAULT_PASSWORD).trim();
  const authSecret = String(env.AUTH_SECRET || DEFAULT_AUTH_SECRET).trim();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (route === "/auth/unlock" && method === "POST") {
    const body = await readPayload(request);
    const inputPassword = String(body?.password || "").trim();
    if (!/^\d{6}$/.test(inputPassword)) {
      return json({ ok: false, error: "password must be 6 digits" }, 400);
    }
    if (inputPassword !== password) {
      return json({ ok: false, error: "invalid password" }, 401);
    }
    const token = await issueAuthToken(authSecret);
    return json({ ok: true, token: token.token, expiresAt: token.expiresAt });
  }

  if (route === "/auth/check" && method === "GET") {
    const token = request.headers.get("x-dashboard-token") || "";
    const valid = await verifyAuthToken(token, authSecret);
    if (!valid) return json({ ok: false, error: "dashboard locked" }, 401);
    return json({ ok: true });
  }

  const authToken = request.headers.get("x-dashboard-token") || "";
  const authed = await verifyAuthToken(authToken, authSecret);
  if (!authed) {
    return json({ ok: false, error: "dashboard locked" }, 401);
  }

  if (route === "/dashboard/summary" && method === "GET") {
    await refreshModelCatalog(state, env);
    return json(buildSummary(state));
  }

  if (route === "/agents/status" && method === "GET") {
    return json(buildAgentsStatus());
  }

  if (route === "/external/status" && method === "GET") {
    await refreshModelCatalog(state, env);
    return json(buildExternalStatus());
  }

  if (route === "/chat/models" && method === "GET") {
    await refreshModelCatalog(state, env, true);
    return json({ models: state.modelCatalog || [] });
  }

  if (route === "/workplace/messages" && method === "GET") {
    return json(buildWorkplace(state, url.searchParams.get("limit")));
  }

  if (route === "/chat/intelligent" && method === "POST") {
    try {
      await refreshModelCatalog(state, env);
      const providers = providerConfig(env);
      const body = await readPayload(request);
      const model = String(body?.model || "").trim();
      const message = String(body?.message || "").trim();
      if (!model) {
        return json({ ok: false, error: "missing model" }, 400);
      }
      if (!message) {
        return json({ ok: false, error: "message required" }, 400);
      }

      const selected = resolveCatalogModel(state.modelCatalog || [], model);
      if (!selected) {
        return json({ ok: false, error: "model not available" }, 400);
      }

      let chatResult = null;
      if (selected.provider === "bailian") {
        chatResult = await callProviderChat(providers.bailian, selected.modelId, message);
      } else if (selected.provider === "codex") {
        chatResult = await callProviderChat(providers.codex, selected.modelId, message);
      } else {
        return json({ ok: false, error: "unsupported model provider" }, 400);
      }

      const reply = chatResult.reply;
      const usage = chatResult.usage;
      state.tokenEvents.push({
        ts: nowIso(),
        model: selected.key,
        modelKey: selected.key,
        modelLabel: selected.label,
        totalTokens: usage.total
      });
      if (state.tokenEvents.length > 5000) {
        state.tokenEvents.splice(0, state.tokenEvents.length - 5000);
      }

      addWorkplaceRow(state, "Owner", message);
      addWorkplaceRow(state, `${selected.provider} / ${selected.modelId}`, reply);

      return json({
        ok: true,
        model: selected.key,
        reply,
        usage
      });
    } catch (error) {
      const errText = String(error?.message || error);
      recordAlert(state, "CHAT_PROVIDER_ERROR", errText, "high");
      if (/gateway not configured|chat failed/i.test(errText)) {
        return json({ ok: false, error: errText }, 502);
      }
      return json({ ok: false, error: `chat fatal: ${errText}` }, 500);
    }
  }

  recordAlert(state, "EDGE_ROUTE_MISS", `${method} ${route}`, "low");
  return json({ ok: false, error: "Not found" }, 404);
};
