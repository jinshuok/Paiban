require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'paiban.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Init tables
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    status_id TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, year, month, day)
  );
`);

const DEFAULT_CONFIG = {
  groups: [
    { id: 'g1', name: '产品-数科' },
    { id: 'g2', name: '产品-供管' },
    { id: 'g3', name: '产品-销管' },
    { id: 'g4', name: '测试&运营' },
  ],
  members: [
    { id: 'm1', name: '李日凤', uid: 'lirifeng', groupId: 'g1' },
    { id: 'm2', name: '曹铭',   uid: 'caoming', groupId: 'g1' },
    { id: 'm3', name: '钟贵秋', uid: 'zhongguiqiu', groupId: 'g1' },
    { id: 'm4', name: '何粤灵', uid: 'heyueling', groupId: 'g2' },
    { id: 'm5', name: '曾金梅', uid: 'zengjinmei', groupId: 'g2' },
    { id: 'm6', name: '苏允旋', uid: 'suyunxuan', groupId: 'g3' },
    { id: 'm7', name: '邓大广', uid: 'dengdaguang', groupId: 'g3' },
    { id: 'm8', name: '陈清梅', uid: 'chenqingmei', groupId: 'g4' },
    { id: 'm9', name: '廖美凤', uid: 'liaomeifeng', groupId: 'g4' },
    { id: 'm10', name: '吴慧茹', uid: 'wuhuiru', groupId: 'g4' },
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

function getConfig() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'app_config'").get();
  if (!row) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_config', ?)")
      .run(JSON.stringify(DEFAULT_CONFIG));
    return DEFAULT_CONFIG;
  }
  return JSON.parse(row.value);
}

function setConfig(cfg) {
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_config', ?)")
    .run(JSON.stringify(cfg));
}

function getSchedule(year, month) {
  const rows = db.prepare(
    'SELECT member_id, day, status_id FROM schedules WHERE year = ? AND month = ?'
  ).all(year, month);
  const data = {};
  for (const r of rows) {
    data[`${r.member_id}-${year}-${month}-${r.day}`] = r.status_id;
  }
  return data;
}

function saveSchedule(year, month, data) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO schedules (member_id, year, month, day, status_id) VALUES (?, ?, ?, ?, ?)'
  );
  const del = db.prepare(
    'DELETE FROM schedules WHERE year = ? AND month = ? AND member_id = ? AND day = ?'
  );
  const trans = db.transaction(() => {
    for (const [key, statusId] of Object.entries(data)) {
      const [memberId, y, m, d] = key.split('-');
      if (+y !== year || +m !== month) continue;
      if (!statusId) {
        del.run(year, month, memberId, +d);
      } else {
        insert.run(memberId, year, month, +d, statusId);
      }
    }
  });
  trans();
}

// ── Routes ──
app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  try {
    setConfig(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/schedule/:year/:month', (req, res) => {
  const { year, month } = req.params;
  res.json(getSchedule(+year, +month));
});

app.post('/api/schedule/:year/:month', (req, res) => {
  const { year, month } = req.params;
  try {
    saveSchedule(+year, +month, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Catch-all SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Paiban SaaS running on http://localhost:${PORT}`);
});
