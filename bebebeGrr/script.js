let webLLM;
async function initWebLLM(){
    if (webLLM) return webLLM;
    webLLM=new window.HTMLCanvasElement.WebLLM.ChatModule();
    await webLLM.reload('qwen2.5-1.5b-instruct-q4f16_1-MLC');
    return webLLM;
}

async function generateLocalQuiz(topic, count=5, difficulty='easy', lang='ru'){
    await initWebLLM();
    const prompt=`generate ${count} of questions with one correct answer, using theme "${topic}". The difficulty should be ${difficulty}, language: ${lang}. The answer strictly in JSON: {"questions":[{"q":"...", "a":["A","B","C"], "correct":0}]} No comments.`;
    const reply=await webLLM.chat.completions.create({
        messages: [{role: 'user', content: prompt}],
        temperature: 0.7,
    })
    const text = reply.choices[0].message.content;
    let parsed;

    try{parsed=JSON.parse(text);}catch{throw new Error('JSON parse error');}
    if (!Array.isArray(parsed?.questions)) throw new Error('Bad questions');
    const arr=parsed.questions.map(q=>({ q:q.q, a: q.a, correct: q.correct}));
    useQuestions(arr);
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