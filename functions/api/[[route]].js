const DEFAULT_CONFIG = {
  groups: [
    { id: 'g1', name: '产品-数科' },
    { id: 'g2', name: '产品-供管' },
    { id: 'g3', name: '产品-销管' },
    { id: 'g4', name: '测试&运营' },
  ],
  members: [
    { id: 'm1',  name: '李日凤', uid: 'lirifeng', groupId: 'g1' },
    { id: 'm2',  name: '曹铭',   uid: 'caoming', groupId: 'g1' },
    { id: 'm3',  name: '钟贵秋', uid: 'zhongguiqiu', groupId: 'g1' },
    { id: 'm4',  name: '何粤灵', uid: 'heyueling', groupId: 'g2' },
    { id: 'm5',  name: '曾金梅', uid: 'zengjinmei', groupId: 'g2' },
    { id: 'm6',  name: '苏允旋', uid: 'suyunxuan', groupId: 'g3' },
    { id: 'm7',  name: '邓大广', uid: 'dengdaguang', groupId: 'g3' },
    { id: 'm8',  name: '陈清梅', uid: 'chenqingmei', groupId: 'g4' },
    { id: 'm9',  name: '廖美凤', uid: 'liaomeifeng', groupId: 'g4' },
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
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
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

async function ensureTenant(db, tenantId) {
  const existing = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first()
  if (!existing) {
    await db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').bind(tenantId, tenantId).run()
    await db.prepare('INSERT INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
      .bind(tenantId, JSON.stringify(DEFAULT_CONFIG)).run()
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method
  const db = env.DB
  const tenantId = getTenantId(request, env)

  if (!db) {
    return json({ error: 'Database not bound' }, 500)
  }

  await ensureTenant(db, tenantId)

  // Health
  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, tenantId, time: new Date().toISOString() })
  }

  // Config
  if (pathname === '/api/config' && method === 'GET') {
    const row = await db.prepare('SELECT value FROM tenant_configs WHERE tenant_id = ?').bind(tenantId).first()
    if (!row) {
      await db.prepare('INSERT INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
        .bind(tenantId, JSON.stringify(DEFAULT_CONFIG)).run()
      return json(DEFAULT_CONFIG)
    }
    return json(JSON.parse(row.value))
  }

  if (pathname === '/api/config' && method === 'POST') {
    try {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO tenant_configs (tenant_id, value) VALUES (?, ?)')
        .bind(tenantId, JSON.stringify(body)).run()
      return json({ ok: true })
    } catch (e) {
      return json({ error: e.message }, 400)
    }
  }

  // Schedule
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
