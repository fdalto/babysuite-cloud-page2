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

  window.__CURRENT_SR__ = window.__CURRENT_SR__ || null;
  window.__LAST_IMAGE__ = window.__LAST_IMAGE__ || null;
  window.__LAST_BRIDGE_METADATA__ = window.__LAST_BRIDGE_METADATA__ || null;
  window.__BRIDGE_PRINT_IMAGES__ = window.__BRIDGE_PRINT_IMAGES__ || [];

  function setPrintStatus(text) {
    if (printStatusEl) printStatusEl.textContent = text;
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

  function readDicomFields(metadata) {
    const m = metadata && typeof metadata === "object" ? metadata : {};
    return {
      nome: m.PatientName || m.patient_name || "-",
      data: formatDicomDate(m.StudyDate || m.study_date || ""),
      registro: m.PatientID || m.patient_id || "-",
      dn: formatDicomDate(m.PatientBirthDate || m.patient_birth_date || m.DN || ""),
      modalidade: m.Modality || m.modality || "-",
    };
  }

  function summarizeMetadata(metadata) {
    const f = readDicomFields(metadata);
    return `Nome: ${f.nome} | Data: ${f.data} | Registro: ${f.registro} | DN: ${f.dn} | Modalidade: ${f.modalidade}`;
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
    const objectUrl = URL.createObjectURL(blob);
    const item = {
      message_id: messageId || String(Date.now()),
      ts: Date.now(),
      metadata: metadata || {},
      png_buffer: pngBuffer,
      objectUrl,
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
        <h1>Impressão de Imagens</h1>
        <div class="sheet-header-grid">
          <div><strong>Nome:</strong> ${escapeHtml(fields.nome)}</div>
          <div><strong>Data:</strong> ${escapeHtml(fields.data)}</div>
          <div><strong>Registro:</strong> ${escapeHtml(fields.registro)}</div>
          <div><strong>DN:</strong> ${escapeHtml(fields.dn)}</div>
          <div><strong>Modalidade:</strong> ${escapeHtml(fields.modalidade)}</div>
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
            ${pageIdx === 0 ? buildHeaderHtml(firstFields) : ""}
            <main class="sheet-grid layout-${layout.perPage}">
              ${cards}
            </main>
            <footer class="sheet-footer">${pageIdx + 1}</footer>
          </section>
        `;
      })
      .join("");

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setPrintStatus("Bloqueio de pop-up. Permita pop-ups para imprimir.");
      return;
    }

    const html = `
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Impressão</title>
        <style>
          @page { size: A4 portrait; margin: 1cm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
          .sheet {
            min-height: calc(29.7cm - 2cm);
            display: flex;
            flex-direction: column;
          }
          .with-break { break-after: page; page-break-after: always; }
          .sheet-header {
            border-bottom: 1px solid #ccc;
            padding-bottom: 4mm;
            margin-bottom: 4mm;
          }
          .sheet-header h1 {
            margin: 0 0 3mm 0;
            font-size: 16px;
          }
          .sheet-header-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 2mm 6mm;
            font-size: 12px;
          }
          .sheet-grid {
            flex: 1;
            display: grid;
            gap: 3mm;
            min-height: 0;
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
            margin-top: 3mm;
            text-align: center;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        ${pagesHtml}
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };

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
      postAck(data.message_id);
      return;
    }

    if (data.type === "dicom_image") {
      const pngBuffer = data.png_buffer;
      if (pngBuffer instanceof ArrayBuffer) {
        addImageToMemory(data.message_id, data.metadata, pngBuffer);
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      postAck(data.message_id);
    }
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
