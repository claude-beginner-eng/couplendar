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

const CATS = [
  { key:'date',  label:'데이트', color:'#ff6b9d' },
  { key:'anniv', label:'기념일', color:'#9b6bff' },
  { key:'appt',  label:'약속',   color:'#38bdf8' },
  { key:'trip',  label:'여행',   color:'#2dd4bf' },
];
const ICONS = ['🍰','✈️','💜','📌','🎂','🎉','🍜','📞','🎬','☕','🎁','🏖️'];
const AVATAR_ICONS = ['🐻','🐰','🐱','🐶','🦊','🐼','🦁','🐨','🐯','🐥','🦄','🐧'];

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

/* ── 탭 전환 ───────────────────────────────────────────────── */
const tabs = document.querySelectorAll('.tab');
const tabBtns = document.querySelectorAll('.tabbtn');
function showTab(name){
  tabs.forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if(name === 'calendar') renderCalendar();
  if(name === 'home') renderHome();
  if(name === 'add') buildWhoRow(); // 멤버가 바뀌었을 수 있으니 등록 탭 들어갈 때마다 갱신
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
        <div class="icon-chip" style="background:${ev.catColor}">${ev.icon}</div>
        ${avatarGroupHTML(ev.who)}
      </div>
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

function calAvatarDotsHTML(evs){
  const members = getMemberList();
  const shown = evs.slice(0, 3).map(e=>{
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
    const dots = calAvatarDotsHTML(evs);
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
let addState = { icon: ICONS[0], cat: CATS[0], selectedWho: [] };

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

// 누구의 일정이에요? - 연결된 인원 수만큼 카드 생성, 탭으로 다중 선택.
// 혼자 모드(멤버 1명)면 고를 게 없으니 섹션 자체를 숨기고 자동으로 나로 확정.
const whoSection = document.getElementById('whoSection');
const whoRow = document.getElementById('whoRow');
function buildWhoRow(){
  const members = getMemberList();
  if(members.length <= 1){
    whoSection.style.display = 'none';
    addState.selectedWho = [members[0].id];
    return;
  }
  whoSection.style.display = 'flex';
  if(addState.selectedWho.length === 0){
    addState.selectedWho = members.map(m => m.id); // 기본값: 전체(=함께)
  }
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
    who: [...addState.selectedWho],
    date: document.getElementById('dateInput').value || todayStr(),
    time: document.getElementById('timeInput').value || '00:00',
    memo: document.getElementById('memoInput').value.trim(),
  });
  await store.save();

  titleInput.value = '';
  document.getElementById('memoInput').value = '';
  saveBtn.classList.remove('ready');
  addState.selectedWho = []; // 다음 등록 때 다시 기본값(전체 선택)으로
  buildWhoRow();

  toast('일정을 저장했어요 🎉');
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
