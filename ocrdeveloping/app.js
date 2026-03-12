(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";
  const MAX_ROWS = 250;

  const rowsEl = document.getElementById("rows");
  const statusLineEl = document.getElementById("statusLine");
  const clearBtnEl = document.getElementById("btnClear");

  const state = {
    total: 0,
    lastMessageId: null,
    lastMetadata: null,
  };

  function setStatus(text) {
    if (statusLineEl) statusLineEl.textContent = text;
  }

  function fmtDate(value) {
    const raw = String(value || "").trim();
    if (!/^\d{8}$/.test(raw)) return raw || "-";
    return `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}`;
  }

  function summarizeMetadata(metadata) {
    const m = metadata && typeof metadata === "object" ? metadata : {};
    const patient = m.PatientName || m.patient_name || "-";
    const date = fmtDate(m.StudyDate || m.study_date || "");
    const pid = m.PatientID || m.patient_id || "-";
    const modality = m.Modality || m.modality || "-";
    return { patient, date, pid, modality, raw: m };
  }

  function arrayBufferFromBase64(base64) {
    const clean = base64.includes(",") ? base64.split(",").pop() : base64;
    const binary = atob(clean || "");
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function normalizePngBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (typeof data === "string" && data.trim()) {
      if (data.startsWith("data:image/")) return arrayBufferFromBase64(data);
      const r = await fetch(data);
      return r.arrayBuffer();
    }
    return null;
  }

  async function decodeImage(pngBuffer) {
    const blob = new Blob([pngBuffer], { type: "image/png" });
    if ("createImageBitmap" in window) {
      return { image: await createImageBitmap(blob), blob };
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ image: img, blob });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Falha ao decodificar imagem"));
      };
      img.src = objectUrl;
    });
  }

  function drawImageToCanvas(image) {
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    return { canvas, ctx, width: w, height: h };
  }

  function detectCandidateRois(ctx, width, height) {
    const block = Math.max(12, Math.round(Math.min(width, height) / 28));
    const cols = Math.ceil(width / block);
    const rows = Math.ceil(height / block);
    const img = ctx.getImageData(0, 0, width, height).data;

    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const x0 = gx * block;
        const y0 = gy * block;
        const x1 = Math.min(x0 + block, width);
        const y1 = Math.min(y0 + block, height);

        let n = 0;
        let sum = 0;
        let sum2 = 0;
        let dark = 0;

        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * width + x) * 4;
            const gray = (img[i] * 0.299) + (img[i + 1] * 0.587) + (img[i + 2] * 0.114);
            sum += gray;
            sum2 += gray * gray;
            if (gray < 120) dark += 1;
            n += 1;
          }
        }

        const mean = n ? sum / n : 0;
        const variance = n ? (sum2 / n) - (mean * mean) : 0;
        const darkRatio = n ? dark / n : 0;

        if (variance > 250 && darkRatio > 0.04 && darkRatio < 0.72) {
          grid[gy][gx] = 1;
        }
      }
    }

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const out = [];
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!grid[y][x] || visited[y][x]) continue;

        const q = [[x, y]];
        visited[y][x] = true;
        let minX = x;
        let minY = y;
        let maxX = x;
        let maxY = y;
        let count = 0;

        while (q.length) {
          const [cx, cy] = q.shift();
          count += 1;
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);

          for (const [dx, dy] of neighbors) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            if (visited[ny][nx] || !grid[ny][nx]) continue;
            visited[ny][nx] = true;
            q.push([nx, ny]);
          }
        }

        if (count < 2) continue;

        const rx = minX * block;
        const ry = minY * block;
        const rw = Math.min((maxX - minX + 1) * block, width - rx);
        const rh = Math.min((maxY - minY + 1) * block, height - ry);
        const area = rw * rh;
        if (area < 2400 || rw < 36 || rh < 20) continue;

        const ar = rw / Math.max(1, rh);
        if (ar < 0.7 || ar > 18) continue;

        out.push({ x: rx, y: ry, w: rw, h: rh, area });
      }
    }

    out.sort((a, b) => b.area - a.area);
    return out.slice(0, 10);
  }

  function buildRoiThumb(sourceCanvas, roi, idx) {
    const c = document.createElement("canvas");
    c.width = roi.w;
    c.height = roi.h;
    c.getContext("2d").drawImage(sourceCanvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);

    const fig = document.createElement("figure");
    fig.className = "roi-item";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = c.toDataURL("image/png");
    img.alt = `ROI ${idx + 1}`;

    const cap = document.createElement("figcaption");
    cap.textContent = `#${idx + 1} • x:${roi.x} y:${roi.y} w:${roi.w} h:${roi.h}`;

    fig.appendChild(img);
    fig.appendChild(cap);
    return fig;
  }

  function buildMetaCell(messageId, metaSummary) {
    const box = document.createElement("div");
    box.className = "meta";
    box.innerHTML = [
      `<strong>Paciente:</strong> ${metaSummary.patient}`,
      `<br><strong>Data:</strong> ${metaSummary.date}`,
      `<br><strong>Registro:</strong> ${metaSummary.pid}`,
      `<br><strong>Modalidade:</strong> ${metaSummary.modality}`,
      `<br><code>message_id: ${messageId || "-"}</code>`,
    ].join("");
    return box;
  }

  function trimRows() {
    if (!rowsEl) return;
    while (rowsEl.children.length > MAX_ROWS) {
      rowsEl.removeChild(rowsEl.lastChild);
    }
  }

  function postAck(eventOrigin, messageId) {
    if (!messageId) return;
    window.parent.postMessage({ type: "ack", message_id: messageId }, eventOrigin || BRIDGE_ORIGIN);
  }

  function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (origin === BRIDGE_ORIGIN) return true;
    if (origin === window.location.origin) return true;
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  async function handleImageMessage(event, data) {
    const pngBuffer = await normalizePngBuffer(data.png_buffer);
    if (!pngBuffer) {
      setStatus("Mensagem recebida sem imagem válida.");
      return;
    }

    const decoded = await decodeImage(pngBuffer);
    const { canvas, ctx, width, height } = drawImageToCanvas(decoded.image);
    const rois = detectCandidateRois(ctx, width, height);
    const metaSummary = summarizeMetadata(data.metadata);

    const tr = document.createElement("tr");

    const tdOriginal = document.createElement("td");
    tdOriginal.className = "original-cell";
    const originalImg = document.createElement("img");
    originalImg.loading = "lazy";
    originalImg.src = URL.createObjectURL(decoded.blob);
    originalImg.alt = data.message_id || "imagem";
    tdOriginal.appendChild(originalImg);

    const tdRois = document.createElement("td");
    const grid = document.createElement("div");
    grid.className = "rois-grid";
    if (!rois.length) {
      const noRoi = document.createElement("div");
      noRoi.className = "placeholder";
      noRoi.textContent = "Nenhuma ROI detectada nesta heurística inicial.";
      grid.appendChild(noRoi);
    } else {
      rois.forEach((roi, i) => grid.appendChild(buildRoiThumb(canvas, roi, i)));
    }
    tdRois.appendChild(grid);

    const tdOcr = document.createElement("td");
    tdOcr.className = "placeholder";
    tdOcr.textContent = "OCR ainda não integrado (etapa futura com PaddleOCR + ONNX Runtime Web).";

    const tdMeta = document.createElement("td");
    tdMeta.appendChild(buildMetaCell(data.message_id, metaSummary));

    tr.appendChild(tdOriginal);
    tr.appendChild(tdRois);
    tr.appendChild(tdOcr);
    tr.appendChild(tdMeta);

    rowsEl.prepend(tr);
    trimRows();

    state.total += 1;
    state.lastMessageId = data.message_id || null;
    state.lastMetadata = data.metadata || null;

    setStatus(`Total: ${state.total} imagem(ns) processadas | Última: ${state.lastMessageId || "sem id"} | ROIs: ${rois.length}`);
    postAck(event.origin, data.message_id);
  }

  function onMessage(event) {
    if (!isAllowedOrigin(event.origin)) return;
    const data = event.data || {};

    if (data.type === "dicom_sr") {
      state.lastMetadata = data.metadata || null;
      postAck(event.origin, data.message_id);
      return;
    }

    if (data.type === "dicom_image") {
      handleImageMessage(event, data).catch((err) => {
        setStatus(`Erro no processamento: ${err.message}`);
      });
    }
  }

  function postSettingsUpdate() {
    const payload = {
      type: "settings_update",
      MODEL_ACTIVATED: { ocr_developing: true },
      ANALISE_CHOICE: { tipo: "Imagem" },
    };
    window.parent.postMessage(payload, BRIDGE_ORIGIN);
  }

  function clearTable() {
    rowsEl.innerHTML = "";
    state.total = 0;
    state.lastMessageId = null;
    setStatus("Tabela limpa. Aguardando novas imagens...");
  }

  window.addEventListener("message", onMessage);
  clearBtnEl?.addEventListener("click", clearTable);

  setStatus("Aguardando imagens via postMessage... origem permitida principal: http://127.0.0.1:8099");
  setInterval(postSettingsUpdate, 1000);
  window.addEventListener("DOMContentLoaded", postSettingsUpdate);
})();
