(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";
  const MAX_ROWS = 250;
  // Default tuning used whenever a profile does not provide a specific value.
  // All parameters below can be overridden per equipment profile in device_preprocessing.json.
  const DEFAULT_TUNING = {
    ocrMinConfidence: 0.7,
    color: {
      alphaMin: 20,
      hueGreenMin: 65,
      hueGreenMax: 175,
      satGreenMin: 0.26,
      hueYellowMin: 30,
      hueYellowMax: 80,
      satYellowMin: 0.28,
      hueOrangeMin: 12,
      hueOrangeMax: 50,
      satOrangeMin: 0.28,
      valueMin: 0.2,
      chromaMin: 24,
      strongAlphaMin: 28,
      strongHueGreenMin: 70,
      strongHueGreenMax: 170,
      strongSatGreenMin: 0.36,
      strongHueYellowMin: 32,
      strongHueYellowMax: 74,
      strongSatYellowMin: 0.4,
      strongHueOrangeMin: 14,
      strongHueOrangeMax: 45,
      strongSatOrangeMin: 0.4,
      strongValueMin: 0.22,
      strongChromaMin: 34,
    },
    gray: {
      maxSaturation: 26,
      minLuminance: 60,
      maxLuminance: 210,
      minAlpha: 80,
      minContrast: 18,
    },
    dilation: {
      hRadiusMin: 3,
      hRadiusMax: 12,
      hRadiusDiv: 180,
      vRadiusMin: 1,
      vRadiusMax: 3,
      vRadiusDiv: 600,
      growMaskRadius: 1,
      mergeGapMin: 8,
      mergeGapMax: 26,
      mergeGapDiv: 140,
    },
    geometry: {
      boxMinW: 60,
      boxMinH: 18,
      boxMinArea: 3000,
      boxMinAspect: 1.4,
      boxMaxAspect: 22,
      boxBorderDensityMin: 0.35,
      boxBorderDensityMax: 3.2,
      boxRingSize: 2,
      boxRingCoverageMin: 0.18,
      boxInnerMargin: 2,
      boxTextCountMin: 10,
      boxTextDensityMin: 0.0035,
      boxInnerBorderDensityMax: 0.2,
      negativeMaskPadXMin: 6,
      negativeMaskPadXRatio: 0.08,
      negativeMaskPadYMin: 6,
      negativeMaskPadYRatio: 0.2,
      colorCompMinW: 42,
      colorCompMinH: 8,
      colorCompMinArea: 300,
      colorCompMinAspect: 1.2,
      colorRoiPadXMin: 7,
      colorRoiPadXRatio: 0.147,
      colorRoiPadYMin: 12,
      colorRoiPadYRatio: 0.95,
      colorRoiMinW: 72,
      colorRoiMinH: 16,
      colorRoiMinArea: 2200,
      colorTextCountMin: 16,
      colorTextDensityMin: 0.06,
      colorStrongCountMin: 6,
      colorStrongDensityMin: 0.0008,
      colorStrongShareMin: 0.12,
      colorOverlapIouMin: 0.03,
      colorNearbyGapMinPx: 16,
      colorNearbyGapHeightFactor: 0.8,
      selectionIouMax: 0.5,
    },
  };
  const DEFAULT_PREPROCESS_CONFIG = {
    fallback: {
      manufacturer: "Samsung",
      model: "HS40",
      crop: [140, 55, 5],
      tuning: DEFAULT_TUNING,
    },
    profiles: [
      {
        manufacturer: "Samsung",
        model: "HS40",
        crop: [140, 55, 5],
        tuning: DEFAULT_TUNING,
      },
      {
        manufacturer: "GE",
        model: "LOGIQ P9",
        crop: [100, 40, 8],
        tuning: {
          ...DEFAULT_TUNING,
          color: {
            ...DEFAULT_TUNING.color,
            satGreenMin: 0.24,
            satYellowMin: 0.25,
            satOrangeMin: 0.25,
          },
          geometry: {
            ...DEFAULT_TUNING.geometry,
            colorTextDensityMin: 0.05,
          },
          ocrMinConfidence: 0.68,
        },
      },
    ],
  };

  const rowsEl = document.getElementById("rows");
  const statusLineEl = document.getElementById("statusLine");
  const clearBtnEl = document.getElementById("btnClear");
  const preprocessConfigPromise = loadPreprocessConfig();
  const ocrConfigPromise = loadOcrConfig();
  const imageStore = initImageStore();
  const ocrStore = initOcrStore();
  const ocrRuntime = {
    worker: null,
    initialized: false,
    queue: [],
    inFlight: false,
    uiByRoiId: {},
  };

  const state = {
    total: 0,
    lastMessageId: null,
    lastMetadata: null,
    sentParentSummary: {},
  };

  function setStatus(text) {
    if (statusLineEl) statusLineEl.textContent = text;
  }

  async function loadOcrConfig() {
    try {
      const response = await fetch("./ocr/ocr_runtime_config.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      if (!parsed || typeof parsed !== "object") return { mode: "stub" };
      return parsed;
    } catch (_) {
      return { mode: "stub" };
    }
  }

  function initImageStore() {
    const existing = window.__OCR_DEV_IMAGE_STORE__;
    if (existing && typeof existing === "object" && existing.items && existing.order) {
      return existing;
    }
    const store = {
      items: {},
      order: [],
    };
    window.__OCR_DEV_IMAGE_STORE__ = store;
    return store;
  }

  function initOcrStore() {
    const existing = window.__OCR_DEV_OCR_RESULTS__;
    if (existing && typeof existing === "object" && existing.byRoiId && existing.byParentId) {
      if (!existing.byParentSummary || typeof existing.byParentSummary !== "object") {
        existing.byParentSummary = {};
      }
      return existing;
    }
    const store = {
      byRoiId: {},
      byParentId: {},
      byParentSummary: {},
      order: [],
    };
    window.__OCR_DEV_OCR_RESULTS__ = store;
    return store;
  }

  function saveImageVariantToStore(id, parentId, metadata, profile, blob) {
    if (!id || !blob) return;
    const prev = imageStore.items[id];
    if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);

    const objectUrl = URL.createObjectURL(blob);
    imageStore.items[id] = {
      id,
      parentId: parentId || null,
      ts: Date.now(),
      metadata: metadata || {},
      preprocessProfile: profile || null,
      blob,
      objectUrl,
    };

    if (!imageStore.order.includes(id)) imageStore.order.push(id);
    window.__OCR_DEV_LAST_IMAGE_ID__ = id;
  }

  function clearImageStore() {
    imageStore.order.forEach((id) => {
      const item = imageStore.items[id];
      if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    imageStore.items = {};
    imageStore.order = [];
    window.__OCR_DEV_LAST_IMAGE_ID__ = null;
  }

  function clearOcrStore() {
    ocrStore.byRoiId = {};
    ocrStore.byParentId = {};
    ocrStore.byParentSummary = {};
    ocrStore.order = [];
    window.__OCR_DEV_LAST_OCR_PARENT__ = null;
    ocrRuntime.queue = [];
    ocrRuntime.inFlight = false;
    ocrRuntime.uiByRoiId = {};
  }

  async function initOcrWorkerIfNeeded() {
    if (ocrRuntime.initialized && ocrRuntime.worker) return;
    const worker = new Worker("./ocr/worker.js");
    worker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "batch_result") {
        const results = Array.isArray(data.results) ? data.results : [];
        results.forEach((result) => applyOcrResult(result));
        ocrRuntime.inFlight = false;
        processNextOcrJob();
        return;
      }

      if (data.type === "worker_error") {
        const details = data.error || "Erro no worker OCR";
        ocrRuntime.inFlight = false;
        setStatus(`OCR worker: ${details}`);
        processNextOcrJob();
      }
    });
    worker.addEventListener("error", (err) => {
      ocrRuntime.inFlight = false;
      setStatus(`Falha no OCR worker: ${err.message}`);
    });

    const cfg = await ocrConfigPromise;
    worker.postMessage({ type: "init", config: cfg });
    ocrRuntime.worker = worker;
    ocrRuntime.initialized = true;
  }

  function getRoiStoreRecord(roiId) {
    return ocrStore.byRoiId[roiId] || null;
  }

  function upsertOcrRecord(entry) {
    if (!entry?.roi_id) return;
    const current = ocrStore.byRoiId[entry.roi_id] || {};
    const merged = { ...current, ...entry };
    ocrStore.byRoiId[entry.roi_id] = merged;

    const parentId = merged.parent_message_id || current.parent_message_id;
    if (parentId) {
      if (!Array.isArray(ocrStore.byParentId[parentId])) ocrStore.byParentId[parentId] = [];
      if (!ocrStore.byParentId[parentId].includes(entry.roi_id)) ocrStore.byParentId[parentId].push(entry.roi_id);
      window.__OCR_DEV_LAST_OCR_PARENT__ = parentId;
    }

    if (!ocrStore.order.includes(entry.roi_id)) ocrStore.order.push(entry.roi_id);
  }

  function rebuildParentOcrTextLine(parentMessageId) {
    if (!parentMessageId) return;
    const roiIds = Array.isArray(ocrStore.byParentId[parentMessageId])
      ? ocrStore.byParentId[parentMessageId]
      : [];

    const ordered = roiIds
      .map((id) => ocrStore.byRoiId[id])
      .filter(Boolean)
      .sort((a, b) => Number(a.roi_index || 0) - Number(b.roi_index || 0));

    const line = ordered
      .filter((r) => r.ocr_status === "done")
      .map((r) => String(r.ocr_text_raw || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!ocrStore.byParentSummary) ocrStore.byParentSummary = {};
    ocrStore.byParentSummary[parentMessageId] = {
      parent_message_id: parentMessageId,
      text_line: line,
      updated_at: Date.now(),
    };

    if (imageStore.items[parentMessageId]) {
      imageStore.items[parentMessageId].ocr_text_line = line;
    }
    const anonId = `${parentMessageId}_anonimyzed`;
    if (imageStore.items[anonId]) {
      imageStore.items[anonId].ocr_text_line = line;
    }

    postOcrSummaryToParent(parentMessageId).catch(() => {
      // parent tab may be unavailable while iframe is loading
    });
  }

  async function postOcrSummaryToParent(parentMessageId) {
    if (!parentMessageId) return;
    if (!window.parent || window.parent === window) return;

    const summary = ocrStore.byParentSummary?.[parentMessageId];
    const textLine = String(summary?.text_line || "").trim();
    if (!textLine) return;

    const prev = state.sentParentSummary[parentMessageId] || {};
    const textChanged = prev.textLine !== textLine;
    const needCrop = !prev.cropSent;
    if (!textChanged && !needCrop) return;

    const anonId = `${parentMessageId}_anonimyzed`;
    const cropItem = imageStore.items[anonId];
    let cropBuffer = null;
    if (needCrop && cropItem?.blob) {
      cropBuffer = await cropItem.blob.arrayBuffer();
    }

    const payload = {
      message_id: parentMessageId,
      ocr_text_line: textLine,
      crop_image_id: anonId,
      crop_mime: "image/png",
      metadata: imageStore.items[parentMessageId]?.metadata || {},
      preprocess_profile: imageStore.items[parentMessageId]?.preprocessProfile || null,
      crop_png_buffer: cropBuffer,
      ts: Date.now(),
    };

    if (cropBuffer) {
      window.parent.postMessage({ type: "ocr_result_local", payload }, window.location.origin, [cropBuffer]);
    } else {
      window.parent.postMessage({ type: "ocr_result_local", payload }, window.location.origin);
    }

    state.sentParentSummary[parentMessageId] = {
      textLine,
      cropSent: prev.cropSent || Boolean(cropBuffer),
      ts: Date.now(),
    };
  }

  function updateOcrRowUi(result) {
    const line = ocrRuntime.uiByRoiId[result.roi_id];
    if (!line) return;
    const idx = Number(result.roi_index || 0);
    const idxTag = idx > 0 ? `#${idx}` : result.roi_id;
    const confPct = typeof result.ocr_confidence === "number" ? `${(result.ocr_confidence * 100).toFixed(1)}%` : "--";

    if (result.ocr_status === "pending") {
      line.textContent = `${idxTag} (pendente): ...`;
      return;
    }

    if (result.ocr_status === "filtered_low_conf") {
      const thresholdPct = `${((result.ocr_min_confidence || DEFAULT_TUNING.ocrMinConfidence) * 100).toFixed(0)}%`;
      line.textContent = `${idxTag} (${confPct}): [descartado: abaixo de ${thresholdPct}]`;
      return;
    }

    if (result.ocr_status === "error") {
      line.textContent = `${idxTag} (${confPct}): [erro OCR]`;
      return;
    }

    const text = String(result.ocr_text_raw || "").trim();
    line.textContent = `${idxTag} (${confPct}): ${text || "[sem texto]"}`;
  }

  function applyOcrResult(workerResult) {
    if (!workerResult?.roi_id) return;
    const current = getRoiStoreRecord(workerResult.roi_id) || {};
    const confidence = typeof workerResult.confidence === "number" ? workerResult.confidence : 0;
    const ocrMinConfidence = Number(current.ocr_min_confidence ?? DEFAULT_TUNING.ocrMinConfidence);
    const passesConfidence = confidence >= ocrMinConfidence;
    const statusFromWorker = workerResult.status || "error";
    const finalStatus = statusFromWorker === "done" && !passesConfidence
      ? "filtered_low_conf"
      : statusFromWorker;

    const merged = {
      ...current,
      roi_id: workerResult.roi_id,
      roi_index: current.roi_index || 0,
      parent_message_id: workerResult.parent_message_id || current.parent_message_id || null,
      ocr_status: finalStatus,
      ocr_text_raw: finalStatus === "done" ? (workerResult.text || "") : "",
      ocr_confidence: confidence,
      ocr_min_confidence: ocrMinConfidence,
      model_used: workerResult.model_used || "stub",
      latency_ms: workerResult.latency_ms || 0,
      debug: workerResult.debug || null,
      error: workerResult.error || "",
      updated_at: Date.now(),
    };
    upsertOcrRecord(merged);
    rebuildParentOcrTextLine(merged.parent_message_id);
    updateOcrRowUi(merged);
  }

  function enqueueOcrJob(job) {
    if (!job || !Array.isArray(job.rois) || !job.rois.length) return;
    ocrRuntime.queue.push(job);
    processNextOcrJob();
  }

  async function processNextOcrJob() {
    if (ocrRuntime.inFlight) return;
    if (!ocrRuntime.queue.length) return;
    await initOcrWorkerIfNeeded();
    if (!ocrRuntime.worker) return;

    const next = ocrRuntime.queue.shift();
    if (!next) return;
    ocrRuntime.inFlight = true;
    ocrRuntime.worker.postMessage(
      {
        type: "process_batch",
        parent_message_id: next.parentMessageId,
        rois: next.rois,
      },
    );
  }

  async function loadPreprocessConfig() {
    try {
      const response = await fetch("./device_preprocessing.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      if (!parsed || typeof parsed !== "object") return DEFAULT_PREPROCESS_CONFIG;
      if (!Array.isArray(parsed.profiles)) parsed.profiles = [];
      if (!parsed.fallback || !Array.isArray(parsed.fallback.crop)) {
        parsed.fallback = DEFAULT_PREPROCESS_CONFIG.fallback;
      }
      return parsed;
    } catch (_) {
      return DEFAULT_PREPROCESS_CONFIG;
    }
  }

  function normalizeKey(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function getMetadataDevice(metadata) {
    const m = metadata && typeof metadata === "object" ? metadata : {};
    const manufacturer =
      m.Manufacturer ||
      m.manufacturer ||
      m.manufacturer_name ||
      "";
    const model =
      m.ManufacturerModelName ||
      m.manufacturer_model_name ||
      m.model_name ||
      m.ModelName ||
      "";
    return { manufacturer, model };
  }

  function sanitizeCrop(crop) {
    if (!Array.isArray(crop)) return [0, 0, 0];
    return [
      Math.max(0, Math.round(Number(crop[0]) || 0)),
      Math.max(0, Math.round(Number(crop[1]) || 0)),
      Math.max(0, Math.round(Number(crop[2]) || 0)),
    ];
  }

  function mergeTuning(base, override) {
    const out = { ...base };
    const src = override && typeof override === "object" ? override : {};
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
        out[k] = mergeTuning(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function resolvePreprocessProfile(metadata, config) {
    const cfg = config || DEFAULT_PREPROCESS_CONFIG;
    const { manufacturer, model } = getMetadataDevice(metadata);
    const mKey = normalizeKey(manufacturer);
    const modelKey = normalizeKey(model);

    const profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
    const matched = profiles.find((p) => {
      const pm = normalizeKey(p?.manufacturer);
      const pmodel = normalizeKey(p?.model);
      if (!pm || !pmodel) return false;
      return pm === mKey && pmodel === modelKey;
    });

    const fallback = cfg.fallback || DEFAULT_PREPROCESS_CONFIG.fallback;
    const selected = matched || fallback;
    const fallbackTuning = mergeTuning(DEFAULT_TUNING, fallback.tuning || {});
    const selectedTuning = mergeTuning(fallbackTuning, selected.tuning || {});
    return {
      manufacturer: selected.manufacturer || fallback.manufacturer || "Samsung",
      model: selected.model || fallback.model || "HS40",
      crop: sanitizeCrop(selected.crop || fallback.crop),
      tuning: selectedTuning,
      isFallback: !matched,
    };
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
    const manufacturer = m.Manufacturer || m.manufacturer || m.manufacturer_name || "-";
    const model =
      m.ManufacturerModelName ||
      m.manufacturer_model_name ||
      m.model_name ||
      m.ModelName ||
      "-";
    return { patient, date, pid, modality, manufacturer, model, raw: m };
  }

  function arrayBufferFromBase64(base64) {
    const clean = base64.includes(",") ? base64.split(",").pop() : base64;
    const binary = atob(clean || "");
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function canvasToBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Falha ao converter canvas para blob"));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
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

  function applyPreprocessCrop(canvas, profile) {
    const sourceW = canvas.width;
    const sourceH = canvas.height;
    const [leftCrop, topCrop, rightCrop] = sanitizeCrop(profile?.crop || [0, 0, 0]);

    const x = Math.min(sourceW - 1, leftCrop);
    const y = Math.min(sourceH - 1, topCrop);
    const w = Math.max(1, sourceW - leftCrop - rightCrop);
    const h = Math.max(1, sourceH - topCrop);

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d", { willReadFrequently: true });
    octx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return {
      canvas: out,
      ctx: octx,
      width: w,
      height: h,
      crop: [leftCrop, topCrop, rightCrop],
    };
  }

  function detectCandidateRois(ctx, width, height, tuning) {
    const t = tuning || DEFAULT_TUNING;
    const colorCfg = t.color || DEFAULT_TUNING.color;
    const grayCfg = t.gray || DEFAULT_TUNING.gray;
    const dilCfg = t.dilation || DEFAULT_TUNING.dilation;
    const geoCfg = t.geometry || DEFAULT_TUNING.geometry;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const borderMask = new Uint8Array(width * height);
    const colorTextMask = new Uint8Array(width * height);
    const strongColorMask = new Uint8Array(width * height);
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
      return sat <= grayCfg.maxSaturation && lum >= grayCfg.minLuminance && lum <= grayCfg.maxLuminance;
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
      if (a < colorCfg.alphaMin) return false;
      const { h, s, v } = rgbToHsv(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (chroma < colorCfg.chromaMin) return false;
      const isGreen = h >= colorCfg.hueGreenMin && h <= colorCfg.hueGreenMax && s >= colorCfg.satGreenMin && v >= colorCfg.valueMin;
      const isYellow = h >= colorCfg.hueYellowMin && h <= colorCfg.hueYellowMax && s >= colorCfg.satYellowMin && v >= colorCfg.valueMin;
      const isOrange = h >= colorCfg.hueOrangeMin && h <= colorCfg.hueOrangeMax && s >= colorCfg.satOrangeMin && v >= colorCfg.valueMin;
      return isGreen || isYellow || isOrange;
    };

    const isStrongOrangeOrGreenText = (r, g, b, a) => {
      if (a < colorCfg.strongAlphaMin) return false;
      const { h, s, v } = rgbToHsv(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (chroma < colorCfg.strongChromaMin) return false;
      const isGreen =
        h >= colorCfg.strongHueGreenMin && h <= colorCfg.strongHueGreenMax &&
        s >= colorCfg.strongSatGreenMin && v >= colorCfg.strongValueMin;
      const isYellow =
        h >= colorCfg.strongHueYellowMin && h <= colorCfg.strongHueYellowMax &&
        s >= colorCfg.strongSatYellowMin && v >= colorCfg.strongValueMin;
      const isOrange =
        h >= colorCfg.strongHueOrangeMin && h <= colorCfg.strongHueOrangeMax &&
        s >= colorCfg.strongSatOrangeMin && v >= colorCfg.strongValueMin;
      return isGreen || isYellow || isOrange;
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
        if (isStrongOrangeOrGreenText(r, g, b, a)) strongColorMask[i] = 1;
        if (!isGrayLike(r, g, b) || a < grayCfg.minAlpha) continue;

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

        if (contrast >= grayCfg.minContrast) borderMask[i] = 1;
      }
    }

    // Grow mask to reconnect anti-aliased text strokes.
    const grownColorMask = colorTextMask.slice();
    const growR = Math.max(1, Number(dilCfg.growMaskRadius || 1));
    for (let y = growR; y < height - growR; y += 1) {
      for (let x = growR; x < width - growR; x += 1) {
        const i = idxOf(x, y);
        if (colorTextMask[i]) continue;
        for (let dy = -growR; dy <= growR; dy += 1) {
          for (let dx = -growR; dx <= growR; dx += 1) {
            if (!dx && !dy) continue;
            if (colorTextMask[idxOf(x + dx, y + dy)]) {
              grownColorMask[i] = 1;
              dx = growR + 2;
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

    const mergeOverlappingColorCandidates = (candidates) => {
      const out = candidates.map((c) => ({ ...c }));
      const boxGapDistance = (a, b) => {
        const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
        const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
        return Math.hypot(dx, dy);
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < out.length; i += 1) {
          let mergedThisRound = false;
          for (let j = i + 1; j < out.length; j += 1) {
            const a = out[i];
            const b = out[j];
            const overlap = iou(a, b);
            const dist = boxGapDistance(a, b);
            const closeEnough = dist <= Math.max(geoCfg.colorNearbyGapMinPx, Math.min(a.h, b.h) * geoCfg.colorNearbyGapHeightFactor);
            if (overlap < geoCfg.colorOverlapIouMin && !closeEnough) continue;

            const x0 = Math.min(a.x, b.x);
            const y0 = Math.min(a.y, b.y);
            const x1 = Math.max(a.x + a.w - 1, b.x + b.w - 1);
            const y1 = Math.max(a.y + a.h - 1, b.y + b.h - 1);
            const merged = {
              x: x0,
              y: y0,
              w: x1 - x0 + 1,
              h: y1 - y0 + 1,
              area: (x1 - x0 + 1) * (y1 - y0 + 1),
              textDensity: Math.max(a.textDensity || 0, b.textDensity || 0),
              score: Math.max(a.score || 0, b.score || 0) + 1.5,
              mechanism: "color_pipeline",
            };
            out[i] = merged;
            out.splice(j, 1);
            changed = true;
            mergedThisRound = true;
            break;
          }
          if (mergedThisRound) break;
        }
      }
      return out;
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

    const paintMaskRect = (mask, x0, y0, x1, y1, value = 1) => {
      const rx0 = Math.max(0, x0);
      const ry0 = Math.max(0, y0);
      const rx1 = Math.min(width - 1, x1);
      const ry1 = Math.min(height - 1, y1);
      for (let y = ry0; y <= ry1; y += 1) {
        const row = y * width;
        for (let x = rx0; x <= rx1; x += 1) {
          mask[row + x] = value;
        }
      }
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
        if (w < geoCfg.boxMinW || h < geoCfg.boxMinH || area < geoCfg.boxMinArea) continue;

        const ar = w / Math.max(1, h);
        if (ar < geoCfg.boxMinAspect || ar > geoCfg.boxMaxAspect) continue;

        const perimeter = (2 * w) + (2 * h);
        const borderDensityPerimeter = borderCount / Math.max(1, perimeter);
        if (borderDensityPerimeter < geoCfg.boxBorderDensityMin || borderDensityPerimeter > geoCfg.boxBorderDensityMax) continue;

        const ring = countBorderPixelsOnRing(minX, minY, maxX, maxY, geoCfg.boxRingSize);
        const ringCoverage = ring.total ? ring.borderCount / ring.total : 0;
        if (ringCoverage < geoCfg.boxRingCoverageMin) continue;

        const ix0 = minX + geoCfg.boxInnerMargin;
        const iy0 = minY + geoCfg.boxInnerMargin;
        const ix1 = maxX - geoCfg.boxInnerMargin;
        const iy1 = maxY - geoCfg.boxInnerMargin;
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

        if (textCount < geoCfg.boxTextCountMin || textDensity < geoCfg.boxTextDensityMin) continue;
        if (innerBorderDensity > geoCfg.boxInnerBorderDensityMax) continue;

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

    // Build negative mask from gray boxes, so color search runs only outside these areas.
    const negativeMask = new Uint8Array(width * height);
    for (const candidate of rawCandidates) {
      if (candidate.mechanism !== "box") continue;
      const padX = Math.max(geoCfg.negativeMaskPadXMin, Math.round(candidate.w * geoCfg.negativeMaskPadXRatio));
      const padY = Math.max(geoCfg.negativeMaskPadYMin, Math.round(candidate.h * geoCfg.negativeMaskPadYRatio));
      paintMaskRect(
        negativeMask,
        candidate.x - padX,
        candidate.y - padY,
        candidate.x + candidate.w - 1 + padX,
        candidate.y + candidate.h - 1 + padY,
        1,
      );
    }

    const colorSearchMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const i = row + x;
        if (grownColorMask[i] && !negativeMask[i]) colorSearchMask[i] = 1;
      }
    }

    // Color pipeline: HSV mask -> horizontal dilation -> light vertical dilation -> CC -> merge -> ROI.
    const hRadius = Math.max(dilCfg.hRadiusMin, Math.min(dilCfg.hRadiusMax, Math.round(width / dilCfg.hRadiusDiv)));
    const vRadius = Math.max(dilCfg.vRadiusMin, Math.min(dilCfg.vRadiusMax, Math.round(height / dilCfg.vRadiusDiv)));
    const dilatedColorMask = dilateMask(colorSearchMask, hRadius, vRadius);
    const colorBoxesRaw = connectedComponentsBoxes(dilatedColorMask, visitedColorRaw, 10);
    const mergeGap = Math.max(dilCfg.mergeGapMin, Math.min(dilCfg.mergeGapMax, Math.round(width / dilCfg.mergeGapDiv)));
    const colorBoxesMerged = mergeCloseBoxes(colorBoxesRaw, mergeGap, 0.4);

    const colorCandidatesRaw = [];
    for (const box of colorBoxesMerged) {
      if (box.w < geoCfg.colorCompMinW || box.h < geoCfg.colorCompMinH || box.area < geoCfg.colorCompMinArea) continue;
      if ((box.w / Math.max(1, box.h)) < geoCfg.colorCompMinAspect) continue;

      const padX = Math.max(geoCfg.colorRoiPadXMin, Math.round(box.w * geoCfg.colorRoiPadXRatio));
      const padY = Math.max(geoCfg.colorRoiPadYMin, Math.round(box.h * geoCfg.colorRoiPadYRatio));
      const x0 = Math.max(0, box.minX - padX);
      const y0 = Math.max(0, box.minY - padY);
      const x1 = Math.min(width - 1, box.maxX + padX);
      const y1 = Math.min(height - 1, box.maxY + padY);

      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const area = w * h;
      if (w < geoCfg.colorRoiMinW || h < geoCfg.colorRoiMinH || area < geoCfg.colorRoiMinArea) continue;

      let textCount = 0;
      let strongCount = 0;
      let n = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const idx = idxOf(x, y);
          if (colorSearchMask[idx]) textCount += 1;
          if (strongColorMask[idx]) strongCount += 1;
          n += 1;
        }
      }

      const textDensity = textCount / Math.max(1, n);
      const strongDensity = strongCount / Math.max(1, n);
      const strongShare = strongCount / Math.max(1, textCount);
      if (textCount < geoCfg.colorTextCountMin || textDensity < geoCfg.colorTextDensityMin) continue;
      if (strongCount < geoCfg.colorStrongCountMin || strongDensity < geoCfg.colorStrongDensityMin || strongShare < geoCfg.colorStrongShareMin) continue;

      const score = (textDensity * 3400) + (strongDensity * 2600) + (Math.log10(area + 1) * 4.5) + (box.w / Math.max(1, box.h));
      colorCandidatesRaw.push({
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

    const mergedColorCandidates = mergeOverlappingColorCandidates(colorCandidatesRaw);
    mergedColorCandidates.forEach((c) => rawCandidates.push(c));

    const selected = [];

    const addIfNoStrongOverlap = (candidate) => {
      const overlaps = selected.some((s) => iou(candidate, s) > geoCfg.selectionIouMax);
      if (!overlaps) selected.push(candidate);
    };

    const boxCandidates = rawCandidates
      .filter((c) => c.mechanism === "box")
      .sort((a, b) => b.score - a.score);

    const colorCandidatesRanked = rawCandidates
      .filter((c) => c.mechanism !== "box")
      .sort((a, b) => b.score - a.score);

    for (const candidate of boxCandidates) {
      addIfNoStrongOverlap(candidate);
      if (selected.length >= 12) break;
    }

    for (const candidate of colorCandidatesRanked) {
      addIfNoStrongOverlap(candidate);
      if (selected.length >= 20) break;
    }

    return selected;
  }

  function buildRoiThumb(sourceCanvas, roi, idx) {
    const c = extractRoiCanvas(sourceCanvas, roi);

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

  function extractRoiCanvas(sourceCanvas, roi) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, roi.w);
    c.height = Math.max(1, roi.h);
    c.getContext("2d").drawImage(sourceCanvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
    return c;
  }

  function createOcrResultLine(roiRecord) {
    const line = document.createElement("div");
    line.className = "meta";
    const idx = Number(roiRecord.roi_index || 0);
    line.textContent = `${idx > 0 ? `#${idx}` : roiRecord.roi_id} (pendente): ...`;
    return line;
  }

  function buildMetaCell(messageId, metaSummary) {
    const box = document.createElement("div");
    box.className = "meta";
    box.innerHTML = [
      `<strong>Paciente:</strong> ${metaSummary.patient}`,
      `<br><strong>Data:</strong> ${metaSummary.date}`,
      `<br><strong>Registro:</strong> ${metaSummary.pid}`,
      `<br><strong>Modalidade:</strong> ${metaSummary.modality}`,
      `<br><strong>Fabricante:</strong> ${metaSummary.manufacturer}`,
      `<br><strong>Modelo:</strong> ${metaSummary.model}`,
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

    const preprocessConfig = await preprocessConfigPromise;
    const preprocessProfile = resolvePreprocessProfile(data.metadata, preprocessConfig);
    const decoded = await decodeImage(pngBuffer);
    const parentMessageId = data.message_id || String(Date.now());
    const anonymizedId = `${parentMessageId}_anonimyzed`;
    const original = drawImageToCanvas(decoded.image);
    const preprocessed = applyPreprocessCrop(original.canvas, preprocessProfile);
    const rois = detectCandidateRois(preprocessed.ctx, preprocessed.width, preprocessed.height, preprocessProfile.tuning);
    const metaSummary = summarizeMetadata(data.metadata);
    const anonymizedBlob = await canvasToBlob(preprocessed.canvas, "image/png");

    saveImageVariantToStore(parentMessageId, null, data.metadata, preprocessProfile, decoded.blob);
    saveImageVariantToStore(anonymizedId, parentMessageId, data.metadata, preprocessProfile, anonymizedBlob);

    const tr = document.createElement("tr");

    const tdOriginal = document.createElement("td");
    tdOriginal.className = "original-cell";
    const originalImg = document.createElement("img");
    originalImg.loading = "lazy";
    originalImg.src = imageStore.items[parentMessageId]?.objectUrl || URL.createObjectURL(decoded.blob);
    originalImg.alt = parentMessageId;
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
      rois.forEach((roi, i) => grid.appendChild(buildRoiThumb(preprocessed.canvas, roi, i)));
    }
    tdRois.appendChild(grid);

    const roiDescriptors = await Promise.all(
      rois.map(async (roi, index) => {
        const roiId = `${parentMessageId}_roi_${index + 1}`;
        const roiImageId = `${roiId}_anonimyzed`;
        const roiCanvas = extractRoiCanvas(preprocessed.canvas, roi);
        const roiBlob = await canvasToBlob(roiCanvas, "image/png");
        saveImageVariantToStore(roiImageId, parentMessageId, data.metadata, preprocessProfile, roiBlob);

        const created = {
          roi_id: roiId,
          roi_index: index + 1,
          parent_message_id: parentMessageId,
          parent_image_id: parentMessageId,
          parent_image_anonymized_id: anonymizedId,
          roi_image_id: roiImageId,
          roi_box: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
          roi_area: roi.w * roi.h,
          device: {
            manufacturer: preprocessProfile.manufacturer,
            model: preprocessProfile.model,
          },
          crop_profile: preprocessProfile.crop,
          ocr_min_confidence: Number(preprocessProfile?.tuning?.ocrMinConfidence ?? DEFAULT_TUNING.ocrMinConfidence),
          ocr_status: "pending",
          ocr_text_raw: "",
          ocr_confidence: 0,
          trigger_flags: [],
          created_at: Date.now(),
        };
        upsertOcrRecord(created);

        return {
          roi_id: roiId,
          roi_index: index + 1,
          parent_message_id: parentMessageId,
          x: roi.x,
          y: roi.y,
          w: roi.w,
          h: roi.h,
          image_blob: roiBlob,
        };
      }),
    );

    const tdOcr = document.createElement("td");
    const cropPreview = document.createElement("img");
    cropPreview.loading = "lazy";
    cropPreview.src = imageStore.items[anonymizedId]?.objectUrl || URL.createObjectURL(anonymizedBlob);
    cropPreview.alt = "Pré-processamento (crop)";
    cropPreview.style.maxWidth = "320px";
    cropPreview.style.width = "100%";
    cropPreview.style.border = "1px solid #d2dbe8";
    cropPreview.style.borderRadius = "8px";
    tdOcr.appendChild(cropPreview);

    const cropCaption = document.createElement("div");
    cropCaption.className = "meta";
    const c = preprocessed.crop;
    cropCaption.innerHTML = [
      `<br><strong>Perfil:</strong> ${preprocessProfile.manufacturer} ${preprocessProfile.model}`,
      `<br><strong>Cortes (px):</strong> [${c[0]}, ${c[1]}, ${c[2]}]`,
      `<br><strong>Origem:</strong> ${preprocessProfile.isFallback ? "modelo não identificado, usando Default" : "metadado"}`,
      `<br><code>id imagem: ${parentMessageId}</code>`,
    ].join("");
    tdOcr.appendChild(cropCaption);

    const ocrPanel = document.createElement("div");
    ocrPanel.className = "meta";
    ocrPanel.style.marginTop = "8px";
    ocrPanel.innerHTML = "<strong>Resultado OCR:</strong>";
    tdOcr.appendChild(ocrPanel);

    if (!roiDescriptors.length) {
      const empty = document.createElement("div");
      empty.className = "placeholder";
      empty.textContent = "Sem ROIs para OCR nesta imagem.";
      tdOcr.appendChild(empty);
    } else {
      roiDescriptors.forEach((item) => {
        const record = getRoiStoreRecord(item.roi_id) || { roi_id: item.roi_id };
        const line = createOcrResultLine(record);
        ocrRuntime.uiByRoiId[item.roi_id] = line;
        tdOcr.appendChild(line);
      });
    }

    const tdMeta = document.createElement("td");
    tdMeta.appendChild(buildMetaCell(parentMessageId, metaSummary));

    tr.appendChild(tdOriginal);
    tr.appendChild(tdRois);
    tr.appendChild(tdOcr);
    tr.appendChild(tdMeta);

    rowsEl.prepend(tr);
    trimRows();

    state.total += 1;
    state.lastMessageId = parentMessageId;
    state.lastMetadata = data.metadata || null;

    setStatus(`Total: ${state.total} imagem(ns) processadas | Última: ${state.lastMessageId || "sem id"} | Perfil: ${preprocessProfile.manufacturer} ${preprocessProfile.model} | ROIs: ${rois.length}`);
    if (roiDescriptors.length) {
      enqueueOcrJob({
        parentMessageId,
        rois: roiDescriptors,
      });
    }
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
    state.sentParentSummary = {};
    clearImageStore();
    clearOcrStore();
    setStatus("Tabela limpa. Aguardando novas imagens...");
  }

  window.addEventListener("message", onMessage);
  clearBtnEl?.addEventListener("click", clearTable);

  setStatus("Aguardando imagens via postMessage... origem permitida principal: http://127.0.0.1:8099");
  setInterval(postSettingsUpdate, 1000);
  window.addEventListener("DOMContentLoaded", () => {
    postSettingsUpdate();
    initOcrWorkerIfNeeded().catch((err) => {
      setStatus(`OCR worker não inicializado: ${err.message}`);
    });
  });
})();
