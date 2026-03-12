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
    const visitedColorRaw = new Uint8Array(width * height);
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

    const rgbToHsv = (r, g, b) => {
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      const maxc = Math.max(rn, gn, bn);
      const minc = Math.min(rn, gn, bn);
      const d = maxc - minc;
      let h = 0;

      if (d > 0) {
        if (maxc === rn) h = ((gn - bn) / d) % 6;
        else if (maxc === gn) h = ((bn - rn) / d) + 2;
        else h = ((rn - gn) / d) + 4;
        h *= 60;
        if (h < 0) h += 360;
      }

      const s = maxc === 0 ? 0 : d / maxc;
      const v = maxc;
      return { h, s, v };
    };

    const isOrangeOrGreenText = (r, g, b, a) => {
      if (a < 20) return false;
      const { h, s, v } = rgbToHsv(r, g, b);
      const isGreen = h >= 70 && h <= 170 && s >= 0.2 && v >= 0.2;
      const isYellow = h >= 35 && h <= 75 && s >= 0.22 && v >= 0.2;
      const isOrange = h >= 15 && h <= 45 && s >= 0.22 && v >= 0.22;
      const nearOrange = r >= 110 && g >= 45 && b <= 130 && r > g && g > b;
      return isGreen || isYellow || isOrange || nearOrange;
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

    // Grows the color mask by 1px to recover anti-aliased/translucent characters.
    const grownColorMask = colorTextMask.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = idxOf(x, y);
        if (colorTextMask[i]) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            if (colorTextMask[idxOf(x + dx, y + dy)]) {
              grownColorMask[i] = 1;
              dx = 2;
              break;
            }
          }
        }
      }
    }

    const neighbors8 = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const dilateMask = (mask, rx, ry) => {
      const tmp = new Uint8Array(width * height);
      const out = new Uint8Array(width * height);

      for (let y = 0; y < height; y += 1) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x += 1) {
          if (!mask[rowOffset + x]) continue;
          const x0 = Math.max(0, x - rx);
          const x1 = Math.min(width - 1, x + rx);
          for (let tx = x0; tx <= x1; tx += 1) tmp[rowOffset + tx] = 1;
        }
      }

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!tmp[idxOf(x, y)]) continue;
          const y0 = Math.max(0, y - ry);
          const y1 = Math.min(height - 1, y + ry);
          for (let ty = y0; ty <= y1; ty += 1) out[idxOf(x, ty)] = 1;
        }
      }

      return out;
    };

    const connectedComponentsBoxes = (mask, visited, minPixels = 1) => {
      const boxes = [];
      for (let sy = 1; sy < height - 1; sy += 1) {
        for (let sx = 1; sx < width - 1; sx += 1) {
          const seed = idxOf(sx, sy);
          if (!mask[seed] || visited[seed]) continue;

          const q = [[sx, sy]];
          visited[seed] = 1;
          let minX = sx;
          let minY = sy;
          let maxX = sx;
          let maxY = sy;
          let count = 0;

          for (let head = 0; head < q.length; head += 1) {
            const [cx, cy] = q[head];
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
              if (visited[ni] || !mask[ni]) continue;
              visited[ni] = 1;
              q.push([nx, ny]);
            }
          }

          if (count < minPixels) continue;
          boxes.push({
            minX,
            minY,
            maxX,
            maxY,
            w: maxX - minX + 1,
            h: maxY - minY + 1,
            area: (maxX - minX + 1) * (maxY - minY + 1),
            count,
          });
        }
      }
      return boxes;
    };

    const mergeCloseBoxes = (boxes, gapLimit, overlapRatioMin) => {
      const merged = boxes.map((b) => ({ ...b }));
      if (merged.length < 2) return merged;

      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < merged.length; i += 1) {
          let mergedThisRound = false;
          for (let j = i + 1; j < merged.length; j += 1) {
            const a = merged[i];
            const b = merged[j];

            const overlapY = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1);
            const overlapRatio = overlapY / Math.max(1, Math.min(a.h, b.h));

            let gapX = 0;
            if (a.maxX < b.minX) gapX = b.minX - a.maxX;
            else if (b.maxX < a.minX) gapX = a.minX - b.maxX;

            if (gapX <= gapLimit && overlapRatio >= overlapRatioMin) {
              const n = {
                minX: Math.min(a.minX, b.minX),
                minY: Math.min(a.minY, b.minY),
                maxX: Math.max(a.maxX, b.maxX),
                maxY: Math.max(a.maxY, b.maxY),
              };
              n.w = n.maxX - n.minX + 1;
              n.h = n.maxY - n.minY + 1;
              n.area = n.w * n.h;
              n.count = (a.count || 0) + (b.count || 0);
              merged[i] = n;
              merged.splice(j, 1);
              changed = true;
              mergedThisRound = true;
              break;
            }
          }
          if (mergedThisRound) break;
        }
      }

      return merged;
    };

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
            if (grownColorMask[i]) textCount += 1;
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

    // Color pipeline: HSV mask -> horizontal dilation -> light vertical dilation -> CC -> merge -> ROI.
    const hRadius = Math.max(3, Math.min(12, Math.round(width / 180)));
    const vRadius = Math.max(1, Math.min(3, Math.round(height / 600)));
    const dilatedColorMask = dilateMask(grownColorMask, hRadius, vRadius);
    const colorBoxesRaw = connectedComponentsBoxes(dilatedColorMask, visitedColorRaw, 10);
    const mergeGap = Math.max(8, Math.min(26, Math.round(width / 140)));
    const colorBoxesMerged = mergeCloseBoxes(colorBoxesRaw, mergeGap, 0.4);

    for (const box of colorBoxesMerged) {
      if (box.w < 20 || box.h < 6 || box.area < 30) continue;
      if ((box.w / Math.max(1, box.h)) < 1.2) continue;

      const padX = Math.max(16, Math.round(box.w * 0.35));
      const padY = Math.max(12, Math.round(box.h * 0.95));
      const x0 = Math.max(0, box.minX - padX);
      const y0 = Math.max(0, box.minY - padY);
      const x1 = Math.min(width - 1, box.maxX + padX);
      const y1 = Math.min(height - 1, box.maxY + padY);

      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const area = w * h;
      if (w < 60 || h < 14 || area < 1800) continue;

      let textCount = 0;
      let n = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (grownColorMask[idxOf(x, y)]) textCount += 1;
          n += 1;
        }
      }

      const textDensity = textCount / Math.max(1, n);
      if (textCount < 12 || textDensity < 0.0016) continue;

      const score = (textDensity * 3400) + (Math.log10(area + 1) * 4.5) + (box.w / Math.max(1, box.h));
      rawCandidates.push({
        x: x0,
        y: y0,
        w,
        h,
        area,
        textDensity,
        score,
        mechanism: "color_pipeline",
      });
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
      if (selected.length >= 20) break;
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
