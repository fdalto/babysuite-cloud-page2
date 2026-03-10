/* print_tab.js
 * Aba "Impressão": abre automaticamente o último StudyUID em ./incoming e renderiza TODAS as PNGs
 * em um grid de 2 colunas (várias linhas), atualizando via polling.
 *
 * Requisitos (backend local):
 * - GET  /api/latest-study  -> { study_uid: "..." | null }
 * - GET  /api/studies/{study_uid}/images?limit=N -> { study_uid: "...", images: ["a.png", ...] }
 * - Static: /incoming/{study_uid}/{filename}.png
 *
 * HTML esperado:
 * - <section id="tab-print" class="tab-panel">
 *      <div class="print-wrap">
 *        <div id="print-status"></div> (opcional)
 *        <div class="print-grid">...</div>
 *      </div>
 *   </section>
 *
 * Observação:
 * - Este script passa a gerar os itens de imagem dinamicamente dentro de .print-grid (não depende de 6 .print-box).
 */

(() => {
  "use strict";

  // ==== Config ====
  const CONFIG = {
    pollMs: 2000,
    // Para "todas", pedimos um limite alto. Se quiser, aumente.
    listLimit: 500,
    latestStudyUrl: "/api/latest-study",
    listImagesUrl: (studyUid, limit) =>
      `/api/studies/${encodeURIComponent(studyUid)}/images?limit=${encodeURIComponent(limit)}`,
    incomingBase: "/incoming",

    // DOM
    gridSelector: "#tab-print .print-grid",
    statusId: "print-status",

    avoidRerenderIfUnchanged: true,
    // Se true, tenta manter a posição do scroll quando atualizar
    preserveScroll: true,
  };

  // ==== State ====
  let currentStudyUid = null;
  let lastSignature = "";

  // ==== DOM refs ====
  const statusEl = document.getElementById(CONFIG.statusId);
  const gridEl = document.querySelector(CONFIG.gridSelector);

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function ensureGrid() {
    if (!gridEl) {
      console.warn("[print_tab] Não encontrei .print-grid em", CONFIG.gridSelector);
      return null;
    }
    return gridEl;
  }

  function cacheBustedUrl(studyUid, filename) {
    const t = Date.now();
    return `${CONFIG.incomingBase}/${encodeURIComponent(studyUid)}/${encodeURIComponent(filename)}?t=${t}`;
  }

  function clearGrid(grid) {
    grid.innerHTML = "";
  }

  function renderAllImages(grid, studyUid, images) {
    clearGrid(grid);

    images.forEach((filename) => {
      const box = document.createElement("div");
      box.className = "print-box"; // reutiliza seu estilo, se existir

      const img = document.createElement("img");
      img.src = cacheBustedUrl(studyUid, filename);
      img.alt = filename;
      img.loading = "lazy";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.borderRadius = "10px";

      box.appendChild(img);
      grid.appendChild(box);
    });
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
    return await r.json();
  }

  async function refreshPrintTab() {
    const grid = ensureGrid();
    if (!grid) return;

    const prevScrollTop = CONFIG.preserveScroll ? document.documentElement.scrollTop : 0;

    // 1) Último StudyUID (pasta mais recente)
    const latest = await fetchJSON(CONFIG.latestStudyUrl);
    const studyUid = latest?.study_uid;

    if (!studyUid) {
      currentStudyUid = null;
      lastSignature = "";
      clearGrid(grid);
      setStatus("Nenhuma pasta de estudo encontrada em ./incoming");
      return;
    }

    const changedStudy = studyUid !== currentStudyUid;
    currentStudyUid = studyUid;

    // 2) Lista TODAS as imagens (limit alto)
    const data = await fetchJSON(CONFIG.listImagesUrl(studyUid, CONFIG.listLimit));
    const images = Array.isArray(data?.images) ? data.images : [];

    setStatus(`StudyUID: ${studyUid} • ${images.length} imagem(ns)`);

    const signature = `${studyUid}|${images.join(",")}`;
    if (!CONFIG.avoidRerenderIfUnchanged || changedStudy || signature !== lastSignature) {
      lastSignature = signature;
      renderAllImages(grid, studyUid, images);

      if (CONFIG.preserveScroll) {
        // tenta manter o scroll se estava lendo as imagens
        document.documentElement.scrollTop = prevScrollTop;
      }
    }
  }

  async function tick() {
    try {
      await refreshPrintTab();
    } catch (e) {
      console.error("[print_tab] erro:", e);
      setStatus("Erro ao carregar imagens. Verifique se o servidor local está rodando.");
    }
  }

  // ==== Boot ====
  tick();
  setInterval(tick, CONFIG.pollMs);
})();
