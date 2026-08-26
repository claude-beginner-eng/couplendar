/* ============================================================
   우리 캘린더 - 앱 로직
   ------------------------------------------------------------
   ✅ 데이터는 localStorage에 저장돼요. 새로고침하거나 앱을 껐다
   켜도 일정이 그대로 남아있어요. (이 브라우저 안에만 저장되는 거라,
   파트너 폰이랑 자동으로 공유되진 않아요 — 그건 다음 단계인
   Firebase 연동에서 해결할 부분이에요)
   ============================================================ */

const store = {
  events: [], // { id, title, icon, catKey, catColor, date:'YYYY-MM-DD', time:'HH:MM', memo }
  profile: { name: '나', avatar: '🐻' },

  load(){
    try {
      const saved = localStorage.getItem('coupleCalendarData');
      if(saved) Object.assign(this, JSON.parse(saved));
    } catch(e) {
      console.warn('저장된 데이터를 불러오지 못했어요:', e);
    }
  },
  save(){
    try {
      localStorage.setItem('coupleCalendarData', JSON.stringify({
        events: this.events,
        profile: this.profile
      }));
    } catch(e) {
      console.warn('데이터를 저장하지 못했어요:', e);
    }
  }
};
store.load();

const CATS = [
  { key:'date',  label:'데이트', color:'#ff6b9d' },
  { key:'anniv', label:'기념일', color:'#9b6bff' },
  { key:'appt',  label:'약속',   color:'#38bdf8' },
  { key:'trip',  label:'여행',   color:'#2dd4bf' },
];
const ICONS = ['🍰','✈️','💜','📌','🎂','🎉','🍜','📞','🎬','☕','🎁','🏖️'];

function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtDateLabel(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/* ── 탭 전환 ───────────────────────────────────────────────── */
const tabs = document.querySelectorAll('.tab');
const tabBtns = document.querySelectorAll('.tabbtn');
function showTab(name){
  tabs.forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if(name === 'calendar') renderCalendar();
  if(name === 'home') renderHome();
}
tabBtns.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ── 토스트 ────────────────────────────────────────────────── */
const toastEl = document.getElementById('toast');
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ── 홈 탭 ─────────────────────────────────────────────────── */
function eventRowHTML(ev){
  return `
    <div class="event-item">
      <div class="icon-chip" style="background:${ev.catColor}">${ev.icon}</div>
      <div class="etxt">
        <div class="etitle">${ev.title}</div>
        <div class="emeta">${fmtDateLabel(ev.date)} · ${ev.time}</div>
      </div>
      <button class="edel" data-id="${ev.id}">✕</button>
    </div>`;
}

function renderHome(){
  const now = new Date();
  document.getElementById('todayLabel').textContent =
    `${now.getMonth()+1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`;
  document.getElementById('homeDate').textContent = `${now.getMonth()+1}월 ${now.getDate()}일`;
  document.getElementById('homeCount').textContent = `등록된 일정 ${store.events.length}개`;

  const today = todayStr();
  const todays = store.events.filter(e => e.date === today).sort((a,b)=>a.time.localeCompare(b.time));
  const upcoming = store.events.filter(e => e.date > today).sort((a,b)=> a.date===b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)).slice(0,5);

  const todayList = document.getElementById('todayList');
  const upcomingList = document.getElementById('upcomingList');
  todayList.innerHTML = todays.length ? todays.map(eventRowHTML).join('') : `<div class="empty-state">오늘은 등록된 일정이 없어요 🌿</div>`;
  upcomingList.innerHTML = upcoming.length ? upcoming.map(eventRowHTML).join('') : `<div class="empty-state">다가오는 일정이 없어요</div>`;

  document.querySelectorAll('.edel').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      store.events = store.events.filter(e => e.id !== btn.dataset.id);
      store.save();
      renderHome();
      toast('일정을 삭제했어요');
    });
  });
}

/* ── 캘린더 탭 ─────────────────────────────────────────────── */
let calYear, calMonth, calSelectedDate;
(function initCalDate(){
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth(); // 0-indexed
  calSelectedDate = todayStr();
})();

const dowNames = ['일','월','화','수','목','금','토'];

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
  store.events.forEach(e=>{ (eventsByDate[e.date] ||= []).push(e); });

  for(let i=0; i<firstDay; i++){
    const c = document.createElement('div'); c.className='cal-cell other';
    c.innerHTML = `<span class="dnum">${prevDays-firstDay+1+i}</span>`;
    grid.appendChild(c);
  }
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${calYear}-${pad(calMonth+1)}-${pad(d)}`;
    const c = document.createElement('div');
    c.className = 'cal-cell' + (dateStr===today?' today':'') + (dateStr===calSelectedDate?' selected':'');
    const evs = eventsByDate[dateStr] || [];
    const dots = evs.slice(0,3).map(e=>`<span class="dot" style="background:${e.catColor}"></span>`).join('');
    c.innerHTML = `<span class="dnum">${d}</span><div class="dots">${dots}</div>`;
    c.addEventListener('click', ()=>{ calSelectedDate = dateStr; renderCalendar(); });
    grid.appendChild(c);
  }

  document.getElementById('calSelLabel').textContent = `${fmtDateLabel(calSelectedDate)} 일정`;
  const selEvents = (eventsByDate[calSelectedDate] || []).sort((a,b)=>a.time.localeCompare(b.time));
  const selList = document.getElementById('calSelList');
  selList.innerHTML = selEvents.length ? selEvents.map(eventRowHTML).join('') : `<div class="empty-state">이 날짜엔 일정이 없어요</div>`;
  selList.querySelectorAll('.edel').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      store.events = store.events.filter(e => e.id !== btn.dataset.id);
      store.save();
      renderCalendar();
      toast('일정을 삭제했어요');
    });
  });
}

document.getElementById('prevMonth').addEventListener('click', ()=>{
  calMonth--; if(calMonth<0){ calMonth=11; calYear--; } renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', ()=>{
  calMonth++; if(calMonth>11){ calMonth=0; calYear++; } renderCalendar();
});

/* ── 일정 등록 탭 ──────────────────────────────────────────── */
let addState = { icon: ICONS[0], cat: CATS[0] };

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
CATS.forEach((c,i)=>{
  const el = document.createElement('div');
  el.className = 'cat-chip' + (i===0?' active':'');
  el.style.setProperty('--cc', c.color);
  el.innerHTML = `<div class="dot" style="background:${c.color}"></div><span>${c.label}</span>`;
  el.addEventListener('click', ()=>{
    catRow.querySelectorAll('.cat-chip').forEach(x=>x.classList.remove('active'));
    el.classList.add('active');
    addState.cat = c;
  });
  catRow.appendChild(el);
});

document.getElementById('dateInput').value = todayStr();

const titleInput = document.getElementById('titleInput');
const saveBtn = document.getElementById('saveBtn');
titleInput.addEventListener('input', ()=>{
  saveBtn.classList.toggle('ready', titleInput.value.trim().length > 0);
});

saveBtn.addEventListener('click', ()=>{
  const title = titleInput.value.trim();
  if(!title) return;
  store.events.push({
    id: 'ev_' + Date.now(),
    title,
    icon: addState.icon,
    catKey: addState.cat.key,
    catColor: addState.cat.color,
    date: document.getElementById('dateInput').value || todayStr(),
    time: document.getElementById('timeInput').value || '00:00',
    memo: document.getElementById('memoInput').value.trim(),
  });
  store.save();

  // 입력값 초기화
  titleInput.value = '';
  document.getElementById('memoInput').value = '';
  saveBtn.classList.remove('ready');

  toast('일정을 저장했어요 🎉');
  showTab('home');
});

/* ── 설정 탭 ───────────────────────────────────────────────── */
document.getElementById('myName').value = store.profile.name;
document.getElementById('myName').addEventListener('input', (e)=>{
  store.profile.name = e.target.value;
  store.save();
});
document.getElementById('inviteBtn').addEventListener('click', ()=>{
  toast('다음 단계에서 초대 코드 화면을 연결할 거예요');
});

/* ── 초기 렌더 ─────────────────────────────────────────────── */
renderHome();

/* ── 서비스워커 등록 (오프라인 지원 + 홈화면 설치) ───────────── */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{
      // 서비스워커 등록이 막힌 환경(일부 미리보기 등)에서는 조용히 무시
    });
  });
}
