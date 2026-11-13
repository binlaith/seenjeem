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
  roundUsed: {},     // { "catId:slot": true } — خلايا لعبت في هذه الجولة
  active: null,      // { catId, slot, idx, q, tier, helps: [] }
  lastSnapshot: null,
  phase: 0,
  left: 60,
  phaseMax: 60,
  timer: null,
  lastTickSec: null,
  sound: true,
};

const $ = (id) => document.getElementById(id);
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

function normTeam(t, i) {
  const fallback = i === 0 ? "فريق سين" : "فريق جيم";
  const helps = (t && t.helps) || {};
  return {
    name: (t && typeof t.name === "string" && t.name.trim()) ? t.name.trim().slice(0, 18) : fallback,
    score: Number(t && t.score) || 0,
    helps: { friend: helps.friend !== false, two: helps.two !== false, dbl: helps.dbl !== false },
    dbl: false,
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

function toast(msg, ms = 2200, act = null) {
  const t = $("toast");
  if (!t) return;
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  clearTimeout(t._h);
  if (act && typeof act.fn === "function") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-act";
    b.textContent = act.label || "تراجع";
    b.addEventListener("click", () => {
      t.classList.remove("show");
      clearTimeout(t._h);
      act.fn();
    });
    t.appendChild(b);
    t.classList.add("has-act");
  } else {
    t.classList.remove("has-act");
  }
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
  state.lastSnapshot = null;
  state.roundUsed = {};
  state.played = 0;
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
    Object.keys(r.roundUsed).forEach((k) => { if (r.roundUsed[k]) ru[k] = true; });
  }
  state.roundUsed = ru;
  state.lastSnapshot = null;
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
  state.lastSnapshot = null;
  $("setup").classList.remove("active");
  $("board").classList.remove("active");
  $("login").classList.add("active");
  $("loginName").value = "";
  $("loginErr").textContent = "";
  setUndoState();
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
    head.innerHTML = `<b>${esc(cat.name)}</b>`
      + `<small>${left === 0 ? "انتهت" : `متبقي ${left}`}</small>`
      + `<span class="dots" aria-hidden="true">${dots}</span>`;
    col.appendChild(head);

    // رصيد البنك المتبقي لكل مستوى — يُستهلك تدريجياً حسب ترتيب الخلايا
    const budget = { 200: tierPool(id, 200).length, 400: tierPool(id, 400).length, 600: tierPool(id, 600).length };
    let playedInCol = 0;

    TIERS.forEach((tier, slot) => {
      const inRound = isRoundPlayed(id, slot);
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
      b.className = "cell" + (inRound ? " used" : "") + (drained ? " drained" : "");
      b.dataset.tier = String(tier);
      b.dataset.cat = id;
      b.dataset.slot = String(slot);
      b.disabled = dead;

      if (inRound) {
        b.innerHTML = "";
        b.setAttribute("aria-label", `خلية ${tier} لُعبت في هذه الجولة`);
      } else {
        b.innerHTML = `${tier}<small>${bankLeft}</small>`;
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

function renderTeams() {
  ["A", "B"].forEach((L, i) => {
    const t = state.teams[i];
    $("name" + L).textContent = t.name;
    $("score" + L).textContent = t.score;
    $("teamCard" + L).classList.toggle("active", state.turn === i);
    const box = $("helps" + L);
    if (box) {
      box.innerHTML = "";
      ["friend", "two", "dbl"].forEach((k) => {
        const s = document.createElement("span");
        s.className = "help-dot" + (t.helps[k] ? "" : " spent");
        s.textContent = HELP_LABEL[k];
        s.title = `${HELP_LABEL[k]}: ${t.helps[k] ? "متاحة" : "استُخدمت"}`;
        box.appendChild(s);
      });
    }
  });
  $("turnTeam").textContent = state.teams[state.turn].name;
}

function setUndoState() {
  const b = $("undoBtn");
  if (b) b.disabled = !state.lastSnapshot;
}

function render() {
  renderBoard();
  renderTeams();
  const left = state.picked.reduce((n, id) => n + catLeft(id), 0);
  const el = $("remaining");
  if (el) el.textContent = `${left} سؤالاً متبقياً في بنكك`;
  renderBankInfo();
  setUndoState();
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
  state.teams.forEach((t) => { t.dbl = false; t.twoActive = false; });

  $("qCat").textContent = cat.name;
  $("qValue").textContent = tier + " نقطة";
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
  $("phaseTeam").textContent = `دور ${team.name} · ${PHASE_TIME[p]} ثانية`;
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
    el.innerHTML = `<b>${esc(t.name)}</b><small><span dir="ltr">+${j.pts}</span>${j.dbl ? " (دبل)" : ""}</small>`;
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

  // نسخة عميقة قبل أي تعديل — للتراجع
  state.lastSnapshot = {
    teams: JSON.parse(JSON.stringify(state.teams)),
    turn: state.turn,
    played: state.played,
    roundUsed: JSON.parse(JSON.stringify(state.roundUsed)),
    q: { catId, idx, wasUsedBefore: isUsed(catId, idx) },
  };

  let msg = "لا نقاط";
  if (teamIndex !== null && teamIndex !== undefined) {
    const t = state.teams[teamIndex];
    const pts = q.d * (t.dbl ? 2 : 1);
    t.score += pts;
    sfx.ok();
    msg = `+${pts} لـ${t.name}`;
  } else { sfx.no(); }

  // يُحفظ السؤال لاسم اللاعب: لا يعود إليه أبداً
  state.bank[catId] = state.bank[catId] || {};
  state.bank[catId][idx] = true;
  saveBank();

  state.roundUsed[roundId(catId, slot)] = true;
  state.teams.forEach((t) => { t.dbl = false; t.twoActive = false; });
  state.played += 1;

  closeQuestion();
  state.turn = 1 - state.turn;
  render();
  saveRound();
  checkEnd();
  setUndoState();
  toast(msg, 7000, { label: "تراجع", fn: undoLastAward });
}

function undoLastAward() {
  const s = state.lastSnapshot;
  if (!s) return false;

  state.teams = JSON.parse(JSON.stringify(s.teams));
  state.teams.forEach((t) => { t.dbl = false; t.twoActive = false; });
  state.turn = s.turn;
  state.played = s.played;
  state.roundUsed = JSON.parse(JSON.stringify(s.roundUsed || {}));

  const { catId, idx, wasUsedBefore } = s.q;
  if (!wasUsedBefore && state.bank[catId]) delete state.bank[catId][idx];
  state.lastSnapshot = null;

  saveBank();
  if ($("qModal").classList.contains("open")) closeQuestion();
  $("winModal").classList.remove("open");
  render();
  saveRound();
  toast("تم التراجع عن آخر حكم", 2600);
  return true;
}

function closeQuestion() {
  clearInterval(state.timer);
  state.timer = null;
  $("qModal").classList.remove("open");
  $("activeHelps").hidden = true;
  $("activeHelps").innerHTML = "";
  state.active = null;
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
  state.lastSnapshot = null;
  render();
  saveRound();
  closeScoreEditor();
  toast(`صارت نقاط ${state.teams[i].name} ${v}`, 2600);
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
  if (kind === "dbl") { t.dbl = true; toast(`${t.name} ضاعف نقاط السؤال`); }

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
  [["friend", "صديق", "+دقيقة"], ["two", "جوابين", "إجابتان"], ["dbl", "دبل", "×2"]].forEach(([k, label, sub]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "help";
    b.innerHTML = `${label} · <span style="opacity:.55">${sub}</span>`;
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
      const name = team ? team.name : "";
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
  state.lastSnapshot = null;
  $("setup").classList.remove("active");
  $("board").classList.add("active");
  render();
  saveRound();
}

function backToSetup() {
  state.picked = [];
  state.roundUsed = {};
  state.played = 0;
  state.lastSnapshot = null;
  setUndoState();
  $("board").classList.remove("active");
  $("setup").classList.add("active");
  renderPicker();
  renderBankInfo();
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
  $("loginBtn").addEventListener("click", () => enterSite($("loginName").value));
  $("loginName").addEventListener("keydown", (e) => { if (e.key === "Enter") enterSite($("loginName").value); });
  $("switchUser").addEventListener("click", logout);

  $("startBtn").addEventListener("click", () => { beep(600, .08); startGame(); });
  document.querySelectorAll("#catTabs .cat-tab").forEach((t) => {
    t.addEventListener("click", () => {
      state.catFilter = t.dataset.filter || "all";
      renderPicker();
    });
  });
  $("rulesBtn").addEventListener("click", () => $("rulesModal").classList.add("open"));
  $("closeRules").addEventListener("click", () => $("rulesModal").classList.remove("open"));
  $("revealBtn").addEventListener("click", reveal);
  $("nextTeamBtn").addEventListener("click", () => { if (state.phase === 0 && state.active) startPhase(1); });
  $("closeQBtn").addEventListener("click", closeQuestion);
  $("judgeA").addEventListener("click", () => award(0));
  $("judgeB").addEventListener("click", () => award(1));
  $("judgeNone").addEventListener("click", () => award(null));
  $("undoBtn").addEventListener("click", undoLastAward);

  // تعديل النقاط: اضغط رقم الفريق
  [["A", 0], ["B", 1]].forEach(([L, i]) => {
    const b = $("score" + L);
    if (b) b.addEventListener("click", () => openScoreEditor(i));
  });
  $("closeScore").addEventListener("click", closeScoreEditor);
  $("seCancel").addEventListener("click", closeScoreEditor);
  $("seSave").addEventListener("click", commitScore);
  $("seInput").addEventListener("keydown", (e) => {
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

  $("exportBank").addEventListener("click", exportBank);
  $("importBank").addEventListener("click", () => $("bankFile").click());
  $("bankFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    importBankFile(f);
  });

  $("soundBtn").addEventListener("click", () => {
    state.sound = !state.sound;
    saveSound();
    $("soundBtn").style.opacity = state.sound ? "1" : ".35";
    if (state.sound) beep(600, .06);
  });
  $("fullBtn").addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  $("endBtn").addEventListener("click", () => { if (!state.active) showWinner(); });
  $("restartBtn").addEventListener("click", () => $("confirmModal").classList.add("open"));
  $("confirmNo").addEventListener("click", () => $("confirmModal").classList.remove("open"));
  $("confirmYes").addEventListener("click", () => {
    $("confirmModal").classList.remove("open");
    clearRound(state.user);
    backToSetup();
  });
  $("playAgain").addEventListener("click", () => {
    $("winModal").classList.remove("open");
    clearRound(state.user);
    backToSetup();
  });

  document.addEventListener("keydown", (e) => {
    if ($("scoreModal").classList.contains("open")) {
      if (e.key === "Escape") closeScoreEditor();
      return;
    }
    if (e.key === "Escape" && $("qModal").classList.contains("open")) { closeQuestion(); return; }
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

  /* --- خلية واحدة تُغلق فقط، وشقيقتها تبقى فعّالة --- */
  const cid = state.picked[0];
  const scoreBefore = state.teams[0].score;
  const usedBefore = bankCount();
  openQuestion(cid, 0);
  ok(!!state.active && state.active.slot === 0 && state.active.catId === cid, "فتح الخلية يحفظ slot في state.active");
  reveal();
  award(0);
  const c0 = cellOf(cid, 0), c1 = cellOf(cid, 1);
  ok(!!c0 && c0.classList.contains("used"), "الخلية الملعوبة بالذات تتحول إلى .used");
  ok(!!c1 && !c1.classList.contains("used") && !c1.disabled, "الخلية الثانية من نفس المستوى تبقى فعّالة");
  ok(state.roundUsed[cid + ":0"] === true, "roundUsed يسجل الخلية الملعوبة");
  ok(state.roundUsed[cid + ":1"] !== true, "roundUsed لا يسجل الخلية الأخرى");
  ok(state.teams[0].score === scoreBefore + TIERS[0], "النقاط تُضاف بدرجة السؤال");

  /* --- التراجع عن آخر حكم --- */
  ok(undoLastAward() === true, "التراجع عن آخر حكم متاح بعد الحكم");
  const c0b = cellOf(cid, 0);
  ok(state.teams[0].score === scoreBefore, "التراجع يعيد النقاط كما كانت");
  ok(!!c0b && !c0b.classList.contains("used"), "التراجع يعيد الخلية إلى اللوحة");
  ok(bankCount() === usedBefore, "التراجع يحذف السؤال من سجل البنك");
  ok(!state.roundUsed[cid + ":0"], "التراجع يمسح علامة الجولة");

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
  state.lastSnapshot = { teams: JSON.parse(JSON.stringify(state.teams)) };
  setUndoState();
  openScoreEditor(1); $("seInput").value = "-50"; commitScore();
  ok(state.teams[1].score === 0, "النقاط لا تنزل تحت الصفر");
  ok(state.lastSnapshot === null && $("undoBtn").disabled === true, "التعديل اليدوي يلغي تراجع الحكم السابق");
  state.teams[1].score = 0; render(); saveRound();
  ok(state.teams[0].score === scBefore, "تعديل فريق لا يمس فريقاً آخر");

  /* --- حفظ واستئناف الجولة --- */
  const r0 = loadRound(state.user);
  ok(!!r0 && r0.activeRound === true && r0.picked.length === PICK && r0.played === 0, "saveRound يحفظ الجولة عند البدء");
  openQuestion(cid, 0);
  reveal();
  award(1);
  const r1 = loadRound(state.user);
  ok(!!r1 && r1.played === 1 && r1.roundUsed[cid + ":0"] === true
    && r1.teams[1].score === TIERS[0] && r1.turn === 1, "الحفظ يحتوي النقاط والدور والخلية الملعوبة");
  undoLastAward();
  const r2 = loadRound(state.user);
  ok(!!r2 && r2.played === 0 && r2.teams[1].score === 0 && !r2.roundUsed[cid + ":0"], "التراجع يعيد حفظ الجولة كما كانت");

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

  const pre = document.createElement("pre");
  pre.id = "selftest";
  pre.textContent = log.join("\n");
  document.body.appendChild(pre);
  document.title = log.some((l) => l.startsWith("FAIL")) ? "SELFTEST_FAIL" : "SELFTEST_PASS";
}

loadSound();
bind();
const _sb = $("soundBtn");
if (_sb) _sb.style.opacity = state.sound ? "1" : ".35";

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
