// ---------- провайдеры ИИ: OpenAI-совместимый / Ollama ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const LS = {
  get k() { return localStorage.getItem("AI_KEY") || ""; },
  set k(v) { localStorage.setItem("AI_KEY", v || ""); },

  get b() { return localStorage.getItem("AI_BASE") || "https://api.openai.com/v1"; },
  set b(v) { localStorage.setItem("AI_BASE", v || ""); },

  get m() { return localStorage.getItem("AI_MODEL") || "gpt-4o-mini"; },
  set m(v) { localStorage.setItem("AI_MODEL", v || ""); },

  get ob() { return localStorage.getItem("OLLAMA_BASE") || "http://localhost:11434"; },
  set ob(v) { localStorage.setItem("OLLAMA_BASE", v || ""); },

  get om() { return localStorage.getItem("OLLAMA_MODEL") || "qwen2.5:0.5b"; },
  set om(v) { localStorage.setItem("OLLAMA_MODEL", v || ""); },

  get p() { return localStorage.getItem("AI_PROVIDER") || "openai"; },
  set p(v) { localStorage.setItem("AI_PROVIDER", v || "openai"); },
};

function initCfgUI(){
  $("#aiProvider").value = LS.p;
  $("#apiBase").value    = LS.b;
  $("#apiKey").value     = LS.k;
  $("#apiModel").value   = LS.m;

  $("#ollamaBase").value  = LS.ob;
  $("#ollamaModel").value = LS.om;

  toggleProv(LS.p);

  $("#aiProvider").addEventListener("change", e=>{
    LS.p = e.target.value;
    toggleProv(LS.p);
  });

  $("#saveCfg").addEventListener("click", ()=>{
    LS.b = $("#apiBase").value.trim();
    LS.k = $("#apiKey").value.trim();
    LS.m = $("#apiModel").value.trim();
    setLLMStatus("Saved OpenAI-compatible settings ✅");
  });

  $("#saveOllamaCfg").addEventListener("click", ()=>{
    LS.ob = $("#ollamaBase").value.trim();
    LS.om = $("#ollamaModel").value.trim();
    setLLMStatus("Saved Ollama settings ✅");
  });
}

function toggleProv(p){
  $("#openaiCfg").style.display = p==="openai" ? "flex" : "none";
  $("#ollamaCfg").style.display = p==="ollama" ? "flex" : "none";
  $("#provTip").textContent = p==="openai"
    ? "Use API Base & Key for any OpenAI-compatible endpoint. Example: https://api.openai.com/v1"
    : "Run: `ollama run qwen2.5:0.5b` (or your model). Base defaults to http://localhost:11434";
}

function setLLMStatus(t){ const el=$("#llmStatus"); if(el) el.textContent=t; }

// ---------- генерация квиза через выбранный провайдер ----------
async function generateAIQuiz(topic,count=5,difficulty="easy",lang="ru"){
  const prompt = `
Generate ${count} short, clear multiple-choice questions about "${topic}".
Difficulty: ${difficulty}. Language: ${lang}.
Answer STRICTLY in JSON:
{"questions":[{"q":"...", "a":["A","B","C"], "correct":0}]}
No comments, no markdown, no extra text.
`.trim();

  try{
    setLLMStatus("Запрос к модели…");
    const provider = LS.p;
    let raw = "";

    if (provider === "openai") {
      raw = await callOpenAIChat(LS.b, LS.k, LS.m, prompt);
    } else {
      raw = await callOllamaChat(LS.ob, LS.om, prompt);
    }

    const data = safeParseJSON(raw);
    const arr = normalizeQuestions(data?.questions);
    if(!arr.length) throw new Error("Empty normalized");

    useQuestions(arr);
    startQuiz();
    setLLMStatus(`Сгенерировано: ${arr.length} вопросов ✅`);
  }catch(err){
    console.error(err);
    setLLMStatus("Не удалось сгенерировать. Показан запасной набор.");
    alert("Ошибка генерации. Проверь настройки/ключ/доступ. Падём на запасной набор.");
    // фолбэк — встроенные вопросы
    useQuestions(defaultQuestions);
    startQuiz();
  }
}

function safeParseJSON(text){
  try { return JSON.parse(text); } catch {}
  // пытаемся вырезать блок JSON
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e+1)); } catch {}
  }
  throw new Error("Bad JSON from model");
}

function normalizeQuestions(arr){
  if(!Array.isArray(arr)) return [];
  return arr.map(q=>({
    q: String(q.q||"").slice(0,500),
    a: Array.isArray(q.a) ? q.a.map(s=>String(s).slice(0,200)).slice(0,5) : [],
    correct: Number.isInteger(q.correct) ? q.correct : 0
  })).filter(x=>x.q && x.a.length>=2);
}

// --- OpenAI-совместимый endpoint (/v1/chat/completions) ---
async function callOpenAIChat(base, apiKey, model, userPrompt){
  if(!base) throw new Error("API Base is empty");
  if(!model) throw new Error("Model is empty");

  const url = base.replace(/\/+$/,"") + "/chat/completions";
  const headers = { "Content-Type":"application/json" };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

  const body = {
    model,
    temperature: 0.4,
    messages: [{ role:"user", content:userPrompt }]
  };

  const res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
  if(!res.ok){
    const t = await res.text().catch(()=>res.statusText);
    throw new Error(`OpenAI-compatible error ${res.status}: ${t}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content || "";
}

// --- Ollama (/api/chat) ---
async function callOllamaChat(base, model, userPrompt){
  if(!base) throw new Error("Ollama Base is empty");
  if(!model) throw new Error("Ollama model is empty");

  const url = base.replace(/\/+$/,"") + "/api/chat";
  const headers = { "Content-Type":"application/json" };
  const body = {
    model,
    messages:[{ role:"user", content:userPrompt }],
    stream:false,
    options:{ temperature:0.4 }
  };

  const res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
  if(!res.ok){
    const t = await res.text().catch(()=>res.statusText);
    throw new Error(`Ollama error ${res.status}: ${t}`);
  }
  const json = await res.json();
  // Ollama может вернуть либо message.content, либо массив частей
  const content = json?.message?.content
    || (Array.isArray(json?.message?.tool_calls) ? "" : "");
  return content || "";
}

// ---------- старая логика секций/квиза/карточек ----------
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

function useQuestions(arr){ if(Array.isArray(arr)&&arr.length) quizQuestions=arr; quizIndex=0; score=0; updateProgress(); }
function startQuiz(){ quizIndex=0; score=0; $("#btnNext").disabled = true; showQuestion(); updateProgress(); }
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
    c.innerHTML = `<p>Your result is: <b>${score}</b> / ${quizQuestions.length}</p>`;
    $("#btnNext").disabled = true;
    return;
  }
  const q=quizQuestions[quizIndex];
  c.innerHTML=`<h3>${q.q}</h3>`;
  q.a.forEach((ans,i)=>{
    const b=document.createElement("button");
    b.textContent=ans;
    b.onclick=()=>{
      if(i===q.correct) score++;
      $("#btnNext").disabled = false;
      // блокируем повторный клик по вариантам
      $$("#quiz-container button").forEach(btn=>btn.disabled=true);
    };
    c.appendChild(b);
  });
}

$("#btnNext").addEventListener("click", ()=>{
  quizIndex++;
  $("#btnNext").disabled = true;
  showQuestion();
  updateProgress();
});

// ---------- карточки ----------
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

// ---------- init ----------
document.addEventListener("DOMContentLoaded",()=>{
  initCfgUI();
  nextCard();
  $("#btnLLM")?.addEventListener("click",()=>{
    const topic=($("#llmTopic")?.value||"web basics").trim();
    const count=parseInt($("#llmCount")?.value||"5",10);
    const diff=$("#llmDiff")?.value||"easy";
    showSection("quiz");
    generateAIQuiz(topic,count,diff,"ru");
  });
});

// (опционально) тема
$("#themeToggle")?.addEventListener("click", ()=>{
  document.documentElement.classList.toggle("dark");
});
