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
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const borderMask = new Uint8Array(width * height);
    const colorTextMask = new Uint8Array(width * height);
    const visitedBorder = new Uint8Array(width * height);
    const visitedColor = new Uint8Array(width * height);
    const rawCandidates = [];

    const idxOf = (x, y) => (y * width) + x;
    const pxOf = (x, y) => ((y * width) + x) * 4;

    const isGrayLike = (r, g, b) => {
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sat = maxc - minc;
      const lum = (r + g + b) / 3;
      return sat <= 26 && lum >= 60 && lum <= 210;
    };

    const isOrangeOrGreenText = (r, g, b, a) => {
      if (a < 50) return false;
      const isGreen = g >= 90 && g > r * 1.1 && g > b * 1.2;
      const isOrange = r >= 140 && g >= 70 && g <= 210 && b <= 135 && r > g * 1.05 && (r - b) >= 35;
      return isGreen || isOrange;
    };

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = pxOf(x, y);
        const r = pixels[p];
        const g = pixels[p + 1];
        const b = pixels[p + 2];
        const a = pixels[p + 3];
        const i = idxOf(x, y);

        if (isOrangeOrGreenText(r, g, b, a)) colorTextMask[i] = 1;
        if (!isGrayLike(r, g, b) || a < 80) continue;

        const pL = pxOf(x - 1, y);
        const pR = pxOf(x + 1, y);
        const pU = pxOf(x, y - 1);
        const pD = pxOf(x, y + 1);

        const lumL = (pixels[pL] + pixels[pL + 1] + pixels[pL + 2]) / 3;
        const lumR = (pixels[pR] + pixels[pR + 1] + pixels[pR + 2]) / 3;
        const lumU = (pixels[pU] + pixels[pU + 1] + pixels[pU + 2]) / 3;
        const lumD = (pixels[pD] + pixels[pD + 1] + pixels[pD + 2]) / 3;

        const contrast = Math.max(
          Math.abs(((r + g + b) / 3) - lumL),
          Math.abs(((r + g + b) / 3) - lumR),
          Math.abs(((r + g + b) / 3) - lumU),
          Math.abs(((r + g + b) / 3) - lumD),
        );

        if (contrast >= 18) borderMask[i] = 1;
      }
    }

    const neighbors8 = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const countBorderPixelsOnRing = (x0, y0, x1, y1, ring) => {
      let borderCount = 0;
      let total = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const onRing = (x - x0 < ring) || (x1 - x < ring) || (y - y0 < ring) || (y1 - y < ring);
          if (!onRing) continue;
          total += 1;
          if (borderMask[idxOf(x, y)]) borderCount += 1;
        }
      }
      return { borderCount, total };
    };

    for (let sy = 1; sy < height - 1; sy += 1) {
      for (let sx = 1; sx < width - 1; sx += 1) {
        const seed = idxOf(sx, sy);
        if (!borderMask[seed] || visitedBorder[seed]) continue;

        const q = [[sx, sy]];
        visitedBorder[seed] = 1;
        let minX = sx;
        let minY = sy;
        let maxX = sx;
        let maxY = sy;
        let borderCount = 0;

        while (q.length) {
          const [cx, cy] = q.shift();
          borderCount += 1;
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);

          for (const [dx, dy] of neighbors8) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
            const ni = idxOf(nx, ny);
            if (visitedBorder[ni] || !borderMask[ni]) continue;
            visitedBorder[ni] = 1;
            q.push([nx, ny]);
          }
        }

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const area = w * h;
        if (w < 60 || h < 18 || area < 3000) continue;

        const ar = w / Math.max(1, h);
        if (ar < 1.4 || ar > 22) continue;

        const perimeter = (2 * w) + (2 * h);
        const borderDensityPerimeter = borderCount / Math.max(1, perimeter);
        if (borderDensityPerimeter < 0.35 || borderDensityPerimeter > 3.2) continue;

        const ring = countBorderPixelsOnRing(minX, minY, maxX, maxY, 2);
        const ringCoverage = ring.total ? ring.borderCount / ring.total : 0;
        if (ringCoverage < 0.18) continue;

        const ix0 = minX + 2;
        const iy0 = minY + 2;
        const ix1 = maxX - 2;
        const iy1 = maxY - 2;
        if (ix1 <= ix0 || iy1 <= iy0) continue;

        let textCount = 0;
        let innerCount = 0;
        let innerBorderCount = 0;
        for (let y = iy0; y <= iy1; y += 1) {
          for (let x = ix0; x <= ix1; x += 1) {
            const i = idxOf(x, y);
            innerCount += 1;
            if (colorTextMask[i]) textCount += 1;
            if (borderMask[i]) innerBorderCount += 1;
          }
        }

        const textDensity = textCount / Math.max(1, innerCount);
        const innerBorderDensity = innerBorderCount / Math.max(1, innerCount);

        if (textCount < 20 || textDensity < 0.006) continue;
        if (innerBorderDensity > 0.2) continue;

        const score = (ringCoverage * 120) + (textDensity * 1800) + (Math.log10(area + 1) * 6);
        rawCandidates.push({
          x: minX,
          y: minY,
          w,
          h,
          area,
          textDensity,
          score,
          mechanism: "box",
        });
      }
    }

    for (let sy = 1; sy < height - 1; sy += 1) {
      for (let sx = 1; sx < width - 1; sx += 1) {
        const seed = idxOf(sx, sy);
        if (!colorTextMask[seed] || visitedColor[seed]) continue;

        const q = [[sx, sy]];
        visitedColor[seed] = 1;
        let minX = sx;
        let minY = sy;
        let maxX = sx;
        let maxY = sy;
        let count = 0;

        while (q.length) {
          const [cx, cy] = q.shift();
          count += 1;
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);

          for (const [dx, dy] of neighbors8) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
            const ni = idxOf(nx, ny);
            if (visitedColor[ni] || !colorTextMask[ni]) continue;
            visitedColor[ni] = 1;
            q.push([nx, ny]);
          }
        }

        const textW = maxX - minX + 1;
        const textH = maxY - minY + 1;
        if (count < 25 || textW < 18 || textH < 8) continue;

        const marginX = Math.round(Math.max(8, textW * 0.25));
        const marginY = Math.round(Math.max(6, textH * 0.45));
        const x0 = Math.max(0, minX - marginX);
        const y0 = Math.max(0, minY - marginY);
        const x1 = Math.min(width - 1, maxX + marginX);
        const y1 = Math.min(height - 1, maxY + marginY);
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        const area = w * h;
        if (w < 60 || h < 16 || area < 2200) continue;

        const ar = w / Math.max(1, h);
        if (ar < 1.6 || ar > 28) continue;

        let innerText = 0;
        let innerBorder = 0;
        let n = 0;
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const i = idxOf(x, y);
            if (colorTextMask[i]) innerText += 1;
            if (borderMask[i]) innerBorder += 1;
            n += 1;
          }
        }

        const textDensity = innerText / Math.max(1, n);
        const borderDensity = innerBorder / Math.max(1, n);
        if (textDensity < 0.007) continue;

        const score = (textDensity * 2400) + (borderDensity * 220) + (Math.log10(area + 1) * 5);
        rawCandidates.push({
          x: x0,
          y: y0,
          w,
          h,
          area,
          textDensity,
          score,
          mechanism: "color",
        });
      }
    }

    rawCandidates.sort((a, b) => b.score - a.score);

    const selected = [];
    const iou = (a, b) => {
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const x2 = Math.min(a.x + a.w, b.x + b.w);
      const y2 = Math.min(a.y + a.h, b.y + b.h);
      const iw = Math.max(0, x2 - x1);
      const ih = Math.max(0, y2 - y1);
      const inter = iw * ih;
      const union = (a.w * a.h) + (b.w * b.h) - inter;
      return union > 0 ? inter / union : 0;
    };

    for (const candidate of rawCandidates) {
      const overlaps = selected.some((s) => iou(candidate, s) > 0.5);
      if (!overlaps) selected.push(candidate);
      if (selected.length >= 14) break;
    }

    return selected;
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
    const textDensity = typeof roi.textDensity === "number" ? ` • txt:${(roi.textDensity * 100).toFixed(1)}%` : "";
    const mech = roi.mechanism ? ` • ${roi.mechanism}` : "";
    cap.textContent = `#${idx + 1}${mech} • x:${roi.x} y:${roi.y} w:${roi.w} h:${roi.h}${textDensity}`;

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
