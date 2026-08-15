const MINUTE = 60_000;

export const DEFAULT_SETTINGS = {
  googleClientId: '',
  notificationsEnabled: true,
  notificationLeadMinutes: 5,
  wakeTime: '08:00',
  bedTime: '00:30',
  bathMinutes: 30,
  skincareMinutes: 10,
  bathBeforeBedMinutes: 90,
  relaxedMinMinutes: 90,
  relaxedRatio: 0.20,
  classDayEveningCapMinutes: 60,
  buffers: {
    none: { before: 0, after: 0 },
    small: { before: 15, after: 15 },
    medium: { before: 30, after: 45 },
    large: { before: 60, after: 90 },
  },
  classKeywords: ['授業', '講義', '演習', 'ゼミ'],
  categoryRules: [
    { keywords: ['授業', '講義', '演習', 'ゼミ'], buffer: 'small' },
    { keywords: ['剣道'], buffer: 'medium' },
    { keywords: ['友達', '友人', '食事', 'ご飯'], buffer: 'large' },
  ],
};

export function deepDefaults(saved = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    buffers: {
      ...DEFAULT_SETTINGS.buffers,
      ...(saved.buffers || {}),
      small: { ...DEFAULT_SETTINGS.buffers.small, ...(saved.buffers?.small || {}) },
      medium: { ...DEFAULT_SETTINGS.buffers.medium, ...(saved.buffers?.medium || {}) },
      large: { ...DEFAULT_SETTINGS.buffers.large, ...(saved.buffers?.large || {}) },
    },
  };
}

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toMinutes(text) {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
}

export function timeLabel(minute) {
  let m = Math.round(minute);
  while (m >= 1440) m -= 1440;
  while (m < 0) m += 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesLabel(n) {
  const v = Math.max(0, Math.round(n));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (!h) return `${m}分`;
  if (!m) return `${h}時間`;
  return `${h}時間${m}分`;
}

function dayStart(day) {
  return new Date(`${day}T00:00:00`);
}

function eventMinute(dateString, day) {
  return Math.round((new Date(dateString) - dayStart(day)) / MINUTE);
}

export function eventsForDay(events, day) {
  return events.filter((e) => e.allDay ? e.start === day : dateKey(new Date(e.start)) === day);
}

function inferBuffer(event, settings) {
  if (event.bufferLevel && settings.buffers[event.bufferLevel]) return settings.buffers[event.bufferLevel];
  const title = (event.title || '').toLowerCase();
  const hit = settings.categoryRules.find((r) => r.keywords.some((k) => title.includes(k.toLowerCase())));
  return settings.buffers[hit?.buffer || 'small'];
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const x of sorted) {
    const last = merged.at(-1);
    if (!last || x.start > last.end) merged.push({ ...x });
    else last.end = Math.max(last.end, x.end);
  }
  return merged;
}

function freeIntervals(start, end, busy) {
  const out = [];
  let cursor = start;
  for (const b of busy) {
    if (b.end <= cursor || b.start >= end) continue;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out.filter((x) => x.end - x.start >= 15);
}

function daysUntil(deadline, day) {
  const a = new Date(`${day}T12:00:00`);
  const b = new Date(`${deadline.slice(0, 10)}T12:00:00`);
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

function urgency(task, day) {
  const d = daysUntil(task.deadline, day);
  const priority = { high: 1.35, medium: 1, low: 0.75 }[task.priority] || 1;
  const focus = { main: 1.45, sub: 1.05, maintain: 0.75 }[task.focus] || 1;
  const mode = task.mode === 'grow' ? 1.10 : 1;
  return (task.remainingMinutes / d) * priority * focus * mode;
}

function desiredToday(task, day, budget) {
  if (task.remainingMinutes <= 0 || budget <= 0) return 0;
  const baseline = task.remainingMinutes / daysUntil(task.deadline, day);
  const mult = { main: 1.25, sub: 1, maintain: 0.70 }[task.focus] || 1;
  const min = Number(task.minBlock || 20);
  const max = Number(task.maxBlock || 120);
  const target = Math.ceil((baseline * mult) / 5) * 5;
  return Math.min(task.remainingMinutes, budget, max, Math.max(min, target));
}

function isClassDay(events, settings) {
  const keywords = settings.classKeywords || [];
  return events.some((e) => keywords.some((k) => (e.title || '').toLowerCase().includes(k.toLowerCase())));
}

function placeTask(task, minutes, blocks) {
  const items = [];
  let remaining = minutes;
  const order = blocks.map((b, i) => ({ ...b, i }));
  if (task.timePreference === 'evening') order.sort((a, b) => b.start - a.start);
  else order.sort((a, b) => a.start - b.start);

  for (const candidate of order) {
    if (remaining <= 0) break;
    const b = blocks[candidate.i];
    const cap = b.end - b.start;
    const min = Math.min(Number(task.minBlock || 20), remaining);
    if (cap < min) continue;
    const chunk = Math.min(remaining, Number(task.maxBlock || 120), cap);
    items.push({ type: 'task', taskId: task.id, title: task.title, start: b.start, end: b.start + chunk });
    blocks[candidate.i] = { start: b.start + chunk, end: b.end };
    remaining -= chunk;
  }
  return items;
}

export function generateDayPlan({ day, tasks, events, overrides, settings }) {
  const dayEvents = eventsForDay(events, day);
  const classDay = isClassDay(dayEvents, settings);
  const wake = toMinutes(settings.wakeTime);
  let bed = toMinutes(settings.bedTime);
  if (bed <= wake) bed += 1440;

  const fixedCore = [];
  const busyForWork = [];
  const allDayPending = [];

  for (const e of dayEvents) {
    if (e.allDay) {
      const ov = overrides[e.id];
      if (!ov) {
        allDayPending.push(e);
        continue;
      }
      if (ov.kind === 'memo') continue;
      if (ov.kind === 'timed') {
        const start = toMinutes(ov.startTime);
        const end = toMinutes(ov.endTime);
        const buf = settings.buffers[ov.bufferLevel || 'small'] || settings.buffers.small;
        fixedCore.push({ type: 'event', title: e.title, start, end });
        busyForWork.push({ start: start - buf.before, end: end + buf.after });
      }
      continue;
    }
    const start = eventMinute(e.start, day);
    const end = eventMinute(e.end, day);
    const buf = inferBuffer(e, settings);
    fixedCore.push({ type: 'event', title: e.title, start, end });
    busyForWork.push({ start: start - buf.before, end: end + buf.after });
  }

  // 夜の生活基盤
  const bathEnd = bed - Number(settings.bathBeforeBedMinutes || 90);
  const bathStart = bathEnd - Number(settings.bathMinutes || 30);
  const skincareEnd = bathEnd + Number(settings.skincareMinutes || 10);
  fixedCore.push({ type: 'life', title: 'お風呂＋肌ケア', start: bathStart, end: skincareEnd });
  busyForWork.push({ start: bathStart, end: skincareEnd });

  let free = freeIntervals(wake, bed, mergeIntervals(busyForWork));
  const rawFree = free.reduce((s, b) => s + b.end - b.start, 0);
  const relaxedTarget = Math.max(Number(settings.relaxedMinMinutes || 90), rawFree * Number(settings.relaxedRatio || 0.2));
  let budget = Math.max(0, rawFree - relaxedTarget);

  // 授業日は夜の重作業を抑える
  if (classDay) {
    const lastEventEnd = Math.max(wake, ...fixedCore.filter((x) => x.type === 'event').map((x) => x.end));
    let eveningAllowance = Number(settings.classDayEveningCapMinutes || 60);
    free = free.flatMap((b) => {
      if (b.end <= lastEventEnd) return [b];
      if (b.start >= lastEventEnd) {
        const allow = Math.min(eveningAllowance, b.end - b.start);
        eveningAllowance -= allow;
        return allow >= 15 ? [{ start: b.start, end: b.start + allow }] : [];
      }
      const before = { start: b.start, end: lastEventEnd };
      const allow = Math.min(eveningAllowance, b.end - lastEventEnd);
      eveningAllowance -= allow;
      return allow >= 15 ? [before, { start: lastEventEnd, end: lastEventEnd + allow }] : [before];
    });
    budget = Math.min(budget, free.reduce((s, b) => s + b.end - b.start, 0));
  }

  const workBlocks = free.map((b) => ({ ...b }));
  const active = tasks
    .filter((t) => t.status !== 'paused' && t.remainingMinutes > 0 && t.deadline >= day)
    .sort((a, b) => urgency(b, day) - urgency(a, day));

  const planned = [];
  let remainingBudget = budget;
  for (const task of active) {
    if (remainingBudget < 15) break;
    const wanted = desiredToday(task, day, remainingBudget);
    const items = placeTask(task, wanted, workBlocks);
    const used = items.reduce((s, x) => s + x.end - x.start, 0);
    planned.push(...items);
    remainingBudget -= used;
  }

  const scheduledTaskMinutes = planned.reduce((s, x) => s + x.end - x.start, 0);
  const relaxedMinutes = Math.max(relaxedTarget, rawFree - scheduledTaskMinutes);
  const timeline = [...fixedCore, ...planned].sort((a, b) => a.start - b.start);

  return {
    classDay,
    allDayPending,
    timeline,
    rawFreeMinutes: rawFree,
    scheduledTaskMinutes,
    relaxedMinutes,
    warnings: deadlineWarnings(tasks, day),
  };
}

function deadlineWarnings(tasks, day) {
  return tasks
    .filter((t) => t.status !== 'paused' && t.remainingMinutes > 0 && t.deadline >= day)
    .map((t) => {
      const d = daysUntil(t.deadline, day);
      const perDay = t.remainingMinutes / d;
      if (perDay >= 180) return { level: 'red', text: `${t.title}: 1日平均 ${minutesLabel(perDay)} 必要。期限設定の見直し候補です。` };
      if (perDay >= 120) return { level: 'orange', text: `${t.title}: 1日平均 ${minutesLabel(perDay)} 必要。前倒し推奨です。` };
      if (perDay >= 75) return { level: 'yellow', text: `${t.title}: 1日平均 ${minutesLabel(perDay)} が必要です。` };
      return null;
    })
    .filter(Boolean);
}
