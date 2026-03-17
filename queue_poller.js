
(() => {
  const API_BASE = "http://127.0.0.1:8787";
  const INTERVAL_MS = 2000; // ajuste de polling para menor frequencia
  const BATCH_N = 20;

  // Prefixo usado pelo sender.py (opção B)
  const SR_PREFIX = "__SR__:";
  const SR_LS_KEY = "__CURRENT_SR__";
  let busy = false;

  // SR "corrente" (memória). O localStorage é só backup do último SR recebido.
  window.__CURRENT_SR__ = window.__CURRENT_SR__ || null;

  function saveCurrentSR(srHtml) {
    const item = {
      id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
      sr_html: srHtml,
      ts: Date.now()
    };

    // memória
    window.__CURRENT_SR__ = item;
    updateSRButtonState();
    // backup persistente (sobrescreve sempre)
    try {
      localStorage.setItem(SR_LS_KEY, JSON.stringify(item));
    } catch (e) {
      // se estourar quota, fica só em memória
    }

    return item;
  }

  function insertWord(word) {
    if (!word) return;

    // Se por acaso vier um bloco com quebras de linha, aplica linha a linha
    const parts = String(word)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const p of parts) {
      if (typeof window.insertNewLineInPrompt === "function") {
        window.insertNewLineInPrompt(p);
      } else {
        // fallback: se sua função não estiver disponível por algum motivo
        const el = document.getElementById("campoPrompt");
        if (el) el.value += (el.value ? "\n" : "") + p;
      }
    }
  }

  function handleQueueItem(item) {
    if (typeof item !== "string") return;

    // SR: guarda (memória + localStorage) e NÃO insere no prompt
    if (item.startsWith(SR_PREFIX)) {
      const raw = item.slice(SR_PREFIX.length);
      try {
        const obj = JSON.parse(raw); // esperado: { sr_html: "<...>" }
        const html = (obj?.sr_html || "").trim();
        if (html) saveCurrentSR(html);
      } catch (e) {
        // Se vier inválido, simplesmente ignora para não poluir prompt
        // (se quiser, dá pra salvar raw para debug)
      }
      return;
    }

    // Texto normal: comportamento atual
    insertWord(item);
  }

async function pullOnce() {
  if (busy) return;
  busy = true;

  try {
    const params = new URLSearchParams();
    params.set("n", String(BATCH_N));
    params.set("modelActivated", JSON.stringify(window.modelActivated || {}));
    params.set("analiseChoice", JSON.stringify(window.analiseChoice || { tipo: "Ambos" }));

    const url = `${API_BASE}/dequeue_batch?${params.toString()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return;

    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) handleQueueItem(item);

  } catch (e) {
    // silencioso
  } finally {
    busy = false;
  }
}

  // Garante que o DOM já está pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setInterval(pullOnce, INTERVAL_MS);
    });
  } else {
    setInterval(pullOnce, INTERVAL_MS);
  }
})();
