import { DEFAULT_SETTINGS, deepDefaults, dateKey, generateDayPlan, minutesLabel, timeLabel } from './scheduler.js';

const K = (name) => `lifeos:${name}`;
const load = (name, fallback) => {
  try { return JSON.parse(localStorage.getItem(K(name))) ?? fallback; }
  catch { return fallback; }
};
const save = (name, value) => localStorage.setItem(K(name), JSON.stringify(value));
const esc = (s = '') => String(s).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

let tasks = load('tasks', []);
let events = load('events', []);
let overrides = load('overrides', {});
let settings = deepDefaults(load('settings', DEFAULT_SETTINGS));
let dayModes = load('dayModes', {});
let activityLog = load('activityLog', []);
let planSnapshots = load('planSnapshots', {});
let selectedDay = dateKey();
let accessToken = '';
let accessTokenExpiresAt = 0;
const GOOGLE_SESSION_KEY = 'lifeos:googleAuthSession';

const $ = (id) => document.getElementById(id);
const isNativeIOS = () => Boolean(window.webkit?.messageHandlers?.lifeOSNative);

function postNative(message) {
  if (!isNativeIOS()) return false;
  window.webkit.messageHandlers.lifeOSNative.postMessage(message);
  return true;
}

function syncNativePlan(plan) {
  if (!isNativeIOS() || selectedDay !== dateKey()) return;
  postNative({
    type: 'syncPlan',
    payload: {
      day: selectedDay,
      classDay: plan.classDay,
      scheduledTaskMinutes: plan.scheduledTaskMinutes,
      relaxedMinutes: Math.round(plan.relaxedMinutes),
      notificationLeadMinutes: Number(settings.notificationLeadMinutes || 5),
      notificationsEnabled: settings.notificationsEnabled !== false,
      timeline: plan.timeline.map(x => ({
        title: x.title, type: x.type, startMinute: Math.round(x.start), endMinute: Math.round(x.end)
      }))
    }
  });
}

window.lifeOSReceiveCalendarEvents = (incoming) => {
  events = Array.isArray(incoming) ? incoming : [];
  persist(); updateGoogleButton('接続済み'); renderToday(); notice(`${events.length}件の予定を取得しました。`);
};

window.lifeOSNativeNotice = (text) => notice(text);

function persist() {
  save('tasks', tasks); save('events', events); save('overrides', overrides); save('settings', settings); save('dayModes', dayModes); save('activityLog', activityLog); save('planSnapshots', planSnapshots);
}

function notice(text) {
  const box = $('notice');
  box.textContent = text; box.classList.remove('hidden');
  setTimeout(() => box.classList.add('hidden'), 6000);
}

function render() {
  renderToday(); renderTasks(); renderHistory(); renderSettings();
}

function saveTodaySnapshot(plan, manualMode) {
  if (selectedDay !== dateKey()) return;
  planSnapshots[selectedDay] = {
    date: selectedDay,
    updatedAt: new Date().toISOString(),
    manualMode,
    classDay: plan.classDay,
    scheduledTaskMinutes: Math.round(plan.scheduledTaskMinutes),
    relaxedMinutes: Math.round(plan.relaxedMinutes),
    rawFreeMinutes: Math.round(plan.rawFreeMinutes),
    timeline: plan.timeline.map((x) => ({ type: x.type, taskId: x.taskId || null, title: x.title, start: Math.round(x.start), end: Math.round(x.end) })),
  };
  save('planSnapshots', planSnapshots);
}

function dayModeLabel(snapshot, date) {
  const manual = snapshot?.manualMode || dayModes[date] || 'auto';
  if (manual === 'class') return '授業日（手動）';
  if (manual === 'noClass') return '授業なし日（手動）';
  if (snapshot) return snapshot.classDay ? '授業日（自動）' : '授業なし日（自動）';
  return '記録のみ';
}

function formatHistoryDate(day) {
  return day.replaceAll('-', '/');
}

function renderHistory() {
  const dates = [...new Set([...Object.keys(planSnapshots), ...activityLog.map((a) => a.date)])].sort().reverse();
  const cards = dates.map((day) => {
    const snap = planSnapshots[day];
    const logs = activityLog.filter((a) => a.date === day).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
    const completedTask = logs.filter((a) => a.kind === 'task').reduce((sum, a) => sum + Number(a.minutes || 0), 0);
    const lifeLogs = logs.filter((a) => a.kind === 'life');
    const entries = logs.map((a) => `<div class="history-entry"><span>${a.kind === 'life' ? '生活' : '作業'}</span><strong>${esc(a.title)}</strong><small>${minutesLabel(a.minutes || 0)} ・ ${new Date(a.completedAt).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'})}</small></div>`).join('');
    return `<div class="history-day">
      <div class="row between"><div><strong class="history-date">${formatHistoryDate(day)}</strong><small class="history-mode">${esc(dayModeLabel(snap, day))}</small></div><span class="history-life ${lifeLogs.length ? 'done' : ''}">${lifeLogs.length ? '生活ケア完了' : '生活ケア記録なし'}</span></div>
      <div class="history-metrics"><div><span>予定作業</span><strong>${minutesLabel(snap?.scheduledTaskMinutes || 0)}</strong></div><div><span>完了作業</span><strong>${minutesLabel(completedTask)}</strong></div><div><span>ゆったり予定</span><strong>${minutesLabel(snap?.relaxedMinutes || 0)}</strong></div></div>
      <div class="history-entries">${entries || '<p class="muted">完了記録はありません。</p>'}</div>
    </div>`;
  }).join('');

  $('historyTab').innerHTML = `<div class="stack">
    <section class="card"><p class="eyebrow">HISTORY</p><h2>これまでの記録</h2><p class="muted">「完了」を押した作業・生活ケアと、その日の最新の達成予定を端末内に保存します。</p>
      <div class="backup-actions"><button id="exportBackup" class="primary small">バックアップを書き出す</button><label class="file-button">バックアップを読み込む<input id="importBackup" type="file" accept="application/json,.json"></label></div>
      <p class="muted">記録はこの端末のブラウザ内に保存されます。機種変更やデータ消去に備えて、ときどきJSONバックアップを書き出してください。</p>
    </section>
    <section class="card"><div class="history-list">${cards || '<p class="muted">まだ記録がありません。今日の予定で「完了」を押すとここに残ります。</p>'}</div></section>
  </div>`;

  $('exportBackup').addEventListener('click', exportBackup);
  $('importBackup').addEventListener('change', importBackup);
}

function exportBackup() {
  const data = {
    version: '0.4', exportedAt: new Date().toISOString(),
    tasks, events, overrides, settings, dayModes, activityLog, planSnapshots,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `life-os-backup-${dateKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('バックアップを書き出しました。');
}

async function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object') throw new Error('バックアップ形式が正しくありません。');
    if (!confirm('現在のLife OSデータを、このバックアップの内容で置き換えますか？')) { e.target.value = ''; return; }
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    events = Array.isArray(data.events) ? data.events : [];
    overrides = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
    settings = deepDefaults(data.settings || DEFAULT_SETTINGS);
    dayModes = data.dayModes && typeof data.dayModes === 'object' ? data.dayModes : {};
    activityLog = Array.isArray(data.activityLog) ? data.activityLog : [];
    planSnapshots = data.planSnapshots && typeof data.planSnapshots === 'object' ? data.planSnapshots : {};
    persist(); render(); updateGoogleButton(accessToken ? '接続済み' : '未接続'); notice('バックアップを復元しました。');
  } catch (err) {
    notice(`読み込めませんでした：${err.message}`);
  } finally { e.target.value = ''; }
}

function renderToday() {
  const manualMode = dayModes[selectedDay] || 'auto';
  const plan = generateDayPlan({ day: selectedDay, tasks, events, overrides, settings, classDayOverride: manualMode });
  saveTodaySnapshot(plan, manualMode);
  const current = new Date();
  const nowMin = current.getHours() * 60 + current.getMinutes();
  const next = plan.timeline.find((x) => x.end > nowMin) || plan.timeline[0];
  const warnings = plan.warnings.map((w) => `<p class="warning ${w.level}">● ${esc(w.text)}</p>`).join('');
  const pending = plan.allDayPending.map((e) => `
    <div class="resolver" data-event-id="${esc(e.id)}">
      <strong>${esc(e.title)}</strong>
      <p class="muted">終日予定は自動では一日拘束にしません。</p>
      <div class="segmented">
        <button class="selected" data-kind="timed">実時間あり</button>
        <button data-kind="memo">予定メモ</button>
      </div>
      <div class="resolver-fields form-grid compact">
        <label>開始<input type="time" class="all-start" value="13:00"></label>
        <label>終了<input type="time" class="all-end" value="15:00"></label>
        <label>時間考慮<select class="all-buffer"><option value="none">なし</option><option value="small">小</option><option value="medium" selected>中</option><option value="large">大</option></select></label>
      </div>
      <button class="primary small resolve-save">確定</button>
    </div>`).join('');

  const timeline = plan.timeline.map((x) => {
    const mins = x.end - x.start;
    const completionKey = `${x.type}:${x.taskId || x.title}:${Math.round(x.start)}:${Math.round(x.end)}`;
    const recorded = activityLog.some((a) => a.date === selectedDay && a.key === completionKey);
    const canComplete = x.type === 'task' || x.type === 'life';
    const done = canComplete ? (recorded
      ? '<span class="done-mark">完了済み</span>'
      : `<button class="done-btn" data-task-id="${esc(x.taskId || '')}" data-mins="${mins}" data-kind="${x.type}" data-title="${esc(x.title)}" data-key="${esc(completionKey)}">完了</button>`) : '';
    return `<div class="timeline-item ${x.type}">
      <div class="time">${timeLabel(x.start)}<br><span>${timeLabel(x.end)}</span></div>
      <div class="timeline-body"><strong>${esc(x.title)}</strong><small>${minutesLabel(mins)}</small></div>${done}</div>`;
  }).join('');

  $('todayTab').innerHTML = `
    <div class="stack">
      <section class="hero-card">
        <div class="row between">
          <div><p class="eyebrow">TODAY</p><input id="dayPicker" class="date-input" type="date" value="${selectedDay}"></div>
          <label class="mode-select-wrap">日モード<select id="dayModeSelect" class="mode-select ${plan.classDay ? 'class' : ''}"><option value="auto" ${manualMode === 'auto' ? 'selected' : ''}>自動判定</option><option value="class" ${manualMode === 'class' ? 'selected' : ''}>授業日</option><option value="noClass" ${manualMode === 'noClass' ? 'selected' : ''}>授業なし日</option></select></label>
        </div>
        <div class="metrics">
          <div><span>予定した作業</span><strong>${minutesLabel(plan.scheduledTaskMinutes)}</strong></div>
          <div><span>ゆったり時間</span><strong>${minutesLabel(plan.relaxedMinutes)}</strong></div>
        </div>
        <div class="next-action"><p>NEXT ACTION</p>${next ? `<h2>${esc(next.title)}</h2><strong>${timeLabel(next.start)}–${timeLabel(next.end)}</strong>` : '<h2>今日はもう予定なし</h2>'}</div>
      </section>
      ${warnings ? `<section class="card warning-card"><h3>期限チェック</h3>${warnings}</section>` : ''}
      ${pending ? `<section class="card"><h3>終日予定を確認</h3>${pending}</section>` : ''}
      <section class="card"><h3>今日の達成予定</h3><div class="timeline">${timeline || '<p class="muted">予定・課題がまだありません。</p>'}</div><div class="relaxed-band">ゆったり時間　${minutesLabel(plan.relaxedMinutes)}</div>
      ${!isNativeIOS() ? '<button id="syncPlanCalendar" class="primary">Google Calendarへ同期（通知）</button><p class="muted">Life OSが作った「課題」と「お風呂＋肌ケア」だけをGoogle Calendarに作成します。再同期時はLife OSが以前作った同日の予定だけを置き換えます。</p>' : ''}</section>
    </div>`;

  $('dayPicker').addEventListener('change', (e) => { selectedDay = e.target.value; renderToday(); });
  $('dayModeSelect').addEventListener('change', (e) => {
    if (e.target.value === 'auto') delete dayModes[selectedDay];
    else dayModes[selectedDay] = e.target.value;
    persist(); renderToday(); renderHistory();
  });
  document.querySelectorAll('.done-btn').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.taskId; const mins = Number(b.dataset.mins); const kind = b.dataset.kind;
    if (activityLog.some((a) => a.date === selectedDay && a.key === b.dataset.key)) return;
    if (kind === 'task' && id) tasks = tasks.map((t) => t.id === id ? { ...t, remainingMinutes: Math.max(0, t.remainingMinutes - mins) } : t);
    activityLog.unshift({ id: uid(), date: selectedDay, completedAt: new Date().toISOString(), kind, taskId: id || null, title: b.dataset.title, minutes: mins, key: b.dataset.key });
    persist(); render();
  }));

  document.querySelectorAll('.resolver').forEach((r) => {
    let kind = 'timed';
    r.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      r.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('selected', x === b));
      r.querySelector('.resolver-fields').classList.toggle('hidden', kind === 'memo');
    }));
    r.querySelector('.resolve-save').addEventListener('click', () => {
      const id = r.dataset.eventId;
      overrides[id] = kind === 'memo' ? { kind: 'memo' } : {
        kind: 'timed',
        startTime: r.querySelector('.all-start').value,
        endTime: r.querySelector('.all-end').value,
        bufferLevel: r.querySelector('.all-buffer').value,
      };
      persist(); renderToday();
    });
  });
  if ($('syncPlanCalendar')) $('syncPlanCalendar').addEventListener('click', () => syncPlanToGoogleCalendar(plan));
  syncNativePlan(plan);
}

function renderTasks() {
  const rows = tasks.map((t) => `<div class="task-row"><div><strong>${esc(t.title)}</strong><small>期限 ${esc(t.deadline)} ・ 残り ${minutesLabel(t.remainingMinutes)}</small></div><span class="tag ${t.focus}">${t.focus === 'main' ? 'メイン' : t.focus === 'sub' ? 'サブ' : '維持'}</span><button class="icon-btn delete-task" data-id="${t.id}">削除</button></div>`).join('');
  $('tasksTab').innerHTML = `
  <div class="stack">
    <section class="card"><p class="eyebrow">NEW TASK</p><h2>課題を登録</h2>
      <form id="taskForm" class="form-grid">
        <label class="span2">課題名<input name="title" required placeholder="例：IELTS Reading"></label>
        <label>期限<input type="date" name="deadline" required></label>
        <label>残り必要量（分）<input type="number" name="remainingMinutes" min="5" value="120" required></label>
        <label>優先度<select name="priority"><option value="high">高</option><option value="medium" selected>中</option><option value="low">低</option></select></label>
        <label>重点<select name="focus"><option value="main">メイン</option><option value="sub">サブ</option><option value="maintain">維持</option></select></label>
        <label>領域<select name="mode"><option value="grow">伸ばす</option><option value="maintain">維持</option></select></label>
        <label>時間帯<select name="timePreference"><option value="any">いつでも</option><option value="morning">朝優先</option><option value="evening">夜優先</option></select></label>
        <label>1回最小（分）<input type="number" name="minBlock" value="20"></label>
        <label>1回最大（分）<input type="number" name="maxBlock" value="120"></label>
        <button class="primary span2">登録</button>
      </form></section>
    <section class="card"><h3>登録済み</h3><div class="task-list">${rows || '<p class="muted">まだ課題がありません。</p>'}</div></section>
  </div>`;
  $('taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    tasks.push({ id: uid(), title: d.title, deadline: d.deadline, remainingMinutes: Number(d.remainingMinutes), priority: d.priority, focus: d.focus, mode: d.mode, minBlock: Number(d.minBlock), maxBlock: Number(d.maxBlock), timePreference: d.timePreference, status: 'active' });
    persist(); render();
  });
  document.querySelectorAll('.delete-task').forEach((b) => b.addEventListener('click', () => { tasks = tasks.filter((t) => t.id !== b.dataset.id); persist(); render(); }));
}

function renderSettings() {
  const bufferCard = (key, label) => `<div class="buffer-card"><strong>${label}</strong><label>前<input type="number" data-setting="buffers.${key}.before" value="${settings.buffers[key].before}"></label><label>後<input type="number" data-setting="buffers.${key}.after" value="${settings.buffers[key].after}"></label></div>`;
  $('settingsTab').innerHTML = `
  <div class="stack">
    <section class="card"><h2>Google Calendar</h2>${isNativeIOS() ? '<p class="muted">iPhoneアプリ版ではネイティブGoogleログインを使います。上部のGoogle Calendarボタンから接続してください。</p>' : `<label>Google OAuth Web Client ID<input id="clientIdInput" value="${esc(settings.googleClientId)}" placeholder="...apps.googleusercontent.com"></label><p class="muted">Calendar APIは予定の読み取りと、Life OSが生成した予定の書き込みに使います。Client Secretは入力しません。</p><button id="saveClientId" class="primary small">Client IDを保存</button>`}</section>
    <section class="card"><h2>通知</h2><div class="form-grid"><label>開始何分前に通知<input type="number" min="0" max="120" data-setting="notificationLeadMinutes" value="${settings.notificationLeadMinutes}"></label></div>${isNativeIOS() ? '<button id="enableNotifications" class="primary small">iPhone通知を有効にする</button><button id="testNotification" class="secondary small">テスト通知</button>' : '<p class="muted">iPhoneアプリ版では予定開始・お風呂の通知を端末側で予約します。</p>'}</section>
    <section class="card"><h2>生活設定</h2><div class="form-grid">
      <label>起床<input type="time" data-setting="wakeTime" value="${settings.wakeTime}"></label>
      <label>就寝<input type="time" data-setting="bedTime" value="${settings.bedTime}"></label>
      <label>最低ゆったり時間（分）<input type="number" data-setting="relaxedMinMinutes" value="${settings.relaxedMinMinutes}"></label>
      <label>ゆったり比率（0〜1）<input type="number" step="0.05" min="0" max="0.7" data-setting="relaxedRatio" value="${settings.relaxedRatio}"></label>
      <label>お風呂（分）<input type="number" data-setting="bathMinutes" value="${settings.bathMinutes}"></label>
      <label>肌ケア（分）<input type="number" data-setting="skincareMinutes" value="${settings.skincareMinutes}"></label>
      <label>就寝何分前までに入浴終了<input type="number" data-setting="bathBeforeBedMinutes" value="${settings.bathBeforeBedMinutes}"></label>
      <label>授業日の夜作業上限（分）<input type="number" data-setting="classDayEveningCapMinutes" value="${settings.classDayEveningCapMinutes}"></label>
    </div></section>
    <section class="card"><h2>時間考慮プリセット</h2><div class="buffer-grid">${bufferCard('small','小')}${bufferCard('medium','中')}${bufferCard('large','大')}</div><p class="muted">予定本体は正確な時間で保持し、前後の準備・移動・不明確な延長だけを別に確保します。</p></section>
    <section class="card"><h2>授業日判定</h2><label>判定キーワード（カンマ区切り）<input id="classKeywords" value="${esc(settings.classKeywords.join(','))}"></label><button id="saveKeywords" class="primary small">保存</button></section>
  </div>`;

  document.querySelectorAll('[data-setting]').forEach((el) => el.addEventListener('change', () => {
    const path = el.dataset.setting.split('.');
    let obj = settings;
    for (const k of path.slice(0, -1)) obj = obj[k];
    obj[path.at(-1)] = el.type === 'number' ? Number(el.value) : el.value;
    persist(); renderToday();
  }));
  if ($('saveClientId')) $('saveClientId').addEventListener('click', () => { settings.googleClientId = $('clientIdInput').value.trim(); persist(); notice('Google Client IDを保存しました。'); updateGoogleButton(); });
  if ($('enableNotifications')) $('enableNotifications').addEventListener('click', () => postNative({ type: 'enableNotifications' }));
  if ($('testNotification')) $('testNotification').addEventListener('click', () => postNative({ type: 'testNotification' }));
  $('saveKeywords').addEventListener('click', () => { settings.classKeywords = $('classKeywords').value.split(',').map((x) => x.trim()).filter(Boolean); persist(); notice('授業日判定キーワードを保存しました。'); renderToday(); });
}


function dateAtMinute(day, minute) {
  const d = new Date(`${day}T00:00:00`);
  d.setMinutes(minute);
  return d;
}

async function calendarRequest(url, options = {}) {
  if (!accessToken) throw new Error('先にGoogle Calendarへ接続してください。');
  const headers = { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function syncPlanToGoogleCalendar(plan) {
  if (!accessToken) return notice('先に右上の「Google Calendar」から接続してください。');
  const button = $('syncPlanCalendar');
  if (button) { button.disabled = true; button.textContent = '同期中…'; }
  try {
    const dayStart = new Date(`${selectedDay}T00:00:00`);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const params = new URLSearchParams({
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: 'true',
      maxResults: '250',
      privateExtendedProperty: `lifeOSDay=${selectedDay}`,
    });
    const existing = await calendarRequest(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
    const oldItems = (existing.items || []).filter((e) => e.extendedProperties?.private?.lifeOSGenerated === 'true');
    await Promise.all(oldItems.map((e) => calendarRequest(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(e.id)}`, { method: 'DELETE' })));

    const generated = plan.timeline.filter((x) => x.type === 'task' || x.type === 'life');
    const lead = Math.max(0, Math.min(120, Number(settings.notificationLeadMinutes || 5)));
    for (const x of generated) {
      const body = {
        summary: `Life OS｜${x.title}`,
        description: x.type === 'task' ? 'Life OSが自動生成した今日の達成予定' : 'Life OSの生活最低ライン',
        start: { dateTime: dateAtMinute(selectedDay, x.start).toISOString(), timeZone: 'Asia/Tokyo' },
        end: { dateTime: dateAtMinute(selectedDay, x.end).toISOString(), timeZone: 'Asia/Tokyo' },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: lead }] },
        extendedProperties: { private: { lifeOSGenerated: 'true', lifeOSDay: selectedDay, lifeOSType: x.type } },
      };
      await calendarRequest('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
    }
    notice(`${generated.length}件をGoogle Calendarへ同期しました。通知は${lead}分前です。`);
  } catch (e) {
    notice(`同期できませんでした：${e.message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Google Calendarへ同期（通知）'; }
  }
}

function updateGoogleButton(status = '未接続') {
  if (isNativeIOS()) {
    $('googleConnect').innerHTML = `Google Calendar<br><span>${status}</span>`;
    $('googleConnect').disabled = false;
    return;
  }
  $('googleConnect').innerHTML = `Google Calendar<br><span>${settings.googleClientId ? status : 'Client ID未設定'}</span>`;
  $('googleConnect').disabled = !settings.googleClientId;
}

async function fetchGoogleEvents() {
  if (!accessToken) throw new Error('Google Calendarに接続されていません。');
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate() + 30);
  const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '500' });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) {
    accessToken = '';
    accessTokenExpiresAt = 0;
    sessionStorage.removeItem(GOOGLE_SESSION_KEY);
    updateGoogleButton('再接続が必要');
    throw new Error('Googleの接続期限が切れました。右上から再接続してください。');
  }
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  events = (data.items || []).filter((e) => e.extendedProperties?.private?.lifeOSGenerated !== 'true').map((e) => {
    const allDay = Boolean(e.start?.date && !e.start?.dateTime);
    return { id: e.id, title: e.summary || '（無題）', allDay, start: allDay ? e.start.date : e.start?.dateTime, end: allDay ? e.end?.date : e.end?.dateTime, location: e.location || '' };
  });
  persist(); updateGoogleButton('接続済み'); renderToday();
  return events.length;
}

function restoreGoogleSession() {
  if (isNativeIOS()) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(GOOGLE_SESSION_KEY) || 'null');
    if (!saved?.accessToken || !saved?.expiresAt || saved.expiresAt <= Date.now() + 60000) {
      sessionStorage.removeItem(GOOGLE_SESSION_KEY);
      return;
    }
    accessToken = saved.accessToken;
    accessTokenExpiresAt = saved.expiresAt;
    updateGoogleButton('接続済み');
    fetchGoogleEvents().catch((e) => notice(e.message));
  } catch {
    sessionStorage.removeItem(GOOGLE_SESSION_KEY);
  }
}

async function connectGoogle() {
  if (isNativeIOS()) {
    updateGoogleButton('接続中…');
    postNative({ type: 'connectGoogle' });
    return;
  }
  if (!settings.googleClientId) return notice('設定画面でGoogle OAuth Web Client IDを入力してください。');
  try {
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Servicesの読み込みが未完了です。数秒後にもう一度押してください。');
    const response = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: settings.googleClientId,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: (r) => r.error ? reject(new Error(r.error)) : resolve(r),
      });
      client.requestAccessToken({ prompt: '' });
    });
    accessToken = response.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in || 3600)) * 1000;
    sessionStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify({ accessToken, expiresAt: accessTokenExpiresAt }));
    updateGoogleButton('取得中…');
    const count = await fetchGoogleEvents();
    notice(`${count}件の予定を取得しました。`);
  } catch (e) {
    updateGoogleButton('接続エラー'); notice(e.message);
  }
}

function setupTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-panel').forEach((x) => x.classList.add('hidden'));
    $(`${b.dataset.tab}Tab`).classList.remove('hidden');
  }));
}

$('googleConnect').addEventListener('click', connectGoogle);
setupTabs(); updateGoogleButton(); render(); restoreGoogleSession();
