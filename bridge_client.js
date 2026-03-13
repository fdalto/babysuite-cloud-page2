(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";
  const UPLOAD_ENDPOINT_KEY = "bridge_print_upload_endpoint";
  const MAX_PRINT_IMAGES = 200;

  const printGridEl = document.getElementById("printGrid");
  const printStatusEl = document.getElementById("print-status");
  const sendBtnEl = document.getElementById("btnSendPrintImages");
  const printBtnEl = document.getElementById("btnPrintLayout");
  const clearBtnEl = document.getElementById("btnClearPrintImages");
  const endpointInputEl = document.getElementById("printUploadEndpoint");
  const OCR_IFRAME_ID = "ocrTabFrame";

  window.__CURRENT_SR__ = window.__CURRENT_SR__ || null;
  window.__LAST_IMAGE__ = window.__LAST_IMAGE__ || null;
  window.__LAST_BRIDGE_METADATA__ = window.__LAST_BRIDGE_METADATA__ || null;
  window.__BRIDGE_PRINT_IMAGES__ = window.__BRIDGE_PRINT_IMAGES__ || [];
  window.__OCR_DEV_IMAGE_STORE__ = window.__OCR_DEV_IMAGE_STORE__ || { items: {}, order: [] };
  window.__OCR_RESULTS_BY_MESSAGE_ID__ = window.__OCR_RESULTS_BY_MESSAGE_ID__ || {};
  window.__OCR_PROMPT_LINES__ = window.__OCR_PROMPT_LINES__ || { order: [], byMessageId: {} };

  function setPrintStatus(text) {
    if (printStatusEl) printStatusEl.textContent = text;
  }

  function getCompatibleImageStore() {
    const s = window.__OCR_DEV_IMAGE_STORE__;
    if (s && typeof s === "object" && s.items && s.order) return s;
    const fresh = { items: {}, order: [] };
    window.__OCR_DEV_IMAGE_STORE__ = fresh;
    return fresh;
  }

  function saveImageVariantCompatible(id, parentId, metadata, blob, preprocessProfile) {
    if (!id || !blob) return;
    const store = getCompatibleImageStore();
    const prev = store.items[id];
    if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);

    const objectUrl = URL.createObjectURL(blob);
    store.items[id] = {
      id,
      parentId: parentId || null,
      ts: Date.now(),
      metadata: metadata || {},
      preprocessProfile: preprocessProfile || null,
      blob,
      objectUrl,
    };
    if (!store.order.includes(id)) store.order.push(id);
    window.__OCR_DEV_LAST_IMAGE_ID__ = id;
    return store.items[id];
  }

  function forwardToOcrTab(data) {
    const frame = document.getElementById(OCR_IFRAME_ID);
    const target = frame?.contentWindow;
    if (!target) return;
    try {
      target.postMessage(data, window.location.origin);
    } catch (_) {
      // ignore relay errors; OCR tab can be unavailable while loading
    }
  }

  function upsertPromptLine(messageId, textLine) {
    const line = String(textLine || "").replace(/\s+/g, " ").trim();
    if (!messageId || !line) return;

    const promptState = window.__OCR_PROMPT_LINES__;
    const prev = promptState.byMessageId[messageId] || "";
    if (!prev) {
      promptState.order.push(messageId);
    }
    if (prev === line) return;
    promptState.byMessageId[messageId] = line;

    if (typeof window.appendPromptLineToEnd === "function") {
      window.appendPromptLineToEnd(line);
      return;
    }

    const promptEl = document.getElementById("campoPrompt");
    if (!promptEl) return;
    const current = String(promptEl.value || "").replace(/\r\n/g, "\n");
    promptEl.value = current.trim() ? `${current}\n${line}` : line;
  }

  function handleLocalOcrResult(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const messageId = p.message_id || "";
    if (!messageId) return;

    const textLine = String(p.ocr_text_line || "").replace(/\s+/g, " ").trim();
    if (!textLine) return;

    window.__OCR_RESULTS_BY_MESSAGE_ID__[messageId] = {
      message_id: messageId,
      ocr_text_line: textLine,
      ts: p.ts || Date.now(),
      metadata: p.metadata || {},
      preprocess_profile: p.preprocess_profile || null,
    };

    const cropId = p.crop_image_id || `${messageId}_anonimyzed`;
    const cropBuffer = p.crop_png_buffer;
    if (cropBuffer instanceof ArrayBuffer) {
      const blob = new Blob([cropBuffer], { type: p.crop_mime || "image/png" });
      saveImageVariantCompatible(cropId, messageId, p.metadata || {}, blob, p.preprocess_profile || null);
    }

    upsertPromptLine(messageId, textLine);
  }

  function getEndpoint() {
    return (endpointInputEl?.value || "").trim();
  }

  function persistEndpoint() {
    if (!endpointInputEl) return;
    const url = getEndpoint();
    if (url) {
      localStorage.setItem(UPLOAD_ENDPOINT_KEY, url);
    } else {
      localStorage.removeItem(UPLOAD_ENDPOINT_KEY);
    }
  }

  function formatTimestamp(ts) {
    try {
      return new Date(ts).toLocaleString("pt-BR");
    } catch (_) {
      return String(ts);
    }
  }

  function formatDicomDate(raw) {
    const s = String(raw || "").trim();
    if (!/^\d{8}$/.test(s)) return s || "-";
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }

  function normalizePatientName(raw) {
    const s = String(raw || "").trim();
    if (!s) return "-";
    return s
      .replace(/\^+/g, ", ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s{2,}/g, " ")
      .trim() || "-";
  }

  function readDicomFields(metadata) {
    const m = metadata && typeof metadata === "object" ? metadata : {};
    return {
      nome: normalizePatientName(m.PatientName || m.patient_name || "-"),
      data: formatDicomDate(m.StudyDate || m.study_date || ""),
      registro: m.PatientID || m.patient_id || "-",
      dn: formatDicomDate(m.PatientBirthDate || m.patient_birth_date || m.DN || ""),
      modalidade: m.Modality || m.modality || "-",
    };
  }

  function summarizeMetadata(metadata) {
    const f = readDicomFields(metadata);
    return `Nome: ${f.nome} | Data: ${f.data} | Registro: ${f.registro} | DN: ${f.dn}`;
  }

  function renderPrintImages() {
    if (!printGridEl) return;

    printGridEl.innerHTML = "";
    const items = window.__BRIDGE_PRINT_IMAGES__;

    if (!items.length) {
      setPrintStatus("Nenhuma imagem recebida ainda.");
      return;
    }

    setPrintStatus(`Imagens em memória: ${items.length}`);

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "print-card";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = item.objectUrl;
      img.alt = item.message_id || "dicom image";

      const meta = document.createElement("div");
      meta.className = "print-meta";
      meta.textContent = `${formatTimestamp(item.ts)} | ${summarizeMetadata(item.metadata)}`;

      card.appendChild(img);
      card.appendChild(meta);
      printGridEl.appendChild(card);
    });
  }

  function addImageToMemory(messageId, metadata, pngBuffer) {
    const blob = new Blob([pngBuffer], { type: "image/png" });
    const imageId = messageId || String(Date.now());
    const saved = saveImageVariantCompatible(imageId, null, metadata, blob, null);
    const item = {
      message_id: imageId,
      ts: Date.now(),
      metadata: metadata || {},
      png_buffer: pngBuffer,
      objectUrl: saved?.objectUrl || URL.createObjectURL(blob),
    };

    window.__BRIDGE_PRINT_IMAGES__.push(item);

    if (window.__BRIDGE_PRINT_IMAGES__.length > MAX_PRINT_IMAGES) {
      const removed = window.__BRIDGE_PRINT_IMAGES__.shift();
      if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    }

    window.__LAST_IMAGE__ = item;
    renderPrintImages();
  }

  function clearImagesFromMemory() {
    const items = window.__BRIDGE_PRINT_IMAGES__;
    items.forEach((item) => {
      if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    window.__BRIDGE_PRINT_IMAGES__ = [];
    renderPrintImages();
  }

  function splitIntoPages(items, perPage) {
    const pages = [];
    for (let i = 0; i < items.length; i += perPage) {
      pages.push(items.slice(i, i + perPage));
    }
    return pages;
  }

  function choosePrintLayout(total) {
    if (total > 18) return { perPage: 8, rows: 4, cols: 2 };
    if (total % 8 === 0) return { perPage: 8, rows: 4, cols: 2 };
    if (total % 6 === 0) return { perPage: 6, rows: 3, cols: 2 };

    const r6 = total % 6;
    const r8 = total % 8;
    if (r6 < r8) return { perPage: 6, rows: 3, cols: 2 };
    return { perPage: 8, rows: 4, cols: 2 };
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildHeaderHtml(fields) {
    return `
      <header class="sheet-header">
        <div class="sheet-header-grid">
          <div><strong>Nome:</strong> ${escapeHtml(fields.nome)}</div>
          <div><strong>Data:</strong> ${escapeHtml(fields.data)}</div>
          <div><strong>Registro:</strong> ${escapeHtml(fields.registro)}</div>
          <div><strong>DN:</strong> ${escapeHtml(fields.dn)}</div>
        </div>
      </header>
    `;
  }

  function openPrintWindow() {
    const items = window.__BRIDGE_PRINT_IMAGES__;
    if (!items.length) {
      setPrintStatus("Sem imagens para imprimir.");
      return;
    }

    const layout = choosePrintLayout(items.length);
    const pages = splitIntoPages(items, layout.perPage);
    const firstFields = readDicomFields(items[0]?.metadata || {});

    const pagesHtml = pages
      .map((pageItems, pageIdx) => {
        const cards = pageItems
          .map((item, idx) => {
            const n = pageIdx * layout.perPage + idx + 1;
            return `
              <article class="sheet-card">
                <img src="${item.objectUrl}" alt="Imagem ${n}" />
              </article>
            `;
          })
          .join("");

        return `
          <section class="sheet ${pageIdx < pages.length - 1 ? "with-break" : ""}">
            <div class="sheet-top-blank"></div>
            ${buildHeaderHtml(firstFields)}
            <main class="sheet-grid layout-${layout.perPage}">
              ${cards}
            </main>
            <footer class="sheet-footer">${pageIdx + 1}</footer>
          </section>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Impressão</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
          .sheet {
            height: 281mm;
            max-height: 281mm;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 0 6mm;
          }
          .with-break { break-after: page; page-break-after: always; }
          .sheet-top-blank {
            height: 4mm;
            flex: 0 0 auto;
          }
          .sheet-header {
            border-bottom: 1px solid #ccc;
            padding-bottom: 2mm;
            margin-bottom: 2mm;
            flex: 0 0 auto;
          }
          .sheet-header-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1.5mm 5mm;
            font-size: 11px;
            line-height: 1.2;
          }
          .sheet-grid {
            flex: 1;
            display: grid;
            gap: 2mm;
            min-height: 0;
            align-content: stretch;
          }
          .sheet-grid.layout-8 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-template-rows: repeat(4, minmax(0, 1fr));
          }
          .sheet-grid.layout-6 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-template-rows: repeat(3, minmax(0, 1fr));
          }
          .sheet-card {
            border: 1px solid #aaa;
            overflow: hidden;
            border-radius: 3mm;
            background: #fff;
            min-height: 0;
          }
          .sheet-card img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #111;
          }
          .sheet-footer {
            margin-top: 2mm;
            text-align: right;
            font-size: 11px;
            padding-top: 2.2em;
            flex: 0 0 auto;
          }
        </style>
      </head>
      <body>
        ${pagesHtml}
      </body>
      </html>
    `;

    const oldFrame = document.getElementById("printSandboxFrame");
    if (oldFrame) oldFrame.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "printSandboxFrame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      iframe.remove();
      setPrintStatus("Não foi possível preparar a impressão.");
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const tryPrint = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) throw new Error("print window unavailable");
        win.focus();
        win.print();
        setTimeout(() => iframe.remove(), 2000);
      } catch (_) {
        iframe.remove();
        setPrintStatus("Falha ao abrir o diálogo de impressão.");
      }
    };

    // Aguarda render mínima para evitar folha em branco no primeiro print.
    setTimeout(tryPrint, 250);

    setPrintStatus(`Layout de impressão gerado: ${items.length} imagem(ns).`);
  }

  async function sendImagesToEndpoint() {
    const endpoint = getEndpoint();
    const items = window.__BRIDGE_PRINT_IMAGES__;

    if (!endpoint) {
      setPrintStatus("Defina o endpoint de envio antes de enviar as imagens.");
      return;
    }

    if (!items.length) {
      setPrintStatus("Sem imagens em memória para enviar.");
      return;
    }

    const formData = new FormData();
    const metadataList = [];

    items.forEach((item, idx) => {
      const fileName = `${item.message_id || `img_${idx + 1}`}.png`;
      const blob = new Blob([item.png_buffer], { type: "image/png" });
      formData.append("files", blob, fileName);
      metadataList.push({
        message_id: item.message_id,
        ts: item.ts,
        metadata: item.metadata || {},
      });
    });

    formData.append("metadata_json", JSON.stringify(metadataList));

    setPrintStatus(`Enviando ${items.length} imagem(ns)...`);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setPrintStatus(`Envio concluído: ${items.length} imagem(ns) para ${endpoint}`);
    } catch (error) {
      setPrintStatus(`Falha no envio: ${error.message}`);
    }
  }

  function postAck(messageId) {
    if (!messageId) return;
    window.parent.postMessage(
      {
        type: "ack",
        message_id: messageId,
      },
      BRIDGE_ORIGIN,
    );
  }

  function postSettingsUpdate() {
    window.parent.postMessage(
      {
        type: "settings_update",
        MODEL_ACTIVATED: window.modelActivated || {},
        ANALISE_CHOICE: window.analiseChoice || { tipo: "Ambos" },
      },
      BRIDGE_ORIGIN,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== BRIDGE_ORIGIN) return;

    const data = event.data || {};

    if (data.type === "dicom_sr") {
      const srHtml = String(data.sr_html || "").trim();
      if (srHtml) {
        window.__CURRENT_SR__ = {
          id: data.message_id || String(Date.now()),
          sr_html: srHtml,
          ts: Date.now(),
          metadata: data.metadata || {},
        };
        if (typeof window.updateSRButtonState === "function") {
          window.updateSRButtonState();
        }
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      forwardToOcrTab(data);
      postAck(data.message_id);
      return;
    }

    if (data.type === "dicom_image") {
      const pngBuffer = data.png_buffer;
      if (pngBuffer instanceof ArrayBuffer) {
        addImageToMemory(data.message_id, data.metadata, pngBuffer);
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      forwardToOcrTab(data);
      postAck(data.message_id);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type !== "ocr_result_local") return;
    handleLocalOcrResult(data.payload || {});
  });

  let lastSent = "";
  const publishIfChanged = () => {
    const snapshot = JSON.stringify({
      model: window.modelActivated || {},
      analise: window.analiseChoice || { tipo: "Ambos" },
    });

    if (snapshot === lastSent) return;
    lastSent = snapshot;
    postSettingsUpdate();
  };

  if (endpointInputEl) {
    endpointInputEl.value = localStorage.getItem(UPLOAD_ENDPOINT_KEY) || "";
    endpointInputEl.addEventListener("change", persistEndpoint);
    endpointInputEl.addEventListener("blur", persistEndpoint);
  }

  if (sendBtnEl) {
    sendBtnEl.addEventListener("click", sendImagesToEndpoint);
  }

  if (printBtnEl) {
    printBtnEl.addEventListener("click", openPrintWindow);
  }

  if (clearBtnEl) {
    clearBtnEl.addEventListener("click", clearImagesFromMemory);
  }

  renderPrintImages();
  setInterval(publishIfChanged, 800);
  window.addEventListener("DOMContentLoaded", publishIfChanged);
})();
