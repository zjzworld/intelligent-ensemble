const DEFAULT_PASSWORD = "592909";
const DEFAULT_AUTH_SECRET = "intelligent-ensemble-auth-secret";
const AUTH_TTL_MS = 12 * 60 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 1000;
const DISCORD_CACHE_TTL_MS = 5 * 1000;
const TOKEN_SYNC_CACHE_TTL_MS = 1000;
const DISCORD_API_BASE = "https://discord.com/api/v10";

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
  { app: "Notion", agent: "Haerin - DocOps", ok: false, detail: "not configured" }
];

function getState() {
  if (!globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE) {
    globalThis.__INTELLIGENT_ENSEMBLE_EDGE_STATE = {
      startedAt: new Date().toISOString(),
      tokenEvents: [],
      tokenEventsRefreshedAt: 0,
      alerts: [],
      workplace: [],
      modelCatalog: [],
      modelCatalogRefreshedAt: 0,
      modelSourceStatus: {},
      discordFeedRows: [],
      discordFeedRefreshedAt: 0,
      discordFeedStatus: { ok: false, detail: "not checked" },
      syncedTokenRows: [],
      syncedTokenStatus: { ok: false, detail: "not checked" },
      syncedTokenRowsRefreshedAt: 0,
      sqliteReady: false
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

function providerDisplayName(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "bailian") return "Bailian";
  if (value === "codex" || value === "openai-codex") return "Codex";
  if (!value) return "Unknown";
  return value;
}

function normalizeTokenModelRef(rawModel, modelCatalog = []) {
  const text = String(rawModel || "").trim();
  if (!text) return { key: "sync::unknown", label: "unknown" };

  const parsed = parseModelKey(text);
  if (!parsed) return { key: `sync::${text}`, label: text };

  if (parsed.provider === "legacy") {
    const catalogMatch = (modelCatalog || []).find((item) => item.modelId === parsed.modelId);
    if (catalogMatch) {
      return { key: catalogMatch.key, label: catalogMatch.label || catalogMatch.key };
    }
    return { key: `sync::${parsed.modelId}`, label: parsed.modelId };
  }

  const catalogMatch = (modelCatalog || []).find((item) => item.key === parsed.key);
  if (catalogMatch) {
    return { key: catalogMatch.key, label: catalogMatch.label || catalogMatch.key };
  }

  return {
    key: parsed.key,
    label: `${parsed.modelId} · ${providerDisplayName(parsed.provider)}`
  };
}

function getSqliteDb(env) {
  return env.DASHBOARD_DB || env.DB || null;
}

async function ensureSqliteReady(state, env) {
  const db = getSqliteDb(env);
  if (!db) return null;
  if (state.sqliteReady) return db;

  const schema = [
    `CREATE TABLE IF NOT EXISTS discord_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_discord_messages_ts ON discord_messages(channel_id, ts DESC)",
    `CREATE TABLE IF NOT EXISTS token_sync_rows (
      model TEXT PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      tokens_daily INTEGER NOT NULL DEFAULT 0,
      tokens_total INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS token_chat_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      model_key TEXT NOT NULL,
      model_label TEXT NOT NULL,
      total_tokens INTEGER NOT NULL DEFAULT 0
    )`,
    "CREATE INDEX IF NOT EXISTS idx_token_chat_events_ts ON token_chat_events(ts DESC)",
    `CREATE TABLE IF NOT EXISTS token_local_rows (
      model TEXT PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      tokens_daily INTEGER NOT NULL DEFAULT 0,
      tokens_total INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'local',
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_token_local_rows_updated ON token_local_rows(updated_at DESC)"
  ];

  try {
    for (const statement of schema) {
      await db.prepare(statement).run();
    }
    state.sqliteReady = true;
    return db;
  } catch {
    state.sqliteReady = false;
    return null;
  }
}

async function persistDiscordRows(db, channelId, rows) {
  if (!db || !channelId || !rows?.length) return;
  const fetchedAt = nowIso();
  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO discord_messages
        (id, channel_id, ts, author, content, attachments_json, fetched_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        String(row.id || crypto.randomUUID()),
        String(channelId),
        String(row.timestamp || nowIso()),
        String(row.author || "Unknown"),
        String(row.content || ""),
        JSON.stringify(Array.isArray(row.attachments) ? row.attachments : []),
        fetchedAt
      )
  );
  await db.batch(statements);
  await db
    .prepare(
      `DELETE FROM discord_messages
      WHERE channel_id = ?1
      AND id NOT IN (
        SELECT id FROM discord_messages
        WHERE channel_id = ?1
        ORDER BY ts DESC
        LIMIT 2000
      )`
    )
    .bind(String(channelId))
    .run();
}

async function readDiscordRowsFromDb(db, channelId, limit = 120) {
  if (!db) return [];
  const maxRows = Math.max(1, Math.min(500, Number(limit) || 120));
  const useChannel = String(channelId || "").trim();
  const statement = useChannel
    ? db
        .prepare(
          `SELECT id, ts, author, content, attachments_json
          FROM discord_messages
          WHERE channel_id = ?1
          ORDER BY ts DESC
          LIMIT ?2`
        )
        .bind(useChannel, maxRows)
    : db
        .prepare(
          `SELECT id, ts, author, content, attachments_json
          FROM discord_messages
          ORDER BY ts DESC
          LIMIT ?1`
        )
        .bind(maxRows);
  const { results } = await statement.all();
  return (Array.isArray(results) ? results : [])
    .map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      timestamp: String(row.ts || nowIso()),
      author: String(row.author || "Unknown"),
      content: String(row.content || ""),
      attachments: (() => {
        try {
          const parsed = JSON.parse(String(row.attachments_json || "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    }))
    .reverse();
}

async function persistSyncedTokenRows(db, rows) {
  if (!db) return;
  const normalized = Array.isArray(rows) ? rows : [];
  const updatedAt = nowIso();
  await db.prepare("DELETE FROM token_sync_rows").run();
  if (!normalized.length) return;
  const statements = normalized.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO token_sync_rows
        (model, requests, tokens_daily, tokens_total, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(
        String(row.model || "").trim(),
        Number(row.requests || 0) || 0,
        Number(row.tokensDaily || 0) || 0,
        Number(row.tokensTotal || 0) || 0,
        updatedAt
      )
  );
  await db.batch(statements);
}

async function readSyncedTokenRowsFromDb(db) {
  if (!db) return [];
  const { results } = await db
    .prepare(
      `SELECT model, requests, tokens_daily, tokens_total
      FROM token_sync_rows
      ORDER BY tokens_total DESC, requests DESC, model ASC`
    )
    .all();
  return (Array.isArray(results) ? results : []).map((row) => ({
    model: String(row.model || "").trim(),
    requests: Number(row.requests || 0) || 0,
    tokensDaily: Number(row.tokens_daily || 0) || 0,
    tokensTotal: Number(row.tokens_total || 0) || 0
  }));
}

async function persistLocalTokenRows(db, rows, source = "local") {
  if (!db) return;
  const normalized = Array.isArray(rows) ? rows : [];
  const updatedAt = nowIso();
  const normalizedSource = String(source || "local").trim() || "local";
  await db.prepare("DELETE FROM token_local_rows").run();
  if (!normalized.length) return;

  const statements = normalized.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO token_local_rows
        (model, requests, tokens_daily, tokens_total, source, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        String(row.model || "").trim(),
        Number(row.requests || 0) || 0,
        Number(row.tokensDaily || 0) || 0,
        Number(row.tokensTotal || 0) || 0,
        normalizedSource,
        updatedAt
      )
  );
  await db.batch(statements);
}

async function readLocalTokenRowsFromDb(db) {
  if (!db) return [];
  const { results } = await db
    .prepare(
      `SELECT model, requests, tokens_daily, tokens_total
      FROM token_local_rows
      ORDER BY tokens_total DESC, requests DESC, model ASC`
    )
    .all();
  return (Array.isArray(results) ? results : []).map((row) => ({
    model: String(row.model || "").trim(),
    requests: Number(row.requests || 0) || 0,
    tokensDaily: Number(row.tokens_daily || 0) || 0,
    tokensTotal: Number(row.tokens_total || 0) || 0
  }));
}

async function persistTokenChatEvent(db, eventRow) {
  if (!db || !eventRow) return;
  await db
    .prepare(
      `INSERT OR REPLACE INTO token_chat_events
      (id, ts, model_key, model_label, total_tokens)
      VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(
      String(eventRow.id || crypto.randomUUID()),
      String(eventRow.ts || nowIso()),
      String(eventRow.modelKey || eventRow.model || "unknown"),
      String(eventRow.modelLabel || eventRow.modelKey || eventRow.model || "unknown"),
      Number(eventRow.totalTokens || 0) || 0
    )
    .run();
  await db
    .prepare(
      `DELETE FROM token_chat_events
      WHERE id NOT IN (
        SELECT id FROM token_chat_events
        ORDER BY ts DESC
        LIMIT 20000
      )`
    )
    .run();
}

async function refreshTokenEventsFromDb(state, env, force = false) {
  const db = await ensureSqliteReady(state, env);
  if (!db) return;
  const now = Date.now();
  if (!force && now - Number(state.tokenEventsRefreshedAt || 0) < DISCORD_CACHE_TTL_MS) {
    return;
  }
  const { results } = await db
    .prepare(
      `SELECT ts, model_key, model_label, total_tokens
      FROM token_chat_events
      ORDER BY ts DESC
      LIMIT 5000`
    )
    .all();
  state.tokenEvents = (Array.isArray(results) ? results : [])
    .map((row) => ({
      ts: String(row.ts || nowIso()),
      modelKey: String(row.model_key || "unknown"),
      model: String(row.model_key || "unknown"),
      modelLabel: String(row.model_label || row.model_key || "unknown"),
      totalTokens: Number(row.total_tokens || 0) || 0
    }))
    .reverse();
  state.tokenEventsRefreshedAt = now;
}

function extractBearerToken(request) {
  const auth = String(request.headers.get("authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : "";
}

async function buildTokenSyncRows(state, env, modelCatalog = []) {
  const db = await ensureSqliteReady(state, env);
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map();

  const mergeRow = (rawModel, requests, tokensDaily, tokensTotal) => {
    const ref = normalizeTokenModelRef(rawModel, modelCatalog);
    if (!map.has(ref.key)) {
      map.set(ref.key, {
        model: ref.key,
        requests: 0,
        tokensDaily: 0,
        tokensTotal: 0
      });
    }
    const target = map.get(ref.key);
    target.requests += Number(requests || 0) || 0;
    target.tokensDaily += Number(tokensDaily || 0) || 0;
    target.tokensTotal += Number(tokensTotal || 0) || 0;
  };

  if (db) {
    const { results: chatRows } = await db
      .prepare(
        `SELECT
          model_key,
          MAX(model_label) AS model_label,
          COUNT(*) AS requests,
          SUM(CASE WHEN substr(ts, 1, 10) = ?1 THEN total_tokens ELSE 0 END) AS tokens_daily,
          SUM(total_tokens) AS tokens_total
        FROM token_chat_events
        GROUP BY model_key
        ORDER BY tokens_total DESC, requests DESC`
      )
      .bind(today)
      .all();
    for (const row of Array.isArray(chatRows) ? chatRows : []) {
      mergeRow(row.model_key || row.model_label || "unknown", row.requests, row.tokens_daily, row.tokens_total);
    }

    const localRows = await readLocalTokenRowsFromDb(db);
    for (const row of localRows) {
      mergeRow(row.model, row.requests, row.tokensDaily, row.tokensTotal);
    }

    return [...map.values()].sort((a, b) => {
      if (b.tokensTotal !== a.tokensTotal) return b.tokensTotal - a.tokensTotal;
      if (b.requests !== a.requests) return b.requests - a.requests;
      return String(a.model).localeCompare(String(b.model));
    });
  }

  for (const row of state.tokenEvents || []) {
    const daily = String(row.ts || "").slice(0, 10) === today ? Number(row.totalTokens || 0) : 0;
    mergeRow(row.modelKey || row.model || "unknown", 1, daily, row.totalTokens);
  }
  return [...map.values()];
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

function discordSyncConfig(env) {
  return {
    token: String(env.DISCORD_SYNC_BOT_TOKEN || "").trim(),
    channelId: String(env.DISCORD_SYNC_CHANNEL_ID || "").trim()
  };
}

async function discordRequest({ token, endpoint, method = "GET", jsonBody = null }) {
  const headers = { Authorization: `Bot ${token}` };
  if (jsonBody) headers["Content-Type"] = "application/json";
  const resp = await fetch(endpoint, {
    method,
    headers,
    body: jsonBody ? JSON.stringify(jsonBody) : undefined
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const message = payload?.message || `HTTP ${resp.status}`;
    throw new Error(`discord ${resp.status}: ${message}`);
  }
  return payload;
}

async function sendDiscordChannelMessage(env, content) {
  const cfg = discordSyncConfig(env);
  if (!cfg.token || !cfg.channelId) {
    throw new Error("discord sync token or channel missing");
  }
  const text = String(content || "").trim();
  if (!text) {
    throw new Error("message required");
  }
  if (text.length > 1900) {
    throw new Error("message too long");
  }
  return discordRequest({
    token: cfg.token,
    endpoint: `${DISCORD_API_BASE}/channels/${cfg.channelId}/messages`,
    method: "POST",
    jsonBody: { content: text }
  });
}

function mapDiscordMessagesToRows(messages = []) {
  const sorted = [...messages].sort(
    (a, b) => Date.parse(a?.timestamp || 0) - Date.parse(b?.timestamp || 0)
  );
  return sorted.map((message) => ({
    id: String(message?.id || crypto.randomUUID()),
    timestamp: message?.timestamp || nowIso(),
    author: message?.author?.global_name || message?.author?.username || "Unknown",
    content: String(message?.content || "").trim(),
    attachments: (message?.attachments || []).map((item) => ({
      filename: item?.filename || "attachment",
      url: item?.url || "#"
    }))
  }));
}

async function refreshDiscordFeed(state, env, force = false) {
  const cfg = discordSyncConfig(env);
  const db = await ensureSqliteReady(state, env);

  if (!cfg.token || !cfg.channelId) {
    const fallbackRows = db ? await readDiscordRowsFromDb(db, cfg.channelId, 120) : [];
    state.discordFeedRows = fallbackRows;
    state.discordFeedRefreshedAt = Date.now();
    state.discordFeedStatus = {
      ok: false,
      detail: fallbackRows.length
        ? `missing token or channel, loaded ${fallbackRows.length} rows from sqlite`
        : "missing token or channel"
    };
    return;
  }

  const now = Date.now();
  if (!force && now - Number(state.discordFeedRefreshedAt || 0) < DISCORD_CACHE_TTL_MS) {
    return;
  }

  try {
    const messages = await discordRequest({
      token: cfg.token,
      endpoint: `${DISCORD_API_BASE}/channels/${cfg.channelId}/messages?limit=100`,
      method: "GET"
    });
    const rows = mapDiscordMessagesToRows(Array.isArray(messages) ? messages : []);
    state.discordFeedRows = rows;
    if (db) {
      await persistDiscordRows(db, cfg.channelId, rows);
    }
    state.discordFeedRefreshedAt = now;
    state.discordFeedStatus = {
      ok: true,
      detail: db ? `${state.discordFeedRows.length} rows synced to sqlite` : `${state.discordFeedRows.length} rows`
    };
  } catch (error) {
    const fallbackRows = db ? await readDiscordRowsFromDb(db, cfg.channelId, 120) : [];
    state.discordFeedRows = fallbackRows;
    state.discordFeedRefreshedAt = now;
    state.discordFeedStatus = {
      ok: false,
      detail: fallbackRows.length
        ? `${String(error?.message || error)}, fallback sqlite ${fallbackRows.length} rows`
        : String(error?.message || error)
    };
  }
}

function normalizeTokenRows(payload) {
  const candidates = [payload, payload?.rows, payload?.tokens, payload?.data, payload?.data?.rows, payload?.data?.tokens];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const rows = candidate
      .map((row) => ({
        model: String(row?.model || row?.name || row?.id || "").trim(),
        requests: Number(row?.requests || row?.count || 0) || 0,
        tokensDaily: Number(row?.tokensDaily || row?.daily || row?.dailyTokens || 0) || 0,
        tokensTotal: Number(row?.tokensTotal || row?.total || row?.totalTokens || 0) || 0
      }))
      .filter((row) => row.model);
    if (rows.length) return rows;
  }
  return [];
}

async function refreshSyncedTokenRows(state, env) {
  const syncUrl = String(env.TOKEN_USAGE_SYNC_API_URL || "").trim();
  const syncKey = String(env.TOKEN_USAGE_SYNC_API_KEY || "").trim();
  const db = await ensureSqliteReady(state, env);
  const now = Date.now();
  if (
    now - Number(state.syncedTokenRowsRefreshedAt || 0) < TOKEN_SYNC_CACHE_TTL_MS &&
    Array.isArray(state.syncedTokenRows) &&
    state.syncedTokenRows.length
  ) {
    return;
  }

  if (!syncUrl) {
    const fallbackRows = db ? await readSyncedTokenRowsFromDb(db) : [];
    state.syncedTokenRows = fallbackRows;
    state.syncedTokenRowsRefreshedAt = now;
    state.syncedTokenStatus = {
      ok: false,
      detail: fallbackRows.length ? `sync url missing, loaded ${fallbackRows.length} rows from sqlite` : "sync url missing"
    };
    return;
  }
  try {
    const headers = {};
    if (syncKey) headers.Authorization = `Bearer ${syncKey}`;
    const resp = await fetch(syncUrl, { method: "GET", headers });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = payload?.error || payload?.message || `HTTP ${resp.status}`;
      const fallbackRows = db ? await readSyncedTokenRowsFromDb(db) : [];
      state.syncedTokenRows = fallbackRows;
      state.syncedTokenRowsRefreshedAt = now;
      state.syncedTokenStatus = {
        ok: false,
        detail: fallbackRows.length
          ? `${String(err)}, fallback sqlite ${fallbackRows.length} rows`
          : String(err)
      };
      return;
    }
    const rows = normalizeTokenRows(payload);
    state.syncedTokenRows = rows;
    if (db) {
      await persistSyncedTokenRows(db, rows);
    }
    state.syncedTokenRowsRefreshedAt = now;
    state.syncedTokenStatus = {
      ok: true,
      detail: db ? `${rows.length} rows synced to sqlite` : `${rows.length} rows`
    };
  } catch (error) {
    const fallbackRows = db ? await readSyncedTokenRowsFromDb(db) : [];
    state.syncedTokenRows = fallbackRows;
    state.syncedTokenRowsRefreshedAt = now;
    state.syncedTokenStatus = {
      ok: false,
      detail: fallbackRows.length
        ? `${String(error?.message || error)}, fallback sqlite ${fallbackRows.length} rows`
        : String(error?.message || error)
    };
  }
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
  if (/zjz\.world|intelligent\.zjz\.world/i.test(config.baseUrl)) {
    return {
      ok: false,
      detail: "gateway misconfigured (loop risk)",
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
  if (/zjz\.world|intelligent\.zjz\.world/i.test(config.baseUrl)) {
    throw new Error(`${config.label} gateway misconfigured (loop risk)`);
  }
  const endpoint = `${config.baseUrl}${config.chatPath}`;
  const useResponsesApi = /\/responses\b/i.test(config.chatPath);
  const requestBody = useResponsesApi
    ? {
        model: modelId,
        input: message,
        stream: false
      }
    : {
        model: modelId,
        messages: [{ role: "user", content: message }],
        stream: false
      };
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = payload?.error?.message || payload?.message || `HTTP ${resp.status}`;
    throw new Error(`${config.label} chat failed: ${err}`);
  }
  const responseOutputText =
    payload?.output_text ??
    payload?.output?.text ??
    (Array.isArray(payload?.output)
      ? payload.output
          .flatMap((item) => item?.content || [])
          .map((part) => part?.text || "")
          .filter(Boolean)
          .join("\n")
      : "");
  const content = payload?.choices?.[0]?.message?.content ?? responseOutputText ?? "";
  const reply = normalizeReplyContent(content) || "(empty reply)";
  const usage = normalizeUsage(payload, message, reply);
  return { reply, usage };
}

function buildTokenRows(state, modelCatalog = []) {
  const map = new Map();
  const order = [];
  const today = new Date().toISOString().slice(0, 10);
  const hasSyncedRows = Array.isArray(state.syncedTokenRows) && state.syncedTokenRows.length > 0;

  for (const row of modelCatalog) {
    if (!row?.key || map.has(row.key)) continue;
    map.set(row.key, { model: row.label || row.key, requests: 0, tokensDaily: 0, tokensTotal: 0 });
    order.push(row.key);
  }

  if (!hasSyncedRows) {
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
  }

  for (const row of state.syncedTokenRows || []) {
    const ref = normalizeTokenModelRef(row.model, modelCatalog || []);
    const key = ref.key;
    if (!map.has(key)) {
      map.set(key, { model: ref.label, requests: 0, tokensDaily: 0, tokensTotal: 0 });
      order.push(key);
    } else {
      const existed = map.get(key);
      if (existed && (!existed.model || existed.model === key || /^sync::/i.test(existed.model))) {
        existed.model = ref.label;
      }
    }
    const target = map.get(key);
    target.requests += Number(row.requests || 0);
    target.tokensDaily += Number(row.tokensDaily || 0);
    target.tokensTotal += Number(row.tokensTotal || 0);
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

function buildExternalStatus(state, env) {
  const checkedAt = nowIso();
  const source = state.modelSourceStatus || {};
  const discordStatus = state.discordFeedStatus || { ok: false, detail: "not checked" };
  const tokenSyncStatus = state.syncedTokenStatus || { ok: false, detail: "not checked" };
  const hasSqliteBinding = !!getSqliteDb(env);
  const sqliteReady = hasSqliteBinding && !!state.sqliteReady;
  const modelSources = [
    {
      app: "Discord API",
      agent: "Karina - Orchestrator",
      ok: !!discordStatus.ok,
      detail: discordStatus.detail || "not checked"
    },
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
    },
    {
      app: "Token Usage Sync API",
      agent: "Karina - Orchestrator",
      ok: !!tokenSyncStatus.ok,
      detail: tokenSyncStatus.detail || "not checked"
    },
    {
      app: "Cloud SQLite",
      agent: "Seunggi - DevOps",
      ok: sqliteReady,
      detail: sqliteReady ? "d1 bound and writable" : hasSqliteBinding ? "d1 bound but not ready" : "d1 binding missing"
    }
  ];
  return {
    updatedAt: checkedAt,
    rows: [...STATIC_EXTERNAL_APPS, ...modelSources].map((row) => ({ ...row, checkedAt }))
  };
}

function buildWorkplace(state, limit = 120) {
  const maxRows = Math.max(1, Math.min(200, Number(limit) || 120));
  const rows = (state.discordFeedRows && state.discordFeedRows.length
    ? state.discordFeedRows
    : state.workplace
  ).slice(-maxRows);
  return {
    ok: true,
    startedAt: state.startedAt,
    rows
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

  if (route === "/token/usage-sync" && method === "GET") {
    const expectedKey = String(env.TOKEN_USAGE_SYNC_API_KEY || "").trim();
    const inputKey = extractBearerToken(request);
    if (!expectedKey) {
      return json({ ok: false, error: "sync key not configured" }, 503);
    }
    if (!safeEqual(inputKey, expectedKey)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    await refreshTokenEventsFromDb(state, env, true);
    await refreshModelCatalog(state, env);
    const rows = await buildTokenSyncRows(state, env, state.modelCatalog || []);
    return json({
      ok: true,
      updatedAt: nowIso(),
      rows
    });
  }

  if (route === "/token/local-ingest" && method === "POST") {
    const expectedKey = String(env.TOKEN_USAGE_SYNC_API_KEY || "").trim();
    const inputKey = extractBearerToken(request);
    if (!expectedKey) {
      return json({ ok: false, error: "sync key not configured" }, 503);
    }
    if (!safeEqual(inputKey, expectedKey)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await readPayload(request);
    const rows = normalizeTokenRows(body?.rows ? { rows: body.rows } : body);
    const source = String(body?.source || "local-runtime").trim() || "local-runtime";
    const db = await ensureSqliteReady(state, env);
    if (!db) {
      return json({ ok: false, error: "sqlite binding missing" }, 503);
    }
    await persistLocalTokenRows(db, rows, source);
    state.syncedTokenRowsRefreshedAt = 0;
    return json({
      ok: true,
      accepted: rows.length,
      source,
      updatedAt: nowIso()
    });
  }

  const authToken = request.headers.get("x-dashboard-token") || "";
  const authed = await verifyAuthToken(authToken, authSecret);
  if (!authed) {
    return json({ ok: false, error: "dashboard locked" }, 401);
  }

  if (route === "/dashboard/summary" && method === "GET") {
    await refreshModelCatalog(state, env);
    await refreshTokenEventsFromDb(state, env);
    await refreshSyncedTokenRows(state, env);
    return json(buildSummary(state));
  }

  if (route === "/agents/status" && method === "GET") {
    return json(buildAgentsStatus());
  }

  if (route === "/external/status" && method === "GET") {
    await refreshModelCatalog(state, env);
    await refreshDiscordFeed(state, env);
    await refreshSyncedTokenRows(state, env);
    return json(buildExternalStatus(state, env));
  }

  if (route === "/chat/models" && method === "GET") {
    await refreshModelCatalog(state, env, true);
    return json({ models: state.modelCatalog || [] });
  }

  if (route === "/workplace/messages" && method === "GET") {
    await refreshDiscordFeed(state, env);
    return json(buildWorkplace(state, url.searchParams.get("limit")));
  }

  if (route === "/chat/karina" && method === "POST") {
    try {
      const body = await readPayload(request);
      const message = String(body?.message || "").trim();
      if (!message) {
        return json({ ok: false, error: "message required" }, 400);
      }
      const sent = await sendDiscordChannelMessage(env, message);
      addWorkplaceRow(state, "Owner", message);
      return json({
        ok: true,
        reply: "已发送给 Karina，等待协作输出。",
        messageId: String(sent?.id || ""),
        sentAt: nowIso()
      });
    } catch (error) {
      const detail = String(error?.message || error);
      recordAlert(state, "KARINA_CHAT_ERROR", detail, "medium");
      return json({ ok: false, error: detail }, 400);
    }
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
      const tokenEventRow = {
        id: crypto.randomUUID(),
        ts: nowIso(),
        model: selected.key,
        modelKey: selected.key,
        modelLabel: selected.label,
        totalTokens: usage.total
      };
      state.tokenEvents.push(tokenEventRow);
      const db = await ensureSqliteReady(state, env);
      if (db) {
        await persistTokenChatEvent(db, tokenEventRow);
      }
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
        return json({ ok: false, error: errText }, 400);
      }
      return json({ ok: false, error: `chat fatal: ${errText}` }, 400);
    }
  }

  recordAlert(state, "EDGE_ROUTE_MISS", `${method} ${route}`, "low");
  return json({ ok: false, error: "Not found" }, 404);
};
