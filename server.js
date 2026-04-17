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
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, username)
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

migrateConfig();
migrateSchedules();
migrateLegacyTenants();

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
  const host = req.hostname;
  let tenantId = 'default';
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    tenantId = req.headers['x-tenant-id'] || 'default';
  } else {
    const parts = host.split('.');
    if (parts.length >= 3) tenantId = parts[0];
  }
  req.tenantId = tenantId;
  next();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.tenantId === req.tenantId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  res.status(403).json({ error: '需要管理员权限' });
}

// ── DB helpers ──
function getConfig(tenantId) {
  const row = db.prepare("SELECT value FROM config WHERE tenant_id = ? AND key = 'app_config'").get(tenantId);
  if (!row) {
    db.prepare("INSERT OR REPLACE INTO config (tenant_id, key, value) VALUES (?, 'app_config', ?)")
      .run(tenantId, JSON.stringify(DEFAULT_CONFIG));
    return DEFAULT_CONFIG;
  }
  return JSON.parse(row.value);
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

// ── Routes ──
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/auth/status', resolveTenant, (req, res) => {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(req.tenantId);
  const hasAdmin = tenant
    ? !!db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").get(req.tenantId)
    : false;
  res.json({ tenantId: req.tenantId, hasTenant: !!tenant, hasAdmin });
});

app.get('/api/auth/me', resolveTenant, (req, res) => {
  res.json({
    tenantId: req.tenantId,
    authenticated: !!(req.session && req.session.tenantId === req.tenantId),
    username: req.session?.username || null,
    role: req.session?.role || null,
  });
});

app.post('/api/auth/login', resolveTenant, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').get(req.tenantId, username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  req.session.tenantId = req.tenantId;
  req.session.username = username;
  req.session.role = user.role;
  res.json({ ok: true, tenantId: req.tenantId, username, role: user.role });
});

app.post('/api/auth/logout', resolveTenant, (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.post('/api/auth/register-admin', resolveTenant, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const tenantExists = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(req.tenantId);
  if (tenantExists) {
    const hasAdmin = db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND role = 'admin' LIMIT 1").get(req.tenantId);
    if (hasAdmin) return res.status(409).json({ error: '该租户已存在管理员' });
  } else {
    db.prepare('INSERT INTO tenants (tenant_id) VALUES (?)').run(req.tenantId);
  }

  try {
    db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(req.tenantId, username, hashPassword(password));
    req.session.tenantId = req.tenantId;
    req.session.username = username;
    req.session.role = 'admin';
    res.json({ ok: true, tenantId: req.tenantId, username, role: 'admin' });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '用户名已被注册' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/register-member', resolveTenant, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(req.tenantId);
  if (!tenant) return res.status(404).json({ error: '租户不存在' });

  try {
    db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, 'member')")
      .run(req.tenantId, username, hashPassword(password));

    const cfg = getConfig(req.tenantId);
    const exists = cfg.members.find(m => m.uid === username);
    if (!exists) {
      const gid = cfg.groups[0]?.id || '';
      cfg.members.push({ id: genId('m'), name: username, uid: username, groupId: gid });
      setConfig(req.tenantId, cfg);
    }

    req.session.tenantId = req.tenantId;
    req.session.username = username;
    req.session.role = 'member';
    res.json({ ok: true, tenantId: req.tenantId, username, role: 'member' });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '用户名已被注册' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/reset-password', resolveTenant, requireAuth, requireAdmin, (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword) return res.status(400).json({ error: '用户名和新密码必填' });

  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').get(req.tenantId, username);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  db.prepare('UPDATE users SET password_hash = ? WHERE tenant_id = ? AND username = ?')
    .run(hashPassword(newPassword), req.tenantId, username);
  res.json({ ok: true });
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
