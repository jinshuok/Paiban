require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Subdirectory tenant rewrite (fixed-domain deployment) ──
app.use((req, res, next) => {
  const pathMatch = req.path.match(/^\/([a-zA-Z0-9-]+)(?:\/|$)/);
  if (pathMatch) {
    const possibleTenant = pathMatch[1];
    if (possibleTenant !== 'api' && !possibleTenant.startsWith('superadmin')) {
      req.tenantId = possibleTenant;
      req.url = req.url.replace(/^\/[a-zA-Z0-9-]+/, '') || '/';
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Session ──
const sessionSecret = process.env.SESSION_SECRET || (() => {
  const random = crypto.randomBytes(32).toString('hex');
  console.warn('[WARN] SESSION_SECRET not set. Using a random secret for this session.');
  return random;
})();

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

// ── Database ──
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'paiban.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables (order matters for fresh installs)
db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS super_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    is_creator INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, key)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    member_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    status_id TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, member_id, year, month, day)
  );
`);

// Migrate config table to include tenant_id (legacy -> new)
function migrateConfig() {
  const cols = db.prepare("PRAGMA table_info(config)").all();
  if (cols.some(c => c.name === 'tenant_id')) return;
  db.exec(`
    ALTER TABLE config RENAME TO config_old;
    CREATE TABLE config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, key)
    );
    INSERT INTO config (tenant_id, key, value, updated_at)
    SELECT 'default', key, value, updated_at FROM config_old;
    DROP TABLE config_old;
  `);
}

// Migrate schedules table to include tenant_id
function migrateSchedules() {
  const cols = db.prepare("PRAGMA table_info(schedules)").all();
  if (cols.some(c => c.name === 'tenant_id')) return;
  db.exec(`
    ALTER TABLE schedules RENAME TO schedules_old;
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      member_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      status_id TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, member_id, year, month, day)
    );
    INSERT INTO schedules (tenant_id, member_id, year, month, day, status_id, updated_at)
    SELECT 'default', member_id, year, month, day, status_id, updated_at FROM schedules_old;
    DROP TABLE schedules_old;
  `);
}

// Migrate legacy tenants table that included password_hash
function migrateLegacyTenants() {
  const cols = db.prepare("PRAGMA table_info(tenants)").all();
  if (!cols.some(c => c.name === 'password_hash')) return;
  const oldRows = db.prepare("SELECT tenant_id, password_hash FROM tenants").all();
  db.exec(`
    ALTER TABLE tenants RENAME TO tenants_old;
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    DROP TABLE tenants_old;
  `);
  for (const row of oldRows) {
    db.prepare("INSERT INTO tenants (tenant_id) VALUES (?)").run(row.tenant_id);
    db.prepare("INSERT OR IGNORE INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(row.tenant_id, 'admin', row.password_hash);
    console.log(`[Migrate] Tenant ${row.tenant_id} -> admin user created with existing password.`);
  }
}

// Migrate tenants to include name column
function migrateTenantsAddName() {
  const cols = db.prepare("PRAGMA table_info(tenants)").all();
  if (!cols.some(c => c.name === 'name')) {
    db.exec(`ALTER TABLE tenants ADD COLUMN name TEXT;`);
  }
  db.prepare("UPDATE tenants SET name = tenant_id WHERE name IS NULL OR name = ''").run();
}

// Migrate users table: remove UNIQUE(tenant_id, username), add is_creator
function migrateUsersSchema() {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasIsCreator = cols.some(c => c.name === 'is_creator');
  if (hasIsCreator) return;

  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      is_creator INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users_new (id, tenant_id, username, password_hash, role, is_creator, created_at)
    SELECT id, tenant_id, username, password_hash, role, CASE WHEN role = 'admin' THEN 1 ELSE 0 END, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE INDEX idx_users_username ON users(username);
  `);
  console.log('[Migrate] users table migrated to multi-group schema');
}

migrateConfig();
migrateSchedules();
migrateLegacyTenants();
migrateTenantsAddName();
migrateUsersSchema();

function seedSuperAdmin() {
  const exists = db.prepare("SELECT 1 FROM super_admins LIMIT 1").get();
  if (!exists) {
    db.prepare("INSERT INTO super_admins (username, password_hash, must_change_password) VALUES (?, ?, 1)")
      .run('admin', hashPassword('admin'));
    console.log('[Seed] Default super admin created: admin / admin');
  }
}
seedSuperAdmin();

const DEFAULT_CONFIG = {
  groups: [
    { id: 'g1', name: '销售部' },
    { id: 'g2', name: '设计部' },
    { id: 'g3', name: '技术部' },
    { id: 'g4', name: '人事部' },
  ],
  members: [
    { id: 'm1', name: '张三', uid: 'zhangsan', groupId: 'g1' },
    { id: 'm2', name: '李四', uid: 'lisi', groupId: 'g1' },
    { id: 'm3', name: '王五', uid: 'wangwu', groupId: 'g1' },
    { id: 'm4', name: '赵六', uid: 'zhaoliu', groupId: 'g2' },
    { id: 'm5', name: '孙七', uid: 'sunqi', groupId: 'g2' },
    { id: 'm6', name: '周八', uid: 'zhouba', groupId: 'g3' },
    { id: 'm7', name: '吴九', uid: 'wujiu', groupId: 'g3' },
    { id: 'm8', name: '郑十', uid: 'zhengshi', groupId: 'g4' },
    { id: 'm9', name: '钱十一', uid: 'qianshiyi', groupId: 'g4' },
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
};

const OLD_NAME_MAP = {
  '李日凤': '张三', '曹铭': '李四', '钟贵秋': '王五', '何粤灵': '赵六', '曾金梅': '孙七',
  '苏允旋': '周八', '邓大广': '吴九', '陈清梅': '郑十', '廖美凤': '钱十一', '吴慧茹': '冯十二',
  '李*凤': '张三', '曹*': '李四', '钟*秋': '王五', '何*灵': '赵六', '曾*梅': '孙七',
  '苏*旋': '周八', '邓*广': '吴九', '陈*梅': '郑十', '廖*凤': '钱十一', '吴*茹': '冯十二',
};

const OLD_UID_MAP = {
  'lirifeng': 'zhangsan', 'caoming': 'lisi', 'zhongguiqiu': 'wangwu', 'heyueling': 'zhaoliu', 'zengjinmei': 'sunqi',
  'suyunxuan': 'zhouba', 'dengdaguang': 'wujiu', 'chenqingmei': 'zhengshi', 'liaomeifeng': 'qianshiyi', 'wuhuiru': 'fengshier',
};

const OLD_GROUP_MAP = {
  '产品-数科': '销售部', '产品-供管': '设计部', '产品-销管': '技术部', '测试&运营': '人事部',
  '产品-*科': '销售部', '产品-*管': '设计部', '测试&*营': '人事部',
};

function sanitizeConfig(cfg) {
  let dirty = false;
  if (cfg.members && Array.isArray(cfg.members)) {
    for (const m of cfg.members) {
      if (OLD_NAME_MAP[m.name]) { m.name = OLD_NAME_MAP[m.name]; dirty = true; }
      if (OLD_UID_MAP[m.uid]) { m.uid = OLD_UID_MAP[m.uid]; dirty = true; }
    }
  }
  if (cfg.groups && Array.isArray(cfg.groups)) {
    for (const g of cfg.groups) {
      if (OLD_GROUP_MAP[g.name]) { g.name = OLD_GROUP_MAP[g.name]; dirty = true; }
    }
  }
  return dirty;
}

// ── Crypto ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(derived));
}

function genId(prefix) {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
}

// ── Tenant resolution ──
function resolveTenant(req, res, next) {
  // 优先从请求头读取
  const headerTenantId = req.headers['x-tenant-id'];
  if (headerTenantId) {
    req.tenantId = headerTenantId;
    return next();
  }

  // 子目录方式已由前置中间件解析
  if (req.tenantId) {
    return next();
  }

  const host = req.hostname;
  let tenantId = 'default';
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    tenantId = 'default';
  } else {
    const parts = host.split('.');
    if (parts.length >= 3) tenantId = parts[0];
  }
  req.tenantId = tenantId;
  next();
}

function requireAuth(req, res, next) {
  if (req.session && (req.session.tenantId === req.tenantId || req.session.role === 'superadmin')) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  res.status(403).json({ error: '需要管理员权限' });
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.role === 'superadmin') return next();
  res.status(403).json({ error: '需要超级管理员权限' });
}

// ── DB helpers ──
function getConfig(tenantId) {
  const row = db.prepare("SELECT value FROM config WHERE tenant_id = ? AND key = 'app_config'").get(tenantId);
  if (!row) {
    db.prepare("INSERT OR REPLACE INTO config (tenant_id, key, value) VALUES (?, 'app_config', ?)")
      .run(tenantId, JSON.stringify(DEFAULT_CONFIG));
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  const cfg = JSON.parse(row.value);
  if (sanitizeConfig(cfg)) {
    setConfig(tenantId, cfg);
  }
  return cfg;
}

function setConfig(tenantId, cfg) {
  db.prepare("INSERT OR REPLACE INTO config (tenant_id, key, value) VALUES (?, 'app_config', ?)")
    .run(tenantId, JSON.stringify(cfg));
}

function getSchedule(tenantId, year, month) {
  const rows = db.prepare(
    'SELECT member_id, day, status_id FROM schedules WHERE tenant_id = ? AND year = ? AND month = ?'
  ).all(tenantId, year, month);
  const data = {};
  for (const r of rows) {
    data[`${r.member_id}-${year}-${month}-${r.day}`] = r.status_id;
  }
  return data;
}

function saveSchedule(tenantId, year, month, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO schedules (tenant_id, member_id, year, month, day, status_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const del = db.prepare(
    'DELETE FROM schedules WHERE tenant_id = ? AND year = ? AND month = ? AND member_id = ? AND day = ?'
  );
  const trans = db.transaction(() => {
    for (const [key, statusId] of Object.entries(data)) {
      const [memberId, y, m, d] = key.split('-');
      if (+y !== year || +m !== month) continue;
      if (!statusId) {
        del.run(tenantId, year, month, memberId, +d);
      } else {
        insert.run(tenantId, memberId, year, month, +d, statusId);
      }
    }
  });
  trans();
}

function getUserGroups(username) {
  return db.prepare(`
    SELECT DISTINCT u.tenant_id AS id, t.name, u.role
    FROM users u
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE u.username = ?
    ORDER BY u.created_at DESC
  `).all(username);
}

// ── Routes ──
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/auth/status', resolveTenant, (req, res) => {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(req.tenantId);
  const hasAdmin = tenant
    ? !!db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").get(req.tenantId)
    : false;
  res.json({ tenantId: req.tenantId, tenantName: tenant?.name || req.tenantId, hasTenant: !!tenant, hasAdmin });
});

app.get('/api/auth/me', resolveTenant, (req, res) => {
  const isSuperAdmin = !!(req.session && req.session.role === 'superadmin');
  const groups = (req.session && !isSuperAdmin && req.session.username)
    ? getUserGroups(req.session.username)
    : [];
  res.json({
    tenantId: req.tenantId,
    authenticated: !!(req.session && (req.session.tenantId === req.tenantId || isSuperAdmin)),
    username: req.session?.username || null,
    role: req.session?.role || null,
    isSuperAdmin,
    mustChangePassword: req.session?.mustChangePassword || false,
    currentGroupId: req.session?.tenantId || null,
    groups,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: '手机号和密码必填' });
  if (!/^\d{7,11}$/.test(phone)) return res.status(400).json({ error: '手机号必须是7-11位数字' });

  // Check super admin first
  const superAdmin = db.prepare('SELECT * FROM super_admins WHERE username = ?').get(phone);
  if (superAdmin && verifyPassword(password, superAdmin.password_hash)) {
    req.session.tenantId = '__system';
    req.session.username = phone;
    req.session.role = 'superadmin';
    req.session.mustChangePassword = superAdmin.must_change_password === 1;
    return res.json({ ok: true, tenantId: '__system', username: phone, role: 'superadmin', isSuperAdmin: true, mustChangePassword: req.session.mustChangePassword });
  }

  const userRows = db.prepare('SELECT * FROM users WHERE username = ?').all(phone);
  if (!userRows || userRows.length === 0) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }

  let matchedUser = null;
  for (const u of userRows) {
    if (verifyPassword(password, u.password_hash)) {
      matchedUser = u;
      break;
    }
  }
  if (!matchedUser) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }

  const groups = getUserGroups(phone);
  const defaultGroupId = matchedUser.tenant_id;

  req.session.tenantId = defaultGroupId;
  req.session.username = phone;
  req.session.role = matchedUser.role;
  req.session.mustChangePassword = false;
  res.json({ ok: true, username: phone, role: matchedUser.role, isSuperAdmin: false, mustChangePassword: false, groups, defaultGroupId, tenantId: defaultGroupId });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.post('/api/auth/register-admin', (req, res) => {
  const { orgName, orgId, adminPhone, password } = req.body || {};
  if (!orgName || !orgId || !adminPhone || !password) return res.status(400).json({ error: '所有字段必填' });
  if (!/^[a-zA-Z0-9-]{5,10}$/.test(orgId)) return res.status(400).json({ error: '组织ID必须为5-10位字母、数字或连字符' });
  if (!/^\d{7,11}$/.test(adminPhone)) return res.status(400).json({ error: '手机号必须是7-11位数字' });

  const existingTenant = db.prepare('SELECT 1 FROM tenants WHERE tenant_id = ?').get(orgId);
  if (existingTenant) return res.status(409).json({ error: '组织ID已被使用' });

  const trans = db.transaction(() => {
    db.prepare('INSERT INTO tenants (tenant_id, name) VALUES (?, ?)').run(orgId, orgName);
    db.prepare("INSERT OR REPLACE INTO config (tenant_id, key, value) VALUES (?, 'app_config', ?)")
      .run(orgId, JSON.stringify(DEFAULT_CONFIG));
    db.prepare("INSERT INTO users (tenant_id, username, password_hash, role, is_creator) VALUES (?, ?, ?, 'admin', 1)")
      .run(orgId, adminPhone, hashPassword(password));
  });

  try {
    trans();
    req.session.tenantId = orgId;
    req.session.username = adminPhone;
    req.session.role = 'admin';
    req.session.mustChangePassword = false;
    res.json({ ok: true, tenantId: orgId, tenantName: orgName, username: adminPhone, role: 'admin' });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '该手机号已是此组织管理员' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/register-member', (req, res) => {
  const { groupId, phone, password } = req.body || {};
  if (!groupId || !phone || !password) return res.status(400).json({ error: '组织ID、手机号和密码必填' });
  if (!/^\d{7,11}$/.test(phone)) return res.status(400).json({ error: '手机号必须是7-11位数字' });

  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(groupId);
  if (!tenant) return res.status(404).json({ error: '组织不存在' });

  const existing = db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').get(groupId, phone);
  if (existing) return res.status(409).json({ error: '该手机号已加入此组织' });

  try {
    db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'member')")
      .run(groupId, phone, hashPassword(password));

    const cfg = getConfig(groupId);
    const exists = cfg.members.find(m => m.uid === phone);
    if (!exists) {
      const gid = cfg.groups[0]?.id || '';
      cfg.members.push({ id: genId('m'), name: phone, uid: phone, groupId: gid });
      setConfig(groupId, cfg);
    }

    req.session.tenantId = groupId;
    req.session.username = phone;
    req.session.role = 'member';
    req.session.mustChangePassword = false;
    res.json({ ok: true, tenantId: groupId, tenantName: tenant.name || groupId, username: phone, role: 'member' });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '该手机号已加入此组织' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/my-groups', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role === 'superadmin') return res.json({ groups: [] });
  const groups = getUserGroups(req.session.username);
  res.json({ groups });
});

app.post('/api/auth/select-group', (req, res) => {
  if (!req.session || req.session.role === 'superadmin') return res.status(401).json({ error: 'Unauthorized' });
  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ error: '组织ID必填' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?').get(req.session.username, groupId);
  if (!user) return res.status(403).json({ error: '用户不属于该组织' });

  req.session.tenantId = groupId;
  req.session.role = user.role;
  res.json({ ok: true, tenantId: groupId, role: user.role });
});

app.post('/api/admin/reset-password', resolveTenant, requireAuth, requireAdmin, (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword) return res.status(400).json({ error: '用户名和新密码必填' });

  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').get(req.tenantId, username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.is_creator) return res.status(403).json({ error: '组织创建者不可重置密码' });

  db.prepare('UPDATE users SET password_hash = ? WHERE tenant_id = ? AND username = ?')
    .run(hashPassword(newPassword), req.tenantId, username);
  res.json({ ok: true });
});

// ── Super Admin routes ──
app.post('/api/superadmin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const superAdmin = db.prepare('SELECT * FROM super_admins WHERE username = ?').get(username);
  if (!superAdmin || !verifyPassword(password, superAdmin.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  req.session.tenantId = '__system';
  req.session.username = username;
  req.session.role = 'superadmin';
  req.session.mustChangePassword = superAdmin.must_change_password === 1;
  res.json({ ok: true, username, role: 'superadmin', mustChangePassword: req.session.mustChangePassword });
});

app.post('/api/superadmin/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/superadmin/me', requireSuperAdmin, (req, res) => {
  const sa = db.prepare('SELECT username, must_change_password FROM super_admins WHERE username = ?').get(req.session.username);
  res.json({ username: sa.username, role: 'superadmin', mustChangePassword: sa.must_change_password === 1 });
});

app.post('/api/superadmin/change-password', requireSuperAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: '新密码必填' });
  db.prepare('UPDATE super_admins SET password_hash = ?, must_change_password = 0 WHERE username = ?')
    .run(hashPassword(newPassword), req.session.username);
  req.session.mustChangePassword = false;
  res.json({ ok: true });
});

app.get('/api/superadmin/tenants', requireSuperAdmin, (req, res) => {
  const tenants = db.prepare(`
    SELECT t.tenant_id AS id, t.name, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.tenant_id) AS userCount
    FROM tenants t
    ORDER BY t.created_at DESC
  `).all();
  res.json(tenants);
});

app.get('/api/superadmin/tenants/:tenantId/users', requireSuperAdmin, (req, res) => {
  const users = db.prepare('SELECT username, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC')
    .all(req.params.tenantId);
  res.json(users);
});

app.get('/api/config', resolveTenant, requireAuth, (req, res) => {
  res.json(getConfig(req.tenantId));
});

app.post('/api/config', resolveTenant, requireAuth, requireAdmin, (req, res) => {
  try {
    setConfig(req.tenantId, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/schedule/:year/:month', resolveTenant, requireAuth, (req, res) => {
  const { year, month } = req.params;
  res.json(getSchedule(req.tenantId, +year, +month));
});

app.post('/api/schedule/:year/:month', resolveTenant, requireAuth, (req, res) => {
  const { year, month } = req.params;
  try {
    saveSchedule(req.tenantId, +year, +month, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Catch-all SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Paiban SaaS running on http://localhost:${PORT}`);
});
