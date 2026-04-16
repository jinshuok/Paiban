# Cloudflare Pages + D1 多租户部署指南

本文档说明如何将 **排班大师 v2.0** 部署到 **Cloudflare Pages + D1**，实现零成本、自动扩缩容、按子域名隔离的多租户 SaaS。

> 对比 Bushu.txt 中的方案，本实现采用 **基于 `tenant_id` 的行级隔离**，这是 D1 (SQLite) 场景下最轻量、最实际的多租户方案。每个租户的数据在同一数据库中通过 `tenant_id` 字段隔离，配合子域名路由实现租户自动识别与自动开户。

---

## 一、准备工作（请先完成）

### 1. 注册 Cloudflare 账号
- 访问 https://dash.cloudflare.com/sign-up
- 免费版即可满足大部分需求

### 2. 准备 GitHub / GitLab 仓库
- 将 `paiban-saas` 代码推送到 GitHub 或 GitLab
- 确保仓库为 **Public**（或 Private 但需授权 Cloudflare 访问）

### 3. 安装 Wrangler CLI
```bash
npm install -g wrangler
```

### 4. 登录 Cloudflare（授权）
```bash
wrangler login
```
- 会弹出浏览器，要求你授权 Wrangler 访问你的 Cloudflare 账号
- 授权成功后，命令行会显示 `Successfully logged in`

### 5. 创建 D1 数据库
```bash
wrangler d1 create paiban-db
```
- 复制输出中的 `database_id`（格式如 `xxxxx-xxxxx-xxxxx`）
- 将该 ID 填入项目根目录 `wrangler.toml` 中的 `database_id` 字段

### 6. 执行数据库迁移
```bash
# 本地验证（可选）
wrangler d1 migrations apply paiban-db --local

# 应用到生产数据库
wrangler d1 migrations apply paiban-db --remote
```

---

## 二、项目结构（Cloudflare 版本）

```
paiban-saas/
├── package.json              # 已添加 hono 依赖
├── wrangler.toml             # Cloudflare / D1 配置
├── migrations/
│   └── 0001_init.sql         # D1 多租户表结构
├── functions/
│   └── api/
│       └── [[route]].js      # Hono API (Pages Functions)
├── public/
│   ├── index.html            # 前端页面
│   └── app.js                # 前端逻辑（含租户识别）
├── server.js                 # Node.js 版本（可选保留）
└── DEPLOY_CF.md              # 本文件
```

---

## 三、多租户机制说明

### 租户识别逻辑（后端 `functions/api/[[route]].js`）

| 访问方式 | 解析出的 tenantId | 说明 |
|---------|------------------|------|
| `acme.paiban.pages.dev` | `acme` | 子域名自动识别 |
| `localhost:8788` | `default` 或 `X-Tenant-Id` 请求头 | 本地开发 |
| `www.yourdomain.com` | `default` | 主域名访问 |

**自动开户**：当一个新的 `tenantId` 首次访问 API 时，后端会自动在 `tenants` 表和 `tenant_configs` 表中插入该租户，并填充默认配置（与 Demo 一致的 4 组 10 人 7 状态）。

### 数据库隔离
- 所有表均带有 `tenant_id` 字段
- 每个查询都强制 `WHERE tenant_id = ?`
- 不存在跨租户数据泄露风险

---

## 四、本地预览

```bash
cd paiban-saas
npm install

# 使用 wrangler pages dev 启动（会自动加载 functions 和 D1 本地模拟）
npx wrangler pages dev public --compatibility-date=2024-06-14
```

访问 http://localhost:8788 即可看到默认租户界面。

> 如果你想模拟多租户，可修改 `hosts` 文件或在浏览器访问 `http://acme.localhost:8788`（部分浏览器支持），也可在 DevTools Network 中勾选 "Add header" 添加 `X-Tenant-Id: acme`。

---

## 五、部署到 Cloudflare Pages

### 方式 A：命令行一键部署（适合首次上线）

```bash
npx wrangler pages deploy public
```
- 部署完成后，Wrangler 会输出类似 `https://paiban-saas.pages.dev` 的地址

### 方式 B：Git 集成自动部署（推荐长期维护）

1. 登录 Cloudflare Dashboard → **Pages**
2. 点击 **"Create a project"**
3. 选择 **"Connect to Git"**
4. 授权 Cloudflare 访问你的 GitHub/GitLab 账号，并选择 `paiban-saas` 仓库
5. 构建设置：
   - **Framework preset**: `None`
   - **Build command**: (留空)
   - **Build output directory**: `public`
6. 点击 **Save and Deploy**
7. 进入项目设置 → **Functions** → **D1 database bindings**
   - Variable name: `DB`
   - Database: 选择你创建的 `paiban-db`
8. 重新部署一次（或推送新 commit 触发自动部署）

---

## 六、使用多租户

部署成功后，你可以通过不同的子域名访问不同的租户实例：

- `https://team-a.paiban-saas.pages.dev` → Team A 的独立排班表
- `https://team-b.paiban-saas.pages.dev` → Team B 的独立排班表
- `https://paiban-saas.pages.dev` → 默认租户（`default`）

> **注意**：`*.pages.dev` 子域名在 Cloudflare Pages 上是**原生支持**的，无需额外 DNS 配置。每个子域名都会命中同一个项目，后端通过 `Host` 头识别租户。

---

## 七、绑定自定义域名（可选）

如果你有自己的域名（如 `paiban.example.com`），并希望租户使用子域名：

1. 在 Cloudflare Pages 项目设置 → **Custom domains** 中添加根域名
2. 在你的 DNS 提供商（建议使用 Cloudflare DNS）添加一条 **CNAME** 记录：
   - Name: `*.paiban` 或 `paiban`
   - Target: `paiban-saas.pages.dev`
3.  tenants 即可通过 `https://team-a.paiban.example.com` 访问

> 若使用 Cloudflare DNS，通配符 `*.paiban.example.com` 需要 **Cloudflare for SaaS** 或付费计划才能代理。作为替代，你可以为每个租户手动添加一条 CNAME 记录（免费计划支持）。

---

## 八、切换为 Supabase（PostgreSQL）替代方案

如果你更倾向于使用 Supabase（PostgreSQL）而不是 D1，需要做以下改动：

1. **安装依赖**
   ```bash
   npm install @supabase/supabase-js
   ```

2. **替换后端**
   - 不使用 `functions/api/[[route]].js` 中的 D1 API
   - 改用 Supabase Client，在每个请求中通过 `tenant_id` 过滤
   - 利用 PostgreSQL **Row Level Security (RLS)** 实现底层隔离：
     ```sql
     ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation ON schedules
       USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
     ```

3. **更新 `wrangler.toml`**
   - 移除 `[[d1_databases]]` 绑定
   - 将 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 作为环境变量（Secrets）注入：
     ```bash
     wrangler pages secret put SUPABASE_URL
     wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
     ```

> D1 更适合本项目的轻量级需求；Supabase 适合未来需要复杂权限、实时订阅、向量搜索等高级功能时迁移。

---

## 九、安全加固建议

1. **环境变量（Secrets）**：若未来添加管理员密码 / JWT Secret，请使用 `wrangler pages secret put KEY_NAME` 注入，不要写入代码。
2. **访问控制**：Cloudflare Pages 原生支持 **Cloudflare Access**，可为特定子域名添加 SSO / 邮箱验证码登录。
3. **备份 D1**：定期使用 `wrangler d1 export` 导出数据。

---

## 十、故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `Database not bound` | Pages 项目未绑定 D1 | Dashboard → Functions → D1 bindings 添加 `DB` |
| `Cannot read properties of undefined` | `hono` 未安装 | 运行 `npm install` 后再部署 |
| 子域名访问 404 | 非 Pages 原生子域名 | 确保格式为 `xxx.project.pages.dev` 或正确配置 DNS |
| 数据不隔离 | `tenant_id` 未传入 | 本地开发时添加 `X-Tenant-Id` 请求头 |
| 部署后样式丢失 | Build output directory 错误 | 设置为 `public`，不是根目录 |

---

完成以上步骤后，你就拥有了一个真正可公网访问、支持多租户、数据持久化在 Cloudflare D1 的 **排班大师 SaaS**。
