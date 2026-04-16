# 排班大师 v2.0

一个精简、优雅、可部署到公网的 SaaS 排班应用。基于 Demo.html v1.7 重构，**完全保留原有的交互逻辑与移动端适配**，同时引入数据库存储与现代化样式。

## 功能特性

- **桌面端**：横向甘特式排班表，支持单击循环切换、拖拽多选批量设置、右键快速批量设置
- **移动端**：按人分页的月历视图，支持单击切换、长按/滑动批量选择、底部 Sheet 批量设置
- **成员 & 状态管理**：可视化配置团队分组、成员信息、班次状态（颜色、缩写、时段）
- **统计 pill**：自动统计每人各类班次天数
- **导出 Excel**：一键导出带颜色样式的排班表
- **数据持久化**：SQLite 数据库存储 + localStorage 离线缓存双保险
- **ScheduleAPI**：前端暴露 `window.ScheduleAPI`，方便二次开发与集成

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 HTML/JS + Tailwind CSS (CDN) |
| 后端 | Node.js + Express |
| 数据库 | SQLite (better-sqlite3) |
| 部署 | Docker + Docker Compose |

## 快速开始

### 本地开发

```bash
cd paiban-saas
npm install
npm run dev
```

访问 http://localhost:3000

### Docker 部署

```bash
cd paiban-saas
docker-compose up -d
```

数据将持久化到 `./data/paiban.db`。

## 文件结构

```
paiban-saas/
├── server.js           # Express API + SQLite
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── README.md
└── public/
    ├── index.html      # 前端页面
    └── app.js          # 前端逻辑（与 Demo 交互逻辑一致）
```

## 默认数据

首次启动时，系统会自动写入与 Demo.html 一致的默认配置（4 个团队、10 位成员、7 种班次状态）。

## API 列表

- `GET /api/config` — 获取配置
- `POST /api/config` — 保存配置
- `GET /api/schedule/:year/:month` — 获取某月排班
- `POST /api/schedule/:year/:month` — 保存某月排班
- `GET /api/health` — 健康检查

## 公网部署建议

1. 在 VPS / 云服务器上克隆本项目
2. 使用 `docker-compose up -d` 启动
3. 配置 Nginx / Caddy 反向代理到 `127.0.0.1:3000`
4. （可选）添加 HTTPS 证书
5. （可选）如需多租户，可在 `config` 与 `schedules` 表中增加 `tenant_id` 字段
