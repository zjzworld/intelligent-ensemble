#!/usr/bin/env python3
import datetime as dt
import glob
import json
import os
import sys
import urllib.error
import urllib.request


RUNTIME_AGENTS_DIR = "/Users/mac_mini_de_zjz/Desktop/Intelligent Body/runtime/agents"
WANWAN_CONFIG_PATH = "/Users/mac_mini_de_zjz/Desktop/Intelligent Body/config/wan-wan.json"
DEFAULT_INGEST_URL = "https://intelligent.zjz.world/api/token/local-ingest"


def safe_int(value, fallback=0):
  try:
    return int(value)
  except Exception:
    return int(fallback)


def load_gateway_token():
  try:
    with open(WANWAN_CONFIG_PATH, "r", encoding="utf-8") as file:
      data = json.load(file)
    token = str((((data.get("gateway") or {}).get("auth") or {}).get("token") or "")).strip()
    return token
  except Exception:
    return ""


def build_model_key(provider, model):
  model_name = str(model or "").strip() or "unknown"
  if "::" in model_name:
    return model_name
  provider_name = str(provider or "").strip().lower()
  if provider_name:
    return f"{provider_name}::{model_name}"
  return model_name


def parse_usage_rows():
  files = glob.glob(os.path.join(RUNTIME_AGENTS_DIR, "*", "sessions", "*.jsonl"))
  today = dt.datetime.utcnow().strftime("%Y-%m-%d")
  aggregated = {}
  messages = 0

  for path in files:
    try:
      with open(path, "r", encoding="utf-8", errors="ignore") as file:
        for line in file:
          line = line.strip()
          if not line:
            continue
          try:
            obj = json.loads(line)
          except Exception:
            continue
          message = obj.get("message") if isinstance(obj, dict) else None
          if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
          usage = message.get("usage")
          if not isinstance(usage, dict):
            continue

          provider = str(message.get("provider") or "").strip()
          model = str(message.get("model") or "").strip()
          key = build_model_key(provider, model)
          ts = message.get("timestamp") or obj.get("timestamp")
          ts_ms = safe_int(ts, 0)
          ts_date = ""
          if ts_ms > 0:
            try:
              ts_date = dt.datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d")
            except Exception:
              ts_date = ""

          input_tokens = safe_int(usage.get("input"), 0)
          output_tokens = safe_int(usage.get("output"), 0)
          total_tokens = safe_int(usage.get("totalTokens"), input_tokens + output_tokens)

          row = aggregated.setdefault(
            key,
            {"model": key, "requests": 0, "tokensDaily": 0, "tokensTotal": 0},
          )
          row["requests"] += 1
          row["tokensTotal"] += total_tokens
          if ts_date == today:
            row["tokensDaily"] += total_tokens
          messages += 1
    except Exception:
      continue

  rows = sorted(
    aggregated.values(),
    key=lambda item: (item.get("tokensTotal", 0), item.get("requests", 0), item.get("model", "")),
    reverse=True,
  )
  return files, messages, rows


def post_rows(url, token, rows):
  payload = {"source": "local-runtime-agents", "rows": rows}
  data = json.dumps(payload).encode("utf-8")
  req = urllib.request.Request(
    url,
    data=data,
    method="POST",
    headers={
      "Content-Type": "application/json",
      "Authorization": f"Bearer {token}",
    },
  )
  with urllib.request.urlopen(req, timeout=30) as resp:
    body = resp.read().decode("utf-8", errors="ignore")
    return resp.getcode(), body


def main():
  ingest_url = str(os.getenv("TOKEN_LOCAL_INGEST_URL") or DEFAULT_INGEST_URL).strip()
  ingest_key = str(os.getenv("TOKEN_LOCAL_INGEST_KEY") or "").strip() or load_gateway_token()
  if not ingest_key:
    print("error: missing ingest key (TOKEN_LOCAL_INGEST_KEY or wan-wan gateway.auth.token)")
    return 1

  files, messages, rows = parse_usage_rows()
  print(f"files={len(files)} messages={messages} rows={len(rows)}")

  try:
    code, body = post_rows(ingest_url, ingest_key, rows)
    print(f"ingest_status={code}")
    print(body[:800])
    return 0 if 200 <= code < 300 else 1
  except urllib.error.HTTPError as error:
    print(f"ingest_http_error={error.code}")
    print(error.read().decode('utf-8', errors='ignore')[:800])
    return 1
  except Exception as error:
    print(f"ingest_error={error}")
    return 1


if __name__ == "__main__":
  sys.exit(main())
