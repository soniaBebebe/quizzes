let webLLM;
let webLLMReady=false;
const LLM_MODEL = 'qwen2.5-1.5b-instruct-q4f16_1-MLC'; 
const llmStatusEl = document.getElementById('llmStatus');
const btnLLM = document.getElementById('btnLLM');

function setLLMStatus(t){ if (llmStatusEl) llmStatusEl.textContent = t; }
function hasWebGPU(){ return !!navigator.gpu; }

async function initWebLLM(){
    if (webLLM) return webLLM;
    if (!hasWebGPU()){
        setLLMStatus('WEbGPU ne podderzhivaetsa v etom brauzere');
        throw new Error('No WebGPU');
    }
    setLLMStatus('Loading models... (First download may take time)');

    webLLM=new window.mlc.WebLLM.ChatModule({
        context_window_size: 2048,
        model_list: [LLM_MODEL]
    });
    const onProgress=(r)=>{
        const pct=Math.round((r.progress || 0)*100);
        setLLMStatus(`Downloading: ${pct}% ${r.text || ''}`);
    };
    await webLLM.reload(LLM_MODEL, {progress_callback: onProgress});
    webLLMReady=true;
    setLLMStatus('Model is ready.');
    return webLLM;
}

function extractJSON(text){
    const s=text.indexOf('{');
    const e=text.lastIndexOf('}');
    if (s===-1 || e===-1 || e<=s) throw new Error('No JSON block');
    return text.slice(s,e+1);
}

async function generateLocalQuiz(topic, count=5, difficulty='easy', lang='ru'){
    try{    
    await initWebLLM();
    const prompt=`generate ${count} of questions with one correct answer, using theme "${topic}". The difficulty should be ${difficulty}, language: ${lang}. The answer strictly in JSON: {"questions":[{"q":"...", "a":["A","B","C"], "correct":0}]} No comments.`
    .trim();
    const reply=await webLLM.chat.completions.create({
        messages: [{role: 'user', content: prompt}],
        temperature: 0.7,
    })

    const raw = reply?.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(raw); }        // пробуем сразу
    catch { parsed = JSON.parse(extractJSON(raw)); } // иначе вырезаем {}

    if (!Array.isArray(parsed?.questions)) throw new Error('Bad questions');

    const arr = parsed.questions.map(q => ({
      q: String(q.q || '').slice(0, 500),
      a: Array.isArray(q.a) ? q.a.map(s => String(s).slice(0, 200)).slice(0, 5) : [],
      correct: Number.isInteger(q.correct) ? q.correct : 0
    })).filter(x => x.q && x.a.length >= 2);

    if(!arr.length) throw new Error('Empty normalized');

    useQuestions(arr);
    startQuiz();
    setLLMStatus(`Sgenerirovano: ${arr.length} voprosov`);

}   

catch(err){
    console.error(err);
    setLLMStatus('Ne udalos sgenerirovat lokalno.');
    alert('oshibka generatsii: check WebGPU / reload the page.');
}

    // const text = reply.choices[0].message.content;
    // let parsed;

    // try{parsed=JSON.parse(text);}catch{throw new Error('JSON parse error');}
    // if (!Array.isArray(parsed?.questions)) throw new Error('Bad questions');
    // const arr=parsed.questions.map(q=>({ q:q.q, a: q.a, correct: q.correct}));
    // useQuestions(arr);
}

function showSection(id){
    document.querySelectorAll("section").forEach(sec=>sec.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

let quizIndex=0, score=0;
function startQuiz(){
    quizIndex=0;
    score=0;
    showQuestion();
}
const quizQuestions=[
    {q:"HTML is used for...", a:["Stilizacia", "Risovanie", "Razmetka Stranitsi", "Programming"], correct:1},
    {q:"Css otvetcyaet za...", a:["Style", "Data chranilishe", "Set"], correct:0}, 
    {q:"Js is used for...", a:["Interactive elements", "Tolko verstka", "Baza dannih"], correct:0}
];

function showQuestion(){
    const container=document.getElementById("quiz-container");
    if(quizIndex>=quizQuestions.length){
        container.innerHTML = `<p>Your result is: ${score} / ${quizQuestions.length}</p>`;
    }
    const q=quizQuestions[quizIndex];
    container.innerHTML=`<h3>${q.q}</h3>`;
    q.a.forEach((ans, i)=>{
        const btn=document.createElement("button");
        btn.textContent=ans;
        btn.onclick=()=>{
            if (i===q.correct) score++;
            quizIndex++;
            showQuestion();
        };
        container.appendChild(btn);
    });
}

const cards=[
    {front:"HTML", back:"Language of Razmetka"},
    {front:"Css", back:"Style cascate tables"},
    {front:"JS", back:"Programming language for interactive part"},
];

let cardIndex=0;
function nextCard(){
    const container = document.getElementById("card-container");
    const card = cards[cardIndex];
    container.innerHTML=`<div class="card" onclick="flipCard(this)">${card.front}</div>`;
    cardIndex=(cardIndex+1) % cards.length;
}

function flipCard(el){
    const current=el.textContent;
    const card=cards.find(c => c.front===current || c.back===current);
    el.textContent=(el.textContent===card.front) ? card.back : card.front;
}

document.addEventListener("DOMContentLoaded", () =>{
    nextCard();
});