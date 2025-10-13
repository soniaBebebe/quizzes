let webLLM;
let webLLMReady = false;
const LLM_MODEL = 'phi-2-q4f16_1-MLC';

const llmStatusEl = document.getElementById('llmStatus');
const btnLLM = document.getElementById('btnLLM');

function setLLMStatus(t){ if (llmStatusEl) llmStatusEl.textContent = t; }
function hasWebGPU(){ return !!navigator.gpu; }


async function waitForWebLLM() {
  if (window.mlc?.WebLLM) return;
  await new Promise(resolve => {
    const t = setInterval(() => {
      if (window.mlc?.WebLLM) { clearInterval(t); resolve(); }
    }, 200);
  });
}

async function initWebLLM(){
  if (webLLMReady) return webLLM;

  if (!hasWebGPU()) {
    setLLMStatus('WebGPU не поддерживается в этом браузере.');
    throw new Error('No WebGPU');
  }

  setLLMStatus('Загрузка модели… (первая загрузка может занять время)');
  // ждём, пока подтянется библиотека
  await waitForWebLLM().catch(err=>{
    console.error('WebLLM load error:', err);
    setLLMStatus('Библиотека WebLLM не загрузилась. Проверь интернет/блокировщики.');
    throw err;
  });

  // создаём модуль
  webLLM = new window.mlc.WebLLM.ChatModule({
    context_window_size: 2048,
    model_list: [LLM_MODEL, LLM_FALLBACK]
  });

  // прогресс
  let lastPct = 0;
  const onProgress = (r) => {
    const pct = Math.round((r.progress || 0) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      setLLMStatus(`Загрузка: ${pct}% ${r.text || ''}`);
    }
}
};

function extractJSON(text){
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('No JSON block');
  return text.slice(s, e + 1);
}


async function generateLocalQuiz(topic, count=5, difficulty='easy', lang='ru'){
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
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const raw = reply?.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = JSON.parse(extractJSON(raw)); }

    if (!Array.isArray(parsed?.questions)) throw new Error('Bad questions');

    const arr = parsed.questions.map(q => ({
      q: String(q.q || '').slice(0, 500),
      a: Array.isArray(q.a) ? q.a.map(s => String(s).slice(0, 200)).slice(0, 5) : [],
      correct: Number.isInteger(q.correct) ? q.correct : 0
    })).filter(x => x.q && x.a.length >= 2);

    if(!arr.length) throw new Error('Empty normalized');

    useQuestions(arr);
    startQuiz();
    setLLMStatus(`Сгенерировано: ${arr.length} вопросов`);
  }
  catch(err){
    console.error(err);
    setLLMStatus('Не удалось сгенерировать локально.');
    alert('Ошибка генерации: проверь WebGPU / перезагрузи страницу.');
  }
}


function showSection(id){
  document.querySelectorAll('section').forEach(sec => sec.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}


let quizQuestions = [
  {q:"HTML is used for...", a:["Styling","Page markup","Programming"], correct:1},
  {q:"CSS отвечает за...", a:["Стиль","Хранилище данных","Сеть"], correct:0},
  {q:"JS is used for...", a:["Interactive elements","Only layout","Databases"], correct:0}
];

let quizIndex = 0, score = 0;

function useQuestions(arr){
  if (Array.isArray(arr) && arr.length) quizQuestions = arr;
  quizIndex = 0; score = 0;
}

function startQuiz(){
  quizIndex = 0;
  score = 0;
  showQuestion();
}

function showQuestion(){
  const container = document.getElementById('quiz-container');
  if (quizIndex >= quizQuestions.length){
    container.innerHTML = `<p>Your result is: <b>${score}</b> / ${quizQuestions.length}</p>`;
    return;
  }
  const q = quizQuestions[quizIndex];
  container.innerHTML = `<h3>${q.q}</h3>`;
  q.a.forEach((ans, i)=>{
    const btn = document.createElement('button');
    btn.textContent = ans;
    btn.onclick = ()=>{
      if (i === q.correct) score++;
      quizIndex++;
      showQuestion();
    };
    container.appendChild(btn);
  });
}


const cards = [
  {front:"HTML", back:"Language of markup (structure)"},
  {front:"CSS",  back:"Cascade style sheets (presentation)"},
  {front:"JS",   back:"Programming language for interactivity"},
];

let cardIndex = 0;
function nextCard(){
  const container = document.getElementById("card-container");
  const card = cards[cardIndex];
  container.innerHTML = `<div class="card" onclick="flipCard(this)">${card.front}</div>`;
  cardIndex = (cardIndex + 1) % cards.length;
}

function flipCard(el){
  const current = el.textContent;
  const card = cards.find(c => c.front === current || c.back === current);
  el.textContent = (current === card.front) ? card.back : card.front;
}


document.addEventListener("DOMContentLoaded", () => {
  nextCard();
});


btnLLM?.addEventListener('click', () => {
  const topic = (document.getElementById('llmTopic')?.value || 'web basics').trim();
  const count = parseInt(document.getElementById('llmCount')?.value || '5', 10);
  const diff  = document.getElementById('llmDiff')?.value || 'easy';
  showSection('quiz');
  generateLocalQuiz(topic, count, diff, 'ru');
});
