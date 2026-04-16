// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
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
};

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let year = new Date().getFullYear(), month = new Date().getMonth() + 1;
let scheduleData = {};
let filterGroup = '';
let currentModalTab = 'members';
let editGroups = [], editMembers = [], editStatuses = [];

// Desktop batch selection
let _mousedown = false;
let _dragging = false;
let selCells = new Set();
let isBatchMode = false;
let _mouseDownTime = 0;

// Mobile state
let mobileMemberIndex = 0;
let mobileFilteredMembers = [];
let mobileTouchStart = null;
let mobileLongPressTimer = null;
let mobileIsDragging = false;
let mobileIsBatchMode = false;

let configLoaded = false, dataLoaded = false;

// ═══════════════════════════════════════════════
//  TENANT / API HELPERS
// ═══════════════════════════════════════════════
function getTenantId() {
  const host = window.location.hostname;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return localStorage.getItem('tenantId') || 'default';
  }
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0];
  return 'default';
}

function apiHeaders(extra = {}) {
  const h = { ...extra };
  if (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')) {
    h['X-Tenant-Id'] = getTenantId();
  }
  return h;
}

function showTenantBadge() {
  const badge = document.getElementById('tenantBadge');
  if (!badge) return;
  const tenant = getTenantId();
  if (tenant && tenant !== 'default') {
    badge.textContent = tenant;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════
//  API / PERSISTENCE
// ═══════════════════════════════════════════════
async function loadConfig() {
  try {
    const res = await fetch('/api/config', { headers: apiHeaders() });
    if (res.ok) CONFIG = await res.json();
    else { showToast('读取配置失败，使用默认数据'); CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  } catch (e) {
    showToast('网络异常，使用离线缓存');
    const raw = localStorage.getItem('sched_config');
    CONFIG = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try { localStorage.setItem('sched_config', JSON.stringify(CONFIG)); } catch(e){}
  configLoaded = true;
  maybeInit();
}

async function saveConfig() {
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(CONFIG) });
    if (!res.ok) showToast('保存配置失败');
    else localStorage.setItem('sched_config', JSON.stringify(CONFIG));
  } catch (e) { showToast('保存配置失败（离线模式）'); }
}

function storageKey() { return `sched_${year}_${month}`; }

async function loadData() {
  try {
    const res = await fetch(`/api/schedule/${year}/${month}`, { headers: apiHeaders() });
    if (res.ok) scheduleData = await res.json();
    else { showToast('读取排班失败'); scheduleData = {}; }
  } catch (e) {
    showToast('网络异常，使用本地缓存');
    const raw = localStorage.getItem(storageKey());
    scheduleData = raw ? JSON.parse(raw) : {};
  }
  dataLoaded = true;
  maybeInit();
}

async function saveData() {
  try {
    const res = await fetch(`/api/schedule/${year}/${month}`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(scheduleData) });
    if (!res.ok) showToast('保存数据失败');
    else localStorage.setItem(storageKey(), JSON.stringify(scheduleData));
  } catch (e) { showToast('保存数据失败（离线模式）'); }
}

function maybeInit() { if (configLoaded && dataLoaded) { showTenantBadge(); render(); } }

function getStatus(id) { return CONFIG.statuses.find(s => s.id === id) || null; }

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════
const WD = ['日','一','二','三','四','五','六'];
const COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#6366f1','#ec4899','#14b8a6','#0ea5e9','#84cc16'];
function memberColor(idx) { return COLORS[idx % COLORS.length]; }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function isWeekend(y, m, d) { const wd = new Date(y,m-1,d).getDay(); return wd===0||wd===6; }
function weekdayStr(y, m, d) { return WD[new Date(y,m-1,d).getDay()]; }
function isToday(y, m, d) { const t=new Date(); return t.getFullYear()===y&&t.getMonth()+1===m&&t.getDate()===d; }
function genId(prefix) { return prefix + Date.now() + Math.random().toString(36).slice(2,6); }
function isMobile() { return window.innerWidth <= 768; }
function visibleMembers() {
  if (!filterGroup || filterGroup === '') return CONFIG.members;
  return CONFIG.members.filter(m => m.groupId === filterGroup);
}

// ═══════════════════════════════════════════════
//  RENDER ENTRY
// ═══════════════════════════════════════════════
function render() {
  renderMonthLabel();
  renderTopLegend();
  if (isMobile()) {
    renderMobileView();
    renderMobileBatchSheet();
  } else {
    renderTable();
    renderBatchPopup();
  }
}

function renderMonthLabel() {
  document.getElementById('monthLabel').textContent = `${year}-${String(month).padStart(2,'0')}`;
}

function renderTopLegend() {
  const legend = document.getElementById('topLegend');
  legend.innerHTML = CONFIG.statuses.map(s => {
    const time = s.timeStart && s.timeEnd ? ` ${s.timeStart}-${s.timeEnd}` : '';
    return `<div class="flex items-center gap-1.5 text-xs text-slate-500 hover:bg-slate-100 px-2 py-1 rounded-md cursor-pointer transition" title="${s.label}${time}">
      <span class="w-3 h-3 rounded-sm" style="background:${s.color}"></span>
      <span>${s.label}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════
//  DESKTOP TABLE
// ═══════════════════════════════════════════════
function renderTable() {
  const days = daysInMonth(year, month);
  const members = visibleMembers();

  const head = document.getElementById('tableHead');
  head.innerHTML = '';

  const nameCol = document.createElement('div');
  nameCol.className = 'w-40 min-w-[160px] shrink-0 bg-white border-r border-slate-200 stickyleft flex items-center gap-2 px-3';
  nameCol.innerHTML = `
    <span class="text-[11px] font-semibold text-slate-400 whitespace-nowrap">成员</span>
    <select id="groupFilterInline" class="flex-1 text-xs border border-slate-200 rounded-md bg-slate-50 px-2 py-1 outline-none focus:border-indigo-500">
      <option value="">全部</option>
      ${CONFIG.groups.map(g=>`<option value="${g.id}"${filterGroup===g.id?' selected':''}>${g.name}</option>`).join('')}
    </select>`;
  head.appendChild(nameCol);

  const teamCol = document.createElement('div');
  teamCol.className = 'w-20 min-w-[80px] shrink-0 flex items-center justify-center text-[11px] font-semibold text-slate-400 border-r border-slate-200 bg-white stickyleft2';
  teamCol.textContent = '团队';
  head.appendChild(teamCol);

  for (let d = 1; d <= days; d++) {
    const div = document.createElement('div');
    const we = isWeekend(year, month, d);
    const td = isToday(year, month, d);
    div.className = `w-11 min-w-[44px] shrink-0 text-center py-1.5 border-r border-slate-200 ${we?'bg-red-50/40':''} ${td?'bg-indigo-50':''}`;
    div.innerHTML = `<div class="text-xs font-semibold font-mono ${we?'text-red-500':'text-slate-700'} ${td?'text-indigo-600':''}">${d}</div>
                     <div class="text-[10px] text-slate-400">${weekdayStr(year,month,d)}</div>`;
    head.appendChild(div);
  }

  const statCol = document.createElement('div');
  statCol.className = 'w-20 min-w-[80px] shrink-0 flex items-center justify-center text-[10px] font-semibold text-slate-400 border-l-2 border-slate-200 bg-slate-50';
  statCol.textContent = '统计';
  head.appendChild(statCol);

  const body = document.getElementById('tableBody');
  body.innerHTML = '';

  members.forEach((m) => {
    const mIdx = CONFIG.members.indexOf(m);
    const group = CONFIG.groups.find(g => g.id === m.groupId);
    const row = document.createElement('div');
    row.className = 'flex items-stretch border-b border-slate-100 hover:bg-slate-50/60';

    const nc = document.createElement('div');
    nc.className = 'w-40 min-w-[160px] shrink-0 px-3 flex items-center gap-2 bg-white border-r border-slate-100 stickyleft hover:bg-slate-50/60';
    nc.innerHTML = `
      <div class="w-7 h-7 rounded-full text-white flex items-center justify-center text-xs font-semibold shrink-0" style="background:${memberColor(mIdx)}">${m.name[0]}</div>
      <div class="min-w-0"><div class="text-sm font-medium text-slate-700 truncate">${m.name}</div><div class="text-[10px] text-slate-400 truncate">${m.uid||'—'}</div></div>`;
    row.appendChild(nc);

    const tc = document.createElement('div');
    tc.className = 'w-20 min-w-[80px] shrink-0 flex items-center justify-center bg-white border-r border-slate-100 stickyleft2 hover:bg-slate-50/60 text-[11px] text-slate-400 text-center px-1 leading-tight';
    tc.textContent = group?.name || '—';
    row.appendChild(tc);

    for (let d = 1; d <= days; d++) {
      const key = cellKey(m.id, d);
      const statusId = scheduleData[key] || null;
      const st = statusId ? getStatus(statusId) : null;
      const we = isWeekend(year, month, d);
      const td = isToday(year, month, d);

      const cell = document.createElement('div');
      cell.className = `w-11 min-w-[44px] h-12 shrink-0 border-r border-slate-100 flex items-center justify-center cursor-pointer relative select-none transition-colors ${we?'bg-red-50/40':''} ${td?'bg-indigo-50':''}`;
      cell.dataset.key = key;
      cell.dataset.mid = m.id;
      cell.dataset.day = d;

      const inner = document.createElement('div');
      inner.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-transform';
      if (st) {
        inner.textContent = st.short;
        inner.style.background = st.color;
        inner.style.color = 'white';
      }
      cell.appendChild(inner);

      cell.addEventListener('mousedown', e => { if(e.button===0) onCellDown(e, cell); });
      cell.addEventListener('mouseenter', () => onCellEnter(cell));
      cell.addEventListener('click', e => onCellClick(e, cell));
      cell.addEventListener('contextmenu', e => onCellRightClick(e, cell));

      row.appendChild(cell);
    }

    const sc = document.createElement('div');
    sc.className = 'w-20 min-w-[80px] shrink-0 flex items-center justify-center px-1 border-l-2 border-slate-200 bg-slate-50 gap-1 flex-wrap';
    sc.id = `stat-${m.id}`;
    row.appendChild(sc);

    body.appendChild(row);
    updateStat(m.id);
  });

  document.getElementById('groupFilterInline').addEventListener('change', e => {
    filterGroup = e.target.value;
    clearSelection();
    render();
  });
}

function cellKey(memberId, day) { return `${memberId}-${year}-${month}-${day}`; }

// ═══════════════════════════════════════════════
//  DESKTOP BATCH SELECTION
// ═══════════════════════════════════════════════
document.addEventListener('mouseup', () => {
  const wasDragging = _dragging;
  _mousedown = false;
  if (wasDragging && selCells.size > 0) {
    setTimeout(() => { if (selCells.size > 0) showBatchPopup(); }, 50);
  }
  _dragging = false;
});

function onCellDown(e, cell) {
  if (isBatchMode) clearSelection();
  _mousedown = true;
  _dragging = false;
  _mouseDownTime = Date.now();
  if (!cell.classList.contains('selecting')) clearSelection();
  e.preventDefault();
}

function onCellEnter(cell) {
  if (!_mousedown || isBatchMode) return;
  if (!_dragging) _dragging = true;
  addToSelection(cell);
}

function onCellClick(e, cell) {
  if (isBatchMode) {
    if (!cell.classList.contains('selecting')) clearSelection();
    return;
  }
  if (_dragging) return;
  const clickDuration = Date.now() - _mouseDownTime;
  if (clickDuration > 300) return;
  const key = cell.dataset.key;
  const cur = scheduleData[key] || null;
  const cycle = getCycle();
  const ci = cycle.indexOf(cur);
  const next = cycle[(ci + 1) % cycle.length];
  applyCellStatus(cell, next);
  showToast(next ? (getStatus(next)?.label || '') : '已清空');
}

function onCellRightClick(e, cell) {
  e.preventDefault();
  clearSelection();
  addToSelection(cell);
  showBatchPopupAt(e.clientX, e.clientY);
}

function addToSelection(cell) {
  const key = cell.dataset.key;
  selCells.add(key);
  cell.classList.add('selecting');
  const inner = cell.querySelector('.cell-inner, div');
  if(inner) inner.classList.add('ring-2','ring-indigo-500','ring-offset-1','scale-110');
}

function clearSelection() {
  selCells.forEach(key => {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (el) {
      el.classList.remove('selecting');
      const inner = el.querySelector('div');
      if(inner) inner.classList.remove('ring-2','ring-indigo-500','ring-offset-1','scale-110');
    }
  });
  selCells.clear();
  hideBatchPopup();
}

// ═══════════════════════════════════════════════
//  BATCH POPUP
// ═══════════════════════════════════════════════
function renderBatchPopup() {
  const workStatuses = CONFIG.statuses.filter(s => s.timeStart && s.timeEnd);
  const restStatuses = CONFIG.statuses.filter(s => !s.timeStart || !s.timeEnd);

  document.getElementById('batchWorkBtns').innerHTML = workStatuses.map(s =>
    `<button class="batch-btn px-2.5 py-1 rounded-md text-[11px] font-semibold text-white hover:opacity-90 transition" style="background:${s.color}" data-status="${s.id}">${s.label}</button>`
  ).join('');

  document.getElementById('batchRestBtns').innerHTML = restStatuses.map(s =>
    `<button class="batch-btn px-2.5 py-1 rounded-md text-[11px] font-semibold text-white hover:opacity-90 transition" style="background:${s.color}" data-status="${s.id}">${s.label}</button>`
  ).join('') + `<button class="batch-btn px-2.5 py-1 rounded-md text-[11px] font-semibold text-white hover:opacity-90 transition bg-slate-600" data-status="__clear">清空</button>`;

  document.querySelectorAll('#batchWorkBtns .batch-btn, #batchRestBtns .batch-btn').forEach(btn => {
    btn.addEventListener('click', () => batchApply(btn.dataset.status));
  });
}

function showBatchPopup() {
  if (selCells.size === 0) return;
  isBatchMode = true;
  const popup = document.getElementById('batchPopup');
  document.getElementById('batchPopupHeader').textContent = `已选 ${selCells.size} 格`;

  const cells = Array.from(selCells).map(key => document.querySelector(`[data-key="${key}"]`)).filter(Boolean);
  if (cells.length > 0) {
    const first = cells[0].getBoundingClientRect();
    const last = cells[cells.length - 1].getBoundingClientRect();
    const centerX = (first.left + last.right) / 2;
    const centerY = (first.top + last.bottom) / 2;

    popup.classList.remove('hidden');
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    let left = centerX - pw / 2;
    let top = centerY - ph / 2;
    if (left < 10) left = 10;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (top < 60) top = 60;
    if (top + ph > window.innerHeight - 10) top = window.innerHeight - ph - 10;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }
}

function showBatchPopupAt(x, y) {
  if (selCells.size === 0) return;
  isBatchMode = true;
  document.getElementById('batchPopupHeader').textContent = `已选 ${selCells.size} 格`;
  const popup = document.getElementById('batchPopup');
  popup.classList.remove('hidden');
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = x, top = y;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (left < 10) left = 10;
  if (top + ph > window.innerHeight - 10) top = window.innerHeight - ph - 10;
  if (top < 60) top = 60;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function hideBatchPopup() {
  isBatchMode = false;
  document.getElementById('batchPopup').classList.add('hidden');
}

document.getElementById('batchCancelBtn').addEventListener('click', clearSelection);

document.addEventListener('click', e => {
  if (isBatchMode && !e.target.closest('#batchPopup') && !e.target.closest('.cell')) clearSelection();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && isBatchMode) clearSelection(); });

function batchApply(statusId) {
  selCells.forEach(key => {
    const cell = document.querySelector(`[data-key="${key}"]`);
    if (cell) applyCellStatus(cell, statusId === '__clear' ? null : statusId);
  });
  const st = statusId === '__clear' ? null : getStatus(statusId);
  showToast(`批量设置：${st ? st.label : '清空'} × ${selCells.size}`);
  clearSelection();
}

function getCycle() {
  const inCycle = CONFIG.statuses.filter(s => s.inCycle).map(s => s.id);
  return [...inCycle, null];
}

function applyCellStatus(cell, statusId) {
  const key = cell.dataset.key;
  const mid = cell.dataset.mid;
  const inner = cell.querySelector('div');
  inner.textContent = '';
  inner.style.background = '';
  inner.style.color = '';
  if (statusId) {
    const st = getStatus(statusId);
    if (st) {
      inner.textContent = st.short;
      inner.style.background = st.color;
      inner.style.color = 'white';
      scheduleData[key] = statusId;
    }
  } else {
    delete scheduleData[key];
  }
  updateStat(mid);
  saveData();
}

function updateStat(memberId) {
  const el = document.getElementById(`stat-${memberId}`);
  if (!el) return;
  const counts = {};
  CONFIG.stats.forEach(s => counts[s.countAs] = 0);
  for (const key in scheduleData) {
    if (key.startsWith(`${memberId}-${year}-${month}-`)) {
      const st = getStatus(scheduleData[key]);
      if (st) {
        const countAs = st.countAs || (st.timeStart ? 'work' : 'leave');
        if (counts[countAs] !== undefined) counts[countAs]++;
      }
    }
  }
  el.innerHTML = CONFIG.stats
    .filter(s => counts[s.countAs] > 0)
    .map(s => `<span class="text-[10px] font-semibold px-1 py-0.5 rounded" style="background:${s.color}18;color:${s.color}">${s.label}${counts[s.countAs]}</span>`)
    .join('');
}

// ═══════════════════════════════════════════════
//  MOBILE VIEW
// ═══════════════════════════════════════════════
function renderMobileView() {
  const mobileView = document.getElementById('mobileView');
  mobileView.innerHTML = '';
  const days = daysInMonth(year, month);

  mobileFilteredMembers = visibleMembers();
  if (mobileMemberIndex >= mobileFilteredMembers.length) mobileMemberIndex = 0;
  if (mobileFilteredMembers.length === 0) {
    mobileView.innerHTML = '<div class="text-center py-10 text-slate-400">暂无成员</div>';
    return;
  }

  const currentMember = mobileFilteredMembers[mobileMemberIndex];
  const mIdx = CONFIG.members.findIndex(m => m.id === currentMember.id);
  const group = CONFIG.groups.find(g => g.id === currentMember.groupId);

  // Filter
  const filterBar = document.createElement('div');
  filterBar.className = 'bg-white rounded-xl border border-slate-200 p-2.5 flex items-center gap-2';
  filterBar.innerHTML = `
    <label class="text-xs text-slate-500 whitespace-nowrap">团队</label>
    <select id="mobileGroupFilter" class="flex-1 text-sm border border-slate-200 rounded-lg bg-slate-50 px-2 py-1 outline-none focus:border-indigo-500">
      <option value="">全部成员</option>
      ${CONFIG.groups.map(g => `<option value="${g.id}"${filterGroup===g.id?' selected':''}>${g.name}</option>`).join('')}
    </select>`;
  mobileView.appendChild(filterBar);
  document.getElementById('mobileGroupFilter').addEventListener('change', e => {
    filterGroup = e.target.value;
    mobileMemberIndex = 0;
    renderMobileView();
  });

  // Member nav
  const memberNav = document.createElement('div');
  memberNav.className = 'bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between';
  memberNav.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full text-white flex items-center justify-center text-sm font-semibold" style="background:${memberColor(mIdx)}">${currentMember.name[0]}</div>
      <div>
        <div class="text-sm font-semibold text-slate-800">${currentMember.name}</div>
        <div class="text-[11px] text-slate-400">${group?.name || '—'} ${currentMember.uid ? '| ' + currentMember.uid : ''}</div>
      </div>
    </div>
    <div class="flex gap-1">
      <button id="mobilePrevMember" class="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 ${mobileMemberIndex<=0?'opacity-40 cursor-not-allowed':''}">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button id="mobileNextMember" class="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 ${mobileMemberIndex>=mobileFilteredMembers.length-1?'opacity-40 cursor-not-allowed':''}">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>`;
  mobileView.appendChild(memberNav);

  document.getElementById('mobilePrevMember')?.addEventListener('click', () => {
    if (mobileMemberIndex > 0) { mobileMemberIndex--; renderMobileView(); }
  });
  document.getElementById('mobileNextMember')?.addEventListener('click', () => {
    if (mobileMemberIndex < mobileFilteredMembers.length - 1) { mobileMemberIndex++; renderMobileView(); }
  });

  // Indicator
  const indicator = document.createElement('div');
  indicator.className = 'text-center text-xs text-slate-400';
  indicator.textContent = `${mobileMemberIndex + 1} / ${mobileFilteredMembers.length} 人`;
  mobileView.appendChild(indicator);

  // Legend
  const legendBar = document.createElement('div');
  legendBar.className = 'bg-white rounded-xl border border-slate-200 p-2 flex flex-wrap gap-2 justify-center';
  legendBar.innerHTML = CONFIG.statuses.map(s =>
    `<div class="flex items-center gap-1 text-xs text-slate-500"><span class="w-3 h-3 rounded-sm" style="background:${s.color}"></span>${s.label}</div>`
  ).join('');
  mobileView.appendChild(legendBar);

  // Calendar
  const calContainer = document.createElement('div');
  calContainer.className = 'bg-white rounded-xl border border-slate-200 overflow-hidden';

  const wdHeader = document.createElement('div');
  wdHeader.className = 'grid grid-cols-7';
  ['日','一','二','三','四','五','六'].forEach((wd, i) => {
    const h = document.createElement('div');
    h.className = `text-center py-2 text-[11px] font-semibold text-slate-400 border-b border-slate-100 bg-slate-50 ${(i===0||i===6)?'text-red-500':''}`;
    h.textContent = wd;
    wdHeader.appendChild(h);
  });
  calContainer.appendChild(wdHeader);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-7';

  const firstWd = new Date(year, month - 1, 1).getDay();
  for (let i = 0; i < firstWd; i++) {
    const empty = document.createElement('div');
    empty.className = 'aspect-square bg-slate-50/60 opacity-40 border-b border-r border-slate-100';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= days; d++) {
    const key = cellKey(currentMember.id, d);
    const statusId = scheduleData[key] || null;
    const st = statusId ? getStatus(statusId) : null;
    const we = isWeekend(year, month, d);
    const td = isToday(year, month, d);

    const dayEl = document.createElement('div');
    dayEl.className = `aspect-square flex flex-col items-center justify-center border-b border-r border-slate-100 cursor-pointer relative select-none transition active:opacity-70 ${we?'bg-red-50/30':''} ${td?'bg-indigo-50':''}`;
    dayEl.dataset.key = key;
    dayEl.dataset.mid = currentMember.id;
    dayEl.dataset.day = d;

    dayEl.innerHTML = `
      <div class="text-xs font-semibold font-mono ${we?'text-red-500':td?'text-indigo-600':'text-slate-500'}">${d}</div>
      ${st ? `<div class="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white mt-0.5" style="background:${st.color}">${st.short}</div>` : '<div class="w-6 h-6 mt-0.5"></div>'}`;

    dayEl.addEventListener('click', e => onMobileDayClick(e, dayEl));
    dayEl.addEventListener('touchstart', e => onMobileTouchStart(e, dayEl), { passive: true });
    dayEl.addEventListener('touchmove', e => onMobileTouchMove(e, dayEl), { passive: true });
    dayEl.addEventListener('touchend', e => onMobileTouchEnd(e, dayEl));

    grid.appendChild(dayEl);
  }
  calContainer.appendChild(grid);
  mobileView.appendChild(calContainer);

  // Stats
  const counts = {};
  CONFIG.stats.forEach(s => counts[s.countAs] = 0);
  for (const key in scheduleData) {
    if (key.startsWith(`${currentMember.id}-${year}-${month}-`)) {
      const st = getStatus(scheduleData[key]);
      if (st) {
        const ca = st.countAs || (st.timeStart ? 'work' : 'leave');
        if (counts[ca] !== undefined) counts[ca]++;
      }
    }
  }

  const statsDiv = document.createElement('div');
  statsDiv.className = 'bg-slate-100 rounded-xl p-3 flex flex-wrap gap-2';
  statsDiv.innerHTML = CONFIG.stats
    .filter(s => counts[s.countAs] > 0)
    .map(s => `<div class="flex items-center gap-1 text-xs"><span class="font-semibold px-1.5 py-0.5 rounded" style="background:${s.color}18;color:${s.color}">${s.label}${counts[s.countAs]}</span></div>`)
    .join('') || '<span class="text-slate-400 text-xs">暂无排班</span>';
  mobileView.appendChild(statsDiv);
}

// ═══════════════════════════════════════════════
//  MOBILE INTERACTIONS
// ═══════════════════════════════════════════════
function onMobileDayClick(e, dayEl) {
  if (mobileIsBatchMode) return;
  const key = dayEl.dataset.key;
  const cur = scheduleData[key] || null;
  const cycle = getCycle();
  const ci = cycle.indexOf(cur);
  const next = cycle[(ci + 1) % cycle.length];

  const badgeEl = dayEl.querySelector('div:last-child');
  if (next) {
    const st = getStatus(next);
    scheduleData[key] = next;
    if (badgeEl) {
      badgeEl.className = 'w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white mt-0.5';
      badgeEl.style.background = st.color;
      badgeEl.textContent = st.short;
    }
  } else {
    delete scheduleData[key];
    if (badgeEl) {
      badgeEl.className = 'w-6 h-6 mt-0.5';
      badgeEl.style.cssText = '';
      badgeEl.textContent = '';
    }
  }
  showToast(next ? (getStatus(next)?.label || '') : '已清空');
  saveData();
  updateMobileStats();
}

function onMobileTouchStart(e, dayEl) {
  if (mobileIsBatchMode) {
    addToMobileSelection(dayEl);
    updateMobileSheetCount();
    return;
  }
  mobileTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, el: dayEl, time: Date.now() };
  mobileIsDragging = false;
  mobileLongPressTimer = setTimeout(() => {
    mobileIsDragging = true;
    mobileIsBatchMode = true;
    clearMobileSelection();
    addToMobileSelection(dayEl);
    showMobileBatchSheet();
    if (navigator.vibrate) navigator.vibrate(50);
  }, 600);
}

function onMobileTouchMove(e, dayEl) {
  if (!mobileTouchStart || mobileIsBatchMode) return;
  const touch = e.touches[0];
  const dx = touch.clientX - mobileTouchStart.x;
  const dy = touch.clientY - mobileTouchStart.y;
  const distance = Math.sqrt(dx*dx + dy*dy);
  if (distance > 15) {
    clearTimeout(mobileLongPressTimer);
    if (!mobileIsDragging) {
      mobileIsDragging = true;
      mobileIsBatchMode = true;
      clearMobileSelection();
    }
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      const cell = target.closest('[data-key]');
      if (cell && !cell.classList.contains('selecting')) {
        addToMobileSelection(cell);
        updateMobileSheetCount();
      }
    }
  }
}

function onMobileTouchEnd(e, dayEl) {
  clearTimeout(mobileLongPressTimer);
  if (mobileIsDragging || mobileIsBatchMode) {
    if (selCells.size > 0) showMobileBatchSheet();
  }
  mobileTouchStart = null;
  mobileIsDragging = false;
}

function addToMobileSelection(cell) {
  const key = cell.dataset.key;
  selCells.add(key);
  cell.classList.add('selecting');
  const badge = cell.querySelector('div:last-child');
  if(badge) badge.classList.add('ring-2','ring-indigo-500','ring-offset-1');
}

function clearMobileSelection() {
  selCells.forEach(key => {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (el) {
      el.classList.remove('selecting');
      const badge = el.querySelector('div:last-child');
      if(badge) badge.classList.remove('ring-2','ring-indigo-500','ring-offset-1');
    }
  });
  selCells.clear();
  hideMobileBatchSheet();
  mobileIsBatchMode = false;
}

function updateMobileStats() {
  const currentMember = mobileFilteredMembers[mobileMemberIndex];
  if (!currentMember) return;
  const counts = {};
  CONFIG.stats.forEach(s => counts[s.countAs] = 0);
  for (const key in scheduleData) {
    if (key.startsWith(`${currentMember.id}-${year}-${month}-`)) {
      const st = getStatus(scheduleData[key]);
      if (st) {
        const ca = st.countAs || (st.timeStart ? 'work' : 'leave');
        if (counts[ca] !== undefined) counts[ca]++;
      }
    }
  }
  const statsDiv = document.querySelector('#mobileView > div:last-child');
  if (statsDiv) {
    statsDiv.innerHTML = CONFIG.stats
      .filter(s => counts[s.countAs] > 0)
      .map(s => `<div class="flex items-center gap-1 text-xs"><span class="font-semibold px-1.5 py-0.5 rounded" style="background:${s.color}18;color:${s.color}">${s.label}${counts[s.countAs]}</span></div>`)
      .join('') || '<span class="text-slate-400 text-xs">暂无排班</span>';
  }
}

// ═══════════════════════════════════════════════
//  MOBILE BATCH SHEET
// ═══════════════════════════════════════════════
function renderMobileBatchSheet() {
  const workStatuses = CONFIG.statuses.filter(s => s.timeStart && s.timeEnd);
  const restStatuses = CONFIG.statuses.filter(s => !s.timeStart || !s.timeEnd);

  document.getElementById('mobileSheetWorkBtns').innerHTML = workStatuses.map(s =>
    `<button class="mobile-sheet-btn px-3 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition" style="background:${s.color}" data-status="${s.id}">${s.label}</button>`
  ).join('');

  document.getElementById('mobileSheetRestBtns').innerHTML = restStatuses.map(s =>
    `<button class="mobile-sheet-btn px-3 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition" style="background:${s.color}" data-status="${s.id}">${s.label}</button>`
  ).join('') + `<button class="mobile-sheet-btn px-3 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition bg-slate-600" data-status="__clear">清空</button>`;

  document.querySelectorAll('#mobileSheetWorkBtns .mobile-sheet-btn, #mobileSheetRestBtns .mobile-sheet-btn').forEach(btn => {
    btn.addEventListener('click', () => mobileBatchApply(btn.dataset.status));
  });
}

function showMobileBatchSheet() {
  updateMobileSheetCount();
  document.getElementById('mobileSheetOverlay').classList.remove('hidden');
  document.getElementById('mobileBatchSheet').classList.remove('translate-y-full');
}

function hideMobileBatchSheet() {
  document.getElementById('mobileSheetOverlay').classList.add('hidden');
  document.getElementById('mobileBatchSheet').classList.add('translate-y-full');
}

function updateMobileSheetCount() {
  document.getElementById('mobileSheetCount').textContent = `已选 ${selCells.size} 格`;
}

document.getElementById('mobileSheetClose').addEventListener('click', clearMobileSelection);
document.getElementById('mobileSheetOverlay').addEventListener('click', clearMobileSelection);

function mobileBatchApply(statusId) {
  selCells.forEach(key => {
    const cell = document.querySelector(`[data-key="${key}"]`);
    if (cell) {
      const mid = cell.dataset.mid;
      const day = cell.dataset.day;
      const k = cellKey(mid, day);
      const badgeEl = cell.querySelector('div:last-child');
      if (statusId && statusId !== '__clear') {
        const st = getStatus(statusId);
        scheduleData[k] = statusId;
        if (badgeEl) {
          badgeEl.className = 'w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white mt-0.5';
          badgeEl.style.background = st.color;
          badgeEl.textContent = st.short;
        }
      } else {
        delete scheduleData[k];
        if (badgeEl) {
          badgeEl.className = 'w-6 h-6 mt-0.5';
          badgeEl.style.cssText = '';
          badgeEl.textContent = '';
        }
      }
    }
  });
  const st = statusId === '__clear' ? null : getStatus(statusId);
  showToast(`批量设置：${st ? st.label : '清空'} × ${selCells.size}`);
  saveData();
  clearMobileSelection();
  updateMobileStats();
}

// ═══════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════
document.getElementById('prevBtn').addEventListener('click', () => {
  month--; if (month < 1) { month = 12; year--; }
  clearSelection(); clearMobileSelection(); loadData();
});
document.getElementById('nextBtn').addEventListener('click', () => {
  month++; if (month > 12) { month = 1; year++; }
  clearSelection(); clearMobileSelection(); loadData();
});

let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    clearSelection(); clearMobileSelection(); render();
  }, 200);
});

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('opacity-0', '-translate-y-2');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('opacity-0', '-translate-y-2'), 1500);
}

// ═══════════════════════════════════════════════
//  SETTINGS MODAL
// ═══════════════════════════════════════════════
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('modalClose').addEventListener('click', closeSettings);
document.getElementById('modalCancel').addEventListener('click', closeSettings);
document.getElementById('modalSave').addEventListener('click', saveSettings);

document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => {
      t.classList.remove('active','bg-indigo-600','text-white');
      t.classList.add('text-slate-500');
    });
    tab.classList.add('active','bg-indigo-600','text-white');
    tab.classList.remove('text-slate-500');
    currentModalTab = tab.dataset.tab;
    renderModalTab();
  });
});
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target === document.getElementById('settingsModal')) closeSettings();
});

function openSettings() {
  editGroups = JSON.parse(JSON.stringify(CONFIG.groups));
  editMembers = JSON.parse(JSON.stringify(CONFIG.members));
  editStatuses = JSON.parse(JSON.stringify(CONFIG.statuses));
  currentModalTab = 'members';
  document.querySelectorAll('.modal-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'members');
    t.classList.toggle('bg-indigo-600', t.dataset.tab === 'members');
    t.classList.toggle('text-white', t.dataset.tab === 'members');
    t.classList.toggle('text-slate-500', t.dataset.tab !== 'members');
  });
  renderModalTab();
  document.getElementById('settingsModal').classList.remove('hidden');
  document.getElementById('settingsModal').classList.add('flex');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
  document.getElementById('settingsModal').classList.remove('flex');
}
function saveSettings() {
  CONFIG.groups = editGroups;
  CONFIG.members = editMembers;
  CONFIG.statuses = editStatuses;
  CONFIG.clickCycle = [...CONFIG.statuses.filter(s=>s.inCycle).map(s=>s.id), null];
  saveConfig();
  closeSettings();
  render();
  showToast('设置已保存 ✓');
}

function renderModalTab() {
  const body = document.getElementById('modalBody');
  if (currentModalTab === 'members') {
    body.innerHTML = renderMembersTab();
    bindMembersTab();
  } else {
    body.innerHTML = renderStatusesTab();
    bindStatusesTab();
  }
}

function renderMembersTab() {
  return `
    <table class="w-full text-sm border-collapse" id="membersTable">
      <thead>
        <tr class="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
          <th class="text-left py-2 px-2" style="width:100px">姓名</th>
          <th class="text-left py-2 px-2" style="width:110px">账号 ID</th>
          <th class="text-left py-2 px-2" style="width:140px">部门-团队</th>
          <th class="py-2 px-2" style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        ${editMembers.map((m,i) => `
          <tr data-idx="${i}" class="border-b border-slate-50 hover:bg-slate-50">
            <td class="py-1.5 px-2"><input class="m-name w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500" value="${m.name}" placeholder="姓名"></td>
            <td class="py-1.5 px-2"><input class="m-uid w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500" value="${m.uid||''}" placeholder="账号ID"></td>
            <td class="py-1.5 px-2">
              <select class="m-group w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 bg-white">${editGroups.map(g=>`<option value="${g.id}"${g.id===m.groupId?' selected':''}>${g.name}</option>`).join('')}</select>
            </td>
            <td class="py-1.5 px-2 text-center">
              <button class="del-member w-7 h-7 rounded-md border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 text-slate-400 flex items-center justify-center transition" title="删除">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    <button id="addMemberBtn" class="mt-3 w-full py-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100 transition flex items-center justify-center gap-1">+ 添加成员</button>
    <div class="mt-4 pt-4 border-t border-slate-100">
      <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">分组管理</div>
      <div id="groupsEditor" class="flex flex-wrap gap-2 items-center">
        ${editGroups.map((g,i)=>`
          <div class="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <input class="g-name text-sm bg-transparent outline-none w-24" data-idx="${i}" value="${g.name}">
            <button class="del-group w-5 h-5 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 flex items-center justify-center text-xs transition" data-idx="${i}">✕</button>
          </div>`).join('')}
        <button id="addGroupBtn" class="px-2 py-1 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100 transition">+ 分组</button>
      </div>
    </div>`;
}

function bindMembersTab() {
  function syncMembers() {
    document.querySelectorAll('#membersTable tbody tr').forEach((tr, i) => {
      if (!editMembers[i]) return;
      editMembers[i].name = tr.querySelector('.m-name').value.trim() || editMembers[i].name;
      editMembers[i].uid = tr.querySelector('.m-uid').value.trim();
      editMembers[i].groupId = tr.querySelector('.m-group').value;
    });
  }
  document.querySelectorAll('#membersTable .m-name, #membersTable .m-uid, #membersTable .m-group').forEach(el => {
    el.addEventListener('input', syncMembers);
    el.addEventListener('change', syncMembers);
  });
  document.querySelectorAll('.del-member').forEach((btn, i) => {
    btn.addEventListener('click', () => { syncMembers(); editMembers.splice(i, 1); renderModalTab(); });
  });
  document.getElementById('addMemberBtn').addEventListener('click', () => {
    syncMembers();
    editMembers.push({ id: genId('m'), name: '新成员', uid: '', groupId: editGroups[0]?.id || '' });
    renderModalTab();
  });
  document.querySelectorAll('.g-name').forEach((inp, i) => {
    inp.addEventListener('input', () => { editGroups[i].name = inp.value; });
  });
  document.querySelectorAll('.del-group').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      editGroups.splice(i, 1);
      editMembers.forEach(m => { if (!editGroups.find(g=>g.id===m.groupId)) m.groupId = editGroups[0]?.id || ''; });
      renderModalTab();
    });
  });
  document.getElementById('addGroupBtn').addEventListener('click', () => {
    editGroups.push({ id: genId('g'), name: '新分组' });
    renderModalTab();
  });
}

function renderStatusesTab() {
  return `
    <table class="w-full text-sm border-collapse" id="statusesTable">
      <thead>
        <tr class="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
          <th class="text-left py-2 px-2" style="width:90px">名称</th>
          <th class="text-left py-2 px-2" style="width:50px">缩写</th>
          <th class="text-left py-2 px-2" style="width:80px">上班开始</th>
          <th class="text-left py-2 px-2" style="width:80px">上班结束</th>
          <th class="text-left py-2 px-2" style="width:50px">颜色</th>
          <th class="text-center py-2 px-2" style="width:70px">快捷切换</th>
          <th class="py-2 px-2" style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        ${editStatuses.map((s,i) => `
          <tr data-idx="${i}" class="border-b border-slate-50 hover:bg-slate-50">
            <td class="py-1.5 px-2"><input class="s-label w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500" value="${s.label}" placeholder="名称"></td>
            <td class="py-1.5 px-2"><input class="s-short w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 text-center" value="${s.short}" placeholder="缩" maxlength="2"></td>
            <td class="py-1.5 px-2"><input class="s-ts w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 font-mono" value="${s.timeStart||''}" placeholder="09:00"></td>
            <td class="py-1.5 px-2"><input class="s-te w-full text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 font-mono" value="${s.timeEnd||''}" placeholder="18:00"></td>
            <td class="py-1.5 px-2">
              <label class="w-7 h-7 rounded-md border-2 border-slate-200 block overflow-hidden cursor-pointer" style="background:${s.color}">
                <input type="color" class="s-color w-[200%] h-[200%] -m-1/4 border-0 p-0 cursor-pointer" value="${s.color}">
              </label>
            </td>
            <td class="py-1.5 px-2 text-center"><input type="checkbox" class="s-cycle w-4 h-4 accent-indigo-600 cursor-pointer" ${s.inCycle?'checked':''} title="勾选后加入点击循环"></td>
            <td class="py-1.5 px-2 text-center">
              <button class="del-status w-7 h-7 rounded-md border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 text-slate-400 flex items-center justify-center transition" title="删除">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    <button id="addStatusBtn" class="mt-3 w-full py-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100 transition flex items-center justify-center gap-1">+ 添加状态</button>
    <div class="mt-3 text-xs text-slate-400">💡 不设置上班时间 = 不到岗（假期/调休）；勾选"快捷切换"后，点击格子可循环切换该状态。</div>`;
}

function bindStatusesTab() {
  function syncStatuses() {
    document.querySelectorAll('#statusesTable tbody tr').forEach((tr, i) => {
      if (!editStatuses[i]) return;
      editStatuses[i].label = tr.querySelector('.s-label').value.trim() || editStatuses[i].label;
      editStatuses[i].short = tr.querySelector('.s-short').value.trim() || editStatuses[i].short;
      editStatuses[i].timeStart = tr.querySelector('.s-ts').value.trim();
      editStatuses[i].timeEnd = tr.querySelector('.s-te').value.trim();
      editStatuses[i].color = tr.querySelector('.s-color').value;
      editStatuses[i].inCycle = tr.querySelector('.s-cycle').checked;
      editStatuses[i].countAs = editStatuses[i].timeStart ? 'work' : 'leave';
    });
  }
  document.querySelectorAll('#statusesTable .s-label, #statusesTable .s-short, #statusesTable .s-ts, #statusesTable .s-te').forEach(el => {
    el.addEventListener('input', syncStatuses);
  });
  document.querySelectorAll('#statusesTable .s-cycle').forEach(el => el.addEventListener('change', syncStatuses));
  document.querySelectorAll('#statusesTable .s-color').forEach((inp) => {
    inp.addEventListener('input', () => { inp.closest('label').style.background = inp.value; syncStatuses(); });
  });
  document.querySelectorAll('.del-status').forEach((btn, i) => {
    btn.addEventListener('click', () => { syncStatuses(); editStatuses.splice(i, 1); renderModalTab(); });
  });
  document.getElementById('addStatusBtn').addEventListener('click', () => {
    syncStatuses();
    editStatuses.push({ id: genId('s'), label: '新状态', short: '新', color: '#6366f1', timeStart: '', timeEnd: '', inCycle: false, countAs: 'leave' });
    renderModalTab();
  });
}

// ═══════════════════════════════════════════════
//  EXPORT EXCEL
// ═══════════════════════════════════════════════
document.getElementById('exportBtn').addEventListener('click', exportExcel);

function hexToArgb(hex) {
  const h = hex.replace('#','');
  return 'FF' + (h.length === 3 ? h.split('').map(c=>c+c).join('') : h).toUpperCase();
}

function exportExcel() {
  if (!window.XLS_LOADED) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    s.onload = () => { window.XLS_LOADED = true; doExport(); };
    s.onerror = () => showToast('加载导出库失败');
    document.head.appendChild(s);
  } else {
    doExport();
  }
}

function doExport() {
  const XLSX = window.XLSX;
  const days = daysInMonth(year, month);
  const members = visibleMembers();

  const headerRow1 = ['姓名', '账号ID', '团队'];
  const headerRow2 = ['', '', ''];
  for (let d = 1; d <= days; d++) {
    headerRow1.push(d);
    headerRow2.push(weekdayStr(year, month, d));
  }
  headerRow1.push('班', '值', '休', '假');
  headerRow2.push('', '', '', '');

  const wsData = [headerRow1, headerRow2];
  const cellStyles = {};

  headerRow1.forEach((_, ci) => {
    cellStyles[`0,${ci}`] = {
      font: { bold: true, color: { argb: 'FF1E293B' }, sz: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
    };
  });

  members.forEach((m) => {
    const group = CONFIG.groups.find(g => g.id === m.groupId);
    const row = [m.name, m.uid || '', group?.name || ''];
    const counts = { work: 0, duty: 0, rest: 0, leave: 0 };
    const ri = wsData.length;

    for (let d = 1; d <= days; d++) {
      const key = cellKey(m.id, d);
      const sid = scheduleData[key] || null;
      const st = sid ? getStatus(sid) : null;
      row.push(st ? st.short : '');
      const ci = 3 + (d - 1);
      if (st) {
        cellStyles[`${ri},${ci}`] = {
          font: { bold: true, color: { argb: 'FFFFFFFF' }, sz: 10 },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(st.color) } },
          alignment: { horizontal: 'center', vertical: 'middle' }
        };
        const ca = st.countAs || (st.timeStart ? 'work' : 'leave');
        if (counts[ca] !== undefined) counts[ca]++;
      } else {
        cellStyles[`${ri},${ci}`] = {
          fill: isWeekend(year,month,d) ? { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEF2F2' } } : undefined,
          alignment: { horizontal: 'center', vertical: 'middle' }
        };
      }
    }
    row.push(counts.work, counts.duty, counts.rest, counts.leave);
    wsData.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const sk = `${R},${C}`;
      ws[addr].s = cellStyles[sk] || { alignment: { horizontal: 'center', vertical: 'middle' } };
    }
  }
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }, ...Array(days).fill({ wch: 5 }), { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }];
  ws['!!rows'] = [{ hpt: 20 }, { hpt: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year}-${String(month).padStart(2,'0')}`);
  XLSX.writeFile(wb, `排班表_${year}-${String(month).padStart(2,'0')}.xlsx`);
  showToast('Excel 已导出 ✓');
}

// ═══════════════════════════════════════════════
//  API 接口
// ═══════════════════════════════════════════════
const ScheduleAPI = {
  getMembers() {
    return CONFIG.members.map(m => ({
      id: m.id, name: m.name, uid: m.uid,
      groupId: m.groupId, groupName: CONFIG.groups.find(g => g.id === m.groupId)?.name || ''
    }));
  },
  getMemberByUid(uid) {
    const member = CONFIG.members.find(m => m.uid === uid);
    if (!member) return null;
    const group = CONFIG.groups.find(g => g.id === member.groupId);
    return { id: member.id, name: member.name, uid: member.uid, groupId: member.groupId, groupName: group?.name || '' };
  },
  getScheduleByDate(memberId, date) {
    const [y, m, d] = date.split('-').map(Number);
    const key = `${memberId}-${y}-${m}-${d}`;
    const statusId = scheduleData[key] || null;
    return statusId ? getStatus(statusId) : null;
  },
  batchQueryByUids(uids, date) {
    return uids.map(uid => {
      const member = this.getMemberByUid(uid);
      return member ? { uid, member, schedule: date ? this.getScheduleByDate(member.id, date) : null } : { uid, member: null, schedule: null, error: 'Member not found' };
    });
  },
  getDaySchedule(date) {
    const [y, m, d] = date.split('-').map(Number);
    const suffix = `-${y}-${m}-${d}`;
    return CONFIG.members.map(member => {
      const key = member.id + suffix;
      const statusId = scheduleData[key] || null;
      const group = CONFIG.groups.find(g => g.id === member.groupId);
      return { memberId: member.id, name: member.name, uid: member.uid, groupId: member.groupId, groupName: group?.name || '', status: statusId ? getStatus(statusId) : null };
    });
  },
  getStatuses() { return CONFIG.statuses; }
};

window.ScheduleAPI = ScheduleAPI;

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
loadConfig();
loadData();
