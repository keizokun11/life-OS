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
  morningTraining: {
    enabled: true,
    coreLowerMinutes: 20,
    suburiMinutes: 25,
    suburiCount: 1000,
    stretchMinutes: 10,
    showerMinutes: 5,
    breakfastEnabled: true,
    breakfastMinutes: 15,
    autoAdjustForMorningEvent: true,
  },
  relaxedMinMinutes: 90,
  relaxedRatio: 0.20,
  deadlineStrictRelaxedMinMinutes: 30,
  classDayEveningCapMinutes: 60,
  cloudSyncEnabled: true,
  cloudFileName: 'life-os-data.json',
  cloudLastSyncAt: '',
  forecastDays: 90,
  energy: {
    high: { budgetMultiplier: 1.08, relaxedExtra: -10, blockCap: 150 },
    normal: { budgetMultiplier: 1.0, relaxedExtra: 0, blockCap: 120 },
    tired: { budgetMultiplier: 0.68, relaxedExtra: 45, blockCap: 45 },
  },
  buffers: {
    none: { before: 0, after: 0 },
    small: { before: 15, after: 15 },
    medium: { before: 30, after: 45 },
    large: { before: 60, after: 90 },
  },
  subjects: ['英語', 'ドイツ語', '授業', '資格', '生活', 'その他'],
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
    energy: {
      ...DEFAULT_SETTINGS.energy,
      ...(saved.energy || {}),
      high: { ...DEFAULT_SETTINGS.energy.high, ...(saved.energy?.high || {}) },
      normal: { ...DEFAULT_SETTINGS.energy.normal, ...(saved.energy?.normal || {}) },
      tired: { ...DEFAULT_SETTINGS.energy.tired, ...(saved.energy?.tired || {}) },
    },
    morningTraining: {
      ...DEFAULT_SETTINGS.morningTraining,
      ...(saved.morningTraining || {}),
    },
    buffers: {
      ...DEFAULT_SETTINGS.buffers,
      ...(saved.buffers || {}),
      none: { ...DEFAULT_SETTINGS.buffers.none, ...(saved.buffers?.none || {}) },
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

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function toMinutes(text) {
  const [h, m] = String(text || '00:00').split(':').map(Number);
  return h * 60 + m;
}

export function timeLabel(minute) {
  let m = Math.round(minute);
  while (m >= 1440) m -= 1440;
  while (m < 0) m += 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesLabel(n) {
  const v = Math.max(0, Math.round(n || 0));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (!h) return `${m}分`;
  if (!m) return `${h}時間`;
  return `${h}時間${m}分`;
}

function dayStart(day) { return new Date(`${day}T00:00:00`); }
function eventMinute(dateString, day) { return Math.round((new Date(dateString) - dayStart(day)) / MINUTE); }

export function eventsForDay(events, day) {
  return (events || []).filter((e) => e.allDay ? e.start === day : dateKey(new Date(e.start)) === day);
}

function inferBufferInfo(event, settings) {
  if (event.bufferLevel && settings.buffers[event.bufferLevel]) return { level: event.bufferLevel, ...settings.buffers[event.bufferLevel] };
  const title = (event.title || '').toLowerCase();
  const hit = (settings.categoryRules || []).find((r) => (r.keywords || []).some((k) => title.includes(k.toLowerCase())));
  const level = hit?.buffer || 'small';
  return { level, ...settings.buffers[level] };
}

function resolveTimedEventBuffer(event, overrides, settings) {
  const auto = inferBufferInfo(event, settings);
  const ov = overrides?.[event.id];
  if (ov?.kind === 'bufferCustom') return { selection: 'custom', autoLevel: auto.level, before: Math.max(0, Number(ov.before || 0)), after: Math.max(0, Number(ov.after || 0)), source: 'manual' };
  if (ov?.kind === 'buffer' && settings.buffers[ov.bufferLevel]) return { selection: ov.bufferLevel, autoLevel: auto.level, ...settings.buffers[ov.bufferLevel], source: 'manual' };
  return { selection: 'auto', autoLevel: auto.level, before: auto.before, after: auto.after, source: 'auto' };
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
  return out.filter((x) => x.end - x.start >= 10);
}

export function daysUntil(deadline, day) {
  const a = new Date(`${day}T12:00:00`);
  const b = new Date(`${String(deadline).slice(0,10)}T12:00:00`);
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

function deadlineDate(task) { return String(task?.deadline || '').slice(0, 10); }
function deadlineTime(task) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(task?.deadlineTime || '')) ? task.deadlineTime : '23:59'; }
function deadlineMinuteOnDay(task, day) { return deadlineDate(task) === day ? toMinutes(deadlineTime(task)) : null; }
function daysUntilTask(task, day) {
  const a = new Date(`${day}T00:00:00`);
  const b = new Date(`${deadlineDate(task)}T${deadlineTime(task)}:00`);
  return Math.max(0.25, Math.ceil((b - a) / 86_400_000));
}
function taskExpiredBeforeDay(task, day) { return Boolean(deadlineDate(task)) && deadlineDate(task) < day; }
function blocksBeforeDeadline(task, day, blocks) {
  if (taskExpiredBeforeDay(task, day)) return [];
  const due = deadlineMinuteOnDay(task, day);
  if (due === null) return blocks;
  return blocks.map((b) => ({ start: b.start, end: Math.min(b.end, due) })).filter((b) => b.end - b.start >= 5);
}

export function isPageTask(task) { return Number.isFinite(Number(task?.remainingPages)); }
export function taskMinutesPerPage(task) { return Math.max(0.25, Number(task?.learnedMinutesPerPage || task?.minutesPerPage || task?.baseMinutesPerPage || 3)); }
export function estimatedRemainingMinutes(task) { return isPageTask(task) ? Math.max(0, Number(task.remainingPages || 0)) * taskMinutesPerPage(task) : Math.max(0, Number(task.remainingMinutes || 0)); }

function urgency(task, day) {
  const d = daysUntilTask(task, day);
  const priority = { high: 1.40, medium: 1, low: 0.72 }[task.priority] || 1;
  const focus = { main: 1.50, sub: 1.06, maintain: 0.74 }[task.focus] || 1;
  const mode = task.mode === 'grow' ? 1.10 : 1;
  const fixedDateBoost = task.placement === 'date' && task.fixedDate === day ? 2.4 : 1;
  const strict = task.deadlineStrict ? 3.0 : 1;
  return (estimatedRemainingMinutes(task) / d) * priority * focus * mode * fixedDateBoost * strict;
}

function desiredTodayPages(task, day, budgetMinutes, loadMultiplier = 1) {
  const remainingPages = Math.max(0, Number(task.remainingPages || 0));
  if (remainingPages <= 0 || budgetMinutes <= 0) return 0;
  const minutesPerPage = taskMinutesPerPage(task);
  const baselinePages = remainingPages / daysUntilTask(task, day);
  const mult = ({ main: 1.25, sub: 1, maintain: 0.70 }[task.focus] || 1) * loadMultiplier * (task.deadlineStrict ? 1.35 : 1);
  const minPages = Math.max(1, Number(task.minPages || 5));
  const maxPages = Math.max(minPages, Number(task.maxPages || 30));
  const byBudget = Math.floor(budgetMinutes / minutesPerPage);
  if (byBudget <= 0) return 0;
  const target = Math.max(1, Math.ceil(baselinePages * mult));
  const dailyCap = task.deadlineStrict ? remainingPages : maxPages;
  return Math.min(remainingPages, byBudget, dailyCap, Math.max(Math.min(minPages, byBudget), target));
}

function desiredTodayMinutes(task, day, budget, loadMultiplier = 1) {
  if (Number(task.remainingMinutes || 0) <= 0 || budget <= 0) return 0;
  const baseline = Number(task.remainingMinutes) / daysUntilTask(task, day);
  const mult = ({ main: 1.25, sub: 1, maintain: 0.70 }[task.focus] || 1) * loadMultiplier * (task.deadlineStrict ? 1.35 : 1);
  const min = Number(task.minBlock || 20);
  const max = Number(task.maxBlock || 120);
  const target = Math.ceil((baseline * mult) / 5) * 5;
  const dailyCap = task.deadlineStrict ? Number(task.remainingMinutes) : max;
  return Math.min(Number(task.remainingMinutes), budget, dailyCap, Math.max(min, target));
}

function isClassDay(events, settings) {
  const keywords = settings.classKeywords || [];
  return events.some((e) => keywords.some((k) => (e.title || '').toLowerCase().includes(k.toLowerCase())));
}

function orderedBlockIndexes(task, blocks) {
  const order = blocks.map((b, i) => ({ ...b, i }));
  if (task.timePreference === 'evening') order.sort((a, b) => b.start - a.start);
  else order.sort((a, b) => a.start - b.start);
  return order;
}

function placeMinuteTask(task, minutes, blocks, blockCap) {
  const items = [];
  let remaining = minutes;
  for (const candidate of orderedBlockIndexes(task, blocks)) {
    if (remaining <= 0) break;
    const b = blocks[candidate.i];
    const cap = b.end - b.start;
    const min = Math.min(Number(task.minBlock || 20), remaining);
    if (cap < min) continue;
    const chunk = Math.min(remaining, Number(task.maxBlock || 120), blockCap, cap);
    items.push({ type: 'task', taskId: task.id, title: task.title, start: b.start, end: b.start + chunk, minutes: chunk, movable: true });
    blocks[candidate.i] = { start: b.start + chunk, end: b.end };
    remaining -= chunk;
  }
  return items;
}

function placePageTask(task, pages, blocks, blockCap) {
  const items = [];
  let remainingPages = pages;
  const minutesPerPage = taskMinutesPerPage(task);
  const minPages = Math.max(1, Number(task.minPages || 5));
  const maxPages = Math.max(minPages, Number(task.maxPages || 30));
  for (const candidate of orderedBlockIndexes(task, blocks)) {
    if (remainingPages <= 0) break;
    const b = blocks[candidate.i];
    const capMinutes = Math.min(b.end - b.start, blockCap);
    const pagesFit = Math.floor(capMinutes / minutesPerPage);
    if (pagesFit <= 0) continue;
    const requiredMinimum = Math.min(minPages, remainingPages);
    if (pagesFit < requiredMinimum && items.length === 0 && pagesFit < remainingPages) continue;
    const chunkPages = Math.max(1, Math.min(remainingPages, maxPages, pagesFit));
    const chunkMinutes = Math.max(1, Math.ceil(chunkPages * minutesPerPage));
    items.push({ type: 'task', taskId: task.id, title: task.title, start: b.start, end: b.start + chunkMinutes, pages: chunkPages, minutesPerPage, movable: true });
    blocks[candidate.i] = { start: b.start + chunkMinutes, end: b.end };
    remainingPages -= chunkPages;
  }
  return items;
}

function placementAllowsDay(task, day) {
  if (task.placement === 'date' || task.placement === 'datetime') return task.fixedDate === day;
  const dow = new Date(`${day}T12:00:00`).getDay();
  if (Array.isArray(task.learningDays) && task.learningDays.length && !task.learningDays.map(Number).includes(dow)) return false;
  if (Number.isFinite(Number(task.intervalDays)) && Number(task.intervalDays) > 0 && task.startDate) {
    const a = new Date(`${String(task.startDate).slice(0,10)}T12:00:00`);
    const b = new Date(`${day}T12:00:00`);
    const diff = Math.floor((b - a) / 86_400_000);
    if (diff >= 0 && diff % Number(task.intervalDays) !== 0) return false;
  }
  return true;
}

function fixedTaskItems(tasks, day) {
  return tasks
    .filter((t) => t.status !== 'paused' && !taskExpiredBeforeDay(t, day) && t.placement === 'datetime' && t.fixedDate === day && (isPageTask(t) ? Number(t.remainingPages) > 0 : Number(t.remainingMinutes) > 0))
    .map((t) => {
      const start = toMinutes(t.fixedTime || '09:00');
      const due = deadlineMinuteOnDay(t, day);
      const limit = due === null ? Infinity : due;
      const cap = limit - start;
      if (cap < 5) return null;
      if (isPageTask(t)) {
        const mpp = taskMinutesPerPage(t);
        const pagesByDeadline = Math.max(0, Math.floor(cap / mpp));
        const pages = Math.max(0, Math.min(Number(t.fixedPages || t.minPages || 5), Number(t.remainingPages || 0), pagesByDeadline));
        if (pages <= 0) return null;
        const minutes = Math.max(1, Math.ceil(pages * mpp));
        return { type: 'task', taskId: t.id, title: t.title, start, end: start + minutes, pages, minutesPerPage: mpp, movable: false, fixed: true };
      }
      const minutes = Math.max(0, Math.min(Number(t.fixedMinutes || t.minBlock || 20), Number(t.remainingMinutes || 0), cap));
      if (minutes < 5) return null;
      return { type: 'task', taskId: t.id, title: t.title, start, end: start + minutes, minutes, movable: false, fixed: true };
    })
    .filter(Boolean);
}

export function generateDayPlan({ day, tasks, events, overrides, settings, classDayOverride = 'auto', energyState = 'normal' }) {
  settings = deepDefaults(settings);
  const dayEvents = eventsForDay(events || [], day);
  const classDay = classDayOverride === 'class' ? true : classDayOverride === 'noClass' ? false : isClassDay(dayEvents, settings);
  const energy = settings.energy?.[energyState] || settings.energy.normal;
  const wake = toMinutes(settings.wakeTime);
  let bed = toMinutes(settings.bedTime);
  if (bed <= wake) bed += 1440;

  const fixedCore = [];
  const busyForWork = [];
  const allDayPending = [];
  const eventBufferInfo = [];

  for (const e of dayEvents) {
    if (e.allDay) {
      const ov = overrides?.[e.id];
      if (!ov) { allDayPending.push(e); continue; }
      if (ov.kind === 'memo') continue;
      if (ov.kind === 'timed') {
        const start = toMinutes(ov.startTime);
        const end = toMinutes(ov.endTime);
        const buf = settings.buffers[ov.bufferLevel || 'small'] || settings.buffers.small;
        fixedCore.push({ type: 'event', eventId: e.id, title: e.title, start, end, movable: false });
        busyForWork.push({ start: start - buf.before, end: end + buf.after });
      }
      continue;
    }
    const start = eventMinute(e.start, day);
    const end = eventMinute(e.end, day);
    const buf = resolveTimedEventBuffer(e, overrides || {}, settings);
    fixedCore.push({ type: 'event', eventId: e.id, title: e.title, start, end, movable: false });
    busyForWork.push({ start: start - buf.before, end: end + buf.after });
    eventBufferInfo.push({ id: e.id, title: e.title, start, end, ...buf });
  }

  const fixedTasks = fixedTaskItems(tasks || [], day);
  fixedCore.push(...fixedTasks);
  fixedTasks.forEach((x) => busyForWork.push({ start: x.start, end: x.end }));

  // Morning training starts from the actual wake time. If a morning event/buffer is too close,
  // Life OS shortens the routine automatically instead of letting training make the user late.
  const morningRoutine = [];
  let morningAdjustment = null;
  if (settings.morningTraining?.enabled !== false) {
    const mt = settings.morningTraining || {};
    const suburiCount = Math.max(0, Math.round(Number(mt.suburiCount ?? 1000)));
    const baseSteps = [
      { key: 'core', title: '体幹＆下半身トレ', minutes: Number(mt.coreLowerMinutes || 20) },
      { key: 'suburi', title: `素振り${suburiCount}本`, minutes: Number(mt.suburiMinutes || 25), count: suburiCount },
      { key: 'stretch', title: 'クールダウンストレッチ', minutes: Number(mt.stretchMinutes || 10) },
      { key: 'shower', title: 'シャワー', minutes: Number(mt.showerMinutes || 5) },
      ...(mt.breakfastEnabled === false ? [] : [{ key: 'breakfast', title: '朝食', minutes: Number(mt.breakfastMinutes || 15) }]),
    ].filter((s) => s.minutes > 0);
    const requestedMinutes = baseSteps.reduce((sum, s) => sum + s.minutes, 0);
    let availableBeforeMorningEvent = Infinity;
    if (mt.autoAdjustForMorningEvent !== false) {
      for (const b of busyForWork) {
        if (b.end <= wake) continue;
        if (b.start <= wake) { availableBeforeMorningEvent = 0; break; }
        availableBeforeMorningEvent = Math.min(availableBeforeMorningEvent, b.start - wake);
      }
    }
    const targetMinutes = Number.isFinite(availableBeforeMorningEvent)
      ? Math.max(0, Math.min(requestedMinutes, Math.floor(availableBeforeMorningEvent)))
      : requestedMinutes;

    let steps = baseSteps.map((s) => ({ ...s }));
    if (targetMinutes < requestedMinutes) {
      const minutesByKey = Object.fromEntries(baseSteps.map((s) => [s.key, 0]));
      let rest = targetMinutes;
      const find = (key) => baseSteps.find((s) => s.key === key);
      const reserve = (key, min) => {
        const s = find(key); if (!s || rest <= 0) return;
        const need = Math.min(s.minutes, min, rest);
        if (need > 0) { minutesByKey[key] += need; rest -= need; }
      };
      // Keep readiness first when time is tight: shower and breakfast are protected, training is shortened.
      reserve('shower', 5);
      reserve('breakfast', 10);
      reserve('stretch', 3);
      for (const key of ['core', 'suburi', 'stretch', 'breakfast', 'shower']) {
        const s = find(key); if (!s || rest <= 0) continue;
        const cap = Math.max(0, s.minutes - minutesByKey[key]);
        const add = Math.min(cap, rest);
        minutesByKey[key] += add; rest -= add;
      }
      steps = baseSteps.map((s) => {
        const mins = Math.round(minutesByKey[s.key] || 0);
        let title = s.title;
        if (s.key === 'suburi' && s.count && s.minutes > 0 && mins > 0 && mins < s.minutes) {
          const adjustedCount = Math.max(1, Math.round(s.count * mins / s.minutes));
          title = `素振り${adjustedCount}本（短縮）`;
        } else if (mins > 0 && mins < s.minutes) {
          title = `${s.title}（短縮）`;
        }
        return { ...s, title, minutes: mins };
      }).filter((s) => s.minutes > 0);
      morningAdjustment = {
        mode: targetMinutes > 0 ? 'shortened' : 'skipped',
        requestedMinutes,
        scheduledMinutes: steps.reduce((sum, s) => sum + s.minutes, 0),
        availableMinutes: Math.max(0, Math.floor(availableBeforeMorningEvent)),
      };
    } else {
      morningAdjustment = { mode: 'full', requestedMinutes, scheduledMinutes: requestedMinutes, availableMinutes: null };
    }

    let cursor = wake;
    for (const step of steps) {
      const item = { type: 'life', title: step.title, start: cursor, end: cursor + step.minutes, movable: false, routineGroup: 'morningTraining', routineKey: step.key };
      morningRoutine.push(item);
      fixedCore.push(item);
      busyForWork.push({ start: item.start, end: item.end });
      cursor = item.end;
    }
  }

  const bathEnd = bed - Number(settings.bathBeforeBedMinutes || 90);
  const bathStart = bathEnd - Number(settings.bathMinutes || 30);
  const skincareEnd = bathEnd + Number(settings.skincareMinutes || 10);
  fixedCore.push({ type: 'life', title: 'お風呂＋肌ケア', start: bathStart, end: skincareEnd, movable: false });
  busyForWork.push({ start: bathStart, end: skincareEnd });

  let free = freeIntervals(wake, bed, mergeIntervals(busyForWork));
  const rawFree = free.reduce((s, b) => s + b.end - b.start, 0);
  let relaxedTarget = Math.max(0, Math.max(Number(settings.relaxedMinMinutes || 90), rawFree * Number(settings.relaxedRatio || 0.2)) + Number(energy.relaxedExtra || 0));
  const strictPendingForDay = (tasks || []).some((t) => t.deadlineStrict && t.status !== 'paused' && !taskExpiredBeforeDay(t, day) && placementAllowsDay(t, day) && (isPageTask(t) ? Number(t.remainingPages) > 0 : Number(t.remainingMinutes) > 0));
  if (strictPendingForDay) relaxedTarget = Math.min(relaxedTarget, Math.max(0, Number(settings.deadlineStrictRelaxedMinMinutes ?? 30)));
  let budget = Math.max(0, (rawFree - relaxedTarget) * Number(energy.budgetMultiplier || 1));

  if (classDay) {
    const lastEventEnd = Math.max(wake, ...fixedCore.filter((x) => x.type === 'event').map((x) => x.end));
    let eveningAllowance = Number(settings.classDayEveningCapMinutes || 60);
    free = free.flatMap((b) => {
      if (b.end <= lastEventEnd) return [b];
      if (b.start >= lastEventEnd) {
        const allow = Math.min(eveningAllowance, b.end - b.start);
        eveningAllowance -= allow;
        return allow >= 10 ? [{ start: b.start, end: b.start + allow }] : [];
      }
      const before = { start: b.start, end: lastEventEnd };
      const allow = Math.min(eveningAllowance, b.end - lastEventEnd);
      eveningAllowance -= allow;
      return allow >= 10 ? [before, { start: lastEventEnd, end: lastEventEnd + allow }] : [before];
    });
    budget = Math.min(budget, free.reduce((s, b) => s + b.end - b.start, 0));
  }

  let workBlocks = free.map((b) => ({ ...b }));
  // App側から現在時刻が渡された場合、可動タスクはその時刻以降の空き時間だけに再配置する。
  // 固定予定・授業・朝トレ・生活固定タスクはそのまま保持する。
  const rescheduleFrom = Number(settings.rescheduleMovableFromMinute);
  if (Number.isFinite(rescheduleFrom) && rescheduleFrom > wake) {
    workBlocks = workBlocks
      .map((b) => ({ start: Math.max(b.start, rescheduleFrom), end: b.end }))
      .filter((b) => b.end - b.start >= 10);
  }
  const fixedTaskIds = new Set(fixedTasks.map((x) => x.taskId));
  const active = (tasks || [])
    .filter((t) => t.status !== 'paused' && !fixedTaskIds.has(t.id) && !taskExpiredBeforeDay(t, day) && placementAllowsDay(t, day) && (isPageTask(t) ? Number(t.remainingPages) > 0 : Number(t.remainingMinutes) > 0) )
    .sort((a, b) => (Number(Boolean(b.deadlineStrict)) - Number(Boolean(a.deadlineStrict))) || urgency(b, day) - urgency(a, day));

  const planned = [];
  let remainingBudget = budget;
  for (const task of active) {
    if (remainingBudget < 5) break;
    let items = [];
    const taskBlocks = blocksBeforeDeadline(task, day, workBlocks);
    if (!taskBlocks.length) continue;
    if (isPageTask(task)) {
      const wantedPages = desiredTodayPages(task, day, remainingBudget, Number(energy.budgetMultiplier || 1));
      items = placePageTask(task, wantedPages, taskBlocks, Number(energy.blockCap || 120));
    } else {
      const wantedMinutes = desiredTodayMinutes(task, day, remainingBudget, Number(energy.budgetMultiplier || 1));
      items = placeMinuteTask(task, wantedMinutes, taskBlocks, Number(energy.blockCap || 120));
    }
    // taskBlocks is a deadline-clipped copy. Apply the same used intervals back to workBlocks.
    for (const item of items) {
      const idx = workBlocks.findIndex((b) => b.start <= item.start && b.end >= item.end);
      if (idx >= 0) workBlocks[idx] = { start: item.end, end: workBlocks[idx].end };
    }
    const used = items.reduce((s, x) => s + x.end - x.start, 0);
    planned.push(...items);
    remainingBudget -= used;
  }

  const allTaskItems = [...fixedTasks, ...planned];
  const scheduledTaskMinutes = allTaskItems.reduce((s, x) => s + x.end - x.start, 0);
  const scheduledTaskPages = allTaskItems.reduce((s, x) => s + Number(x.pages || 0), 0);
  const relaxedMinutes = Math.max(relaxedTarget, rawFree - planned.reduce((s, x) => s + x.end - x.start, 0));
  const timeline = [...fixedCore.filter((x) => x.type !== 'task'), ...allTaskItems].sort((a, b) => a.start - b.start);

  return { classDay, energyState, allDayPending, eventBufferInfo, timeline, morningRoutine, morningAdjustment, rawFreeMinutes: rawFree, scheduledTaskMinutes, scheduledTaskPages, relaxedMinutes };
}

export function forecastDeadlineRisks({ fromDay, tasks, events, overrides, settings, dayModes = {}, dayStates = {}, dailySleepPlans = {}, wakeRecords = {}, maxDays }) {
  settings = deepDefaults(settings);
  const active = (tasks || []).filter((t) => t.status !== 'paused' && (isPageTask(t) ? Number(t.remainingPages) > 0 : Number(t.remainingMinutes) > 0));
  if (!active.length) return [];
  const horizon = Math.min(Number(maxDays || settings.forecastDays || 90), 180);
  const sim = active.map((t) => ({ ...t }));
  const finish = {};
  const remainingAtDeadline = {};
  const plannedThroughDeadline = {};

  for (let i = 0; i <= horizon; i++) {
    const day = addDays(fromDay, i);
    const sleepOwn = dailySleepPlans[day] || {}, sleepPrev = dailySleepPlans[addDays(day, -1)] || {};
    const daySettings = { ...settings, wakeTime: wakeRecords[day]?.wakeTime || sleepPrev.nextWakeTime || settings.wakeTime, bedTime: sleepOwn.bedTime || settings.bedTime };
    const plan = generateDayPlan({ day, tasks: sim, events, overrides, settings: daySettings, classDayOverride: dayModes[day] || 'auto', energyState: dayStates[day] || 'normal' });
    for (const item of plan.timeline.filter((x) => x.type === 'task' && x.taskId)) {
      const t = sim.find((x) => x.id === item.taskId);
      if (!t) continue;
      if (isPageTask(t)) {
        const amount = Number(item.pages || 0);
        t.remainingPages = Math.max(0, Number(t.remainingPages || 0) - amount);
        if (day <= deadlineDate(t)) plannedThroughDeadline[t.id] = (plannedThroughDeadline[t.id] || 0) + amount;
        if (t.remainingPages <= 0 && !finish[t.id]) finish[t.id] = day;
      } else {
        const amount = Number(item.end - item.start || item.minutes || 0);
        t.remainingMinutes = Math.max(0, Number(t.remainingMinutes || 0) - amount);
        if (day <= deadlineDate(t)) plannedThroughDeadline[t.id] = (plannedThroughDeadline[t.id] || 0) + amount;
        if (t.remainingMinutes <= 0 && !finish[t.id]) finish[t.id] = day;
      }
    }
    for (const t of sim) {
      if (day === deadlineDate(t)) remainingAtDeadline[t.id] = isPageTask(t) ? Math.max(0, Number(t.remainingPages || 0)) : Math.max(0, Number(t.remainingMinutes || 0));
    }
    if (sim.every((t) => isPageTask(t) ? Number(t.remainingPages || 0) <= 0 : Number(t.remainingMinutes || 0) <= 0)) break;
  }

  return active.map((original) => {
    const finishDay = finish[original.id] || null;
    const isPages = isPageTask(original);
    const currentRemaining = isPages ? Number(original.remainingPages || 0) : Number(original.remainingMinutes || 0);
    const shortage = Number(remainingAtDeadline[original.id] ?? currentRemaining);
    const days = daysUntilTask(original, fromDay);
    const unit = isPages ? 'ページ' : '分';
    let level = 'green';
    let text = '期限内に完了見込み';
    let action = '現在の配分で継続';
    if (deadlineDate(original) < fromDay && currentRemaining > 0) {
      level = 'red';
      text = `期限超過・残り${Math.ceil(currentRemaining)}${unit}`;
      action = '最優先で再配置または期限を見直す';
    } else if (!finishDay || finishDay > deadlineDate(original)) {
      const late = finishDay ? Math.max(1, daysUntil(finishDay, original.deadline)) : 99;
      level = late <= 2 ? 'orange' : 'red';
      const catchup = Math.max(1, Math.ceil(shortage * Math.min(7, days) / days));
      text = finishDay ? `${finishDay}ごろ完了見込み（期限超過）` : `期限までに${Math.ceil(shortage)}${unit}残る見込み`;
      action = `今後7日で追加 ${Math.min(Math.ceil(shortage), catchup)}${unit}程度を前倒し候補`;
    } else {
      const slack = Math.round((new Date(`${deadlineDate(original)}T${deadlineTime(original)}:00`) - new Date(`${finishDay}T12:00:00`)) / 86_400_000);
      if (slack <= 1) { level = 'yellow'; text = '期限ぎりぎりで完了見込み'; action = '少し前倒しすると安全'; }
      else { level = 'green'; text = `${Math.max(0, slack)}日程度の余裕`; }
    }
    if (original.deadlineStrict && level !== 'green') action = `期限死守ON：${action}`;
    return { taskId: original.id, title: original.title, level, text, action, finishDay, shortage, plannedAmount: plannedThroughDeadline[original.id] || 0, unit: isPages ? 'pages' : 'minutes' };
  });
}

