// -------- надёжная подгрузка WebLLM --------
const WEBLLM_URLS = [
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.43/dist/web-llm.min.js",
    "https://unpkg.com/@mlc-ai/web-llm@0.2.43/dist/web-llm.min.js",
    "./web-llm.min.js", // ← положи файл рядом как крайний фолбэк (опционально)
  ];
  
  function loadScript(src, timeoutMs = 15000){
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
      s.onerror = () => { if (!done) { done = true; clearTimeout(to); reject(new Error("load failed: " + src)); } };
      document.head.appendChild(s);
    });
  }
  
  async function ensureWebLLMScript(){
    if (window.mlc?.WebLLM) return;
    let lastErr;
    for (const url of WEBLLM_URLS){
      try { await loadScript(url); if (window.mlc?.WebLLM) return; }
      catch (e){ lastErr = e; console.warn("WebLLM load try failed:", url, e); }
    }
    throw lastErr || new Error("WebLLM script not ready");
  }
  
  // -------- ожидание появления API (если скрипт подгрузился, но init задержался) --------
  async function waitForWebLLM(maxMs = 8000){
    if (window.mlc?.WebLLM) return;
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        if (window.mlc?.WebLLM){ clearInterval(id); resolve(); }
        else if (Date.now() - t0 > maxMs){ clearInterval(id); reject(new Error("WebLLM script not ready")); }
      }, 150);
    });
  }
  
  // -------- init WebLLM (с фолбэком модели и логами) --------
  let webLLM, webLLMReady = false;
  const LLM_MODEL    = "phi-2-q4f16_1-MLC";                // лёгкая
  const LLM_FALLBACK = "qwen2.5-0.5b-instruct-q4f16_1-MLC"; // ещё меньше
  
  function hasWebGPU(){ return !!navigator.gpu; }
  function setLLMStatus(t){ const el = document.getElementById("llmStatus"); if (el) el.textContent = t; }
  
  async function initWebLLM(){
    if (webLLMReady) return webLLM;
  
    if (!hasWebGPU()){
      setLLMStatus("WebGPU не поддерживается в этом браузере.");
      throw new Error("No WebGPU");
    }
  
    setLLMStatus("Загрузка модели… (первая загрузка может занять время)");
  
    // 1) гарантированно загружаем сам скрипт
    await ensureWebLLMScript();
    // 2) ждём появления API
    await waitForWebLLM();
  
    // 3) создаём модуль
    webLLM = new window.mlc.WebLLM.ChatModule({
      context_window_size: 2048,
      model_list: [LLM_MODEL, LLM_FALLBACK],
    });
  
    // 4) прогресс + сторожок
    let lastPct = 0;
    const onProgress = (r)=>{
      const pct = Math.round((r.progress || 0) * 100);
      if (pct !== lastPct){
        lastPct = pct;
        setLLMStatus(`Загрузка: ${pct}% ${r.text || ""}`);
      }
    };
    const watchdog = (ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error("download-timeout")), ms));
  
    try {
      console.log("⏳ reload primary", LLM_MODEL);
      await Promise.race([
        webLLM.reload(LLM_MODEL, { progress_callback: onProgress }),
        watchdog(60000),
      ]);
    } catch (e1){
      console.warn("Primary failed, fallback:", e1);
      setLLMStatus("Переключаюсь на более лёгкую модель…");
      await Promise.race([
        webLLM.reload(LLM_FALLBACK, { progress_callback: onProgress }),
        watchdog(60000),
      ]);
    }
  
    webLLMReady = true;
    setLLMStatus("Модель готова ✅");
    return webLLM;
  }
  