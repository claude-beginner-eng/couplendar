/* ============================================================
   우리 캘린더 - 앱 로직 (Firebase 연동 버전)
   ------------------------------------------------------------
   저장 방식:
   - 혼자 모드: localStorage (이 폰 안에서만)
   - 연결 모드(초대코드로 연결된 후): Firestore (파트너와 실시간 공유)
   ============================================================ */

// ⚠️ Firebase 초기화는 실패할 수 있어요 (예: firebase-config.js에 아직
// 본인 키를 안 채웠거나, 파일 경로가 틀렸거나, 네트워크 문제 등).
// 여기서 에러가 나도 앱의 나머지 기능(탭 이동, 로컬 캘린더)은 계속
// 동작하도록 try/catch로 감싸뒀어요. 이게 없으면 이 줄에서 에러가 나는
// 순간 이 파일의 나머지 코드가 통째로 실행 안 되고, 화면의 모든 버튼이
// 먹통이 돼요.
let db = null;
let firebaseReady = false;
console.log('%c우리 캘린더 app.js 로드됨 — 버전: 2026-08-26-fix34 (게임 목록 화면 추가, 루미큐브 자리 예약)', 'color:#8a3fae;font-weight:bold;');
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();

  // ⚠️ Firestore가 일부 네트워크/브라우저/프록시 환경에서 데이터 전송 방식을
  // 잘못 골라, 한글이나 이모지가 포함된 데이터를 보낼 때
  // "Failed to execute 'setRequestHeader' ... non ISO-8859-1" 에러가 나는
  // 알려진 이슈가 있어요. long-polling 방식을 강제로 지정해서 이 문제를
  // 피해요. (auto-detect보다 강제 지정이 더 확실하게 동작해요)
  db.settings({
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });

  firebaseReady = true;
} catch(e){
  console.error('Firebase 초기화 실패 — firebase-config.js 내용을 확인해주세요:', e);
}

const LOCAL_KEY = 'coupleCalendarData';
const ROOM_KEY  = 'coupleCalendarRoom'; // { code, myId }
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24시간

let roomUnsub = null; // Firestore 실시간 리스너 해제 함수

const store = {
  events: [],
  profile: { name: '', avatar: '' }, // 처음엔 비워둠 — 방 생성/입장 전에 반드시 채우게 유도
  room: null, // 연결돼 있을 때만: { members, expiresAt, ... } (Firestore 원본)

  loadLocal(){
    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      if(saved) Object.assign(this, JSON.parse(saved));
    } catch(e){ console.warn('로컬 데이터 로드 실패:', e); }
  },
  saveLocal(){
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ events: this.events, profile: this.profile }));
    } catch(e){ console.warn('로컬 데이터 저장 실패:', e); }
  },

  getRoomInfo(){
    try { const r = localStorage.getItem(ROOM_KEY); return r ? JSON.parse(r) : null; }
    catch(e){ return null; }
  },
  setRoomInfo(info){ localStorage.setItem(ROOM_KEY, JSON.stringify(info)); },
  clearRoomInfo(){ localStorage.removeItem(ROOM_KEY); },

  // 일정 저장: 연결돼 있으면 Firestore로, 아니면 localStorage로
  async save(){
    const roomInfo = this.getRoomInfo();
    if(roomInfo){
      try {
        await db.collection('rooms').doc(roomInfo.code).update({ events: this.events });
      } catch(e){
        console.warn('클라우드 저장 실패, 이번엔 로컬에만 저장돼요:', e);
      }
    } else {
      this.saveLocal();
    }
  }
};

// 프로필(이름/아바타)은 방 연결 여부와 상관없이 항상 있어야 하는 정보라,
// 스크립트 맨 위에서 미리 로드해둬요. 이걸 나중에(초기화 마지막 단계에서)
// 하면, 그 사이에 실행되는 화면 초기값 세팅(이름 입력창 등)이 예전 기본값을
// 참조해버리는 문제가 있었어요.
store.loadLocal();

// 2026년 대한민국 공휴일 (대체공휴일 포함). 필요하면 나중에 다른 연도도 추가 가능해요.
// 🇰🇷 이모지는 유니코드상 태극기가 맞지만, 기기/폰트에 따라 태극 문양 없이
// 글자로만 보이는 경우가 있어서 직접 작게 그려서 확실하게 보이도록 했어요.
// flagcdn.com은 나라별 정식 국기 이미지를 무료로 제공하는 CDN이에요.
// 직접 그리는 대신 실제 대한민국 표준 규격 태극기 이미지를 그대로 가져와서 써요.
const KR_FLAG_SVG = '<img src="https://flagcdn.com/kr.svg" alt="태극기" style="width:1.2em;height:auto;vertical-align:-0.18em;" />';

const HOLIDAYS_KR = {
  '2026-01-01': { name:'신정', icon:'🎉' },
  '2026-02-16': { name:'설날 연휴', icon:'🧧' },
  '2026-02-17': { name:'설날', icon:'🧧' },
  '2026-02-18': { name:'설날 연휴', icon:'🧧' },
  '2026-03-01': { name:'삼일절', icon: KR_FLAG_SVG },
  '2026-03-02': { name:'삼일절 대체공휴일', icon: KR_FLAG_SVG },
  '2026-05-05': { name:'어린이날', icon:'🎈' },
  '2026-05-24': { name:'부처님오신날', icon:'🏮' },
  '2026-05-25': { name:'부처님오신날 대체공휴일', icon:'🏮' },
  '2026-06-06': { name:'현충일', icon:'🕯️' },
  '2026-07-17': { name:'제헌절', icon:'📜' },
  '2026-08-15': { name:'광복절', icon: KR_FLAG_SVG },
  '2026-08-17': { name:'광복절 대체공휴일', icon: KR_FLAG_SVG },
  '2026-09-24': { name:'추석 연휴', icon:'🌕' },
  '2026-09-25': { name:'추석', icon:'🌕' },
  '2026-09-26': { name:'추석 연휴', icon:'🌕' },
  '2026-10-03': { name:'개천절', icon: KR_FLAG_SVG },
  '2026-10-05': { name:'개천절 대체공휴일', icon: KR_FLAG_SVG },
  '2026-10-09': { name:'한글날', icon: KR_FLAG_SVG },
  '2026-12-25': { name:'크리스마스', icon:'🎄' },
};

const CATS = [
  { key:'date',  label:'데이트', color:'#ff6b9d' },
  { key:'appt',  label:'약속',   color:'#38bdf8' },
  { key:'trip',  label:'여행',   color:'#2dd4bf' },
  { key:'work',  label:'근무',   color:'#f59e0b' },
  { key:'etc',   label:'기타',   color:'#9b6bff' },
];
const ICONS = ['🍰','✈️','💜','📌','🎂','🎉','🍜','📞','🎬','☕','🎁','🏖️'];
const AVATAR_ICONS = ['🐻','🐰','🐱','🐶','🦊','🐼','🦁','🐨','🐯','🐥','🦄','🐧'];

// 근무 카테고리에서 이 4가지 이름으로 일정을 등록하면, 이름별로 겹치지 않는 색으로 표시돼요.
const SHIFT_COLORS = {
  '데이':   '#f59e0b', // 주황
  '나이트': '#6366f1', // 남색
  '이브닝': '#a855f7', // 보라
  '오프':   '#22c55e', // 초록
};
function getEventColor(ev){
  return (ev.catKey === 'work' && SHIFT_COLORS[ev.title]) ? SHIFT_COLORS[ev.title] : ev.catColor;
}

// 지금 등록/표시에 쓸 "멤버 목록" — 연결돼 있으면 방(room)의 멤버들,
// 혼자면 나 하나뿐. 일정마다 "누구 것인지"를 표시할 때 이 목록에서 찾아요.
function getMemberList(){
  if(store.room && store.room.members && store.room.members.length){
    return store.room.members;
  }
  return [{ id:'me', name: store.profile.name, avatar: store.profile.avatar }];
}

function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtDateLabel(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return `${m}월 ${d}일`;
}
function formatCodeDisplay(code){
  return code.match(/.{1,4}/g).join('-');
}

/* ── 기간(연속) 일정 관련 헬퍼 ─────────────────────────────── */
function isMultiDay(ev){ return !!ev.endDate && ev.endDate !== ev.date; }

function fmtEventDateRange(ev){
  return isMultiDay(ev) ? `${fmtDateLabel(ev.date)} ~ ${fmtDateLabel(ev.endDate)}` : fmtDateLabel(ev.date);
}

// startStr~endStr 사이 모든 날짜를 'YYYY-MM-DD' 배열로. 너무 긴 기간(1년+) 실수 방지용 상한.
function datesInRange(startStr, endStr){
  const dates = [];
  let cur = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  let guard = 0;
  while(cur <= end && guard < 366){
    dates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return dates;
}

function eventCoversDate(ev, dateStr){
  const end = ev.endDate || ev.date;
  return ev.date <= dateStr && dateStr <= end;
}

/* ── 탭 전환 ───────────────────────────────────────────────── */
const tabs = document.querySelectorAll('.tab');
const tabBtns = document.querySelectorAll('.tabbtn');
function showTab(name){
  tabs.forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if(name === 'calendar') renderCalendar();
  if(name === 'home') renderHome();
  if(name === 'add') buildWhoRow(); // 멤버가 바뀌었을 수 있으니 등록 탭 들어갈 때마다 갱신
  if(name === 'game'){
    if(typeof renderTetrisLeaderboard === 'function') renderTetrisLeaderboard();
    const listEl = document.getElementById('gameListScreen');
    const rootEl = document.getElementById('tetrisRoot');
    if(typeof tetrisState !== 'undefined' && tetrisState){
      // 게임이 이미 진행 중이면(다른 탭 갔다 왔어도) 이어서 보여줘요
      if(listEl) listEl.style.display = 'none';
      if(rootEl) rootEl.style.display = 'block';
    } else {
      if(listEl) listEl.style.display = 'block';
      if(rootEl) rootEl.style.display = 'none';
    }
  }
}
tabBtns.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ── 토스트 ────────────────────────────────────────────────── */
const toastEl = document.getElementById('toast');
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

/* ── 홈 탭 ─────────────────────────────────────────────────── */
function avatarGroupHTML(who){
  if(!who || !who.length) return '';
  const members = getMemberList();
  const shown = who.slice(0,3).map(id => members.find(m => m.id === id)).filter(Boolean);
  if(!shown.length) return '';
  const extra = who.length - shown.length;
  let html = shown.map(m => `<div class="av">${m.avatar}</div>`).join('');
  if(extra > 0) html += `<div class="av">+${extra}</div>`;
  return `<div class="avatar-group">${html}</div>`;
}

function eventRowHTML(ev){
  return `
    <div class="event-item">
      <div class="icon-stack">
        <div class="icon-chip" style="background:${getEventColor(ev)}">${ev.icon}</div>
        ${avatarGroupHTML(ev.who)}
      </div>
      <div class="etxt">
        <div class="etitle">${ev.title}</div>
        <div class="emeta">${fmtEventDateRange(ev)} · ${ev.time}</div>
      </div>
      <button class="edel" data-id="${ev.id}">✕</button>
    </div>`;
}

function bindDeleteButtons(container){
  container.querySelectorAll('.edel').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      store.events = store.events.filter(e => e.id !== btn.dataset.id);
      store.save();
      renderHome();
      if(document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
      toast('일정을 삭제했어요');
    });
  });
}

function renderHome(){
  const now = new Date();
  document.getElementById('todayLabel').textContent =
    `${now.getMonth()+1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`;
  document.getElementById('homeDate').textContent = `${now.getMonth()+1}월 ${now.getDate()}일`;
  document.getElementById('homeCount').textContent = `등록된 일정 ${store.events.length}개`;

  const today = todayStr();
  const todays = store.events.filter(e => eventCoversDate(e, today)).sort((a,b)=>a.time.localeCompare(b.time));
  const upcoming = store.events.filter(e => e.date > today).sort((a,b)=> a.date===b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)).slice(0,5);

  const todayList = document.getElementById('todayList');
  const upcomingList = document.getElementById('upcomingList');
  todayList.innerHTML = todays.length ? todays.map(eventRowHTML).join('') : `<div class="empty-state">오늘은 등록된 일정이 없어요 🌿</div>`;
  upcomingList.innerHTML = upcoming.length ? upcoming.map(eventRowHTML).join('') : `<div class="empty-state">다가오는 일정이 없어요</div>`;

  bindDeleteButtons(todayList);
  bindDeleteButtons(upcomingList);
}

/* ── 캘린더 탭 ─────────────────────────────────────────────── */
let calYear, calMonth, calSelectedDate;
(function initCalDate(){
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  calSelectedDate = todayStr();
})();

// 여러 날짜 선택 모드 (연속되지 않는 특정 날짜들을 골라 한번에 같은 내용으로 등록)
let multiSelectMode = false;
let multiSelectedDates = new Set();

const dowNames = ['일','월','화','수','목','금','토'];

function calAvatarDotsHTML(evs){
  const members = getMemberList();
  const shown = evs.slice(0, 3).map(e=>{
    if(e.catKey === 'work' && SHIFT_COLORS[e.title]){
      // 근무 일정: 아바타 아이콘 + 일정 이름(데이/나이트/이브닝/오프)을 그 이름 전용 색상 사각형으로
      const firstWhoId = e.who && e.who[0];
      const m = members.find(mm => mm.id === firstWhoId);
      const avatar = m ? m.avatar : '👤';
      return `<span class="cal-work-chip" style="background:${SHIFT_COLORS[e.title]}">${avatar}${e.title}</span>`;
    }
    if(e.who && e.who.length >= 2){
      return `<span class="cal-heart">💗</span>`; // 둘이 함께하는 일정은 분홍 하트로
    }
    const firstWhoId = e.who && e.who[0];
    const m = members.find(mm => mm.id === firstWhoId);
    const avatar = m ? m.avatar : '👤'; // who 정보가 없는(예전) 일정은 기본 아이콘
    return `<span class="cal-av">${avatar}</span>`;
  });
  let html = shown.join('');
  if(evs.length > 3) html += `<span class="cal-more">+${evs.length-3}</span>`;
  return html;
}

// 기념일로부터 정확히 100일/200일/300일... 째 되는 날짜인지 확인
function daysSince(startStr, targetStr){
  const start = new Date(startStr + 'T00:00:00');
  const target = new Date(targetStr + 'T00:00:00');
  return Math.round((target - start) / 86400000) + 1; // 한국식: 시작일이 1일째
}

// targetStr이 startStr로부터 정확히 몇 주년(=몇 년)째 되는 날인지. 아니면 0.
function yearsSince(startStr, targetStr){
  const start = new Date(startStr + 'T00:00:00');
  const target = new Date(targetStr + 'T00:00:00');
  if(target < start) return 0;
  if(target.getMonth() === start.getMonth() && target.getDate() === start.getDate()){
    const years = target.getFullYear() - start.getFullYear();
    if(years > 0) return years;
  }
  return 0;
}

// 기념일 종류별로 다른 규칙으로 특별한 날을 찾아요:
// - 연애: 100일 단위(100일,200일...) + 1년 단위(1년,2년...) 둘 다
// - 결혼: 1년 단위(결혼기념일 N주년)만
// - 탄생: 1년 단위(이름 N번째 생일)만
function getMilestonesForDate(dateStr){
  const list = (store.room && store.room.anniversaries) || [];
  const results = [];

  list.forEach(a=>{
    const isStartDay = (a.date === dateStr);

    if(a.type === 'dating'){
      // 연애: 당일은 "우리가 된 날", 그 뒤로 100일 단위 + 1년 단위 둘 다
      if(isStartDay){
        results.push({ icon:'💗', text:'우리가 된 날' });
      }
      const days = daysSince(a.date, dateStr);
      if(days > 0 && days % 100 === 0){
        results.push({ icon:'💗', text:`연애 ${days}일` });
      }
      const years = yearsSince(a.date, dateStr);
      if(years > 0){
        results.push({ icon:'💗', text:`연애 ${years}년` });
      }
    } else if(a.type === 'marriage'){
      // 결혼: 1년 단위만. 당일은 "하나된 날"로 특별 표기
      if(isStartDay){
        results.push({ icon:'💍', text:'하나된 날' });
      }
      const years = yearsSince(a.date, dateStr);
      if(years > 0){
        results.push({ icon:'💍', text:`결혼 ${years}주년` });
      }
    } else if(a.type === 'birth'){
      // 탄생: 1년 단위만. 당일은 "이름 태어난 날", 매년은 "이름 생일"
      const name = a.name || '아이';
      if(isStartDay){
        results.push({ icon:'🎂', text:`${name} 태어난 날` });
      }
      const years = yearsSince(a.date, dateStr);
      if(years > 0){
        results.push({ icon:'🎂', text:`${name} 생일` });
      }
    }
  });

  return results;
}

function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = `${calMonth+1}월 ${calYear}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  dowNames.forEach(d=>{
    const el = document.createElement('div'); el.className='cal-dow'; el.textContent=d; grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  const today = todayStr();

  const eventsByDate = {};
  store.events.forEach(e=>{
    const end = e.endDate || e.date;
    datesInRange(e.date, end).forEach(d => { (eventsByDate[d] ||= []).push(e); });
  });

  for(let i=0; i<firstDay; i++){
    const c = document.createElement('div'); c.className='cal-cell other';
    c.innerHTML = `<span class="dnum">${prevDays-firstDay+1+i}</span>`;
    grid.appendChild(c);
  }
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${calYear}-${pad(calMonth+1)}-${pad(d)}`;
    const c = document.createElement('div');
    const milestones = getMilestonesForDate(dateStr);
    const isHoliday = !!HOLIDAYS_KR[dateStr];
    const isMultiChecked = multiSelectMode && multiSelectedDates.has(dateStr);
    c.className = 'cal-cell' + (dateStr===today?' today':'') + (dateStr===calSelectedDate?' selected':'') + (milestones.length ? ' cal-milestone':'') + (isHoliday ? ' cal-holiday':'') + (isMultiChecked ? ' multi-checked':'');
    const evs = eventsByDate[dateStr] || [];
    const dots = calAvatarDotsHTML(evs);
    const milestoneIcons = [...new Set(milestones.map(m => m.icon))].slice(0, 2).join(''); // 그 날 있는 종류의 아이콘만, 중복 없이
    const milestoneBadge = milestones.length ? `<span class="cal-milestone-badge">${milestoneIcons}</span>` : '';
    c.innerHTML = `<span class="dnum">${d}</span>${milestoneBadge}<div class="dots">${dots}</div>`;
    c.addEventListener('click', ()=>{
      if(multiSelectMode){
        if(multiSelectedDates.has(dateStr)) multiSelectedDates.delete(dateStr);
        else multiSelectedDates.add(dateStr);
        const cnt = document.getElementById('multiSelectCount');
        if(cnt) cnt.textContent = `${multiSelectedDates.size}일 선택됨`;
        renderCalendar();
      } else {
        calSelectedDate = dateStr;
        renderCalendar();
      }
    });
    grid.appendChild(c);
  }

  document.getElementById('calSelLabel').textContent = `${fmtDateLabel(calSelectedDate)} 일정`;
  const selEvents = (eventsByDate[calSelectedDate] || []).sort((a,b)=>a.time.localeCompare(b.time));
  const selMilestones = getMilestonesForDate(calSelectedDate);
  const holiday = HOLIDAYS_KR[calSelectedDate];
  const holidayHTML = holiday ? `
    <div class="event-item milestone-item" style="background:#fff0f0 !important;">
      <div class="icon-stack"><div class="icon-chip" style="background:#ffe0e0;">${holiday.icon}</div></div>
      <div class="etxt"><div class="etitle">${holiday.name}</div><div class="emeta">공휴일</div></div>
    </div>` : '';
  const milestoneHTML = selMilestones.map(m => `
    <div class="event-item milestone-item">
      <div class="icon-stack"><div class="icon-chip" style="background:#ffe1ef;">${m.icon}</div></div>
      <div class="etxt"><div class="etitle">${m.text} 🎉</div><div class="emeta">축하해요!</div></div>
    </div>`).join('');
  const selList = document.getElementById('calSelList');
  const eventsHTML = selEvents.length ? selEvents.map(eventRowHTML).join('') : '';
  selList.innerHTML = (holidayHTML + milestoneHTML + eventsHTML) || `<div class="empty-state">이 날짜엔 일정이 없어요</div>`;
  bindDeleteButtons(selList);
}

document.getElementById('prevMonth').addEventListener('click', ()=>{
  calMonth--; if(calMonth<0){ calMonth=11; calYear--; } renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', ()=>{
  calMonth++; if(calMonth>11){ calMonth=0; calYear++; } renderCalendar();
});
document.getElementById('todayBtn')?.addEventListener('click', ()=>{
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calSelectedDate = todayStr();
  renderCalendar();
});

document.getElementById('calAddBtn')?.addEventListener('click', ()=>{
  const targetDate = calSelectedDate;
  showTab('add');
  // 혹시 기간 모드가 켜져 있었으면 단일 날짜 모드로 되돌리고 그 날짜를 채워넣어요
  periodMode = false;
  document.getElementById('periodSwitch')?.classList.remove('on');
  const singleRow = document.getElementById('singleDateRow');
  const periodRow = document.getElementById('periodDateRow');
  if(singleRow) singleRow.style.display = 'flex';
  if(periodRow) periodRow.style.display = 'none';
  const dateEl = document.getElementById('dateInput');
  if(dateEl) dateEl.value = targetDate;
  document.getElementById('titleInput')?.focus();
});

/* ── 캘린더: 여러 날짜 선택 모드 ───────────────────────────── */
const multiSelectBtn = document.getElementById('multiSelectBtn');
const calSelHeader = document.getElementById('calSelHeader');
const calSelListEl = document.getElementById('calSelList');
const multiSelectBar = document.getElementById('multiSelectBar');

function exitMultiSelectMode(){
  multiSelectMode = false;
  multiSelectedDates.clear();
  multiSelectBtn?.classList.remove('active');
  if(calSelHeader) calSelHeader.style.display = 'flex';
  if(calSelListEl) calSelListEl.style.display = 'block';
  if(multiSelectBar) multiSelectBar.style.display = 'none';
}

multiSelectBtn?.addEventListener('click', ()=>{
  multiSelectMode = !multiSelectMode;
  multiSelectBtn.classList.toggle('active', multiSelectMode);
  multiSelectedDates.clear();
  const cnt = document.getElementById('multiSelectCount');
  if(cnt) cnt.textContent = '0일 선택됨';
  if(calSelHeader) calSelHeader.style.display = multiSelectMode ? 'none' : 'flex';
  if(calSelListEl) calSelListEl.style.display = multiSelectMode ? 'none' : 'block';
  if(multiSelectBar) multiSelectBar.style.display = multiSelectMode ? 'flex' : 'none';
  renderCalendar();
});

document.getElementById('multiCancelBtn')?.addEventListener('click', ()=>{
  exitMultiSelectMode();
  renderCalendar();
});

document.getElementById('multiAddBtn')?.addEventListener('click', ()=>{
  if(multiSelectedDates.size === 0){ toast('날짜를 하나 이상 선택해주세요'); return; }
  const dates = [...multiSelectedDates].sort();
  exitMultiSelectMode();
  showTab('add');
  setMultiDatesMode(dates);
});

/* ── 일정 등록 탭 ──────────────────────────────────────────── */
let addState = { icon: ICONS[0], cat: CATS[0], selectedWho: [] };
let addMultiDates = null; // 캘린더에서 "여러 날짜 선택"으로 넘어왔을 때만 배열로 채워짐

function setMultiDatesMode(dates){
  addMultiDates = dates;
  document.getElementById('singleDateRow').style.display = 'none';
  document.getElementById('periodDateRow').style.display = 'none';
  document.getElementById('multiDatesInfo').style.display = 'block';
  document.getElementById('multiDatesCount').textContent = dates.length;
  document.getElementById('multiDatesChips').innerHTML = dates.map(d => `<span class="mdate-chip">${fmtDateLabel(d)}</span>`).join('');
  periodMode = false;
  periodSwitch?.classList.remove('on');
  document.getElementById('titleInput')?.focus();
}

function exitMultiDatesMode(){
  addMultiDates = null;
  document.getElementById('multiDatesInfo').style.display = 'none';
  document.getElementById('singleDateRow').style.display = 'flex';
  document.getElementById('periodDateRow').style.display = 'none';
}

document.getElementById('multiDatesCancelBtn')?.addEventListener('click', exitMultiDatesMode);


const iconPicker = document.getElementById('iconPicker');
ICONS.forEach((ic,i)=>{
  const b = document.createElement('button');
  b.className = 'icon-opt' + (i===0?' active':'');
  b.textContent = ic;
  b.addEventListener('click', ()=>{
    iconPicker.querySelectorAll('.icon-opt').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    addState.icon = ic;
  });
  iconPicker.appendChild(b);
});

const catRow = document.getElementById('catRow');
const workHint = document.getElementById('workHint');
CATS.forEach((c,i)=>{
  const el = document.createElement('div');
  el.className = 'cat-chip' + (i===0?' active':'');
  el.style.setProperty('--cc', c.color);
  el.innerHTML = `<div class="dot" style="background:${c.color}"></div><span>${c.label}</span>`;
  el.addEventListener('click', ()=>{
    catRow.querySelectorAll('.cat-chip').forEach(x=>x.classList.remove('active'));
    el.classList.add('active');
    addState.cat = c;
    if(workHint) workHint.style.display = (c.key === 'work') ? 'block' : 'none';
  });
  catRow.appendChild(el);
});

// 누구의 일정이에요? - 연결된 인원 수만큼 카드 생성, 탭으로 다중 선택.
// 혼자 모드(멤버 1명)면 고를 게 없으니 섹션 자체를 숨기고 자동으로 나로 확정.
const whoSection = document.getElementById('whoSection');
const whoRow = document.getElementById('whoRow');
function buildWhoRow(){
  const members = getMemberList();
  const memberIds = members.map(m => m.id);

  // 멤버 목록이 바뀔 수 있어요(혼자 모드 -> 연결 등). 그럴 때 예전에 쓰던
  // 임시 id('me' 같은)가 선택 목록에 남아있으면 지금 실제 멤버 id랑 안 맞아서
  // 선택 상태가 꼬여요. 그래서 매번 "지금 존재하는 멤버"만 남기고 정리해요.
  addState.selectedWho = addState.selectedWho.filter(id => memberIds.includes(id));

  console.log('[buildWhoRow]', {
    members: members.map(m=>({id:m.id, name:m.name})),
    myRoomInfo: store.getRoomInfo(),
    selectedWhoBeforeDefault: [...addState.selectedWho],
  });

  if(members.length <= 1){
    whoSection.style.display = 'none';
    addState.selectedWho = [members[0].id];
    return;
  }
  whoSection.style.display = 'flex';
  if(addState.selectedWho.length === 0){
    // 기본값: 나만 (함께로 등록하고 싶으면 파트너를 직접 눌러서 추가해야 함)
    const roomInfo = store.getRoomInfo();
    const myId = roomInfo ? roomInfo.myId : members[0].id;
    addState.selectedWho = memberIds.includes(myId) ? [myId] : [members[0].id];
  }
  console.log('[buildWhoRow] selectedWhoAfterDefault:', [...addState.selectedWho]);
  whoRow.innerHTML = '';
  members.forEach(m=>{
    const chip = document.createElement('div');
    chip.className = 'who-chip' + (addState.selectedWho.includes(m.id) ? ' active' : '');
    chip.innerHTML = `<div class="a-circle">${m.avatar}</div><span>${m.name}</span>`;
    chip.addEventListener('click', ()=>{
      const i = addState.selectedWho.indexOf(m.id);
      if(i >= 0){
        if(addState.selectedWho.length > 1) addState.selectedWho.splice(i,1); // 최소 1명은 선택 유지
      } else {
        addState.selectedWho.push(m.id);
      }
      buildWhoRow();
    });
    whoRow.appendChild(chip);
  });
}
buildWhoRow();

// 아래 값들은 index.html이 혹시 캐시 때문에 예전 버전이면 요소가 없을 수 있어요.
// 그럴 때 여기서 에러가 나면 이 뒤에 있는 모든 초기화 코드(설정 탭, 파트너 연결 등)가
// 통째로 멈춰버려서, 옵셔널 체이닝(?.)으로 안전하게 처리해요.
if(document.getElementById('dateInput')) document.getElementById('dateInput').value = todayStr();
if(document.getElementById('startDateInput')) document.getElementById('startDateInput').value = todayStr();
if(document.getElementById('endDateInput')) document.getElementById('endDateInput').value = todayStr();

// 기간(연속 일정) 토글
let periodMode = false;
const periodSwitch = document.getElementById('periodSwitch');
const singleDateRow = document.getElementById('singleDateRow');
const periodDateRow = document.getElementById('periodDateRow');
periodSwitch?.addEventListener('click', ()=>{
  periodMode = !periodMode;
  periodSwitch.classList.toggle('on', periodMode);
  if(periodMode){
    // 단일 날짜 칸에 이미 골라둔 날짜가 있으면(예: 캘린더에서 넘어온 경우), 그대로 시작일/종료일에도 넣어줘요
    const dEl = document.getElementById('dateInput');
    if(dEl?.value){
      const startEl = document.getElementById('startDateInput');
      const endEl = document.getElementById('endDateInput');
      if(startEl) startEl.value = dEl.value;
      if(endEl) endEl.value = dEl.value;
    }
  } else {
    // 반대로 기간 모드에서 단일 모드로 돌아갈 땐 시작일 값을 그대로 가져와요
    const startEl = document.getElementById('startDateInput');
    const dEl = document.getElementById('dateInput');
    if(startEl?.value && dEl) dEl.value = startEl.value;
  }
  if(singleDateRow) singleDateRow.style.display = periodMode ? 'none' : 'flex';
  if(periodDateRow) periodDateRow.style.display = periodMode ? 'flex' : 'none';
});

const titleInput = document.getElementById('titleInput');
const saveBtn = document.getElementById('saveBtn');
titleInput.addEventListener('input', ()=>{
  saveBtn.classList.toggle('ready', titleInput.value.trim().length > 0);
});

saveBtn.addEventListener('click', async ()=>{
  const title = titleInput.value.trim();
  if(!title) return;

  if(addMultiDates && addMultiDates.length){
    // 여러 날짜 선택 모드: 같은 내용으로 각 날짜마다 별도 일정을 하나씩 만들어요
    // (나중에 한 날짜만 골라서 따로 삭제/수정할 수 있게 하기 위해 각각 독립된 일정으로 저장)
    const time = document.getElementById('multiTimeInput')?.value || '00:00';
    const memo = document.getElementById('memoInput').value.trim();
    const who = [...addState.selectedWho];
    addMultiDates.forEach((d, idx)=>{
      store.events.push({
        id: 'ev_' + Date.now() + '_' + idx,
        title,
        icon: addState.icon,
        catKey: addState.cat.key,
        catColor: addState.cat.color,
        who,
        date: d,
        time,
        memo,
      });
    });
    await store.save();
    toast(`${addMultiDates.length}개 날짜에 일정을 저장했어요 🎉`);
    exitMultiDatesMode();
  } else {
    let date, endDate;
    if(periodMode){
      date = document.getElementById('startDateInput')?.value || todayStr();
      endDate = document.getElementById('endDateInput')?.value || date;
      if(endDate < date){ toast('종료일이 시작일보다 빠를 수 없어요'); return; }
    } else {
      date = document.getElementById('dateInput').value || todayStr();
      endDate = date;
    }

    const newEvent = {
      id: 'ev_' + Date.now(),
      title,
      icon: addState.icon,
      catKey: addState.cat.key,
      catColor: addState.cat.color,
      who: [...addState.selectedWho],
      date,
      time: document.getElementById('timeInput').value || '00:00',
      memo: document.getElementById('memoInput').value.trim(),
    };
    if(endDate !== date) newEvent.endDate = endDate; // 하루짜리 일정은 예전이랑 구조 그대로 유지

    store.events.push(newEvent);
    await store.save();

    periodMode = false;
    periodSwitch.classList.remove('on');
    singleDateRow.style.display = 'flex';
    periodDateRow.style.display = 'none';

    toast('일정을 저장했어요 🎉');
  }

  titleInput.value = '';
  document.getElementById('memoInput').value = '';
  saveBtn.classList.remove('ready');
  addState.selectedWho = []; // 다음 등록 때 다시 기본값(나만)으로
  buildWhoRow();

  showTab('home');
});

/* ── 설정 탭: 프로필 ───────────────────────────────────────── */
const myAvatarEl = document.getElementById('myAvatar');
const avatarPicker = document.getElementById('avatarPicker');
const myNameInput = document.getElementById('myName');

function renderMyAvatar(){
  if(store.profile.avatar){
    myAvatarEl.textContent = store.profile.avatar;
    myAvatarEl.classList.remove('empty');
  } else {
    myAvatarEl.textContent = '＋';
    myAvatarEl.classList.add('empty');
  }
}
renderMyAvatar();
myNameInput.value = store.profile.name;
myNameInput.addEventListener('input', (e)=>{
  store.profile.name = e.target.value;
  myNameInput.classList.remove('warn');
  store.saveLocal(); // 이름은 항상 로컬에도 저장 (다음 방 생성/연결 시 사용)
});

AVATAR_ICONS.forEach(a=>{
  const b = document.createElement('button');
  b.className = 'icon-opt' + (a === store.profile.avatar ? ' active' : '');
  b.textContent = a;
  b.addEventListener('click', ()=>{
    store.profile.avatar = a;
    store.saveLocal();
    renderMyAvatar();
    avatarPicker.querySelectorAll('.icon-opt').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    avatarPicker.style.display = 'none';
    buildWhoRow(); // 등록 탭의 내 아바타 표시도 최신으로
    renderHome();
    if(document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
  });
  avatarPicker.appendChild(b);
});
myAvatarEl.addEventListener('click', ()=>{
  avatarPicker.style.display = avatarPicker.style.display === 'none' ? 'grid' : 'none';
});

// 방 만들기/입장 전에 이름+아바타가 다 채워졌는지 확인.
// 안 채워졌으면 경고하고, 프로필 카드로 눈에 띄게 안내해요.
function ensureProfileReady(){
  const nameOk = myNameInput.value.trim().length > 0;
  const avatarOk = !!store.profile.avatar;
  if(nameOk && avatarOk) return true;

  toast('먼저 이름과 아바타부터 설정해주세요 👆');
  if(!nameOk){
    myNameInput.classList.add('warn');
    myNameInput.focus();
  }
  if(!avatarOk){
    avatarPicker.style.display = 'grid';
    myAvatarEl.scrollIntoView({ behavior:'smooth', block:'center' });
  }
  return false;
}

/* ── 설정 탭: 파트너 연결(초대코드) ───────────────────────── */
const inviteBtn   = document.getElementById('inviteBtn');
const roomPanel   = document.getElementById('roomPanel');
const roomStatusText = document.getElementById('roomStatusText');
const inviteCard  = document.getElementById('inviteCard');

function renderSettingsRoomStatus(){
  if(!firebaseReady){
    roomStatusText.innerHTML = '⚠️ <b>파트너 초대 기능이 아직 연결 안 됐어요.</b><br/>firebase-config.js에 본인 Firebase 키를 넣고, Firestore 규칙을 게시했는지 확인해주세요.';
    inviteBtn.style.display = 'none';
    roomPanel.style.display = 'none';
    return;
  }
  const roomInfo = store.getRoomInfo();
  if(roomInfo && store.room){
    const members = store.room.members || [];

    if(members.length >= 2){
      // 완전히 연결됨 (파트너까지 들어옴)
      const names = members.map(m => m.name).join(', ');
      roomStatusText.innerHTML = `🎉 <b>연결됨</b> — 함께 쓰는 중: ${names}`;
      inviteBtn.style.display = '';
      inviteBtn.textContent = '연결 해제하기';
      inviteBtn.onclick = leaveRoom;
      roomPanel.style.display = 'none';
    } else {
      // 코드는 만들었지만 아직 파트너가 안 들어온 "대기 중" 상태
      // -> 코드/비밀번호를 계속 보여줘야 해요, 여기서 숨기면 안 됨
      roomStatusText.innerHTML = '⏳ <b>파트너를 기다리는 중</b> — 아래 코드와 비밀번호를 전달해주세요.';
      inviteBtn.style.display = '';
      inviteBtn.textContent = '취소하고 연결 해제하기';
      inviteBtn.onclick = leaveRoom;

      roomPanel.style.display = 'block';
      document.querySelectorAll('.rtab').forEach(t => t.classList.toggle('active', t.dataset.rtab === 'create'));
      document.getElementById('rpane-create').style.display = 'block';
      document.getElementById('rpane-join').style.display = 'none';
      document.getElementById('roomCodeBox').style.display = 'block';
      document.getElementById('roomCode').textContent = formatCodeDisplay(roomInfo.code);
    }
  } else {
    roomStatusText.textContent = '아래에서 코드를 만들거나 입력해서 파트너와 연결해보세요.';
    inviteBtn.style.display = 'none'; // 패널이 기본으로 보이니 별도 버튼 불필요
    roomPanel.style.display = 'block'; // 기본으로 바로 보이게
  }
  renderAnniversary();
  updateDdayBadges();
}

/* ── 기념일 · D-day (최대 3개: 연애/결혼/탄생) ────────────────── */
// 케이크 이모지는 기기마다 색이 다르지만, 흰색 커스텀 아이콘은 캘린더의
// 연분홍 배경이랑 대비가 안 살아서 잘 안 보였어요. 초코케이크(🎂)로 되돌려요.

const ANNIV_TYPES = [
  { key:'dating',   label:'연애',   icon:'💗' },
  { key:'marriage', label:'결혼',   icon:'💍' },
  { key:'birth',    label:'탄생',   icon:'🎂' },
];
const annivRows = document.getElementById('annivRows');
const annivHint = document.getElementById('annivHint');

// 설정 화면의 3개 입력 줄을 미리 만들어둠 (연애/결혼/탄생 고정 순서 - 편집하기 쉬우라고)
ANNIV_TYPES.forEach(t=>{
  if(t.key === 'birth') return; // 탄생(아기)은 인원 제한 없이 여러 명 등록해야 해서 아래에서 별도로 처리
  const row = document.createElement('div');
  row.className = 'anniv-row';
  row.innerHTML = `
    <div class="aicon">${t.icon}</div>
    <div class="alabel">${t.label}</div>
    <input type="date" class="anniv-input" id="annivInput-${t.key}" disabled />
  `;
  annivRows.appendChild(row);
  row.querySelector('input').addEventListener('change', (e)=> saveAnnivEntry(t.key, { date: e.target.value }));
});

// 탄생(아기)만 몇 명이든 추가할 수 있는 목록으로 따로 렌더링
const birthRow = document.createElement('div');
birthRow.className = 'anniv-row anniv-birth-row';
birthRow.innerHTML = `<div class="aicon">👨‍👩‍👧</div><div class="anniv-birth-list" id="annivBirthList"></div>`;
annivRows.appendChild(birthRow);

function renderBirthList(){
  const roomInfo = store.getRoomInfo();
  const connected = !!(roomInfo && store.room);
  const list = document.getElementById('annivBirthList');
  const entries = connected ? (store.room.anniversaries || []).filter(a => a.type === 'birth') : [];

  list.innerHTML = '';

  entries.forEach(entry=>{
    const row = document.createElement('div');
    row.className = 'anniv-birth-entry';
    row.innerHTML = `
      <input type="text" class="anniv-name-input" placeholder="아이 이름" maxlength="6" value="${entry.name || ''}" />
      <input type="date" class="anniv-input" value="${entry.date}" />
      <button class="anniv-del-btn" type="button" title="삭제">✕</button>
    `;
    const nameInput = row.children[0], dateInput = row.children[1], delBtn = row.children[2];
    nameInput.addEventListener('change', ()=> updateBirthEntry(entry.id, { name: nameInput.value.trim() }));
    dateInput.addEventListener('change', ()=> updateBirthEntry(entry.id, { date: dateInput.value }));
    delBtn.addEventListener('click', ()=> removeBirthEntry(entry.id));
    list.appendChild(row);
  });

  // 새 아이를 추가할 수 있는 빈 줄 (날짜를 넣는 순간 새 항목으로 저장됨)
  const addRow = document.createElement('div');
  addRow.className = 'anniv-birth-entry anniv-birth-new';
  addRow.innerHTML = `
    <input type="text" class="anniv-name-input" placeholder="아이 이름" maxlength="6" ${connected ? '' : 'disabled'} />
    <input type="date" class="anniv-input" ${connected ? '' : 'disabled'} />
    <span class="anniv-add-plus">＋</span>
  `;
  const newName = addRow.children[0], newDate = addRow.children[1];
  const tryAddNew = ()=> { if(newDate.value) addBirthEntry(newName.value.trim(), newDate.value); };
  newDate.addEventListener('change', tryAddNew);
  list.appendChild(addRow);
}

async function addBirthEntry(name, date){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady || !date) return;
  const current = (store.room && store.room.anniversaries) || [];
  const entry = { type:'birth', id:'b_' + Date.now(), date, setAt: Date.now() };
  if(name) entry.name = name;
  try {
    await db.collection('rooms').doc(roomInfo.code).update({ anniversaries: [...current, entry] });
    toast('아이 기념일을 추가했어요 🎂');
  } catch(e){ toast('저장에 실패했어요'); console.warn('탄생 기념일 추가 실패:', e); }
}

async function updateBirthEntry(id, patch){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady) return;
  const current = (store.room && store.room.anniversaries) || [];
  const updated = current.map(a => (a.type === 'birth' && a.id === id) ? { ...a, ...patch } : a);
  try {
    await db.collection('rooms').doc(roomInfo.code).update({ anniversaries: updated });
    toast('저장했어요 💗');
  } catch(e){ toast('저장에 실패했어요'); console.warn('탄생 기념일 수정 실패:', e); }
}

async function removeBirthEntry(id){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady) return;
  const current = (store.room && store.room.anniversaries) || [];
  const updated = current.filter(a => !(a.type === 'birth' && a.id === id));
  try {
    await db.collection('rooms').doc(roomInfo.code).update({ anniversaries: updated });
    toast('삭제했어요');
  } catch(e){ toast('삭제에 실패했어요'); console.warn('탄생 기념일 삭제 실패:', e); }
}

function renderAnniversary(){
  const roomInfo = store.getRoomInfo();
  const connected = !!(roomInfo && store.room); // 방이 만들어진 순간부터 활성화 (파트너 입장 전이어도 OK)
  const list = (connected && store.room.anniversaries) || [];
  console.log('[renderAnniversary]', { roomInfo, storeRoom: store.room, connected });

  ANNIV_TYPES.forEach(t=>{
    if(t.key === 'birth') return; // 탄생은 renderBirthList()가 따로 처리
    const input = document.getElementById('annivInput-' + t.key);
    if(!input){ console.warn('[renderAnniversary] input을 못 찾음:', 'annivInput-' + t.key); return; }
    input.disabled = !connected;
    const entry = list.find(a => a.type === t.key);
    input.value = entry ? entry.date : '';
  });

  renderBirthList();

  annivHint.textContent = connected
    ? (list.length ? '기념일이 파트너 화면에도 똑같이 보여요. 상단 배지는 연애·결혼이 첫째 줄, 탄생이 둘째 줄에 나와요.' : '기념일을 정하면 설정을 제외한 모든 화면 상단에 D-day가 떠요.')
    : '파트너와 연결하면 기념일을 설정할 수 있어요';
}

// patch는 { date } 또는 { name } 중 하나(또는 둘 다) — 날짜와 이름을 각자 따로 수정해도
// 서로의 값을 안 지우도록, 기존 값이랑 합쳐서(merge) 저장해요.
async function saveAnnivEntry(type, patch){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady) return;
  const current = (store.room && store.room.anniversaries) || [];
  const existing = current.find(a => a.type === type);

  const date = patch.date !== undefined ? patch.date : (existing ? existing.date : '');
  const name = patch.name !== undefined ? patch.name : (existing ? existing.name : '');

  let updated;
  if(date){
    const entry = { type, date, setAt: existing ? existing.setAt : Date.now() }; // 처음 설정한 순서는 유지
    if(name) entry.name = name; // 아이 이름 등, type이 'birth'일 때만 의미 있음
    updated = existing ? current.map(a => a.type === type ? entry : a) : [...current, entry];
  } else {
    updated = current.filter(a => a.type !== type); // 날짜를 지우면 이 기념일 자체를 목록에서 제거
  }
  try {
    await db.collection('rooms').doc(roomInfo.code).update({ anniversaries: updated });
    toast(date ? '기념일을 저장했어요 💗' : '기념일을 지웠어요');
    // Firestore 실시간 리스너가 곧 store.room을 갱신해줄 거예요 (양쪽 화면 다 동기화됨)
  } catch(e){
    toast('기념일 저장에 실패했어요');
    console.warn('기념일 저장 실패:', e);
  }
}

function formatDday(dateStr){
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0,0,0,0);
  const diffDays = Math.round((today - target) / 86400000);
  return diffDays >= 0 ? `D+${diffDays + 1}` : `D${diffDays}`; // 한국식: 시작일이 D+1
}

function updateDdayBadges(){
  const containers = document.querySelectorAll('.dday-badges');
  const list = (store.room && store.room.anniversaries) || [];
  // 나중에 등록한 게 왼쪽(먼저) 오도록 내림차순 정렬 -> 새로 등록하면
  // 그게 왼쪽 자리를 차지하면서 기존에 있던 것들이 오른쪽으로 밀림
  const sorted = [...list].sort((a,b) => (b.setAt||0) - (a.setAt||0));

  const coupleList = sorted.filter(a => a.type === 'dating' || a.type === 'marriage'); // 1번째 줄: 연애·결혼
  const babyList = sorted.filter(a => a.type === 'birth'); // 2번째 줄: 탄생(아기)

  function badgeHTML(a){
    const meta = ANNIV_TYPES.find(t => t.key === a.type);
    const label = (a.type === 'birth' && a.name) ? a.name : '';
    return `<span class="dday-badge">${meta ? meta.icon : '💗'}${label ? ' '+label : ''} ${formatDday(a.date)}</span>`;
  }

  const row1 = coupleList.map(badgeHTML).join('');
  const row2 = babyList.map(badgeHTML).join('');
  const html = (row1 ? `<div class="dday-row">${row1}</div>` : '') + (row2 ? `<div class="dday-row">${row2}</div>` : '');
  const hasAny = coupleList.length > 0 || babyList.length > 0;

  containers.forEach(c => { c.innerHTML = html; c.classList.toggle('show', hasAny); });
}

async function leaveRoom(){
  const roomInfo = store.getRoomInfo();

  // Firestore 쪽 방 문서에서도 내 정보를 실제로 지워요 (안 지우면 파트너
  // 화면에는 내가 계속 "함께 쓰는 중"으로 남아있게 돼요)
  if(firebaseReady && roomInfo){
    try {
      const ref = db.collection('rooms').doc(roomInfo.code);
      const snap = await ref.get();
      if(snap.exists){
        const data = snap.data();
        const remaining = (data.members || []).filter(m => m.id !== roomInfo.myId);
        if(remaining.length === 0){
          await ref.delete(); // 마지막 사람까지 나가면 방 자체를 정리
        } else {
          await ref.update({ members: remaining });
        }
      }
    } catch(e){
      console.warn('방에서 내 정보 제거 실패 (그래도 이 기기는 연결 해제돼요):', e);
    }
  }

  if(roomUnsub) { roomUnsub(); roomUnsub = null; }
  store.clearRoomInfo();
  store.room = null;
  store.loadLocal();
  renderHome();
  if(document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
  renderSettingsRoomStatus();
  toast('연결을 해제하고 혼자 모드로 돌아갔어요');
}

// 방 만들기/입장 탭 전환
document.querySelectorAll('.rtab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.rtab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('rpane-create').style.display = t.dataset.rtab === 'create' ? 'block' : 'none';
    document.getElementById('rpane-join').style.display = t.dataset.rtab === 'join' ? 'block' : 'none';
  });
});

// 코드 만들기: Firestore 트랜잭션으로 "이미 존재하면 실패, 없으면 그 자리에서 즉시 생성"
// 이렇게 하면 두 사람이 동시에 같은 코드를 만들려고 해도 서버가 최종 심판이 되어
// 반드시 한쪽만 성공해요 (실패하면 자동으로 새 코드로 재시도).
// 방 생성/입장 시점에 쓸 "내 이름"을 화면 입력창에서 직접 읽어와요.
// (store.profile.name에만 의존하면 초기화 순서 등으로 어긋날 수 있어서,
// 지금 실제로 화면에 보이는/입력한 값을 그대로 쓰도록 확실히 해요)
function getMyCurrentName(){
  const name = myNameInput.value.trim();
  store.profile.name = name; // 동기화
  return name;
}

async function createRoom(password){
  const myName = getMyCurrentName();
  for(let attempt = 0; attempt < 5; attempt++){
    let code = '';
    for(let i=0; i<12; i++) code += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];
    const ref = db.collection('rooms').doc(code);
    const myId = 'u_' + Date.now();
    const result = await db.runTransaction(async (tx)=>{
      const doc = await tx.get(ref);
      if(doc.exists) return null; // 이미 있는 코드 -> 재시도
      tx.set(ref, {
        password,
        members: [{ id: myId, name: myName, avatar: store.profile.avatar }],
        events: store.events,
        createdAt: Date.now(),
        expiresAt: Date.now() + ROOM_EXPIRY_MS,
      });
      return { code, myId };
    });
    if(result) return result;
  }
  throw new Error('코드 생성에 실패했어요. 인터넷 연결을 확인하고 다시 시도해주세요.');
}

let lastIssuedCode = null;
let lastIssuedPassword = null;

function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text);
  }
  // 구형 Safari 등 navigator.clipboard가 없는 환경을 위한 대체 방법
  return new Promise((resolve, reject)=>{
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('복사 실패'));
    } catch(e){ reject(e); }
  });
}

document.getElementById('createRoomBtn').addEventListener('click', async ()=>{
  if(!firebaseReady){ toast('아직 Firebase 연동이 안 됐어요. firebase-config.js를 확인해주세요'); return; }
  if(!ensureProfileReady()) return;
  const pwInput = document.getElementById('roomPwInput');
  const pw = pwInput.value.trim();
  const btn = document.getElementById('createRoomBtn');
  if(pw.length !== 6){ toast('비밀번호 6자리를 입력해주세요'); return; }

  btn.disabled = true; btn.textContent = '코드 발급 중...';
  try {
    const { code, myId } = await createRoom(pw);
    store.setRoomInfo({ code, myId });
    lastIssuedCode = code;
    lastIssuedPassword = pw;
    document.getElementById('roomCode').textContent = formatCodeDisplay(code);
    document.getElementById('roomCodeBox').style.display = 'block';
    toast('코드가 발급됐어요! 아래 복사 버튼을 눌러 파트너에게 전달해주세요');
    connectToRoomListener(code);
  } catch(e){
    toast(e.message || '코드 발급에 실패했어요');
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = '코드 발급하고 공유하기';
  }
});

document.getElementById('copyCodeBtn').addEventListener('click', async ()=>{
  if(!lastIssuedCode) return;
  const text = `초대 코드: ${formatCodeDisplay(lastIssuedCode)}\n비밀번호: ${lastIssuedPassword}`;
  const btn = document.getElementById('copyCodeBtn');
  try {
    await copyToClipboard(text);
    const original = btn.textContent;
    btn.textContent = '✅ 복사됐어요!';
    toast('코드+비밀번호가 복사됐어요. 파트너에게 붙여넣기 하세요');
    setTimeout(()=>{ btn.textContent = original; }, 1600);
  } catch(e){
    toast('복사에 실패했어요. 코드를 직접 길게 눌러서 복사해주세요');
    console.warn('클립보드 복사 실패:', e);
  }
});

// 코드 입력하기(join)
let joinAttempts = 0;
document.getElementById('joinRoomBtn').addEventListener('click', async ()=>{
  if(!firebaseReady){ toast('아직 Firebase 연동이 안 됐어요. firebase-config.js를 확인해주세요'); return; }
  if(!ensureProfileReady()) return;
  const codeRaw = document.getElementById('joinCodeInput').value.trim();
  const code = codeRaw.replace(/-/g, ''); // 대시(-) 넣어서 입력해도 자동으로 제거
  const pw = document.getElementById('joinPwInput').value.trim();
  const errEl = document.getElementById('joinError');
  const btn = document.getElementById('joinRoomBtn');
  errEl.textContent = '';

  if(!code || pw.length !== 6){
    errEl.textContent = '코드와 6자리 비밀번호를 모두 입력해주세요';
    return;
  }

  btn.disabled = true; btn.textContent = '확인 중...';
  try {
    const ref = db.collection('rooms').doc(code);
    const snap = await ref.get();
    if(!snap.exists){ errEl.textContent = '존재하지 않는 코드예요. 코드를 다시 확인해주세요'; return; }

    const data = snap.data();
    if(data.expiresAt < Date.now()){
      errEl.textContent = '만료된 코드예요. 방장에게 새 코드를 받아주세요';
      return;
    }
    if(data.password !== pw){
      joinAttempts++;
      const left = 5 - joinAttempts;
      if(left <= 0){
        errEl.textContent = '5회 모두 틀렸어요. 방장에게 코드를 다시 받아주세요';
        btn.disabled = true;
        return;
      }
      errEl.textContent = `비밀번호가 올바르지 않아요. 남은 기회 ${left}회`;
      return;
    }

    // 성공: 나를 멤버로 추가
    const myId = 'u_' + Date.now();
    const myName = getMyCurrentName();
    const newMembers = [...(data.members || []), { id: myId, name: myName, avatar: store.profile.avatar }];
    await ref.update({ members: newMembers });

    store.setRoomInfo({ code, myId });
    toast('연결됐어요! 🎉');
    connectToRoomListener(code);
  } catch(e){
    errEl.textContent = '연결 중 문제가 발생했어요. 인터넷 연결을 확인해주세요';
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = '연결하기';
  }
});

/* ── Firestore 실시간 동기화 ───────────────────────────────── */
function connectToRoomListener(code){
  if(!firebaseReady){ store.loadLocal(); renderHome(); return; }
  if(roomUnsub) roomUnsub();
  roomUnsub = db.collection('rooms').doc(code).onSnapshot(doc=>{
    if(!doc.exists){
      toast('연결된 방을 찾을 수 없어요. 연결이 해제됐어요');
      leaveRoom();
      return;
    }
    const data = doc.data();
    store.events = data.events || [];
    store.room = data;
    renderHome();
    if(document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
    renderSettingsRoomStatus();
    buildWhoRow(); // 멤버 정보가 방금 도착했으니, 등록 탭의 "누구 일정" 목록도 다시 그려야 함
    if(typeof renderTetrisLeaderboard === 'function') renderTetrisLeaderboard(); // 파트너 점수도 실시간으로 반영
    if(typeof tetrisHandleMatchUpdate === 'function') tetrisHandleMatchUpdate(); // 대결 초대/자동시작/실시간 HUD
  }, err=>{
    console.warn('실시간 동기화 오류:', err);
    toast('실시간 동기화 중 문제가 발생했어요');
  });
}

/* ── 초기화 ────────────────────────────────────────────────── */
/* ============================================================
   테트리스 미니게임
   ------------------------------------------------------------
   1단계: 각자 플레이하고 점수판으로 경쟁 (지금 만드는 버전)
   2단계(추후): 실시간 대결 모드
   ============================================================ */
const TETRIS_COLS = 10, TETRIS_ROWS = 20, TETRIS_CELL = 22;

const TETRIS_SHAPES = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ],
};
const TETRIS_COLORS = { I:'#22d3ee', O:'#fbbf24', T:'#a78bfa', S:'#4ade80', Z:'#f87171', J:'#60a5fa', L:'#fb923c' };
const TETRIS_TYPES = Object.keys(TETRIS_SHAPES);

let tetrisState = null;
let tetrisLoopId = null;
let tetrisLastDrop = 0;

function tetrisEmptyBoard(){
  return Array.from({length: TETRIS_ROWS}, () => Array(TETRIS_COLS).fill(0));
}
function tetrisBag(){
  const arr = [...TETRIS_TYPES];
  for(let i=arr.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}
function tetrisNewPiece(type){
  const shape = TETRIS_SHAPES[type][0];
  const w = shape[0].length;
  return { type, rotation:0, x: Math.floor((TETRIS_COLS - w)/2), y: 0 };
}
function tetrisGetShape(piece){ return TETRIS_SHAPES[piece.type][piece.rotation]; }

function tetrisCollide(board, piece, dx=0, dy=0, rotation=null){
  const shape = TETRIS_SHAPES[piece.type][rotation===null ? piece.rotation : rotation];
  for(let r=0; r<shape.length; r++){
    for(let c=0; c<shape[r].length; c++){
      if(!shape[r][c]) continue;
      const nx = piece.x + c + dx;
      const ny = piece.y + r + dy;
      if(nx<0 || nx>=TETRIS_COLS || ny>=TETRIS_ROWS) return true;
      if(ny>=0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function tetrisSpawnNext(){
  const st = tetrisState;
  if(st.queue.length < 2) st.queue.push(...tetrisBag());
  const type = st.queue.shift();
  st.piece = tetrisNewPiece(type);
  if(tetrisCollide(st.board, st.piece)){
    tetrisGameOver();
  }
}

function tetrisLock(){
  const st = tetrisState;
  const shape = tetrisGetShape(st.piece);
  for(let r=0; r<shape.length; r++){
    for(let c=0; c<shape[r].length; c++){
      if(!shape[r][c]) continue;
      const nx = st.piece.x+c, ny = st.piece.y+r;
      if(ny>=0) st.board[ny][nx] = st.piece.type;
    }
  }
  let cleared = 0;
  for(let r=TETRIS_ROWS-1; r>=0; r--){
    if(st.board[r].every(cell=>cell)){
      st.board.splice(r,1);
      st.board.unshift(Array(TETRIS_COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if(cleared > 0){
    const pointsTable = [0,100,300,500,800];
    st.score += (pointsTable[cleared] || 800) * st.level;
    st.lines += cleared;
    st.level = Math.floor(st.lines/10) + 1;
  }
  if(st.versus) tetrisVersusSyncScore(); // 조각을 놓을 때마다(줄 클리어 여부와 상관없이) 파트너 화면에 반영
  if(!st.gameOver) tetrisSpawnNext();
}

function tetrisGhostY(){
  const st = tetrisState;
  let dy = 0;
  while(!tetrisCollide(st.board, st.piece, 0, dy+1)) dy++;
  return st.piece.y + dy;
}

function tetrisRender(){
  const st = tetrisState;
  const canvas = document.getElementById('tetrisCanvas');
  if(!canvas || !st) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // 격자선
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for(let c=0; c<=TETRIS_COLS; c++){
    ctx.beginPath(); ctx.moveTo(c*TETRIS_CELL+0.5, 0); ctx.lineTo(c*TETRIS_CELL+0.5, TETRIS_ROWS*TETRIS_CELL); ctx.stroke();
  }
  for(let r=0; r<=TETRIS_ROWS; r++){
    ctx.beginPath(); ctx.moveTo(0, r*TETRIS_CELL+0.5); ctx.lineTo(TETRIS_COLS*TETRIS_CELL, r*TETRIS_CELL+0.5); ctx.stroke();
  }

  for(let r=0; r<TETRIS_ROWS; r++){
    for(let c=0; c<TETRIS_COLS; c++){
      const v = st.board[r][c];
      if(v){
        ctx.fillStyle = TETRIS_COLORS[v];
        ctx.fillRect(c*TETRIS_CELL, r*TETRIS_CELL, TETRIS_CELL-1, TETRIS_CELL-1);
      }
    }
  }

  // 고스트(예상 착지 위치) - 반투명
  const ghostY = tetrisGhostY();
  const shape = tetrisGetShape(st.piece);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = TETRIS_COLORS[st.piece.type];
  for(let r=0; r<shape.length; r++){
    for(let c=0; c<shape[r].length; c++){
      if(!shape[r][c]) continue;
      const y = ghostY + r;
      if(y<0) continue;
      ctx.fillRect((st.piece.x+c)*TETRIS_CELL, y*TETRIS_CELL, TETRIS_CELL-1, TETRIS_CELL-1);
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = TETRIS_COLORS[st.piece.type];
  for(let r=0; r<shape.length; r++){
    for(let c=0; c<shape[r].length; c++){
      if(!shape[r][c]) continue;
      const y = st.piece.y+r;
      if(y<0) continue;
      ctx.fillRect((st.piece.x+c)*TETRIS_CELL, y*TETRIS_CELL, TETRIS_CELL-1, TETRIS_CELL-1);
    }
  }
  const scoreEl = document.getElementById('tetrisScore');
  const levelEl = document.getElementById('tetrisLevel');
  const linesEl = document.getElementById('tetrisLines');
  if(scoreEl) scoreEl.textContent = st.score;
  if(levelEl) levelEl.textContent = st.level;
  if(linesEl) linesEl.textContent = st.lines;

  const nextCanvas = document.getElementById('tetrisNextCanvas');
  if(nextCanvas){
    const nctx = nextCanvas.getContext('2d');
    nctx.clearRect(0,0,nextCanvas.width,nextCanvas.height);
    const nextType = st.queue[0];
    const nshape = TETRIS_SHAPES[nextType][0];
    nctx.fillStyle = TETRIS_COLORS[nextType];
    const cell = 14;
    const offX = (4-nshape[0].length)/2, offY = (4-nshape.length)/2;
    for(let r=0; r<nshape.length; r++){
      for(let c=0; c<nshape[r].length; c++){
        if(nshape[r][c]) nctx.fillRect((c+offX)*cell, (r+offY)*cell, cell-1, cell-1);
      }
    }
  }
}

function tetrisLoop(timestamp){
  const st = tetrisState;
  if(!st || st.paused || st.gameOver) return;
  if(!tetrisLastDrop) tetrisLastDrop = timestamp;
  // 레벨(라인 수)이 올라가도 빨라지고, 같은 레벨이어도 시간이 갈수록(10초마다 10ms씩) 조금씩 더 빨라져요
  const elapsedSec = (timestamp - st.startTs) / 1000;
  const timeSpeedup = Math.floor(elapsedSec / 10) * 10;
  const interval = Math.max(100, 800 - (st.level-1)*60 - timeSpeedup);
  if(timestamp - tetrisLastDrop > interval){
    tetrisDrop();
    tetrisLastDrop = timestamp;
  }
  tetrisRender();
  tetrisLoopId = requestAnimationFrame(tetrisLoop);
}

function tetrisDrop(){
  const st = tetrisState;
  if(!tetrisCollide(st.board, st.piece, 0, 1)){
    st.piece.y++;
  } else {
    tetrisLock();
  }
}
function tetrisMove(dx){
  const st = tetrisState;
  if(!st || st.paused || st.gameOver) return;
  if(!tetrisCollide(st.board, st.piece, dx, 0)) st.piece.x += dx;
  tetrisRender();
}
function tetrisRotate(){
  const st = tetrisState;
  if(!st || st.paused || st.gameOver) return;
  const newRot = (st.piece.rotation+1) % TETRIS_SHAPES[st.piece.type].length;
  if(!tetrisCollide(st.board, st.piece, 0, 0, newRot)) st.piece.rotation = newRot;
  tetrisRender();
}
function tetrisHardDrop(){
  const st = tetrisState;
  if(!st || st.paused || st.gameOver) return;
  while(!tetrisCollide(st.board, st.piece, 0, 1)) st.piece.y++;
  tetrisLock();
  tetrisRender();
}
function tetrisSoftDrop(){
  const st = tetrisState;
  if(!st || st.paused || st.gameOver) return;
  tetrisDrop();
  tetrisRender();
}

async function tetrisGameOver(){
  tetrisState.gameOver = true;
  cancelAnimationFrame(tetrisLoopId);
  clearInterval(tetrisVersusSyncTimer);
  const scoreEl = document.getElementById('tetrisGameOverScore');
  if(scoreEl) scoreEl.textContent = tetrisState.score;
  const overlay = document.getElementById('tetrisGameOverOverlay');
  const titleEl = document.getElementById('tetrisGameOverTitle');
  if(titleEl) titleEl.textContent = '게임 오버';
  if(overlay) overlay.style.display = 'flex';

  if(tetrisState.versus){
    await tetrisVersusReportDeath();
  }
  await tetrisSaveScore(tetrisState.score);
}

function tetrisStart(opts){
  const versus = !!(opts && opts.versus);
  tetrisState = { board: tetrisEmptyBoard(), queue: tetrisBag(), score:0, level:1, lines:0, paused:false, gameOver:false, startTs: performance.now(), versus };
  tetrisSpawnNext();
  tetrisLastDrop = 0;
  const startEl = document.getElementById('tetrisStartScreen');
  const lobbyEl = document.getElementById('tetrisVersusLobby');
  const playEl = document.getElementById('tetrisPlayScreen');
  const overEl = document.getElementById('tetrisGameOverOverlay');
  if(startEl) startEl.style.display = 'none';
  if(lobbyEl) lobbyEl.style.display = 'none';
  if(playEl) playEl.style.display = 'block';
  if(overEl) overEl.style.display = 'none';
  const vsResultEl = document.getElementById('tgcVsResult');
  if(vsResultEl) vsResultEl.style.display = 'none';
  const pauseBtn = document.getElementById('tetrisPauseBtn');
  if(pauseBtn) pauseBtn.textContent = '⏸';
  const hud = document.getElementById('tetrisVsHud');
  if(hud) hud.style.display = versus ? 'flex' : 'none';
  clearInterval(tetrisVersusSyncTimer);
  if(versus){
    tetrisVersusRenderHud();
    tetrisVersusSyncScore(); // 시작하자마자 한 번 즉시 보내서 상대 화면에 빈 보드부터 바로 뜨게
    tetrisVersusSyncTimer = setInterval(()=>{
      if(tetrisState && tetrisState.versus && !tetrisState.paused && !tetrisState.gameOver) tetrisVersusSyncScore();
    }, 300); // 조각을 놓을 때뿐 아니라 0.3초마다도 계속 보내서 움직임이 좀 더 매끄럽게 보이게
  }
  cancelAnimationFrame(tetrisLoopId);
  tetrisLoopId = requestAnimationFrame(tetrisLoop);
}

function tetrisQuit(){
  cancelAnimationFrame(tetrisLoopId);
  clearInterval(tetrisVersusSyncTimer);
  // 대결 도중에 그만두면 기권패 처리 (아직 안 끝난 대결이었을 때만)
  if(tetrisState && tetrisState.versus && !tetrisState.gameOver){
    tetrisVersusReportDeath();
  }
  tetrisState = null;
  const startEl = document.getElementById('tetrisStartScreen');
  const playEl = document.getElementById('tetrisPlayScreen');
  if(playEl) playEl.style.display = 'none';
  if(startEl) startEl.style.display = 'block';
  renderTetrisLeaderboard();
}

/* ── 테트리스 대결(2단계): Firestore로 점수/생존 상태를 실시간 동기화 ── */

function tetrisMyVersusKey(){
  const match = store.room && store.room.tetrisMatch;
  const roomInfo = store.getRoomInfo();
  if(!match || !roomInfo) return null;
  if(match.hostId === roomInfo.myId) return 'host';
  if(match.guestId === roomInfo.myId) return 'guest';
  return null;
}
function tetrisOtherVersusKey(){
  const k = tetrisMyVersusKey();
  return k === 'host' ? 'guest' : (k === 'guest' ? 'host' : null);
}

document.getElementById('tetrisVersusOpenBtn')?.addEventListener('click', ()=>{
  document.getElementById('tetrisStartScreen').style.display = 'none';
  document.getElementById('tetrisVersusLobby').style.display = 'block';
  renderVersusLobby();
});
document.getElementById('tetrisVersusCloseBtn')?.addEventListener('click', ()=>{
  document.getElementById('tetrisVersusLobby').style.display = 'none';
  document.getElementById('tetrisStartScreen').style.display = 'block';
});

function renderVersusLobby(){
  const body = document.getElementById('tetrisVersusLobbyBody');
  if(!body) return;
  const match = store.room && store.room.tetrisMatch;
  const roomInfo = store.getRoomInfo();
  const members = getMemberList();
  const me = members.find(m => roomInfo && m.id === roomInfo.myId) || { name: store.profile.name, avatar: store.profile.avatar };
  const partner = members.find(m => roomInfo && m.id !== roomInfo.myId);

  if(!match || match.status === 'finished' || match.status === 'cancelled'){
    body.innerHTML = `
      <div class="vs-lobby-title">파트너와 한판 붙어볼까요?</div>
      <div class="vs-lobby-avatars"><span class="va">${me.avatar}</span><span class="vs-lobby-vs">VS</span><span class="va">${partner ? partner.avatar : '❔'}</span></div>
      <div class="vs-lobby-desc">신청하면 파트너 화면에 알림처럼 떠요. 수락하면 둘 다 동시에 게임이 시작돼요.</div>
      <button class="save-btn ready" id="tetrisVersusInviteBtn">대결 신청하기</button>`;
    document.getElementById('tetrisVersusInviteBtn')?.addEventListener('click', tetrisVersusInvite);
    return;
  }

  if(match.status === 'waiting'){
    const isHost = match.hostId === (roomInfo && roomInfo.myId);
    if(isHost){
      body.innerHTML = `
        <div class="vs-lobby-title">대결 신청 완료!</div>
        <div class="vs-lobby-avatars"><span class="va">${match.hostAvatar}</span><span class="vs-lobby-vs">VS</span><span class="va">${partner ? partner.avatar : '❔'}</span></div>
        <div class="vs-lobby-desc">파트너가 수락하면 자동으로 게임이 시작돼요. 잠시만 기다려주세요 ⏳</div>
        <button class="tetris-quit-btn" id="tetrisVersusCancelBtn" style="width:100%;">신청 취소하기</button>`;
      document.getElementById('tetrisVersusCancelBtn')?.addEventListener('click', tetrisVersusCancel);
    } else {
      body.innerHTML = `
        <div class="vs-lobby-title">${match.hostName}님이 대결을 신청했어요!</div>
        <div class="vs-lobby-avatars"><span class="va">${match.hostAvatar}</span><span class="vs-lobby-vs">VS</span><span class="va">${me.avatar}</span></div>
        <button class="save-btn ready" id="tetrisVersusAcceptBtn">수락하기</button>
        <button class="tetris-quit-btn" id="tetrisVersusDeclineBtn" style="width:100%; margin-top:6px;">거절하기</button>`;
      document.getElementById('tetrisVersusAcceptBtn')?.addEventListener('click', tetrisVersusAccept);
      document.getElementById('tetrisVersusDeclineBtn')?.addEventListener('click', tetrisVersusCancel);
    }
    return;
  }

  if(match.status === 'playing'){
    body.innerHTML = `
      <div class="vs-lobby-title">대결이 진행 중이에요!</div>
      <button class="save-btn ready" id="tetrisVersusRejoinBtn">게임 화면으로 가기</button>`;
    document.getElementById('tetrisVersusRejoinBtn')?.addEventListener('click', ()=>{
      document.getElementById('tetrisVersusLobby').style.display = 'none';
      tetrisStart({ versus:true });
    });
  }
}

async function tetrisVersusInvite(){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady) return;
  try {
    await db.collection('rooms').doc(roomInfo.code).update({
      tetrisMatch: {
        status:'waiting',
        hostId: roomInfo.myId, hostName: store.profile.name || '나', hostAvatar: store.profile.avatar || '🐻',
        guestId: null, guestName: null, guestAvatar: null,
        hostScore:0, guestScore:0, hostLines:0, guestLines:0, hostAlive:true, guestAlive:true,
        winnerId:null, startedAt:null, finishedAt:null,
      }
    });
  } catch(e){ console.warn('대결 신청 실패:', e); toast('대결 신청에 실패했어요'); }
}
async function tetrisVersusAccept(){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady || !store.room || !store.room.tetrisMatch) return;
  try {
    const current = store.room.tetrisMatch;
    await db.collection('rooms').doc(roomInfo.code).update({
      tetrisMatch: {
        ...current,
        guestId: roomInfo.myId, guestName: store.profile.name || '나', guestAvatar: store.profile.avatar || '🐰',
        status:'playing', startedAt: Date.now(),
        hostScore:0, guestScore:0, hostLines:0, guestLines:0, hostAlive:true, guestAlive:true, winnerId:null,
      }
    });
  } catch(e){ console.warn('대결 수락 실패:', e); toast('대결 수락에 실패했어요'); }
}
async function tetrisVersusCancel(){
  const roomInfo = store.getRoomInfo();
  if(!roomInfo || !firebaseReady) return;
  try {
    await db.collection('rooms').doc(roomInfo.code).update({ tetrisMatch: null });
  } catch(e){ console.warn('대결 취소 실패:', e); }
  document.getElementById('tetrisVersusLobby').style.display = 'none';
  document.getElementById('tetrisStartScreen').style.display = 'block';
}

function tetrisEncodeBoard(board){
  let s = '';
  for(let r=0; r<TETRIS_ROWS; r++) for(let c=0; c<TETRIS_COLS; c++) s += board[r][c] || '0';
  return s;
}

async function tetrisVersusSyncScore(){
  const roomInfo = store.getRoomInfo();
  const key = tetrisMyVersusKey();
  if(!roomInfo || !firebaseReady || !key || !tetrisState){
    console.log('[tetris-sync] 동기화 건너뜀:', { hasRoomInfo:!!roomInfo, firebaseReady, key, hasState:!!tetrisState });
    return;
  }
  try {
    const patch = {};
    patch[`tetrisMatch.${key}Score`] = tetrisState.score;
    patch[`tetrisMatch.${key}Lines`] = tetrisState.lines;
    patch[`tetrisMatch.${key}Board`] = tetrisEncodeBoard(tetrisState.board);
    patch[`tetrisMatch.${key}PieceType`] = tetrisState.piece.type;
    patch[`tetrisMatch.${key}PieceX`] = tetrisState.piece.x;
    patch[`tetrisMatch.${key}PieceY`] = tetrisState.piece.y;
    patch[`tetrisMatch.${key}PieceRot`] = tetrisState.piece.rotation;
    await db.collection('rooms').doc(roomInfo.code).update(patch);
    console.log('[tetris-sync] 보냄:', key, 'boardLen=', patch[`tetrisMatch.${key}Board`].length, 'piece=', tetrisState.piece.type);
  } catch(e){ console.warn('[tetris-sync] 대결 동기화 실패:', e); }
}

let tetrisVersusSyncTimer = null;

async function tetrisVersusReportDeath(){
  const roomInfo = store.getRoomInfo();
  const key = tetrisMyVersusKey();
  const otherKey = tetrisOtherVersusKey();
  if(!roomInfo || !firebaseReady || !key) return;
  try {
    const ref = db.collection('rooms').doc(roomInfo.code);
    const snap = await ref.get();
    if(!snap.exists) return;
    const match = snap.data().tetrisMatch;
    if(!match || match.status !== 'playing') return; // 이미 끝난 대결이면 아무것도 안 함
    const patch = {};
    patch[`tetrisMatch.${key}Score`] = tetrisState.score;
    patch[`tetrisMatch.${key}Lines`] = tetrisState.lines;
    patch[`tetrisMatch.${key}Alive`] = false;
    patch['tetrisMatch.status'] = 'finished';
    patch['tetrisMatch.winnerId'] = otherKey === 'host' ? match.hostId : match.guestId;
    patch['tetrisMatch.finishedAt'] = Date.now();
    await ref.update(patch);
  } catch(e){ console.warn('대결 결과 기록 실패:', e); }
}

// Firestore에서 방 데이터가 갱신될 때마다(onSnapshot) 호출됨 — 대결 초대 감지, 자동 시작, 실시간 점수판 갱신
function tetrisHandleMatchUpdate(){
  const match = store.room && store.room.tetrisMatch;
  const roomInfo = store.getRoomInfo();
  if(!match || !roomInfo) return;
  const iAmParticipant = match.hostId === roomInfo.myId || match.guestId === roomInfo.myId;
  console.log('[tetris-match]', { status: match.status, iAmParticipant, hasTetrisState: !!tetrisState, isVersus: !!(tetrisState && tetrisState.versus) });

  // 로비가 열려있으면 최신 상태로 다시 그림 (초대 도착, 상대 수락 등)
  if(document.getElementById('tetrisVersusLobby')?.style.display !== 'none'){
    renderVersusLobby();
  }

  // 상대가 방금 수락해서 status가 playing으로 바뀐 순간 -> 내 로컬 게임 자동 시작
  if(match.status === 'playing' && iAmParticipant && (!tetrisState || !tetrisState.versus)){
    document.getElementById('tetrisVersusLobby').style.display = 'none';
    document.getElementById('tetrisStartScreen').style.display = 'none';
    tetrisStart({ versus:true });
  }

  // 대결 중 상대방 점수/생존 상태 실시간 HUD 갱신
  if(tetrisState && tetrisState.versus && iAmParticipant){
    tetrisVersusRenderHud();
    // 상대가 먼저 끝나서 대결이 끝났는데, 나는 아직 살아서 계속 플레이 중이면 -> 내 게임도 종료
    if(match.status === 'finished' && !tetrisState.gameOver){
      tetrisGameOver();
    }
  }
}

function tetrisVersusRenderHud(){
  const match = store.room && store.room.tetrisMatch;
  if(!match) return;
  const otherKey = tetrisOtherVersusKey();
  if(!otherKey) return;
  const name = otherKey === 'host' ? match.hostName : match.guestName;
  const avatar = otherKey === 'host' ? match.hostAvatar : match.guestAvatar;
  const score = (otherKey === 'host' ? match.hostScore : match.guestScore) || 0;
  const alive = otherKey === 'host' ? match.hostAlive : match.guestAlive;

  const nameEl = document.getElementById('tvhName');
  const avatarEl = document.getElementById('tvhAvatar');
  const scoreEl = document.getElementById('tvhScore');
  const statusEl = document.getElementById('tvhStatus');
  if(nameEl) nameEl.textContent = name || '파트너';
  if(avatarEl) avatarEl.textContent = avatar || '🐰';
  if(scoreEl) scoreEl.textContent = `${score.toLocaleString()}점`;
  if(statusEl){
    statusEl.textContent = alive === false ? '탈락' : '생존중';
    statusEl.classList.toggle('dead', alive === false);
  }
  tetrisVersusRenderOpponentBoard(match, otherKey);

  // 게임오버 화면에 표시할 승패 결과
  if(match.status === 'finished'){
    const roomInfo = store.getRoomInfo();
    const won = roomInfo && match.winnerId === roomInfo.myId;
    const resultEl = document.getElementById('tgcVsResult');
    if(resultEl){
      resultEl.style.display = 'block';
      resultEl.className = 'tgc-vs-result ' + (won ? 'win' : 'lose');
      resultEl.textContent = won ? '🎉 승리! 파트너보다 오래 버텼어요' : '😢 패배 — 다음엔 이길 수 있어요';
    }
  }
}

// 상대방 보드를 작은 캔버스에 그려줘요. 0.3초 간격 스냅샷이라 완전히 부드럽게
// 움직이진 않지만, "지금 상대가 어떤 상황인지" 충분히 보여요.
function tetrisVersusRenderOpponentBoard(match, otherKey){
  const canvas = document.getElementById('tvhBoardCanvas');
  if(!canvas) return;
  console.log('[tetris-render] otherKey=', otherKey, 'hasBoard=', !!match[`${otherKey}Board`], 'boardLen=', match[`${otherKey}Board`] && match[`${otherKey}Board`].length, 'pieceType=', match[`${otherKey}PieceType`]);
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / TETRIS_COLS; // 8px
  ctx.fillStyle = '#2b1f3d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const boardStr = match[`${otherKey}Board`];
  if(boardStr){
    for(let r=0; r<TETRIS_ROWS; r++){
      for(let c=0; c<TETRIS_COLS; c++){
        const v = boardStr[r*TETRIS_COLS + c];
        if(v && v !== '0'){
          ctx.fillStyle = TETRIS_COLORS[v] || '#888';
          ctx.fillRect(c*cell, r*cell, cell-0.5, cell-0.5);
        }
      }
    }
  }

  const pType = match[`${otherKey}PieceType`];
  if(pType && TETRIS_SHAPES[pType]){
    const rot = match[`${otherKey}PieceRot`] || 0;
    const px = match[`${otherKey}PieceX`] || 0;
    const py = match[`${otherKey}PieceY`] || 0;
    const shape = TETRIS_SHAPES[pType][rot];
    ctx.fillStyle = TETRIS_COLORS[pType];
    for(let r=0; r<shape.length; r++){
      for(let c=0; c<shape[r].length; c++){
        if(!shape[r][c]) continue;
        const y = py + r;
        if(y<0) continue;
        ctx.fillRect((px+c)*cell, y*cell, cell-0.5, cell-0.5);
      }
    }
  }
}

async function tetrisSaveScore(score){
  const roomInfo = store.getRoomInfo();
  const myId = roomInfo ? roomInfo.myId : 'me';
  const myName = store.profile.name || '나';
  const myAvatar = store.profile.avatar || '🐻';

  if(roomInfo && firebaseReady){
    try {
      const ref = db.collection('rooms').doc(roomInfo.code);
      const snap = await ref.get();
      if(snap.exists){
        const data = snap.data();
        const scores = data.tetrisScores || [];
        const existing = scores.find(s => s.memberId === myId);
        const updated = existing
          ? scores.map(s => s.memberId===myId ? { ...s, name:myName, avatar:myAvatar, best: Math.max(s.best, score), last: score, updatedAt: Date.now() } : s)
          : [...scores, { memberId: myId, name: myName, avatar: myAvatar, best: score, last: score, updatedAt: Date.now() }];
        await ref.update({ tetrisScores: updated });
      }
    } catch(e){ console.warn('테트리스 점수 저장 실패:', e); }
  } else {
    const best = Math.max(Number(localStorage.getItem('tetrisBestLocal') || 0), score);
    localStorage.setItem('tetrisBestLocal', String(best));
  }
  renderTetrisLeaderboard();
}

function renderTetrisLeaderboard(){
  const el = document.getElementById('tetrisLeaderboard');
  if(!el) return;
  const roomInfo = store.getRoomInfo();
  const connected = !!(roomInfo && store.room && getMemberList().length >= 2);
  const versusBtn = document.getElementById('tetrisVersusOpenBtn');
  if(versusBtn) versusBtn.style.display = connected ? 'block' : 'none';

  if(roomInfo && store.room && store.room.tetrisScores && store.room.tetrisScores.length){
    const sorted = [...store.room.tetrisScores].sort((a,b)=>b.best-a.best);
    el.innerHTML = sorted.map((s,i)=>`
      <div class="tetris-lb-row">
        <span class="tetris-lb-rank">${i+1}</span>
        <span class="tetris-lb-avatar">${s.avatar}</span>
        <span class="tetris-lb-name">${s.name}</span>
        <span class="tetris-lb-score">${s.best.toLocaleString()}</span>
      </div>`).join('');
  } else {
    const localBest = Number(localStorage.getItem('tetrisBestLocal') || 0);
    el.innerHTML = `<div class="empty-state">${localBest ? `내 최고점: ${localBest.toLocaleString()}점 (파트너와 연결하면 둘의 점수를 비교할 수 있어요)` : '아직 기록이 없어요. 게임을 시작해보세요!'}</div>`;
  }
}

function bindTetrisHoldRepeat(btnId, fn, delay=140){
  const btn = document.getElementById(btnId);
  if(!btn) return;
  let iv = null;
  const start = (e)=>{ e.preventDefault(); fn(); iv = setInterval(fn, delay); };
  const stop = ()=>{ if(iv){ clearInterval(iv); iv=null; } };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}
bindTetrisHoldRepeat('tetrisLeftBtn', ()=>tetrisMove(-1));
bindTetrisHoldRepeat('tetrisRightBtn', ()=>tetrisMove(1));
bindTetrisHoldRepeat('tetrisSoftDropBtn', ()=>tetrisSoftDrop(), 90);

document.getElementById('tetrisRotateBtn')?.addEventListener('click', tetrisRotate);
document.getElementById('tetrisHardDropBtn')?.addEventListener('click', tetrisHardDrop);
/* ── 게임 목록 ─────────────────────────────────────────────── */
document.getElementById('gameCardTetris')?.addEventListener('click', ()=>{
  document.getElementById('gameListScreen').style.display = 'none';
  document.getElementById('tetrisRoot').style.display = 'block';
  document.getElementById('tetrisStartScreen').style.display = 'block';
  document.getElementById('tetrisVersusLobby').style.display = 'none';
  document.getElementById('tetrisPlayScreen').style.display = 'none';
  renderTetrisLeaderboard();
});
document.getElementById('gameCardRummikub')?.addEventListener('click', ()=>{
  toast('루미큐브는 곧 추가될 예정이에요! 🀄');
});
document.getElementById('tetrisBackToListBtn')?.addEventListener('click', ()=>{
  document.getElementById('tetrisRoot').style.display = 'none';
  document.getElementById('gameListScreen').style.display = 'block';
});

document.getElementById('tetrisStartBtn')?.addEventListener('click', tetrisStart);
document.getElementById('tetrisRestartBtn')?.addEventListener('click', ()=>{
  const wasVersus = tetrisState && tetrisState.versus;
  if(wasVersus){
    // 대결은 다시 하려면 서로 초대/수락을 새로 해야 해서, 재시작 대신 로비로 보내요
    tetrisState = null;
    document.getElementById('tetrisPlayScreen').style.display = 'none';
    document.getElementById('tetrisVersusLobby').style.display = 'block';
    renderVersusLobby();
  } else {
    tetrisStart();
  }
});
document.getElementById('tetrisQuitBtn')?.addEventListener('click', tetrisQuit);
document.getElementById('tetrisBackBtn')?.addEventListener('click', tetrisQuit);
document.getElementById('tetrisPauseBtn')?.addEventListener('click', ()=>{
  if(!tetrisState) return;
  tetrisState.paused = !tetrisState.paused;
  const btn = document.getElementById('tetrisPauseBtn');
  if(btn) btn.textContent = tetrisState.paused ? '▶' : '⏸';
  if(tetrisState.paused){
    tetrisState.pauseStartedAt = performance.now(); // 정지한 시점 기록
  } else {
    // 쉰 시간만큼 기준 시각을 밀어서, 정지했던 시간은 "빨라지는 속도"에 안 들어가게 함
    if(tetrisState.pauseStartedAt) tetrisState.startTs += (performance.now() - tetrisState.pauseStartedAt);
    tetrisLastDrop = 0;
    tetrisLoopId = requestAnimationFrame(tetrisLoop);
  }
});

document.addEventListener('keydown', (e)=>{
  if(!tetrisState || tetrisState.paused || tetrisState.gameOver) return;
  if(!document.getElementById('tab-game')?.classList.contains('active')) return;
  if(e.key === 'ArrowLeft') tetrisMove(-1);
  else if(e.key === 'ArrowRight') tetrisMove(1);
  else if(e.key === 'ArrowDown') tetrisSoftDrop();
  else if(e.key === 'ArrowUp') tetrisRotate();
  else if(e.key === ' '){ e.preventDefault(); tetrisHardDrop(); }
});

renderTetrisLeaderboard();

function initApp(){
  const roomInfo = store.getRoomInfo();
  if(roomInfo){
    connectToRoomListener(roomInfo.code);
  } else {
    store.loadLocal();
    renderHome();
  }
  renderSettingsRoomStatus();
}
initApp();

/* ── 서비스워커 등록 ───────────────────────────────────────── */
// 🚧 개발 중엔 꺼둠: 이게 켜져 있으면 파일을 고쳐서 다시 올려도
// 브라우저가 예전 캐시본을 계속 보여줘서 테스트가 꼬여요.
// 앱이 어느 정도 완성돼서 실제로 배포할 준비가 되면, 아래 DEV_MODE를
// false로 바꾸세요 (그래야 오프라인 지원 + 빠른 로딩 기능이 켜져요).
const DEV_MODE = true;

if(DEV_MODE && 'serviceWorker' in navigator){
  // 이미 등록된 서비스워커가 있다면(예전 테스트 때) 지금 해제하고,
  // 남아있는 캐시도 다 지워서 항상 최신 파일만 보게 해요.
  navigator.serviceWorker.getRegistrations().then(regs=>{
    regs.forEach(r => r.unregister());
  });
  if('caches' in window){
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
} else if(!DEV_MODE && 'serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
