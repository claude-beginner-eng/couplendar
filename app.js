/* ============================================================
   우리 캘린더 - 앱 로직 (Firebase 연동 버전)
   ------------------------------------------------------------
   저장 방식:
   - 혼자 모드: localStorage (이 폰 안에서만)
   - 연결 모드(초대코드로 연결된 후): Firestore (파트너와 실시간 공유)
   ============================================================ */

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const LOCAL_KEY = 'coupleCalendarData';
const ROOM_KEY  = 'coupleCalendarRoom'; // { code, myId }
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24시간

let roomUnsub = null; // Firestore 실시간 리스너 해제 함수

const store = {
  events: [],
  profile: { name: '나', avatar: '🐻' },
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
function formatCodeDisplay(code){
  return code.match(/.{1,4}/g).join('-');
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
  setTimeout(() => toastEl.classList.remove('show'), 1800);
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
  const todays = store.events.filter(e => e.date === today).sort((a,b)=>a.time.localeCompare(b.time));
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
  bindDeleteButtons(selList);
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

saveBtn.addEventListener('click', async ()=>{
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
  await store.save();

  titleInput.value = '';
  document.getElementById('memoInput').value = '';
  saveBtn.classList.remove('ready');

  toast('일정을 저장했어요 🎉');
  showTab('home');
});

/* ── 설정 탭: 프로필 ───────────────────────────────────────── */
document.getElementById('myName').value = store.profile.name;
document.getElementById('myName').addEventListener('input', (e)=>{
  store.profile.name = e.target.value;
  store.saveLocal(); // 이름은 항상 로컬에도 저장 (다음 방 생성/연결 시 사용)
});

/* ── 설정 탭: 파트너 연결(초대코드) ───────────────────────── */
const inviteBtn   = document.getElementById('inviteBtn');
const roomPanel   = document.getElementById('roomPanel');
const roomStatusText = document.getElementById('roomStatusText');
const inviteCard  = document.getElementById('inviteCard');

function renderSettingsRoomStatus(){
  const roomInfo = store.getRoomInfo();
  if(roomInfo && store.room){
    const members = store.room.members || [];
    const names = members.map(m => m.name).join(', ');
    roomStatusText.innerHTML = `🎉 <b>연결됨</b> — 함께 쓰는 중: ${names}`;
    inviteBtn.textContent = '연결 해제하기';
    inviteBtn.onclick = leaveRoom;
    roomPanel.style.display = 'none';
  } else {
    roomStatusText.textContent = '아직 혼자 쓰는 중이에요. 파트너를 초대하면 그 순간부터 함께 쓰는 모드가 열려요.';
    inviteBtn.textContent = '파트너 초대하기';
    inviteBtn.onclick = () => { roomPanel.style.display = roomPanel.style.display === 'none' ? 'block' : 'none'; };
  }
}

function leaveRoom(){
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
async function createRoom(password){
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
        members: [{ id: myId, name: store.profile.name, avatar: store.profile.avatar }],
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

document.getElementById('createRoomBtn').addEventListener('click', async ()=>{
  const pwInput = document.getElementById('roomPwInput');
  const pw = pwInput.value.trim();
  const btn = document.getElementById('createRoomBtn');
  if(pw.length !== 6){ toast('비밀번호 6자리를 입력해주세요'); return; }

  btn.disabled = true; btn.textContent = '코드 발급 중...';
  try {
    const { code, myId } = await createRoom(pw);
    store.setRoomInfo({ code, myId });
    document.getElementById('roomCode').textContent = formatCodeDisplay(code);
    document.getElementById('roomCodeBox').style.display = 'block';
    toast('코드가 발급됐어요! 이 코드+비밀번호를 파트너에게 전달해주세요');
    connectToRoomListener(code);
  } catch(e){
    toast(e.message || '코드 발급에 실패했어요');
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = '코드 발급하고 공유하기';
  }
});

// 코드 입력하기(join)
let joinAttempts = 0;
document.getElementById('joinRoomBtn').addEventListener('click', async ()=>{
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
    const newMembers = [...(data.members || []), { id: myId, name: store.profile.name, avatar: store.profile.avatar }];
    await ref.update({ members: newMembers });

    store.setRoomInfo({ code, myId });
    toast('연결됐어요! 🎉');
    connectToRoomListener(code);
    roomPanel.style.display = 'none';
  } catch(e){
    errEl.textContent = '연결 중 문제가 발생했어요. 인터넷 연결을 확인해주세요';
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = '연결하기';
  }
});

/* ── Firestore 실시간 동기화 ───────────────────────────────── */
function connectToRoomListener(code){
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
  }, err=>{
    console.warn('실시간 동기화 오류:', err);
    toast('실시간 동기화 중 문제가 발생했어요');
  });
}

/* ── 초기화 ────────────────────────────────────────────────── */
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
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
