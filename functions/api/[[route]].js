import crypto from 'node:crypto'

const DEFAULT_CONFIG = {
  groups: [
    { id: 'g1', name: '销售部' },
    { id: 'g2', name: '设计部' },
    { id: 'g3', name: '技术部' },
    { id: 'g4', name: '人事部' },
  ],
  members: [
    { id: 'm1',  name: '张三', uid: 'zhangsan', groupId: 'g1' },
    { id: 'm2',  name: '李四', uid: 'lisi', groupId: 'g1' },
    { id: 'm3',  name: '王五', uid: 'wangwu', groupId: 'g1' },
    { id: 'm4',  name: '赵六', uid: 'zhaoliu', groupId: 'g2' },
    { id: 'm5',  name: '孙七', uid: 'sunqi', groupId: 'g2' },
    { id: 'm6',  name: '周八', uid: 'zhouba', groupId: 'g3' },
    { id: 'm7',  name: '吴九', uid: 'wujiu', groupId: 'g3' },
    { id: 'm8',  name: '郑十', uid: 'zhengshi', groupId: 'g4' },
    { id: 'm9',  name: '钱十一', uid: 'qianshiyi', groupId: 'g4' },
    { id: 'm10', name: '冯十二', uid: 'fengshier', groupId: 'g4' },
  ],
  statuses: [
    { id: 'work',   label: '正常班', short: '班', color: '#2563eb', timeStart: '09:00', timeEnd: '18:00', inCycle: true  },
    { id: 'duty',   label: '值班',   short: '值', color: '#7c3aed', timeStart: '13:30', timeEnd: '22:00', inCycle: true  },
    { id: 'rest',   label: '休息',   short: '休', color: '#f59e0b', timeStart: '',      timeEnd: '',      inCycle: true  },
    { id: 'annual', label: '年假',   short: '年', color: '#f97316', timeStart: '',      timeEnd: '',      inCycle: false },
    { id: 'leave',  label: '事假',   short: '事', color: '#ef4444', timeStart: '',      timeEnd: '',      inCycle: false },
    { id: 'sick',   label: '病假',   short: '病', color: '#ec4899', timeStart: '',      timeEnd: '',      inCycle: false },
    { id: 'comp',   label: '调休',   short: '调', color: '#64748b', timeStart: '',      timeEnd: '',      inCycle: false },
  ],
  clickCycle: ['work', 'duty', 'rest', null],
  stats: [
    { countAs: 'work',  label: '班', color: '#2563eb' },
    { countAs: 'duty',  label: '值', color: '#7c3aed' },
    { countAs: 'rest',  label: '休', color: '#f59e0b' },
    { countAs: 'leave', label: '假', color: '#ef4444' },
  ],
}

const COOKIE_NAME = 'session'
const SESSION_DAYS = 7

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  })
}

function getTenantId(request, env) {
  const host = request.headers.get('host') || ''
  const parts = host.split('.')
  const mainDomain = env.MAIN_DOMAIN || ''
  let tenantId = parts[0]

  if (host.includes('localhost') || host.includes('127.0.0.1') || parts.length < 3) {
    tenantId = request.headers.get('x-tenant-id') || 'default'
  } else if (tenantId === 'www') {
    tenantId = parts[1] === mainDomain ? 'default' : parts[1]
  }
  return tenantId
}

async function initSchema(db) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, day INTEGER NOT NULL, status_id TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, member_id, year, month, day))`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, username))`,
    `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_tenant_ym ON schedules(tenant_id, year, month)`
  ]
  for (const sql of stmts) {
    await db.prepare(sql).run()
  }
}

async function ensureTenant(db, tenantId) {
  const existing = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first()
  if (!existing) {
    await db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').bind(tenantId, tenantId).run()
    await db.prepare('INSERT INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
      .bind(tenantId, JSON.stringify(DEFAULT_CONFIG)).run()
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(derived))
}

function genId(prefix) {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6)
}

function genSessionToken() {
  return crypto.randomBytes(32).toString('hex')
}

function parseCookies(request) {
  const cookie = request.headers.get('cookie') || ''
  const obj = {}
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k) obj[k] = v
  }
  return obj
}

function cookieHeader(token, secure, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function clearCookieHeader(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

async function getSession(request, db) {
  const cookies = parseCookies(request)
  const token = cookies[COOKIE_NAME]
  if (!token) return null
  const row = await db.prepare('SELECT token, tenant_id, username, role FROM sessions WHERE token = ? AND expires_at > datetime("now")')
    .bind(token).first()
  return row || null
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method
  const db = env.DB
  const tenantId = getTenantId(request, env)
  const secure = request.headers.get('x-forwarded-proto') === 'https'

  if (!db) {
    return json({ error: 'Database not bound' }, 500)
  }

  await initSchema(db)
  await ensureTenant(db, tenantId)

  const session = await getSession(request, db)

  // ── Public routes ──

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, tenantId, time: new Date().toISOString() })
  }

  if (pathname === '/api/auth/status' && method === 'GET') {
    const hasAdmin = !!(await db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").bind(tenantId).first())
    return json({ tenantId, hasTenant: true, hasAdmin })
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    return json({
      tenantId,
      authenticated: !!(session && session.tenant_id === tenantId),
      username: session?.username || null,
      role: session?.role || null,
    })
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { username, password } = body
    if (!username || !password) return json({ error: '用户名和密码必填' }, 400)

    const user = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').bind(tenantId, username).first()
    if (!user || !verifyPassword(password, user.password_hash)) {
      return json({ error: '用户名或密码错误' }, 401)
    }

    const token = genSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, tenantId, username, user.role, expiresAt).run()

    return json({ ok: true, tenantId, username, role: user.role }, 200, {
      'Set-Cookie': cookieHeader(token, secure)
    })
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (session) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run()
    }
    return json({ ok: true }, 200, {
      'Set-Cookie': clearCookieHeader(secure)
    })
  }

  if (pathname === '/api/auth/register-admin' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { username, password } = body
    if (!username || !password) return json({ error: '用户名和密码必填' }, 400)

    const hasAdmin = !!(await db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").bind(tenantId).first())
    if (hasAdmin) return json({ error: '该租户已存在管理员' }, 409)

    try {
      await db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'admin')")
        .bind(tenantId, username, hashPassword(password)).run()

      const token = genSessionToken()
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, tenantId, username, 'admin', expiresAt).run()

      return json({ ok: true, tenantId, username, role: 'admin' }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      })
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return json({ error: '用户名已被注册' }, 409)
      }
      return json({ error: e.message }, 500)
    }
  }

  if (pathname === '/api/auth/register-member' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { username, password } = body
    if (!username || !password) return json({ error: '用户名和密码必填' }, 400)

    try {
      await db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'member')")
        .bind(tenantId, username, hashPassword(password)).run()

      const cfgRow = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
      const cfg = cfgRow ? JSON.parse(cfgRow.value) : DEFAULT_CONFIG
      const exists = cfg.members.find(m => m.uid === username)
      if (!exists) {
        const gid = cfg.groups[0]?.id || ''
        cfg.members.push({ id: genId('m'), name: username, uid: username, groupId: gid })
        await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
          .bind(tenantId, JSON.stringify(cfg)).run()
      }

      const token = genSessionToken()
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, tenantId, username, 'member', expiresAt).run()

      return json({ ok: true, tenantId, username, role: 'member' }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      })
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return json({ error: '用户名已被注册' }, 409)
      }
      return json({ error: e.message }, 500)
    }
  }

  // ── Auth guard ──
  if (!session || session.tenant_id !== tenantId) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Protected routes ──

  if (pathname === '/api/admin/reset-password' && method === 'POST') {
    if (session.role !== 'admin') return json({ error: '需要管理员权限' }, 403)
    const body = await request.json().catch(() => ({}))
    const { username, newPassword } = body
    if (!username || !newPassword) return json({ error: '用户名和新密码必填' }, 400)

    const user = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').bind(tenantId, username).first()
    if (!user) return json({ error: '用户不存在' }, 404)

    await db.prepare('UPDATE users SET password_hash = ? WHERE tenant_id = ? AND username = ?')
      .bind(hashPassword(newPassword), tenantId, username).run()
    return json({ ok: true })
  }

  if (pathname === '/api/config' && method === 'GET') {
    const row = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    return json(row ? JSON.parse(row.value) : DEFAULT_CONFIG)
  }

  if (pathname === '/api/config' && method === 'POST') {
    if (session.role !== 'admin') return json({ error: '需要管理员权限' }, 403)
    try {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
        .bind(tenantId, JSON.stringify(body)).run()
      return json({ ok: true })
    } catch (e) {
      return json({ error: e.message }, 400)
    }
  }

  const scheduleMatch = pathname.match(/^\/api\/schedule\/([0-9]{4})\/([0-9]{1,2})$/)
  if (scheduleMatch && method === 'GET') {
    const year = scheduleMatch[1]
    const month = scheduleMatch[2]
    const { results } = await db.prepare(
      'SELECT member_id, day, status_id FROM schedules WHERE tenant_id = ? AND year = ? AND month = ?'
    ).bind(tenantId, year, month).all()

    const data = {}
    for (const r of results) {
      data[`${r.member_id}-${year}-${month}-${r.day}`] = r.status_id
    }
    return json(data)
  }

  if (scheduleMatch && method === 'POST') {
    const year = +scheduleMatch[1]
    const month = +scheduleMatch[2]
    try {
      const body = await request.json()
      const stmts = []

      for (const [key, statusId] of Object.entries(body)) {
        const [memberId, y, m, d] = key.split('-')
        if (+y !== year || +m !== month) continue
        if (!statusId) {
          stmts.push(
            db.prepare('DELETE FROM schedules WHERE tenant_id = ? AND year = ? AND month = ? AND member_id = ? AND day = ?')
              .bind(tenantId, year, month, memberId, +d)
          )
        } else {
          stmts.push(
            db.prepare('INSERT OR REPLACE INTO schedules (tenant_id, member_id, year, month, day, status_id) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(tenantId, memberId, year, month, +d, statusId)
          )
        }
      }

      for (let i = 0; i < stmts.length; i += 100) {
        await db.batch(stmts.slice(i, i + 100))
      }

      return json({ ok: true })
    } catch (e) {
      return json({ error: e.message }, 400)
    }
  }

  return json({ error: 'Not found' }, 404)
}
