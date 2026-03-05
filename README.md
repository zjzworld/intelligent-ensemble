# wan-wan Dashboard (7 Panels)

单页七面板版本，按黄金分割布局：

- `Intelligent Chatbox`（左上大区，支持模型选择、粘贴图片、上传文件/图片）
- `Memory`
- `Token`
- `Task`
- `Project`
- `Alert`
- `Workplace`（右侧竖条，Discord 协作记录滚动同步）

## 启动

```bash
cd "/Users/mac_mini_de_zjz/Desktop/Intelligent Body/project/main/deliveries/wanwan-dashboard"
npm install
npm start
```

访问：

- `http://127.0.0.1:3900`

## 主要接口

- `GET /api/dashboard/summary`
- `GET /api/chat/models`
- `POST /api/chat/intelligent`
- `GET /api/workplace/messages`
- `POST /api/workflow/kickoff`
- `POST /api/project/doc/sync`
- `POST /api/chat/send`（保留：用指定 agent 发 Discord 消息）

## Cloudflare Pages + SQLite（D1）

已接入云端 SQLite 持久化（D1）：

- Discord 协作消息：拉取后写入 `discord_messages`
- Token 同步数据：拉取后写入 `token_sync_rows`
- Chatbox token 事件：写入 `token_chat_events`

推荐在 Pages 项目添加 D1 绑定（变量名）：

- `DASHBOARD_DB`（推荐）
- 或 `DB`（兼容）

同时确保环境变量已配置：

- `DISCORD_SYNC_BOT_TOKEN`
- `DISCORD_SYNC_CHANNEL_ID`
- `TOKEN_USAGE_SYNC_API_URL`
- `TOKEN_USAGE_SYNC_API_KEY`（可选）

Karina 主程序直连执行（`/api/chat/karina`）新增环境变量：

- `KARINA_EXEC_API_URL`（必填，Karina 主程序执行入口）
- `KARINA_EXEC_API_KEY`（可选，Bearer 鉴权）
- `KARINA_EXEC_TIMEOUT_MS`（可选，默认 90000）
- `KARINA_MIRROR_DISCORD`（可选，默认关闭；设为 `true` 才镜像到 Discord）
- `KARINA_EXEC_MODEL`（可选；当 `KARINA_EXEC_API_URL` 未配置时，使用内置模型直连执行，默认 `codex::gpt-5.3-codex`）

可选自建同步端点（已内置）：`GET /api/token/usage-sync`（Bearer 鉴权，使用 `TOKEN_USAGE_SYNC_API_KEY`）。

## 数据规则

- Memory: 统计 `T0/T1/T2/T3`（policy 归 `T3`），向量优良率每 30 分钟随机抽样。
- Token: 模型 / 请求数 / 日 token / 总 token（面板每 1 秒刷新）。
- Task: 任务内容 + 触发节奏（cron）。
- Project: 项目名、进度、完成数量。
- Alert: 模型断联、token 问题、任务卡顿、运行错误。
- Workplace: 按项目起始时间同步 Discord 机器人协作记录。
