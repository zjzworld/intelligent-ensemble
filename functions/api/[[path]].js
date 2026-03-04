const DEFAULT_PASSWORD = "592909";
const DEFAULT_AUTH_SECRET = "intelligent-ensemble-auth-secret";
const AUTH_TTL_MS = 12 * 60 * 60 * 1000;

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

const MODELS = [
  { key: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 mini", supportsImage: false },
  { key: "openai/gpt-4.1", label: "OpenAI GPT-4.1", supportsImage: false },
  { key: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini", supportsImage: false },
  { key: "qwen/qwen3-max", label: "Qwen3 Max", supportsImage: false },
  { key: "glm/glm-5", label: "GLM-5", supportsImage: false },
  { key: "kimi/k2.5", label: "Kimi K2.5", supportsImage: false }
];

function getState() {
  if (!globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE) {
    globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE = {
      startedAt: new Date().toISOString(),
      tokenEvents: [],
      alerts: [],
      workplace: []
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

function buildTokenRows(state) {
  const map = new Map();
  const today = new Date().toISOString().slice(0, 10);
  for (const row of state.tokenEvents) {
    const key = row.model || "unknown";
    if (!map.has(key)) {
      map.set(key, { model: key, requests: 0, tokensDaily: 0, tokensTotal: 0 });
    }
    const target = map.get(key);
    target.requests += 1;
    target.tokensTotal += Number(row.totalTokens || 0);
    if (String(row.ts || "").slice(0, 10) === today) {
      target.tokensDaily += Number(row.totalTokens || 0);
    }
  }
  return [...map.values()].sort((a, b) => b.tokensTotal - a.tokensTotal).slice(0, 20);
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
    tokens: buildTokenRows(state),
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
  return {
    updatedAt: checkedAt,
    rows: [
      { app: "Cloudflare Pages", agent: "Karina - Orchestrator", ok: true, detail: "active", checkedAt },
      { app: "GitHub", agent: "Seunggi - DevOps", ok: true, detail: "connected", checkedAt },
      { app: "Notion", agent: "Haerin - DocOps", ok: false, detail: "not configured", checkedAt },
      { app: "Discord API", agent: "Karina - Orchestrator", ok: false, detail: "not configured", checkedAt }
    ]
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
    return json(buildSummary(state));
  }

  if (route === "/agents/status" && method === "GET") {
    return json(buildAgentsStatus());
  }

  if (route === "/external/status" && method === "GET") {
    return json(buildExternalStatus());
  }

  if (route === "/chat/models" && method === "GET") {
    return json({ models: MODELS });
  }

  if (route === "/workplace/messages" && method === "GET") {
    return json(buildWorkplace(state, url.searchParams.get("limit")));
  }

  if (route === "/chat/intelligent" && method === "POST") {
    const body = await readPayload(request);
    const model = String(body?.model || "").trim();
    const message = String(body?.message || "").trim();
    if (!model) {
      return json({ ok: false, error: "missing model" }, 400);
    }
    if (!message) {
      return json({ ok: false, error: "message required" }, 400);
    }

    const reply = `Edge assistant: ${message}`;
    const usage = estimateUsage(message, reply);
    state.tokenEvents.push({
      ts: nowIso(),
      model,
      totalTokens: usage.total
    });
    if (state.tokenEvents.length > 5000) {
      state.tokenEvents.splice(0, state.tokenEvents.length - 5000);
    }

    addWorkplaceRow(state, "Owner", message);
    addWorkplaceRow(state, "Assistant", reply);

    return json({
      ok: true,
      model,
      reply,
      usage
    });
  }

  recordAlert(state, "EDGE_ROUTE_MISS", `${method} ${route}`, "low");
  return json({ ok: false, error: "Not found" }, 404);
};
