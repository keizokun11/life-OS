import { DEFAULT_SETTINGS, deepDefaults, dateKey, addDays, generateDayPlan, forecastDeadlineRisks, minutesLabel, timeLabel, toMinutes, taskMinutesPerPage } from './scheduler.js?v=1.5.8';

const APP_VERSION = '1.5.8';
const DATA_SCHEMA_VERSION = 14;
const DATA_KEYS = ['tasks','events','overrides','settings','dayModes','dayStates','dailySleepPlans','wakeRecords','activityLog','operationLog','planSnapshots','ideas','closeouts','activeSession','semesters','classExceptions','motivation','calendarSources','morningTrainingOverrides','quickEvents'];
const CLOUD_KEYS = ['tasks','overrides','settings','dayModes','dayStates','dailySleepPlans','wakeRecords','activityLog','operationLog','planSnapshots','ideas','closeouts','activeSession','semesters','classExceptions','motivation','calendarSources','morningTrainingOverrides','quickEvents'];
const K = (name) => `lifeos:${name}`;
const load = (name, fallback) => { try { return JSON.parse(localStorage.getItem(K(name))) ?? fallback; } catch { return fallback; } };
const save = (name, value) => localStorage.setItem(K(name), JSON.stringify(value));
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const $ = (id) => document.getElementById(id);
const isNativeIOS = () => Boolean(window.webkit?.messageHandlers?.lifeOSNative);
const GOOGLE_SESSION_KEY = 'lifeos:googleAuthSession';

function rawSnapshot(keys = DATA_KEYS) {
  const out = {};
  keys.forEach(k => { const raw = localStorage.getItem(K(k)); if (raw != null) { try { out[k] = JSON.parse(raw); } catch { out[k] = raw; } } });
  return out;
}
function createAutomaticBackup(reason='upgrade') {
  const data = rawSnapshot(); if (!Object.keys(data).length) return;
  const backups = load('autoBackups', []);
  backups.unshift({ id:uid(), createdAt:new Date().toISOString(), reason, appVersion:load('meta',{})?.appVersion || 'legacy', schemaVersion:load('meta',{})?.schemaVersion || 0, data });
  save('autoBackups', backups.slice(0,5));
}
function normalizeTask(t) {
  const taskType = t.taskType || (Number.isFinite(Number(t.remainingPages)) ? 'study' : 'general');
  const base = Number(t.baseMinutesPerPage || t.minutesPerPage || 3);
  const isStudy = taskType === 'study';
  return {
    ...t,
    taskType,
    courseId: t.courseId || '',
    assignmentType: t.assignmentType || (taskType === 'classAssignment' ? 'weekly' : ''),
    quantityText: t.quantityText || '',
    source: t.source || '', sourceKey: t.sourceKey || '',
    remainingPages: isStudy && Number.isFinite(Number(t.remainingPages)) ? Number(t.remainingPages) : undefined,
    remainingMinutes: !isStudy ? Math.max(0, Number(t.remainingMinutes || t.expectedMinutes || 0)) : undefined,
    initialPages: isStudy ? Number(t.initialPages || t.remainingPages || 0) : undefined,
    initialMinutes: !isStudy ? Number(t.initialMinutes || t.remainingMinutes || t.expectedMinutes || 0) : undefined,
    baseMinutesPerPage: isStudy ? base : undefined,
    minutesPerPage: isStudy ? Number(t.minutesPerPage || base) : undefined,
    learnedMinutesPerPage: isStudy && t.learnedMinutesPerPage ? Number(t.learnedMinutesPerPage) : null,
    speedSamples: isStudy ? Number(t.speedSamples || 0) : 0,
    minBlock: Math.max(5, Number(t.minBlock || 20)),
    maxBlock: Math.max(10, Number(t.maxBlock || 120)),
    placement: t.placement || 'flexible',
    fixedDate: t.fixedDate || '', fixedTime: t.fixedTime || '09:00', fixedPages: Number(t.fixedPages || t.minPages || 5), fixedMinutes: Number(t.fixedMinutes || t.minBlock || 20),
    deadlineTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.deadlineTime || '')) ? t.deadlineTime : '23:59',
    deadlineStrict: Boolean(t.deadlineStrict),
    createdAt: t.createdAt || new Date().toISOString(), status: t.status || 'active',
    itemCode: t.itemCode || '', subject: t.subject || '',
    rangeStart: Number.isFinite(Number(t.rangeStart)) ? Number(t.rangeStart) : undefined,
    rangeEnd: Number.isFinite(Number(t.rangeEnd)) ? Number(t.rangeEnd) : undefined,
    rangeUnit: t.rangeUnit || (isStudy ? 'ページ' : ''),
    weeklyMultiplier: Math.max(1, Number(t.weeklyMultiplier || 1)),
    pace: t.pace || 'normal',
    learningDays: Array.isArray(t.learningDays) ? t.learningDays.map(Number).filter(x => x>=0 && x<=6) : [],
    intervalDays: Number.isFinite(Number(t.intervalDays)) && Number(t.intervalDays)>0 ? Number(t.intervalDays) : '',
    reviewTaskEnabled: Boolean(t.reviewTaskEnabled),
    reviewMaxPerDay: Number.isFinite(Number(t.reviewMaxPerDay)) ? Number(t.reviewMaxPerDay) : '',
    thumbnailData: t.thumbnailData || '',
  };
}

const DEFAULT_PERIODS = [
  { no:1, start:'08:45', end:'10:15' }, { no:2, start:'10:30', end:'12:00' },
  { no:3, start:'13:00', end:'14:30' }, { no:4, start:'14:45', end:'16:15' },
  { no:5, start:'16:30', end:'18:00' }, { no:6, start:'18:15', end:'19:45' },
];
function normalizeCourse(c={}) { const weekday=Number.isFinite(Number(c.weekday))?Number(c.weekday):1, periodNo=Number.isFinite(Number(c.periodNo))?Number(c.periodNo):1; return { id:c.id||uid(), name:c.name||'', weekday, periodNo, defaultDelivery:c.defaultDelivery||'normal', onDemandMinutes:Math.max(10,Number(c.onDemandMinutes||90)), bufferLevel:c.bufferLevel||'small', location:c.location||'' }; }
function normalizeSemester(x={}) { return { id:x.id||uid(), academicYear:Number(x.academicYear||new Date().getFullYear()), term:x.term||'spring', name:x.name||`${x.academicYear||new Date().getFullYear()}年度 ${x.term==='fall'?'秋学期':'春学期'}`, startDate:x.startDate||dateKey(), endDate:x.endDate||addDays(dateKey(),120), periods:(x.periods?.length?x.periods:DEFAULT_PERIODS).map((q,i)=>({no:Number(q.no||i+1),start:q.start||DEFAULT_PERIODS[i]?.start||'09:00',end:q.end||DEFAULT_PERIODS[i]?.end||'10:30'})), courses:(x.courses||[]).map(normalizeCourse) }; }
function defaultCalendarEnabled(c={}) { const name=String(c.summary||'').toLowerCase(); if(c.primary)return true; if(name.includes('祝日')||name.includes('holiday'))return false; return true; }
function inferCalendarBuffer(c={}) { const name=String(c.summary||'').toLowerCase(); if(name.includes('部活')||name.includes('剣道'))return 'medium'; if(name.includes('バイト')||name.includes('活動')||name.includes('プライベート'))return 'medium'; if(name.includes('大学')||name.includes('授業')||name.includes('勉強'))return 'small'; if(name.includes('重要')||name.includes('mtg'))return 'medium'; return 'small'; }
function normalizeCalendarSource(c={}) { const primary=Boolean(c.primary||c.id==='primary'); return { id:c.id||'primary', summary:c.summary||c.name||(primary?'メイン':'Google Calendar'), primary, accessRole:c.accessRole||c.access_role||'', enabled: typeof c.enabled==='boolean'?c.enabled:defaultCalendarEnabled(c), bufferLevel:c.bufferLevel||inferCalendarBuffer(c), lastSeenAt:c.lastSeenAt||'' }; }
function mergeCalendarSources(remote=[]) { const old=new Map((calendarSources||[]).map(c=>[c.id,normalizeCalendarSource(c)])); const now=new Date().toISOString(); const merged=[]; for(const raw of remote){ const prev=old.get(raw.id)||{}; merged.push(normalizeCalendarSource({...raw,...prev,id:raw.id,summary:raw.summary,primary:Boolean(raw.primary),accessRole:raw.accessRole||raw.access_role||prev.accessRole,lastSeenAt:now})); old.delete(raw.id); } for(const rest of old.values()) merged.push(rest); if(!merged.length) merged.push(normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})); return merged; }
function calendarSourceForId(id){ return (calendarSources||[]).find(c=>c.id===id) || null; }
function quickEventsForDay(day){ return (quickEvents||[]).filter(e=>{ if(e.allDay) return e.start===day; try{return dateKey(new Date(e.start))===day;}catch{return false;} }); }
function morningTrainingEnabledForDay(day){ const v=morningTrainingOverrides?.[day]; return typeof v==='boolean' ? v : (settings.morningTraining?.enabled!==false); }
function setMorningTrainingForDay(day, enabled){ const before=morningTrainingEnabledForDay(day); morningTrainingOverrides={...(morningTrainingOverrides||{}),[day]:Boolean(enabled)}; recordOperation('daily_morning_training_toggled','この日の自主練を変更',{before,after:Boolean(enabled)},day); persist(); renderAll(); notice(enabled?'この日は自主練を入れて再計算しました。':'この日は自主練なしで再計算しました。'); }
function addQuickEventFromForm(day, data){ const title=String(data.quickTitle||'急な用事').trim()||'急な用事'; const startTime=String(data.quickStart||''); const endTime=String(data.quickEnd||''); if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return notice('開始・終了時刻を入力してください。'); if(toMinutes(endTime)<=toMinutes(startTime)) return notice('終了時刻は開始時刻より後にしてください。'); const bufferLevel=data.quickBuffer||'small'; const item={id:`quick:${uid()}`,title,allDay:false,start:`${day}T${startTime}:00`,end:`${day}T${endTime}:00`,bufferLevel,source:'quick',createdAt:new Date().toISOString()}; quickEvents=[...(quickEvents||[]),item]; recordOperation('quick_event_created','急な用事を追加',{eventId:item.id,title,startTime,endTime,bufferLevel},day); persist(); renderAll(); notice('急な用事を入れて、今日の予定を再計算しました。'); }
function deleteQuickEvent(id, day=selectedDay){ const ev=(quickEvents||[]).find(x=>x.id===id); quickEvents=(quickEvents||[]).filter(x=>x.id!==id); recordOperation('quick_event_deleted','急な用事を削除',{eventId:id,title:ev?.title||''},day); persist(); renderAll(); notice('急な用事を削除して再計算しました。'); }
function initializeStorage() {
  const meta = load('meta', null);
  if (!meta) {
    createAutomaticBackup('first-versioned-upgrade');
    const oldTasks = load('tasks', []).map(normalizeTask); save('tasks', oldTasks);
    save('meta', { appVersion:APP_VERSION, schemaVersion:DATA_SCHEMA_VERSION, initializedAt:new Date().toISOString(), userDataUpdatedAt:new Date().toISOString() });
    return;
  }
  if (meta.appVersion !== APP_VERSION || Number(meta.schemaVersion||0) !== DATA_SCHEMA_VERSION) {
    createAutomaticBackup(`upgrade-${meta.appVersion || 'unknown'}-to-${APP_VERSION}`);
    if (Number(meta.schemaVersion||0) < 2) save('tasks', load('tasks', []).map(normalizeTask));
    if (Number(meta.schemaVersion||0) < 3) { save('tasks', load('tasks', []).map(normalizeTask)); if(!localStorage.getItem(K('semesters'))) save('semesters', []); if(!localStorage.getItem(K('classExceptions'))) save('classExceptions', {}); }
    if (Number(meta.schemaVersion||0) < 4 && !localStorage.getItem(K('dailySleepPlans'))) save('dailySleepPlans', {});
    if (Number(meta.schemaVersion||0) < 5 && !localStorage.getItem(K('wakeRecords'))) save('wakeRecords', {});
    if (Number(meta.schemaVersion||0) < 6 && !localStorage.getItem(K('operationLog'))) save('operationLog', []);
    if (Number(meta.schemaVersion||0) < 7 && !localStorage.getItem(K('motivation'))) save('motivation', normalizeMotivation());
    if (Number(meta.schemaVersion||0) < 8 && !localStorage.getItem(K('calendarSources'))) save('calendarSources', [normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})]);
    if (Number(meta.schemaVersion||0) < 9) save('tasks', load('tasks', []).map(normalizeTask));
    if (Number(meta.schemaVersion||0) < 10) save('tasks', load('tasks', []).map(normalizeTask));
    if (Number(meta.schemaVersion||0) < 11) { const st=deepDefaults(load('settings', DEFAULT_SETTINGS)); if(!Array.isArray(st.subjects)||!st.subjects.length) st.subjects=[...DEFAULT_SETTINGS.subjects]; save('settings',st); }
    if (Number(meta.schemaVersion||0) < 12) { const st=deepDefaults(load('settings', DEFAULT_SETTINGS)); st.morningTraining={...DEFAULT_SETTINGS.morningTraining,...(st.morningTraining||{})}; save('settings',st); }
    if (Number(meta.schemaVersion||0) < 13) { if(!localStorage.getItem(K('morningTrainingOverrides'))) save('morningTrainingOverrides', {}); if(!localStorage.getItem(K('quickEvents'))) save('quickEvents', []); }
    save('meta', { ...meta, appVersion:APP_VERSION, schemaVersion:DATA_SCHEMA_VERSION, upgradedAt:new Date().toISOString() });
  }
}
initializeStorage();

let tasks = load('tasks', []).map(normalizeTask);
let events = load('events', []);
let overrides = load('overrides', {});
let settings = deepDefaults(load('settings', DEFAULT_SETTINGS));
let dayModes = load('dayModes', {});
let dayStates = load('dayStates', {});
let dailySleepPlans = load('dailySleepPlans', {});
let wakeRecords = load('wakeRecords', {});
let activityLog = load('activityLog', []);
let operationLog = load('operationLog', []);
let planSnapshots = load('planSnapshots', {});
let ideas = load('ideas', []);
let closeouts = load('closeouts', {});
let activeSession = load('activeSession', null);
let semesters = load('semesters', []).map(normalizeSemester);
let classExceptions = load('classExceptions', {});
let motivation = normalizeMotivation(load('motivation', null));
let calendarSources = load('calendarSources', [normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})]).map(normalizeCalendarSource);
let morningTrainingOverrides = load('morningTrainingOverrides', {});
let quickEvents = load('quickEvents', []);
let selectedSemesterId = semesters[0]?.id || '';
let editingCourseId = null;
let taskDraft = null;
let selectedDay = dateKey();
let editingTaskId = null;
let accessToken = '';
let accessTokenExpiresAt = 0;
let cloudFileId = null;
let cloudStatus = '未同期';
let cloudTimer = null;
let sessionTimer = null;

function persist({touch=true, cloud=true}={}) {
  save('tasks',tasks); save('events',events); save('overrides',overrides); save('settings',settings); save('dayModes',dayModes); save('dayStates',dayStates); save('dailySleepPlans',dailySleepPlans); save('wakeRecords',wakeRecords); save('activityLog',activityLog); save('operationLog',operationLog); save('planSnapshots',planSnapshots); save('ideas',ideas); save('closeouts',closeouts); save('activeSession',activeSession); save('semesters',semesters); save('classExceptions',classExceptions); save('motivation',motivation); save('calendarSources',calendarSources.map(normalizeCalendarSource)); save('morningTrainingOverrides',morningTrainingOverrides); save('quickEvents',quickEvents);
  const meta = load('meta',{});
  const now = new Date().toISOString();
  save('meta', { ...meta, appVersion:APP_VERSION, schemaVersion:DATA_SCHEMA_VERSION, ...(touch ? {userDataUpdatedAt:now} : {}), lastSavedAt:now });
  if (touch && cloud) queueCloudSync();
}
function cleanOperationDetails(details={}) {
  const out={};
  Object.entries(details||{}).forEach(([key,value])=>{
    if(/token|secret|client.?id|authorization/i.test(key)) return;
    if(value===undefined) return;
    out[key]=value;
  });
  return out;
}
function recordOperation(type,title,details={},targetDate='') {
  const occurredAt=new Date().toISOString();
  operationLog.unshift({
    id:uid(),
    date:dateKey(new Date()),
    occurredAt,
    type:String(type||'operation'),
    title:String(title||type||'操作'),
    targetDate:targetDate||'',
    details:cleanOperationDetails(details),
  });
}
function notice(text) { const box=$('notice'); if(!box) return; box.textContent=text; box.classList.remove('hidden'); setTimeout(()=>box.classList.add('hidden'),6000); }
function postNative(message){ if(!isNativeIOS()) return false; window.webkit.messageHandlers.lifeOSNative.postMessage(message); return true; }
function semesterForDay(day){ return semesters.find(s=>s.startDate<=day && s.endDate>=day) || null; }
function periodForCourse(semester,course){ return semester?.periods?.find(p=>Number(p.no)===Number(course.periodNo)) || DEFAULT_PERIODS.find(p=>p.no===Number(course.periodNo)) || DEFAULT_PERIODS[0]; }
function exceptionKey(courseId,day){ return `${courseId}:${day}`; }
function effectiveClassStatus(course,day){ return classExceptions[exceptionKey(course.id,day)]?.status || (course.defaultDelivery==='ondemand'?'ondemand':'normal'); }
function courseForId(id){ for(const sem of semesters){ const c=sem.courses.find(x=>x.id===id); if(c)return {course:c,semester:sem}; } return null; }
function isSameCourseCalendarEvent(event,course,day){ if(event.allDay || !event.start) return false; if(dateKey(new Date(event.start))!==day) return false; const title=String(event.title||'').toLowerCase(), name=String(course.name||'').toLowerCase(); return name.length>=2 && title.includes(name); }
function academicEventsForDay(day){
  const sem=semesterForDay(day); if(!sem)return [];
  const dow=new Date(`${day}T12:00:00`).getDay();
  return sem.courses.filter(c=>Number(c.weekday)===dow && Number(c.periodNo)>0 && effectiveClassStatus(c,day)==='normal').map(c=>{const p=periodForCourse(sem,c);return{id:`class:${c.id}:${day}`,title:`授業｜${c.name}`,allDay:false,start:`${day}T${p.start}:00`,end:`${day}T${p.end}:00`,location:c.location||'',bufferLevel:c.bufferLevel||'small',academic:true,courseId:c.id};});
}
function planningEventsForDay(day){
  const sem=semesterForDay(day), google=(events||[]).filter(e=>{ if(!sem)return true; return !sem.courses.some(c=>Number(c.weekday)===new Date(`${day}T12:00:00`).getDay() && isSameCourseCalendarEvent(e,c,day)); });
  return [...google,...quickEventsForDay(day),...academicEventsForDay(day)];
}
function planningEventsForForecast(fromDay,days){
  let academics=[], quick=[]; for(let i=0;i<=Math.min(180,Number(days||90));i++){const d=addDays(fromDay,i); academics.push(...academicEventsForDay(d)); quick.push(...quickEventsForDay(d));}
  const filtered=(events||[]).filter(e=>{ if(e.allDay)return true; const day=dateKey(new Date(e.start)); const sem=semesterForDay(day); if(!sem)return true; return !sem.courses.some(c=>Number(c.weekday)===new Date(`${day}T12:00:00`).getDay() && isSameCourseCalendarEvent(e,c,day)); });
  return [...filtered,...quick,...academics];
}
function sleepPlanForDay(day){
  const own=dailySleepPlans[day]||{}, previous=dailySleepPlans[addDays(day,-1)]||{};
  const plannedWakeTime=previous.nextWakeTime||settings.wakeTime;
  const wake=wakeRecords[day]||null;
  const actualWakeTime=wake?.wakeTime||'';
  return { plannedWakeTime, actualWakeTime, wakeTime:actualWakeTime||plannedWakeTime, wokeAt:wake?.wokeAt||'', bedTime:own.bedTime||settings.bedTime, nextWakeTime:own.nextWakeTime||settings.wakeTime, customBed:Boolean(own.bedTime), customNextWake:Boolean(own.nextWakeTime) };
}
function effectiveSettingsForDay(day){ const sp=sleepPlanForDay(day); const mt={...(settings.morningTraining||{}),enabled:morningTrainingEnabledForDay(day)}; return {...settings,wakeTime:sp.wakeTime,bedTime:sp.bedTime,morningTraining:mt}; }
function dayHasStarted(day){ return day!==dateKey() || Boolean(wakeRecords[day]?.wakeTime); }
function hhmm(d=new Date()){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function markAwakeNow(){
  const now=new Date(), day=dateKey(now), sleep=sleepPlanForDay(day), wakeTime=hhmm(now);
  wakeRecords[day]={wakeTime,wokeAt:now.toISOString(),plannedWakeTime:sleep.plannedWakeTime,source:'button'};
  if(!motivation.wakeBonusDays.includes(day)){motivation.wakeBonusDays.push(day);awardExp(10,'起床記録',{wakeTime,plannedWakeTime:sleep.plannedWakeTime},day);}
  evaluateTitles(day);
  selectedDay=day;
  recordOperation('wake_confirmed','起床を記録',{wakeTime,plannedWakeTime:sleep.plannedWakeTime,source:'button'},day);
  persist(); renderAll(); notice(`起床 ${wakeTime}。この時刻から朝トレ・朝食→今日の予定を作成しました。`);
}
function editActualWakeTime(day=dateKey()){
  const current=wakeRecords[day]?.wakeTime||hhmm(); const answer=prompt('実際に起きた時刻を修正',current); if(answer===null)return;
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(answer))return notice('時刻を HH:MM 形式で入力してください。');
  const base=new Date(`${day}T${answer}:00`), sleep=sleepPlanForDay(day), before=wakeRecords[day]?.wakeTime||'';
  wakeRecords[day]={...(wakeRecords[day]||{}),wakeTime:answer,wokeAt:base.toISOString(),plannedWakeTime:wakeRecords[day]?.plannedWakeTime||sleep.plannedWakeTime,source:'manual'};
  recordOperation('wake_corrected','起床時刻を修正',{before,after:answer},day);
  persist(); renderAll(); notice(`起床実績を ${answer} に修正し、予定を再計算しました。`);
}
function wakeGateMarkup(tab='today'){
  const day=dateKey(), sleep=sleepPlanForDay(day), now=hhmm();
  return `<div class="stack"><section class="hero-card wake-gate"><p class="eyebrow">MORNING START</p><h2>起きたら、ここから1日を開始</h2><div class="wake-times"><div><span>起床予定</span><strong>${sleep.plannedWakeTime}</strong></div><div><span>現在時刻</span><strong>${now}</strong></div></div><button id="wakeNow-${tab}" class="primary wake-button">起きた（${now}）</button><p class="wake-note">このボタンを押すまでは今日の作業計画を作成しません。押した実際の起床時刻から、まず朝トレ・朝食を置きます。朝の予定に間に合わない場合は自動で短縮して、その後に授業・予定・課題・ゆったり時間を組み直します。</p></section></div>`;
}
function plannedSleepMinutes(day){
  const s=sleepPlanForDay(day); let bed=toMinutes(s.bedTime), todayWake=toMinutes(s.wakeTime); if(bed<=todayWake)bed+=1440; let nextWake=1440+toMinutes(s.nextWakeTime); if(nextWake<=bed)nextWake+=1440; return Math.max(0,nextWake-bed);
}
function currentPlan(day=selectedDay){ return generateDayPlan({day,tasks,events:planningEventsForDay(day),overrides,settings:effectiveSettingsForDay(day),classDayOverride:dayModes[day]||'auto',energyState:dayStates[day]||'normal'}); }
function morningTrainingTotal(){ const m=settings.morningTraining||{}; const total=['coreLowerMinutes','suburiMinutes','stretchMinutes','showerMinutes'].reduce((sum,k)=>sum+Math.max(0,Number(m[k]||0)),0); return total + (m.breakfastEnabled===false?0:Math.max(0,Number(m.breakfastMinutes||0))); }
function completionKeyForItem(item){ return `${item.type}:${item.taskId||item.title}:${Math.round(item.start)}:${Math.round(item.end)}`; }
function isItemCompleted(item, day=selectedDay){
  if(!item || (item.type!=='task' && item.type!=='life')) return false;
  const key=completionKeyForItem(item);
  return activityLog.some(a=>a.date===day && (a.key===key || (item.type==='life' && a.kind==='life' && a.title===item.title)));
}
function nextPendingWorkItem(plan, day=selectedDay, afterMinute=null){
  const items=(plan.timeline||[]).filter(x=>(x.type==='task'||x.type==='life')&&!isItemCompleted(x,day));
  if(afterMinute!==null){ const future=items.find(x=>x.end>afterMinute); if(future)return future; }
  return items[0]||null;
}
function nextVisibleTimelineItem(plan, day=selectedDay, afterMinute=null){
  const items=(plan.timeline||[]).filter(x=>!(x.type==='task'||x.type==='life')||!isItemCompleted(x,day));
  if(afterMinute!==null){ const future=items.find(x=>x.end>afterMinute); if(future)return future; }
  return items[0]||null;
}
function currentRisks(){ return forecastDeadlineRisks({fromDay:dateKey(),tasks,events:planningEventsForForecast(dateKey(),settings.forecastDays),overrides,settings,dayModes,dayStates,dailySleepPlans,wakeRecords,maxDays:settings.forecastDays}); }

function riskBadge(r){ if(!r) return ''; const label={green:'順調',yellow:'注意',orange:'厳しい',red:'要調整'}[r.level]; return `<span class="risk-badge ${r.level}">${label}</span>`; }
function deadlineLabel(t){ return `${t.deadline}${t.deadlineTime ? ' ' + t.deadlineTime : ''}`; }


const TITLE_DEFS = [
  { id:'wake_first', name:'朝を制御し始めた者', desc:'起床をLife OSに記録した' },
  { id:'first_action', name:'最初の一手を打った者', desc:'作業か生活タスクを初めて完了した' },
  { id:'page_100', name:'知識の開拓者', desc:'累計100ページを突破' },
  { id:'page_500', name:'積み上げの証明者', desc:'累計500ページを突破' },
  { id:'life_7', name:'生活基盤の守護者', desc:'生活タスクを7回完了' },
  { id:'mission_clear', name:'今日を回収した者', desc:'今日の3ミッションを達成' },
  { id:'recovery', name:'復帰できる人間', desc:'崩れた翌日に戻ってきた' },
  { id:'boss_finisher', name:'締切を倒す者', desc:'課題・タスクを完了状態まで持っていった' },
  { id:'challenge_clear', name:'小さな挑戦を拾う者', desc:'挑戦カードを達成した' },
  { id:'closeout_first', name:'一日を閉じられる者', desc:'夜の終了処理を完了' },
];
function normalizeMotivation(m=null){
  const x=m||{};
  return {
    exp:Math.max(0,Number(x.exp||0)),
    titleIds:Array.isArray(x.titleIds)?x.titleIds:[],
    titleEvents:Array.isArray(x.titleEvents)?x.titleEvents:[],
    missionBonusDays:Array.isArray(x.missionBonusDays)?x.missionBonusDays:[],
    challengeBonusDays:Array.isArray(x.challengeBonusDays)?x.challengeBonusDays:[],
    wakeBonusDays:Array.isArray(x.wakeBonusDays)?x.wakeBonusDays:[],
    closeoutBonusDays:Array.isArray(x.closeoutBonusDays)?x.closeoutBonusDays:[],
    victories:Array.isArray(x.victories)?x.victories.slice(0,80):[],
  };
}
function levelForExp(exp=motivation.exp){return Math.max(1,Math.floor(Math.sqrt(Math.max(0,Number(exp||0))/120))+1);}
function expForLevel(level){return Math.round(120*Math.pow(Math.max(0,level-1),2));}
function motivationStats(){
  const level=levelForExp(); const current=expForLevel(level), next=expForLevel(level+1), inLevel=Math.max(0,motivation.exp-current), need=Math.max(1,next-current);
  const currentTitle=[...TITLE_DEFS].reverse().find(t=>motivation.titleIds.includes(t.id)) || {name:'挑戦者',desc:'これから積み上げる'};
  return {level,exp:Math.round(motivation.exp),current,next,progress:Math.min(100,Math.round(inLevel/need*100)),nextNeed:Math.max(0,next-motivation.exp),currentTitle};
}
function totalDonePages(){return activityLog.filter(a=>a.kind==='task').reduce((s,a)=>s+Number(a.pages||0),0);}
function totalDoneTaskMinutes(){return activityLog.filter(a=>a.kind==='task').reduce((s,a)=>s+Number(a.minutes||0),0);}
function lifeDoneCount(){return activityLog.filter(a=>a.kind==='life').length;}
function addVictory(title,details={},day=dateKey()){
  motivation.victories.unshift({id:uid(),day,createdAt:new Date().toISOString(),title:String(title||'勝利'),details});
  motivation.victories=motivation.victories.slice(0,80);
}
function unlockTitle(id,day=dateKey()){
  if(motivation.titleIds.includes(id)) return false;
  const def=TITLE_DEFS.find(t=>t.id===id); if(!def) return false;
  motivation.titleIds.push(id); motivation.titleEvents.unshift({id:uid(),titleId:id,title:def.name,day,createdAt:new Date().toISOString()});
  recordOperation('title_unlocked',`称号獲得｜${def.name}`,{titleId:id,title:def.name},day);
  addVictory(`称号「${def.name}」を獲得`,{titleId:id},day);
  notice(`称号獲得：${def.name}`);
  return true;
}
function awardExp(points,reason,details={},day=dateKey()){
  const add=Math.max(0,Math.round(Number(points||0))); if(!add) return;
  const before=levelForExp(); motivation.exp=Math.max(0,Math.round(motivation.exp+add)); const after=levelForExp();
  recordOperation('exp_awarded',`EXP +${add}｜${reason}`,{beforeLevel:before,afterLevel:after,totalExp:motivation.exp,...details},day);
  if(after>before){addVictory(`Level ${after} に到達`,{beforeLevel:before,afterLevel:after},day); notice(`Level ${after} に上がった`);}
}
function evaluateTitles(day=dateKey(),extra={}){
  if(Object.keys(wakeRecords||{}).length>0) unlockTitle('wake_first',day);
  if(activityLog.some(a=>a.kind==='task'||a.kind==='life')) unlockTitle('first_action',day);
  if(totalDonePages()>=100) unlockTitle('page_100',day);
  if(totalDonePages()>=500) unlockTitle('page_500',day);
  if(lifeDoneCount()>=7) unlockTitle('life_7',day);
  if(Object.keys(closeouts||{}).length>0) unlockTitle('closeout_first',day);
  if(extra.taskCompleted) unlockTitle('boss_finisher',day);
  const yesterday=addDays(day,-1), yesterdayActivity=activityLog.some(a=>a.date===yesterday&&(a.kind==='task'||a.kind==='life')), yesterdayPlanned=Boolean(planSnapshots[yesterday]||wakeRecords[yesterday]);
  const todayActivity=activityLog.some(a=>a.date===day&&(a.kind==='task'||a.kind==='life'));
  if(yesterdayPlanned&&!yesterdayActivity&&todayActivity) unlockTitle('recovery',day);
}
function dayDoneStats(day,plan){
  const logs=activityLog.filter(a=>a.date===day);
  const donePages=logs.filter(a=>a.kind==='task').reduce((s,a)=>s+Number(a.pages||0),0);
  const doneTaskMinutes=logs.filter(a=>a.kind==='task').reduce((s,a)=>s+Number(a.minutes||0),0);
  const doneLife=logs.filter(a=>a.kind==='life').length;
  const plannedPages=Number(plan?.scheduledTaskPages||0);
  const plannedMinutes=Number(plan?.scheduledTaskMinutes||0);
  const taskRatio=plannedPages?donePages/plannedPages:(plannedMinutes?doneTaskMinutes/plannedMinutes:0);
  const lifePlanned=(plan?.timeline||[]).some(x=>x.type==='life');
  const lifeOK=lifePlanned ? doneLife>0 : true;
  return {donePages,doneTaskMinutes,doneLife,plannedPages,plannedMinutes,taskRatio,lifeOK};
}
function dailyMissions(day,plan){
  const timeline=plan?.timeline||[];
  const taskItems=timeline.filter(x=>x.type==='task');
  const lifeItems=timeline.filter(x=>x.type==='life');
  const stats=dayDoneStats(day,plan);
  const main=taskItems[0]; const sub=taskItems[1]; const life=lifeItems[0];
  const missions=[];
  if(main) missions.push({kind:'main',label:`MAIN：${main.title}${main.pages?` ${main.pages}ページ`:` ${minutesLabel(main.end-main.start)}`}`,done:isItemCompleted(main,day)});
  else missions.push({kind:'main',label:'MAIN：今日は課題を増やしすぎない',done:true});
  if(sub) missions.push({kind:'sub',label:`SUB：${sub.title}${sub.pages?` ${sub.pages}ページ`:` ${minutesLabel(sub.end-sub.start)}`}`,done:isItemCompleted(sub,day)});
  else missions.push({kind:'sub',label:stats.plannedPages?`SUB：合計${stats.plannedPages}ページを回収`:'SUB：予定を壊さず整える',done:stats.plannedPages?stats.donePages>=stats.plannedPages:true});
  if(life) missions.push({kind:'life',label:`LIFE：${life.title}`,done:isItemCompleted(life,day)});
  else missions.push({kind:'life',label:'LIFE：生活の最低ラインを守る',done:true});
  return missions.slice(0,3);
}
function checkMissionBonus(day=dateKey(),plan=planSnapshots[day]||currentPlan(day)){
  const missions=dailyMissions(day,plan);
  if(missions.length && missions.every(m=>m.done) && !motivation.missionBonusDays.includes(day)){
    motivation.missionBonusDays.push(day); awardExp(60,'今日の3ミッション達成',{day},day); unlockTitle('mission_clear',day); addVictory('今日の3ミッションを回収',{missions:missions.map(m=>m.label)},day);
  }
}
function dailyChallenge(day=dateKey()){
  const list=[
    {id:'focus25',title:'25分だけ無音で集中',desc:'短くても、開始した事実を作る'},
    {id:'plus5',title:'予定より5ページだけ前倒し',desc:'余裕がある日だけでOK'},
    {id:'phoneaway',title:'スマホを遠くに置いて1セッション',desc:'開始の邪魔を減らす'},
    {id:'lifeearly',title:'生活タスクを先に倒す',desc:'夜の自分を助ける'},
    {id:'oneblock',title:'1ブロックだけ予定通り開始',desc:'完璧より、始動'},
  ];
  const idx=Math.abs([...day].reduce((s,c)=>s+c.charCodeAt(0),0))%list.length; return list[idx];
}
function completeChallenge(day=dateKey()){
  if(motivation.challengeBonusDays.includes(day)) return;
  const ch=dailyChallenge(day); motivation.challengeBonusDays.push(day); awardExp(35,`挑戦カード達成｜${ch.title}`,{challengeId:ch.id},day); unlockTitle('challenge_clear',day); addVictory(`挑戦カード達成：${ch.title}`,{challengeId:ch.id},day); persist(); renderAll();
}
function heatPercent(day,plan){
  const s=dayDoneStats(day,plan); const wake=Boolean(wakeRecords[day]);
  const task=Math.min(70,Math.round(Math.max(0,s.taskRatio)*70)); const life=s.lifeOK?20:0; const morning=wake?10:0;
  return Math.max(0,Math.min(100,task+life+morning));
}
function motivationPanel(day=dateKey(),plan=currentPlan(day)){
  const st=motivationStats(), heat=heatPercent(day,plan), missions=dailyMissions(day,plan), ch=dailyChallenge(day), doneChallenge=motivation.challengeBonusDays.includes(day);
  const missionHtml=missions.map(m=>`<li class="${m.done?'done':''}"><span>${m.done?'✓':'□'}</span>${esc(m.label)}</li>`).join('');
  return `<section class="card motivation-card"><div class="row between"><div><p class="eyebrow">MISSION / EXP</p><h2>Level ${st.level}｜${esc(st.currentTitle.name)}</h2></div><strong class="heat-badge">熱量 ${heat}%</strong></div><div class="exp-bar"><span style="width:${st.progress}%"></span></div><p class="muted">${st.exp} EXP ・ 次のLevelまで ${Math.round(st.nextNeed)} EXP</p><ul class="mission-list">${missionHtml}</ul><div class="challenge-card ${doneChallenge?'done':''}"><div><strong>挑戦カード：${esc(ch.title)}</strong><small>${esc(ch.desc)}</small></div>${doneChallenge?'<span class="done-mark">達成済み</span>':day===dateKey()?'<button class="secondary small completeChallenge">達成</button>':''}</div></section>`;
}
function bossCardsHtml(){
  const active=tasks.filter(t=>t.status!=='paused' && (Number(t.remainingPages||0)>0||Number(t.remainingMinutes||0)>0)).sort((a,b)=>String(a.deadline).localeCompare(String(b.deadline))).slice(0,6);
  if(!active.length) return '';
  const cards=active.map(t=>{const isPage=Number.isFinite(Number(t.remainingPages)); const initial=Math.max(1,Number(isPage?(t.initialPages||t.remainingPages):(t.initialMinutes||t.remainingMinutes)||1)); const remaining=Math.max(0,Number(isPage?t.remainingPages:t.remainingMinutes||0)); const hp=Math.max(0,Math.min(100,Math.round(remaining/initial*100))); const dealt=100-hp; return `<div class="boss-card"><div class="row between"><div><strong>${esc(t.title)}</strong><small>期限 ${esc(deadlineLabel(t))} ・ Boss HP ${hp}%</small></div><span class="risk-badge ${hp<25?'green':hp<55?'yellow':hp<80?'orange':'red'}">${isPage?`${Math.ceil(remaining)}頁`:`${minutesLabel(remaining)}`}</span></div><div class="boss-bar"><span style="width:${dealt}%"></span></div></div>`;}).join('');
  return `<section class="card"><p class="eyebrow">BOSS MODE</p><h2>締切ボス</h2><p class="muted">進めた分だけHPが減る。大きい課題を“倒す対象”として見える化します。</p><div class="boss-list">${cards}</div></section>`;
}
function saveTodaySnapshot(plan, manualMode) {
  if (selectedDay !== dateKey()) return;
  const sleep=sleepPlanForDay(selectedDay);
  const snap = { date:selectedDay, updatedAt:new Date().toISOString(), manualMode, energyState:dayStates[selectedDay]||'normal', classDay:plan.classDay, wakeTime:sleep.wakeTime, plannedWakeTime:sleep.plannedWakeTime, actualWakeTime:sleep.actualWakeTime||null, wokeAt:sleep.wokeAt||null, bedTime:sleep.bedTime, nextWakeTime:sleep.nextWakeTime, plannedSleepMinutes:plannedSleepMinutes(selectedDay), scheduledTaskMinutes:Math.round(plan.scheduledTaskMinutes), scheduledTaskPages:Math.round(plan.scheduledTaskPages||0), morningRoutineMinutes:(plan.morningRoutine||[]).reduce((sum,x)=>sum+(x.end-x.start),0), relaxedMinutes:Math.round(plan.relaxedMinutes), rawFreeMinutes:Math.round(plan.rawFreeMinutes), timeline:plan.timeline.map(x=>({type:x.type,taskId:x.taskId||null,title:x.title,start:Math.round(x.start),end:Math.round(x.end),pages:Number(x.pages||0),movable:x.movable!==false})) };
  const before = planSnapshots[selectedDay];
  const comparable = o => JSON.stringify({...o,updatedAt:undefined});
  if (!before || comparable(before)!==comparable(snap)) { planSnapshots[selectedDay]=snap; persist(); }
}

function renderAll(){ renderToday(); renderNow(); renderTimetable(); renderTasks(); renderIdeas(); renderHistory(); renderSettings(); }

function renderNow(){
  if(!dayHasStarted(dateKey())){ $('nowTab').innerHTML=wakeGateMarkup('now'); const b=$('wakeNow-now'); if(b)b.onclick=markAwakeNow; return; }
  const plan = currentPlan(dateKey());
  const now = new Date(); const nowMin=now.getHours()*60+now.getMinutes();
  const nextTask = nextPendingWorkItem(plan, dateKey(), nowMin);
  const motivationHtml = motivationPanel(dateKey(), plan);
  if (activeSession) {
    const elapsed = Math.max(1,Math.round((Date.now()-new Date(activeSession.startedAt))/60000));
    $('nowTab').innerHTML = `${motivationHtml}<div class="focus-screen"><p class="eyebrow">ACTIVE SESSION</p><h2>${esc(activeSession.title)}</h2><div class="focus-big">${activeSession.plannedPages ? `${activeSession.plannedPages}ページ` : activeSession.taskId ? minutesLabel(activeSession.plannedMinutes||0) : '生活タスク'}</div><p class="focus-timer" id="focusTimer">${minutesLabel(elapsed)}</p><div class="focus-actions"><button id="finishSession" class="primary">完了</button><button id="partialSession" class="secondary">途中終了</button><button id="cancelSession" class="ghost">中断（記録しない）</button></div><p class="muted">開始後はここだけ見ればOK。ページ学習なら実績から速度も自動学習します。</p></div>`;
    $('finishSession').onclick=()=>finishActiveSession(false); $('partialSession').onclick=()=>finishActiveSession(true); $('cancelSession').onclick=()=>{ if(confirm('このセッションを記録せず中断しますか？')){const ended=new Date().toISOString(),session={...activeSession};recordOperation('session_cancelled','セッションを中断',{taskId:session.taskId||null,taskTitle:session.title,startedAt:session.startedAt,endedAt:ended,elapsedMinutes:Math.max(1,Math.round((Date.now()-new Date(session.startedAt))/60000))},session.day);activeSession=null;persist();renderNow();} };
    clearInterval(sessionTimer); sessionTimer=setInterval(()=>{ const el=$('focusTimer'); if(el&&activeSession) el.textContent=minutesLabel(Math.max(1,Math.round((Date.now()-new Date(activeSession.startedAt))/60000))); },15000);
    return;
  }
  clearInterval(sessionTimer);
  $('nowTab').innerHTML = `${motivationHtml}<div class="focus-screen"><p class="eyebrow">NEXT ACTION</p>${nextTask ? `<h2>${esc(nextTask.title)}</h2><div class="focus-big">${nextTask.pages ? `${nextTask.pages}ページ` : minutesLabel(nextTask.end-nextTask.start)}</div><p class="muted">${timeLabel(nextTask.start)}–${timeLabel(nextTask.end)}${nextTask.movable===false?' ・ 固定':''}</p><button id="startNext" class="primary focus-start">START</button>` : '<h2>今やる課題はありません</h2><p class="muted">今日の必要分が終わっているか、課題が未登録です。</p>'}</div>`;
  if($('startNext')) $('startNext').onclick=()=>startSession(nextTask);
  document.querySelectorAll('.completeChallenge').forEach(b=>b.onclick=()=>completeChallenge(dateKey()));
}
function startSession(item){
  if(!item) return; if(activeSession && !confirm('現在のセッションを置き換えますか？')) return;
  activeSession={id:uid(),day:dateKey(),taskId:item.taskId||null,title:item.title,plannedPages:Number(item.pages||0),plannedMinutes:Number(item.end-item.start||0),plannedStart:Number(item.start||0),plannedEnd:Number(item.end||0),planKey:completionKeyForItem(item),kind:item.type,startedAt:new Date().toISOString()};
  recordOperation('session_started','作業を開始',{sessionId:activeSession.id,taskId:activeSession.taskId,taskTitle:activeSession.title,plannedPages:activeSession.plannedPages,plannedMinutes:activeSession.plannedMinutes,startedAt:activeSession.startedAt,planKey:activeSession.planKey},activeSession.day);
  persist(); renderNow();
}
function finishActiveSession(partial){
  if(!activeSession) return;
  const elapsed=Math.max(1,Math.round((Date.now()-new Date(activeSession.startedAt))/60000));
  let pages=0, completeTimeTask=false;
  if(activeSession.taskId){
    const task=tasks.find(t=>t.id===activeSession.taskId);
    if(Number.isFinite(Number(task?.remainingPages))){
      const def=Math.min(Number(activeSession.plannedPages||task?.minPages||1),Number(task?.remainingPages||0));
      const answer=prompt(partial?'実際に進んだページ数を入力':'完了したページ数を入力',String(def)); if(answer===null) return;
      pages=Math.max(0,Math.min(Number(task?.remainingPages||0),Number(answer||0))); if(pages<=0) return notice('1ページ以上を入力してください。');
    } else if(task) {
      completeTimeTask = partial ? false : confirm('このタスク自体は完了しましたか？\nOK＝完了、キャンセル＝まだ残りあり');
    }
  }
  const session={...activeSession}, endedAt=new Date().toISOString();
  const completionKey=session.planKey || (session.kind==='life' ? `life:${session.title}:${session.day}` : `session:${session.id}`);
  recordCompletion({taskId:session.taskId,title:session.title,kind:session.kind,pages,minutes:elapsed,completeTimeTask,key:completionKey,source:'session',date:session.day});
  recordOperation(partial?'session_partial':'session_completed',partial?'作業を途中終了':'作業を完了',{sessionId:session.id,taskId:session.taskId,taskTitle:session.title,startedAt:session.startedAt,endedAt,pages,minutes:elapsed,completeTimeTask},session.day);
  activeSession=null; persist(); renderAll();
}
function recordCompletion({taskId,title,kind='task',pages=0,minutes=0,completeTimeTask=false,key,source='manual',date=selectedDay||dateKey()}){
  if(key && activityLog.some(a=>a.key===key)) return;
  if(kind==='task'&&taskId){
    tasks=tasks.map(t=>{
      if(t.id!==taskId)return t;
      if(Number.isFinite(Number(t.remainingPages))) return {...t,remainingPages:Math.max(0,Number(t.remainingPages||0)-Number(pages||0))};
      if(Number.isFinite(Number(t.remainingMinutes))) return {...t,remainingMinutes:completeTimeTask?0:Math.max(0,Number(t.remainingMinutes||0)-Number(minutes||0))};
      return t;
    });
  }
  const completedAt=new Date().toISOString();
  activityLog.unshift({id:uid(),date,completedAt,kind,taskId:taskId||null,title,minutes:Number(minutes||0),pages:Number(pages||0),completeTimeTask:Boolean(completeTimeTask),key:key||uid(),source});
  const expGain = kind==='life' ? Math.max(15,Math.round(Number(minutes||0)*0.8)) : Number(pages||0)>0 ? Math.max(20,Math.round(Number(pages||0)*6 + Number(minutes||0)*0.35)) : Math.max(20,Math.round(Number(minutes||0)*1.1));
  awardExp(expGain, kind==='life'?'生活タスク完了':'作業完了',{taskId:taskId||null,taskTitle:title,pages:Number(pages||0),minutes:Number(minutes||0)},date);
  addVictory(kind==='life'?`${title}を回収`:`${title}を進めた`,{taskId:taskId||null,pages:Number(pages||0),minutes:Number(minutes||0)},date);
  const completedTask = taskId ? tasks.find(t=>t.id===taskId) : null;
  evaluateTitles(date,{taskCompleted:Boolean(completedTask && (Number(completedTask.remainingPages||0)<=0 || Number(completedTask.remainingMinutes||0)<=0 || completeTimeTask))});
  checkMissionBonus(date, planSnapshots[date]||currentPlan(date));
  if(source!=='session') recordOperation(kind==='life'?'life_completed':'task_progress_recorded',kind==='life'?`${title}を完了`:'作業実績を記録',{taskId:taskId||null,taskTitle:title,pages:Number(pages||0),minutes:Number(minutes||0),completeTimeTask:Boolean(completeTimeTask),source,completedAt},date);
  if(taskId) recomputeTaskSpeed(taskId);
  persist();
}
function recomputeTaskSpeed(taskId){
  const t=tasks.find(x=>x.id===taskId); if(!t) return;
  const samples=activityLog.filter(a=>a.kind==='task'&&a.taskId===taskId&&Number(a.pages)>0&&Number(a.minutes)>0).slice(0,10);
  if(!samples.length) return;
  const totalP=samples.reduce((s,a)=>s+Number(a.pages),0), totalM=samples.reduce((s,a)=>s+Number(a.minutes),0);
  const actual=Math.max(.25,Math.min(30,totalM/Math.max(1,totalP)));
  const base=Number(t.baseMinutesPerPage||t.minutesPerPage||3); const w=Math.min(.9,.25+samples.length*.13); const learned=base*(1-w)+actual*w;
  tasks=tasks.map(x=>x.id===taskId?{...x,learnedMinutesPerPage:Number(learned.toFixed(2)),minutesPerPage:Number(learned.toFixed(2)),speedSamples:samples.length}:x);
}

function renderToday(){
  const manualMode=dayModes[selectedDay]||'auto', energyState=dayStates[selectedDay]||'normal';
  if(selectedDay===dateKey()&&!dayHasStarted(selectedDay)){
    $('todayTab').innerHTML=`${wakeGateMarkup('today')}<div class="wake-preview-nav"><label>別の日を確認<input id="dayPicker" class="date-input light" type="date" value="${selectedDay}"></label></div>`;
    $('dayPicker').onchange=e=>{selectedDay=e.target.value;renderToday();}; const b=$('wakeNow-today'); if(b)b.onclick=markAwakeNow; return;
  }
  const plan=currentPlan(selectedDay); saveTodaySnapshot(plan,manualMode);
  const sleep=sleepPlanForDay(selectedDay), tomorrow=addDays(selectedDay,1), sleepMinutes=plannedSleepMinutes(selectedDay);
  const risks=currentRisks();
  const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes(); const next=nextVisibleTimelineItem(plan,selectedDay,nowMin);
  const motivationToday = motivationPanel(selectedDay, plan);
  const morningAdjustHtml = plan.morningAdjustment && plan.morningAdjustment.mode !== 'full' ? `<section class="card warning-card"><h3>朝の予定に合わせて朝ルーティンを自動修正</h3><p class="muted">本来 ${minutesLabel(plan.morningAdjustment.requestedMinutes)} の朝トレ・朝食を、朝の固定予定に間に合うよう ${minutesLabel(plan.morningAdjustment.scheduledMinutes)} に短縮しました。</p></section>` : '';
  const riskHtml=risks.filter(r=>r.level!=='green').map(r=>`<div class="risk-row ${r.level}"><div><strong>${esc(r.title)}</strong><small>${esc(r.text)}</small></div><span>${esc(r.action)}</span></div>`).join('');
  const pending=plan.allDayPending.map(e=>`<div class="resolver" data-event-id="${esc(e.id)}"><strong>${esc(e.title)}</strong><p class="muted">終日予定は自動では一日拘束にしません。</p><div class="segmented"><button class="selected" data-kind="timed">実時間あり</button><button data-kind="memo">予定メモ</button></div><div class="resolver-fields form-grid compact"><label>開始<input type="time" class="all-start" value="13:00"></label><label>終了<input type="time" class="all-end" value="15:00"></label><label>時間考慮<select class="all-buffer"><option value="none">なし</option><option value="small">小</option><option value="medium" selected>中</option><option value="large">大</option></select></label></div><button class="primary small resolve-save">確定</button></div>`).join('');
  const bufferRows=(plan.eventBufferInfo||[]).map(e=>`<div class="event-buffer-row" data-event-id="${esc(e.id)}"><div><strong>${esc(e.title)}</strong><small>${timeLabel(e.start)}–${timeLabel(e.end)} ・ 前${Math.round(e.before)}分 / 後${Math.round(e.after)}分</small></div><label>時間考慮<select class="event-buffer-select"><option value="auto" ${e.selection==='auto'?'selected':''}>自動</option><option value="none" ${e.selection==='none'?'selected':''}>なし</option><option value="small" ${e.selection==='small'?'selected':''}>小</option><option value="medium" ${e.selection==='medium'?'selected':''}>中</option><option value="large" ${e.selection==='large'?'selected':''}>大</option><option value="custom" ${e.selection==='custom'?'selected':''}>カスタム</option></select></label><div class="custom-buffer-fields ${e.selection==='custom'?'':'hidden'}"><label>前（分）<input type="number" min="0" class="custom-before" value="${Math.round(e.before)}"></label><label>後（分）<input type="number" min="0" class="custom-after" value="${Math.round(e.after)}"></label><button class="primary small custom-buffer-save">保存</button></div></div>`).join('');
  const timeline=plan.timeline.map(x=>{
    const mins=x.end-x.start, completionKey=completionKeyForItem(x);
    const recorded=isItemCompleted(x,selectedDay); let action='';
    if(x.type==='task') action=recorded?'<span class="done-mark">記録済み</span>':`<button class="done-btn" data-task-id="${esc(x.taskId||'')}" data-mins="${mins}" data-pages="${Number(x.pages||0)}" data-kind="task" data-title="${esc(x.title)}" data-key="${esc(completionKey)}">実績</button>`;
    if(x.type==='life') action=recorded?'<span class="done-mark">完了済み</span>':`<button class="done-btn" data-mins="${mins}" data-pages="0" data-kind="life" data-title="${esc(x.title)}" data-key="${esc(completionKey)}">完了</button>`;
    const amount=x.type==='task'&&x.pages?`${x.pages}ページ ・ ${minutesLabel(mins)}目安${x.movable===false?' ・ 固定':''}`:minutesLabel(mins);
    return `<div class="timeline-item ${x.type}"><div class="time">${timeLabel(x.start)}<br><span>${timeLabel(x.end)}</span></div><div class="timeline-body"><strong>${esc(x.title)}</strong><small>${amount}</small></div>${action}</div>`;
  }).join('');
  const close=closeouts[selectedDay];
  const quickRows=quickEventsForDay(selectedDay).map(e=>`<div class="quick-event-row"><div><strong>${esc(e.title)}</strong><small>${String(e.start).slice(11,16)}–${String(e.end).slice(11,16)} ・ 余白${e.bufferLevel==='none'?'なし':e.bufferLevel==='small'?'小':e.bufferLevel==='medium'?'中':'大'}</small></div><button class="danger-outline small delete-quick-event" data-id="${esc(e.id)}">削除</button></div>`).join('');
  const quickEventCard=`<section class="card quick-event-card"><h3>急な用事を追加</h3><p class="muted">予定前・予定中・予定後のどのタイミングでも入力できます。保存すると、その時点で1日の計画を組み直します。</p><form id="quickEventForm" class="form-grid compact"><label class="span2">用事名<input name="quickTitle" placeholder="例：急な面談・買い物・電話" required></label><label>開始<input name="quickStart" type="time" value="${hhmm()}" required></label><label>終了<input name="quickEnd" type="time" required></label><label>前後余白<select name="quickBuffer"><option value="none">なし</option><option value="small" selected>小</option><option value="medium">中</option><option value="large">大</option></select></label><button class="primary small">追加して再計算</button></form>${quickRows?`<div class="quick-event-list">${quickRows}</div>`:''}</section>`;
  $('todayTab').innerHTML=`<div class="stack"><section class="hero-card"><div class="row between"><div><p class="eyebrow">TODAY</p><input id="dayPicker" class="date-input" type="date" value="${selectedDay}"></div><label class="mode-select-wrap">日モード<select id="dayModeSelect" class="mode-select ${plan.classDay?'class':''}"><option value="auto" ${manualMode==='auto'?'selected':''}>自動判定</option><option value="class" ${manualMode==='class'?'selected':''}>授業日</option><option value="noClass" ${manualMode==='noClass'?'selected':''}>授業なし日</option></select></label></div><div class="energy-row"><span>今日の状態</span><div class="segmented energy-select"><button data-energy="high" ${energyState==='high'?'class="selected"':''}>元気</button><button data-energy="normal" ${energyState==='normal'?'class="selected"':''}>普通</button><button data-energy="tired" ${energyState==='tired'?'class="selected"':''}>疲れ</button></div></div><div class="daily-routine-row"><span>今日の自主練</span><label class="switch-label"><input id="dailyMorningTrainingToggle" type="checkbox" ${morningTrainingEnabledForDay(selectedDay)?'checked':''}> この日に入れる</label></div><div class="metrics"><div><span>予定した課題量</span><strong>${Number(plan.scheduledTaskPages||0)}頁 / ${minutesLabel(plan.scheduledTaskMinutes||0)}</strong></div><div><span>ゆったり時間</span><strong>${minutesLabel(plan.relaxedMinutes)}</strong></div></div><div class="next-action"><p>NEXT ACTION</p>${close?'<h2>今日は運用終了</h2><strong>残りは自動で明日以降へ再計画されます</strong>':next?`<h2>${esc(next.title)}</h2><strong>${timeLabel(next.start)}–${timeLabel(next.end)}</strong>`:'<h2>今日はもう予定なし</h2>'}</div></section>${motivationToday}${morningAdjustHtml}<section class="card sleep-plan-card"><div class="row between"><div><p class="eyebrow">SLEEP PLAN</p><h3>今日の睡眠予定</h3></div><span class="sleep-duration">睡眠 ${minutesLabel(sleepMinutes)}</span></div><form id="dailySleepForm" class="form-grid"><label>今日の起床${sleep.actualWakeTime?'実績':'予定'}<input type="time" value="${sleep.actualWakeTime||sleep.plannedWakeTime}" disabled></label><label>今日の就寝予定<input type="time" name="bedTime" value="${sleep.bedTime}"></label><label>${tomorrow.slice(5).replace('-', '/')} の起床予定<input type="time" name="nextWakeTime" value="${sleep.nextWakeTime}"></label><div class="sleep-plan-note">${sleep.actualWakeTime?`起床予定 ${sleep.plannedWakeTime} ／ 実際 ${sleep.actualWakeTime}。今日の計画は実際の起床時刻から作成しています。`:`未来日の計画は起床予定 ${sleep.plannedWakeTime} から仮計算します。`} 就寝予定から、お風呂・肌ケアと作業可能時間も再計算します。</div><div class="span2 row"><button class="primary small">保存して再計算</button><button type="button" id="resetSleepPlan" class="secondary small">標準時刻に戻す</button>${selectedDay===dateKey()&&sleep.actualWakeTime?'<button type="button" id="editWakeTime" class="ghost small">起床時刻を修正</button>':''}</div></form></section>${riskHtml?`<section class="card"><h3>期限リスク</h3><div class="risk-list">${riskHtml}</div></section>`:''}${pending?`<section class="card"><h3>終日予定を確認</h3>${pending}</section>`:''}${bufferRows?`<section class="card"><h3>既存予定の前後余白</h3><p class="muted">予定本体は変えず、前後だけLife OS内で確保します。</p><div class="event-buffer-list">${bufferRows}</div></section>`:''}${quickEventCard}<section class="card"><h3>今日の達成予定</h3><div class="timeline">${timeline||'<p class="muted">予定・課題がまだありません。</p>'}</div><div class="relaxed-band">ゆったり時間　${minutesLabel(plan.relaxedMinutes)}</div>${!isNativeIOS()?'<button id="syncPlanCalendar" class="primary">Google Calendarへ同期（通知）</button>':''}</section><section class="card night-card"><h3>今日を終了する</h3>${close?`<p class="success-note">${new Date(close.closedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} に終了済み。残った課題は自動再計画対象です。</p>`:`<div class="check-list"><label><input id="closeBath" type="checkbox"> お風呂</label><label><input id="closeSkin" type="checkbox"> 肌ケア</label><label><input id="closePrep" type="checkbox"> 明日の準備</label></div><button id="closeDay" class="primary">今日の運用を終了</button><p class="muted">未完了ページは残量として保持され、明日以降の計画に自動で戻ります。</p>`}</section></div>`;
  $('dayPicker').onchange=e=>{selectedDay=e.target.value;renderToday();};
  $('dayModeSelect').onchange=e=>{const before=dayModes[selectedDay]||'auto',after=e.target.value;if(after==='auto') delete dayModes[selectedDay]; else dayModes[selectedDay]=after;recordOperation('day_mode_changed','授業日モードを変更',{before,after},selectedDay);persist();renderToday();renderHistory();};
  if($('dailyMorningTrainingToggle')) $('dailyMorningTrainingToggle').onchange=e=>setMorningTrainingForDay(selectedDay,e.target.checked);
  if($('quickEventForm')) $('quickEventForm').onsubmit=e=>{e.preventDefault();addQuickEventFromForm(selectedDay,Object.fromEntries(new FormData(e.target).entries()));};
  document.querySelectorAll('.delete-quick-event').forEach(b=>b.onclick=()=>deleteQuickEvent(b.dataset.id,selectedDay));
  $('dailySleepForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),before=dailySleepPlans[selectedDay]||null;dailySleepPlans[selectedDay]={bedTime:d.bedTime||settings.bedTime,nextWakeTime:d.nextWakeTime||settings.wakeTime,updatedAt:new Date().toISOString()};recordOperation('sleep_plan_saved','睡眠予定を変更',{before,after:{bedTime:dailySleepPlans[selectedDay].bedTime,nextWakeTime:dailySleepPlans[selectedDay].nextWakeTime}},selectedDay);persist();renderAll();notice('睡眠予定を保存して、今日と明日の計画を再計算しました。');};
  $('resetSleepPlan').onclick=()=>{const before=dailySleepPlans[selectedDay]||null;delete dailySleepPlans[selectedDay];recordOperation('sleep_plan_reset','睡眠予定を標準時刻へ戻す',{before,standardBedTime:settings.bedTime,standardNextWakeTime:settings.wakeTime},selectedDay);persist();renderAll();notice('この日の睡眠予定を標準時刻に戻しました。');};
  if($('editWakeTime')) $('editWakeTime').onclick=()=>editActualWakeTime(selectedDay);
  document.querySelectorAll('[data-energy]').forEach(b=>b.onclick=()=>{const before=dayStates[selectedDay]||'normal',after=b.dataset.energy;dayStates[selectedDay]=after;recordOperation('energy_changed','今日の状態を変更',{before,after},selectedDay);persist();renderToday();renderNow();});
  document.querySelectorAll('.done-btn').forEach(b=>b.onclick=()=>{
    const kind=b.dataset.kind, id=b.dataset.taskId, plannedPages=Number(b.dataset.pages||0), plannedMins=Number(b.dataset.mins||0);
    if(kind==='life'){recordCompletion({kind:'life',title:b.dataset.title,minutes:plannedMins,key:b.dataset.key});renderAll();return;}
    const task=tasks.find(t=>t.id===id); if(!task)return;
    if(Number.isFinite(Number(task.remainingPages))){ let p=prompt('実際に進んだページ数',String(Math.min(plannedPages,Number(task.remainingPages||plannedPages)))); if(p===null)return; p=Math.max(0,Math.min(Number(task.remainingPages||0),Number(p||0))); if(!p)return notice('1ページ以上を入力してください。'); let m=prompt('実際にかかった時間（分）',String(plannedMins)); if(m===null)return; m=Math.max(1,Number(m||plannedMins)); recordCompletion({taskId:id,title:b.dataset.title,pages:p,minutes:m,key:b.dataset.key,source:'manual'}); }
    else { let m=prompt('実際に作業した時間（分）',String(plannedMins)); if(m===null)return; m=Math.max(1,Number(m||plannedMins)); const complete=confirm('このタスクは完了しましたか？\nOK＝完了、キャンセル＝途中'); recordCompletion({taskId:id,title:b.dataset.title,minutes:m,completeTimeTask:complete,key:b.dataset.key,source:'manual'}); }
    renderAll();
  });
  document.querySelectorAll('.resolver').forEach(r=>{let kind='timed';r.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;r.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('selected',x===b));r.querySelector('.resolver-fields').classList.toggle('hidden',kind==='memo');});r.querySelector('.resolve-save').onclick=()=>{const eventId=r.dataset.eventId,before=overrides[eventId]||null;overrides[eventId]=kind==='memo'?{kind:'memo'}:{kind:'timed',startTime:r.querySelector('.all-start').value,endTime:r.querySelector('.all-end').value,bufferLevel:r.querySelector('.all-buffer').value};recordOperation('all_day_event_resolved','終日予定の扱いを確定',{eventId,before,after:overrides[eventId]},selectedDay);persist();renderToday();};});
  document.querySelectorAll('.event-buffer-row').forEach(row=>{const sel=row.querySelector('.event-buffer-select'),custom=row.querySelector('.custom-buffer-fields');sel.onchange=()=>{if(sel.value==='custom'){custom.classList.remove('hidden');return;}const eventId=row.dataset.eventId,before=overrides[eventId]||null;if(sel.value==='auto')delete overrides[eventId];else overrides[eventId]={kind:'buffer',bufferLevel:sel.value};recordOperation('event_buffer_changed','予定の前後余白を変更',{eventId,before,after:overrides[eventId]||{kind:'auto'}},selectedDay);persist();renderToday();};row.querySelector('.custom-buffer-save').onclick=()=>{const eventId=row.dataset.eventId,before=overrides[eventId]||null;overrides[eventId]={kind:'bufferCustom',before:Math.max(0,Number(row.querySelector('.custom-before').value||0)),after:Math.max(0,Number(row.querySelector('.custom-after').value||0))};recordOperation('event_buffer_changed','予定の前後余白を変更',{eventId,before,after:overrides[eventId]},selectedDay);persist();renderToday();};});
  document.querySelectorAll('.completeChallenge').forEach(b=>b.onclick=()=>completeChallenge(selectedDay));
  if($('syncPlanCalendar')) $('syncPlanCalendar').onclick=()=>syncPlanToGoogleCalendar(plan);
  if($('closeDay')) $('closeDay').onclick=()=>{const closedAt=new Date().toISOString();closeouts[selectedDay]={bath:$('closeBath').checked,skincare:$('closeSkin').checked,prep:$('closePrep').checked,closedAt};activityLog.unshift({id:uid(),date:selectedDay,completedAt:closedAt,kind:'closeout',title:'一日終了',minutes:0,pages:0,key:`closeout:${selectedDay}`});recordOperation('day_closed','今日の運用を終了',{...closeouts[selectedDay]},selectedDay);if(!motivation.closeoutBonusDays.includes(selectedDay)){motivation.closeoutBonusDays.push(selectedDay);awardExp(30,'今日の運用終了',{...closeouts[selectedDay]},selectedDay);addVictory('今日の運用を終了できた',{...closeouts[selectedDay]},selectedDay);}evaluateTitles(selectedDay);checkMissionBonus(selectedDay,planSnapshots[selectedDay]||plan);persist();renderAll();};
  syncNativePlan(plan);
}

const WEEKDAY_LABELS={0:'日',1:'月',2:'火',3:'水',4:'木',5:'金',6:'土'};
function semesterLabel(s){return `${s.academicYear}年度 ${s.term==='fall'?'秋学期':'春学期'}`;}
function getSelectedSemester(){ if(!semesters.length)return null; let sem=semesters.find(x=>x.id===selectedSemesterId); if(!sem){sem=semesters[0];selectedSemesterId=sem.id;} return sem; }
function courseOptions(selected=''){ return semesters.flatMap(sem=>sem.courses.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.name)}（${semesterLabel(sem)}）</option>`)).join(''); }
function sessionDates(sem,limit=28){
  if(!sem)return[]; const today=dateKey(); let from=today<sem.startDate?sem.startDate:today>sem.endDate?sem.startDate:today; const out=[];
  for(let i=0;i<Math.min(120,Math.max(limit,28)*4)&&out.length<limit;i++){const day=addDays(from,i);if(day>sem.endDate)break;const dow=new Date(`${day}T12:00:00`).getDay();sem.courses.filter(c=>Number(c.weekday)===dow).forEach(course=>out.push({day,course,status:effectiveClassStatus(course,day),exception:classExceptions[exceptionKey(course.id,day)]||null}));}
  return out.slice(0,limit);
}
function onDemandSourceKey(courseId,day){return `class-ondemand:${courseId}:${day}`;}
function createOnDemandTask(course,day){
  const key=onDemandSourceKey(course.id,day), existing=tasks.find(t=>t.sourceKey===key);
  const minutes=Math.max(10,Number(prompt('オンデマンド視聴・作業の予想時間（分）',String(existing?.remainingMinutes||course.onDemandMinutes||90))||0)); if(!minutes)return;
  const deadline=prompt('期限日（YYYY-MM-DD）',existing?.deadline||day); if(!deadline)return;
  const deadlineTime=prompt('期限時刻（HH:MM）',existing?.deadlineTime||'23:59')||'23:59';
  const quantityText=prompt('量のメモ（任意：例「動画1本＋小テスト」）',existing?.quantityText||'動画1回') ?? '';
  const obj=normalizeTask({...(existing||{}),id:existing?.id||uid(),taskType:'classAssignment',courseId:course.id,assignmentType:'ondemand',title:`${course.name}（オンデマンド）`,deadline,deadlineTime,remainingMinutes:minutes,initialMinutes:existing?.initialMinutes||minutes,quantityText,priority:'high',focus:'maintain',mode:'maintain',timePreference:'any',minBlock:20,maxBlock:Math.max(30,Math.min(120,minutes)),placement:'flexible',source:'classOndemand',sourceKey:key,status:'active'});
  if(existing)tasks=tasks.map(t=>t.id===existing.id?obj:t);else tasks.push(obj);recordOperation(existing?'task_updated':'task_created',existing?'オンデマンド課題を更新':'オンデマンド課題を追加',{taskId:obj.id,taskTitle:obj.title,courseId:course.id,deadline,deadlineTime,remainingMinutes:minutes,quantityText,source:'classOndemand'},day);persist();renderAll();notice('オンデマンド授業を課題に追加しました。');
}
function openCourseTaskDraft(courseId,type='weekly'){
  const found=courseForId(courseId); if(!found)return; const {course}=found;
  taskDraft={taskType:'classAssignment',courseId:course.id,assignmentType:type,title:`${course.name}：`,deadline:addDays(dateKey(),7),deadlineTime:'23:59',remainingMinutes:60,quantityText:'',priority:'high',focus:'maintain',mode:'maintain',timePreference:'any',minBlock:20,maxBlock:90,placement:'flexible',fixedDate:dateKey(),fixedTime:'09:00'};
  editingTaskId=null; activateTab('tasks'); renderTasks(); window.scrollTo({top:0,behavior:'smooth'});
}
function renderTimetable(){
  const sem=getSelectedSemester();
  const semesterOptions=semesters.map(x=>`<option value="${x.id}" ${x.id===selectedSemesterId?'selected':''}>${semesterLabel(x)}</option>`).join('');
  const periodRows=sem?(sem.periods||[]).map(p=>`<div class="period-row" data-no="${p.no}"><strong>${p.no}限</strong><input type="time" class="period-start" value="${p.start}"><span>〜</span><input type="time" class="period-end" value="${p.end}"></div>`).join(''):'';
  const courses=sem?(sem.courses||[]).map(c=>`<div class="course-row"><div><strong>${esc(c.name)}</strong><small>${Number(c.weekday)<0?'曜日指定なし':`${WEEKDAY_LABELS[c.weekday]}曜`}${Number(c.periodNo)>0?` ${c.periodNo}限`:'・コマなし'} ・ ${c.defaultDelivery==='ondemand'?'標準オンデマンド':'通常授業'}${c.location?` ・ ${esc(c.location)}`:''}</small></div><div class="row"><button class="secondary small course-assignment" data-id="${c.id}">課題追加</button><button class="icon-btn edit-course" data-id="${c.id}">編集</button><button class="icon-btn delete-course" data-id="${c.id}">削除</button></div></div>`).join(''):'';
  const sessions=sem?sessionDates(sem,32).map(({day,course,status})=>{const task=tasks.find(t=>t.sourceKey===onDemandSourceKey(course.id,day));return `<div class="class-session-row" data-course-id="${course.id}" data-day="${day}"><div><strong>${day.slice(5).replace('-','/')}（${WEEKDAY_LABELS[new Date(`${day}T12:00:00`).getDay()]}） ${esc(course.name)}</strong><small>${status==='cancelled'?'休講':status==='ondemand'?'オンデマンド':`${course.periodNo}限・通常`} ${task?'・課題化済み':''}</small></div><select class="class-status"><option value="default" ${!classExceptions[exceptionKey(course.id,day)]?'selected':''}>標準</option><option value="normal" ${classExceptions[exceptionKey(course.id,day)]?.status==='normal'?'selected':''}>通常授業</option><option value="cancelled" ${classExceptions[exceptionKey(course.id,day)]?.status==='cancelled'?'selected':''}>休講</option><option value="ondemand" ${classExceptions[exceptionKey(course.id,day)]?.status==='ondemand'?'selected':''}>オンデマンド</option></select>${status==='ondemand'?`<button class="secondary small make-ondemand-task">${task?'課題を編集':'課題化'}</button>`:''}</div>`;}).join(''):'';
  const editCourse=sem?.courses.find(c=>c.id===editingCourseId); const cf=editCourse||{name:'',weekday:1,periodNo:1,defaultDelivery:'normal',onDemandMinutes:90,bufferLevel:'small',location:''};
  $('timetableTab').innerHTML=`<div class="stack"><section class="card"><p class="eyebrow">SEMESTER</p><h2>学期・時間割</h2><div class="form-grid"><label>表示する学期<select id="semesterSelect"><option value="">選択</option>${semesterOptions}</select></label><span class="muted">学期ごとに時間割を分けて保存</span></div><form id="semesterForm" class="form-grid semester-form"><label>学年（年度）<input type="number" name="academicYear" value="${new Date().getFullYear()}"></label><label>学期<select name="term"><option value="spring">春学期</option><option value="fall">秋学期</option></select></label><label>開始日<input type="date" name="startDate" value="${dateKey()}"></label><label>終了日<input type="date" name="endDate" value="${addDays(dateKey(),120)}"></label><button class="primary span2">学期を追加</button></form></section>${sem?`<section class="card"><div class="row between"><div><p class="eyebrow">${semesterLabel(sem)}</p><h2>学期設定</h2></div><button id="deleteSemester" class="ghost">この学期を削除</button></div><form id="semesterEditForm" class="form-grid"><label>年度<input type="number" name="academicYear" value="${sem.academicYear}"></label><label>学期<select name="term"><option value="spring" ${sem.term==='spring'?'selected':''}>春学期</option><option value="fall" ${sem.term==='fall'?'selected':''}>秋学期</option></select></label><label>開始日<input type="date" name="startDate" value="${sem.startDate}"></label><label>終了日<input type="date" name="endDate" value="${sem.endDate}"></label><button class="secondary span2">学期情報を保存</button></form><h3 class="section-gap">各コマの時刻</h3><div class="period-list">${periodRows}</div><button id="savePeriods" class="secondary small">コマ時刻を保存</button></section><section class="card"><p class="eyebrow">COURSES</p><h2>${editCourse?'授業を編集':'授業を登録'}</h2><form id="courseForm" class="form-grid"><label class="span2">授業名<input name="name" required value="${esc(cf.name)}" placeholder="例：教育社会学"></label><label>曜日<select name="weekday"><option value="-1" ${Number(cf.weekday)===-1?'selected':''}>曜日指定なし（完全オンデマンド等）</option>${[1,2,3,4,5,6,0].map(d=>`<option value="${d}" ${Number(cf.weekday)===d?'selected':''}>${WEEKDAY_LABELS[d]}曜日</option>`).join('')}</select></label><label>コマ<select name="periodNo"><option value="0" ${Number(cf.periodNo)===0?'selected':''}>コマなし</option>${(sem.periods||DEFAULT_PERIODS).map(p=>`<option value="${p.no}" ${Number(cf.periodNo)===Number(p.no)?'selected':''}>${p.no}限（${p.start}〜${p.end}）</option>`).join('')}</select></label><label>標準形式<select name="defaultDelivery"><option value="normal" ${cf.defaultDelivery==='normal'?'selected':''}>通常授業</option><option value="ondemand" ${cf.defaultDelivery==='ondemand'?'selected':''}>オンデマンド</option></select></label><label>オンデマンド目安（分）<input type="number" name="onDemandMinutes" min="10" value="${cf.onDemandMinutes||90}"></label><label>予定前後の余白<select name="bufferLevel"><option value="none" ${cf.bufferLevel==='none'?'selected':''}>なし</option><option value="small" ${cf.bufferLevel==='small'?'selected':''}>小</option><option value="medium" ${cf.bufferLevel==='medium'?'selected':''}>中</option><option value="large" ${cf.bufferLevel==='large'?'selected':''}>大</option></select></label><label>場所（任意）<input name="location" value="${esc(cf.location||'')}"></label><div class="span2 row"><button class="primary">${editCourse?'更新':'登録'}</button>${editCourse?'<button type="button" id="cancelCourseEdit" class="secondary">編集終了</button>':''}</div></form><div class="course-list section-gap">${courses||'<p class="muted">授業はまだ登録されていません。</p>'}</div></section><section class="card"><p class="eyebrow">CLASS CHANGES</p><h2>今後の授業回</h2><p class="muted">各日だけ「休講」「オンデマンド」「通常」に変更できます。オンデマンドにした回は、その場で臨時課題にできます。</p><div class="class-session-list">${sessions||'<p class="muted">この学期の授業回はありません。</p>'}</div></section>`:''}</div>`;
  $('semesterSelect').onchange=e=>{selectedSemesterId=e.target.value;editingCourseId=null;renderTimetable();};
  $('semesterForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const semNew=normalizeSemester({id:uid(),academicYear:Number(d.academicYear),term:d.term,startDate:d.startDate,endDate:d.endDate,periods:DEFAULT_PERIODS,courses:[]});semesters.push(semNew);selectedSemesterId=semNew.id;recordOperation('semester_created','学期を追加',{semesterId:semNew.id,label:semesterLabel(semNew),startDate:semNew.startDate,endDate:semNew.endDate});persist();renderAll();};
  if(!sem)return;
  $('semesterEditForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),before={academicYear:sem.academicYear,term:sem.term,startDate:sem.startDate,endDate:sem.endDate};semesters=semesters.map(x=>x.id===sem.id?normalizeSemester({...x,academicYear:Number(d.academicYear),term:d.term,startDate:d.startDate,endDate:d.endDate,name:`${d.academicYear}年度 ${d.term==='fall'?'秋学期':'春学期'}`}):x);const after=semesters.find(x=>x.id===sem.id);recordOperation('semester_updated','学期設定を変更',{semesterId:sem.id,before,after:{academicYear:after.academicYear,term:after.term,startDate:after.startDate,endDate:after.endDate}});persist();renderAll();};
  $('deleteSemester').onclick=()=>{if(!confirm(`${semesterLabel(sem)}を削除しますか？授業設定も削除されます。`))return;const label=semesterLabel(sem),courseIds=new Set(sem.courses.map(c=>c.id));semesters=semesters.filter(x=>x.id!==sem.id);Object.keys(classExceptions).forEach(k=>{if(courseIds.has(k.split(':')[0]))delete classExceptions[k];});selectedSemesterId=semesters[0]?.id||'';recordOperation('semester_deleted','学期を削除',{semesterId:sem.id,label,courseCount:courseIds.size});persist();renderAll();};
  $('savePeriods').onclick=()=>{const before=sem.periods,periods=[...document.querySelectorAll('.period-row')].map(r=>({no:Number(r.dataset.no),start:r.querySelector('.period-start').value,end:r.querySelector('.period-end').value}));semesters=semesters.map(x=>x.id===sem.id?{...x,periods}:x);recordOperation('period_times_changed','授業コマ時刻を変更',{semesterId:sem.id,before,after:periods});persist();renderAll();notice('コマ時刻を保存しました。');};
  $('courseForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),before=editCourse?{...editCourse}:null;const course=normalizeCourse({...(editCourse||{}),id:editCourse?.id||uid(),name:d.name,weekday:Number(d.weekday),periodNo:Number(d.periodNo),defaultDelivery:d.defaultDelivery,onDemandMinutes:Number(d.onDemandMinutes),bufferLevel:d.bufferLevel,location:d.location});semesters=semesters.map(x=>x.id===sem.id?{...x,courses:editCourse?x.courses.map(c=>c.id===editCourse.id?course:c):[...x.courses,course]}:x);recordOperation(editCourse?'course_updated':'course_created',editCourse?'授業を更新':'授業を登録',{semesterId:sem.id,courseId:course.id,courseName:course.name,before,after:course});editingCourseId=null;persist();renderAll();};
  if($('cancelCourseEdit'))$('cancelCourseEdit').onclick=()=>{editingCourseId=null;renderTimetable();};
  document.querySelectorAll('.edit-course').forEach(b=>b.onclick=()=>{editingCourseId=b.dataset.id;renderTimetable();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelectorAll('.delete-course').forEach(b=>b.onclick=()=>{if(!confirm('この授業を削除しますか？'))return;const id=b.dataset.id,course=sem.courses.find(c=>c.id===id);semesters=semesters.map(x=>x.id===sem.id?{...x,courses:x.courses.filter(c=>c.id!==id)}:x);Object.keys(classExceptions).forEach(k=>{if(k.startsWith(`${id}:`))delete classExceptions[k];});recordOperation('course_deleted','授業を削除',{semesterId:sem.id,courseId:id,courseName:course?.name||''});persist();renderAll();});
  document.querySelectorAll('.course-assignment').forEach(b=>b.onclick=()=>openCourseTaskDraft(b.dataset.id,'weekly'));
  document.querySelectorAll('.class-session-row').forEach(row=>{const course=sem.courses.find(c=>c.id===row.dataset.courseId),day=row.dataset.day,sel=row.querySelector('.class-status');sel.onchange=()=>{const v=sel.value,key=exceptionKey(course.id,day),before=classExceptions[key]?.status||'default';if(v==='default')delete classExceptions[key];else classExceptions[key]={status:v,updatedAt:new Date().toISOString()};if(v==='cancelled'||v==='normal'||v==='default'){const source=onDemandSourceKey(course.id,day);tasks=tasks.filter(t=>!(t.source==='classOndemand'&&t.sourceKey===source));}recordOperation('class_status_changed','授業回の状態を変更',{courseId:course.id,courseName:course.name,before,after:v},day);persist();renderAll();if(v==='ondemand'&&confirm('この回をオンデマンド課題として今すぐ登録しますか？'))createOnDemandTask(course,day);};const btn=row.querySelector('.make-ondemand-task');if(btn)btn.onclick=()=>createOnDemandTask(course,day);});
}


function taskFormValues(t){
  const base=t||taskDraft||{};
  const rangeStart=Number.isFinite(Number(base.rangeStart))?Number(base.rangeStart):1;
  const rangeEnd=Number.isFinite(Number(base.rangeEnd))?Number(base.rangeEnd):(Number(base.remainingPages||30)+rangeStart-1);
  return {
    taskType:base.taskType||'study', title:base.title||'', itemCode:base.itemCode||'', subject:base.subject||'英語',
    deadline:base.deadline||addDays(dateKey(),30), deadlineTime:base.deadlineTime||'23:59', deadlineStrict:Boolean(base.deadlineStrict), startDate:base.startDate||dateKey(),
    rangeStart, rangeEnd, rangeUnit:base.rangeUnit||'ページ', remainingPages:Number(base.remainingPages||Math.max(1,rangeEnd-rangeStart+1)),
    weeklyMultiplier:Number(base.weeklyMultiplier||1), pace:base.pace||'normal', learningDays:Array.isArray(base.learningDays)?base.learningDays:[], intervalDays:base.intervalDays||'',
    reviewTaskEnabled:Boolean(base.reviewTaskEnabled), reviewMaxPerDay:base.reviewMaxPerDay||'', thumbnailData:base.thumbnailData||'',
    baseMinutesPerPage:base.baseMinutesPerPage||base.minutesPerPage||3, remainingMinutes:base.remainingMinutes||60, quantityText:base.quantityText||'',
    courseId:base.courseId||'', assignmentType:base.assignmentType||'weekly', priority:base.priority||'medium', focus:base.focus||'main', mode:base.mode||'grow', timePreference:base.timePreference||'any',
    minPages:base.minPages||5, maxPages:base.maxPages||30, minBlock:base.minBlock||20, maxBlock:base.maxBlock||120,
    placement:base.placement||'flexible', fixedDate:base.fixedDate||dateKey(), fixedTime:base.fixedTime||'09:00', fixedPages:base.fixedPages||5, fixedMinutes:base.fixedMinutes||30
  };
}
function currentSubjects(){
  const base=Array.isArray(settings.subjects)?settings.subjects:[];
  const used=tasks.map(t=>String(t.subject||'').trim()).filter(Boolean);
  return [...new Set([...base,...used])].filter(Boolean);
}
function subjectOptions(selected=''){
  const list=currentSubjects();
  if(selected && !list.includes(selected)) list.push(selected);
  return list.map(x=>`<option value="${esc(x)}" ${x===selected?'selected':''}>${esc(x)}</option>`).join('');
}

function renderTasks(){
  const risks=Object.fromEntries(currentRisks().map(r=>[r.taskId,r])); const edit=tasks.find(t=>t.id===editingTaskId); const f=taskFormValues(edit); const isStudy=f.taskType==='study';
  const assignmentLabels={weekly:'週課題',midterm:'中間課題',final:'期末課題',ondemand:'オンデマンド',other:'その他'};
  const bosses=bossCardsHtml();
  const rangeTotal=Math.max(0,Number(f.rangeEnd||0)-Number(f.rangeStart||0)+1);
  const rows=tasks.map(t=>{const found=courseForId(t.courseId);const amount=Number.isFinite(Number(t.remainingPages))?`残り ${Number(t.remainingPages||0)}${esc(t.rangeUnit||'ページ')} ・ ${t.learnedMinutesPerPage?`学習値 ${t.learnedMinutesPerPage}分/単位`:`初期 ${t.baseMinutesPerPage||t.minutesPerPage}分/単位`}`:`残り目安 ${minutesLabel(t.remainingMinutes||0)}${t.quantityText?` ・ 量 ${esc(t.quantityText)}`:''}`;const source=t.taskType==='classAssignment'?`${found?.course?.name||'授業'}・${assignmentLabels[t.assignmentType]||'課題'}`:t.taskType==='general'?'その他タスク':'学習';const range=t.rangeStart&&t.rangeEnd?` ・ 範囲 ${t.rangeStart}〜${t.rangeEnd}${esc(t.rangeUnit||'')}`:'';return `<div class="task-row"><div><div class="row"><strong>${esc(t.title)}</strong>${riskBadge(risks[t.id])}</div><small>${esc(source)} ・ 期限 ${esc(deadlineLabel(t))}${range} ・ ${amount} ・ ${t.placement==='flexible'?'自動配置':t.placement==='date'?`${t.fixedDate}のみ`:`${t.fixedDate} ${t.fixedTime}固定`}${t.deadlineStrict?' ・ 期限死守':''}</small></div><span class="tag ${t.focus}">${t.focus==='main'?'メイン':t.focus==='sub'?'サブ':'維持'}</span><div class="row"><button class="icon-btn edit-task" data-id="${t.id}">編集</button><button class="icon-btn delete-task" data-id="${t.id}">削除</button></div></div>`;}).join('');
  const weekdayButtons=[1,2,3,4,5,6,0].map(d=>`<button type="button" class="weekday-btn ${f.learningDays.includes(d)?'selected':''}" data-day="${d}">${WEEKDAY_LABELS[d]}</button>`).join('');
  const weekButtons=[1,2,3,4,5].map(n=>`<button type="button" class="plan-choice week-choice ${Number(f.weeklyMultiplier)===n?'selected':''}" data-target="weeklyMultiplier" data-value="${n}">${n}周</button>`).join('');
  const paceButtons=[['heavy','多め'],['normal','標準'],['light','控えめ']].map(([v,l])=>`<button type="button" class="plan-choice pace-choice ${f.pace===v?'selected':''}" data-target="pace" data-value="${v}">${l}</button>`).join('');
  $('tasksTab').innerHTML=`<div class="stack"><section class="card plan-editor-card"><div class="plan-editor-head"><button class="ghost small" id="clearTaskEdit">←</button><h2>計画を編集</h2><button class="primary small" form="taskForm">保存</button></div><form id="taskForm" class="plan-form"><p class="form-section-title">基本情報</p><div class="form-grid"><label>種類<select id="taskTypeSelect" name="taskType"><option value="study" ${f.taskType==='study'?'selected':''}>学習（ページ・単語など）</option><option value="classAssignment" ${f.taskType==='classAssignment'?'selected':''}>授業課題</option><option value="general" ${f.taskType==='general'?'selected':''}>その他タスク</option></select></label><label>科目<select name="subject">${subjectOptions(f.subject)}</select></label><label class="span2">教材・計画名<input name="title" required value="${esc(f.title)}" placeholder="例：IELTS 必須英単語 4400"></label></div><div id="courseTaskFields" class="form-grid ${f.taskType==='classAssignment'?'':'hidden'}"><label>授業<select name="courseId"><option value="">選択</option>${courseOptions(f.courseId)}</select></label><label>課題区分<select name="assignmentType"><option value="weekly" ${f.assignmentType==='weekly'?'selected':''}>週課題</option><option value="midterm" ${f.assignmentType==='midterm'?'selected':''}>中間課題</option><option value="final" ${f.assignmentType==='final'?'selected':''}>期末課題</option><option value="ondemand" ${f.assignmentType==='ondemand'?'selected':''}>オンデマンド</option><option value="other" ${f.assignmentType==='other'?'selected':''}>その他</option></select></label></div><div id="studyFields" class="${isStudy?'':'hidden'}"><p class="form-section-title">範囲・期間</p><div class="range-row"><input type="number" name="rangeStart" min="0" value="${Number(f.rangeStart||1)}"><span>〜</span><input type="number" name="rangeEnd" min="0" value="${Number(f.rangeEnd||30)}"><select name="rangeUnit"><option value="ページ" ${f.rangeUnit==='ページ'?'selected':''}>ページ</option><option value="語" ${f.rangeUnit==='語'?'selected':''}>語</option><option value="問" ${f.rangeUnit==='問'?'selected':''}>問</option><option value="章" ${f.rangeUnit==='章'?'selected':''}>章</option></select></div><p class="inline-stat" id="rangeTotalText">合計 ${rangeTotal}${esc(f.rangeUnit||'ページ')}</p><input type="hidden" name="remainingPages" id="remainingPagesInput" value="${Number(f.remainingPages||rangeTotal||1)}"><div class="form-grid"><label>開始日<input type="date" name="startDate" value="${f.startDate||dateKey()}"></label><label>期限日<input type="date" name="deadline" required value="${f.deadline}"></label><label>期限時刻<input type="time" name="deadlineTime" value="${f.deadlineTime||'23:59'}"></label><label class="switch-label deadline-strict-label"><input type="checkbox" name="deadlineStrict" value="1" ${f.deadlineStrict?'checked':''}> 期限死守モード</label><label>1単位の初期目安（分）<input type="number" name="minutesPerPage" min="0.25" step="0.25" value="${Number(f.baseMinutesPerPage||f.minutesPerPage||3)}"></label></div><p class="form-section-title">学習ペース設定</p><div class="segmented wide">${weekButtons}</div><input type="hidden" name="weeklyMultiplier" id="weeklyMultiplier" value="${Number(f.weeklyMultiplier||1)}"><div class="segmented wide">${paceButtons}</div><input type="hidden" name="pace" id="pace" value="${esc(f.pace||'normal')}"><p class="muted compact-note">「多め」は前倒し、「控えめ」は1日の負担を軽くします。どれでも期限には間に合う量を確保します。</p><div class="weekday-row">${weekdayButtons}</div><input type="hidden" name="learningDays" id="learningDays" value="${f.learningDays.join(',')}"><div class="trial-box" id="trialBox">試算ノルマ<br>${rangeTotal?Math.ceil(rangeTotal/Math.max(1,daysUntilTaskLite(f.deadline,dateKey()))):0}${esc(f.rangeUnit||'ページ')}/日 × ${Number(f.weeklyMultiplier||1)}周</div></div><div id="timeTaskFields" class="${isStudy?'hidden':''}"><p class="form-section-title">量・時間</p><div class="form-grid"><label class="span2">量（自由入力）<input name="quantityText" value="${esc(f.quantityText||'')}" placeholder="例：2000字 / 問題10問 / 動画2本"></label><label>残り予想時間（分）<input type="number" name="remainingMinutes" min="5" value="${Number(f.remainingMinutes||60)}"></label><label>期限日<input type="date" name="deadline" value="${f.deadline}"></label><label>期限時刻<input type="time" name="deadlineTime" value="${f.deadlineTime||'23:59'}"></label><label class="switch-label deadline-strict-label"><input type="checkbox" name="deadlineStrict" value="1" ${f.deadlineStrict?'checked':''}> 期限死守モード</label></div></div><details class="advanced-details"><summary>詳細設定</summary><div class="form-grid"><label>優先度<select name="priority"><option value="high" ${f.priority==='high'?'selected':''}>高</option><option value="medium" ${f.priority==='medium'?'selected':''}>中</option><option value="low" ${f.priority==='low'?'selected':''}>低</option></select></label><label>重点<select name="focus"><option value="main" ${f.focus==='main'?'selected':''}>メイン</option><option value="sub" ${f.focus==='sub'?'selected':''}>サブ</option><option value="maintain" ${f.focus==='maintain'?'selected':''}>維持</option></select></label><label>領域<select name="mode"><option value="grow" ${f.mode==='grow'?'selected':''}>伸ばす</option><option value="maintain" ${f.mode==='maintain'?'selected':''}>維持</option></select></label><label>時間帯<select name="timePreference"><option value="any" ${f.timePreference==='any'?'selected':''}>いつでも</option><option value="morning" ${f.timePreference==='morning'?'selected':''}>朝優先</option><option value="evening" ${f.timePreference==='evening'?'selected':''}>夜優先</option></select></label><label>1回最小（ページ/分）<input type="number" name="minPages" min="1" value="${Number(f.minPages||5)}"><input type="hidden" name="minBlock" value="${Number(f.minBlock||20)}"></label><label>1回最大（ページ/分）<input type="number" name="maxPages" min="1" value="${Number(f.maxPages||30)}"><input type="hidden" name="maxBlock" value="${Number(f.maxBlock||120)}"></label><label>配置方法<select id="placementSelect" name="placement"><option value="flexible" ${f.placement==='flexible'?'selected':''}>自動移動OK</option><option value="date" ${f.placement==='date'?'selected':''}>指定日だけ</option><option value="datetime" ${f.placement==='datetime'?'selected':''}>指定日時に固定</option></select></label><div id="fixedFields" class="span2 form-grid ${f.placement==='flexible'?'hidden':''}"><label>固定日<input type="date" name="fixedDate" value="${f.fixedDate||dateKey()}"></label><label class="fixed-time ${f.placement==='datetime'?'':'hidden'}">開始時刻<input type="time" name="fixedTime" value="${f.fixedTime||'09:00'}"></label><label id="fixedPageField" class="fixed-time ${f.placement==='datetime'&&isStudy?'':'hidden'}">その枠で進めるページ<input type="number" name="fixedPages" min="1" value="${Number(f.fixedPages||5)}"></label><label id="fixedMinuteField" class="fixed-time ${f.placement==='datetime'&&!isStudy?'':'hidden'}">その枠の予定時間（分）<input type="number" name="fixedMinutes" min="5" value="${Number(f.fixedMinutes||30)}"></label></div></div></details><div class="form-actions"><button class="primary">${edit?'変更を保存':'計画を登録'}</button>${edit||taskDraft?'<button type="button" id="cancelEdit" class="secondary">入力をリセット</button>':''}</div></form>${edit?'<button id="deleteEditingTask" class="danger-outline">計画を削除</button>':''}</section>${bosses}<section class="card"><h3>登録済み</h3><div class="task-list">${rows||'<p class="muted">まだ課題がありません。</p>'}</div></section></div>`;
  const placement=$('placementSelect'), type=$('taskTypeSelect');
  const updateForm=()=>{const study=type.value==='study',v=placement.value;$('studyFields').classList.toggle('hidden',!study);$('timeTaskFields').classList.toggle('hidden',study);$('courseTaskFields').classList.toggle('hidden',type.value!=='classAssignment');$('fixedFields').classList.toggle('hidden',v==='flexible');document.querySelectorAll('#studyFields input,#studyFields select').forEach(x=>x.disabled=!study);document.querySelectorAll('#timeTaskFields input,#timeTaskFields select').forEach(x=>x.disabled=study);document.querySelectorAll('#courseTaskFields input,#courseTaskFields select').forEach(x=>x.disabled=type.value!=='classAssignment');document.querySelectorAll('.fixed-time').forEach(x=>x.classList.toggle('hidden',v!=='datetime'));document.querySelectorAll('#fixedFields input,#fixedFields select').forEach(x=>x.disabled=v==='flexible');if(v==='datetime'){$('fixedPageField').classList.toggle('hidden',!study);$('fixedMinuteField').classList.toggle('hidden',study);document.querySelectorAll('#fixedPageField input').forEach(x=>x.disabled=!study);document.querySelectorAll('#fixedMinuteField input').forEach(x=>x.disabled=study);}}; placement.onchange=updateForm; type.onchange=updateForm; updateForm();
  const calcRange=()=>{const a=Number(document.querySelector('[name="rangeStart"]')?.value||0),b=Number(document.querySelector('[name="rangeEnd"]')?.value||0),unit=document.querySelector('[name="rangeUnit"]')?.value||'ページ',total=Math.max(0,b-a+1);if($('rangeTotalText'))$('rangeTotalText').textContent=`合計 ${total}${unit}`;if($('remainingPagesInput'))$('remainingPagesInput').value=total||1;};['rangeStart','rangeEnd','rangeUnit'].forEach(n=>{const el=document.querySelector(`[name="${n}"]`);if(el)el.oninput=calcRange;});
  document.querySelectorAll('.plan-choice').forEach(btn=>btn.onclick=()=>{const target=btn.dataset.target;document.querySelectorAll(`.plan-choice[data-target="${target}"]`).forEach(x=>x.classList.toggle('selected',x===btn));const h=$(target);if(h)h.value=btn.dataset.value;});
  document.querySelectorAll('.weekday-btn').forEach(btn=>btn.onclick=()=>{btn.classList.toggle('selected');$('learningDays').value=[...document.querySelectorAll('.weekday-btn.selected')].map(x=>x.dataset.day).join(',');});
  if($('clearTaskEdit'))$('clearTaskEdit').onclick=()=>{editingTaskId=null;taskDraft=null;renderTasks();};
  $('taskForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),old=tasks.find(t=>t.id===editingTaskId),study=d.taskType==='study';const data={...(old||{}),id:old?.id||uid(),taskType:d.taskType,title:d.title,itemCode:'',subject:d.subject||'',deadline:d.deadline,deadlineTime:d.deadlineTime||'23:59',deadlineStrict:Boolean(d.deadlineStrict),startDate:d.startDate||dateKey(),priority:d.priority,focus:d.focus,mode:d.mode,timePreference:d.timePreference,placement:d.placement,fixedDate:d.fixedDate||'',fixedTime:d.fixedTime||'09:00',status:'active',courseId:d.taskType==='classAssignment'?(d.courseId||''):'',assignmentType:d.taskType==='classAssignment'?(d.assignmentType||'weekly'):'',quantityText:study?'':d.quantityText||'',minBlock:Number(d.minBlock||20),maxBlock:Number(d.maxBlock||120),fixedMinutes:Number(d.fixedMinutes||30),rangeStart:Number(d.rangeStart||1),rangeEnd:Number(d.rangeEnd||0),rangeUnit:d.rangeUnit||'ページ',weeklyMultiplier:Number(d.weeklyMultiplier||1),pace:d.pace||'normal',learningDays:String(d.learningDays||'').split(',').filter(Boolean).map(Number),intervalDays:'',reviewTaskEnabled:false,reviewMaxPerDay:'',thumbnailData:''};if(study){const total=Math.max(1,Number(d.remainingPages||0));data.remainingPages=old?.taskType==='study'?Math.min(Number(old.remainingPages||total),total):total;data.initialPages=old?.taskType==='study'?Math.max(Number(old.initialPages||total),total):total;data.baseMinutesPerPage=Number(d.minutesPerPage);data.minutesPerPage=old?.taskType==='study'&&old?.speedSamples?old.minutesPerPage:Number(d.minutesPerPage);data.minPages=Number(d.minPages||5);data.maxPages=Number(d.maxPages||30);if(data.pace==='heavy')data.maxPages=Math.max(data.maxPages,Math.ceil(data.minPages*3));if(data.pace==='light')data.maxPages=Math.max(data.minPages,Math.ceil(data.maxPages*0.65));data.fixedPages=Number(d.fixedPages||d.minPages||5);delete data.remainingMinutes;}else{data.remainingMinutes=Number(d.remainingMinutes);data.initialMinutes=old?.taskType===d.taskType?old.initialMinutes:Number(d.remainingMinutes);delete data.remainingPages;delete data.initialPages;delete data.baseMinutesPerPage;delete data.minutesPerPage;delete data.learnedMinutesPerPage;delete data.minPages;delete data.maxPages;}const obj=normalizeTask(data);if(old)tasks=tasks.map(t=>t.id===old.id?obj:t);else tasks.push(obj);recordOperation(old?'task_updated':'task_created',old?'計画を更新':'計画を登録',{taskId:obj.id,taskTitle:obj.title,taskType:obj.taskType,deadline:obj.deadline,deadlineTime:obj.deadlineTime,deadlineStrict:Boolean(obj.deadlineStrict),remainingPages:Number.isFinite(Number(obj.remainingPages))?Number(obj.remainingPages):null,remainingMinutes:Number.isFinite(Number(obj.remainingMinutes))?Number(obj.remainingMinutes):null,courseId:obj.courseId||'',assignmentType:obj.assignmentType||'',rangeStart:obj.rangeStart,rangeEnd:obj.rangeEnd,rangeUnit:obj.rangeUnit,weeklyMultiplier:obj.weeklyMultiplier,pace:obj.pace});editingTaskId=null;taskDraft=null;persist();renderAll();};
  if($('cancelEdit'))$('cancelEdit').onclick=()=>{editingTaskId=null;taskDraft=null;renderTasks();};
  if($('deleteEditingTask'))$('deleteEditingTask').onclick=()=>{if(!editingTaskId)return;if(confirm('この計画を削除しますか？')){const task=tasks.find(t=>t.id===editingTaskId);tasks=tasks.filter(t=>t.id!==editingTaskId);recordOperation('task_deleted','計画を削除',{taskId:editingTaskId,taskTitle:task?.title||'',taskType:task?.taskType||''});editingTaskId=null;taskDraft=null;persist();renderAll();}};
  document.querySelectorAll('.edit-task').forEach(b=>b.onclick=()=>{editingTaskId=b.dataset.id;taskDraft=null;renderTasks();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelectorAll('.delete-task').forEach(b=>b.onclick=()=>{if(confirm('この課題を削除しますか？')){const task=tasks.find(t=>t.id===b.dataset.id);tasks=tasks.filter(t=>t.id!==b.dataset.id);recordOperation('task_deleted','課題・タスクを削除',{taskId:b.dataset.id,taskTitle:task?.title||'',taskType:task?.taskType||''});persist();renderAll();}});
}
function daysUntilTaskLite(deadline, day){try{const a=new Date(`${day}T12:00:00`),b=new Date(`${deadline}T12:00:00`);return Math.max(1,Math.ceil((b-a)/86400000));}catch{return 1;}}

function renderIdeas(){
  const rows=ideas.map(i=>`<div class="idea-row"><div><strong>${esc(i.title)}</strong><small>${esc(i.note||'')}</small></div><button class="primary small promote-idea" data-id="${i.id}">課題に昇格</button><button class="icon-btn delete-idea" data-id="${i.id}">削除</button></div>`).join('');
  $('ideasTab').innerHTML=`<div class="stack"><section class="card"><p class="eyebrow">SOMEDAY</p><h2>いつかやる置き場</h2><form id="ideaForm" class="form-grid"><label class="span2">やりたいこと<input name="title" required placeholder="例：統計調査士を調べる"></label><label class="span2">メモ<input name="note" placeholder="今は始めない理由・面白い点など"></label><button class="primary span2">置いておく</button></form><p class="muted">思いついても今の重点枠を壊さないための保管場所。必要になったときだけ課題へ昇格します。</p></section><section class="card"><h3>保留中</h3>${new Date().getDay()===0?'<p class="review-prompt">今日は週次レビュー日。昇格させるものが本当にあるかだけ確認。</p>':''}<div class="idea-list">${rows||'<p class="muted">まだありません。</p>'}</div></section></div>`;
  $('ideaForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),idea={id:uid(),title:d.title,note:d.note,createdAt:new Date().toISOString()};ideas.unshift(idea);recordOperation('idea_created','いつかやる項目を追加',{ideaId:idea.id,title:idea.title});persist();renderIdeas();};
  document.querySelectorAll('.delete-idea').forEach(b=>b.onclick=()=>{const idea=ideas.find(i=>i.id===b.dataset.id);ideas=ideas.filter(i=>i.id!==b.dataset.id);recordOperation('idea_deleted','いつかやる項目を削除',{ideaId:b.dataset.id,title:idea?.title||''});persist();renderIdeas();});
  document.querySelectorAll('.promote-idea').forEach(b=>b.onclick=()=>{const i=ideas.find(x=>x.id===b.dataset.id);if(!i)return;const deadline=prompt('期限日（YYYY-MM-DD）',addDays(dateKey(),30));if(!deadline)return;const deadlineTime=prompt('期限時刻（HH:MM）','23:59')||'23:59';const pages=Number(prompt('必要ページ数', '100'));if(!pages)return;const mpp=Number(prompt('1ページの初期目安（分）','3'))||3;const promoted=normalizeTask({id:uid(),title:i.title,deadline,deadlineTime,remainingPages:pages,initialPages:pages,baseMinutesPerPage:mpp,minutesPerPage:mpp,priority:'medium',focus:'sub',mode:'grow',minPages:5,maxPages:30,timePreference:'any',placement:'flexible',status:'active',createdAt:new Date().toISOString()});tasks.push(promoted);ideas=ideas.filter(x=>x.id!==i.id);recordOperation('idea_promoted','いつかやる項目を課題へ昇格',{ideaId:i.id,taskId:promoted.id,taskTitle:promoted.title,deadline,deadlineTime,pages});persist();renderAll();});
}

function weekDates(end=dateKey()){return Array.from({length:7},(_,i)=>addDays(end,i-6));}
function weeklyReview(){
  const dates=weekDates(); let planned=0,done=0,minutes=0; const byTask={}, missedByTask={};
  dates.forEach(day=>{const snap=planSnapshots[day]; if(snap){planned+=Number(snap.scheduledTaskPages||0); (snap.timeline||[]).filter(x=>x.type==='task'&&x.taskId).forEach(x=>{missedByTask[x.taskId]=(missedByTask[x.taskId]||0)+Number(x.pages||0);});} activityLog.filter(a=>a.date===day&&a.kind==='task').forEach(a=>{done+=Number(a.pages||0);minutes+=Number(a.minutes||0);byTask[a.taskId]=(byTask[a.taskId]||0)+Number(a.pages||0);missedByTask[a.taskId]=(missedByTask[a.taskId]||0)-Number(a.pages||0);});});
  const ratio=planned?Math.round(done/planned*100):0; const topId=Object.entries(byTask).sort((a,b)=>b[1]-a[1])[0]?.[0]; const missId=Object.entries(missedByTask).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1])[0]?.[0];
  let advice='今の設定を継続。'; if(planned&&ratio<70)advice='予定量が現実より多め。来週は重点を絞るか、ゆったり時間を守ったまま課題量を少し下げる候補。'; else if(ratio>110)advice='前倒しできています。未来の忙しい日に備えてゆったり時間を増やしてもOK。';
  return {planned,done,minutes,ratio,top:tasks.find(t=>t.id===topId)?.title||'—',missed:tasks.find(t=>t.id===missId)?.title||'—',advice};
}
function renderHistory(){
  const review=weeklyReview(); const st=motivationStats(); const titleHtml=TITLE_DEFS.filter(t=>motivation.titleIds.includes(t.id)).map(t=>`<span class="title-chip">${esc(t.name)}</span>`).join(''); const victoryHtml=(motivation.victories||[]).slice(0,30).map(v=>{const t=new Date(v.createdAt);const stamp=Number.isNaN(t.getTime())?v.day:t.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});return `<div class="victory-entry"><time>${esc(stamp)}</time><strong>${esc(v.title)}</strong></div>`;}).join(''); const dates=[...new Set([...Object.keys(planSnapshots),...Object.keys(wakeRecords),...activityLog.map(a=>a.date)])].sort().reverse();
  const recentOperations=operationLog.slice(0,200).map(op=>{const t=new Date(op.occurredAt);const stamp=Number.isNaN(t.getTime())?'':t.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});const target=op.targetDate?` ・ 対象 ${esc(op.targetDate)}`:'';return `<div class="operation-entry"><time>${esc(stamp)}</time><div><strong>${esc(op.title)}</strong><small>${esc(op.type)}${target}</small></div></div>`;}).join('');
  const cards=dates.map(day=>{
    const snap=planSnapshots[day], wake=wakeRecords[day], logs=activityLog.filter(a=>a.date===day&&a.kind!=='closeout').sort((a,b)=>String(a.completedAt).localeCompare(String(b.completedAt))), pages=logs.filter(a=>a.kind==='task').reduce((sum,a)=>sum+Number(a.pages||0),0), close=closeouts[day];
    const entries=logs.map(a=>`<div class="history-entry"><span>${a.kind==='life'?'生活':'作業'}</span><strong>${esc(a.title)}</strong><small>${a.pages?`${a.pages}ページ ・ `:''}${minutesLabel(a.minutes||0)}</small></div>`).join('');
    const mode=snap?`${snap.classDay?'授業日':'授業なし日'} ・ ${snap.energyState==='high'?'元気':snap.energyState==='tired'?'疲れ':'普通'}`:'計画未作成';
    const wakeText=wake?.wakeTime?` ・ 起床実績 ${wake.wakeTime}${wake.plannedWakeTime?`（予定 ${wake.plannedWakeTime}）`:''}`:'';
    const sleepText=snap?.bedTime?` ・ 就寝予定 ${snap.bedTime} → 翌朝 ${snap.nextWakeTime||settings.wakeTime}`:'';
    return `<div class="history-day"><div class="row between"><div><strong class="history-date">${day.replaceAll('-','/')}</strong><small class="history-mode">${mode}${wakeText}${sleepText}</small></div><span class="history-life ${close?'done':''}">${close?'一日終了済み':'未終了'}</span></div><div class="history-metrics"><div><span>予定ページ</span><strong>${Number(snap?.scheduledTaskPages||0)}</strong></div><div><span>完了ページ</span><strong>${pages}</strong></div><div><span>ゆったり予定</span><strong>${minutesLabel(snap?.relaxedMinutes||0)}</strong></div></div><div class="history-entries">${entries||'<p class="muted">完了記録なし</p>'}</div></div>`;
  }).join('');
  $('historyTab').innerHTML=`<div class="stack"><section class="card motivation-summary"><p class="eyebrow">LIFE LEVEL</p><h2>Level ${st.level}｜${esc(st.currentTitle.name)}</h2><div class="review-metrics"><div><span>EXP</span><strong>${st.exp}</strong></div><div><span>次まで</span><strong>${Math.round(st.nextNeed)}</strong></div><div><span>累計ページ</span><strong>${totalDonePages()}</strong></div></div><div class="exp-bar"><span style="width:${st.progress}%"></span></div><div class="title-list">${titleHtml||'<p class="muted">称号はこれから。</p>'}</div></section><section class="card"><p class="eyebrow">VICTORY LOG</p><h2>勝利ログ</h2><div class="victory-list">${victoryHtml||'<p class="muted">まだ勝利ログはありません。</p>'}</div></section><section class="card weekly-card"><p class="eyebrow">WEEKLY REVIEW</p><h2>直近7日</h2><div class="review-metrics"><div><span>予定</span><strong>${review.planned}頁</strong></div><div><span>実績</span><strong>${review.done}頁</strong></div><div><span>達成率</span><strong>${review.ratio}%</strong></div></div><p><strong>最も進んだ（ページ系）：</strong>${esc(review.top)}</p><p><strong>総作業実績：</strong>${minutesLabel(review.minutes)}</p><p><strong>持ち越しが多い：</strong>${esc(review.missed)}</p><p class="review-advice">${esc(review.advice)}</p></section><section class="card"><h2>記録・バックアップ</h2><div class="backup-actions"><button id="exportBackup" class="primary small">JSONを書き出す</button><label class="file-button">JSONを読み込む<input id="importBackup" type="file" accept="application/json,.json"></label><button id="restoreAutoBackup" class="secondary small">更新前バックアップから復元</button></div><p class="muted">起床実績・作業開始/終了・課題変更・授業変更・睡眠予定・設定変更など、Life OSの状態を変える操作は操作履歴にも保存します。画面を開く・スクロールするだけの操作は記録しません。</p></section><section class="card"><div class="row between"><div><p class="eyebrow">ACTION LOG</p><h2>操作履歴</h2></div><span class="muted">全 ${operationLog.length}件</span></div><p class="muted">表示は最新200件。JSONバックアップとGoogle Drive同期には操作履歴全体を含めます。</p><div class="operation-list">${recentOperations||'<p class="muted">まだ操作履歴はありません。</p>'}</div></section><section class="card"><div class="history-list">${cards||'<p class="muted">まだ記録がありません。</p>'}</div></section></div>`;
  $('exportBackup').onclick=exportBackup; $('importBackup').onchange=importBackup; $('restoreAutoBackup').onclick=restoreLatestAutomaticBackup;
}

function exportBackup(){recordOperation('backup_exported','JSONバックアップを書き出し',{appVersion:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION});persist({cloud:false});const data=buildCloudPayload();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`life-os-backup-${dateKey()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);renderHistory();}
async function importBackup(e){const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!confirm('現在のデータをバックアップで置き換えますか？'))return;createAutomaticBackup('before-import');applyPayload(data);recordOperation('backup_imported','JSONバックアップから復元',{fileName:file.name||'',sourceVersion:data.version||'',sourceSchemaVersion:data.schemaVersion||''});persist();renderAll();notice('復元しました。');}catch(err){notice(`読み込めません：${err.message}`);}finally{e.target.value='';}}
function restoreLatestAutomaticBackup(){const backups=load('autoBackups',[]);if(!backups.length)return notice('自動バックアップはありません。');const latest=backups[0];if(!confirm('最新の更新前バックアップへ戻しますか？'))return;createAutomaticBackup('before-restore');Object.entries(latest.data||{}).forEach(([k,v])=>save(k,v));const restored=load('operationLog',[]);restored.unshift({id:uid(),date:dateKey(),occurredAt:new Date().toISOString(),type:'auto_backup_restored',title:'更新前バックアップから復元',targetDate:'',details:{backupId:latest.id||'',backupCreatedAt:latest.createdAt||'',backupVersion:latest.appVersion||''}});save('operationLog',restored);location.reload();}

function calendarSourcesHtml(){
  const rows=(calendarSources||[]).map(c=>`<div class="calendar-source-row"><label class="calendar-source-main"><input type="checkbox" class="calendar-source-enabled" data-id="${esc(c.id)}" ${c.enabled?'checked':''}> <span><strong>${esc(c.summary)}</strong><small>${c.primary?'メインカレンダー':esc(c.accessRole||'Google Calendar')}</small></span></label><label class="calendar-buffer-select">前後余白<select class="calendar-source-buffer" data-id="${esc(c.id)}"><option value="small" ${c.bufferLevel==='small'?'selected':''}>小</option><option value="medium" ${c.bufferLevel==='medium'?'selected':''}>中</option><option value="large" ${c.bufferLevel==='large'?'selected':''}>大</option><option value="none" ${c.bufferLevel==='none'?'selected':''}>なし</option></select></label></div>`).join('');
  return `<section class="card"><div class="row between"><div><p class="eyebrow">GOOGLE CALENDARS</p><h2>読み込むカレンダー</h2></div><button id="refreshCalendars" class="secondary small">一覧を更新</button></div><p class="muted">チェックしたカレンダーの予定だけをLife OSの計画に入れます。部活などカレンダー単位で前後余白の初期値も設定できます。</p><div class="calendar-source-list">${rows||'<p class="muted">Google接続後に「一覧を更新」を押すと、大学・部活・バイトなどのカレンダーを選べます。</p>'}</div></section>`;
}

function renderSettings(){
  const bufferCard=(key,label)=>`<div class="buffer-card"><strong>${label}</strong><label>前<input type="number" data-setting="buffers.${key}.before" value="${settings.buffers[key].before}"></label><label>後<input type="number" data-setting="buffers.${key}.after" value="${settings.buffers[key].after}"></label></div>`;
  $('settingsTab').innerHTML=`<div class="stack"><section class="card"><h2>Google連携</h2>${!isNativeIOS()?`<label>Google OAuth Web Client ID<input id="clientIdInput" value="${esc(settings.googleClientId)}"></label><button id="saveClientId" class="primary small">Client IDを保存</button>`:''}<div class="cloud-box"><div><strong>Google Driveクラウド保存</strong><small id="cloudStatus">${esc(cloudStatus)}</small></div><button id="cloudSyncNow" class="secondary small">今すぐ同期</button></div><p class="muted">端末間同期にはGoogle Drive APIと <code>drive.appdata</code> 権限が必要です。Life OS専用の非表示appDataFolderへ保存します。</p></section>${calendarSourcesHtml()}<section class="card"><h2>科目管理</h2><p class="muted">課題登録で使う科目を自由に追加・名前変更できます。名前変更は既存課題にも反映します。</p><div id="subjectManager" class="subject-manager">${currentSubjects().map((x,i)=>`<div class="subject-row"><input class="subject-name" data-index="${i}" value="${esc(x)}"><button type="button" class="danger-outline small subject-delete" data-index="${i}" ${x==='その他'?'disabled':''}>削除</button></div>`).join('')}</div><div class="subject-add-row"><input id="newSubjectName" placeholder="新しい科目名"><button id="addSubject" class="primary small" type="button">追加</button></div></section><section class="card"><h2>通知</h2><label>開始何分前に通知<input type="number" min="0" max="120" data-setting="notificationLeadMinutes" value="${settings.notificationLeadMinutes}"></label></section><section class="card"><h2>生活設定</h2><div class="form-grid"><label>標準の起床時刻<input type="time" data-setting="wakeTime" value="${settings.wakeTime}"></label><label>標準の就寝時刻<input type="time" data-setting="bedTime" value="${settings.bedTime}"></label><label>最低ゆったり時間（分）<input type="number" data-setting="relaxedMinMinutes" value="${settings.relaxedMinMinutes}"></label><label>ゆったり比率（0〜1）<input type="number" step=".05" min="0" max=".7" data-setting="relaxedRatio" value="${settings.relaxedRatio}"></label><label>お風呂（分）<input type="number" data-setting="bathMinutes" value="${settings.bathMinutes}"></label><label>肌ケア（分）<input type="number" data-setting="skincareMinutes" value="${settings.skincareMinutes}"></label><label>就寝何分前までに入浴終了<input type="number" data-setting="bathBeforeBedMinutes" value="${settings.bathBeforeBedMinutes}"></label><label>授業日の夜作業上限（分）<input type="number" data-setting="classDayEveningCapMinutes" value="${settings.classDayEveningCapMinutes}"></label></div><p class="muted">ここは未設定日の標準値です。その日の就寝予定と翌日の起床予定は「今日」画面で日ごとに上書きできます。</p></section><section class="card"><div class="row between"><div><p class="eyebrow">MORNING ROUTINE</p><h2>朝トレ・朝食</h2></div><label class="switch-label"><input id="morningTrainingEnabled" type="checkbox" ${settings.morningTraining?.enabled!==false?'checked':''}> 毎朝入れる</label></div><p class="muted">「起きた」を押した実際の起床時刻から固定します。朝の予定に間に合わない場合は、自動で短縮します。</p><div class="form-grid"><label>体幹＆下半身トレ（分）<input type="number" min="0" max="90" data-setting="morningTraining.coreLowerMinutes" value="${settings.morningTraining?.coreLowerMinutes??20}"></label><label>素振り本数<input type="number" min="0" step="50" data-setting="morningTraining.suburiCount" value="${settings.morningTraining?.suburiCount??1000}"></label><label>素振り（分）<input type="number" min="0" max="90" data-setting="morningTraining.suburiMinutes" value="${settings.morningTraining?.suburiMinutes??25}"></label><label>クールダウンストレッチ（分）<input type="number" min="0" max="60" data-setting="morningTraining.stretchMinutes" value="${settings.morningTraining?.stretchMinutes??10}"></label><label>シャワー（分）<input type="number" min="0" max="60" data-setting="morningTraining.showerMinutes" value="${settings.morningTraining?.showerMinutes??5}"></label><label>朝食（分）<input type="number" min="0" max="90" data-setting="morningTraining.breakfastMinutes" value="${settings.morningTraining?.breakfastMinutes??15}"></label></div><div class="form-grid compact"><label class="switch-label"><input id="breakfastEnabled" type="checkbox" ${settings.morningTraining?.breakfastEnabled!==false?'checked':''}> 朝食を入れる</label><label class="switch-label"><input id="morningAutoAdjust" type="checkbox" ${settings.morningTraining?.autoAdjustForMorningEvent!==false?'checked':''}> 朝予定に合わせて自動短縮</label></div><div class="relaxed-band">朝ルーティン合計　${minutesLabel(morningTrainingTotal())}</div><p class="muted">基本順序：体幹＆下半身 → 素振り → クールダウン → シャワー → 朝食。時間が足りない朝は、予定に遅れないよう短縮版にします。</p></section><section class="card"><h2>時間考慮プリセット</h2><div class="buffer-grid">${bufferCard('small','小')}${bufferCard('medium','中')}${bufferCard('large','大')}</div></section><section class="card"><h2>授業日判定</h2><label>キーワード（カンマ区切り）<input id="classKeywords" value="${esc(settings.classKeywords.join(','))}"></label><button id="saveKeywords" class="primary small">保存</button></section></div>`;
  document.querySelectorAll('[data-setting]').forEach(el=>el.onchange=()=>{const path=el.dataset.setting.split('.');let obj=settings;for(const k of path.slice(0,-1))obj=obj[k];const key=path.at(-1),before=obj[key],after=el.type==='number'?Number(el.value):el.value;obj[key]=after;recordOperation('setting_changed','設定を変更',{setting:el.dataset.setting,before,after});persist();renderToday();renderNow();});
  if($('morningTrainingEnabled')) $('morningTrainingEnabled').onchange=e=>{const before=settings.morningTraining?.enabled!==false;settings.morningTraining={...(settings.morningTraining||{}),enabled:e.target.checked};recordOperation('morning_training_toggled','朝トレ設定を変更',{before,after:e.target.checked});persist();renderToday();renderNow();renderSettings();};
  if($('breakfastEnabled')) $('breakfastEnabled').onchange=e=>{const before=settings.morningTraining?.breakfastEnabled!==false;settings.morningTraining={...(settings.morningTraining||{}),breakfastEnabled:e.target.checked};recordOperation('breakfast_toggled','朝食設定を変更',{before,after:e.target.checked});persist();renderToday();renderNow();renderSettings();};
  if($('morningAutoAdjust')) $('morningAutoAdjust').onchange=e=>{const before=settings.morningTraining?.autoAdjustForMorningEvent!==false;settings.morningTraining={...(settings.morningTraining||{}),autoAdjustForMorningEvent:e.target.checked};recordOperation('morning_auto_adjust_toggled','朝予定による自動短縮を変更',{before,after:e.target.checked});persist();renderToday();renderNow();renderSettings();};
  document.querySelectorAll('.subject-name').forEach(el=>el.onchange=()=>{
    const list=currentSubjects(); const idx=Number(el.dataset.index), before=list[idx], after=el.value.trim();
    if(!after){el.value=before;return notice('科目名を入力してください。');}
    if(list.some((x,i)=>i!==idx&&x===after)){el.value=before;return notice('同じ科目名があります。');}
    settings.subjects=list.map((x,i)=>i===idx?after:x);
    tasks=tasks.map(t=>t.subject===before?{...t,subject:after}:t);
    recordOperation('subject_renamed','科目名を変更',{before,after}); persist(); renderTasks(); renderSettings();
  });
  document.querySelectorAll('.subject-delete').forEach(el=>el.onclick=()=>{
    const list=currentSubjects(), idx=Number(el.dataset.index), name=list[idx]; if(!name||name==='その他')return;
    const used=tasks.filter(t=>t.subject===name).length;
    if(used&&!confirm(`「${name}」を使っている課題が${used}件あります。削除すると「その他」に変更します。続けますか？`))return;
    if(!list.includes('その他'))list.push('その他'); settings.subjects=list.filter(x=>x!==name);
    tasks=tasks.map(t=>t.subject===name?{...t,subject:'その他'}:t);
    recordOperation('subject_deleted','科目を削除',{subject:name,reassignedTasks:used}); persist(); renderTasks(); renderSettings();
  });
  if($('addSubject'))$('addSubject').onclick=()=>{
    const name=$('newSubjectName').value.trim(); if(!name)return notice('科目名を入力してください。');
    const list=currentSubjects(); if(list.includes(name))return notice('その科目はすでにあります。');
    settings.subjects=[...list,name]; recordOperation('subject_added','科目を追加',{subject:name}); persist(); renderTasks(); renderSettings();
  };
  if($('saveClientId'))$('saveClientId').onclick=()=>{settings.googleClientId=$('clientIdInput').value.trim();recordOperation('google_client_configured','Google Client ID設定を保存',{configured:Boolean(settings.googleClientId)});persist();updateGoogleButton();notice('保存しました。');};
  if($('refreshCalendars'))$('refreshCalendars').onclick=async()=>{try{if(!accessToken)return notice('先にGoogleへ接続してください。');await refreshCalendarSources();recordOperation('calendar_sources_refreshed','Googleカレンダー一覧を更新',{sourceCount:calendarSources.length});persist();renderSettings();notice('カレンダー一覧を更新しました。');}catch(e){notice(`カレンダー一覧を取得できません：${e.message}`);}};
  document.querySelectorAll('.calendar-source-enabled').forEach(el=>el.onchange=async()=>{const c=calendarSources.find(x=>x.id===el.dataset.id);if(!c)return;const before=c.enabled;c.enabled=el.checked;recordOperation('calendar_source_toggled','読み込むカレンダーを変更',{calendarName:c.summary,enabled:c.enabled,before});persist();if(accessToken){try{const n=await fetchGoogleEvents();notice(`${n}件の予定を取得しました。`);}catch(e){notice(e.message);}}else{renderToday();renderNow();}});
  document.querySelectorAll('.calendar-source-buffer').forEach(el=>el.onchange=async()=>{const c=calendarSources.find(x=>x.id===el.dataset.id);if(!c)return;const before=c.bufferLevel;c.bufferLevel=el.value;recordOperation('calendar_source_buffer_changed','カレンダー余白を変更',{calendarName:c.summary,before,after:c.bufferLevel});persist();if(accessToken){try{await fetchGoogleEvents();notice('カレンダー余白を反映しました。');}catch(e){notice(e.message);}}else{renderToday();renderNow();}});
  $('saveKeywords').onclick=()=>{const before=[...(settings.classKeywords||[])];settings.classKeywords=$('classKeywords').value.split(',').map(x=>x.trim()).filter(Boolean);recordOperation('class_keywords_changed','授業日判定キーワードを変更',{beforeCount:before.length,afterCount:settings.classKeywords.length});persist();renderToday();};
  $('cloudSyncNow').onclick=()=>syncCloud('manual');
}

function mergeOperationLogs(a=[],b=[]){const map=new Map();[...(a||[]),...(b||[])].forEach(x=>{if(x?.id&&!map.has(x.id))map.set(x.id,x);});return [...map.values()].sort((x,y)=>String(y.occurredAt||'').localeCompare(String(x.occurredAt||'')));}
function buildCloudPayload(){ const data={}; CLOUD_KEYS.forEach(k=>data[k]=({tasks,overrides,settings,dayModes,dayStates,dailySleepPlans,wakeRecords,activityLog,operationLog,planSnapshots,ideas,closeouts,activeSession,semesters,classExceptions,motivation,calendarSources,morningTrainingOverrides,quickEvents})[k]); return {version:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,exportedAt:new Date().toISOString(),meta:load('meta',{}),data}; }
function applyPayload(payload){ const d=payload.data||payload; if(d.tasks)tasks=d.tasks.map(normalizeTask); if(d.overrides)overrides=d.overrides; if(d.settings)settings=deepDefaults(d.settings); if(d.dayModes)dayModes=d.dayModes; if(d.dayStates)dayStates=d.dayStates; if(d.dailySleepPlans)dailySleepPlans=d.dailySleepPlans; if('wakeRecords' in d)wakeRecords=d.wakeRecords||{}; if(d.activityLog)activityLog=d.activityLog; if('operationLog' in d)operationLog=d.operationLog||[]; if(d.planSnapshots)planSnapshots=d.planSnapshots; if(d.ideas)ideas=d.ideas; if(d.closeouts)closeouts=d.closeouts; if('activeSession' in d)activeSession=d.activeSession||null; if(d.semesters)semesters=d.semesters.map(normalizeSemester); if(d.classExceptions)classExceptions=d.classExceptions; if('motivation' in d)motivation=normalizeMotivation(d.motivation); if('calendarSources' in d)calendarSources=(d.calendarSources||[]).map(normalizeCalendarSource); if('morningTrainingOverrides' in d)morningTrainingOverrides=d.morningTrainingOverrides||{}; if('quickEvents' in d)quickEvents=d.quickEvents||[]; if(!calendarSources.length)calendarSources=[normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})]; if(!selectedSemesterId&&semesters.length)selectedSemesterId=semesters[0].id; }
function hasMeaningfulLocalData(){return tasks.length||activityLog.length||operationLog.length||ideas.length||semesters.length||Object.keys(dayModes).length||Object.keys(dailySleepPlans).length||Object.keys(wakeRecords).length||Object.keys(closeouts).length||Boolean(activeSession)||Boolean(motivation.exp||motivation.titleIds.length||motivation.victories.length);}
function queueCloudSync(){ if(!accessToken||!settings.cloudSyncEnabled)return; clearTimeout(cloudTimer); cloudTimer=setTimeout(()=>syncCloud('auto').catch(()=>{}),2500); }
async function driveRequest(url,options={}){if(!accessToken)throw new Error('Googleに接続してください。');const headers={Authorization:`Bearer ${accessToken}`,...(options.headers||{})};if(options.body&&!headers['Content-Type'])headers['Content-Type']='application/json';const res=await fetch(url,{...options,headers});if(!res.ok)throw new Error(`Drive API ${res.status}: ${await res.text()}`);if(res.status===204)return null;return res.headers.get('content-type')?.includes('application/json')?res.json():res.text();}
async function findCloudFile(){const p=new URLSearchParams({spaces:'appDataFolder',q:`name='${settings.cloudFileName||'life-os-data.json'}' and trashed=false`,fields:'files(id,name,modifiedTime)'});const d=await driveRequest(`https://www.googleapis.com/drive/v3/files?${p}`);return d.files?.[0]||null;}
async function downloadCloud(file){return driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);}
async function uploadCloud(fileId=null){let id=fileId;if(!id){const meta=await driveRequest('https://www.googleapis.com/drive/v3/files?fields=id,name,modifiedTime',{method:'POST',body:JSON.stringify({name:settings.cloudFileName||'life-os-data.json',parents:['appDataFolder']})});id=meta.id;}await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildCloudPayload())});cloudFileId=id;const now=new Date().toISOString();settings.cloudLastSyncAt=now;save('settings',settings);const meta=load('meta',{});save('meta',{...meta,cloudLastSyncAt:now});cloudStatus=`同期済み ${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;return id;}
async function syncCloud(mode='auto'){
  if(!accessToken){if(mode==='manual')notice('先にGoogleへ接続してください。');return;}
  cloudStatus='同期中…'; if($('cloudStatus'))$('cloudStatus').textContent=cloudStatus;
  try{const file=await findCloudFile();if(!file){await uploadCloud();notice('クラウド保存を作成しました。');return;}cloudFileId=file.id;const cloud=await downloadCloud(file);const cloudTime=Date.parse(cloud?.meta?.userDataUpdatedAt||cloud?.meta?.lastSavedAt||cloud?.exportedAt||0),localMeta=load('meta',{}),localTime=Date.parse(localMeta.userDataUpdatedAt||0),lastSync=Date.parse(settings.cloudLastSyncAt||localMeta.cloudLastSyncAt||0),localDirty=localTime>lastSync+1000,cloudDirty=cloudTime>lastSync+1000;
    if(!hasMeaningfulLocalData()&&cloudTime){applyPayload(cloud);const now=new Date().toISOString();settings.cloudLastSyncAt=now;persist({touch:false,cloud:false});cloudStatus='クラウドから復元';renderAll();return;}
    if(cloudDirty&&!localDirty){const localOps=operationLog;applyPayload(cloud);operationLog=mergeOperationLogs(operationLog,localOps);const now=new Date().toISOString();settings.cloudLastSyncAt=now;persist({touch:false,cloud:false});cloudStatus='クラウドから更新';renderAll();return;}
    if(localDirty&&!cloudDirty){await uploadCloud(file.id);return;}
    if(localDirty&&cloudDirty){if(mode==='auto'){cloudStatus='競合あり';return;}const useCloud=confirm('この端末とクラウドの両方に更新があります。OK＝クラウドを採用、キャンセル＝この端末でクラウドを上書き');if(useCloud){const localOps=operationLog;applyPayload(cloud);operationLog=mergeOperationLogs(operationLog,localOps);const now=new Date().toISOString();settings.cloudLastSyncAt=now;persist({touch:false,cloud:false});cloudStatus='クラウドを採用';renderAll();}else{operationLog=mergeOperationLogs(operationLog,cloud?.data?.operationLog||cloud?.operationLog||[]);await uploadCloud(file.id);}return;}
    cloudStatus='最新'; settings.cloudLastSyncAt=new Date().toISOString();save('settings',settings);
  }catch(e){cloudStatus='同期エラー';if(mode==='manual'||!String(e.message).includes('403'))notice(`クラウド同期できません：${e.message}`);else notice('Google Drive APIの有効化と drive.appdata 権限を確認してください。');}finally{if($('cloudStatus'))$('cloudStatus').textContent=cloudStatus;}
}

function dateAtMinute(day,minute){const d=new Date(`${day}T00:00:00`);d.setMinutes(minute);return d;}
async function calendarRequest(url,options={}){if(!accessToken)throw new Error('先にGoogleへ接続してください。');const headers={Authorization:`Bearer ${accessToken}`,...(options.headers||{})};if(options.body)headers['Content-Type']='application/json';const res=await fetch(url,{...options,headers});if(!res.ok)throw new Error(`Calendar API ${res.status}: ${await res.text()}`);if(res.status===204)return null;return res.json();}
async function syncPlanToGoogleCalendar(plan){if(!accessToken)return notice('先にGoogleへ接続してください。');const button=$('syncPlanCalendar');if(button){button.disabled=true;button.textContent='同期中…';}try{const ds=new Date(`${selectedDay}T00:00:00`),de=new Date(ds);de.setDate(de.getDate()+1);const p=new URLSearchParams({timeMin:ds.toISOString(),timeMax:de.toISOString(),singleEvents:'true',maxResults:'250',privateExtendedProperty:`lifeOSDay=${selectedDay}`});const existing=await calendarRequest(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);const old=(existing.items||[]).filter(e=>e.extendedProperties?.private?.lifeOSGenerated==='true');await Promise.all(old.map(e=>calendarRequest(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(e.id)}`,{method:'DELETE'})));const generated=plan.timeline.filter(x=>x.type==='task'||x.type==='life'),lead=Math.max(0,Math.min(120,Number(settings.notificationLeadMinutes||5)));for(const x of generated){const body={summary:`Life OS｜${x.title}`,description:x.type==='task'?`Life OS自動計画${x.pages?`（${x.pages}ページ）`:''}`:'Life OS生活最低ライン',start:{dateTime:dateAtMinute(selectedDay,x.start).toISOString(),timeZone:'Asia/Tokyo'},end:{dateTime:dateAtMinute(selectedDay,x.end).toISOString(),timeZone:'Asia/Tokyo'},reminders:{useDefault:false,overrides:[{method:'popup',minutes:lead}]},extendedProperties:{private:{lifeOSGenerated:'true',lifeOSDay:selectedDay,lifeOSType:x.type}}};await calendarRequest('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',body:JSON.stringify(body)});}recordOperation('calendar_plan_synced','Google Calendarへ今日の計画を同期',{generatedCount:generated.length,notificationLeadMinutes:lead},selectedDay);persist();notice(`${generated.length}件を同期しました。`);}catch(e){notice(`同期できません：${e.message}`);}finally{if(button){button.disabled=false;button.textContent='Google Calendarへ同期（通知）';}}}
function updateGoogleButton(status='未接続'){$('googleConnect').innerHTML=`Google<br><span>${settings.googleClientId?status:'Client ID未設定'}</span>`;$('googleConnect').disabled=!settings.googleClientId&&!isNativeIOS();}
async function refreshCalendarSources(){
  if(!accessToken)throw new Error('Google未接続');
  const res=await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',{headers:{Authorization:`Bearer ${accessToken}`}});
  if(res.status===401){accessToken='';sessionStorage.removeItem(GOOGLE_SESSION_KEY);updateGoogleButton('再接続が必要');throw new Error('Google接続期限が切れました。');}
  if(!res.ok)throw new Error(`CalendarList API ${res.status}`);
  const data=await res.json();
  calendarSources=mergeCalendarSources((data.items||[]).map(c=>({id:c.id,summary:c.summary,primary:Boolean(c.primary),accessRole:c.accessRole})));
  save('calendarSources',calendarSources);
  return calendarSources;
}
async function fetchGoogleEvents(){
  if(!accessToken)throw new Error('Google未接続');
  if(!calendarSources?.length || (calendarSources.length===1 && calendarSources[0].id==='primary' && !calendarSources[0].lastSeenAt)){
    try{await refreshCalendarSources();}catch(e){calendarSources=[normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})];}
  }
  const selected=(calendarSources||[]).filter(c=>c.enabled);
  const targets=selected.length?selected:[normalizeCalendarSource({id:'primary',summary:'メイン',primary:true,enabled:true,bufferLevel:'small'})];
  const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+90);
  const p=new URLSearchParams({timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'1000'});
  const all=[]; const failures=[];
  for(const cal of targets){
    const res=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${p}`,{headers:{Authorization:`Bearer ${accessToken}`}});
    if(res.status===401){accessToken='';sessionStorage.removeItem(GOOGLE_SESSION_KEY);updateGoogleButton('再接続が必要');throw new Error('Google接続期限が切れました。');}
    if(!res.ok){failures.push(cal.summary||cal.id); continue;}
    const data=await res.json();
    for(const e of data.items||[]){
      if(e.extendedProperties?.private?.lifeOSGenerated==='true')continue;
      const allDay=Boolean(e.start?.date&&!e.start?.dateTime);
      all.push({id:`${cal.id}::${e.id}`,googleEventId:e.id,calendarId:cal.id,calendarName:cal.summary||'Google Calendar',title:e.summary||'（無題）',allDay,start:allDay?e.start.date:e.start?.dateTime,end:allDay?e.end?.date:e.end?.dateTime,location:e.location||'',bufferLevel:cal.bufferLevel||inferCalendarBuffer(cal)});
    }
  }
  events=all;
  save('events',events); save('calendarSources',calendarSources);
  updateGoogleButton('接続済み');renderToday();renderNow();
  if(failures.length)notice(`一部カレンダーは読み込めません：${failures.join('、')}`);
  return events.length;
}
function restoreGoogleSession(){if(isNativeIOS())return;try{const s=JSON.parse(sessionStorage.getItem(GOOGLE_SESSION_KEY)||'null');if(!s?.accessToken||s.expiresAt<=Date.now()+60000)return;accessToken=s.accessToken;accessTokenExpiresAt=s.expiresAt;updateGoogleButton('接続済み');fetchGoogleEvents().then(()=>syncCloud('auto')).catch(e=>notice(e.message));}catch{}}
async function connectGoogle(){if(isNativeIOS()){postNative({type:'connectGoogle'});return;}if(!settings.googleClientId)return notice('設定でClient IDを入力してください。');try{if(!window.google?.accounts?.oauth2)throw new Error('Googleライブラリ読込中です。');const response=await new Promise((resolve,reject)=>{const client=window.google.accounts.oauth2.initTokenClient({client_id:settings.googleClientId,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.appdata',callback:r=>r.error?reject(new Error(r.error)):resolve(r)});client.requestAccessToken({prompt:''});});accessToken=response.access_token;accessTokenExpiresAt=Date.now()+Math.max(60,Number(response.expires_in||3600))*1000;sessionStorage.setItem(GOOGLE_SESSION_KEY,JSON.stringify({accessToken,expiresAt:accessTokenExpiresAt}));updateGoogleButton('取得中…');const n=await fetchGoogleEvents();recordOperation('google_connected','Googleへ接続',{calendarEventCount:n,calendarSourceCount:calendarSources.length,driveAppDataScope:true});persist();await syncCloud('auto');notice(`${n}件の予定を取得しました。`);}catch(e){updateGoogleButton('接続エラー');notice(e.message);}}

function syncNativePlan(plan){if(!isNativeIOS()||selectedDay!==dateKey())return;postNative({type:'syncPlan',payload:{day:selectedDay,classDay:plan.classDay,scheduledTaskMinutes:plan.scheduledTaskMinutes,relaxedMinutes:Math.round(plan.relaxedMinutes),notificationLeadMinutes:Number(settings.notificationLeadMinutes||5),timeline:plan.timeline.map(x=>({title:x.title,type:x.type,startMinute:Math.round(x.start),endMinute:Math.round(x.end)}))}});}
window.lifeOSReceiveCalendarEvents=incoming=>{events=Array.isArray(incoming)?incoming:[];if(!calendarSources.length)calendarSources=[normalizeCalendarSource({id:'native',summary:'iPhoneカレンダー',primary:true,enabled:true,bufferLevel:'small'})];save('events',events);save('calendarSources',calendarSources);updateGoogleButton('接続済み');renderToday();renderNow();};

function activateTab(name){const btn=[...document.querySelectorAll('.tabs button')].find(b=>b.dataset.tab===name);if(!btn)return;document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.add('hidden'));$(`${name}Tab`).classList.remove('hidden');if(name==='now')renderNow();if(name==='timetable')renderTimetable();if(name==='tasks')renderTasks();}
function setupTabs(){document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));}
$('googleConnect').onclick=connectGoogle; setupTabs(); updateGoogleButton(); renderAll(); restoreGoogleSession();
