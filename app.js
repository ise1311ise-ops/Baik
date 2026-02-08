/*
  app.js — Битва районов • Байконур (MVP)
  - Без сервера: данные хранятся в localStorage + (опционально) Telegram CloudStorage.
  - Встроенные мини-режимы: Патруль (тап), Викторина, Чек-ин (гео).
  - Экран "Сезон" — демо-таблица: красиво, но НЕ агрегирует всех игроков без сервера.
*/

const DISTRICTS = [
  { id: "mkr5",  name: "5-й мкр",  icon: "./assets/mkr5.svg" },
  { id: "mkr5a", name: "5а мкр",   icon: "./assets/mkr5a.svg" },
  { id: "mkr6",  name: "6-й мкр",  icon: "./assets/mkr6.svg" },
  { id: "mkr6a", name: "6а мкр",   icon: "./assets/mkr6a.svg" },
  { id: "mkr7",  name: "7-й мкр",  icon: "./assets/mkr7.svg" },
  { id: "mkr7a", name: "7а мкр",   icon: "./assets/mkr7a.svg" },
  { id: "pad9",  name: "9-я площадка", icon: "./assets/pad9.svg" },
  { id: "prom",  name: "Промрайон", icon: "./assets/prom.svg" },
];

const STORAGE_KEY = "bbk_state_v1";
const DAY_KEY = "bbk_day_v1";
const MAX_ENERGY = 12;

function $(id){ return document.getElementById(id); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function nowDayStamp(){
  // Using local date; keep simple for MVP.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function seededRand(seedStr){
  // xmur3 + mulberry32
  function xmur3(str){
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function(){
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    }
  }
  function mulberry32(a){
    return function(){
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  }
  const seed = xmur3(seedStr)();
  return mulberry32(seed);
}

function toast(msg, ms=1800){
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, ms);
}

function defaultState(){
  return {
    version: 1,
    districtId: null,
    scoreTotal: 0,
    scoreToday: 0,
    streak: 0,
    energy: MAX_ENERGY,
    lastDay: null,
    patrolBest: 0,
    quizBest: 0,
    checkinDoneDay: null,
    user: null,
  };
}

let state = defaultState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw){
      state = { ...defaultState(), ...JSON.parse(raw) };
    }
  }catch(e){ state = defaultState(); }
}

async function syncFromCloud(){
  if (!window.TG || !TG.isTelegram()) return;
  const values = await TG.cloudGet(["bbk_state"]);
  if (values && values.bbk_state){
    try{
      const cloudState = JSON.parse(values.bbk_state);
      // Keep most progressed one by total score (naive merge).
      if ((cloudState.scoreTotal || 0) > (state.scoreTotal || 0)){
        state = { ...defaultState(), ...cloudState };
        saveState(false);
      }
    }catch(e){}
  }
}

async function syncToCloud(){
  if (!window.TG || !TG.isTelegram()) return;
  try{
    await TG.cloudSet({ "bbk_state": JSON.stringify(state) });
  }catch(e){}
}

function saveState(sync=true){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (sync) syncToCloud();
}

function districtById(id){
  return DISTRICTS.find(d=>d.id===id) || null;
}

function ensureDailyReset(){
  const day = nowDayStamp();
  if (state.lastDay !== day){
    // update streak
    if (state.lastDay){
      const prev = new Date(state.lastDay);
      const cur = new Date(day);
      const diffDays = Math.round((cur - prev)/(1000*60*60*24));
      if (diffDays === 1) state.streak = (state.streak || 0) + 1;
      else state.streak = 0;
    } else {
      state.streak = 0;
    }

    state.lastDay = day;
    state.scoreToday = 0;
    state.energy = clamp((state.energy || 0) + 6, 0, MAX_ENERGY);
    state.checkinDoneDay = null;
    saveState();
  }
}

function setScreen(which){
  const ids = ["screenOnboarding","screenHome","screenPatrol","screenQuiz","screenSeason","screenSettings"];
  ids.forEach(id => $(id).hidden = (id !== which));
}

function renderOnboarding(){
  const grid = $("districtGrid");
  grid.innerHTML = "";

  let selected = state.districtId;

  DISTRICTS.forEach(d=>{
    const btn = document.createElement("button");
    btn.className = "district";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(selected === d.id));
    btn.innerHTML = `
      <img src="${d.icon}" alt="${d.name}">
      <div>
        <div class="district__name">${d.name}</div>
        <div class="district__meta">Старт: +0 • цель: топ‑1</div>
      </div>
    `;
    btn.addEventListener("click", ()=>{
      selected = d.id;
      [...grid.children].forEach(c=>c.setAttribute("aria-pressed","false"));
      btn.setAttribute("aria-pressed","true");
      $("btnStart").disabled = false;
      state.districtId = selected;
      // do not save yet; user will confirm Start
      TG && TG.haptic("light");
    });
    grid.appendChild(btn);
  });

  $("btnStart").disabled = !state.districtId;
}

function renderHome(){
  const d = districtById(state.districtId);
  $("myDistrictName").textContent = d ? d.name : "—";
  $("myScore").textContent = String(state.scoreTotal || 0);
  $("todayPoints").textContent = String(state.scoreToday || 0);
  $("streak").textContent = String(state.streak || 0);
  $("energy").textContent = String(state.energy || 0);
  $("settingsDistrict").textContent = d ? d.name : "—";

  // Update Telegram status text
  if (window.TG && TG.isTelegram()){
    const u = TG.getUser();
    const who = u ? `${u.first_name || ""}${u.last_name ? " "+u.last_name : ""}`.trim() : "пользователь";
    $("tgStatus").textContent = `Открыто в Telegram (${who})`;
  } else {
    $("tgStatus").textContent = "Открыто в браузере (не Telegram)";
  }
}

function awardPoints(points, reason){
  points = Math.max(0, Math.round(points));
  state.scoreTotal = (state.scoreTotal || 0) + points;
  state.scoreToday = (state.scoreToday || 0) + points;
  saveState();
  renderHome();
  toast(`+${points} очков • ${reason}`);
  TG && TG.haptic("success");
}

function spendEnergy(cost){
  cost = Math.max(0, Math.round(cost));
  if ((state.energy || 0) < cost) return false;
  state.energy -= cost;
  saveState();
  renderHome();
  return true;
}

/* ---------- Patrol (tap) ---------- */
let patrolRunning = false;
let patrolTimer = null;
let patrolTick = null;

function patrolResetUI(){
  $("patrolTime").textContent = "30";
  $("patrolScore").textContent = "0";
  $("patrolCombo").textContent = "x1";
  const arena = $("arena");
  arena.querySelectorAll(".target").forEach(t=>t.remove());
}

function patrolStart(){
  if (patrolRunning) return;
  if (!spendEnergy(2)){
    toast("Не хватает энергии. Зайди завтра или дождись пополнения.");
    TG && TG.haptic("error");
    return;
  }

  patrolRunning = true;
  patrolResetUI();

  const arena = $("arena");
  const rnd = seededRand(nowDayStamp() + "|" + (state.districtId || "none") + "|patrol");

  let t = 30;
  let score = 0;
  let combo = 1;
  let lastHit = 0;

  const spawn = ()=>{
    const w = arena.clientWidth;
    const h = arena.clientHeight;
    const x = Math.floor(12 + rnd() * (w - 80));
    const y = Math.floor(60 + rnd() * (h - 90));
    const good = rnd() > 0.22;

    const el = document.createElement("div");
    el.className = "target " + (good ? "good":"bad");
    el.style.left = x + "px";
    el.style.top = y + "px";

    const born = performance.now();
    const ttl = good ? 900 : 750;

    const kill = ()=>{ if (el.isConnected) el.remove(); };

    el.addEventListener("pointerdown", (e)=>{
      e.preventDefault();
      const now = performance.now();
      const fast = (now - lastHit) < 420;
      lastHit = now;

      if (good){
        combo = clamp(combo + (fast ? 1 : 0), 1, 10);
        const gain = 6 + combo;
        score += gain;
        TG && TG.haptic("light");
      } else {
        combo = 1;
        score = Math.max(0, score - 10);
        TG && TG.haptic("error");
      }
      $("patrolScore").textContent = String(score);
      $("patrolCombo").textContent = "x" + String(combo);
      kill();
    }, {passive:false});

    arena.appendChild(el);
    setTimeout(kill, ttl);
  };

  // spawn loop
  patrolTick = setInterval(()=>{
    if (!patrolRunning) return;
    // dynamic spawn rate
    spawn();
    if (Math.random() < 0.45) spawn();
  }, 430);

  patrolTimer = setInterval(()=>{
    t -= 1;
    $("patrolTime").textContent = String(t);
    if (t <= 0){
      patrolStop(score);
    }
  }, 1000);

  toast("Патруль начался! Жми по целям.");
}

function patrolStop(score){
  if (!patrolRunning) return;
  patrolRunning = false;
  clearInterval(patrolTimer); patrolTimer = null;
  clearInterval(patrolTick); patrolTick = null;

  // payout with cap
  const points = clamp(score, 0, 120);
  state.patrolBest = Math.max(state.patrolBest || 0, points);
  saveState();

  // Clear remaining targets
  $("arena").querySelectorAll(".target").forEach(t=>t.remove());

  awardPoints(points, "Патруль района");
  toast(`Патруль завершён: ${points} очков`, 2200);
}

/* ---------- Quiz ---------- */
const QUIZ_BANK = [
  { q: "Как называется место запусков ракет рядом с городом?", a: ["Космодром Байконур","Космодром Восточный","Куру","Плесецк"], correct: 0 },
  { q: "Первый полёт человека в космос связан с именем…", a: ["Юрий Гагарин","Нил Армстронг","Сергей Королёв","Валентина Терешкова"], correct: 0 },
  { q: "Что такое «апогей» орбиты?", a: ["Самая дальняя точка от Земли","Самая близкая точка к Земле","Скорость вращения","Наклон орбиты"], correct: 0 },
  { q: "Как называется устройство, которое возвращает экипаж на Землю?", a: ["Спускаемый аппарат","Блок питания","Стабилизатор","Антенна"], correct: 0 },
  { q: "Какой газ чаще всего используют в скафандрах для дыхания (в смеси)?", a: ["Кислород","Азот","Углекислый газ","Аргон"], correct: 0 },
  { q: "Что такое «ступень ракеты»?", a: ["Отделяемая часть с двигателем и топливом","Кабина пилота","Радиатор охлаждения","Топливный бак самолёта"], correct: 0 },
  { q: "Как называется вращение Земли вокруг своей оси?", a: ["Сутки","Год","Эклиптика","Прецессия"], correct: 0 },
  { q: "Космонавты на орбите испытывают состояние…", a: ["Невесомости","Повышенной гравитации","Трения","Грозы"], correct: 0 },
  { q: "Как называется линия, разделяющая день и ночь на Земле?", a: ["Терминатор","Экватор","Меридиан","Полюс"], correct: 0 },
  { q: "Что чаще всего делают перед стартом ракеты?", a: ["Проверяют системы и проводят отсчёт","Меняют погоду","Снимают крылья","Выключают связь"], correct: 0 },
];

let quizSession = null;

function quizNewSession(){
  const rnd = seededRand(nowDayStamp() + "|quiz|" + (state.districtId||"none"));
  const picks = [];
  const used = new Set();
  while (picks.length < 5){
    const idx = Math.floor(rnd() * QUIZ_BANK.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(QUIZ_BANK[idx]);
  }
  return {
    step: 0,
    picks,
    correct: 0,
    answered: false,
    earned: 0,
  };
}

function renderQuiz(){
  const s = quizSession;
  const item = s.picks[s.step];
  $("quizStep").textContent = String(s.step + 1);
  $("quizQ").textContent = item.q;

  const answers = $("quizAnswers");
  answers.innerHTML = "";
  $("btnQuizNext").disabled = true;
  $("quizHint").textContent = "Выбери вариант ответа.";

  item.a.forEach((txt, i)=>{
    const b = document.createElement("button");
    b.className = "answer";
    b.type = "button";
    b.textContent = txt;
    b.addEventListener("click", ()=>{
      if (s.answered) return;
      s.answered = true;
      const ok = (i === item.correct);
      if (ok){
        s.correct += 1;
        s.earned += 22;
        b.classList.add("good");
        $("quizHint").textContent = "Верно!";
        TG && TG.haptic("success");
      } else {
        b.classList.add("bad");
        // show correct answer
        [...answers.children][item.correct].classList.add("good");
        $("quizHint").textContent = "Неверно.";
        TG && TG.haptic("error");
      }
      $("btnQuizNext").disabled = false;
    });
    answers.appendChild(b);
  });
}

function quizStart(){
  if (!spendEnergy(2)){
    toast("Не хватает энергии.");
    TG && TG.haptic("error");
    return;
  }
  quizSession = quizNewSession();
  setScreen("screenQuiz");
  renderQuiz();
}

function quizNext(){
  const s = quizSession;
  if (!s) return;
  if (!s.answered) return;
  s.step += 1;
  s.answered = false;

  if (s.step >= s.picks.length){
    // bonus for perfect run
    let bonus = 0;
    if (s.correct === 5) bonus = 40;
    if (s.correct === 4) bonus = 18;

    const total = clamp(s.earned + bonus, 0, 150);
    state.quizBest = Math.max(state.quizBest || 0, total);
    saveState();

    setScreen("screenHome");
    awardPoints(total, "Космо‑викторина");
    toast(`Викторина: ${s.correct}/5 • +${total}`, 2400);
    quizSession = null;
    return;
  }
  renderQuiz();
}

/* ---------- Check-in (geo) ---------- */
function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = (d)=> d*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

async function doCheckin(){
  const day = nowDayStamp();
  if (state.checkinDoneDay === day){
    toast("Чек‑ин уже сделан сегодня.");
    return;
  }
  if (!spendEnergy(1)){
    toast("Не хватает энергии.");
    return;
  }

  if (!navigator.geolocation){
    toast("Геолокация недоступна в этом браузере.");
    return;
  }

  toast("Запрашиваю геолокацию…", 1400);

  navigator.geolocation.getCurrentPosition((pos)=>{
    const { latitude, longitude } = pos.coords;

    // Координаты Байконура (примерно). 
    // Чек-ин: если в радиусе 25 км — бонус.
    const BAIKONUR = { lat: 45.6167, lon: 63.3167 };
    const dist = haversineKm(latitude, longitude, BAIKONUR.lat, BAIKONUR.lon);

    let pts = 30;
    let msg = "Чек‑ин";
    if (dist <= 25){
      pts = 80;
      msg = "Чек‑ин рядом с Байконуром";
    } else if (dist <= 120){
      pts = 55;
      msg = "Чек‑ин в регионе";
    } else {
      pts = 35;
      msg = "Чек‑ин (далеко от города)";
    }

    state.checkinDoneDay = day;
    saveState();
    awardPoints(pts, msg);
  }, (err)=>{
    toast("Не получилось получить гео: " + (err && err.message ? err.message : "ошибка"));
    TG && TG.haptic("error");
  }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 });
}

/* ---------- Season (demo table) ---------- */
function seasonDayNumber(){
  const start = new Date("2026-01-01T00:00:00");
  const now = new Date();
  return Math.max(1, Math.floor((now - start) / (1000*60*60*24)) + 1);
}

function renderSeason(){
  $("seasonDay").textContent = String(seasonDayNumber());

  const rnd = seededRand("season|" + nowDayStamp());
  const table = $("seasonTable");
  table.innerHTML = "";

  // Demo: base momentum per district + your personal contribution if same district.
  const rows = DISTRICTS.map(d=>{
    const base = Math.floor(1200 + rnd()*2200);
    const swing = Math.floor((rnd() - 0.5) * 600);
    const my = (d.id === state.districtId) ? (state.scoreToday || 0) : 0;
    const total = Math.max(0, base + swing + my);
    return { d, total };
  }).sort((a,b)=>b.total-a.total);

  rows.forEach((r, idx)=>{
    const el = document.createElement("div");
    el.className = "rowItem";
    el.innerHTML = `
      <div class="rowItem__rank">${idx+1}</div>
      <div class="rowItem__icon"><img src="${r.d.icon}" alt="${r.d.name}"></div>
      <div class="rowItem__name">${r.d.name}</div>
      <div class="rowItem__score">${r.total}</div>
    `;
    table.appendChild(el);
  });
}

function seasonBoost(){
  if (!spendEnergy(3)){
    toast("Нужна энергия (3).");
    TG && TG.haptic("error");
    return;
  }
  const rnd = seededRand(nowDayStamp() + "|boost|" + (state.districtId||"none") + "|" + (state.scoreToday||0));
  const pts = 40 + Math.floor(rnd()*41); // 40..80
  awardPoints(pts, "Супер‑вклад");
  renderSeason();
}

/* ---------- Settings ---------- */
function resetAll(){
  if (!confirm("Точно сбросить прогресс?")) return;
  state = defaultState();
  saveState();
  startApp();
  toast("Прогресс сброшен.");
}

function changeDistrict(){
  if (!confirm("Сменить район? Это обнулит твой личный вклад и серию.")) return;
  state = defaultState();
  saveState();
  startApp();
}

/* ---------- App bootstrap ---------- */
async function startApp(){
  loadState();
  ensureDailyReset();

  // Telegram init
  if (window.TG){
    TG.ready();
    // Pull Telegram user (optional)
    const u = TG.getUser();
    if (u){
      state.user = {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.username
      };
      saveState(false);
    }
    // Try theme on launch
    TG.applyTheme();
  }

  await syncFromCloud();
  ensureDailyReset();

  if (!state.districtId){
    setScreen("screenOnboarding");
    renderOnboarding();
  } else {
    setScreen("screenHome");
    renderHome();
  }
}

function bindUI(){
  $("btnSettings").addEventListener("click", ()=>{
    setScreen("screenSettings");
    renderHome();
  });

  $("btnTheme").addEventListener("click", ()=>{
    const ok = TG && TG.applyTheme();
    toast(ok ? "Тема подстроена под Telegram" : "Тема доступна только в Telegram");
  });

  $("btnStart").addEventListener("click", ()=>{
    if (!state.districtId) return;
    // Start confirmed: reset progress with chosen district
    const keep = state.districtId;
    state = defaultState();
    state.districtId = keep;
    state.lastDay = nowDayStamp();
    state.energy = MAX_ENERGY;
    saveState();
    setScreen("screenHome");
    renderHome();
    toast("Добро пожаловать в сезон!");
  });

  $("btnPatrol").addEventListener("click", ()=>{
    setScreen("screenPatrol");
    patrolResetUI();
  });
  $("btnPatrolExit").addEventListener("click", ()=>{
    if (patrolRunning) patrolStop(parseInt($("patrolScore").textContent || "0", 10));
    setScreen("screenHome");
    renderHome();
  });
  $("btnPatrolStart").addEventListener("click", patrolStart);

  $("btnQuiz").addEventListener("click", quizStart);
  $("btnQuizExit").addEventListener("click", ()=>{
    quizSession = null;
    setScreen("screenHome");
    renderHome();
  });
  $("btnQuizNext").addEventListener("click", quizNext);

  $("btnCheckin").addEventListener("click", doCheckin);

  $("btnSeason").addEventListener("click", ()=>{
    setScreen("screenSeason");
    renderSeason();
  });
  $("btnSeasonBack").addEventListener("click", ()=>{
    setScreen("screenHome");
    renderHome();
  });
  $("btnSeasonBoost").addEventListener("click", seasonBoost);

  $("btnShare").addEventListener("click", ()=>{
    const d = districtById(state.districtId);
    const txt = `Я за район ${d ? d.name : "Байконура"} набрал(а) ${state.scoreTotal || 0} очков. Заходи в «Битву районов»!`;
    if (window.TG) TG.share(txt);
    else {
      navigator.clipboard?.writeText(txt).catch(()=>{});
      toast("Текст для шаринга скопирован.");
    }
  });

  $("btnSettingsBack").addEventListener("click", ()=>{
    setScreen("screenHome");
    renderHome();
  });

  $("btnReset").addEventListener("click", resetAll);
  $("btnChangeDistrict").addEventListener("click", changeDistrict);
}

// Boot
bindUI();
startApp();
