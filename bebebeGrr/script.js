import * as webllm from "https://esm.run/@mlc-ai/web-llm@0.2.53";
// ---------- надёжная автозагрузка WebLLM ----------
const WEBLLM_URLS = [
    // 1) локальные (если положишь файл рядом с index.html)
    "web-llm.min.js",        // ← относительный путь (самый надёжный для Live Server)
    "./web-llm.min.js",
  
    // 2) CDN (несколько названий файлов в разных версиях)
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.53/dist/index.min.js",
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.53/dist/web-llm.min.js",
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.53/dist/webllm.min.js",
  
    "https://unpkg.com/@mlc-ai/web-llm@0.2.53/dist/index.min.js",
    "https://unpkg.com/@mlc-ai/web-llm@0.2.53/dist/web-llm.min.js",
    "https://unpkg.com/@mlc-ai/web-llm@0.2.53/dist/webllm.min.js",
  
    // 3) ESM как крайний вариант — потребует "клея" ниже
    "https://esm.run/@mlc-ai/web-llm@0.2.53"
  ];
  
  function loadScript(src, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      let done = false;
      const to = setTimeout(() => {
        if (done) return;
        done = true; s.remove();
        reject(new Error("timeout: " + src));
      }, timeoutMs);
      s.src = src;
      s.async = true;
      s.onload = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      s.onerror = () => { if (!done) { done = true; clearInterval(to); reject(new Error("load failed: " + src)); } };
      document.head.appendChild(s);
    });
  }
  
  async function ensureWebLLMScript() {
    if (window.mlc?.WebLLM) return;
    let lastErr;
    for (const url of WEBLLM_URLS) {
      try {
        console.log("🔹 loading", url);
        // Особый случай: ESM
        if (/^https:\/\/esm\.run\//.test(url)) {
          const mod = await import(/* @vite-ignore */ url);
          if (mod) {
            window.mlc = window.mlc || {};
            window.mlc.WebLLM = mod;
          }
        } else {
          await loadScript(url);
        }
        if (window.mlc?.WebLLM) return;
      } catch (e) {
        lastErr = e;
        console.warn("WebLLM load try failed:", url, e);
      }
    }
    throw lastErr || new Error("WebLLM script not ready");
  }
  
  async function waitForWebLLM(maxMs = 8000) {
    if (window.mlc?.WebLLM) return;
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        if (window.mlc?.WebLLM) { clearInterval(id); resolve(); }
        else if (Date.now() - t0 > maxMs) { clearInterval(id); reject(new Error("WebLLM script not ready")); }
      }, 150);
    });
  }
  
  // ---------- инициализация ----------
  let webLLM, webLLMReady = false;
  const LLM_MODEL    = "phi-2-q4f16_1-MLC";
  const LLM_FALLBACK = "qwen2.5-0.5b-instruct-q4f16_1-MLC";
  
  function hasWebGPU(){ return !!navigator.gpu; }
  function setLLMStatus(t){ const el=document.getElementById("llmStatus"); if(el) el.textContent=t; }
  
  async function initWebLLM(){
    if (webLLMReady) return webLLM;
    if (!hasWebGPU()){
      setLLMStatus("WebGPU не поддерживается.");
      throw new Error("No WebGPU");
    }
  
    setLLMStatus("Загрузка модели… (первая загрузка может занять время)");
    await ensureWebLLMScript();
    await waitForWebLLM();
  
    webLLM = new webllm.ChatModule({
      context_window_size: 2048,
      model_list: [LLM_MODEL, LLM_FALLBACK],
    });
  
    let lastPct = 0;
    const onProgress = (r)=>{
      const pct = Math.round((r.progress||0)*100);
      if (pct!==lastPct){ lastPct=pct; setLLMStatus(`Загрузка: ${pct}% ${r.text||""}`); }
    };
    const watchdog = (ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error("download-timeout")),ms));
  
    try{
      console.log("⏳ reload primary", LLM_MODEL);
      await Promise.race([
        webLLM.reload(LLM_MODEL,{progress_callback:onProgress}),
        watchdog(60000)
      ]);
    }catch(e1){
      console.warn("Primary failed, fallback:", e1);
      setLLMStatus("Переключаюсь на лёгкую модель…");
      await Promise.race([
        webLLM.reload(LLM_FALLBACK,{progress_callback:onProgress}),
        watchdog(60000)
      ]);
    }
  
    webLLMReady = true;
    setLLMStatus("Модель готова ✅");
    return webLLM;
  }
  
  // ---------- утилиты ----------
  function extractJSON(text){
    const s=text.indexOf("{"), e=text.lastIndexOf("}");
    if(s===-1||e===-1||e<=s) throw new Error("No JSON block");
    return text.slice(s,e+1);
  }
  
  // ---------- генерация квиза ----------
  async function generateLocalQuiz(topic,count=5,difficulty="easy",lang="ru"){
    try{
      await initWebLLM();
      const prompt = `
  Generate ${count} questions with one correct answer about "${topic}".
  Difficulty: ${difficulty}, language: ${lang}.
  Answer STRICTLY in JSON:
  {"questions":[{"q":"...", "a":["A","B","C"], "correct":0}]}
  No comments.
  `.trim();
  
      const reply = await webLLM.chat.completions.create({
        messages:[{role:"user",content:prompt}],
        temperature:0.7,
      });
  
      const raw = reply?.choices?.[0]?.message?.content || "";
      let parsed;
      try{ parsed = JSON.parse(raw); }
      catch{ parsed = JSON.parse(extractJSON(raw)); }
  
      if(!Array.isArray(parsed?.questions)) throw new Error("Bad questions");
  
      const arr = parsed.questions.map(q=>({
        q:String(q.q||"").slice(0,500),
        a:Array.isArray(q.a)?q.a.map(s=>String(s).slice(0,200)).slice(0,5):[],
        correct:Number.isInteger(q.correct)?q.correct:0
      })).filter(x=>x.q&&x.a.length>=2);
  
      if(!arr.length) throw new Error("Empty normalized");
  
      useQuestions(arr);
      startQuiz();
      setLLMStatus(`Сгенерировано: ${arr.length} вопросов`);
    }catch(err){
      console.error(err);
      setLLMStatus("Не удалось сгенерировать локально.");
      alert("Ошибка генерации: проверь WebGPU / блокировщики / перезагрузи страницу.");
    }
  }
  
  // ---------- интерфейс ----------
  function showSection(id){
    document.querySelectorAll("section").forEach(s=>s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
  }
  
  // ---------- логика квиза ----------
  let quizQuestions=[
    {q:"HTML is used for...",a:["Styling","Page markup","Programming"],correct:1},
    {q:"CSS отвечает за...",a:["Стиль","Хранилище данных","Сеть"],correct:0},
    {q:"JS is used for...",a:["Interactive elements","Only layout","Databases"],correct:0}
  ];
  let quizIndex=0,score=0;
  
  function useQuestions(arr){ if(Array.isArray(arr)&&arr.length) quizQuestions=arr; quizIndex=0; score=0; }
  function startQuiz(){ quizIndex=0; score=0; showQuestion(); }
  
  function showQuestion(){
    const c=document.getElementById("quiz-container");
    if(quizIndex>=quizQuestions.length){ c.innerHTML=`<p>Your result is: <b>${score}</b> / ${quizQuestions.length}</p>`; return; }
    const q=quizQuestions[quizIndex];
    c.innerHTML=`<h3>${q.q}</h3>`;
    q.a.forEach((ans,i)=>{
      const b=document.createElement("button");
      b.textContent=ans;
      b.onclick=()=>{ if(i===q.correct)score++; quizIndex++; showQuestion(); };
      c.appendChild(b);
    });
  }
  
  // ---------- карточки ----------
  const cards=[
    {front:"HTML",back:"Language of markup (structure)"},
    {front:"CSS",back:"Cascade style sheets (presentation)"},
    {front:"JS",back:"Programming language for interactivity"},
  ];
  let cardIndex=0;
  function nextCard(){
    const c=document.getElementById("card-container");
    const card=cards[cardIndex];
    c.innerHTML=`<div class="card" onclick="flipCard(this)">${card.front}</div>`;
    cardIndex=(cardIndex+1)%cards.length;
  }
  function flipCard(el){
    const current=el.textContent;
    const card=cards.find(c=>c.front===current||c.back===current);
    el.textContent=(current===card.front)?card.back:card.front;
  }
  
  // ---------- init ----------
  document.addEventListener("DOMContentLoaded",()=>{ nextCard(); });
  document.getElementById("btnLLM")?.addEventListener("click",()=>{
    const topic=(document.getElementById("llmTopic")?.value||"web basics").trim();
    const count=parseInt(document.getElementById("llmCount")?.value||"5",10);
    const diff=document.getElementById("llmDiff")?.value||"easy";
    showSection("quiz");
    generateLocalQuiz(topic,count,diff,"ru");
  });
  window.showSection=showSection;
  window.startQuiz=startQuiz;
  window.nextCard=nextCard;
  window.flipCard=flipCard;