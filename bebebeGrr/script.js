// ========================= Mini-School (Ollama-only) =========================
// Требуется: запущенный ollama serve с CORS (см. подсказку в index.html)
// Безопасный вывод, таймауты, бэкофф, строгий JSON и fallback-набор
// ============================================================================

/* ----------------------------- utils/helpers ----------------------------- */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setSafeText(el, text) {
  if (!el) return;
  el.textContent = String(text ?? "");
}

function stripCodeFences(text) {
  // удаляем ```json ... ```
  return String(text).replace(/```[\s\S]*?```/g, m => m.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

function safeParseJSON(text){
  const t = stripCodeFences(text).trim();
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) {
    const sliced = t.slice(s, e + 1);
    try { return JSON.parse(sliced); } catch {}
  }
  throw new Error("Bad JSON from model");
}

async function fetchWithTimeout(url, options = {}, ms = 30000) {
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(new Error("Request timeout")), ms);
  try {
    const res = await fetch(url, { ...options, signal: c.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function withBackoff(fn, { retries = 2, baseMs = 600 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const retriable = status ? [429, 500, 502, 503, 504].includes(status) : true;
      if (attempt >= retries || !retriable) throw err;
      const delay = baseMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

/* ------------------------------- storage LS ------------------------------ */
const LS = {
  get ob() { return localStorage.getItem("OLLAMA_BASE") || "http://localhost:11434"; },
  set ob(v) { localStorage.setItem("OLLAMA_BASE", v || ""); },

  get om() { return localStorage.getItem("OLLAMA_MODEL") || "qwen2.5:0.5b"; },
  set om(v) { localStorage.setItem("OLLAMA_MODEL", v || ""); },
};

/* ------------------------------- UI config ------------------------------- */
function setLLMStatus(t){ const el=$("#llmStatus"); if(el) el.textContent=t; }

function initCfgUI(){
  $("#ollamaBase").value  = LS.ob;
  $("#ollamaModel").value = LS.om;

  $("#saveOllamaCfg").addEventListener("click", ()=>{
    LS.ob = $("#ollamaBase").value.trim();
    LS.om = $("#ollamaModel").value.trim();
    setLLMStatus("Saved Ollama settings ✅");
  });
}

/* --------------------------------- LLM ---------------------------------- */
async function callOllamaChat(base, model, userPrompt){
  if(!base)  throw new Error("Ollama Base is empty");
  if(!model) throw new Error("Ollama model is empty");

  const url = base.replace(/\/+$/,"") + "/api/chat";
  const headers = { "Content-Type":"application/json" };
  // Чуть строже детерминизм для JSON
  const body = {
    model,
    messages:[{ role:"user", content:userPrompt }],
    stream:false,
    options:{ temperature:0.2, top_p:0.9, num_ctx:4096 }
  };

  const exec = async () => {
    const res = await fetchWithTimeout(url, { method:"POST", headers, body: JSON.stringify(body) }, 30000);
    if(!res.ok){
      const t = await res.text().catch(()=>res.statusText);
      const err = new Error(`Ollama error ${res.status}: ${t}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const content = json?.message?.content;
    return content || "";
  };

  return withBackoff(exec, { retries: 2, baseMs: 700 });
}

/* -------------------------- quiz generation flow ------------------------- */
async function generateAIQuiz(topic,count=5,difficulty="easy",lang="ru"){
  const c = Math.max(2, Math.min(Number(count)||5, 10)); // 2..10
  const diff = ["easy","medium","hard"].includes(difficulty) ? difficulty : "easy";

  const prompt = `
Generate ${c} short, clear multiple-choice questions about "${topic}".
Difficulty: ${diff}. Language: ${lang}.
Answer STRICTLY in JSON:
{"questions":[{"q":"...", "a":["A","B","C"], "correct":0}]}
No comments, no markdown, no extra text.
`.trim();

  try{
    setLLMStatus("Запрос к Ollama…");
    $("#btnLLM")?.setAttribute("disabled","true");

    const raw = await callOllamaChat(LS.ob, LS.om, prompt);
    const data = safeParseJSON(raw);
    const arr  = normalizeQuestions(data?.questions);
    if(!arr.length) throw new Error("Empty normalized");

    useQuestions(arr);
    startQuiz();
    setLLMStatus(`Сгенерировано: ${arr.length} вопросов ✅`);
  }catch(err){
    console.error(err);
    setLLMStatus(`Ошибка: ${err?.message || err}. Показан запасной набор.`);
    alert(`Ошибка генерации:\n${err?.message || err}\nПоказываю запасной набор.`);
    useQuestions(defaultQuestions);
    startQuiz();
  } finally {
    $("#btnLLM")?.removeAttribute("disabled");
  }
}

function normalizeQuestions(arr){
  if(!Array.isArray(arr)) return [];
  return arr.map(q=>{
    const a = Array.isArray(q.a) ? q.a.map(s=>String(s).slice(0,200)).slice(0,5) : [];
    let idx = Number.isInteger(q.correct) ? q.correct : 0;
    if (a.length === 0) idx = 0;
    else idx = Math.max(0, Math.min(idx, a.length - 1));
    return {
      q: String(q.q||"").slice(0,500),
      a,
      correct: idx
    };
  }).filter(x=>x.q && x.a.length>=2);
}

/* ---------------------------- sections / quiz ---------------------------- */
function showSection(id){
  $$("section").forEach(s=>s.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}
window.showSection = showSection;

let quizQuestions = [
  {q:"HTML is used for...",a:["Styling","Page markup","Programming"],correct:1},
  {q:"CSS отвечает за...",a:["Стиль","Хранилище данных","Сеть"],correct:0},
  {q:"JS is used for...",a:["Interactive elements","Only layout","Databases"],correct:0}
];
const defaultQuestions = structuredClone(quizQuestions);
let quizIndex = 0, score = 0;

function useQuestions(arr){
  if(Array.isArray(arr)&&arr.length) quizQuestions = arr;
  quizIndex = 0; score = 0; updateProgress();
}

function startQuiz(){
  quizIndex = 0; score = 0;
  $("#btnNext").disabled = true;
  showQuestion();
  updateProgress();
}

function updateProgress(){
  const total = quizQuestions.length;
  const bar = $("#quizBar");
  const cnt = $("#quizCount");
  const pct = total ? Math.round(100 * (quizIndex/total)) : 0;
  if (bar) bar.style.width = pct + "%";
  if (cnt) cnt.textContent = `${Math.min(quizIndex,total)}/${total}`;
}

function showQuestion(){
  const c=$("#quiz-container");
  if(quizIndex>=quizQuestions.length){
    c.innerHTML = "";
    const p = document.createElement("p");
    p.innerHTML = `Your result is: <b>${score}</b> / ${quizQuestions.length}`;
    c.appendChild(p);
    $("#btnNext").disabled = true;
    // best score
    const best = Number(localStorage.getItem("BEST_SCORE")||0);
    const curr = Math.max(best, score);
    localStorage.setItem("BEST_SCORE", String(curr));
    setSafeText($("#bestScore"), `Best: ${curr}/${quizQuestions.length}`);
    return;
  }
  const q=quizQuestions[quizIndex];

  c.innerHTML = "";
  const h = document.createElement("h3");
  setSafeText(h, q.q);
  c.appendChild(h);

  q.a.forEach((ans,i)=>{
    const b=document.createElement("button");
    setSafeText(b, ans);
    b.type = "button";
    b.addEventListener("click", ()=>{
      if(i===q.correct) score++;
      $("#btnNext").disabled = false;
      $$("#quiz-container button").forEach(btn=>btn.disabled=true);
    });
    c.appendChild(b);
  });
}

$("#btnNext").addEventListener("click", ()=>{
  quizIndex++;
  $("#btnNext").disabled = true;
  showQuestion();
  updateProgress();
});

$("#btnStart").addEventListener("click", ()=> startQuiz());

/* ------------------------------- flashcards ------------------------------ */
const cards=[
  {front:"HTML",back:"Language of markup (structure)"},
  {front:"CSS",back:"Cascade style sheets (presentation)"},
  {front:"JS",back:"Programming language for interactivity"},
];
let cardIndex=0;

function nextCard(){
  const c=$("#card-container");
  const card=cards[cardIndex];
  c.innerHTML=`<div class="card" onclick="flipCard(this)">${card.front}</div>`;
  cardIndex=(cardIndex+1)%cards.length;
}
function flipCard(el){
  const current=el.textContent;
  const card=cards.find(c=>c.front===current||c.back===current);
  el.textContent=(current===card.front)?card.back:card.front;
}
window.nextCard=nextCard;
window.flipCard=flipCard;

/* --------------------------------- init --------------------------------- */
document.addEventListener("DOMContentLoaded",()=>{
  initCfgUI();
  nextCard();

  // best score init
  const best = Number(localStorage.getItem("BEST_SCORE")||0);
  if (!Number.isNaN(best) && best > 0) setSafeText($("#bestScore"), `Best: ${best}`);

  $("#btnLLM")?.addEventListener("click",()=>{
    const topic=($("#llmTopic")?.value||"web basics").trim();
    const count=parseInt($("#llmCount")?.value||"5",10);
    const diff=$("#llmDiff")?.value||"easy";
    showSection("quiz");
    generateAIQuiz(topic,count,diff,"ru");
  });

  // тема с сохранением
  const THEME_KEY = "THEME_MODE";
  const applyTheme = (mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  };
  applyTheme(localStorage.getItem(THEME_KEY) || "light");

  $("#themeToggle")?.addEventListener("click", ()=>{
    const mode = document.documentElement.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem(THEME_KEY, mode);
    applyTheme(mode);
  });
});
