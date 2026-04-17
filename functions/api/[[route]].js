import crypto from 'node:crypto'

const DEFAULT_CONFIG = {
  groups: [
    { id: 'g1', name: '销售部' },
    { id: 'g2', name: '设计部' },
    { id: 'g3', name: '技术部' },
    { id: 'g4', name: '人事部' },
  ],
  members: [
    { id: 'm1',  name: '张三', uid: 'zhangsan', groupId: 'g1', thirdParties: [] },
    { id: 'm2',  name: '李四', uid: 'lisi', groupId: 'g1', thirdParties: [] },
    { id: 'm3',  name: '王五', uid: 'wangwu', groupId: 'g1', thirdParties: [] },
    { id: 'm4',  name: '赵六', uid: 'zhaoliu', groupId: 'g2', thirdParties: [] },
    { id: 'm5',  name: '孙七', uid: 'sunqi', groupId: 'g2', thirdParties: [] },
    { id: 'm6',  name: '周八', uid: 'zhouba', groupId: 'g3', thirdParties: [] },
    { id: 'm7',  name: '吴九', uid: 'wujiu', groupId: 'g3', thirdParties: [] },
    { id: 'm8',  name: '郑十', uid: 'zhengshi', groupId: 'g4', thirdParties: [] },
    { id: 'm9',  name: '钱十一', uid: 'qianshiyi', groupId: 'g4', thirdParties: [] },
    { id: 'm10', name: '冯十二', uid: 'fengshier', groupId: 'g4', thirdParties: [] },
  ],
  statuses: [
    { id: 'work',   label: '正常班', short: '班', color: '#2563eb', timeStart: '09:00', timeEnd: '18:00', inCycle: true, dayCount: 1  },
    { id: 'duty',   label: '值班',   short: '值', color: '#7c3aed', timeStart: '13:30', timeEnd: '22:00', inCycle: true, dayCount: 1  },
    { id: 'rest',   label: '休息',   short: '休', color: '#f59e0b', timeStart: '',      timeEnd: '',      inCycle: true, dayCount: 0  },
    { id: 'annual', label: '年假',   short: '年', color: '#f97316', timeStart: '',      timeEnd: '',      inCycle: false, dayCount: 0 },
    { id: 'leave',  label: '事假',   short: '事', color: '#ef4444', timeStart: '',      timeEnd: '',      inCycle: false, dayCount: 0 },
    { id: 'sick',   label: '病假',   short: '病', color: '#ec4899', timeStart: '',      timeEnd: '',      inCycle: false, dayCount: 0 },
    { id: 'comp',   label: '调休',   short: '调', color: '#64748b', timeStart: '',      timeEnd: '',      inCycle: false, dayCount: 0 },
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

const OLD_NAME_MAP = {
  '李日凤': '张三', '曹铭': '李四', '钟贵秋': '王五', '何粤灵': '赵六', '曾金梅': '孙七',
  '苏允旋': '周八', '邓大广': '吴九', '陈清梅': '郑十', '廖美凤': '钱十一', '吴慧茹': '冯十二',
  '李*凤': '张三', '曹*': '李四', '钟*秋': '王五', '何*灵': '赵六', '曾*梅': '孙七',
  '苏*旋': '周八', '邓*广': '吴九', '陈*梅': '郑十', '廖*凤': '钱十一', '吴*茹': '冯十二',
}

const OLD_UID_MAP = {
  'lirifeng': 'zhangsan', 'caoming': 'lisi', 'zhongguiqiu': 'wangwu', 'heyueling': 'zhaoliu', 'zengjinmei': 'sunqi',
  'suyunxuan': 'zhouba', 'dengdaguang': 'wujiu', 'chenqingmei': 'zhengshi', 'liaomeifeng': 'qianshiyi', 'wuhuiru': 'fengshier',
}

const OLD_GROUP_MAP = {
  '产品-数科': '销售部', '产品-供管': '设计部', '产品-销管': '技术部', '测试&运营': '人事部',
  '产品-*科': '销售部', '产品-*管': '设计部', '测试&*营': '人事部',
}

function sanitizeConfig(cfg) {
  let dirty = false
  if (cfg.members && Array.isArray(cfg.members)) {
    for (const m of cfg.members) {
      if (OLD_NAME_MAP[m.name]) { m.name = OLD_NAME_MAP[m.name]; dirty = true }
      if (OLD_UID_MAP[m.uid]) { m.uid = OLD_UID_MAP[m.uid]; dirty = true }
    }
  }
  if (cfg.groups && Array.isArray(cfg.groups)) {
    for (const g of cfg.groups) {
      if (OLD_GROUP_MAP[g.name]) { g.name = OLD_GROUP_MAP[g.name]; dirty = true }
    }
  }
  return dirty
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  })
}

function getTenantId(request, env) {
  // 优先从请求头读取
  const headerTenantId = request.headers.get('x-tenant-id')
  if (headerTenantId) return headerTenantId

  // 从 pathname 读取（固定域名+子目录部署）
  const url = new URL(request.url)
  const pathname = url.pathname
  const pathMatch = pathname.match(/^\/([a-zA-Z0-9-]+)(?:\/|$)/)
  if (pathMatch) {
    const possibleTenant = pathMatch[1]
    if (possibleTenant !== 'api' && !possibleTenant.startsWith('superadmin')) {
      return possibleTenant
    }
  }

  const host = request.headers.get('host') || ''
  const parts = host.split('.')
  const mainDomain = env.MAIN_DOMAIN || ''
  let tenantId = parts[0]

  if (host.includes('localhost') || host.includes('127.0.0.1') || parts.length < 3) {
    tenantId = 'default'
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
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', is_creator INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS super_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS api_keys (tenant_id TEXT PRIMARY KEY NOT NULL, api_key TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_tenant_ym ON schedules(tenant_id, year, month)`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`
  ]
  for (const sql of stmts) {
    await db.prepare(sql).run()
  }

  const superAdminExists = await db.prepare('SELECT 1 FROM super_admins LIMIT 1').first()
  if (!superAdminExists) {
    await db.prepare("INSERT INTO super_admins (username, password_hash, must_change_password) VALUES (?, ?, 1)")
      .bind('admin', hashPassword('admin')).run()
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

async function getUserGroups(db, username) {
  const { results } = await db.prepare(`
    SELECT DISTINCT u.tenant_id AS id, t.name, u.role
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE u.username = ?
    ORDER BY u.created_at DESC
  `).bind(username).all()
  return results || []
}

async function getApiKey(db, tenantId) {
  const row = await db.prepare('SELECT api_key FROM api_keys WHERE tenant_id = ?').bind(tenantId).first()
  return row ? row.api_key : null
}

async function refreshApiKey(db, tenantId) {
  const key = crypto.randomBytes(32).toString('hex')
  await db.prepare('INSERT OR REPLACE INTO api_keys (tenant_id, api_key, updated_at) VALUES (?, ?, datetime("now"))')
    .bind(tenantId, key).run()
  return key
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

  const session = await getSession(request, db)

  // ── Public routes ──

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, tenantId, time: new Date().toISOString() })
  }

  if (pathname === '/api/auth/status' && method === 'GET') {
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first()
    const hasAdmin = tenant
      ? !!(await db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").bind(tenantId).first())
      : false
    return json({ tenantId, tenantName: tenant?.name || tenantId, hasTenant: !!tenant, hasAdmin })
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const isSuperAdmin = !!(session && session.role === 'superadmin')
    const groups = (session && !isSuperAdmin && session.username)
      ? await getUserGroups(db, session.username)
      : []
    return json({
      tenantId,
      authenticated: !!(session && (session.tenant_id === tenantId || isSuperAdmin)),
      username: session?.username || null,
      role: session?.role || null,
      isSuperAdmin,
      mustChangePassword: isSuperAdmin ? (session?.mustChangePassword || false) : false,
      currentGroupId: session?.tenant_id || null,
      groups,
    })
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { phone, password } = body
    if (!phone || !password) return json({ error: '手机号和密码必填' }, 400)
    if (!/^\d{7,11}$/.test(phone)) return json({ error: '手机号必须是7-11位数字' }, 400)

    // Check super admin first
    const superAdmin = await db.prepare('SELECT * FROM super_admins WHERE username = ?').bind(phone).first()
    if (superAdmin && verifyPassword(password, superAdmin.password_hash)) {
      const token = genSessionToken()
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, '__system', phone, 'superadmin', expiresAt).run()
      return json({ ok: true, tenantId: '__system', username: phone, role: 'superadmin', isSuperAdmin: true, mustChangePassword: superAdmin.must_change_password === 1 }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      })
    }

    // Find all users with this phone across groups
    const { results: userRows } = await db.prepare('SELECT * FROM users WHERE username = ?').bind(phone).all()
    if (!userRows || userRows.length === 0) {
      return json({ error: '手机号或密码错误' }, 401)
    }

    let matchedUser = null
    for (const u of userRows) {
      if (verifyPassword(password, u.password_hash)) {
        matchedUser = u
        break
      }
    }
    if (!matchedUser) {
      return json({ error: '手机号或密码错误' }, 401)
    }

    const groups = await getUserGroups(db, phone)
    const defaultGroupId = matchedUser.tenant_id

    const token = genSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, defaultGroupId, phone, matchedUser.role, expiresAt).run()

    return json({ ok: true, username: phone, role: matchedUser.role, isSuperAdmin: false, mustChangePassword: false, groups, defaultGroupId, tenantId: defaultGroupId }, 200, {
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
    const { orgName, orgId, adminPhone, password } = body
    if (!orgName || !orgId || !adminPhone || !password) return json({ error: '所有字段必填' }, 400)
    if (!/^[a-zA-Z0-9-]{5,10}$/.test(orgId)) return json({ error: '组织ID必须为5-10位字母、数字或连字符' }, 400)
    if (!/^\d{7,11}$/.test(adminPhone)) return json({ error: '手机号必须是7-11位数字' }, 400)

    const existingTenant = await db.prepare('SELECT 1 FROM tenants WHERE id = ?').bind(orgId).first()
    if (existingTenant) return json({ error: '组织ID已被使用' }, 409)

    try {
      await db.batch([
        db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').bind(orgId, orgName),
        db.prepare('INSERT INTO tenant_configs (tenant_id, value) VALUES (?, ?)').bind(orgId, JSON.stringify(DEFAULT_CONFIG)),
        db.prepare("INSERT INTO users (tenant_id, username, password_hash, role, is_creator) VALUES (?, ?, ?, 'admin', 1)").bind(orgId, adminPhone, hashPassword(password))
      ])

      const token = genSessionToken()
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, orgId, adminPhone, 'admin', expiresAt).run()

      return json({ ok: true, tenantId: orgId, tenantName: orgName, username: adminPhone, role: 'admin' }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      })
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return json({ error: '该手机号已是此组织管理员' }, 409)
      }
      return json({ error: e.message }, 500)
    }
  }

  if (pathname === '/api/auth/register-member' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { groupId, phone, password } = body
    if (!groupId || !phone || !password) return json({ error: '组织ID、手机号和密码必填' }, 400)
    if (!/^\d{7,11}$/.test(phone)) return json({ error: '手机号必须是7-11位数字' }, 400)

    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(groupId).first()
    if (!tenant) return json({ error: '组织不存在' }, 404)

    const existing = await db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').bind(groupId, phone).first()
    if (existing) return json({ error: '该手机号已加入此组织' }, 409)

    try {
      await db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'member')")
        .bind(groupId, phone, hashPassword(password)).run()

      const cfgRow = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(groupId).first()
      const cfg = cfgRow ? JSON.parse(cfgRow.value) : JSON.parse(JSON.stringify(DEFAULT_CONFIG))
      sanitizeConfig(cfg)
      const exists = cfg.members.find(m => m.uid === phone)
      if (!exists) {
        const gid = cfg.groups[0]?.id || ''
        cfg.members.push({ id: genId('m'), name: phone, uid: phone, groupId: gid, thirdParties: [] })
      }
      await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
        .bind(groupId, JSON.stringify(cfg)).run()

      const token = genSessionToken()
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, groupId, phone, 'member', expiresAt).run()

      return json({ ok: true, tenantId: groupId, tenantName: tenant.name || groupId, username: phone, role: 'member' }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      })
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        return json({ error: '该手机号已加入此组织' }, 409)
      }
      return json({ error: e.message }, 500)
    }
  }

  if (pathname === '/api/auth/my-groups' && method === 'GET') {
    if (!session) return json({ error: 'Unauthorized' }, 401)
    if (session.role === 'superadmin') return json({ groups: [] })
    const groups = await getUserGroups(db, session.username)
    return json({ groups })
  }

  if (pathname === '/api/auth/select-group' && method === 'POST') {
    if (!session || session.role === 'superadmin') return json({ error: 'Unauthorized' }, 401)
    const body = await request.json().catch(() => ({}))
    const { groupId } = body
    if (!groupId) return json({ error: '组织ID必填' }, 400)

    const user = await db.prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?').bind(session.username, groupId).first()
    if (!user) return json({ error: '用户不属于该组织' }, 403)

    await db.prepare('UPDATE sessions SET tenant_id = ?, role = ? WHERE token = ?')
      .bind(groupId, user.role, session.token).run()

    return json({ ok: true, tenantId: groupId, role: user.role })
  }

  if (pathname === '/api/auth/profile' && method === 'POST') {
    if (!session || session.role === 'superadmin') return json({ error: 'Unauthorized' }, 401)
    const body = await request.json().catch(() => ({}))
    const { name, uid, thirdParties } = body
    if (!name || !uid) return json({ error: '姓名和手机号必填' }, 400)

    const currentUid = session.username
    const tenantId = session.tenant_id

    if (uid !== currentUid) {
      const existing = await db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').bind(tenantId, uid).first()
      if (existing) return json({ error: '该手机号已被使用' }, 409)
      await db.prepare('UPDATE users SET username = ? WHERE tenant_id = ? AND username = ?')
        .bind(uid, tenantId, currentUid).run()
      await db.prepare('UPDATE sessions SET username = ? WHERE tenant_id = ? AND username = ?')
        .bind(uid, tenantId, currentUid).run()
    }

    const cfgRow = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    const cfg = cfgRow ? JSON.parse(cfgRow.value) : JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    sanitizeConfig(cfg)
    const member = cfg.members.find(m => m.uid === currentUid)
    if (!member) return json({ error: '成员不存在' }, 404)
    member.name = name
    member.uid = uid
    member.thirdParties = Array.isArray(thirdParties) ? thirdParties : []
    await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
      .bind(tenantId, JSON.stringify(cfg)).run()

    return json({ ok: true, username: uid, memberId: member.id })
  }

  if (pathname === '/api/superadmin/login' && method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const { username, password } = body
    if (!username || !password) return json({ error: '用户名和密码必填' }, 400)

    const superAdmin = await db.prepare('SELECT * FROM super_admins WHERE username = ?').bind(username).first()
    if (!superAdmin || !verifyPassword(password, superAdmin.password_hash)) {
      return json({ error: '用户名或密码错误' }, 401)
    }

    const token = genSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare('INSERT INTO sessions (token, tenant_id, username, role, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, '__system', username, 'superadmin', expiresAt).run()
    return json({ ok: true, username, role: 'superadmin', mustChangePassword: superAdmin.must_change_password === 1 }, 200, {
      'Set-Cookie': cookieHeader(token, secure)
    })
  }

  // ── Super Admin routes ──
  const isSuperAdminRoute = pathname.startsWith('/api/superadmin/')
  if (isSuperAdminRoute) {
    if (!session || session.role !== 'superadmin') {
      return json({ error: '需要超级管理员权限' }, 403)
    }

    const sa = await db.prepare('SELECT must_change_password FROM super_admins WHERE username = ?').bind(session.username).first()
    const mustChange = sa ? sa.must_change_password === 1 : false

    if (pathname !== '/api/superadmin/change-password' && pathname !== '/api/superadmin/logout' && mustChange) {
      return json({ error: '请先修改密码' }, 403)
    }

    if (pathname === '/api/superadmin/me' && method === 'GET') {
      return json({ username: session.username, role: 'superadmin', mustChangePassword: mustChange })
    }

    if (pathname === '/api/superadmin/change-password' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const { newPassword } = body
      if (!newPassword) return json({ error: '新密码必填' }, 400)
      await db.prepare('UPDATE super_admins SET password_hash = ?, must_change_password = 0 WHERE username = ?')
        .bind(hashPassword(newPassword), session.username).run()
      return json({ ok: true })
    }

    if (pathname === '/api/superadmin/logout' && method === 'POST') {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run()
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader(secure) })
    }

    if (pathname === '/api/superadmin/tenants' && method === 'GET') {
      const { results } = await db.prepare(`
        SELECT t.id, t.name, t.created_at,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS userCount
        FROM tenants t
        ORDER BY t.created_at DESC
      `).all()
      return json(results || [])
    }

    const tenantUsersMatch = pathname.match(/^\/api\/superadmin\/tenants\/([^/]+)\/users$/)
    if (tenantUsersMatch && method === 'GET') {
      const targetTenantId = tenantUsersMatch[1]
      const { results } = await db.prepare('SELECT username, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC')
        .bind(targetTenantId).all()
      return json(results || [])
    }

    return json({ error: 'Not found' }, 404)
  }

  // ── Auth guard for tenant routes ──
  let apiKeyAuth = false
  if (!session || session.tenant_id !== tenantId) {
    const apiKey = request.headers.get('x-api-key')
    if (apiKey) {
      const stored = await getApiKey(db, tenantId)
      if (stored && stored === apiKey) {
        apiKeyAuth = true
      }
    }
    if (!apiKeyAuth) {
      return json({ error: 'Unauthorized' }, 401)
    }
  }

  await ensureTenant(db, tenantId)

  // ── Protected routes ──

  if (pathname === '/api/admin/reset-password' && method === 'POST') {
    if (apiKeyAuth) return json({ error: '需要管理员权限' }, 403)
    if (session.role !== 'admin') return json({ error: '需要管理员权限' }, 403)
    const body = await request.json().catch(() => ({}))
    const { username, newPassword } = body
    if (!username || !newPassword) return json({ error: '用户名和新密码必填' }, 400)

    const user = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').bind(tenantId, username).first()
    if (!user) return json({ error: '用户不存在' }, 404)
    if (user.is_creator) return json({ error: '组织创建者不可删除或重置密码' }, 403)

    await db.prepare('UPDATE users SET password_hash = ? WHERE tenant_id = ? AND username = ?')
      .bind(hashPassword(newPassword), tenantId, username).run()
    return json({ ok: true })
  }

  if (pathname === '/api/admin/api-key' && method === 'GET') {
    if (apiKeyAuth) return json({ error: '需要管理员权限' }, 403)
    if (session.role !== 'admin') return json({ error: '需要管理员权限' }, 403)
    const key = await getApiKey(db, tenantId)
    return json({ apiKey: key || '' })
  }

  if (pathname === '/api/admin/api-key/refresh' && method === 'POST') {
    if (apiKeyAuth) return json({ error: '需要管理员权限' }, 403)
    if (session.role !== 'admin') return json({ error: '需要管理员权限' }, 403)
    const key = await refreshApiKey(db, tenantId)
    return json({ apiKey: key })
  }

  if (pathname === '/api/config' && method === 'GET') {
    const row = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    const cfg = row ? JSON.parse(row.value) : JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    const dirty = sanitizeConfig(cfg)
    if (dirty) {
      await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
        .bind(tenantId, JSON.stringify(cfg)).run()
    }
    return json(cfg)
  }

  if (pathname === '/api/config' && method === 'POST') {
    if (apiKeyAuth) return json({ error: '需要管理员权限' }, 403)
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

  if (pathname === '/api/schedule/member' && method === 'GET') {
    const url = new URL(request.url)
    const uid = url.searchParams.get('uid')
    const phone = url.searchParams.get('phone')
    const group = url.searchParams.get('group')
    const dateStr = url.searchParams.get('date')
    const yearParam = +url.searchParams.get('year')
    const monthParam = +url.searchParams.get('month')

    if (!dateStr && (!yearParam || !monthParam)) {
      return json({ error: 'date 或 year+month 参数必填' }, 400)
    }

    let year, month, day
    if (dateStr) {
      const parts = dateStr.split('-').map(Number)
      year = parts[0]; month = parts[1]; day = parts[2]
      if (!year || !month || !day) return json({ error: 'date 格式错误，应为 YYYY-MM-DD' }, 400)
    } else {
      year = yearParam; month = monthParam
    }

    const cfgRow = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    const cfg = cfgRow ? JSON.parse(cfgRow.value) : JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    sanitizeConfig(cfg)

    let members = []
    if (group) {
      members = cfg.members.filter(m => m.groupId === group)
    } else {
      let member = null
      if (uid) {
        member = cfg.members.find(m => m.uid === uid)
      } else if (phone) {
        member = cfg.members.find(m => m.uid === phone)
      }
      if (!member) return json({ error: '成员不存在' }, 404)
      members = [member]
    }

    const memberIds = members.map(m => m.id)
    let results = []
    if (dateStr) {
      const { results: rows } = await db.prepare(
        'SELECT member_id, status_id FROM schedules WHERE tenant_id = ? AND year = ? AND month = ? AND day = ? AND member_id IN (' + memberIds.map(() => '?').join(',') + ')'
      ).bind(tenantId, year, month, day, ...memberIds).all()
      results = rows || []
    } else {
      const { results: rows } = await db.prepare(
        'SELECT member_id, day, status_id FROM schedules WHERE tenant_id = ? AND year = ? AND month = ? AND member_id IN (' + memberIds.map(() => '?').join(',') + ')'
      ).bind(tenantId, year, month, ...memberIds).all()
      results = rows || []
    }

    const scheduleMap = {}
    for (const r of results) {
      if (dateStr) {
        scheduleMap[r.member_id] = r.status_id
      } else {
        if (!scheduleMap[r.member_id]) scheduleMap[r.member_id] = {}
        scheduleMap[r.member_id][r.day] = r.status_id
      }
    }

    const buildStatus = (statusId) => {
      const s = statusId ? cfg.statuses.find(x => x.id === statusId) : null
      return s ? { id: s.id, label: s.label, short: s.short, color: s.color, timeStart: s.timeStart || '', timeEnd: s.timeEnd || '', dayCount: s.dayCount !== undefined ? s.dayCount : (s.timeStart ? 1 : 0) } : null
    }

    if (dateStr) {
      return json(members.map(member => ({
        member: { id: member.id, name: member.name, uid: member.uid, groupId: member.groupId },
        status: buildStatus(scheduleMap[member.id]),
        date: dateStr
      })))
    } else {
      const days = new Date(year, month, 0).getDate()
      return json(members.map(member => {
        const daysData = {}
        for (let d = 1; d <= days; d++) {
          daysData[d] = buildStatus(scheduleMap[member.id]?.[d])
        }
        return {
          member: { id: member.id, name: member.name, uid: member.uid, groupId: member.groupId },
          days: daysData,
          year, month
        }
      }))
    }
  }

  const dayScheduleMatch = pathname.match(/^\/api\/schedule\/day\/([0-9]{4}-[0-9]{1,2}-[0-9]{1,2})$/)
  if (dayScheduleMatch && method === 'GET') {
    const dateStr = dayScheduleMatch[1]
    const [year, month, day] = dateStr.split('-').map(Number)

    const cfgRow = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    const cfg = cfgRow ? JSON.parse(cfgRow.value) : JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    sanitizeConfig(cfg)

    const { results } = await db.prepare(
      'SELECT member_id, status_id FROM schedules WHERE tenant_id = ? AND year = ? AND month = ? AND day = ?'
    ).bind(tenantId, year, month, day).all()

    const scheduleMap = {}
    for (const r of results) {
      scheduleMap[r.member_id] = r.status_id
    }

    const buildStatus = (statusId) => {
      const s = statusId ? cfg.statuses.find(x => x.id === statusId) : null
      return s ? { id: s.id, label: s.label, short: s.short, color: s.color, timeStart: s.timeStart || '', timeEnd: s.timeEnd || '', dayCount: s.dayCount !== undefined ? s.dayCount : (s.timeStart ? 1 : 0) } : null
    }

    const data = cfg.members.map(member => {
      const statusId = scheduleMap[member.id]
      return {
        member: { id: member.id, name: member.name, uid: member.uid, groupId: member.groupId },
        status: buildStatus(statusId),
        date: dateStr
      }
    })

    return json(data)
  }

  return json({ error: 'Not found' }, 404)
}
