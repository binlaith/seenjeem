"use strict";

const TIERS = [200, 200, 400, 400, 600, 600];   // ست خلايا لكل فئة
const PICK = 6;
const PHASE_TIME = [60, 30];
const K_USER = "sj.user";
const K_BANK = "sj.bank.";
const K_ROUND = "sj.round.";
const K_SOUND = "sj.sound";

const state = {
  user: "",
  bank: {},          // { catId: { "3": true, ... } } — أسئلة استخدمها هذا اللاعب
  picked: [],
  catFilter: "all",  // تصفية بطاقات الاختيار: all | general | kids
  teams: [
    { name: "فريق سين", score: 0, helps: { friend: true, two: true, dbl: true }, dbl: false, twoActive: false },
    { name: "فريق جيم", score: 0, helps: { friend: true, two: true, dbl: true }, dbl: false, twoActive: false },
  ],
  turn: 0,
  played: 0,
  roundUsed: {},     // { "catId:slot": { winner: 0|1|null, value, points } } — خلايا الجولة
  active: null,      // { catId, slot, idx, q, tier, helps: [] }
  phase: 0,
  left: 60,
  phaseMax: 60,
  timer: null,
  lastTickSec: null,
  sound: true,
};

const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const catById = (id) => CATEGORIES.find((c) => c.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- تخزين اللاعب ---------- */
function loadBank(user) {
  try {
    const v = JSON.parse(localStorage.getItem(K_BANK + user) || "{}");
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (_) { return {}; }
}
function saveBank() {
  try { localStorage.setItem(K_BANK + state.user, JSON.stringify(state.bank)); } catch (_) {}
}
function usedIn(catId) { return Object.keys(state.bank[catId] || {}).length; }
function isUsed(catId, idx) { return !!(state.bank[catId] && state.bank[catId][idx]); }

function tierPool(catId, tier) {
  const cat = catById(catId);
  if (!cat) return [];
  return cat.questions
    .map((q, i) => ({ q, i }))
    .filter((x) => x.q.d === tier && !isUsed(catId, x.i));
}
function catLeft(catId) {
  const cat = catById(catId);
  if (!cat) return 0;
  return cat.questions.length - usedIn(catId);
}
function bankTotal() { return CATEGORIES.reduce((n, c) => n + c.questions.length, 0); }
function bankUsed() { return CATEGORIES.reduce((n, c) => n + usedIn(c.id), 0); }

/* ---------- حفظ الجولة ---------- */
function saveRound() {
  if (!state.user) return;
  try {
    localStorage.setItem(K_ROUND + state.user, JSON.stringify({
      activeRound: true,
      picked: state.picked,
      teams: state.teams,
      turn: state.turn,
      played: state.played,
      roundUsed: state.roundUsed,
      savedAt: Date.now(),
    }));
  } catch (_) {}
}
function loadRound(user) {
  try {
    const raw = localStorage.getItem(K_ROUND + user);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return null;
    if (d.activeRound !== true) return null;
    if (!Array.isArray(d.picked) || d.picked.length !== PICK) return null;
    if (typeof d.played !== "number" || !(d.played >= 0) || d.played >= PICK * 6) return null;
    return d;
  } catch (_) { return null; }
}
function clearRound(user) {
  const name = user || state.user;
  if (!name) return;
  try { localStorage.removeItem(K_ROUND + name); } catch (_) {}
}

/* ---------- نتيجة الخلية في الجولة ---------- */
/* كل خلية ملعوبة تحمل { winner: 0 | 1 | null, value, points } — والقيمة القديمة true تعني «لم يجب أحد» */
const tierFromKey = (key) => TIERS[Number(String(key).split(":")[1])] || 0;

function normResult(v, key) {
  if (!v) return null;
  if (v === true) return { winner: null, value: tierFromKey(key), points: 0 };
  if (typeof v === "object") {
    const w = (v.winner === 0 || v.winner === 1) ? v.winner : null;
    const value = Number(v.value) || tierFromKey(key);
    const points = Number(v.points) || 0;
    return { winner: w, value, points };
  }
  return null;
}

function roundResult(key) { return normResult(state.roundUsed[key], key); }

function normTeam(t, i) {
  const fallback = i === 0 ? "فريق سين" : "فريق جيم";
  const helps = (t && t.helps) || {};
  return {
    name: (t && typeof t.name === "string" && t.name.trim()) ? t.name.trim().slice(0, 18) : fallback,
    score: Number(t && t.score) || 0,
    helps: { friend: helps.friend !== false, two: helps.two !== false, dbl: helps.dbl !== false },
    dbl: !!(t && t.dbl),
    twoActive: false,
  };
}

/* ---------- الصوت ---------- */
let audio = null;
function loadSound() {
  try {
    const v = localStorage.getItem(K_SOUND);
    if (v === "0" || v === "1") state.sound = v === "1";
  } catch (_) {}
}
function saveSound() {
  try { localStorage.setItem(K_SOUND, state.sound ? "1" : "0"); } catch (_) {}
}
function beep(freq, dur = .1, gain = .04, type = "sine") {
  if (!state.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch (_) {}
}
const sfx = {
  open: () => { beep(440, .08); setTimeout(() => beep(587, .1), 80); },
  ok: () => { beep(659, .1); setTimeout(() => beep(880, .14), 90); },
  no: () => beep(233, .16, .04, "sawtooth"),
};

function toast(msg, ms = 2200) {
  const t = $("toast");
  if (!t) return;
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  clearTimeout(t._h);
  t.classList.remove("has-act");
  t.classList.add("show");
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}
function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- الدخول ---------- */
function enterSite(name, opts) {
  const o = opts || {};
  const clean = (name || "").trim().slice(0, 18);
  if (clean.length < 2) { $("loginErr").textContent = "اكتب اسماً من حرفين على الأقل"; return; }
  state.user = clean;
  state.bank = loadBank(clean);
  state.roundUsed = {};
  state.played = 0;
  lastScorePaint.A = null;
  lastScorePaint.B = null;
  try { localStorage.setItem(K_USER, clean); } catch (_) {}
  $("login").classList.remove("active");
  $("setup").classList.add("active");
  $("userChip").textContent = `تلعب باسم ${clean}`;
  state.picked = [];
  renderPicker();
  renderBankInfo();
  if (!o.noResume) tryResume();
}

function tryResume() {
  const p = new URLSearchParams(location.search);
  if (p.get("selftest") === "1" || p.get("auto") === "1" || p.get("setup") === "1") return false;
  const r = loadRound(state.user);
  if (!r) return false;
  const picked = (r.picked || []).filter((id) => !!catById(id));
  if (picked.length !== PICK) return false;
  state.picked = picked;
  state.teams = (Array.isArray(r.teams) ? r.teams : []).map(normTeam);
  while (state.teams.length < 2) state.teams.push(normTeam(null, state.teams.length));
  state.teams.length = 2;
  state.turn = r.turn ? 1 : 0;
  state.played = Math.max(0, Math.floor(r.played));
  const ru = {};
  if (r.roundUsed && typeof r.roundUsed === "object") {
    Object.keys(r.roundUsed).forEach((k) => {
      const res = normResult(r.roundUsed[k], k);
      if (res) ru[k] = res;
    });
  }
  state.roundUsed = ru;
  $("teamA").value = state.teams[0].name;
  $("teamB").value = state.teams[1].name;
  $("login").classList.remove("active");
  $("setup").classList.remove("active");
  $("board").classList.add("active");
  render();
  toast("تم استئناف جولتك الحالية", 2600);
  return true;
}

function logout() {
  try { localStorage.removeItem(K_USER); } catch (_) {}
  state.user = ""; state.bank = {};
  state.picked = []; state.roundUsed = {}; state.played = 0;
  $("setup").classList.remove("active");
  $("board").classList.remove("active");
  $("login").classList.add("active");
  $("loginName").value = "";
  $("loginErr").textContent = "";
  setTimeout(() => $("loginName").focus(), 50);
}

/* ---------- شاشة البداية ---------- */
function renderPicker() {
  const grid = $("catGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const isKids = (cat) => cat.audience === "kids";
  CATEGORIES.filter((cat) => state.catFilter === "all"
    || (state.catFilter === "kids" ? isKids(cat) : !isKids(cat))).forEach((cat) => {
    const left = catLeft(cat.id);
    const b = document.createElement("button");
    b.className = "cat-card" + (state.picked.includes(cat.id) ? " on" : "");
    b.disabled = left === 0;
    b.dataset.cat = cat.id;
    b.dataset.audience = isKids(cat) ? "kids" : "general";
    b.innerHTML = `<div class="cat-visual"><img src="assets/cats/${cat.id}.svg" alt="" loading="lazy" /></div>`
      + (isKids(cat) ? `<span class="kids-pill">7–12</span>` : "")
      + `<div class="cat-meta"><b>${esc(cat.name)}</b><small>${left === 0 ? "انتهت أسئلتها" : `متبقي ${left} سؤالاً`}</small></div>`;
    if (left > 0) b.addEventListener("click", () => toggleCat(cat.id));
    grid.appendChild(b);
  });
  document.querySelectorAll("#catTabs .cat-tab").forEach((t) => {
    t.classList.toggle("on", (t.dataset.filter || "all") === state.catFilter);
  });
  $("pickCount").innerHTML = `<span dir="ltr">${state.picked.length}/${PICK}</span>`;
  $("startBtn").disabled = state.picked.length !== PICK;
}

function renderBankInfo() {
  const el = $("bankLeft");
  if (!el) return;
  const total = bankTotal();
  const left = Math.max(0, total - bankUsed());
  el.textContent = state.user ? `متبقي ${left} من ${total} سؤال في بنكك` : `بنك اللعبة ${total} سؤال`;
}

function toggleCat(id) {
  const i = state.picked.indexOf(id);
  if (i >= 0) state.picked.splice(i, 1);
  else if (state.picked.length < PICK) state.picked.push(id);
  else { toast("اخترت 6 فئات بالفعل"); return; }
  beep(520, .04, .02);
  renderPicker();
}

/* ---------- اللوحة ---------- */
const roundId = (catId, slot) => `${catId}:${slot}`;
function isRoundPlayed(catId, slot) { return !!state.roundUsed[roundId(catId, slot)]; }

function renderBoard() {
  const grid = $("boardGrid");
  if (!grid) return;
  grid.innerHTML = "";
  state.picked.forEach((id) => {
    const cat = catById(id);
    if (!cat) return;
    const col = document.createElement("div");
    col.className = "col";
    col.dataset.cat = id;

    const left = catLeft(id);
    const head = document.createElement("div");
    head.className = "col-head";
    head.title = `${cat.name} · ${left === 0 ? "انتهت أسئلتها" : `متبقي ${left} سؤالاً في البنك`}`;
    const dots = TIERS.map((t, slot) =>
      `<i class="${isRoundPlayed(id, slot) ? "off" : ""}"></i>`).join("");
    /* صورة الفئة خلفيةً لرأس العمود + طبقة نص/نقاط فوقها (النص يبقى داخل .col-head للتحديد والاختبار) */
    head.innerHTML = `<img class="col-head-bg" src="assets/cats/${id}.svg" alt="" aria-hidden="true" />`
      + `<div class="col-head-fg"><b>${esc(cat.name)}</b>`
      + `<small>${left === 0 ? "انتهت" : `متبقي ${left}`}</small>`
      + `<span class="dots" aria-hidden="true">${dots}</span></div>`;
    col.appendChild(head);

    // رصيد البنك المتبقي لكل مستوى — يُستهلك تدريجياً حسب ترتيب الخلايا
    const budget = { 200: tierPool(id, 200).length, 400: tierPool(id, 400).length, 600: tierPool(id, 600).length };
    let playedInCol = 0;

    TIERS.forEach((tier, slot) => {
      const key = roundId(id, slot);
      const inRound = isRoundPlayed(id, slot);
      const res = inRound ? roundResult(key) : null;
      const bankLeft = tierPool(id, tier).length;
      let dead = false, drained = false;

      if (inRound) {
        playedInCol += 1;
        dead = true;
      } else if (budget[tier] <= 0) {
        drained = true; dead = true;
      } else {
        budget[tier] -= 1;
      }

      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tier = String(tier);
      b.dataset.cat = id;
      b.dataset.slot = String(slot);
      b.disabled = dead;

      if (inRound) {
        /* الخلية المجابة: اسم الفريق صاحب الإجابة + قيمة السؤال بلون الفريق، أو رمادي هادئ إذا لم يجب أحد */
        const w = res ? res.winner : null;
        const who = (w === 0 || w === 1) ? state.teams[w].name : "";
        b.className = "cell used " + (w === 0 ? "won-a" : w === 1 ? "won-b" : "won-none");
        b.innerHTML = (who ? `<span class="cell-who">${esc(who)}</span>` : "")
          + `<span class="cell-val">${tier}</span>`;
        b.setAttribute("aria-label", who
          ? `${who} أجاب سؤال ${tier} نقطة`
          : `سؤال ${tier} نقطة — لم يجبه أحد`);
      } else {
        b.className = "cell" + (drained ? " drained" : "");
        b.innerHTML = `${tier}`;
        b.setAttribute("aria-label", `سؤال ${tier} نقطة، متبقي ${bankLeft} في هذا المستوى`);
        if (drained) b.title = "لا توجد أسئلة متبقية في هذا المستوى لهذا اللاعب";
        else b.addEventListener("click", () => openQuestion(id, slot));
      }
      col.appendChild(b);
    });

    if (playedInCol === TIERS.length || left === 0) col.classList.add("done");
    grid.appendChild(col);
  });
}

const HELP_LABEL = { friend: "صديق", two: "جوابين", dbl: "دبل" };

/* نبضة قصيرة على رقم الفريق عند تغيّر النقاط فقط (بلا أي أثر على القوانين) */
const lastScorePaint = { A: null, B: null };
function paintScore(L, score) {
  const el = $("score" + L);
  if (!el) return;
  if (el.textContent !== String(score)) el.textContent = score;
  const prev = lastScorePaint[L];
  if (prev !== null && prev !== score) {
    el.classList.remove("bump");
    void el.offsetWidth;          // إعادة تشغيل الحركة من أولها
    el.classList.add("bump");
  }
  lastScorePaint[L] = score;
}

/* كبسولة رقم السؤال في الجولة: من 1 إلى 36 */
function paintTurnQ() {
  const el = $("turnQ");
  if (!el) return;
  const n = Math.min(state.played + 1, PICK * 6);
  el.textContent = `السؤال ${n} / ${PICK * 6}`;
}

function renderTeams() {
  ["A", "B"].forEach((L, i) => {
    const t = state.teams[i];
    const nameEl = $("name" + L);
    if (nameEl) nameEl.textContent = t.name;
    paintScore(L, t.score);
    const card = $("teamCard" + L);
    if (card) card.classList.toggle("active", state.turn === i);
    const dbl = $("dbl" + L);
    if (dbl) {
      const armed = !!t.dbl;
      const spent = !t.helps.dbl;
      const off = i !== state.turn;              // يظهر فقط بجانب الفريق صاحب الدور
      dbl.classList.toggle("is-off", off);
      dbl.setAttribute("aria-hidden", off ? "true" : "false");
      dbl.classList.toggle("armed", armed);
      dbl.classList.toggle("spent", spent && !armed);
      dbl.disabled = off || (spent && !armed) || !!state.active;
      dbl.setAttribute("aria-pressed", armed ? "true" : "false");
      dbl.textContent = armed ? "دبل ×2" : "دبل";
      dbl.title = armed
        ? "الدبل مفعّل — اضغط لإلغائه قبل فتح السؤال"
        : spent ? "استُخدم دبل هذا الفريق" : "مضاعفة نقاط السؤال القادم";
    }
  });
  const sw = $("swapTurnBtn");
  if (sw) sw.disabled = !!state.active;
  /* السطر العلوي القديم للدور أُزيل — البطاقة المتوهجة تكفي */
  const turnEl = $("turnTeam");
  if (turnEl) turnEl.textContent = state.teams[state.turn].name;
}

function render() {
  renderBoard();
  renderTeams();
  paintTurnQ();
  const left = state.picked.reduce((n, id) => n + catLeft(id), 0);
  const el = $("remaining");
  if (el) el.textContent = `${left} سؤالاً متبقياً في بنكك`;
  renderBankInfo();
}

/* ---------- السؤال ---------- */
function openQuestion(catId, slot) {
  const cat = catById(catId);
  if (!cat || !(slot >= 0) || slot >= TIERS.length) return;
  if (isRoundPlayed(catId, slot)) { toast("هذه الخلية لُعبت في هذه الجولة"); return; }

  const tier = TIERS[slot];
  const pool = tierPool(catId, tier);
  if (!pool.length) { toast("نفدت أسئلة هذه القيمة لهذا اللاعب"); renderBoard(); return; }

  const pickOne = pool[Math.floor(Math.random() * pool.length)];
  state.active = { catId, slot, idx: pickOne.i, q: pickOne.q, tier, helps: [] };
  state.teams.forEach((t, i) => {
    t.twoActive = false;
    if (t.dbl) state.active.helps.push({ kind: "dbl", team: i });
  });

  $("qCat").textContent = cat.name;
  $("qValue").textContent = String(tier);
  $("qText").textContent = pickOne.q.q;
  if (pickOne.q.img) {
    $("qImg").src = pickOne.q.img;
    $("qImg").hidden = false;
    $("qImg").classList.toggle("is-flag", pickOne.q.img.includes("flags/"));
  }
  else { $("qImg").hidden = true; $("qImg").classList.remove("is-flag"); $("qImg").removeAttribute("src"); }

  $("answerBox").hidden = true;
  $("answerText").textContent = pickOne.q.a;

  const alt = $("answerAlt"), note = $("answerNote");
  if (alt) {
    const v = pickOne.q.alt ? String(pickOne.q.alt).trim() : "";
    alt.textContent = v ? `تُقبل أيضاً: ${v}` : "";
    alt.hidden = !v;
  }
  if (note) {
    const v = pickOne.q.note ? String(pickOne.q.note).trim() : "";
    note.textContent = v;
    note.hidden = !v;
  }

  $("phaseActions").classList.remove("hidden");
  $("judgeBox").hidden = true;
  document.querySelector("#qModal .modal-card").classList.remove("revealed");
  $("qModal").classList.add("open");
  renderActiveHelps();
  renderTeams();
  sfx.open();
  startPhase(0);
}

function phaseTeam() { return state.phase === 0 ? state.turn : 1 - state.turn; }

function startPhase(p, bonus = 0) {
  state.phase = p;
  state.phaseMax = PHASE_TIME[p] + bonus;
  state.left = state.phaseMax;
  state.lastTickSec = null;
  const team = state.teams[phaseTeam()];
  $("phaseTeam").textContent = team.name;
  $("nextTeamBtn").classList.toggle("hidden", p === 1);
  $("clock").classList.remove("low");
  $("timeFill").classList.remove("low");
  renderHelps();
  renderActiveHelps();
  paintClock();

  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.left -= .1;
    const sec = Math.max(0, Math.ceil(state.left));
    if (sec !== state.lastTickSec) {
      state.lastTickSec = sec;
      if (sec >= 1 && sec <= 10) beep(760, .04, .025);   // تكة هادئة لآخر 10 ثوانٍ
    }
    paintClock();
    if (state.left <= 10) { $("clock").classList.add("low"); $("timeFill").classList.add("low"); }
    if (state.left <= 0) {
      clearInterval(state.timer);
      if (state.phase === 0) { toast(`انتهى وقت ${team.name} — 30 ثانية للفريق الآخر`); startPhase(1); }
      else reveal();
    }
  }, 100);
}

function paintClock() {
  $("clock").textContent = fmt(state.left);
  $("timeFill").style.width = Math.max(0, Math.min(100, (state.left / state.phaseMax) * 100)) + "%";
}

function judgePoints(i) {
  const t = state.teams[i];
  const base = state.active ? state.active.q.d : 0;
  return { pts: base * (t.dbl ? 2 : 1), dbl: !!t.dbl };
}

function paintJudge() {
  [0, 1].forEach((i) => {
    const t = state.teams[i], j = judgePoints(i);
    const el = i === 0 ? $("judgeA") : $("judgeB");
    el.innerHTML = j.dbl
      ? `<b>${esc(t.name)}</b><small><span dir="ltr">+${j.pts}</span> دبل</small>`
      : `<b>${esc(t.name)}</b>`;
  });
}

function reveal() {
  clearInterval(state.timer);
  if (!state.active) return;
  document.querySelector("#qModal .modal-card").classList.add("revealed");
  $("phaseActions").classList.add("hidden");
  $("answerBox").hidden = false;
  $("judgeBox").hidden = false;
  paintJudge();
  $("helpBox").innerHTML = "";
  renderActiveHelps();   // تبقى شارات الوسائل ظاهرة أثناء الحكم
  beep(520, .12);
}

/* ---------- الحكم والتراجع ---------- */
function award(teamIndex) {
  if (!state.active) return;
  const { catId, slot, idx, q } = state.active;

  const winner = (teamIndex === 0 || teamIndex === 1) ? teamIndex : null;
  let pts = q.d;
  let msg = "لا نقاط";
  if (winner !== null) {
    const t = state.teams[winner];
    pts = q.d * (t.dbl ? 2 : 1);
    t.score += pts;
    sfx.ok();
    msg = `+${pts} إلى ${t.name}`;
  } else { pts = 0; sfx.no(); }

  // يُحفظ السؤال لاسم اللاعب: لا يعود إليه أبداً
  state.bank[catId] = state.bank[catId] || {};
  state.bank[catId][idx] = true;
  saveBank();

  state.roundUsed[roundId(catId, slot)] = { winner, value: q.d, points: pts };
  state.teams.forEach((t) => { t.dbl = false; t.twoActive = false; });
  state.played += 1;

  closeQuestion();
  state.turn = 1 - state.turn;
  render();
  saveRound();
  checkEnd();
  toast(msg, 3200);
}

function closeQuestion() {
  clearInterval(state.timer);
  state.timer = null;
  $("qModal").classList.remove("open");
  $("activeHelps").hidden = true;
  $("activeHelps").innerHTML = "";
  state.active = null;
  renderTeams();   // أعد تفعيل أزرار الدبل بعد إغلاق السؤال
}

/* ---------- تعديل النقاط يدوياً ---------- */
let scoreEditing = null;

function openScoreEditor(i) {
  const t = state.teams[i];
  if (!t) return;
  scoreEditing = i;
  $("seTitle").textContent = `تعديل نقاط ${t.name}`;
  const inp = $("seInput");
  inp.value = t.score;
  $("scoreModal").classList.add("open");
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
}

function closeScoreEditor() {
  scoreEditing = null;
  $("scoreModal").classList.remove("open");
}

function commitScore() {
  if (scoreEditing === null) return;
  const i = scoreEditing;
  const raw = Number($("seInput").value);
  const v = Math.min(99999, Math.max(0, Math.round(isFinite(raw) ? raw : 0)));
  state.teams[i].score = v;
  // بعد تعديل يدوي يصبح تراجع «آخر حكم» مضللاً — نلغيه بدل تصحيح مزدوج
  render();
  saveRound();
  closeScoreEditor();
  toast(`صارت نقاط ${state.teams[i].name} ${v}`, 2600);
}

/* ---------- تبديل الدور يدوياً ---------- */
function swapTurn() {
  if (state.active) return;
  // أي دبل معلّق يُلغى وتُرجَع الوسيلة قبل تغيير الدور
  state.teams.forEach((t) => { if (t.dbl) { t.dbl = false; t.helps.dbl = true; } });
  state.turn = 1 - state.turn;
  beep(560, .06);
  render();
  saveRound();
  toast(`الدور الآن لـ${state.teams[state.turn].name}`);
}

/* ---------- الدبل: يُفعّل قبل السؤال من الشريط ---------- */
function toggleDbl(i) {
  const t = state.teams[i];
  if (!t) return;
  if (i !== state.turn) { toast("الدبل متاح للفريق صاحب الدور فقط"); return; }
  if (state.active) { toast("الدبل يُفعّل قبل فتح السؤال"); return; }
  if (t.dbl) {
    t.dbl = false; t.helps.dbl = true;
    toast(`أُلغي دبل ${t.name}`);
  } else {
    if (!t.helps.dbl) { toast("استُخدم دبل هذا الفريق"); return; }
    t.dbl = true; t.helps.dbl = false;
    toast(`دبل مفعّل لـ${t.name} — يُضاعف السؤال القادم`, 3200);
  }
  beep(620, .06);
  renderTeams();
  saveRound();
}

/* ---------- الوسائل ---------- */
function useHelp(kind) {
  const idx = phaseTeam();
  const t = state.teams[idx];
  if (!state.active || !t || !t.helps[kind]) return;
  t.helps[kind] = false;

  if (kind === "friend") {
    state.phaseMax += 60;
    state.left += 60;
    toast(`اتصال بصديق: +دقيقة لـ${t.name}`);
    paintClock();
  }
  if (kind === "two") { t.twoActive = true; toast(`${t.name} يمكنه تقديم إجابتين`); }

  state.active.helps.push({ kind, team: idx });
  beep(520, .06);
  renderHelps();
  renderActiveHelps();
  renderTeams();
  saveRound();
}

function renderHelps() {
  const t = state.teams[phaseTeam()];
  const box = $("helpBox");
  if (!box) return;
  box.innerHTML = "";
  [["friend", "اتصال بصديق"], ["two", "جوابين"]].forEach(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "help";
    b.textContent = label;
    b.disabled = !t.helps[k];
    b.addEventListener("click", () => useHelp(k));
    box.appendChild(b);
  });
}

function renderActiveHelps() {
  const box = $("activeHelps");
  if (!box) return;
  const a = state.active;
  if (!a || !a.helps || !a.helps.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const order = { dbl: 0, two: 1, friend: 2 };
  box.innerHTML = "";
  a.helps
    .slice()
    .sort((x, y) => (order[x.kind] || 9) - (order[y.kind] || 9))
    .forEach((h) => {
      const team = state.teams[h.team];
      // «فريق سين» ← «سين» حتى لا تصير العبارة «لفريق فريق سين»
      const name = team ? team.name.replace(/^فريق\s+/, "") : "";
      const label = h.kind === "friend" ? `+60 ثانية لفريق ${name}`
        : h.kind === "two" ? `جوابان متاحان لفريق ${name}`
        : `دبل ×2 لفريق ${name}`;
      const s = document.createElement("span");
      s.className = "ah-chip " + h.kind;
      s.textContent = label;
      box.appendChild(s);
    });
  box.hidden = false;
}

/* ---------- النهاية ---------- */
function showWinner() {
  const [a, b] = state.teams;
  const w = a.score === b.score ? null : (a.score > b.score ? a : b);
  $("winName").textContent = w ? w.name : "تعادل";
  $("winScores").textContent = `${a.name} ${a.score} — ${b.name} ${b.score}`;
  $("winModal").classList.add("open");
  clearRound(state.user);
  [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, .18), i * 140));
}

function checkEnd() {
  if (state.played >= PICK * 6) showWinner();
}

/* ---------- تشغيل ---------- */
function startGame() {
  state.teams = [
    { name: ($("teamA").value || "فريق سين").trim().slice(0, 18), score: 0, helps: { friend: true, two: true, dbl: true }, dbl: false, twoActive: false },
    { name: ($("teamB").value || "فريق جيم").trim().slice(0, 18), score: 0, helps: { friend: true, two: true, dbl: true }, dbl: false, twoActive: false },
  ];
  state.turn = 0;
  state.played = 0;
  state.roundUsed = {};
  lastScorePaint.A = null;
  lastScorePaint.B = null;
  $("setup").classList.remove("active");
  $("board").classList.add("active");
  render();
  saveRound();
}

function backToSetup() {
  state.picked = [];
  state.roundUsed = {};
  state.played = 0;
  $("board").classList.remove("active");
  $("setup").classList.add("active");
  renderPicker();
  renderBankInfo();
}

/* زر المنزل: عودة لاختيار الفئات
   - لم تبدأ الجولة: انتقال فوري بلا سؤال
   - بدأت الجولة: تأكيد حتى لا تضيع نقاط اللعب بلمسة خاطئة */
function goHome() {
  if (state.active) { toast("أغلق السؤال أولاً ثم عد لاختيار الفئات", 2400); return; }
  if (state.played > 0) { $("confirmModal").classList.add("open"); return; }
  clearRound(state.user);
  backToSetup();
}

/* ---------- بنك اللاعب: حفظ واستيراد ---------- */
function exportBank() {
  if (!state.user) return;
  const payload = {
    app: "seenjeem",
    version: 1,
    user: state.user,
    exportedAt: new Date().toISOString(),
    bank: state.bank,
  };
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seenjeem-bank-${state.user}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("تم تنزيل ملف بنكك");
  } catch (_) { toast("تعذّر تنزيل الملف"); }
}

function importBankText(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("json"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("shape");
  const src = (data.bank && typeof data.bank === "object" && !Array.isArray(data.bank)) ? data.bank : data;

  let added = 0, valid = 0;
  Object.keys(src).forEach((catId) => {
    const cat = catById(catId);
    if (!cat) return;
    const entry = src[catId];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    Object.keys(entry).forEach((k) => {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= cat.questions.length) return;
      if (!entry[k]) return;
      valid += 1;
      state.bank[catId] = state.bank[catId] || {};
      if (!state.bank[catId][i]) { state.bank[catId][i] = true; added += 1; }
    });
  });

  if (valid === 0) throw new Error("empty");
  saveBank();
  renderPicker();
  renderBankInfo();
  return added;
}

function importBankFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const added = importBankText(String(reader.result || ""));
      toast(added > 0 ? `تم استيراد ${added} سؤالاً إلى بنكك` : "كل أسئلة الملف موجودة في بنكك");
    } catch (_) {
      toast("ملف غير صالح — اختر ملف بنك سين جيم");
    }
  };
  reader.onerror = () => toast("تعذّرت قراءة الملف");
  reader.readAsText(file);
}

/* ---------- ربط ---------- */
function bind() {
  on("loginBtn", "click", () => enterSite($("loginName").value));
  on("loginName", "keydown", (e) => { if (e.key === "Enter") enterSite($("loginName").value); });
  on("switchUser", "click", logout);

  on("startBtn", "click", () => { beep(600, .08); startGame(); });
  document.querySelectorAll("#catTabs .cat-tab").forEach((t) => {
    t.addEventListener("click", () => {
      state.catFilter = t.dataset.filter || "all";
      renderPicker();
    });
  });
  on("rulesBtn", "click", () => $("rulesModal").classList.add("open"));
  on("closeRules", "click", () => $("rulesModal").classList.remove("open"));
  on("revealBtn", "click", reveal);
  on("nextTeamBtn", "click", () => { if (state.phase === 0 && state.active) startPhase(1); });
  [["A", 0], ["B", 1]].forEach(([L, i]) => {
    const b = $("dbl" + L);
    if (b) b.addEventListener("click", () => toggleDbl(i));
  });
  on("judgeA", "click", () => award(0));
  on("judgeB", "click", () => award(1));
  on("judgeNone", "click", () => award(null));

  // زر المنزل في منتصف الشريط: عودة لاختيار الفئات (بسؤال إن بدأت الجولة)
  on("homeBtn", "click", goHome);
  on("swapTurnBtn", "click", swapTurn);

  // تعديل النقاط: اضغط رقم الفريق
  [["A", 0], ["B", 1]].forEach(([L, i]) => {
    const b = $("score" + L);
    if (b) b.addEventListener("click", () => openScoreEditor(i));
  });
  on("closeScore", "click", closeScoreEditor);
  on("seCancel", "click", closeScoreEditor);
  on("seSave", "click", commitScore);
  on("seInput", "keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitScore(); }
    if (e.key === "Escape") { e.preventDefault(); closeScoreEditor(); }
  });
  document.querySelectorAll("#scoreModal .se-chip").forEach((b) => {
    b.addEventListener("click", () => {
      const cur = Number($("seInput").value) || 0;
      const d = b.dataset.set;
      $("seInput").value = d === "0" ? 0 : Math.max(0, cur + Number(d));
    });
  });

  on("exportBank", "click", exportBank);
  on("importBank", "click", () => { const f = $("bankFile"); if (f) f.click(); });
  on("bankFile", "change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    importBankFile(f);
  });

  /* أزرار الشريط القديمة (تراجع · صوت · ملء الشاشة · إنهاء · إعادة) أُزيلت من #board */
  on("confirmNo", "click", () => $("confirmModal").classList.remove("open"));
  on("confirmYes", "click", () => {
    $("confirmModal").classList.remove("open");
    clearRound(state.user);
    backToSetup();
    toast("اختر 6 فئات لتبدأ جولة جديدة", 2400);
  });
  on("playAgain", "click", () => {
    $("winModal").classList.remove("open");
    clearRound(state.user);
    backToSetup();
  });

  document.addEventListener("keydown", (e) => {
    if ($("scoreModal").classList.contains("open")) {
      if (e.key === "Escape") closeScoreEditor();
      return;
    }
    if (!state.active) return;
    if (e.code === "Space") { e.preventDefault(); if ($("answerBox").hidden) reveal(); }
    if (!$("answerBox").hidden) {
      if (e.key === "1") award(0);
      if (e.key === "2") award(1);
      if (e.key === "0") award(null);
    }
  });

  // لاعب محفوظ مسبقاً؟
  let saved = null;
  try { saved = localStorage.getItem(K_USER); } catch (_) {}
  if (saved) { enterSite(saved); }
  else { setTimeout(() => $("loginName").focus(), 50); }
}

/* ---------- خدمة العمل دون إنترنت ---------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ---------- اختبار ---------- */
function selfTest() {
  const log = [];
  const ok = (c, m) => log.push((c ? "PASS " : "FAIL ") + m);
  const cellOf = (id, slot) => document.querySelector(`#boardGrid .cell[data-cat="${id}"][data-slot="${slot}"]`);
  const bankCount = () => Object.values(state.bank).reduce((n, o) => n + Object.keys(o).length, 0);
  try { localStorage.clear(); } catch (_) {}

  enterSite("مختبر");
  ok(document.querySelectorAll("#catGrid .cat-card").length === CATEGORIES.length
    && CATEGORIES.length >= 10, `بطاقات الفئات تطابق CATEGORIES (${CATEGORIES.length}) في الاختيار`);

  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  startGame();
  ok(document.querySelectorAll("#boardGrid .cell").length === PICK * 6, "36 خلية (6 فئات × 6)");
  ok(document.querySelectorAll("#boardGrid .col-head .dots i").length === PICK * 6, "6 نقاط جولة في رأس كل عمود");

  /* --- الشريط العلوي الجديد: فريقان بالزاويتين + المنزل والشعار بالمنتصف --- */
  ok(!document.querySelector("#board .turn-banner") && !$("turnTeam") && !$("turnQ"), "أُزيل شريط «الدور الآن» وعناصره");
  ok(!document.querySelector("#board .foot") && !$("remaining") && !$("helpLine"), "أُزيل السطر السفلي أسفل اللوحة");
  ok(!$("undoBtn") && !$("soundBtn") && !$("fullBtn") && !$("endBtn") && !$("restartBtn"), "أزرار الشريط القديمة أُزيلت كلها");
  const bar = document.querySelector("#board header.bar");
  ok(!!bar && getComputedStyle(bar).display === "grid", "الشريط العلوي شبكة grid ثلاثية المناطق");
  ok(!!bar && !!$("teamCardA") && !!$("teamCardB")
    && $("teamCardA").parentElement === bar && $("teamCardB").parentElement === bar, "بطاقتا الفريقين داخل الشريط نفسه");
  ok(!!$("homeBtn") && !!$("homeBtn").closest(".bar-center"), "زر المنزل في منتصف الشريط");
  ok(!!document.querySelector(".bar-center .bar-brand .bar-logo"), "شعار اللعبة بجانب زر المنزل");

  /* --- خلية واحدة تُغلق فقط، وشقيقتها تبقى فعّالة --- */
  const cid = state.picked[0];
  const scoreBefore = state.teams[0].score;
  const usedBefore = bankCount();
  /* أدوات الاختبار: لقطة/استعادة — اللعبة نفسها بلا تراجع */
  const snap = () => JSON.parse(JSON.stringify({ teams: state.teams, bank: state.bank, played: state.played, roundUsed: state.roundUsed, turn: state.turn }));
  const restore = (s) => {
    state.teams = s.teams; state.bank = s.bank; state.played = s.played;
    state.roundUsed = s.roundUsed; state.turn = s.turn;
    state.teams.forEach((t) => { t.twoActive = false; });
    saveBank(); render(); saveRound();
  };
  const preA = snap();
  openQuestion(cid, 0);
  ok(!!state.active && state.active.slot === 0 && state.active.catId === cid, "فتح الخلية يحفظ slot في state.active");
  reveal();
  award(0);
  const c0 = cellOf(cid, 0), c1 = cellOf(cid, 1);
  ok(!!c0 && c0.classList.contains("used"), "الخلية الملعوبة بالذات تتحول إلى .used");
  ok(!!c1 && !c1.classList.contains("used") && !c1.disabled, "الخلية الثانية من نفس المستوى تبقى فعّالة");
  const res0 = state.roundUsed[cid + ":0"];
  ok(!!res0 && res0.winner === 0 && res0.value === TIERS[0] && res0.points === TIERS[0],
    "roundUsed يحفظ { winner, value, points } للخلية");
  ok(!state.roundUsed[cid + ":1"], "roundUsed لا يسجل الخلية الأخرى");
  ok(state.teams[0].score === scoreBefore + TIERS[0], "النقاط تُضاف بدرجة السؤال");

  /* --- الخلية المجابة: اسم الفريق + قيمة السؤال بلون الفريق --- */
  const who0 = c0.querySelector(".cell-who"), val0 = c0.querySelector(".cell-val");
  ok(c0.classList.contains("won-a"), "خلية إجابة الفريق الأول تحمل won-a");
  ok(!!who0 && who0.textContent === state.teams[0].name, "الخلية تعرض اسم الفريق المجيب");
  ok(!!val0 && val0.textContent === String(TIERS[0]), "الخلية تعرض قيمة السؤال");
  ok(!c0.querySelector("small"), "لا يبقى عدّاد البنك داخل الخلية الملعوبة");
  /* الصحيحة بنفس رمادي «لا أحد»، والتمييز الوحيد اسم الفريق بلونه */
  ok(/232, 237, 243/.test(getComputedStyle(c0).backgroundColor), "خلية الإجابة الصحيحة رمادية مثل «لا أحد»");
  ok(getComputedStyle(who0).color === "rgb(25, 103, 178)", "اسم الفريق الأول بلون فريقه");

  /* --- الحكم نهائي: لا ميزة تراجع --- */
  ok(!$("undoBtn") && !document.querySelector(".toast-act"), "لا زر تراجع ولا إجراء تراجع في التوست");
  restore(preA);
  ok(state.teams[0].score === scoreBefore && !state.roundUsed[cid + ":0"] && bankCount() === usedBefore,
    "استعادة حالة الاختبار تعيد اللوحة كما كانت");

  /* --- لا زر إغلاق: السؤال يُغلق بالحكم فقط --- */
  ok(!$("closeQBtn"), "زر إغلاق السؤال أُزيل من النافذة");
  openQuestion(cid, 0);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok($("qModal").classList.contains("open"), "Esc لا يغلق السؤال");
  closeQuestion(); // تنظيف داخلي للاختبار فقط

  /* --- الدبل: يُفعّل قبل السؤال من الشريط --- */
  ok(!!$("dblA") && !!$("dblB"), "زر دبل موجود بجانب اسم كل فريق");
  $("dblA").click();
  ok(state.teams[0].dbl === true && state.teams[0].helps.dbl === false, "الدبل يتفعّل قبل السؤال ويُستهلك");
  ok($("dblA").classList.contains("armed") && $("dblA").getAttribute("aria-pressed") === "true", "زر الدبل يظهر مفعّلاً");
  $("dblA").click();
  ok(state.teams[0].dbl === false && state.teams[0].helps.dbl === true, "إلغاء الدبل قبل السؤال يعيد الوسيلة");

  const preD = snap();
  $("dblA").click();
  const dblBase = state.teams[0].score;
  openQuestion(cid, 0);
  ok($("dblA").disabled === true, "زر الدبل يتعطّل بعد فتح السؤال");
  ok($("activeHelps").textContent.includes("دبل"), "شارة الدبل تظهر داخل السؤال");
  reveal();
  award(0);
  ok(state.teams[0].score === dblBase + TIERS[0] * 2, "الدبل يضاعف نقاط السؤال");
  ok(state.teams[0].dbl === false && state.teams[0].helps.dbl === false, "الدبل يُستهلك بعد الحكم");
  restore(preD);
  ok(state.teams[0].score === dblBase, "نقاط الدبل تعود بعد استعادة حالة الاختبار");

  /* --- الدبل لصاحب الدور فقط + تبديل الدور --- */
  ok(!$("dblA").classList.contains("is-off") && $("dblB").classList.contains("is-off"), "الدبل يظهر بجانب صاحب الدور فقط");
  $("dblA").click();
  ok(state.teams[0].dbl === true, "الدبل يُفعّل لصاحب الدور");
  $("swapTurnBtn").click();
  ok(state.turn === 1, "زر تبديل الدور ينقل الدور للفريق الثاني");
  ok($("dblA").classList.contains("is-off") && !$("dblB").classList.contains("is-off"), "زر الدبل ينتقل مع الدور");
  ok(state.teams[0].dbl === false && state.teams[0].helps.dbl === true, "تبديل الدور يلغي الدبل المعلّق ويعيد الوسيلة");
  $("swapTurnBtn").click();
  ok(state.turn === 0, "زر تبديل الدور يرجع الدور للأول");

  /* --- الفريق الثاني: won-b --- */
  const preB = snap();
  openQuestion(cid, 1);
  reveal();
  award(1);
  const cb = cellOf(cid, 1);
  const who1 = cb ? cb.querySelector(".cell-who") : null;
  ok(!!cb && cb.classList.contains("won-b") && !!who1 && who1.textContent === state.teams[1].name,
    "خلية إجابة الفريق الثاني تحمل won-b وباسمه");
  ok(getComputedStyle(cb.querySelector(".cell-who")).color === "rgb(168, 80, 15)", "اسم الفريق الثاني بلون فريقه");
  restore(preB);

  /* --- لم يجب أحد: رمادي هادئ بقيمة السؤال وحدها --- */
  const preN = snap();
  openQuestion(cid, 2);
  reveal();
  award(null);
  const cn = cellOf(cid, 2);
  const valN = cn ? cn.querySelector(".cell-val") : null;
  ok(!!cn && cn.classList.contains("won-none") && !cn.querySelector(".cell-who"), "خلية «لا أحد» رمادية بلا اسم فريق");
  ok(!!valN && valN.textContent === String(TIERS[2]), "خلية «لا أحد» تعرض قيمة السؤال");
  ok(!!cn && /232, 237, 243/.test(getComputedStyle(cn).backgroundColor), "خلفية «لا أحد» رمادية هادئة");
  ok(!!state.roundUsed[cid + ":2"] && state.roundUsed[cid + ":2"].winner === null, "roundUsed يسجل winner: null عند «لا أحد»");
  restore(preN);
  ok(!state.roundUsed[cid + ":2"], "استعادة الحالة تمسح خلية «لا أحد»");

  /* --- تعديل النقاط يدوياً --- */
  const scBefore = state.teams[0].score;
  openScoreEditor(1);
  ok($("scoreModal").classList.contains("open") && $("seTitle").textContent.includes(state.teams[1].name), "نافذة تعديل النقاط تفتح للفريق المطلوب");
  $("seInput").value = "1234";
  commitScore();
  ok(state.teams[1].score === 1234, "تعديل النقاط يدوياً يعمل");
  ok($("scoreB").textContent === "1234", "الواجهة تعرض النقاط المعدلة");
  const sr = loadRound(state.user);
  ok(!!sr && sr.teams[1].score === 1234, "تعديل النقاط يُحفظ في الجولة");
  openScoreEditor(1); $("seInput").value = "-50"; commitScore();
  ok(state.teams[1].score === 0, "النقاط لا تنزل تحت الصفر");
  state.teams[1].score = 0; render(); saveRound();
  ok(state.teams[0].score === scBefore, "تعديل فريق لا يمس فريقاً آخر");

  /* --- حفظ واستئناف الجولة --- */
  const r0 = loadRound(state.user);
  ok(!!r0 && r0.activeRound === true && r0.picked.length === PICK && r0.played === 0, "saveRound يحفظ الجولة عند البدء");
  const preR = snap();
  openQuestion(cid, 0);
  reveal();
  award(1);
  const r1 = loadRound(state.user);
  ok(!!r1 && r1.played === 1 && !!r1.roundUsed[cid + ":0"] && r1.roundUsed[cid + ":0"].winner === 1
    && r1.teams[1].score === TIERS[0] && r1.turn === 1, "الحفظ يحتوي النقاط والدور والخلية الملعوبة");
  restore(preR);
  const r2 = loadRound(state.user);
  ok(!!r2 && r2.played === 0 && r2.teams[1].score === 0 && !r2.roundUsed[cid + ":0"], "استعادة الحالة تعيد حفظ الجولة كما كانت");

  /* --- جولة كاملة --- */
  const playAll = () => {
    const seen = [];
    for (const id of state.picked) {
      for (let slot = 0; slot < 6; slot++) {
        const tier = TIERS[slot];
        if (!tierPool(id, tier).length) continue;
        openQuestion(id, slot);
        if (!state.active) continue;
        const q = state.active.q;
        seen.push(q.q + "|" + q.a);
        reveal();
        award(0);
      }
    }
    return seen;
  };

  const g1 = playAll();
  ok(g1.length === 36, "الجولة الأولى 36 سؤالاً");
  ok(new Set(g1).size === 36, "لا تكرار داخل الجولة");
  ok(document.querySelectorAll("#boardGrid .col.done").length === PICK, "كل عمود يكتمل (.col.done) بعد 36 خلية");
  ok($("winModal").classList.contains("open"), "نهاية الجولة تظهر الفائز");
  $("winModal").classList.remove("open");

  // جولة ثانية بنفس الاسم: يجب ألا يتكرر أي سؤال
  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  startGame();
  const g2 = playAll();
  const overlap = g2.filter((x) => g1.includes(x));
  ok(overlap.length === 0, "الجولة الثانية بلا أي سؤال مكرر");
  ok(g1.length + g2.length === 72, "72 سؤالاً فريداً بعد جولتين");

  const banked = bankCount();
  ok(banked === 72, `البنك يحفظ 72 سؤالاً لهذا الاسم (${banked})`);

  // نفاد بنك فئة يقفلها في شاشة الاختيار
  const drainId = CATEGORIES.some((c) => c.id === "deen") ? "deen" : CATEGORIES[0].id;
  state.bank[drainId] = {};
  catById(drainId).questions.forEach((_, i) => { state.bank[drainId][i] = true; });
  renderPicker();
  const drainedCard = document.querySelector(`#catGrid .cat-card[data-cat="${drainId}"]`);
  ok(drainedCard && drainedCard.disabled, "الفئة تُقفل بعد نفاد بنكها كاملاً");

  $("winModal").classList.remove("open");
  clearRound(state.user);

  /* --- زر المنزل: عودة لاختيار الفئات --- */
  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  startGame();
  ok(state.played === 0, "بداية الجولة: صفر أسئلة ملعوبة");
  goHome();
  ok($("setup").classList.contains("active") && !$("board").classList.contains("active"),
    "زر المنزل يعود فوراً لاختيار الفئات قبل بدء اللعب");
  ok(!loadRound(state.user) && state.picked.length === 0, "زر المنزل يصفّر الجولة والاختيار");

  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  startGame();
  openQuestion(state.picked[0], 0);
  reveal();
  award(null);
  goHome();
  ok($("confirmModal").classList.contains("open"), "زر المنزل بعد بدء اللعب يطلب التأكيد");
  $("confirmYes").click();
  ok($("setup").classList.contains("active") && !$("board").classList.contains("active"),
    "تأكيد الرجوع ينقل لاختيار الفئات");
  ok(state.played === 0 && !loadRound(state.user), "تأكيد الرجوع يصفّر الجولة المحفوظة");

  /* --- توافق الخلايا القديمة المخزنة كـ true --- */
  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  state.roundUsed = { [state.picked[0] + ":1"]: true };
  state.played = 0;
  renderBoard();
  const legacy = cellOf(state.picked[0], 1);
  const legacyVal = legacy ? legacy.querySelector(".cell-val") : null;
  ok(!!legacy && legacy.classList.contains("won-none") && !!legacyVal && legacyVal.textContent === String(TIERS[1]),
    "الخلية القديمة (true) تُعرض رمادية بقيمة السؤال");
  ok(normResult(true, "x:2").value === TIERS[2], "normResult يفهم القيمة القديمة true");
  state.roundUsed = {};
  renderBoard();

  const pre = document.createElement("pre");
  pre.id = "selftest";
  pre.textContent = log.join("\n");
  document.body.appendChild(pre);
  document.title = log.some((l) => l.startsWith("FAIL")) ? "SELFTEST_FAIL" : "SELFTEST_PASS";
}

loadSound();
bind();

const params = new URLSearchParams(location.search);
if (params.get("selftest") === "1") setTimeout(selfTest, 300);
if (params.get("setup") === "1") { enterSite(params.get("u") || "لاعب"); }
if (params.get("auto") === "1") {
  enterSite(params.get("u") || "لاعب");
  state.picked = CATEGORIES.slice(0, 6).map((c) => c.id);
  startGame();
  const q = params.get("q");
  if (q) {
    const [c, tier] = q.split(":");
    setTimeout(() => {
      const slot = TIERS.indexOf(Number(tier));
      openQuestion(c, slot >= 0 ? slot : 0);
      if (params.get("reveal") === "1") setTimeout(reveal, 350);
    }, 250);
  }
}
registerSW();
