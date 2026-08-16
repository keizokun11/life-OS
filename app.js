import { DEFAULT_SETTINGS, deepDefaults, dateKey, addDays, generateDayPlan, forecastDeadlineRisks, minutesLabel, timeLabel, toMinutes, taskMinutesPerPage } from './scheduler.js';

const APP_VERSION = '1.4.0';
const DATA_SCHEMA_VERSION = 6;
const DATA_KEYS = ['tasks','events','overrides','settings','dayModes','dayStates','dailySleepPlans','wakeRecords','activityLog','operationLog','planSnapshots','ideas','closeouts','activeSession','semesters','classExceptions'];
const CLOUD_KEYS = ['tasks','overrides','settings','dayModes','dayStates','dailySleepPlans','wakeRecords','activityLog','operationLog','planSnapshots','ideas','closeouts','activeSession','semesters','classExceptions'];
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
    createdAt: t.createdAt || new Date().toISOString(), status: t.status || 'active',
  };
}

const DEFAULT_PERIODS = [
  { no:1, start:'08:45', end:'10:15' }, { no:2, start:'10:30', end:'12:00' },
  { no:3, start:'13:00', end:'14:30' }, { no:4, start:'14:45', end:'16:15' },
  { no:5, start:'16:30', end:'18:00' }, { no:6, start:'18:15', end:'19:45' },
];
function normalizeCourse(c={}) { const weekday=Number.isFinite(Number(c.weekday))?Number(c.weekday):1, periodNo=Number.isFinite(Number(c.periodNo))?Number(c.periodNo):1; return { id:c.id||uid(), name:c.name||'', weekday, periodNo, defaultDelivery:c.defaultDelivery||'normal', onDemandMinutes:Math.max(10,Number(c.onDemandMinutes||90)), bufferLevel:c.bufferLevel||'small', location:c.location||'' }; }
function normalizeSemester(x={}) { return { id:x.id||uid(), academicYear:Number(x.academicYear||new Date().getFullYear()), term:x.term||'spring', name:x.name||`${x.academicYear||new Date().getFullYear()}年度 ${x.term==='fall'?'秋学期':'春学期'}`, startDate:x.startDate||dateKey(), endDate:x.endDate||addDays(dateKey(),120), periods:(x.periods?.length?x.periods:DEFAULT_PERIODS).map((q,i)=>({no:Number(q.no||i+1),start:q.start||DEFAULT_PERIODS[i]?.start||'09:00',end:q.end||DEFAULT_PERIODS[i]?.end||'10:30'})), courses:(x.courses||[]).map(normalizeCourse) }; }
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
  save('tasks',tasks); save('events',events); save('overrides',overrides); save('settings',settings); save('dayModes',dayModes); save('dayStates',dayStates); save('dailySleepPlans',dailySleepPlans); save('wakeRecords',wakeRecords); save('activityLog',activityLog); save('operationLog',operationLog); save('planSnapshots',planSnapshots); save('ideas',ideas); save('closeouts',closeouts); save('activeSession',activeSession); save('semesters',semesters); save('classExceptions',classExceptions);
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
  return [...google,...academicEventsForDay(day)];
}
function planningEventsForForecast(fromDay,days){
  let academics=[]; for(let i=0;i<=Math.min(180,Number(days||90));i++) academics.push(...academicEventsForDay(addDays(fromDay,i)));
  const filtered=(events||[]).filter(e=>{ if(e.allDay)return true; const day=dateKey(new Date(e.start)); const sem=semesterForDay(day); if(!sem)return true; return !sem.courses.some(c=>Number(c.weekday)===new Date(`${day}T12:00:00`).getDay() && isSameCourseCalendarEvent(e,c,day)); });
  return [...filtered,...academics];
}
function sleepPlanForDay(day){
  const own=dailySleepPlans[day]||{}, previous=dailySleepPlans[addDays(day,-1)]||{};
  const plannedWakeTime=previous.nextWakeTime||settings.wakeTime;
  const wake=wakeRecords[day]||null;
  const actualWakeTime=wake?.wakeTime||'';
  return { plannedWakeTime, actualWakeTime, wakeTime:actualWakeTime||plannedWakeTime, wokeAt:wake?.wokeAt||'', bedTime:own.bedTime||settings.bedTime, nextWakeTime:own.nextWakeTime||settings.wakeTime, customBed:Boolean(own.bedTime), customNextWake:Boolean(own.nextWakeTime) };
}
function effectiveSettingsForDay(day){ const s=sleepPlanForDay(day); return {...settings,wakeTime:s.wakeTime,bedTime:s.bedTime}; }
function dayHasStarted(day){ return day!==dateKey() || Boolean(wakeRecords[day]?.wakeTime); }
function hhmm(d=new Date()){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function markAwakeNow(){
  const now=new Date(), day=dateKey(now), sleep=sleepPlanForDay(day), wakeTime=hhmm(now);
  wakeRecords[day]={wakeTime,wokeAt:now.toISOString(),plannedWakeTime:sleep.plannedWakeTime,source:'button'};
  selectedDay=day;
  recordOperation('wake_confirmed','起床を記録',{wakeTime,plannedWakeTime:sleep.plannedWakeTime,source:'button'},day);
  persist(); renderAll(); notice(`起床 ${wakeTime}。この時刻から今日の予定を作成しました。`);
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
  return `<div class="stack"><section class="hero-card wake-gate"><p class="eyebrow">MORNING START</p><h2>起きたら、ここから1日を開始</h2><div class="wake-times"><div><span>起床予定</span><strong>${sleep.plannedWakeTime}</strong></div><div><span>現在時刻</span><strong>${now}</strong></div></div><button id="wakeNow-${tab}" class="primary wake-button">起きた（${now}）</button><p class="wake-note">このボタンを押すまでは今日の作業計画を作成しません。押した実際の起床時刻から、授業・予定・課題・ゆったり時間を組み直します。</p></section></div>`;
}
function plannedSleepMinutes(day){
  const s=sleepPlanForDay(day); let bed=toMinutes(s.bedTime), todayWake=toMinutes(s.wakeTime); if(bed<=todayWake)bed+=1440; let nextWake=1440+toMinutes(s.nextWakeTime); if(nextWake<=bed)nextWake+=1440; return Math.max(0,nextWake-bed);
}
function currentPlan(day=selectedDay){ return generateDayPlan({day,tasks,events:planningEventsForDay(day),overrides,settings:effectiveSettingsForDay(day),classDayOverride:dayModes[day]||'auto',energyState:dayStates[day]||'normal'}); }
function currentRisks(){ return forecastDeadlineRisks({fromDay:dateKey(),tasks,events:planningEventsForForecast(dateKey(),settings.forecastDays),overrides,settings,dayModes,dayStates,dailySleepPlans,wakeRecords,maxDays:settings.forecastDays}); }

function riskBadge(r){ if(!r) return ''; const label={green:'順調',yellow:'注意',orange:'厳しい',red:'要調整'}[r.level]; return `<span class="risk-badge ${r.level}">${label}</span>`; }

function saveTodaySnapshot(plan, manualMode) {
  if (selectedDay !== dateKey()) return;
  const sleep=sleepPlanForDay(selectedDay);
  const snap = { date:selectedDay, updatedAt:new Date().toISOString(), manualMode, energyState:dayStates[selectedDay]||'normal', classDay:plan.classDay, wakeTime:sleep.wakeTime, plannedWakeTime:sleep.plannedWakeTime, actualWakeTime:sleep.actualWakeTime||null, wokeAt:sleep.wokeAt||null, bedTime:sleep.bedTime, nextWakeTime:sleep.nextWakeTime, plannedSleepMinutes:plannedSleepMinutes(selectedDay), scheduledTaskMinutes:Math.round(plan.scheduledTaskMinutes), scheduledTaskPages:Math.round(plan.scheduledTaskPages||0), relaxedMinutes:Math.round(plan.relaxedMinutes), rawFreeMinutes:Math.round(plan.rawFreeMinutes), timeline:plan.timeline.map(x=>({type:x.type,taskId:x.taskId||null,title:x.title,start:Math.round(x.start),end:Math.round(x.end),pages:Number(x.pages||0),movable:x.movable!==false})) };
  const before = planSnapshots[selectedDay];
  const comparable = o => JSON.stringify({...o,updatedAt:undefined});
  if (!before || comparable(before)!==comparable(snap)) { planSnapshots[selectedDay]=snap; persist(); }
}

function renderAll(){ renderToday(); renderNow(); renderTimetable(); renderTasks(); renderIdeas(); renderHistory(); renderSettings(); }

function renderNow(){
  if(!dayHasStarted(dateKey())){ $('nowTab').innerHTML=wakeGateMarkup('now'); const b=$('wakeNow-now'); if(b)b.onclick=markAwakeNow; return; }
  const plan = currentPlan(dateKey());
  const now = new Date(); const nowMin=now.getHours()*60+now.getMinutes();
  const nextTask = plan.timeline.find(x=>x.type==='task' && x.end>nowMin) || plan.timeline.find(x=>x.type==='task') || plan.timeline.find(x=>x.type==='life' && x.end>nowMin);
  if (activeSession) {
    const elapsed = Math.max(1,Math.round((Date.now()-new Date(activeSession.startedAt))/60000));
    $('nowTab').innerHTML = `<div class="focus-screen"><p class="eyebrow">ACTIVE SESSION</p><h2>${esc(activeSession.title)}</h2><div class="focus-big">${activeSession.plannedPages ? `${activeSession.plannedPages}ページ` : activeSession.taskId ? minutesLabel(activeSession.plannedMinutes||0) : '生活タスク'}</div><p class="focus-timer" id="focusTimer">${minutesLabel(elapsed)}</p><div class="focus-actions"><button id="finishSession" class="primary">完了</button><button id="partialSession" class="secondary">途中終了</button><button id="cancelSession" class="ghost">中断（記録しない）</button></div><p class="muted">開始後はここだけ見ればOK。ページ学習なら実績から速度も自動学習します。</p></div>`;
    $('finishSession').onclick=()=>finishActiveSession(false); $('partialSession').onclick=()=>finishActiveSession(true); $('cancelSession').onclick=()=>{ if(confirm('このセッションを記録せず中断しますか？')){const ended=new Date().toISOString(),session={...activeSession};recordOperation('session_cancelled','セッションを中断',{taskId:session.taskId||null,taskTitle:session.title,startedAt:session.startedAt,endedAt:ended,elapsedMinutes:Math.max(1,Math.round((Date.now()-new Date(session.startedAt))/60000))},session.day);activeSession=null;persist();renderNow();} };
    clearInterval(sessionTimer); sessionTimer=setInterval(()=>{ const el=$('focusTimer'); if(el&&activeSession) el.textContent=minutesLabel(Math.max(1,Math.round((Date.now()-new Date(activeSession.startedAt))/60000))); },15000);
    return;
  }
  clearInterval(sessionTimer);
  $('nowTab').innerHTML = `<div class="focus-screen"><p class="eyebrow">NEXT ACTION</p>${nextTask ? `<h2>${esc(nextTask.title)}</h2><div class="focus-big">${nextTask.pages ? `${nextTask.pages}ページ` : minutesLabel(nextTask.end-nextTask.start)}</div><p class="muted">${timeLabel(nextTask.start)}–${timeLabel(nextTask.end)}${nextTask.movable===false?' ・ 固定':''}</p><button id="startNext" class="primary focus-start">START</button>` : '<h2>今やる課題はありません</h2><p class="muted">今日の必要分が終わっているか、課題が未登録です。</p>'}</div>`;
  if($('startNext')) $('startNext').onclick=()=>startSession(nextTask);
}
function startSession(item){
  if(!item) return; if(activeSession && !confirm('現在のセッションを置き換えますか？')) return;
  activeSession={id:uid(),day:dateKey(),taskId:item.taskId||null,title:item.title,plannedPages:Number(item.pages||0),plannedMinutes:Number(item.end-item.start||0),kind:item.type,startedAt:new Date().toISOString()};
  recordOperation('session_started','作業を開始',{sessionId:activeSession.id,taskId:activeSession.taskId,taskTitle:activeSession.title,plannedPages:activeSession.plannedPages,plannedMinutes:activeSession.plannedMinutes,startedAt:activeSession.startedAt},activeSession.day);
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
  recordCompletion({taskId:session.taskId,title:session.title,kind:session.kind,pages,minutes:elapsed,completeTimeTask,key:`session:${session.id}`,source:'session',date:session.day});
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
  const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes(); const next=plan.timeline.find(x=>x.end>nowMin)||plan.timeline[0];
  const riskHtml=risks.filter(r=>r.level!=='green').map(r=>`<div class="risk-row ${r.level}"><div><strong>${esc(r.title)}</strong><small>${esc(r.text)}</small></div><span>${esc(r.action)}</span></div>`).join('');
  const pending=plan.allDayPending.map(e=>`<div class="resolver" data-event-id="${esc(e.id)}"><strong>${esc(e.title)}</strong><p class="muted">終日予定は自動では一日拘束にしません。</p><div class="segmented"><button class="selected" data-kind="timed">実時間あり</button><button data-kind="memo">予定メモ</button></div><div class="resolver-fields form-grid compact"><label>開始<input type="time" class="all-start" value="13:00"></label><label>終了<input type="time" class="all-end" value="15:00"></label><label>時間考慮<select class="all-buffer"><option value="none">なし</option><option value="small">小</option><option value="medium" selected>中</option><option value="large">大</option></select></label></div><button class="primary small resolve-save">確定</button></div>`).join('');
  const bufferRows=(plan.eventBufferInfo||[]).map(e=>`<div class="event-buffer-row" data-event-id="${esc(e.id)}"><div><strong>${esc(e.title)}</strong><small>${timeLabel(e.start)}–${timeLabel(e.end)} ・ 前${Math.round(e.before)}分 / 後${Math.round(e.after)}分</small></div><label>時間考慮<select class="event-buffer-select"><option value="auto" ${e.selection==='auto'?'selected':''}>自動</option><option value="none" ${e.selection==='none'?'selected':''}>なし</option><option value="small" ${e.selection==='small'?'selected':''}>小</option><option value="medium" ${e.selection==='medium'?'selected':''}>中</option><option value="large" ${e.selection==='large'?'selected':''}>大</option><option value="custom" ${e.selection==='custom'?'selected':''}>カスタム</option></select></label><div class="custom-buffer-fields ${e.selection==='custom'?'':'hidden'}"><label>前（分）<input type="number" min="0" class="custom-before" value="${Math.round(e.before)}"></label><label>後（分）<input type="number" min="0" class="custom-after" value="${Math.round(e.after)}"></label><button class="primary small custom-buffer-save">保存</button></div></div>`).join('');
  const timeline=plan.timeline.map(x=>{
    const mins=x.end-x.start, completionKey=`${x.type}:${x.taskId||x.title}:${Math.round(x.start)}:${Math.round(x.end)}`;
    const recorded=activityLog.some(a=>a.date===selectedDay&&a.key===completionKey); let action='';
    if(x.type==='task') action=recorded?'<span class="done-mark">記録済み</span>':`<button class="done-btn" data-task-id="${esc(x.taskId||'')}" data-mins="${mins}" data-pages="${Number(x.pages||0)}" data-kind="task" data-title="${esc(x.title)}" data-key="${esc(completionKey)}">実績</button>`;
    if(x.type==='life') action=recorded?'<span class="done-mark">完了済み</span>':`<button class="done-btn" data-mins="${mins}" data-pages="0" data-kind="life" data-title="${esc(x.title)}" data-key="${esc(completionKey)}">完了</button>`;
    const amount=x.type==='task'&&x.pages?`${x.pages}ページ ・ ${minutesLabel(mins)}目安${x.movable===false?' ・ 固定':''}`:minutesLabel(mins);
    return `<div class="timeline-item ${x.type}"><div class="time">${timeLabel(x.start)}<br><span>${timeLabel(x.end)}</span></div><div class="timeline-body"><strong>${esc(x.title)}</strong><small>${amount}</small></div>${action}</div>`;
  }).join('');
  const close=closeouts[selectedDay];
  $('todayTab').innerHTML=`<div class="stack"><section class="hero-card"><div class="row between"><div><p class="eyebrow">TODAY</p><input id="dayPicker" class="date-input" type="date" value="${selectedDay}"></div><label class="mode-select-wrap">日モード<select id="dayModeSelect" class="mode-select ${plan.classDay?'class':''}"><option value="auto" ${manualMode==='auto'?'selected':''}>自動判定</option><option value="class" ${manualMode==='class'?'selected':''}>授業日</option><option value="noClass" ${manualMode==='noClass'?'selected':''}>授業なし日</option></select></label></div><div class="energy-row"><span>今日の状態</span><div class="segmented energy-select"><button data-energy="high" ${energyState==='high'?'class="selected"':''}>元気</button><button data-energy="normal" ${energyState==='normal'?'class="selected"':''}>普通</button><button data-energy="tired" ${energyState==='tired'?'class="selected"':''}>疲れ</button></div></div><div class="metrics"><div><span>予定した課題量</span><strong>${Number(plan.scheduledTaskPages||0)}頁 / ${minutesLabel(plan.scheduledTaskMinutes||0)}</strong></div><div><span>ゆったり時間</span><strong>${minutesLabel(plan.relaxedMinutes)}</strong></div></div><div class="next-action"><p>NEXT ACTION</p>${close?'<h2>今日は運用終了</h2><strong>残りは自動で明日以降へ再計画されます</strong>':next?`<h2>${esc(next.title)}</h2><strong>${timeLabel(next.start)}–${timeLabel(next.end)}</strong>`:'<h2>今日はもう予定なし</h2>'}</div></section><section class="card sleep-plan-card"><div class="row between"><div><p class="eyebrow">SLEEP PLAN</p><h3>今日の睡眠予定</h3></div><span class="sleep-duration">睡眠 ${minutesLabel(sleepMinutes)}</span></div><form id="dailySleepForm" class="form-grid"><label>今日の起床${sleep.actualWakeTime?'実績':'予定'}<input type="time" value="${sleep.actualWakeTime||sleep.plannedWakeTime}" disabled></label><label>今日の就寝予定<input type="time" name="bedTime" value="${sleep.bedTime}"></label><label>${tomorrow.slice(5).replace('-', '/')} の起床予定<input type="time" name="nextWakeTime" value="${sleep.nextWakeTime}"></label><div class="sleep-plan-note">${sleep.actualWakeTime?`起床予定 ${sleep.plannedWakeTime} ／ 実際 ${sleep.actualWakeTime}。今日の計画は実際の起床時刻から作成しています。`:`未来日の計画は起床予定 ${sleep.plannedWakeTime} から仮計算します。`} 就寝予定から、お風呂・肌ケアと作業可能時間も再計算します。</div><div class="span2 row"><button class="primary small">保存して再計算</button><button type="button" id="resetSleepPlan" class="secondary small">標準時刻に戻す</button>${selectedDay===dateKey()&&sleep.actualWakeTime?'<button type="button" id="editWakeTime" class="ghost small">起床時刻を修正</button>':''}</div></form></section>${riskHtml?`<section class="card"><h3>期限リスク</h3><div class="risk-list">${riskHtml}</div></section>`:''}${pending?`<section class="card"><h3>終日予定を確認</h3>${pending}</section>`:''}${bufferRows?`<section class="card"><h3>既存予定の前後余白</h3><p class="muted">予定本体は変えず、前後だけLife OS内で確保します。</p><div class="event-buffer-list">${bufferRows}</div></section>`:''}<section class="card"><h3>今日の達成予定</h3><div class="timeline">${timeline||'<p class="muted">予定・課題がまだありません。</p>'}</div><div class="relaxed-band">ゆったり時間　${minutesLabel(plan.relaxedMinutes)}</div>${!isNativeIOS()?'<button id="syncPlanCalendar" class="primary">Google Calendarへ同期（通知）</button>':''}</section><section class="card night-card"><h3>今日を終了する</h3>${close?`<p class="success-note">${new Date(close.closedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} に終了済み。残った課題は自動再計画対象です。</p>`:`<div class="check-list"><label><input id="closeBath" type="checkbox"> お風呂</label><label><input id="closeSkin" type="checkbox"> 肌ケア</label><label><input id="closePrep" type="checkbox"> 明日の準備</label></div><button id="closeDay" class="primary">今日の運用を終了</button><p class="muted">未完了ページは残量として保持され、明日以降の計画に自動で戻ります。</p>`}</section></div>`;
  $('dayPicker').onchange=e=>{selectedDay=e.target.value;renderToday();};
  $('dayModeSelect').onchange=e=>{const before=dayModes[selectedDay]||'auto',after=e.target.value;if(after==='auto') delete dayModes[selectedDay]; else dayModes[selectedDay]=after;recordOperation('day_mode_changed','授業日モードを変更',{before,after},selectedDay);persist();renderToday();renderHistory();};
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
  if($('syncPlanCalendar')) $('syncPlanCalendar').onclick=()=>syncPlanToGoogleCalendar(plan);
  if($('closeDay')) $('closeDay').onclick=()=>{const closedAt=new Date().toISOString();closeouts[selectedDay]={bath:$('closeBath').checked,skincare:$('closeSkin').checked,prep:$('closePrep').checked,closedAt};activityLog.unshift({id:uid(),date:selectedDay,completedAt:closedAt,kind:'closeout',title:'一日終了',minutes:0,pages:0,key:`closeout:${selectedDay}`});recordOperation('day_closed','今日の運用を終了',{...closeouts[selectedDay]},selectedDay);persist();renderAll();};
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
  const deadline=prompt('期限（YYYY-MM-DD）',existing?.deadline||day); if(!deadline)return;
  const quantityText=prompt('量のメモ（任意：例「動画1本＋小テスト」）',existing?.quantityText||'動画1回') ?? '';
  const obj=normalizeTask({...(existing||{}),id:existing?.id||uid(),taskType:'classAssignment',courseId:course.id,assignmentType:'ondemand',title:`${course.name}（オンデマンド）`,deadline,remainingMinutes:minutes,initialMinutes:existing?.initialMinutes||minutes,quantityText,priority:'high',focus:'maintain',mode:'maintain',timePreference:'any',minBlock:20,maxBlock:Math.max(30,Math.min(120,minutes)),placement:'flexible',source:'classOndemand',sourceKey:key,status:'active'});
  if(existing)tasks=tasks.map(t=>t.id===existing.id?obj:t);else tasks.push(obj);recordOperation(existing?'task_updated':'task_created',existing?'オンデマンド課題を更新':'オンデマンド課題を追加',{taskId:obj.id,taskTitle:obj.title,courseId:course.id,deadline,remainingMinutes:minutes,quantityText,source:'classOndemand'},day);persist();renderAll();notice('オンデマンド授業を課題に追加しました。');
}
function openCourseTaskDraft(courseId,type='weekly'){
  const found=courseForId(courseId); if(!found)return; const {course}=found;
  taskDraft={taskType:'classAssignment',courseId:course.id,assignmentType:type,title:`${course.name}：`,deadline:addDays(dateKey(),7),remainingMinutes:60,quantityText:'',priority:'high',focus:'maintain',mode:'maintain',timePreference:'any',minBlock:20,maxBlock:90,placement:'flexible',fixedDate:dateKey(),fixedTime:'09:00'};
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

function taskFormValues(t){return t||taskDraft||{taskType:'study',title:'',deadline:addDays(dateKey(),30),remainingPages:30,baseMinutesPerPage:3,remainingMinutes:60,quantityText:'',courseId:'',assignmentType:'weekly',priority:'medium',focus:'main',mode:'grow',timePreference:'any',minPages:5,maxPages:30,minBlock:20,maxBlock:120,placement:'flexible',fixedDate:dateKey(),fixedTime:'09:00',fixedPages:5,fixedMinutes:30};}
function renderTasks(){
  const risks=Object.fromEntries(currentRisks().map(r=>[r.taskId,r])); const edit=tasks.find(t=>t.id===editingTaskId); const f=taskFormValues(edit); const isStudy=f.taskType==='study';
  const assignmentLabels={weekly:'週課題',midterm:'中間課題',final:'期末課題',ondemand:'オンデマンド',other:'その他'};
  const rows=tasks.map(t=>{const found=courseForId(t.courseId);const amount=Number.isFinite(Number(t.remainingPages))?`残り ${Number(t.remainingPages||0)}ページ ・ ${t.learnedMinutesPerPage?`学習値 ${t.learnedMinutesPerPage}分/頁`:`初期 ${t.baseMinutesPerPage||t.minutesPerPage}分/頁`}`:`残り目安 ${minutesLabel(t.remainingMinutes||0)}${t.quantityText?` ・ 量 ${esc(t.quantityText)}`:''}`;const source=t.taskType==='classAssignment'?`${found?.course?.name||'授業'}・${assignmentLabels[t.assignmentType]||'課題'}`:t.taskType==='general'?'その他タスク':'学習';return `<div class="task-row"><div><div class="row"><strong>${esc(t.title)}</strong>${riskBadge(risks[t.id])}</div><small>${esc(source)} ・ 期限 ${esc(t.deadline)} ・ ${amount} ・ ${t.placement==='flexible'?'自動配置':t.placement==='date'?`${t.fixedDate}のみ`:`${t.fixedDate} ${t.fixedTime}固定`}</small></div><span class="tag ${t.focus}">${t.focus==='main'?'メイン':t.focus==='sub'?'サブ':'維持'}</span><div class="row"><button class="icon-btn edit-task" data-id="${t.id}">編集</button><button class="icon-btn delete-task" data-id="${t.id}">削除</button></div></div>`;}).join('');
  $('tasksTab').innerHTML=`<div class="stack"><section class="card"><p class="eyebrow">${edit?'EDIT TASK':'NEW TASK'}</p><h2>${edit?'課題を編集':'課題・タスクを登録'}</h2><form id="taskForm" class="form-grid"><label>種類<select id="taskTypeSelect" name="taskType"><option value="study" ${f.taskType==='study'?'selected':''}>学習（ページ）</option><option value="classAssignment" ${f.taskType==='classAssignment'?'selected':''}>授業課題</option><option value="general" ${f.taskType==='general'?'selected':''}>その他タスク</option></select></label><label>期限<input type="date" name="deadline" required value="${f.deadline}"></label><label class="span2">課題名<input name="title" required value="${esc(f.title)}"></label><div id="courseTaskFields" class="span2 form-grid ${f.taskType==='classAssignment'?'':'hidden'}"><label>授業<select name="courseId"><option value="">選択</option>${courseOptions(f.courseId)}</select></label><label>課題区分<select name="assignmentType"><option value="weekly" ${f.assignmentType==='weekly'?'selected':''}>週課題</option><option value="midterm" ${f.assignmentType==='midterm'?'selected':''}>中間課題</option><option value="final" ${f.assignmentType==='final'?'selected':''}>期末課題</option><option value="ondemand" ${f.assignmentType==='ondemand'?'selected':''}>オンデマンド</option><option value="other" ${f.assignmentType==='other'?'selected':''}>その他</option></select></label></div><div id="studyFields" class="span2 form-grid ${isStudy?'':'hidden'}"><label>残り必要量（ページ）<input type="number" name="remainingPages" min="1" value="${Number(f.remainingPages||30)}"></label><label>1ページ初期目安（分）<input type="number" name="minutesPerPage" min="0.25" step="0.25" value="${Number(f.baseMinutesPerPage||f.minutesPerPage||3)}"></label><label>1回最小（ページ）<input type="number" name="minPages" min="1" value="${Number(f.minPages||5)}"></label><label>1回最大（ページ）<input type="number" name="maxPages" min="1" value="${Number(f.maxPages||30)}"></label></div><div id="timeTaskFields" class="span2 form-grid ${isStudy?'hidden':''}"><label>量（自由入力）<input name="quantityText" value="${esc(f.quantityText||'')}" placeholder="例：2000字 / 問題10問 / 動画2本"></label><label>残り予想時間（分）<input type="number" name="remainingMinutes" min="5" value="${Number(f.remainingMinutes||60)}"></label><label>1回最小（分）<input type="number" name="minBlock" min="5" value="${Number(f.minBlock||20)}"></label><label>1回最大（分）<input type="number" name="maxBlock" min="10" value="${Number(f.maxBlock||120)}"></label></div><label>優先度<select name="priority"><option value="high" ${f.priority==='high'?'selected':''}>高</option><option value="medium" ${f.priority==='medium'?'selected':''}>中</option><option value="low" ${f.priority==='low'?'selected':''}>低</option></select></label><label>重点<select name="focus"><option value="main" ${f.focus==='main'?'selected':''}>メイン</option><option value="sub" ${f.focus==='sub'?'selected':''}>サブ</option><option value="maintain" ${f.focus==='maintain'?'selected':''}>維持</option></select></label><label>領域<select name="mode"><option value="grow" ${f.mode==='grow'?'selected':''}>伸ばす</option><option value="maintain" ${f.mode==='maintain'?'selected':''}>維持</option></select></label><label>時間帯<select name="timePreference"><option value="any" ${f.timePreference==='any'?'selected':''}>いつでも</option><option value="morning" ${f.timePreference==='morning'?'selected':''}>朝優先</option><option value="evening" ${f.timePreference==='evening'?'selected':''}>夜優先</option></select></label><label>配置方法<select id="placementSelect" name="placement"><option value="flexible" ${f.placement==='flexible'?'selected':''}>自動移動OK</option><option value="date" ${f.placement==='date'?'selected':''}>指定日だけ</option><option value="datetime" ${f.placement==='datetime'?'selected':''}>指定日時に固定</option></select></label><div id="fixedFields" class="span2 form-grid ${f.placement==='flexible'?'hidden':''}"><label>固定日<input type="date" name="fixedDate" value="${f.fixedDate||dateKey()}"></label><label class="fixed-time ${f.placement==='datetime'?'':'hidden'}">開始時刻<input type="time" name="fixedTime" value="${f.fixedTime||'09:00'}"></label><label id="fixedPageField" class="fixed-time ${f.placement==='datetime'&&isStudy?'':'hidden'}">その枠で進めるページ<input type="number" name="fixedPages" min="1" value="${Number(f.fixedPages||5)}"></label><label id="fixedMinuteField" class="fixed-time ${f.placement==='datetime'&&!isStudy?'':'hidden'}">その枠の予定時間（分）<input type="number" name="fixedMinutes" min="5" value="${Number(f.fixedMinutes||30)}"></label></div><div class="span2 row"><button class="primary">${edit?'更新':'登録'}</button>${edit||taskDraft?'<button type="button" id="cancelEdit" class="secondary">入力をリセット</button>':''}</div></form><p class="muted">学習はページ数で管理。授業課題・その他タスクは「量のメモ＋予想時間」でLife OSが空き時間へ配分します。</p></section><section class="card"><h3>登録済み</h3><div class="task-list">${rows||'<p class="muted">まだ課題がありません。</p>'}</div></section></div>`;
  const placement=$('placementSelect'), type=$('taskTypeSelect');
  const updateForm=()=>{const study=type.value==='study',v=placement.value;$('studyFields').classList.toggle('hidden',!study);$('timeTaskFields').classList.toggle('hidden',study);$('courseTaskFields').classList.toggle('hidden',type.value!=='classAssignment');$('fixedFields').classList.toggle('hidden',v==='flexible');document.querySelectorAll('.fixed-time').forEach(x=>x.classList.toggle('hidden',v!=='datetime'));if(v==='datetime'){$('fixedPageField').classList.toggle('hidden',!study);$('fixedMinuteField').classList.toggle('hidden',study);}}; placement.onchange=updateForm; type.onchange=updateForm; updateForm();
  $('taskForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),old=tasks.find(t=>t.id===editingTaskId),study=d.taskType==='study';const data={...(old||{}),id:old?.id||uid(),taskType:d.taskType,title:d.title,deadline:d.deadline,priority:d.priority,focus:d.focus,mode:d.mode,timePreference:d.timePreference,placement:d.placement,fixedDate:d.fixedDate||'',fixedTime:d.fixedTime||'09:00',status:'active',courseId:d.taskType==='classAssignment'?(d.courseId||''):'',assignmentType:d.taskType==='classAssignment'?(d.assignmentType||'weekly'):'',quantityText:study?'':d.quantityText||'',minBlock:Number(d.minBlock||20),maxBlock:Number(d.maxBlock||120),fixedMinutes:Number(d.fixedMinutes||30)};if(study){data.remainingPages=Number(d.remainingPages);data.initialPages=old?.taskType==='study'?old.initialPages:Number(d.remainingPages);data.baseMinutesPerPage=Number(d.minutesPerPage);data.minutesPerPage=old?.taskType==='study'&&old?.speedSamples?old.minutesPerPage:Number(d.minutesPerPage);data.minPages=Number(d.minPages||5);data.maxPages=Number(d.maxPages||30);data.fixedPages=Number(d.fixedPages||d.minPages||5);delete data.remainingMinutes;}else{data.remainingMinutes=Number(d.remainingMinutes);data.initialMinutes=old?.taskType===d.taskType?old.initialMinutes:Number(d.remainingMinutes);delete data.remainingPages;delete data.initialPages;delete data.baseMinutesPerPage;delete data.minutesPerPage;delete data.learnedMinutesPerPage;delete data.minPages;delete data.maxPages;}const obj=normalizeTask(data);if(old)tasks=tasks.map(t=>t.id===old.id?obj:t);else tasks.push(obj);recordOperation(old?'task_updated':'task_created',old?'課題・タスクを更新':'課題・タスクを登録',{taskId:obj.id,taskTitle:obj.title,taskType:obj.taskType,deadline:obj.deadline,remainingPages:Number.isFinite(Number(obj.remainingPages))?Number(obj.remainingPages):null,remainingMinutes:Number.isFinite(Number(obj.remainingMinutes))?Number(obj.remainingMinutes):null,courseId:obj.courseId||'',assignmentType:obj.assignmentType||''});editingTaskId=null;taskDraft=null;persist();renderAll();};
  if($('cancelEdit'))$('cancelEdit').onclick=()=>{editingTaskId=null;taskDraft=null;renderTasks();};
  document.querySelectorAll('.edit-task').forEach(b=>b.onclick=()=>{editingTaskId=b.dataset.id;taskDraft=null;renderTasks();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelectorAll('.delete-task').forEach(b=>b.onclick=()=>{if(confirm('この課題を削除しますか？')){const task=tasks.find(t=>t.id===b.dataset.id);tasks=tasks.filter(t=>t.id!==b.dataset.id);recordOperation('task_deleted','課題・タスクを削除',{taskId:b.dataset.id,taskTitle:task?.title||'',taskType:task?.taskType||''});persist();renderAll();}});
}

function renderIdeas(){
  const rows=ideas.map(i=>`<div class="idea-row"><div><strong>${esc(i.title)}</strong><small>${esc(i.note||'')}</small></div><button class="primary small promote-idea" data-id="${i.id}">課題に昇格</button><button class="icon-btn delete-idea" data-id="${i.id}">削除</button></div>`).join('');
  $('ideasTab').innerHTML=`<div class="stack"><section class="card"><p class="eyebrow">SOMEDAY</p><h2>いつかやる置き場</h2><form id="ideaForm" class="form-grid"><label class="span2">やりたいこと<input name="title" required placeholder="例：統計調査士を調べる"></label><label class="span2">メモ<input name="note" placeholder="今は始めない理由・面白い点など"></label><button class="primary span2">置いておく</button></form><p class="muted">思いついても今の重点枠を壊さないための保管場所。必要になったときだけ課題へ昇格します。</p></section><section class="card"><h3>保留中</h3>${new Date().getDay()===0?'<p class="review-prompt">今日は週次レビュー日。昇格させるものが本当にあるかだけ確認。</p>':''}<div class="idea-list">${rows||'<p class="muted">まだありません。</p>'}</div></section></div>`;
  $('ideaForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries()),idea={id:uid(),title:d.title,note:d.note,createdAt:new Date().toISOString()};ideas.unshift(idea);recordOperation('idea_created','いつかやる項目を追加',{ideaId:idea.id,title:idea.title});persist();renderIdeas();};
  document.querySelectorAll('.delete-idea').forEach(b=>b.onclick=()=>{const idea=ideas.find(i=>i.id===b.dataset.id);ideas=ideas.filter(i=>i.id!==b.dataset.id);recordOperation('idea_deleted','いつかやる項目を削除',{ideaId:b.dataset.id,title:idea?.title||''});persist();renderIdeas();});
  document.querySelectorAll('.promote-idea').forEach(b=>b.onclick=()=>{const i=ideas.find(x=>x.id===b.dataset.id);if(!i)return;const deadline=prompt('期限（YYYY-MM-DD）',addDays(dateKey(),30));if(!deadline)return;const pages=Number(prompt('必要ページ数', '100'));if(!pages)return;const mpp=Number(prompt('1ページの初期目安（分）','3'))||3;const promoted=normalizeTask({id:uid(),title:i.title,deadline,remainingPages:pages,initialPages:pages,baseMinutesPerPage:mpp,minutesPerPage:mpp,priority:'medium',focus:'sub',mode:'grow',minPages:5,maxPages:30,timePreference:'any',placement:'flexible',status:'active',createdAt:new Date().toISOString()});tasks.push(promoted);ideas=ideas.filter(x=>x.id!==i.id);recordOperation('idea_promoted','いつかやる項目を課題へ昇格',{ideaId:i.id,taskId:promoted.id,taskTitle:promoted.title,deadline,pages});persist();renderAll();});
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
  const review=weeklyReview(); const dates=[...new Set([...Object.keys(planSnapshots),...Object.keys(wakeRecords),...activityLog.map(a=>a.date)])].sort().reverse();
  const recentOperations=operationLog.slice(0,200).map(op=>{const t=new Date(op.occurredAt);const stamp=Number.isNaN(t.getTime())?'':t.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});const target=op.targetDate?` ・ 対象 ${esc(op.targetDate)}`:'';return `<div class="operation-entry"><time>${esc(stamp)}</time><div><strong>${esc(op.title)}</strong><small>${esc(op.type)}${target}</small></div></div>`;}).join('');
  const cards=dates.map(day=>{
    const snap=planSnapshots[day], wake=wakeRecords[day], logs=activityLog.filter(a=>a.date===day&&a.kind!=='closeout').sort((a,b)=>String(a.completedAt).localeCompare(String(b.completedAt))), pages=logs.filter(a=>a.kind==='task').reduce((sum,a)=>sum+Number(a.pages||0),0), close=closeouts[day];
    const entries=logs.map(a=>`<div class="history-entry"><span>${a.kind==='life'?'生活':'作業'}</span><strong>${esc(a.title)}</strong><small>${a.pages?`${a.pages}ページ ・ `:''}${minutesLabel(a.minutes||0)}</small></div>`).join('');
    const mode=snap?`${snap.classDay?'授業日':'授業なし日'} ・ ${snap.energyState==='high'?'元気':snap.energyState==='tired'?'疲れ':'普通'}`:'計画未作成';
    const wakeText=wake?.wakeTime?` ・ 起床実績 ${wake.wakeTime}${wake.plannedWakeTime?`（予定 ${wake.plannedWakeTime}）`:''}`:'';
    const sleepText=snap?.bedTime?` ・ 就寝予定 ${snap.bedTime} → 翌朝 ${snap.nextWakeTime||settings.wakeTime}`:'';
    return `<div class="history-day"><div class="row between"><div><strong class="history-date">${day.replaceAll('-','/')}</strong><small class="history-mode">${mode}${wakeText}${sleepText}</small></div><span class="history-life ${close?'done':''}">${close?'一日終了済み':'未終了'}</span></div><div class="history-metrics"><div><span>予定ページ</span><strong>${Number(snap?.scheduledTaskPages||0)}</strong></div><div><span>完了ページ</span><strong>${pages}</strong></div><div><span>ゆったり予定</span><strong>${minutesLabel(snap?.relaxedMinutes||0)}</strong></div></div><div class="history-entries">${entries||'<p class="muted">完了記録なし</p>'}</div></div>`;
  }).join('');
  $('historyTab').innerHTML=`<div class="stack"><section class="card weekly-card"><p class="eyebrow">WEEKLY REVIEW</p><h2>直近7日</h2><div class="review-metrics"><div><span>予定</span><strong>${review.planned}頁</strong></div><div><span>実績</span><strong>${review.done}頁</strong></div><div><span>達成率</span><strong>${review.ratio}%</strong></div></div><p><strong>最も進んだ（ページ系）：</strong>${esc(review.top)}</p><p><strong>総作業実績：</strong>${minutesLabel(review.minutes)}</p><p><strong>持ち越しが多い：</strong>${esc(review.missed)}</p><p class="review-advice">${esc(review.advice)}</p></section><section class="card"><h2>記録・バックアップ</h2><div class="backup-actions"><button id="exportBackup" class="primary small">JSONを書き出す</button><label class="file-button">JSONを読み込む<input id="importBackup" type="file" accept="application/json,.json"></label><button id="restoreAutoBackup" class="secondary small">更新前バックアップから復元</button></div><p class="muted">起床実績・作業開始/終了・課題変更・授業変更・睡眠予定・設定変更など、Life OSの状態を変える操作は操作履歴にも保存します。画面を開く・スクロールするだけの操作は記録しません。</p></section><section class="card"><div class="row between"><div><p class="eyebrow">ACTION LOG</p><h2>操作履歴</h2></div><span class="muted">全 ${operationLog.length}件</span></div><p class="muted">表示は最新200件。JSONバックアップとGoogle Drive同期には操作履歴全体を含めます。</p><div class="operation-list">${recentOperations||'<p class="muted">まだ操作履歴はありません。</p>'}</div></section><section class="card"><div class="history-list">${cards||'<p class="muted">まだ記録がありません。</p>'}</div></section></div>`;
  $('exportBackup').onclick=exportBackup; $('importBackup').onchange=importBackup; $('restoreAutoBackup').onclick=restoreLatestAutomaticBackup;
}

function exportBackup(){recordOperation('backup_exported','JSONバックアップを書き出し',{appVersion:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION});persist({cloud:false});const data=buildCloudPayload();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`life-os-backup-${dateKey()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);renderHistory();}
async function importBackup(e){const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!confirm('現在のデータをバックアップで置き換えますか？'))return;createAutomaticBackup('before-import');applyPayload(data);recordOperation('backup_imported','JSONバックアップから復元',{fileName:file.name||'',sourceVersion:data.version||'',sourceSchemaVersion:data.schemaVersion||''});persist();renderAll();notice('復元しました。');}catch(err){notice(`読み込めません：${err.message}`);}finally{e.target.value='';}}
function restoreLatestAutomaticBackup(){const backups=load('autoBackups',[]);if(!backups.length)return notice('自動バックアップはありません。');const latest=backups[0];if(!confirm('最新の更新前バックアップへ戻しますか？'))return;createAutomaticBackup('before-restore');Object.entries(latest.data||{}).forEach(([k,v])=>save(k,v));const restored=load('operationLog',[]);restored.unshift({id:uid(),date:dateKey(),occurredAt:new Date().toISOString(),type:'auto_backup_restored',title:'更新前バックアップから復元',targetDate:'',details:{backupId:latest.id||'',backupCreatedAt:latest.createdAt||'',backupVersion:latest.appVersion||''}});save('operationLog',restored);location.reload();}

function renderSettings(){
  const bufferCard=(key,label)=>`<div class="buffer-card"><strong>${label}</strong><label>前<input type="number" data-setting="buffers.${key}.before" value="${settings.buffers[key].before}"></label><label>後<input type="number" data-setting="buffers.${key}.after" value="${settings.buffers[key].after}"></label></div>`;
  $('settingsTab').innerHTML=`<div class="stack"><section class="card"><h2>Google連携</h2>${!isNativeIOS()?`<label>Google OAuth Web Client ID<input id="clientIdInput" value="${esc(settings.googleClientId)}"></label><button id="saveClientId" class="primary small">Client IDを保存</button>`:''}<div class="cloud-box"><div><strong>Google Driveクラウド保存</strong><small id="cloudStatus">${esc(cloudStatus)}</small></div><button id="cloudSyncNow" class="secondary small">今すぐ同期</button></div><p class="muted">端末間同期にはGoogle Drive APIと <code>drive.appdata</code> 権限が必要です。Life OS専用の非表示appDataFolderへ保存します。</p></section><section class="card"><h2>通知</h2><label>開始何分前に通知<input type="number" min="0" max="120" data-setting="notificationLeadMinutes" value="${settings.notificationLeadMinutes}"></label></section><section class="card"><h2>生活設定</h2><div class="form-grid"><label>標準の起床時刻<input type="time" data-setting="wakeTime" value="${settings.wakeTime}"></label><label>標準の就寝時刻<input type="time" data-setting="bedTime" value="${settings.bedTime}"></label><label>最低ゆったり時間（分）<input type="number" data-setting="relaxedMinMinutes" value="${settings.relaxedMinMinutes}"></label><label>ゆったり比率（0〜1）<input type="number" step=".05" min="0" max=".7" data-setting="relaxedRatio" value="${settings.relaxedRatio}"></label><label>お風呂（分）<input type="number" data-setting="bathMinutes" value="${settings.bathMinutes}"></label><label>肌ケア（分）<input type="number" data-setting="skincareMinutes" value="${settings.skincareMinutes}"></label><label>就寝何分前までに入浴終了<input type="number" data-setting="bathBeforeBedMinutes" value="${settings.bathBeforeBedMinutes}"></label><label>授業日の夜作業上限（分）<input type="number" data-setting="classDayEveningCapMinutes" value="${settings.classDayEveningCapMinutes}"></label></div><p class="muted">ここは未設定日の標準値です。その日の就寝予定と翌日の起床予定は「今日」画面で日ごとに上書きできます。</p></section><section class="card"><h2>時間考慮プリセット</h2><div class="buffer-grid">${bufferCard('small','小')}${bufferCard('medium','中')}${bufferCard('large','大')}</div></section><section class="card"><h2>授業日判定</h2><label>キーワード（カンマ区切り）<input id="classKeywords" value="${esc(settings.classKeywords.join(','))}"></label><button id="saveKeywords" class="primary small">保存</button></section></div>`;
  document.querySelectorAll('[data-setting]').forEach(el=>el.onchange=()=>{const path=el.dataset.setting.split('.');let obj=settings;for(const k of path.slice(0,-1))obj=obj[k];const key=path.at(-1),before=obj[key],after=el.type==='number'?Number(el.value):el.value;obj[key]=after;recordOperation('setting_changed','設定を変更',{setting:el.dataset.setting,before,after});persist();renderToday();renderNow();});
  if($('saveClientId'))$('saveClientId').onclick=()=>{settings.googleClientId=$('clientIdInput').value.trim();recordOperation('google_client_configured','Google Client ID設定を保存',{configured:Boolean(settings.googleClientId)});persist();updateGoogleButton();notice('保存しました。');};
  $('saveKeywords').onclick=()=>{const before=[...(settings.classKeywords||[])];settings.classKeywords=$('classKeywords').value.split(',').map(x=>x.trim()).filter(Boolean);recordOperation('class_keywords_changed','授業日判定キーワードを変更',{beforeCount:before.length,afterCount:settings.classKeywords.length});persist();renderToday();};
  $('cloudSyncNow').onclick=()=>syncCloud('manual');
}

function mergeOperationLogs(a=[],b=[]){const map=new Map();[...(a||[]),...(b||[])].forEach(x=>{if(x?.id&&!map.has(x.id))map.set(x.id,x);});return [...map.values()].sort((x,y)=>String(y.occurredAt||'').localeCompare(String(x.occurredAt||'')));}
function buildCloudPayload(){ const data={}; CLOUD_KEYS.forEach(k=>data[k]=({tasks,overrides,settings,dayModes,dayStates,dailySleepPlans,wakeRecords,activityLog,operationLog,planSnapshots,ideas,closeouts,activeSession,semesters,classExceptions})[k]); return {version:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,exportedAt:new Date().toISOString(),meta:load('meta',{}),data}; }
function applyPayload(payload){ const d=payload.data||payload; if(d.tasks)tasks=d.tasks.map(normalizeTask); if(d.overrides)overrides=d.overrides; if(d.settings)settings=deepDefaults(d.settings); if(d.dayModes)dayModes=d.dayModes; if(d.dayStates)dayStates=d.dayStates; if(d.dailySleepPlans)dailySleepPlans=d.dailySleepPlans; if('wakeRecords' in d)wakeRecords=d.wakeRecords||{}; if(d.activityLog)activityLog=d.activityLog; if('operationLog' in d)operationLog=d.operationLog||[]; if(d.planSnapshots)planSnapshots=d.planSnapshots; if(d.ideas)ideas=d.ideas; if(d.closeouts)closeouts=d.closeouts; if('activeSession' in d)activeSession=d.activeSession||null; if(d.semesters)semesters=d.semesters.map(normalizeSemester); if(d.classExceptions)classExceptions=d.classExceptions; if(!selectedSemesterId&&semesters.length)selectedSemesterId=semesters[0].id; }
function hasMeaningfulLocalData(){return tasks.length||activityLog.length||operationLog.length||ideas.length||semesters.length||Object.keys(dayModes).length||Object.keys(dailySleepPlans).length||Object.keys(wakeRecords).length||Object.keys(closeouts).length||Boolean(activeSession);}
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
async function fetchGoogleEvents(){if(!accessToken)throw new Error('Google未接続');const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+90);const p=new URLSearchParams({timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'1000'});const res=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,{headers:{Authorization:`Bearer ${accessToken}`}});if(res.status===401){accessToken='';sessionStorage.removeItem(GOOGLE_SESSION_KEY);updateGoogleButton('再接続が必要');throw new Error('Google接続期限が切れました。');}if(!res.ok)throw new Error(`Calendar API ${res.status}`);const data=await res.json();events=(data.items||[]).filter(e=>e.extendedProperties?.private?.lifeOSGenerated!=='true').map(e=>{const allDay=Boolean(e.start?.date&&!e.start?.dateTime);return{id:e.id,title:e.summary||'（無題）',allDay,start:allDay?e.start.date:e.start?.dateTime,end:allDay?e.end?.date:e.end?.dateTime,location:e.location||''};});save('events',events);updateGoogleButton('接続済み');renderToday();renderNow();return events.length;}
function restoreGoogleSession(){if(isNativeIOS())return;try{const s=JSON.parse(sessionStorage.getItem(GOOGLE_SESSION_KEY)||'null');if(!s?.accessToken||s.expiresAt<=Date.now()+60000)return;accessToken=s.accessToken;accessTokenExpiresAt=s.expiresAt;updateGoogleButton('接続済み');fetchGoogleEvents().then(()=>syncCloud('auto')).catch(e=>notice(e.message));}catch{}}
async function connectGoogle(){if(isNativeIOS()){postNative({type:'connectGoogle'});return;}if(!settings.googleClientId)return notice('設定でClient IDを入力してください。');try{if(!window.google?.accounts?.oauth2)throw new Error('Googleライブラリ読込中です。');const response=await new Promise((resolve,reject)=>{const client=window.google.accounts.oauth2.initTokenClient({client_id:settings.googleClientId,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.appdata',callback:r=>r.error?reject(new Error(r.error)):resolve(r)});client.requestAccessToken({prompt:''});});accessToken=response.access_token;accessTokenExpiresAt=Date.now()+Math.max(60,Number(response.expires_in||3600))*1000;sessionStorage.setItem(GOOGLE_SESSION_KEY,JSON.stringify({accessToken,expiresAt:accessTokenExpiresAt}));updateGoogleButton('取得中…');const n=await fetchGoogleEvents();recordOperation('google_connected','Googleへ接続',{calendarEventCount:n,driveAppDataScope:true});persist();await syncCloud('auto');notice(`${n}件の予定を取得しました。`);}catch(e){updateGoogleButton('接続エラー');notice(e.message);}}

function syncNativePlan(plan){if(!isNativeIOS()||selectedDay!==dateKey())return;postNative({type:'syncPlan',payload:{day:selectedDay,classDay:plan.classDay,scheduledTaskMinutes:plan.scheduledTaskMinutes,relaxedMinutes:Math.round(plan.relaxedMinutes),notificationLeadMinutes:Number(settings.notificationLeadMinutes||5),timeline:plan.timeline.map(x=>({title:x.title,type:x.type,startMinute:Math.round(x.start),endMinute:Math.round(x.end)}))}});}
window.lifeOSReceiveCalendarEvents=incoming=>{events=Array.isArray(incoming)?incoming:[];save('events',events);updateGoogleButton('接続済み');renderToday();renderNow();};

function activateTab(name){const btn=[...document.querySelectorAll('.tabs button')].find(b=>b.dataset.tab===name);if(!btn)return;document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.add('hidden'));$(`${name}Tab`).classList.remove('hidden');if(name==='now')renderNow();if(name==='timetable')renderTimetable();if(name==='tasks')renderTasks();}
function setupTabs(){document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));}
$('googleConnect').onclick=connectGoogle; setupTabs(); updateGoogleButton(); renderAll(); restoreGoogleSession();
