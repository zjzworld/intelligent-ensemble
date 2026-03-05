const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = Number(process.env.PORT || 3900);

const BASE_DESKTOP = "/Users/mac_mini_de_zjz/Desktop";
const BODY_ROOT = path.join(BASE_DESKTOP, "Intelligent Body");
const MEMORY_ROOT = fs.existsSync(path.join(BASE_DESKTOP, "intelligent memory"))
  ? path.join(BASE_DESKTOP, "intelligent memory")
  : path.join(BASE_DESKTOP, "Intelligent Memory");

const WANWAN_CONFIG = path.join(BODY_ROOT, "config", "wan-wan.json");
const PIPELINE_DIR = path.join(MEMORY_ROOT, "pipeline");
const MEMORY_LOG_DIR = path.join(MEMORY_ROOT, "logs");
const BODY_LOG_DIR = path.join(BODY_ROOT, "runtime", "logs");
const CRON_JOBS_FILE = path.join(BODY_ROOT, "function", "jobs", "cron", "jobs.json");
const AGENTS_RUNTIME_DIR = path.join(BODY_ROOT, "runtime", "agents");
const TASK_CARD_FILE = path.join(__dirname, "task_card.yaml");

const DASH_RUNTIME_DIR = path.join(__dirname, "runtime");
const ALERT_STORE_FILE = path.join(DASH_RUNTIME_DIR, "alerts.jsonl");
const CHAT_METRICS_FILE = path.join(DASH_RUNTIME_DIR, "chat-metrics.jsonl");
const DASHBOARD_DB_FILE = path.join(DASH_RUNTIME_DIR, "dashboard.sqlite");
const WORKPLACE_STATE_FILE = path.join(DASH_RUNTIME_DIR, "workplace-state.json");
const PROJECT_DOC_FILE = path.join(DASH_RUNTIME_DIR, "wanwan_dashboard_project_doc.md");
const ROUTER_STATE_FILE = path.join(MEMORY_ROOT, "logs", "session-router-state.json");
const ROUTER_GUARD_LOG_FILE = path.join(MEMORY_ROOT, "logs", "session-router-guard.jsonl");
const ROUTER_SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const DASHBOARD_PASSWORD = String(process.env.DASHBOARD_PASSWORD || "592509");
const DASHBOARD_AUTH_TTL_MS = 12 * 60 * 60 * 1000;
const DISABLE_KICKOFF_ENDPOINT = true;
const ROUTER_CHAIN = [
  "karina",
  "goeun",
  "jiwon",
  "suzy",
  "jisoo",
  "yoona",
  "boyoung",
  "seunggi",
  "danielle",
  "haerin",
  "minji",
  "karina"
];

const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DASH_RUNTIME_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

const caches = {
  memory: { ttlMs: 60_000, ts: 0, data: null },
  tokens: { ttlMs: 1_000, ts: 0, data: null },
  tasks: { ttlMs: 10_000, ts: 0, data: null },
  projects: { ttlMs: 20_000, ts: 0, data: null },
  alerts: { ttlMs: 5_000, ts: 0, data: null },
  agents: { ttlMs: 60_000, ts: 0, data: null },
  external: { ttlMs: 60_000, ts: 0, data: null },
  summary: { ttlMs: 1_000, ts: 0, data: null }
};

const dashboardDb = new DatabaseSync(DASHBOARD_DB_FILE);
const dashboardAuthTokens = new Map();

const vectorProbeState = {
  ts: 0,
  data: {
    qualityRate: 0,
    sampleSize: 0,
    poolSize: 0,
    lastRunAt: null,
    nextRunAt: null
  }
};

initDashboardDb();
migrateJsonlToDb();
app.use(requireDashboardAuth);

function safeReadText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeReadJsonl(filePath, maxLines = 2000) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    const sliced = maxLines > 0 ? lines.slice(-maxLines) : lines;
    const entries = [];
    for (const line of sliced) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function appendJsonl(filePath, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  fs.appendFileSync(filePath, line, "utf8");
}

function initDashboardDb() {
  dashboardDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      provider TEXT,
      model_id TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'dashboard'
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(ts);
    CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);

    CREATE TABLE IF NOT EXISTS dashboard_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getDbKv(key, fallback = "") {
  const row = dashboardDb
    .prepare("SELECT value FROM dashboard_kv WHERE key = ?")
    .get(String(key));
  return row?.value ?? fallback;
}

function setDbKv(key, value) {
  dashboardDb
    .prepare(`
      INSERT INTO dashboard_kv(key, value)
      VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(String(key), String(value));
}

function dbInsertTokenUsage({
  ts,
  provider = "",
  modelId = "",
  model,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  source = "dashboard"
}) {
  if (!model) return;
  dashboardDb
    .prepare(`
      INSERT INTO token_usage(
        ts, provider, model_id, model, input_tokens, output_tokens, total_tokens, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      String(ts || new Date().toISOString()),
      String(provider || ""),
      String(modelId || ""),
      String(model),
      Number(inputTokens || 0),
      Number(outputTokens || 0),
      Number(totalTokens || 0),
      String(source || "dashboard")
    );
}

function dbInsertAlert({
  ts,
  type,
  detail,
  severity = "medium",
  meta = {}
}) {
  dashboardDb
    .prepare(`
      INSERT INTO alerts(ts, type, detail, severity, meta_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      String(ts || new Date().toISOString()),
      String(type || "UNKNOWN"),
      String(detail || ""),
      String(severity || "medium"),
      JSON.stringify(meta || {})
    );
}

function migrateJsonlToDb() {
  if (getDbKv("migration_v1_jsonl_to_db_done", "") === "1") return;

  const tokenRows = safeReadJsonl(CHAT_METRICS_FILE, 0);
  for (const row of tokenRows) {
    const model = row.model || `${row.provider || "unknown"}/${row.modelId || "unknown"}`;
    dbInsertTokenUsage({
      ts: row.ts,
      provider: row.provider || "",
      modelId: row.modelId || "",
      model,
      inputTokens: Number(row.inputTokens || 0),
      outputTokens: Number(row.outputTokens || 0),
      totalTokens: Number(row.totalTokens || 0),
      source: "migrated_jsonl"
    });
  }

  const alertRows = safeReadJsonl(ALERT_STORE_FILE, 0);
  for (const row of alertRows) {
    dbInsertAlert({
      ts: row.ts,
      type: row.type,
      detail: row.detail,
      severity: row.severity || "medium",
      meta: row
    });
  }

  setDbKv("migration_v1_jsonl_to_db_done", "1");
}

function purgeExpiredDashboardAuthTokens() {
  const now = Date.now();
  for (const [token, value] of dashboardAuthTokens.entries()) {
    if (!value || value.expiresAt <= now) {
      dashboardAuthTokens.delete(token);
    }
  }
}

function issueDashboardAuthToken() {
  purgeExpiredDashboardAuthTokens();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + DASHBOARD_AUTH_TTL_MS;
  dashboardAuthTokens.set(token, { expiresAt });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

function verifyDashboardAuthToken(token) {
  purgeExpiredDashboardAuthTokens();
  const normalized = String(token || "").trim();
  if (!normalized) return false;
  const hit = dashboardAuthTokens.get(normalized);
  if (!hit) return false;
  if (hit.expiresAt <= Date.now()) {
    dashboardAuthTokens.delete(normalized);
    return false;
  }
  return true;
}

function requireDashboardAuth(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path === "/api/auth/unlock" || req.path === "/api/auth/check") return next();
  const token = req.get("x-dashboard-token") || "";
  if (!verifyDashboardAuthToken(token)) {
    return res.status(401).json({ ok: false, error: "dashboard locked" });
  }
  return next();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
}

function decodeDiscordBotIdFromToken(token) {
  try {
    const first = String(token || "").split(".")[0];
    if (!first) return null;
    const normalized = first.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const text = Buffer.from(padded, "base64").toString("utf8").trim();
    return /^\d+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

function getWanwanConfig() {
  return safeReadJson(WANWAN_CONFIG, {});
}

function getDiscordConfig() {
  return getWanwanConfig()?.channels?.discord || {};
}

function getProvidersFromConfig(cfg) {
  return cfg?.models?.providers || cfg?.providers || {};
}

function getRoleLabel(accountId) {
  const map = {
    karina_de_zjz_bot: "Karina - Orchestrator",
    geoun_de_zjz_bot: "Goeun - Architect",
    jiwon_de_zjz_bot: "Jiwon - Designer",
    suzy_de_zjz_bot: "Suzy - Frontend",
    jisoo_de_zjz_bot: "Jisoo - Backend",
    yoona_de_zjz_bot: "YoonA - Reviewer",
    boyoung_de_zjz_bot: "Boyoung - QA",
    seunggi_de_zjz_bot: "Seunggi - DevOps",
    danielle_de_zjz_bot: "Danielle - Data/Security",
    haerin_de_zjz_bot: "Haerin - DocOps",
    minji_de_zjz_bot: "Minji - Memory Curator"
  };
  return map[accountId] || accountId;
}

function getRoleOrderIndex(accountId) {
  const order = [
    "karina_de_zjz_bot",
    "geoun_de_zjz_bot",
    "suzy_de_zjz_bot",
    "jisoo_de_zjz_bot",
    "jiwon_de_zjz_bot",
    "seunggi_de_zjz_bot",
    "boyoung_de_zjz_bot",
    "yoona_de_zjz_bot",
    "minji_de_zjz_bot",
    "danielle_de_zjz_bot",
    "haerin_de_zjz_bot"
  ];
  const idx = order.indexOf(accountId);
  return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
}

function summarizeDiscordError(error) {
  const text = String(error?.message || error || "").trim();
  if (!text) return "unknown error";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function getDiscordBotIdByAccount(discordCfg, accountId) {
  const token = String(discordCfg?.accounts?.[accountId]?.token || "").trim();
  if (!token) return null;
  return decodeDiscordBotIdFromToken(token);
}

function getDefaultDiscordChannelId(discordCfg, accountId) {
  const account = discordCfg.accounts?.[accountId];
  const accountGuilds = account?.guilds || {};
  for (const guild of Object.values(accountGuilds)) {
    if (!guild?.channels) continue;
    for (const [channelId, channelCfg] of Object.entries(guild.channels)) {
      if (channelCfg?.allow === false) continue;
      return channelId;
    }
  }

  const globalGuilds = discordCfg.guilds || {};
  for (const guild of Object.values(globalGuilds)) {
    if (!guild?.channels) continue;
    for (const [channelId, channelCfg] of Object.entries(guild.channels)) {
      if (channelCfg?.allow === false) continue;
      return channelId;
    }
  }
  return "";
}

async function collectAgentsStatus() {
  const discordCfg = getDiscordConfig();
  const accounts = Object.entries(discordCfg.accounts || {})
    .filter(([accountId]) => accountId !== "default")
    .sort((a, b) => getRoleOrderIndex(a[0]) - getRoleOrderIndex(b[0]));

  const rows = await Promise.all(
    accounts.map(async ([accountId, account]) => {
      const token = String(account?.token || "").trim();
      const enabled = account?.enabled !== false;
      const base = {
        id: accountId,
        label: getRoleLabel(accountId),
        enabled,
        checkedAt: new Date().toISOString(),
        ok: false,
        username: "",
        detail: ""
      };
      if (!token) {
        return {
          ...base,
          detail: "missing token"
        };
      }
      try {
        const profile = await discordRequest({
          token,
          endpoint: "https://discord.com/api/v10/users/@me",
          method: "GET"
        });
        const username = profile?.username ? `@${profile.username}` : "";
        return {
          ...base,
          ok: enabled,
          username,
          detail: enabled ? "api ok" : "disabled by config"
        };
      } catch (error) {
        return {
          ...base,
          detail: summarizeDiscordError(error)
        };
      }
    })
  );

  return {
    updatedAt: new Date().toISOString(),
    rows
  };
}

function commandPath(command) {
  try {
    const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
      encoding: "utf8",
      timeout: 1500
    });
    if (result.status !== 0) return "";
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

async function probeNotionConnection() {
  const token = String(process.env.NOTION_TOKEN || "").trim();
  if (!token) {
    return { ok: false, detail: "token missing" };
  }
  try {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28"
      }
    });
    if (!response.ok) {
      return { ok: false, detail: `api ${response.status}` };
    }
    return { ok: true, detail: "api ok" };
  } catch (error) {
    return { ok: false, detail: summarizeDiscordError(error) };
  }
}

async function collectExternalConnections() {
  const discordCfg = getDiscordConfig();
  const checkedAt = new Date().toISOString();
  const rows = [];

  const karinaToken = String(discordCfg.accounts?.karina_de_zjz_bot?.token || "").trim();
  if (!karinaToken) {
    rows.push({
      app: "Discord API",
      agent: "Karina - Orchestrator",
      ok: false,
      detail: "token missing",
      checkedAt
    });
  } else {
    try {
      const me = await discordRequest({
        token: karinaToken,
        endpoint: "https://discord.com/api/v10/users/@me",
        method: "GET"
      });
      rows.push({
        app: "Discord API",
        agent: "Karina - Orchestrator",
        ok: true,
        detail: me?.username ? `@${me.username}` : "api ok",
        checkedAt
      });
    } catch (error) {
      rows.push({
        app: "Discord API",
        agent: "Karina - Orchestrator",
        ok: false,
        detail: summarizeDiscordError(error),
        checkedAt
      });
    }
  }

  const notion = await probeNotionConnection();
  rows.push({
    app: "Notion API",
    agent: "Haerin - DocOps",
    ok: notion.ok,
    detail: notion.detail,
    checkedAt
  });

  const ghPath = commandPath("gh");
  rows.push({
    app: "GitHub CLI",
    agent: "Seunggi - DevOps",
    ok: !!ghPath,
    detail: ghPath || "cli missing",
    checkedAt
  });

  const zjzPath = commandPath("zjz");
  rows.push({
    app: "ZJZ CLI",
    agent: "Karina - Orchestrator",
    ok: !!zjzPath,
    detail: zjzPath || "cli missing",
    checkedAt
  });

  return {
    updatedAt: checkedAt,
    rows
  };
}

function getCached(cacheKey, builder) {
  const bucket = caches[cacheKey];
  const now = Date.now();
  if (!bucket.data || now - bucket.ts > bucket.ttlMs) {
    bucket.data = builder();
    bucket.ts = now;
  }
  return bucket.data;
}

function detectTier(fileName, text) {
  const tierMatch = text.match(/^\s*-\s*tier:\s*tier_([0-3])\b/im);
  if (tierMatch) return `T${tierMatch[1]}`;
  if (/^t0_/i.test(fileName)) return "T0";
  if (/^t1_/i.test(fileName)) return "T1";
  if (/^t2_/i.test(fileName)) return "T2";
  if (/policy|tier_3|^t3_/i.test(fileName)) return "T3";
  return null;
}

function runVectorQualityProbe() {
  const now = Date.now();
  const intervalMs = 30 * 60 * 1000;
  if (vectorProbeState.data.lastRunAt && now - vectorProbeState.ts < intervalMs) {
    return vectorProbeState.data;
  }

  const contextLogs = safeReadJsonl(path.join(MEMORY_LOG_DIR, "memory-context.jsonl"), 6000);
  const vectorPool = contextLogs.filter((entry) => {
    const mode = String(entry.retrieval_mode || entry.mode || "").toLowerCase();
    return mode.includes("vector");
  });

  const shuffled = [...vectorPool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sample = shuffled.slice(0, Math.min(30, shuffled.length));
  const good = sample.filter((entry) => String(entry.status || "").toLowerCase() === "ok" && Number(entry.rows || 0) > 0).length;
  const qualityRate = sample.length > 0 ? (good / sample.length) * 100 : 0;

  vectorProbeState.ts = now;
  vectorProbeState.data = {
    qualityRate: Number(qualityRate.toFixed(2)),
    sampleSize: sample.length,
    poolSize: vectorPool.length,
    lastRunAt: new Date(now).toISOString(),
    nextRunAt: new Date(now + intervalMs).toISOString()
  };
  return vectorProbeState.data;
}

function collectMemoryStats() {
  const files = fs.existsSync(PIPELINE_DIR) ? fs.readdirSync(PIPELINE_DIR).filter((name) => name.endsWith(".md")) : [];
  const tierCounts = { T0: 0, T1: 0, T2: 0, T3: 0 };

  for (const fileName of files) {
    const fullPath = path.join(PIPELINE_DIR, fileName);
    const text = safeReadText(fullPath, "");
    const tier = detectTier(fileName, text);
    if (tier && tierCounts[tier] !== undefined) {
      tierCounts[tier] += 1;
    }
  }

  return {
    tierCounts,
    vector: runVectorQualityProbe(),
    totalFiles: files.length
  };
}

function collectTokenStats() {
  const rows = dashboardDb
    .prepare(`
      SELECT
        model AS model,
        COUNT(*) AS requests,
        SUM(CASE WHEN date(ts, 'localtime') = date('now', 'localtime') THEN total_tokens ELSE 0 END) AS tokensDaily,
        SUM(total_tokens) AS tokensTotal
      FROM token_usage
      GROUP BY model
      ORDER BY tokensTotal DESC
      LIMIT 20
    `)
    .all();

  return rows.map((row) => ({
    model: row.model,
    requests: Number(row.requests || 0),
    tokensDaily: Number(row.tokensDaily || 0),
    tokensTotal: Number(row.tokensTotal || 0)
  }));
}

function collectTaskStats() {
  const tasks = [];
  const cronJobs = safeReadJson(CRON_JOBS_FILE, { jobs: [] })?.jobs || [];

  for (const job of cronJobs) {
    const everyMs = Number(job?.schedule?.everyMs || 0);
    const cadence = job?.schedule?.kind === "every" && everyMs > 0 ? `Every ${formatDuration(everyMs)}` : "Custom trigger";
    const content = String(job?.payload?.message || job?.id || job?.name || "unnamed").slice(0, 120);
    tasks.push({
      content,
      cadence
    });
  }

  if (tasks.length === 0) {
    tasks.push({ content: "Memory quality probe", cadence: "Every 30m" });
    tasks.push({ content: "Pipeline stale check", cadence: "Every 24h" });
    tasks.push({ content: "Dashboard heartbeat", cadence: "Every 1m" });
  }

  return tasks.slice(0, 12);
}

function readTaskCardObjective() {
  const text = safeReadText(TASK_CARD_FILE, "");
  const match = text.match(/^objective:\s*(.+)$/m);
  if (match) return match[1].trim();
  return "wan-wan Dashboard";
}

function collectProjectStats() {
  const rows = [];
  const reportFiles = fs.existsSync(BODY_LOG_DIR)
    ? fs.readdirSync(BODY_LOG_DIR).filter((name) => name.endsWith("_report.json") || name.endsWith("_result.json"))
    : [];

  for (const fileName of reportFiles) {
    const payload = safeReadJson(path.join(BODY_LOG_DIR, fileName), null);
    if (!payload) continue;
    const stages = Array.isArray(payload.stages) ? payload.stages : [];
    const done = stages.filter((item) => ["ok", "passed", "completed", "replied"].includes(String(item.status || "").toLowerCase())).length;
    const total = stages.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : payload.end_ts ? 100 : 0;
    rows.push({
      name: payload.task_label || payload.run_id || fileName.replace(/\.(json)$/i, ""),
      progress,
      status: progress >= 100 ? "completed" : "in_progress",
      updatedAt: payload.end_ts || payload.start_ts || new Date(fs.statSync(path.join(BODY_LOG_DIR, fileName)).mtimeMs).toISOString()
    });
  }

  if (rows.length === 0) {
    const checkpoints = [
      path.join(__dirname, "server.js"),
      path.join(__dirname, "public", "index.html"),
      path.join(__dirname, "public", "styles.css"),
      path.join(__dirname, "public", "app.js")
    ];
    const done = checkpoints.filter((filePath) => fs.existsSync(filePath)).length;
    const progress = Math.round((done / checkpoints.length) * 100);
    rows.push({
      name: readTaskCardObjective(),
      progress,
      status: progress >= 100 ? "completed" : "in_progress",
      updatedAt: new Date().toISOString()
    });
  }

  rows.sort((a, b) => b.progress - a.progress);
  const completed = rows.filter((item) => item.status === "completed").length;
  return {
    completed,
    total: rows.length,
    rows: rows.slice(0, 12)
  };
}

function recordAlert(type, detail, severity = "medium", meta = {}) {
  const ts = new Date().toISOString();
  appendJsonl(ALERT_STORE_FILE, {
    ts,
    type,
    detail,
    severity,
    ...meta
  });
  dbInsertAlert({ ts, type, detail, severity, meta });
  caches.alerts.ts = 0;
}

function collectAlerts() {
  const rows = dashboardDb
    .prepare(`
      SELECT ts AS time, type, severity, detail
      FROM alerts
      ORDER BY ts DESC
      LIMIT 20
    `)
    .all()
    .map((item) => ({
      time: item.time,
      type: item.type,
      severity: item.severity || "medium",
      detail: item.detail
    }));

  if (rows.length === 0) {
    return [
      {
        time: new Date().toISOString(),
        type: "OK",
        severity: "low",
        detail: "No active alert"
      }
    ];
  }
  return rows;
}

function loadWorkplaceState() {
  const fallbackStart = fs.existsSync(TASK_CARD_FILE) ? new Date(fs.statSync(TASK_CARD_FILE).mtimeMs).toISOString() : new Date().toISOString();
  const state = safeReadJson(WORKPLACE_STATE_FILE, null);
  if (state?.projectStartedAt) return state;
  const fresh = { projectStartedAt: fallbackStart, updatedAt: new Date().toISOString() };
  fs.writeFileSync(WORKPLACE_STATE_FILE, JSON.stringify(fresh, null, 2), "utf8");
  return fresh;
}

function saveWorkplaceState(nextState) {
  fs.writeFileSync(WORKPLACE_STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
}

function loadRouterState() {
  const state = safeReadJson(ROUTER_STATE_FILE, null);
  if (state && typeof state === "object" && state.sessions && typeof state.sessions === "object") return state;
  return { sessions: {} };
}

function saveRouterState(nextState) {
  fs.mkdirSync(path.dirname(ROUTER_STATE_FILE), { recursive: true });
  fs.writeFileSync(ROUTER_STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
}

function detectRunLabel(content) {
  const m = String(content || "").match(/\[([^\]]{2,120})\]/);
  return m?.[1]?.trim() || "";
}

function upsertRouterSessionFromKickoff(channelId, kickoffText) {
  if (!channelId) return;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const key = `discord:channel:${channelId}`;
  const runLabel = detectRunLabel(kickoffText) || `RUN-${now}`;
  const state = loadRouterState();
  state.sessions[key] = {
    key,
    active: true,
    status: "active",
    runLabel,
    chain: [...ROUTER_CHAIN],
    pointer: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(now + ROUTER_SESSION_TIMEOUT_MS).toISOString(),
    drifts: 0,
    autoRelays: 0,
    lastSender: "",
    lastTarget: ""
  };
  saveRouterState(state);
  appendJsonl(ROUTER_GUARD_LOG_FILE, {
    ts: nowIso,
    action: "session_start",
    conversation_key: key,
    run_label: runLabel,
    receiver_agent: "karina",
    chain: ROUTER_CHAIN.join("->"),
    source: "dashboard_kickoff"
  });
}

function toBooleanLike(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

async function discordRequest({ token, endpoint, method = "GET", jsonBody = null, formData = null }) {
  const headers = { Authorization: `Bot ${token}` };
  if (jsonBody) headers["Content-Type"] = "application/json";

  const response = await fetch(endpoint, {
    method,
    headers,
    body: formData || (jsonBody ? JSON.stringify(jsonBody) : undefined)
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

async function sendDiscordMessage({ token, channelId, content, file }) {
  const endpoint = `https://discord.com/api/v10/channels/${channelId}/messages`;
  if (!file) {
    return discordRequest({
      token,
      endpoint,
      method: "POST",
      jsonBody: {
        content,
        allowed_mentions: { parse: ["users"] }
      }
    });
  }

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content,
      allowed_mentions: { parse: ["users"] }
    })
  );
  const blob = new Blob([fs.readFileSync(file.path)], { type: file.mimetype || "application/octet-stream" });
  form.append("files[0]", blob, file.originalname || "upload.bin");
  return discordRequest({ token, endpoint, method: "POST", formData: form });
}

function getDiscordBotIdentityMap(discordCfg) {
  const identityMap = new Map();
  for (const [accountId, account] of Object.entries(discordCfg.accounts || {})) {
    if (accountId === "default") continue;
    const token = account?.token;
    const botId = decodeDiscordBotIdFromToken(token);
    if (!botId) continue;
    identityMap.set(botId, {
      accountId,
      label: getRoleLabel(accountId)
    });
  }
  return identityMap;
}

async function fetchWorkplaceMessages({ channelId, limit = 80 }) {
  const discordCfg = getDiscordConfig();
  const accountId = "karina_de_zjz_bot";
  const token = discordCfg.accounts?.[accountId]?.token;
  if (!token) {
    throw new Error("Karina token not configured");
  }
  const endpoint = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${Math.max(10, Math.min(100, Number(limit) || 80))}`;
  const messages = await discordRequest({ token, endpoint, method: "GET" });
  const state = loadWorkplaceState();
  const startedAt = Date.parse(state.projectStartedAt || "");
  const botMap = getDiscordBotIdentityMap(discordCfg);

  const rows = [];
  for (const message of (messages || []).reverse()) {
    const messageTs = Date.parse(message.timestamp || "");
    if (Number.isFinite(startedAt) && Number.isFinite(messageTs) && messageTs < startedAt) continue;
    const authorId = message?.author?.id;
    if (!botMap.has(authorId)) continue;
    const who = botMap.get(authorId);
    rows.push({
      id: message.id,
      timestamp: message.timestamp,
      author: who.label,
      accountId: who.accountId,
      content: message.content || "",
      attachments: (message.attachments || []).map((item) => ({
        url: item.url,
        filename: item.filename
      }))
    });
  }

  return {
    channelId,
    startedAt: state.projectStartedAt,
    rows
  };
}

function buildModelCatalog() {
  const cfg = getWanwanConfig();
  const providers = getProvidersFromConfig(cfg);
  const enabled = Object.keys(cfg?.agents?.defaults?.models || {});
  const rows = [];

  for (const modelKey of enabled) {
    const splitIdx = modelKey.indexOf("/");
    if (splitIdx <= 0) continue;
    const providerId = modelKey.slice(0, splitIdx);
    const modelId = modelKey.slice(splitIdx + 1);
    const provider = providers?.[providerId];
    if (!provider) continue;
    const modelMeta = (provider.models || []).find((item) => item.id === modelId) || {};
    rows.push({
      key: modelKey,
      provider: providerId,
      modelId,
      label: `${modelId} (${providerId})`,
      supportsImage: Array.isArray(modelMeta.input) ? modelMeta.input.includes("image") : false
    });
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function buildPromptContent(message, file) {
  const text = String(message || "").trim();
  const contentParts = [];
  if (text) {
    contentParts.push({ type: "text", text });
  }

  if (file) {
    if ((file.mimetype || "").startsWith("image/")) {
      const base64 = fs.readFileSync(file.path).toString("base64");
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${file.mimetype};base64,${base64}` }
      });
    } else if ((file.mimetype || "").startsWith("text/")) {
      const fileText = safeReadText(file.path, "").slice(0, 12_000);
      contentParts.push({
        type: "text",
        text: `[Uploaded file: ${file.originalname}]\n${fileText}`
      });
    } else {
      contentParts.push({
        type: "text",
        text: `[Uploaded file: ${file.originalname}, size=${file.size} bytes]`
      });
    }
  }

  if (contentParts.length === 0) {
    contentParts.push({ type: "text", text: "Hello" });
  }
  return contentParts;
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const fallback = payload?.choices?.[0]?.text;
  if (typeof fallback === "string") return fallback;
  return "";
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const output of outputs) {
    const content = Array.isArray(output?.content) ? output.content : [];
    for (const item of content) {
      if (typeof item?.text === "string" && item.text.trim()) {
        chunks.push(item.text.trim());
      } else if (typeof item?.output_text === "string" && item.output_text.trim()) {
        chunks.push(item.output_text.trim());
      }
    }
  }
  return chunks.join("\n").trim();
}

function buildResponsesInput(promptContent) {
  const content = [];
  for (const part of promptContent) {
    if (part?.type === "text" && typeof part?.text === "string") {
      content.push({
        type: "input_text",
        text: part.text
      });
      continue;
    }
    if (part?.type === "image_url" && typeof part?.image_url?.url === "string") {
      content.push({
        type: "input_image",
        image_url: part.image_url.url
      });
    }
  }
  if (content.length === 0) {
    content.push({
      type: "input_text",
      text: "Hello"
    });
  }
  return [
    {
      role: "user",
      content
    }
  ];
}

function normalizeUsage(payload) {
  const usage = payload?.usage || {};
  const input = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.input ?? usage.inputTokens ?? 0
  );
  const output = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.output ?? usage.outputTokens ?? 0
  );
  const total = Number(
    usage.total_tokens ?? usage.totalTokens ?? usage.total ?? input + output
  );
  return { input, output, total };
}

async function callModelChat({ modelKey, message, file }) {
  const cfg = getWanwanConfig();
  const providers = getProvidersFromConfig(cfg);
  const [providerId, ...rest] = String(modelKey || "").split("/");
  const modelId = rest.join("/");
  const provider = providers?.[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl || provider.baseURL;
  if (!apiKey || !baseUrl) {
    throw new Error(`Provider not ready: ${providerId}`);
  }

  const providerApi = String(provider.api || "openai-completions").toLowerCase();
  const isResponsesApi = providerApi === "openai-responses" || providerApi === "openai-codex-responses";
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/${isResponsesApi ? "responses" : "chat/completions"}`;
  const promptContent = buildPromptContent(message, file);
  const body = isResponsesApi
    ? {
      model: modelId,
      input: buildResponsesInput(promptContent),
      stream: false
    }
    : {
      model: modelId,
      messages: [
        {
          role: "user",
          content: promptContent.length === 1 && promptContent[0].type === "text" ? promptContent[0].text : promptContent
        }
      ],
      stream: false
    };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Model API ${response.status}: ${String(text).slice(0, 240)}`);
  }

  const reply = (isResponsesApi ? extractResponsesText(payload) : extractAssistantText(payload)) || "(empty response)";
  const usage = normalizeUsage(payload);

  appendJsonl(CHAT_METRICS_FILE, {
    ts: new Date().toISOString(),
    provider: providerId,
    modelId,
    model: modelKey,
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.total
  });
  dbInsertTokenUsage({
    ts: new Date().toISOString(),
    provider: providerId,
    modelId,
    model: modelKey,
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.total,
    source: "dashboard_chat"
  });
  caches.tokens.ts = 0;

  return {
    reply,
    usage: {
      input: usage.input,
      output: usage.output,
      total: usage.total
    }
  };
}

function buildDashboardSummary() {
  return {
    updatedAt: new Date().toISOString(),
    memory: getCached("memory", collectMemoryStats),
    tokens: getCached("tokens", collectTokenStats),
    tasks: getCached("tasks", collectTaskStats),
    projects: getCached("projects", collectProjectStats),
    alerts: getCached("alerts", collectAlerts),
    workplace: {
      projectStartedAt: loadWorkplaceState().projectStartedAt
    }
  };
}

function buildProjectDocMarkdown() {
  const now = new Date().toISOString();
  return `# wan-wan Dashboard Project Doc

Updated at: ${now}

## Scope
- 9 panels: Memory / Token / Agent / MCP(External) / Task / Project / Alert / Workplace / Intelligent Chatbox
- Layout uses golden-ratio style split with Workplace on right strip.
- Chatbox supports model switch + text chat.
- Workplace syncs Discord agent conversation from project start timestamp.

## Data Rules
- Memory: T0/T1/T2/T3 counts; Policy counted as T3; vector quality random probe every 30 minutes.
- Token: model, requests, daily tokens, total tokens; UI refresh every 1 second.
- Task: content + cadence from cron jobs.
- Project: project name, progress, completed count.
- Alert: collect model disconnect, token issues, task stalls, runtime errors.

## Runtime Interfaces
- GET /api/dashboard/summary
- GET /api/external/status
- GET /api/chat/models
- POST /api/chat/intelligent
- GET /api/workplace/messages
- POST /api/workflow/kickoff
- POST /api/project/doc/sync
`;
}

async function syncDocToNotion(markdown) {
  const notionToken = process.env.NOTION_TOKEN;
  const notionParentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!notionToken || !notionParentPageId) {
    return { ok: false, reason: "missing NOTION_TOKEN or NOTION_PARENT_PAGE_ID" };
  }

  const lines = markdown.split(/\r?\n/).filter((line) => line.trim()).slice(0, 80);
  const children = lines.map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: line.slice(0, 1800) } }]
    }
  }));

  const body = {
    parent: { page_id: notionParentPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: `wan-wan Dashboard Sync ${new Date().toISOString().slice(0, 16)}` } }]
      }
    },
    children
  };

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    return { ok: false, reason: `Notion API ${response.status}`, detail: payload };
  }
  return { ok: true, pageId: payload.id };
}

async function writeAndOptionallySyncProjectDoc() {
  const markdown = buildProjectDocMarkdown();
  fs.writeFileSync(PROJECT_DOC_FILE, markdown, "utf8");
  const notion = await syncDocToNotion(markdown);
  return {
    localPath: PROJECT_DOC_FILE,
    notion
  };
}

app.post("/api/auth/unlock", (req, res) => {
  const password = String(req.body?.password || "").trim();
  if (!/^\d{6}$/.test(password)) {
    return res.status(400).json({ ok: false, error: "password must be 6 digits" });
  }
  if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ ok: false, error: "invalid password" });
  }
  const session = issueDashboardAuthToken();
  return res.json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt
  });
});

app.get("/api/auth/check", (req, res) => {
  const token = req.get("x-dashboard-token") || "";
  if (!verifyDashboardAuthToken(token)) {
    return res.status(401).json({ ok: false, error: "dashboard locked" });
  }
  return res.json({ ok: true });
});

app.get("/api/dashboard/summary", (req, res) => {
  const now = Date.now();
  if (!caches.summary.data || now - caches.summary.ts > caches.summary.ttlMs) {
    caches.summary.data = buildDashboardSummary();
    caches.summary.ts = now;
  }
  res.json(caches.summary.data);
});

app.get("/api/agents", (req, res) => {
  const discordCfg = getDiscordConfig();
  const rows = Object.entries(discordCfg.accounts || {})
    .filter(([accountId, value]) => accountId !== "default" && value?.enabled && value?.token)
    .map(([accountId]) => ({
      id: accountId,
      label: getRoleLabel(accountId),
      defaultChannelId: getDefaultDiscordChannelId(discordCfg, accountId)
    }));
  res.json({ agents: rows });
});

app.get("/api/agents/status", async (req, res) => {
  try {
    const now = Date.now();
    if (!caches.agents.data || now - caches.agents.ts > caches.agents.ttlMs) {
      caches.agents.data = await collectAgentsStatus();
      caches.agents.ts = now;
    }
    res.json(caches.agents.data);
  } catch (error) {
    recordAlert("AGENT_STATUS_ERROR", String(error.message || error), "medium");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.get("/api/external/status", async (req, res) => {
  try {
    const now = Date.now();
    if (!caches.external.data || now - caches.external.ts > caches.external.ttlMs) {
      caches.external.data = await collectExternalConnections();
      caches.external.ts = now;
    }
    res.json(caches.external.data);
  } catch (error) {
    recordAlert("EXTERNAL_STATUS_ERROR", String(error.message || error), "medium");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.get("/api/chat/models", (req, res) => {
  res.json({ models: buildModelCatalog() });
});

app.get("/api/workplace/messages", async (req, res) => {
  try {
    const discordCfg = getDiscordConfig();
    const defaultChannel = getDefaultDiscordChannelId(discordCfg, "karina_de_zjz_bot");
    const channelId = String(req.query.channelId || defaultChannel || "").trim();
    if (!channelId) {
      return res.status(400).json({ ok: false, error: "No workplace channel configured" });
    }
    const data = await fetchWorkplaceMessages({
      channelId,
      limit: Number(req.query.limit || 80)
    });
    res.json({ ok: true, ...data });
  } catch (error) {
    recordAlert("WORKPLACE_SYNC_ERROR", String(error.message || error), "high");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.post("/api/chat/intelligent", upload.single("file"), async (req, res) => {
  const file = req.file || null;
  try {
    const model = String(req.body.model || "").trim();
    const message = String(req.body.message || "");
    if (!model) {
      return res.status(400).json({ ok: false, error: "missing model" });
    }
    if (!message.trim() && !file) {
      return res.status(400).json({ ok: false, error: "message or file required" });
    }
    const result = await callModelChat({ modelKey: model, message, file });
    res.json({
      ok: true,
      model,
      reply: result.reply,
      usage: result.usage
    });
  } catch (error) {
    recordAlert("INTELLIGENT_CHAT_ERROR", String(error.message || error), "high");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  } finally {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
});

app.post("/api/chat/send", upload.single("image"), async (req, res) => {
  const file = req.file || null;
  try {
    const { agent, message, channelId } = req.body;
    if (!agent) {
      return res.status(400).json({ ok: false, error: "missing agent" });
    }
    const discordCfg = getDiscordConfig();
    const account = discordCfg.accounts?.[agent];
    if (!account?.enabled || !account?.token) {
      return res.status(400).json({ ok: false, error: `Agent unavailable: ${agent}` });
    }
    const finalChannelId = channelId || getDefaultDiscordChannelId(discordCfg, agent);
    if (!finalChannelId) {
      return res.status(400).json({ ok: false, error: "No channel configured for this agent" });
    }
    const text = String(message || "").trim();
    if (!text && !file) {
      return res.status(400).json({ ok: false, error: "message or image required" });
    }

    const discordResp = await sendDiscordMessage({
      token: account.token,
      channelId: finalChannelId,
      content: text || "image message",
      file
    });

    res.json({
      ok: true,
      channelId: finalChannelId,
      messageId: discordResp.id,
      agent
    });
  } catch (error) {
    recordAlert("DISCORD_SEND_ERROR", String(error.message || error), "high");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  } finally {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
});

app.post("/api/project/doc/sync", async (req, res) => {
  try {
    const result = await writeAndOptionallySyncProjectDoc();
    res.json({
      ok: true,
      localPath: result.localPath,
      notionSynced: !!result.notion?.ok,
      notion: result.notion
    });
  } catch (error) {
    recordAlert("DOC_SYNC_ERROR", String(error.message || error), "medium");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.post("/api/workflow/kickoff", async (req, res) => {
  try {
    if (DISABLE_KICKOFF_ENDPOINT) {
      return res.status(410).json({
        ok: false,
        error: "kickoff_disabled_use_direct_mention"
      });
    }
    const discordCfg = getDiscordConfig();
    const accountId = "karina_de_zjz_bot";
    const account = discordCfg.accounts?.[accountId];
    if (!account?.enabled || !account?.token) {
      return res.status(400).json({ ok: false, error: "Karina account unavailable" });
    }
    const channelId = getDefaultDiscordChannelId(discordCfg, accountId);
    if (!channelId) {
      return res.status(400).json({ ok: false, error: "No Discord channel configured for Karina" });
    }

    const forceKickoff = toBooleanLike(req.query.force) || toBooleanLike(req.body?.force);
    const state = loadWorkplaceState();

    if (!forceKickoff) {
      const lastKickoffAt = Date.parse(state.updatedAt || "");
      const dedupeWindowMs = 10 * 60 * 1000;
      if (state.kickoffMessageId && Number.isFinite(lastKickoffAt) && Date.now() - lastKickoffAt < dedupeWindowMs) {
        return res.json({
          ok: true,
          reused: true,
          messageId: state.kickoffMessageId,
          channelId,
          projectStartedAt: state.projectStartedAt,
          doc: {
            localPath: PROJECT_DOC_FILE,
            notionSynced: false
          }
        });
      }
    }

    const projectStartIso = state.projectStartedAt || new Date(Date.now() - 30 * 1000).toISOString();
    const firstHandoffTargetId = getDiscordBotIdByAccount(discordCfg, "geoun_de_zjz_bot");
    const kickoffMention = firstHandoffTargetId ? `<@${firstHandoffTargetId}> ` : "";
    const kickoffText = `${kickoffMention}【wan-wan Dashboard】Karina 现在开始编排：按 7-panel 规范推进 Memory/Token/Task/Project/Alert/Workplace/Intelligent Chatbox，先交付高保真布局与可运行链路，再回传验收结果。`;

    const discordResp = await sendDiscordMessage({
      token: account.token,
      channelId,
      content: kickoffText
    });
    upsertRouterSessionFromKickoff(channelId, kickoffText);

    const nowIso = new Date().toISOString();
    saveWorkplaceState({
      ...state,
      projectStartedAt: projectStartIso,
      kickoffMessageId: discordResp.id,
      updatedAt: nowIso
    });

    const docResult = await writeAndOptionallySyncProjectDoc();

    res.json({
      ok: true,
      messageId: discordResp.id,
      channelId,
      projectStartedAt: projectStartIso,
      doc: {
        localPath: docResult.localPath,
        notionSynced: !!docResult.notion?.ok
      }
    });
  } catch (error) {
    recordAlert("WORKFLOW_KICKOFF_ERROR", String(error.message || error), "high");
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`wan-wan dashboard is running at http://127.0.0.1:${PORT}`);
});
