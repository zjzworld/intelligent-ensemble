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

## 数据规则

- Memory: 统计 `T0/T1/T2/T3`（policy 归 `T3`），向量优良率每 30 分钟随机抽样。
- Token: 模型 / 请求数 / 日 token / 总 token（面板每 1 秒刷新）。
- Task: 任务内容 + 触发节奏（cron）。
- Project: 项目名、进度、完成数量。
- Alert: 模型断联、token 问题、任务卡顿、运行错误。
- Workplace: 按项目起始时间同步 Discord 机器人协作记录。
