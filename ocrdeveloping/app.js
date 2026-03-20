(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";
  function getReferrerOrigin() {
    try {
      return document.referrer ? new URL(document.referrer).origin : "";
    } catch (_) {
      return "";
    }
  }
  let parentBridgeOrigin = getReferrerOrigin() || BRIDGE_ORIGIN;
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
      // Thresholds dedicated to box_yellow detection.
      boxYellowHueMin: 54,
      boxYellowHueMax: 86,
      boxYellowSatMin: 0.0785,
      boxYellowValueMin: 0.392,
      hueOrangeMin: 24,
      hueOrangeMax: 48,
      satOrangeMin: 0.6275,
      orangeValueMin: 0.6275,
      valueMin: 0.2,
      chromaMin: 24,
      strongAlphaMin: 28,
      strongHueGreenMin: 70,
      strongHueGreenMax: 170,
      strongSatGreenMin: 0.36,
      strongHueYellowMin: 32,
      strongHueYellowMax: 74,
      strongSatYellowMin: 0.4,
      strongHueOrangeMin: 24,
      strongHueOrangeMax: 48,
      strongSatOrangeMin: 0.6275,
      strongOrangeValueMin: 0.6275,
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
      // (4) Dilatacao vertical reduzida para evitar capturar linha de baixo.
      vRadiusMin: 0,
      vRadiusMax: 1,
      vRadiusDiv: 1200,
      growMaskRadius: 1,
      mergeGapMin: 8,
      mergeGapMax: 26,
      mergeGapDiv: 140,
    },
    geometry: {
      boxMinW: 60,
      boxMinH: 18,
      boxLineHeightPx: 40,
      boxMinArea: 3000,
      boxMinAspect: 1.4,
      boxMaxAspect: 22,
      boxBorderDensityMin: 0.35,
      boxBorderDensityMax: 3.2,
      boxRingSize: 2,
      boxRingCoverageMin: 0.18,
      boxInnerMargin: 2,
      boxMergeNearbyGapPx: 10,
      boxMergeMinYOverlapRatio: 0.6,
      boxMergeMinXOverlapRatio: 0.2,
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
      colorRoiPadXMin: 5,
      colorRoiPadXRatio: 0.096,
      // (7) Margem vertical final do ROI reduzida para cortar excesso em cima/baixo.
      colorRoiPadYMin: 2,
      colorRoiPadYRatio: 0.12,
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
            satOrangeMin: 0.6275,
            orangeValueMin: 0.6275,
          },
          geometry: {
            ...DEFAULT_TUNING.geometry,
            colorTextDensityMin: 0.05,
            colorRoiPadXRatio: 0.078,
          },
          ocrMinConfidence: 0.68,
        },
      },
    ],
  };
  const OCR_KIND = {
    LEGEND: "legend",
    MEASURE: "measure",
  };
  const LEGEND_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,/%-()";
  const MEASURE_WHITELIST = "0123456789.,%/()- cmx";
  const BASE_ABBREVIATIONS = ["ANT.", "POST.", "LAT.", "MED."];
  const MODEL_JSON_DIRECTORY = "../modelos";
  const MODEL_INDEX_PATH = `${MODEL_JSON_DIRECTORY}/index.json`;
  const ENABLE_COLOR_CANDIDATE_MERGE = false;
  // Merge de candidatos de box ativado para fundir fragmentos muito proximos.
  const ENABLE_BOX_CANDIDATE_MERGE = true;
  const ENABLE_LINE_SPLIT_DEBUG = true;
  const MIN_ORIGINAL_ROI_TEXT_DENSITY = 0.10;
  const ROI_MARGIN_X = 10;
  const ROI_MARGIN_Y = 6;
  const COLOR_HORIZONTAL_MERGE_GAP_PX = 2;
  const COLOR_HORIZONTAL_MERGE_MIN_Y_OVERLAP = 0.35;
  const LINE_SPLIT_OPTIONS = {
    minActiveRowPixelsRatio: 0.02,
    minBandHeightPx: 3,
    mergeBandGapPx: 2,
    lowSatThresholdOffset: 10,
    minGapHeightPx: 3,
    minGapLowSatRatio: 0.65,
    maxGapHighSatRatio: 0.12,
    minCutDistancePx: 35,
    yellowBlockRatio: 0.06,
    highSatBlockRatio: 0.2,
    lineHeightTargetPx: 41,
    firstLineMaxExtraFactor: 1.2,
    gridSnapWindowFactor: 0.35,
    yellowHueMin: 18,
    yellowHueMax: 42,
    yellowSatMin: 70,
    yellowValMin: 120,
    nonYellowSatMin: 70,
    nonYellowValMin: 90,
    halfNoisePenalty: 1.25,
    projectionSmoothRadius: 1,
    minBandsForSplit: 2,
    minLineHeightPx: 6,
    lineHeightMinFactor: 0.4,
    lineHeightMaxFactor: 2.4,
    // Margem vertical aplicada em cada sub-ROI (1.1, 1.2...) antes do OCR.
    cropMarginY: 2,
  };
  const ROI_VERTICAL_TIGHTEN_OPTIONS = {
    minActiveRowPixelsRatio: 0.015,
    keepMarginFactor: 0.5,
    // Devolve pequena margem no ROI original apos o tighten.
    restoreMarginY: 2,
    minHeightPx: 10,
  };

  const rowsEl = document.getElementById("rows");
  const statusLineEl = document.getElementById("statusLine");
  const clearBtnEl = document.getElementById("btnClear");
  const preprocessConfigPromise = loadPreprocessConfig();
  const ocrConfigPromise = loadOcrConfig();
  const legendVocabularyPromise = montarVocabularioDosJson();
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
    const summaryCandidates = ordered.filter((r) => !r.exclude_from_parent_summary);

    const isTerminalStatus = (s) => s === "done" || s === "error" || s === "waiting_model";
    const terminalCount = summaryCandidates.filter((r) => isTerminalStatus(r.ocr_status)).length;
    const allRoisFinished = summaryCandidates.length > 0 && terminalCount === summaryCandidates.length;
    if (!allRoisFinished) return;

    const doneWithText = summaryCandidates
      .filter((r) => r.ocr_status === "done")
      .map((r) => {
        const rawText = String(r.ocr_text_raw || "");
        const isPaddleBox = Array.isArray(r.trigger_flags) && r.trigger_flags.includes("paddle_original_box_eval");
        const text = isPaddleBox
          ? rawText
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join("\n")
          : rawText.replace(/\s+/g, " ").trim();
        const box = r.roi_box && typeof r.roi_box === "object" ? r.roi_box : {};
        const x = Number(box.x || 0);
        const y = Number(box.y || 0);
        const w = Math.max(1, Number(box.w || 1));
        const h = Math.max(1, Number(box.h || 1));
        return {
          ...r,
          _text: text,
          _x: x,
          _y: y,
          _w: w,
          _h: h,
          _yc: y + (h / 2),
        };
      })
      .filter((r) => r._text);

    const colorRecords = doneWithText.filter((r) => String(r.roi_mechanism || "").includes("color_pipeline"));
    const boxRecords = doneWithText.filter((r) => Array.isArray(r.trigger_flags) && r.trigger_flags.includes("paddle_original_box_eval"));

    const buildSingleLineSummary = (records) => {
      if (!records.length) return "";
      const heights = records.map((r) => r._h).sort((a, b) => a - b);
      const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
      const rowTolerance = Math.max(8, Math.round(medianH * 0.45));

      const sortedByY = records.slice().sort((a, b) => {
        if (a._yc !== b._yc) return a._yc - b._yc;
        return a._x - b._x;
      });
      const rows = [];
      for (const item of sortedByY) {
        const last = rows[rows.length - 1];
        if (!last || Math.abs(item._yc - last.anchorY) > rowTolerance) {
          rows.push({ anchorY: item._yc, items: [item] });
          continue;
        }
        const n = last.items.length;
        last.anchorY = ((last.anchorY * n) + item._yc) / (n + 1);
        last.items.push(item);
      }

      return rows
        .map((row) => row.items.slice().sort((a, b) => a._x - b._x))
        .flat()
        .map((r) => r._text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const buildBoxMultilineSummary = (records) => {
      if (!records.length) return "";
      return records
        .slice()
        .sort((a, b) => {
          if (a._y !== b._y) return a._y - b._y;
          return a._x - b._x;
        })
        .map((r) => r._text)
        .filter(Boolean)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const line = [
      buildSingleLineSummary(colorRecords),
      buildBoxMultilineSummary(boxRecords),
    ].filter(Boolean).join("\n").trim();

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
      window.parent.postMessage({ type: "ocr_result_local", payload }, parentBridgeOrigin, [cropBuffer]);
    } else {
      window.parent.postMessage({ type: "ocr_result_local", payload }, parentBridgeOrigin);
    }

    state.sentParentSummary[parentMessageId] = {
      textLine,
      cropSent: prev.cropSent || Boolean(cropBuffer),
      ts: Date.now(),
    };
  }

  function updateOcrRowUi(result) {
    const ui = ocrRuntime.uiByRoiId[result.roi_id];
    if (!ui) return;
    const line = ui.line;
    const detail = ui.detail;
    const idx = Number(result.roi_index || 0);
    const idxTag = result.roi_label || (idx > 0 ? `#${idx}` : result.roi_id);
    const confPct = typeof result.ocr_confidence === "number" ? `${(result.ocr_confidence * 100).toFixed(1)}%` : "--";
    const kindLabel = result.roi_kind === OCR_KIND.MEASURE ? "medida" : "legenda";
    line.innerHTML = `<strong>${idxTag}</strong> • ${kindLabel} • conf final: ${confPct}`;

    if (result.ocr_status === "pending") {
      detail.textContent = "Pendente...";
      return;
    }

    if (result.ocr_status === "error") {
      detail.textContent = `[erro OCR] ${result.error || "erro desconhecido"}`;
      return;
    }

    renderizarComparativoOCR(result, detail);
  }

  function formatarTextoOcrParaExibicao(texto, preserveLineBreaks = false) {
    const raw = String(texto || "");
    if (!preserveLineBreaks) return normalizarTextoOCR(raw);
    return raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line, idx, arr) => line || (idx > 0 && idx < arr.length - 1))
      .join("\n")
      .trim();
  }

  function escapeHtmlWithLineBreaks(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function applyOcrResult(workerResult) {
    if (!workerResult?.roi_id) return;
    const current = getRoiStoreRecord(workerResult.roi_id) || {};
    const confidence = typeof workerResult.confidence === "number" ? workerResult.confidence : 0;
    const statusFromWorker = workerResult.status || "error";
    const preserveLineBreaks = Array.isArray(current.trigger_flags) && current.trigger_flags.includes("paddle_original_box_eval");

    const merged = {
      ...current,
      roi_id: workerResult.roi_id,
      roi_index: current.roi_index || 0,
      parent_message_id: workerResult.parent_message_id || current.parent_message_id || null,
      roi_kind: workerResult.roi_kind || current.roi_kind || OCR_KIND.LEGEND,
      ocr_status: statusFromWorker,
      ocr_text_raw: statusFromWorker === "done"
        ? formatarTextoOcrParaExibicao(workerResult.text || "", preserveLineBreaks)
        : "",
      ocr_confidence: confidence,
      model_used: workerResult.model_used || "stub",
      latency_ms: workerResult.latency_ms || 0,
      debug: workerResult.debug || null,
      ocr_attempts: Array.isArray(workerResult.attempts)
        ? workerResult.attempts.map((attempt) => ({
            ...attempt,
            text: formatarTextoOcrParaExibicao(attempt?.text || "", preserveLineBreaks),
          }))
        : [],
      ocr_selected_attempt_id: workerResult.selected_attempt_id || "",
      ocr_technical_notes: Array.isArray(workerResult.technical_notes) ? workerResult.technical_notes : [],
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

  function detectManufacturerFromText(text) {
    const key = normalizeKey(text);
    if (!key) return "";
    const vendors = [
      { canonical: "Samsung", aliases: ["samsung", "medison"] },
      { canonical: "Philips", aliases: ["philips"] },
      { canonical: "Vinno", aliases: ["vinno"] },
      { canonical: "GE", aliases: ["ge", "generalelectric"] },
      { canonical: "Toshiba", aliases: ["toshiba"] },
      { canonical: "Canon", aliases: ["canon"] },
      { canonical: "Esaote", aliases: ["esaote"] },
    ];
    for (const vendor of vendors) {
      if (vendor.aliases.some((alias) => key.includes(alias))) {
        return vendor.canonical;
      }
    }
    return "";
  }

  function getMetadataDevice(metadata) {
    const m = metadata && typeof metadata === "object" ? metadata : {};
    const manufacturerRaw =
      m.Manufacturer ||
      m.manufacturer ||
      m.manufacturer_name ||
      "";
    const modelRaw =
      m.ManufacturerModelName ||
      m.manufacturer_model_name ||
      m.model_name ||
      m.ModelName ||
      "";
    const manufacturer = detectManufacturerFromText(`${manufacturerRaw} ${modelRaw}`) || String(manufacturerRaw || "").trim();
    const model = String(modelRaw || "").trim();
    return { manufacturer, model, manufacturerRaw, modelRaw };
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
    const profileManufacturerKey = (p) => normalizeKey(detectManufacturerFromText(p?.manufacturer || "") || p?.manufacturer || "");
    const profileModelKey = (p) => normalizeKey(p?.model || "");

    const byManufacturer = profiles.filter((p) => {
      const pm = profileManufacturerKey(p);
      if (!pm || !mKey) return false;
      return pm === mKey;
    });

    const matched = byManufacturer.find((p) => {
      const pmodel = profileModelKey(p);
      if (!pmodel || !modelKey) return false;
      return modelKey.includes(pmodel) || pmodel.includes(modelKey);
    });

    const manufacturerFallback = matched ? null : (byManufacturer[0] || null);

    const fallback = cfg.fallback || DEFAULT_PREPROCESS_CONFIG.fallback;
    const selected = matched || manufacturerFallback || fallback;
    const fallbackTuning = mergeTuning(DEFAULT_TUNING, fallback.tuning || {});
    const selectedTuning = mergeTuning(fallbackTuning, selected.tuning || {});
    return {
      manufacturer: selected.manufacturer || fallback.manufacturer || "Samsung",
      model: selected.model || fallback.model || "HS40",
      crop: sanitizeCrop(selected.crop || fallback.crop),
      tuning: selectedTuning,
      isFallback: !matched && !manufacturerFallback,
      matchType: matched ? "manufacturer_model" : (manufacturerFallback ? "manufacturer_only" : "default"),
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

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeMetadataJson(metadata) {
    try {
      return JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}, null, 2);
    } catch (_) {
      return "{}";
    }
  }

  function normalizarTextoOCR(texto) {
    return String(texto || "").replace(/\s+/g, " ").trim();
  }

  function normalizeToken(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function extrairTokensIndividuais(texto) {
    const semHtml = String(texto || "").replace(/<[^>]+>/g, " ");
    const tokens = semHtml.match(/[A-Za-zÀ-ÿ0-9]+(?:[./-][A-Za-zÀ-ÿ0-9]+)*/g) || [];
    return tokens
      .map((token) => normalizeToken(token))
      .filter((token) => token.length >= 2);
  }

  function htmlParaTexto(html) {
    if (!html) return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), "text/html");
    return normalizarTextoOCR(doc.body?.textContent || "");
  }

  function extrairAbreviacoes(texto) {
    const matches = String(texto || "").match(/\b[A-Z]{2,6}\./g) || [];
    return matches.map((abbr) => abbr.trim().toUpperCase());
  }

  function extrairRotulosNumerados(texto) {
    const labels = [];
    const regex = /(?:^|\n)\s*\d+\.\s*([^:\n]+):/g;
    const clean = String(texto || "");
    let m = regex.exec(clean);
    while (m) {
      labels.push(normalizarTextoOCR(m[1]));
      m = regex.exec(clean);
    }
    return labels.filter(Boolean);
  }

  function coletarCamposModeloJson(jsonObj) {
    const fields = {
      nomes: [],
      frases: [],
      modificadoras: [],
      abreviacoes: [],
    };
    const entries = Object.entries(jsonObj && typeof jsonObj === "object" ? jsonObj : {});
    for (const [key, rawValue] of entries) {
      const normalizedKey = normalizeToken(key);
      const isNome = normalizedKey.includes("nomefrase");
      const isFrase = normalizedKey.includes("frasesdomodelo") || normalizedKey === "frases";
      const isModificadora = normalizedKey.includes("modificador") || normalizedKey.includes("plavrasmodificadoras");
      if (!isNome && !isFrase && !isModificadora) continue;

      const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const item of arr) {
        if (typeof item !== "string") continue;
        const sourceText = isFrase ? htmlParaTexto(item) : normalizarTextoOCR(item);
        const labels = isFrase ? extrairRotulosNumerados(sourceText) : [];
        fields.abreviacoes.push(...extrairAbreviacoes(sourceText));
        if (isNome) fields.nomes.push(sourceText);
        if (isFrase) {
          fields.frases.push(sourceText);
          fields.nomes.push(...labels);
        }
        if (isModificadora) fields.modificadoras.push(sourceText);
      }
    }
    return fields;
  }

  async function montarVocabularioDosJson() {
    const phraseSet = new Set();
    const tokenSet = new Set();
    const abbrevSet = new Set(BASE_ABBREVIATIONS);
    const sourceFiles = [];
    const warnings = [];
    let loadedFiles = 0;

    const addPhrase = (value) => {
      const clean = normalizarTextoOCR(value);
      if (!clean) return;
      phraseSet.add(clean);
      extrairTokensIndividuais(clean).forEach((t) => tokenSet.add(t));
      extrairAbreviacoes(clean).forEach((abbr) => abbrevSet.add(abbr));
    };

    try {
      const response = await fetch(MODEL_INDEX_PATH, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const modelNames = await response.json();
      const names = Array.isArray(modelNames) ? modelNames : [];

      for (const modelName of names) {
        const safeName = String(modelName || "").trim();
        if (!safeName) continue;
        const modelPath = `${MODEL_JSON_DIRECTORY}/${safeName}.json`;
        sourceFiles.push(modelPath);
        try {
          const jsonResp = await fetch(modelPath, { cache: "no-store" });
          if (!jsonResp.ok) {
            warnings.push(`${modelPath}: HTTP ${jsonResp.status}`);
            continue;
          }
          const payload = await jsonResp.json();
          const fields = coletarCamposModeloJson(payload);
          fields.nomes.forEach(addPhrase);
          fields.modificadoras.forEach(addPhrase);
          fields.frases.forEach(addPhrase);
          fields.abreviacoes.forEach((abbr) => abbrevSet.add(abbr));
          loadedFiles += 1;
        } catch (err) {
          warnings.push(`${modelPath}: ${err?.message || err}`);
        }
      }
    } catch (err) {
      warnings.push(`Falha ao carregar index de modelos (${MODEL_INDEX_PATH}): ${err?.message || err}`);
    }

    const normalizedAbbreviations = Array.from(abbrevSet)
      .map((abbr) => normalizarTextoOCR(abbr).toUpperCase())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    const vocabulary = {
      phrases: Array.from(phraseSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
      tokens: Array.from(tokenSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
      abbreviations: normalizedAbbreviations,
      source_files: sourceFiles,
      warnings,
      loaded_files: loadedFiles,
      prepared_at: Date.now(),
    };

    window.__OCR_DEV_LEGEND_VOCAB__ = vocabulary;
    return vocabulary;
  }

  function montarTentativasOCRLegenda(vocabulario) {
    // Fluxo fixo: manter apenas o melhor resultado validado (saturacao+invert).
    void vocabulario;
    return [
      { id: "E-INV", label: "Teste E saturacao+invert", psm: "6", whitelist: LEGEND_WHITELIST, preprocess: "saturation_invert", mode: "whitelist_preproc" },
    ];
  }

  function montarTentativasOCRMedida() {
    // Mesmo preprocessamento vencedor da legenda aplicado em medida.
    return [
      {
        id: "M-INV",
        label: "Medida saturacao+invert",
        psm: "6",
        whitelist: MEASURE_WHITELIST,
        preprocess: "saturation_invert",
        mode: "measure_whitelist_preproc",
      },
    ];
  }

  function isOriginalBoxPaddleCandidate(roi) {
    const mechanism = String(roi?.mechanism || "").trim();
    if (!mechanism) return false;
    return mechanism === "box_vtrim" || mechanism === "box_yellow_vtrim";
  }

  function isBoxPaddleBackedMechanism(mechanism) {
    const mech = String(mechanism || "").trim();
    return mech === "box_vtrim"
      || mech === "box_yellow_vtrim"
      || mech === "box_vtrim_line_split"
      || mech === "box_yellow_vtrim_line_split";
  }

  function classificarTipoRoi(roi) {
    if (roi?.mechanism === "box") return OCR_KIND.MEASURE;
    return OCR_KIND.LEGEND;
  }

  function getSaturationThresholdFromTuning(tuning) {
    const c = tuning?.color || {};
    const values = [c.satGreenMin, c.satYellowMin, c.satOrangeMin]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    const minSatNorm = values.length ? Math.min(...values) : 0.22;
    return Math.max(20, Math.min(180, Math.round(minSatNorm * 255)));
  }

  function buildTextMaskForRoi(roiCanvas, options = {}) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const mask = new Uint8Array(w * h);
    const satThreshold = Math.max(0, Math.min(255, Number(options.saturationThreshold || 56)));
    const satNormThreshold = satThreshold / 255;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = ((y * w) + x) * 4;
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const maxc = Math.max(r, g, b) / 255;
        const minc = Math.min(r, g, b) / 255;
        const delta = maxc - minc;
        const sat = maxc === 0 ? 0 : (delta / maxc);
        const idx = (y * w) + x;
        mask[idx] = sat >= satNormThreshold ? 1 : 0;
      }
    }

    return { mask, width: w, height: h };
  }

  function isLimeGreenLikePixel(r, g, b, a, tuning) {
    const colorCfg = tuning?.color || DEFAULT_TUNING.color;
    if (a < 10) return false;
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const maxc = Math.max(rn, gn, bn);
    const minc = Math.min(rn, gn, bn);
    const delta = maxc - minc;
    let hDeg = 0;
    if (delta > 0) {
      if (maxc === rn) hDeg = ((gn - bn) / delta) % 6;
      else if (maxc === gn) hDeg = ((bn - rn) / delta) + 2;
      else hDeg = ((rn - gn) / delta) + 4;
      hDeg *= 60;
      if (hDeg < 0) hDeg += 360;
    }
    const sat = maxc === 0 ? 0 : (delta / maxc);
    const val = maxc;
    const hueOk = hDeg >= 65 && hDeg <= 165;
    const satOk = sat >= Math.max(0.18, colorCfg.satGreenMin * 0.7);
    const valOk = val >= Math.max(0.22, colorCfg.valueMin * 0.8);
    const greenDominant = (g >= (r * 1.05)) && (g >= (b * 1.05));
    return hueOk && satOk && valOk && greenDominant;
  }

  function paintPixelWithNeighborGray(data, width, height, x, y, tuning, maxNeighbors = 10) {
    const offsets = [
      [0, -1], [1, 0], [0, 1], [-1, 0],
      [1, -1], [1, 1], [-1, 1], [-1, -1],
      [0, -2], [2, 0], [0, 2], [-2, 0],
      [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2],
    ];

    let sumLum = 0;
    let count = 0;
    for (const [dx, dy] of offsets) {
      if (count >= maxNeighbors) break;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const p = ((ny * width) + nx) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];
      if (isLimeGreenLikePixel(r, g, b, a, tuning)) continue;
      sumLum += ((r + g + b) / 3);
      count += 1;
    }

    const p0 = ((y * width) + x) * 4;
    const gray = count > 0 ? Math.round(sumLum / count) : 0;
    data[p0] = gray;
    data[p0 + 1] = gray;
    data[p0 + 2] = gray;
    data[p0 + 3] = 255;
  }

  function buildSaturationMasksForRoi(roiCanvas, options = {}) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const highMask = new Uint8Array(w * h);
    const lowMask = new Uint8Array(w * h);
    const satThreshold = Math.max(0, Math.min(255, Number(options.saturationThreshold || 56)));
    const lowOffset = Math.max(0, Number(options.lowSatThresholdOffset ?? LINE_SPLIT_OPTIONS.lowSatThresholdOffset));
    const satNormThreshold = satThreshold / 255;
    const lowSatNormThreshold = Math.max(0, (satThreshold - lowOffset) / 255);

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = ((y * w) + x) * 4;
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const maxc = Math.max(r, g, b) / 255;
        const minc = Math.min(r, g, b) / 255;
        const delta = maxc - minc;
        const sat = maxc === 0 ? 0 : (delta / maxc);
        const idx = (y * w) + x;
        highMask[idx] = sat >= satNormThreshold ? 1 : 0;
        lowMask[idx] = sat <= lowSatNormThreshold ? 1 : 0;
      }
    }
    return { highMask, lowMask, width: w, height: h };
  }

  function buildYellowProjectionForRoi(roiCanvas, tuning) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const projection = new Array(h).fill(0);
    const colorCfg = tuning?.color || DEFAULT_TUNING.color;
    const satMin = Math.max(0.12, Number(colorCfg.satYellowMin || 0.28) * 0.8);
    const valMin = Math.max(0.14, Number(colorCfg.valueMin || 0.2) * 0.85);

    for (let y = 0; y < h; y += 1) {
      let count = 0;
      for (let x = 0; x < w; x += 1) {
        const p = ((y * w) + x) * 4;
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const a = d[p + 3];
        if (a < 10) continue;
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const maxc = Math.max(rn, gn, bn);
        const minc = Math.min(rn, gn, bn);
        const delta = maxc - minc;
        let hDeg = 0;
        if (delta > 0) {
          if (maxc === rn) hDeg = ((gn - bn) / delta) % 6;
          else if (maxc === gn) hDeg = ((bn - rn) / delta) + 2;
          else hDeg = ((rn - gn) / delta) + 4;
          hDeg *= 60;
          if (hDeg < 0) hDeg += 360;
        }
        const sat = maxc === 0 ? 0 : (delta / maxc);
        const val = maxc;
        const isYellow = hDeg >= (colorCfg.hueYellowMin || 30) && hDeg <= (colorCfg.hueYellowMax || 80);
        if (isYellow && sat >= satMin && val >= valMin) count += 1;
      }
      projection[y] = count;
    }
    return projection;
  }

  function computeHorizontalProjection(mask, width, height) {
    const projection = new Array(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        sum += mask[row + x];
      }
      projection[y] = sum;
    }
    return projection;
  }

  function detectTextLineBands(projection, options = {}) {
    const minPixels = Math.max(2, Number(options.minActiveRowPixels || 2));
    const minHeight = Math.max(2, Number(options.minBandHeightPx || 3));
    const mergeGap = Math.max(0, Number(options.mergeBandGapPx || 2));
    const raw = [];
    let start = -1;

    for (let y = 0; y < projection.length; y += 1) {
      const active = projection[y] >= minPixels;
      if (active && start < 0) start = y;
      if (!active && start >= 0) {
        raw.push({ y0: start, y1: y - 1 });
        start = -1;
      }
    }
    if (start >= 0) raw.push({ y0: start, y1: projection.length - 1 });

    const merged = [];
    for (const band of raw) {
      const last = merged[merged.length - 1];
      if (last && (band.y0 - last.y1 - 1) <= mergeGap) {
        last.y1 = band.y1;
      } else {
        merged.push({ ...band });
      }
    }

    return merged.filter((b) => (b.y1 - b.y0 + 1) >= minHeight);
  }

  function computeMedian(values) {
    const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : ((arr[mid - 1] + arr[mid]) / 2);
  }

  function detectLowSaturationBands(lowProjection, width, options = {}) {
    const minGapHeightPx = Math.max(1, Number(options.minGapHeightPx ?? LINE_SPLIT_OPTIONS.minGapHeightPx));
    const minGapLowSatRatio = Math.max(0.1, Number(options.minGapLowSatRatio ?? LINE_SPLIT_OPTIONS.minGapLowSatRatio));
    const minLowSatPixels = Math.max(1, Math.round(width * minGapLowSatRatio));
    const bands = [];
    let start = -1;

    for (let y = 0; y < lowProjection.length; y += 1) {
      const isLowSatRow = lowProjection[y] >= minLowSatPixels;
      if (isLowSatRow && start < 0) start = y;
      if (!isLowSatRow && start >= 0) {
        const y0 = start;
        const y1 = y - 1;
        if ((y1 - y0 + 1) >= minGapHeightPx) bands.push({ y0, y1 });
        start = -1;
      }
    }
    if (start >= 0) {
      const y0 = start;
      const y1 = lowProjection.length - 1;
      if ((y1 - y0 + 1) >= minGapHeightPx) bands.push({ y0, y1 });
    }

    // Bandas na borda superior/inferior tendem a ser fundo/area vazia, nao gap entre linhas.
    return bands.filter((b) => b.y0 > 0 && b.y1 < (lowProjection.length - 1));
  }

  function computeCommonDistance(distances) {
    const positive = distances
      .map((d) => Math.round(d))
      .filter((d) => Number.isFinite(d) && d > 0);
    if (!positive.length) return 0;
    const freq = new Map();
    positive.forEach((d) => freq.set(d, (freq.get(d) || 0) + 1));
    let bestDist = 0;
    let bestCount = -1;
    for (const [dist, count] of freq.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestDist = dist;
      }
    }
    if (bestDist > 0) return bestDist;
    return Math.round(computeMedian(positive));
  }

  function estimateDominantStep(distances, fallback = 41) {
    const values = distances
      .map((d) => Math.round(d))
      .filter((d) => Number.isFinite(d) && d >= 6 && d <= 120);
    if (!values.length) return Math.max(8, Math.round(fallback || 41));
    const buckets = new Map();
    for (const d of values) {
      const key = Math.round(d / 2) * 2;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let bestKey = 0;
    let bestCount = -1;
    for (const [k, count] of buckets.entries()) {
      if (count > bestCount || (count === bestCount && Math.abs(k - fallback) < Math.abs(bestKey - fallback))) {
        bestKey = k;
        bestCount = count;
      }
    }
    if (!bestKey) return Math.max(8, Math.round(fallback || 41));
    const windowed = values.filter((d) => Math.abs(d - bestKey) <= 2);
    const median = computeMedian(windowed.length ? windowed : values);
    return Math.max(8, Math.round(median || bestKey));
  }

  function estimateGridAnchor(centers, step) {
    if (!Array.isArray(centers) || !centers.length || !step) return 0;
    const modFreq = new Map();
    for (const c of centers) {
      const m = ((Math.round(c) % step) + step) % step;
      modFreq.set(m, (modFreq.get(m) || 0) + 1);
    }
    let bestMod = 0;
    let bestCount = -1;
    for (const [m, count] of modFreq.entries()) {
      if (count > bestCount) {
        bestMod = m;
        bestCount = count;
      }
    }
    return bestMod;
  }

  function findFirstLastActiveRows(projection, minPixels) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < projection.length; y += 1) {
      if (projection[y] >= minPixels) {
        first = y;
        break;
      }
    }
    for (let y = projection.length - 1; y >= 0; y -= 1) {
      if (projection[y] >= minPixels) {
        last = y;
        break;
      }
    }
    return { first, last };
  }

  function rowYellowRatio(yellowProjection, y, width) {
    if (y < 0 || y >= yellowProjection.length) return 1;
    return yellowProjection[y] / Math.max(1, width);
  }

  function rgbToHsv255(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const maxc = Math.max(rn, gn, bn);
    const minc = Math.min(rn, gn, bn);
    const delta = maxc - minc;
    let h = 0;
    if (delta > 0) {
      if (maxc === rn) h = ((gn - bn) / delta) % 6;
      else if (maxc === gn) h = ((bn - rn) / delta) + 2;
      else h = ((rn - gn) / delta) + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = maxc === 0 ? 0 : (delta / maxc);
    const v = maxc;
    return { h, s: s * 255, v: v * 255 };
  }

  function movingAverage1D(values, radius = 1) {
    const r = Math.max(0, Math.round(radius));
    if (!r) return values.slice();
    const out = new Array(values.length).fill(0);
    for (let i = 0; i < values.length; i += 1) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k += 1) {
        const j = i + k;
        if (j < 0 || j >= values.length) continue;
        sum += values[j];
        n += 1;
      }
      out[i] = n ? (sum / n) : values[i];
    }
    return out;
  }

  function buildNonYellowColorMasks(roiCanvas, options = {}) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const satMin = Math.max(10, Number(options.nonYellowSatMin ?? LINE_SPLIT_OPTIONS.nonYellowSatMin));
    const valMin = Math.max(10, Number(options.nonYellowValMin ?? LINE_SPLIT_OPTIONS.nonYellowValMin));
    const red = new Uint8Array(w * h);
    const green = new Uint8Array(w * h);
    const blue = new Uint8Array(w * h);
    let redCount = 0;
    let greenCount = 0;
    let blueCount = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = ((y * w) + x) * 4;
        const a = d[p + 3];
        if (a < 10) continue;
        const { h: hue, s, v } = rgbToHsv255(d[p], d[p + 1], d[p + 2]);
        if (s < satMin || v < valMin) continue;
        const idx = (y * w) + x;
        if (hue <= 15 || hue >= 340) {
          red[idx] = 1;
          redCount += 1;
        } else if (hue >= 70 && hue <= 170) {
          green[idx] = 1;
          greenCount += 1;
        } else if (hue >= 180 && hue <= 260) {
          blue[idx] = 1;
          blueCount += 1;
        }
      }
    }
    return { red, green, blue, redCount, greenCount, blueCount, width: w, height: h };
  }

  function buildYellowTextMask(roiCanvas, options = {}) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const mask = new Uint8Array(w * h);
    const hueMin = Math.max(0, Number(options.yellowHueMin ?? LINE_SPLIT_OPTIONS.yellowHueMin));
    const hueMax = Math.min(360, Number(options.yellowHueMax ?? LINE_SPLIT_OPTIONS.yellowHueMax));
    const satMin = Math.max(0, Number(options.yellowSatMin ?? LINE_SPLIT_OPTIONS.yellowSatMin));
    const valMin = Math.max(0, Number(options.yellowValMin ?? LINE_SPLIT_OPTIONS.yellowValMin));
    let count = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = ((y * w) + x) * 4;
        const a = d[p + 3];
        if (a < 10) continue;
        const { h: hue, s, v } = rgbToHsv255(d[p], d[p + 1], d[p + 2]);
        if (hue < hueMin || hue > hueMax) continue;
        if (s < satMin || v < valMin) continue;
        const idx = (y * w) + x;
        mask[idx] = 1;
        count += 1;
      }
    }
    return { mask, count, width: w, height: h };
  }

  function cleanYellowMask(mask, width, height) {
    const out = mask.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = (y * width) + x;
        if (!mask[idx]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            n += mask[((y + dy) * width) + (x + dx)];
          }
        }
        if (n <= 1) out[idx] = 0;
      }
    }
    const closed = out.slice();
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const i = row + x;
        if (out[i]) continue;
        if (out[i - 1] && out[i + 1]) closed[i] = 1;
      }
    }
    return closed;
  }

  function chooseBestHalfForLineDetection(roiCanvas, options = {}) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    const half = Math.max(1, Math.floor(w / 2));
    const noisePenalty = Math.max(0.2, Number(options.halfNoisePenalty ?? LINE_SPLIT_OPTIONS.halfNoisePenalty));

    // Escolhe a metade com maior sinal amarelo e menor interferencia de outras cores.
    const evaluateHalf = (x0, x1) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, x1 - x0);
      c.height = h;
      c.getContext("2d").drawImage(roiCanvas, x0, 0, c.width, h, 0, 0, c.width, h);
      const yellow = buildYellowTextMask(c, options);
      const nonYellow = buildNonYellowColorMasks(c, options);
      const noise = nonYellow.redCount + nonYellow.greenCount + nonYellow.blueCount;
      const score = yellow.count - (noisePenalty * noise);
      return {
        x0,
        x1: x1 - 1,
        width: c.width,
        canvas: c,
        yellowMask: yellow.mask,
        yellowCount: yellow.count,
        noiseCount: noise,
        score,
      };
    };

    const left = evaluateHalf(0, half);
    const right = evaluateHalf(half, w);
    return right.score > left.score ? { ...right, side: "right" } : { ...left, side: "left" };
  }

  function estimateLineSpacing(projection, fallback = 40) {
    const maxV = Math.max(...projection, 0);
    if (maxV <= 0) return fallback;
    const thr = Math.max(1, Math.round(maxV * 0.35));
    const centers = [];
    let start = -1;
    for (let y = 0; y < projection.length; y += 1) {
      const active = projection[y] >= thr;
      if (active && start < 0) start = y;
      if (!active && start >= 0) {
        centers.push(Math.round((start + y - 1) / 2));
        start = -1;
      }
    }
    if (start >= 0) centers.push(Math.round((start + projection.length - 1) / 2));
    if (centers.length < 2) return fallback;
    const gaps = [];
    for (let i = 1; i < centers.length; i += 1) gaps.push(centers[i] - centers[i - 1]);
    return estimateDominantStep(gaps, fallback);
  }

  function detectTextBands(projection, options = {}) {
    const spacing = Math.max(8, Math.round(Number(options.lineSpacing || 40)));
    const minBandHeight = Math.max(3, Math.round(spacing * 0.25));
    const maxBandHeight = Math.max(minBandHeight + 2, Math.round(spacing * 0.8));
    const minMergeGap = Math.max(1, Math.round(spacing * 0.15));
    const maxV = Math.max(...projection, 0);
    // Threshold proporcional ao pico da projecao para manter robustez entre exames.
    const thr = Math.max(1, Math.round(maxV * 0.24));
    const raw = [];
    let start = -1;
    for (let y = 0; y < projection.length; y += 1) {
      const active = projection[y] >= thr;
      if (active && start < 0) start = y;
      if (!active && start >= 0) {
        raw.push({ y0: start, y1: y - 1 });
        start = -1;
      }
    }
    if (start >= 0) raw.push({ y0: start, y1: projection.length - 1 });

    const filtered = raw.filter((b) => {
      const h = b.y1 - b.y0 + 1;
      return h >= minBandHeight && h <= Math.max(maxBandHeight, spacing);
    });
    if (!filtered.length) return [];

    const merged = [];
    for (const b of filtered) {
      const last = merged[merged.length - 1];
      if (last && (b.y0 - last.y1) <= minMergeGap) last.y1 = b.y1;
      else merged.push({ ...b });
    }
    return merged;
  }

  function computeLineCutValleys(bands, projection, options = {}) {
    const spacing = Math.max(8, Math.round(Number(options.lineSpacing || 40)));
    const minValleyHeight = Math.max(2, Math.round(spacing * 0.15));
    const valleys = [];
    for (let i = 0; i < bands.length - 1; i += 1) {
      const a = bands[i];
      const b = bands[i + 1];
      const from = Math.max(a.y1 + 1, 0);
      const to = Math.min(b.y0 - 1, projection.length - 1);
      const valleyH = to - from + 1;
      if (to <= from || valleyH < minValleyHeight) continue;
      let bestY = from;
      let bestV = projection[from];
      for (let y = from + 1; y <= to; y += 1) {
        if (projection[y] < bestV) {
          bestV = projection[y];
          bestY = y;
        }
      }
      valleys.push({ y: bestY, y0: from, y1: to });
    }
    return valleys;
  }

  function maskToCanvas(mask, width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < mask.length; i += 1) {
      const v = mask[i] ? 255 : 0;
      const p = i * 4;
      img.data[p] = v;
      img.data[p + 1] = v;
      img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function buildProjectionDebugCanvas(projection, bands = [], valleys = []) {
    const w = Math.max(220, projection.length);
    const h = 120;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    const maxV = Math.max(...projection, 1);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const idx = Math.min(projection.length - 1, Math.round((x / Math.max(1, w - 1)) * (projection.length - 1)));
      const v = projection[idx];
      const y = h - 1 - Math.round((v / maxV) * (h - 1));
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#22c55e";
    bands.forEach((b) => {
      const x0 = Math.round((b.y0 / Math.max(1, projection.length - 1)) * (w - 1));
      const x1 = Math.round((b.y1 / Math.max(1, projection.length - 1)) * (w - 1));
      ctx.strokeRect(x0, 4, Math.max(1, x1 - x0 + 1), h - 8);
    });
    ctx.strokeStyle = "#ef4444";
    valleys.forEach((v) => {
      const x = Math.round((v.y / Math.max(1, projection.length - 1)) * (w - 1));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });
    return c;
  }

  function alignCutCentersByCommonDistance(centers, tolerance = 0.2) {
    if (!Array.isArray(centers) || centers.length < 3) return centers || [];
    const sorted = centers.slice().sort((a, b) => a - b);
    const distances = [];
    for (let i = 1; i < sorted.length; i += 1) {
      distances.push(sorted[i] - sorted[i - 1]);
    }
    const common = computeCommonDistance(distances);
    if (!common || common < 2) return sorted;

    const adjusted = [sorted[0]];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = adjusted[i - 1];
      const current = sorted[i];
      const currentDist = current - prev;
      const relErr = Math.abs(currentDist - common) / common;
      if (relErr <= tolerance) {
        adjusted.push(Math.round(prev + common));
      } else {
        adjusted.push(current);
      }
    }
    return adjusted;
  }

  function splitRoiIntoLines(roi, sourceCanvas, options = {}) {
    const roiCanvas = extractRoiCanvas(sourceCanvas, roi);
    // 1) Detecta geometria na metade mais limpa. 2) Aplica cortes na largura completa do ROI.
    const chosenHalf = chooseBestHalfForLineDetection(roiCanvas, options);
    const cleanedMask = cleanYellowMask(chosenHalf.yellowMask, chosenHalf.width, chosenHalf.canvas.height);
    const projectionRaw = computeHorizontalProjection(cleanedMask, chosenHalf.width, chosenHalf.canvas.height);
    const projection = movingAverage1D(
      projectionRaw,
      Number(options.projectionSmoothRadius ?? LINE_SPLIT_OPTIONS.projectionSmoothRadius),
    );
    const fallbackSpacing = Math.max(
      24,
      Math.round(Number(options.boxLineHeightPx ?? options.lineHeightTargetPx ?? LINE_SPLIT_OPTIONS.lineHeightTargetPx) || 40),
    );
    const lineSpacing = estimateLineSpacing(projection, fallbackSpacing);
    const bands = detectTextBands(projection, { lineSpacing });
    const valleys = computeLineCutValleys(bands, projection, { lineSpacing });
    const minBandsForSplit = Math.max(2, Number(options.minBandsForSplit ?? LINE_SPLIT_OPTIONS.minBandsForSplit));
    const cutRows = valleys.map((v) => v.y).sort((a, b) => a - b);
    const marginY = Math.max(0, Number(options.cropMarginY ?? LINE_SPLIT_OPTIONS.cropMarginY));
    const minCutDistance = Math.max(2, Number(options.minCutDistancePx ?? LINE_SPLIT_OPTIONS.minCutDistancePx));

    const makeSingle = () => [{
      ...roi,
      parent_roi_index: roi.source_index || 1,
      line_index: 1,
      is_line_split: false,
      debug_label: `${roi.source_index || 1}`,
    }];

    if (bands.length < minBandsForSplit || !cutRows.length) return makeSingle();

    const dedupCuts = [];
    for (const y of cutRows) {
      const near = dedupCuts.some((v) => Math.abs(v - y) < minCutDistance);
      if (!near) dedupCuts.push(y);
    }
    if (!dedupCuts.length) return makeSingle();

    const segments = [];
    let y0 = 0;
    for (const cut of dedupCuts) {
      const y1 = Math.max(y0, Math.min(roi.h - 1, cut));
      segments.push({ y0, y1 });
      y0 = Math.min(roi.h - 1, cut + 1);
    }
    if (y0 <= roi.h - 1) segments.push({ y0, y1: roi.h - 1 });

    const minLineH = Math.max(6, Math.round(lineSpacing * 0.25));
    const validSegments = segments.filter((s) => (s.y1 - s.y0 + 1) >= minLineH);
    if (validSegments.length < 2) return makeSingle();

    const debugInfo = ENABLE_LINE_SPLIT_DEBUG
      ? {
          roi_label: `${roi.source_index || 1}`,
          chosen_side: chosenHalf.side,
          chosen_half: { x0: chosenHalf.x0, x1: chosenHalf.x1 },
          line_spacing: lineSpacing,
          bands: bands.map((b) => ({ y0: b.y0, y1: b.y1 })),
          valleys: valleys.map((v) => ({ y: v.y, y0: v.y0, y1: v.y1 })),
          mask_data_url: maskToCanvas(cleanedMask, chosenHalf.width, chosenHalf.canvas.height).toDataURL("image/png"),
          chosen_half_data_url: chosenHalf.canvas.toDataURL("image/png"),
          projection_data_url: buildProjectionDebugCanvas(projection, bands, valleys).toDataURL("image/png"),
        }
      : null;

    return validSegments.map((seg, idx) => {
      const cy0 = Math.max(0, seg.y0 - marginY);
      const cy1 = Math.min(roi.h - 1, seg.y1 + marginY);
      return {
        ...roi,
        y: roi.y + cy0,
        h: Math.max(1, cy1 - cy0 + 1),
        parent_roi_index: roi.source_index || 1,
        line_index: idx + 1,
        is_line_split: true,
        roi_band_y0: cy0,
        roi_band_y1: cy1,
        debug_label: `${roi.source_index || 1}.${idx + 1}`,
        mechanism: `${roi.mechanism || "roi"}_line_split`,
        line_split_debug: debugInfo,
      };
    });
  }

  function apagarPixelsVerdesDeMargemDoBox(roiCanvas, tuning, edgeBandPx = 8) {
    const w = roiCanvas.width;
    const h = roiCanvas.height;
    if (w < 2 || h < 2) return;
    const band = Math.max(1, Math.min(edgeBandPx, Math.floor(Math.min(w, h) / 4)));
    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const onEdgeBand = y < band || y >= (h - band) || x < band || x >= (w - band);
        if (!onEdgeBand) continue;
        const p = ((y * w) + x) * 4;
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const a = d[p + 3];
        if (!isLimeGreenLikePixel(r, g, b, a, tuning)) continue;
        paintPixelWithNeighborGray(d, w, h, x, y, tuning, 10);
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  function apagarLinhaVerdeDetectadaDoBoxNoCanvas(sourceCanvas, roi, tuning, radiusPx = 2) {
    const points = Array.isArray(roi?.border_pixels) ? roi.border_pixels : [];
    if (!sourceCanvas || !points.length) return 0;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const rx = Math.max(0, Math.round(Number(roi.x) || 0));
    const ry = Math.max(0, Math.round(Number(roi.y) || 0));
    const rw = Math.max(1, Math.round(Number(roi.w) || 1));
    const rh = Math.max(1, Math.round(Number(roi.h) || 1));
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(w - 1, rx + rw - 1);
    const y1 = Math.min(h - 1, ry + rh - 1);
    if (x1 <= x0 || y1 <= y0) return 0;

    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const d = img.data;
    const iw = img.width;
    const ih = img.height;
    const radius = Math.max(0, Number(radiusPx || 2));
    let changed = 0;

    for (const pt of points) {
      const pxAbs = Math.round(Number(pt?.x));
      const pyAbs = Math.round(Number(pt?.y));
      if (!Number.isFinite(pxAbs) || !Number.isFinite(pyAbs)) continue;
      const cx = pxAbs - x0;
      const cy = pyAbs - y0;
      if (cx < 0 || cy < 0 || cx >= iw || cy >= ih) continue;

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= iw || ny >= ih) continue;
          const p = ((ny * iw) + nx) * 4;
          const r = d[p];
          const g = d[p + 1];
          const b = d[p + 2];
          const a = d[p + 3];
          if (!isLimeGreenLikePixel(r, g, b, a, tuning)) continue;
          paintPixelWithNeighborGray(d, iw, ih, nx, ny, tuning, 10);
          changed += 1;
        }
      }
    }

    if (changed > 0) ctx.putImageData(img, x0, y0);
    return changed;
  }

  function apagarPixelsVerdesDeMargemDoBoxNoCanvas(sourceCanvas, roi, tuning, edgeBandPx = 2) {
    if (!sourceCanvas || !roi) return;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const rx = Math.max(0, Math.round(Number(roi.x) || 0));
    const ry = Math.max(0, Math.round(Number(roi.y) || 0));
    const rw = Math.max(1, Math.round(Number(roi.w) || 1));
    const rh = Math.max(1, Math.round(Number(roi.h) || 1));
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(w - 1, rx + rw - 1);
    const y1 = Math.min(h - 1, ry + rh - 1);
    if (x1 <= x0 || y1 <= y0) return;

    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const cut = document.createElement("canvas");
    cut.width = x1 - x0 + 1;
    cut.height = y1 - y0 + 1;
    const cctx = cut.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(sourceCanvas, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
    apagarPixelsVerdesDeMargemDoBox(cut, tuning, edgeBandPx);
    ctx.drawImage(cut, 0, 0, cut.width, cut.height, x0, y0, cut.width, cut.height);
  }

  function limparMargemVerdeDosBoxesDetectados(sourceCanvas, rois, tuning, edgeBandPx = 8) {
    const list = Array.isArray(rois) ? rois : [];
    for (const roi of list) {
      const mech = String(roi?.mechanism || "");
      if (!mech.includes("box")) continue;
      // 1) remove verde exatamente na linha de borda detectada do box
      apagarLinhaVerdeDetectadaDoBoxNoCanvas(sourceCanvas, roi, tuning, 2);
      // 2) limpeza complementar na margem do ROI para sobras de anti-alias
      apagarPixelsVerdesDeMargemDoBoxNoCanvas(sourceCanvas, roi, tuning, edgeBandPx);
    }
  }

  function reduzirPaddingVerticalRoi(roi, sourceCanvas, tuning, options = {}) {
    const satThreshold = getSaturationThresholdFromTuning(tuning);
    const roiCanvas = extractRoiCanvas(sourceCanvas, roi);
    const maskData = buildTextMaskForRoi(roiCanvas, { saturationThreshold: satThreshold });
    const projection = computeHorizontalProjection(maskData.mask, maskData.width, maskData.height);
    const minPixels = Math.max(
      2,
      Math.round(maskData.width * Number(options.minActiveRowPixelsRatio || ROI_VERTICAL_TIGHTEN_OPTIONS.minActiveRowPixelsRatio)),
    );

    let first = -1;
    let last = -1;
    for (let y = 0; y < projection.length; y += 1) {
      if (projection[y] >= minPixels) {
        first = y;
        break;
      }
    }
    for (let y = projection.length - 1; y >= 0; y -= 1) {
      if (projection[y] >= minPixels) {
        last = y;
        break;
      }
    }
    if (first < 0 || last < first) return roi;

    const topMargin = first;
    const bottomMargin = Math.max(0, (roi.h - 1) - last);
    const keep = Math.max(0, Math.min(1, Number(options.keepMarginFactor || ROI_VERTICAL_TIGHTEN_OPTIONS.keepMarginFactor)));
    const cutTop = Math.floor(topMargin * (1 - keep));
    const cutBottom = Math.floor(bottomMargin * (1 - keep));

    const newY = roi.y + cutTop;
    const newH = Math.max(1, roi.h - cutTop - cutBottom);
    const minH = Math.max(6, Number(options.minHeightPx || ROI_VERTICAL_TIGHTEN_OPTIONS.minHeightPx));
    if (newH < minH) return roi;
    const restoreMarginY = Math.max(0, Number(options.restoreMarginY ?? ROI_VERTICAL_TIGHTEN_OPTIONS.restoreMarginY));
    const yStart = Math.max(0, newY - restoreMarginY);
    const yEnd = Math.min(sourceCanvas.height - 1, (newY + newH - 1) + restoreMarginY);

    return {
      ...roi,
      y: yStart,
      h: Math.max(1, yEnd - yStart + 1),
      mechanism: `${roi.mechanism || "roi"}_vtrim`,
    };
  }

  function reduzirPaddingVerticalDosRois(rois, sourceCanvas, tuning, options = {}) {
    return rois.map((roi) => reduzirPaddingVerticalRoi(roi, sourceCanvas, tuning, options));
  }

  function expandirMargemDosRois(rois, sourceCanvas, marginX = ROI_MARGIN_X, marginY = ROI_MARGIN_Y) {
    const list = Array.isArray(rois) ? rois : [];
    const maxW = Math.max(1, sourceCanvas?.width || 1);
    const maxH = Math.max(1, sourceCanvas?.height || 1);
    const mx = Math.max(0, Math.round(Number(marginX) || 0));
    const my = Math.max(0, Math.round(Number(marginY) || 0));
    return list.map((roi) => {
      const x0 = Math.max(0, Math.round(Number(roi.x) || 0) - mx);
      const y0 = Math.max(0, Math.round(Number(roi.y) || 0) - my);
      const x1 = Math.min(maxW - 1, Math.round((Number(roi.x) || 0) + (Number(roi.w) || 1) - 1) + mx);
      const y1 = Math.min(maxH - 1, Math.round((Number(roi.y) || 0) + (Number(roi.h) || 1) - 1) + my);
      return {
        ...roi,
        x: x0,
        y: y0,
        w: Math.max(1, x1 - x0 + 1),
        h: Math.max(1, y1 - y0 + 1),
      };
    });
  }

  function separarLinhasDentroDosRois(rois, sourceCanvas, tuning) {
    void sourceCanvas;
    void tuning;
    return (Array.isArray(rois) ? rois : []).map((roi, i) => ({
      ...roi,
      source_index: i + 1,
      parent_roi_index: i + 1,
      line_index: 1,
      is_line_split: false,
      debug_label: `${i + 1}`,
    }));
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
      topBorderTrim: 0,
    };
  }

  function detectTopBlackBorderRows(ctx, width, height, tuning, maxRows = 5) {
    const limit = Math.max(0, Math.min(maxRows, height - 1));
    if (limit <= 0) return 0;
    const colorCfg = tuning?.color || DEFAULT_TUNING.color;
    const pixels = ctx.getImageData(0, 0, width, limit).data;
    const minContentPixels = Math.max(3, Math.round(width * 0.01));
    const satThreshold = Math.max(0.06, Number(colorCfg?.satGreenMin || 0.2) * 0.4);

    const rowHasContent = (y) => {
      let content = 0;
      for (let x = 0; x < width; x += 1) {
        const p = ((y * width) + x) * 4;
        const r = pixels[p];
        const g = pixels[p + 1];
        const b = pixels[p + 2];
        const a = pixels[p + 3];
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        const lum = (r + g + b) / 3;
        const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
        const isContent = (a > 20) && (lum > 22 || sat > satThreshold);
        if (isContent) content += 1;
      }
      return content >= minContentPixels;
    };

    for (let y = 0; y < limit; y += 1) {
      if (rowHasContent(y)) return y;
    }
    return limit;
  }

  function trimTopBlackBorder(preprocessed, tuning, maxRows = 5) {
    const src = preprocessed?.canvas;
    if (!src) return preprocessed;
    const width = src.width;
    const height = src.height;
    if (width < 2 || height < 2) return preprocessed;

    const ctx = src.getContext("2d", { willReadFrequently: true });
    const trimTop = detectTopBlackBorderRows(ctx, width, height, tuning, maxRows);
    if (!trimTop) {
      return { ...preprocessed, topBorderTrim: 0 };
    }

    const out = document.createElement("canvas");
    out.width = width;
    out.height = Math.max(1, height - trimTop);
    const octx = out.getContext("2d", { willReadFrequently: true });
    octx.drawImage(src, 0, trimTop, width, out.height, 0, 0, width, out.height);
    return {
      ...preprocessed,
      canvas: out,
      ctx: octx,
      width: out.width,
      height: out.height,
      topBorderTrim: trimTop,
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
    const yellowTextMask = new Uint8Array(width * height);
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

    const isGreenLikeBorder = (r, g, b, a) => {
      if (a < colorCfg.alphaMin) return false;
      const { h, s, v } = rgbToHsv(r, g, b);
      return (
        h >= colorCfg.hueGreenMin &&
        h <= colorCfg.hueGreenMax &&
        s >= Math.max(0.18, colorCfg.satGreenMin * 0.85) &&
        v >= Math.max(0.16, colorCfg.valueMin * 0.9)
      );
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
      const orangeValueMin = Number.isFinite(Number(colorCfg.orangeValueMin))
        ? Number(colorCfg.orangeValueMin)
        : Number(colorCfg.valueMin);
      const isOrange = h >= colorCfg.hueOrangeMin && h <= colorCfg.hueOrangeMax && s >= colorCfg.satOrangeMin && v >= orangeValueMin;
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
      const strongOrangeValueMin = Number.isFinite(Number(colorCfg.strongOrangeValueMin))
        ? Number(colorCfg.strongOrangeValueMin)
        : Number(colorCfg.strongValueMin);
      const isOrange =
        h >= colorCfg.strongHueOrangeMin && h <= colorCfg.strongHueOrangeMax &&
        s >= colorCfg.strongSatOrangeMin && v >= strongOrangeValueMin;
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
        if (a >= colorCfg.alphaMin) {
          const { h, s, v } = rgbToHsv(r, g, b);
          const boxYellowHueMin = Number.isFinite(Number(colorCfg.boxYellowHueMin))
            ? Number(colorCfg.boxYellowHueMin)
            : Number(colorCfg.hueYellowMin);
          const boxYellowHueMax = Number.isFinite(Number(colorCfg.boxYellowHueMax))
            ? Number(colorCfg.boxYellowHueMax)
            : Number(colorCfg.hueYellowMax);
          const boxYellowSatMin = Number.isFinite(Number(colorCfg.boxYellowSatMin))
            ? Number(colorCfg.boxYellowSatMin)
            : Number(colorCfg.satYellowMin);
          const boxYellowValueMin = Number.isFinite(Number(colorCfg.boxYellowValueMin))
            ? Number(colorCfg.boxYellowValueMin)
            : Number(colorCfg.valueMin);
          const isYellow = h >= boxYellowHueMin && h <= boxYellowHueMax && s >= boxYellowSatMin && v >= boxYellowValueMin;
          if (isYellow) yellowTextMask[i] = 1;
        }
        // Box pipeline: aceita borda cinza OU verde, mantendo validação por contraste.
        const isGrayBorderPixel = isGrayLike(r, g, b) && a >= grayCfg.minAlpha;
        const isGreenBorderPixel = isGreenLikeBorder(r, g, b, a);
        if (!isGrayBorderPixel && !isGreenBorderPixel) continue;

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

    const mergeNearbyYellowRects = (rects) => {
      const out = rects.map((r) => ({ ...r }));
      const overlap1d = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
      const gap1d = (a0, a1, b0, b1) => {
        if (a1 < b0) return b0 - a1;
        if (b1 < a0) return a0 - b1;
        return 0;
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < out.length; i += 1) {
          let merged = false;
          for (let j = i + 1; j < out.length; j += 1) {
            const a = out[i];
            const b = out[j];
            const ax1 = a.x + a.w - 1;
            const ay1 = a.y + a.h - 1;
            const bx1 = b.x + b.w - 1;
            const by1 = b.y + b.h - 1;
            const yOverlap = overlap1d(a.y, ay1, b.y, by1) / Math.max(1, Math.min(a.h, b.h));
            const xOverlap = overlap1d(a.x, ax1, b.x, bx1) / Math.max(1, Math.min(a.w, b.w));
            const xGap = gap1d(a.x, ax1, b.x, bx1);
            const yGap = gap1d(a.y, ay1, b.y, by1);
            const shouldMerge =
              (yOverlap >= 0.25 && xGap <= 38) ||
              (xOverlap >= 0.25 && yGap <= 26);
            if (!shouldMerge) continue;
            const nx0 = Math.min(a.x, b.x);
            const ny0 = Math.min(a.y, b.y);
            const nx1 = Math.max(ax1, bx1);
            const ny1 = Math.max(ay1, by1);
            out[i] = {
              x: nx0,
              y: ny0,
              w: nx1 - nx0 + 1,
              h: ny1 - ny0 + 1,
              area: (nx1 - nx0 + 1) * (ny1 - ny0 + 1),
            };
            out.splice(j, 1);
            changed = true;
            merged = true;
            break;
          }
          if (merged) break;
        }
      }
      return out;
    };

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

    const mergeHorizontalTouchingColorCandidates = (candidates) => {
      const out = candidates.map((c) => ({ ...c }));
      const overlap1d = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
      const gap1d = (a0, a1, b0, b1) => {
        if (a1 < b0) return b0 - a1;
        if (b1 < a0) return a0 - b1;
        return 0;
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < out.length; i += 1) {
          let mergedThisRound = false;
          for (let j = i + 1; j < out.length; j += 1) {
            const a = out[i];
            const b = out[j];
            const ax0 = a.x;
            const ay0 = a.y;
            const ax1 = a.x + a.w - 1;
            const ay1 = a.y + a.h - 1;
            const bx0 = b.x;
            const by0 = b.y;
            const bx1 = b.x + b.w - 1;
            const by1 = b.y + b.h - 1;

            const yOverlap = overlap1d(ay0, ay1, by0, by1) / Math.max(1, Math.min(a.h, b.h));
            if (yOverlap < COLOR_HORIZONTAL_MERGE_MIN_Y_OVERLAP) continue;

            const xGap = gap1d(ax0, ax1, bx0, bx1);
            if (xGap > COLOR_HORIZONTAL_MERGE_GAP_PX) continue;

            const nx0 = Math.min(ax0, bx0);
            const ny0 = Math.min(ay0, by0);
            const nx1 = Math.max(ax1, bx1);
            const ny1 = Math.max(ay1, by1);
            out[i] = {
              x: nx0,
              y: ny0,
              w: nx1 - nx0 + 1,
              h: ny1 - ny0 + 1,
              area: (nx1 - nx0 + 1) * (ny1 - ny0 + 1),
              textDensity: Math.max(a.textDensity || 0, b.textDensity || 0),
              score: Math.max(a.score || 0, b.score || 0) + 1.2,
              mechanism: "color_pipeline",
            };
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

    const mergeNearbyBoxCandidates = (candidates) => {
      const out = candidates.map((c) => ({ ...c }));
      const maxGap = Math.max(0, Number(geoCfg.boxMergeNearbyGapPx || 10));
      const minYOverlap = Math.max(0.3, Number(geoCfg.boxMergeMinYOverlapRatio || 0.6));
      const minXOverlap = Math.max(0, Number(geoCfg.boxMergeMinXOverlapRatio || 0.2));
      const overlap1d = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
      const gap1d = (a0, a1, b0, b1) => {
        if (a1 < b0) return b0 - a1;
        if (b1 < a0) return a0 - b1;
        return 0;
      };

      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < out.length; i += 1) {
          let mergedThisRound = false;
          for (let j = i + 1; j < out.length; j += 1) {
            const a = out[i];
            const b = out[j];
            const ax0 = a.x;
            const ay0 = a.y;
            const ax1 = a.x + a.w - 1;
            const ay1 = a.y + a.h - 1;
            const bx0 = b.x;
            const by0 = b.y;
            const bx1 = b.x + b.w - 1;
            const by1 = b.y + b.h - 1;
            const yOverlap = overlap1d(ay0, ay1, by0, by1) / Math.max(1, Math.min(a.h, b.h));
            const xOverlap = overlap1d(ax0, ax1, bx0, bx1) / Math.max(1, Math.min(a.w, b.w));
            const xGap = gap1d(ax0, ax1, bx0, bx1);
            const shouldMerge = yOverlap >= minYOverlap && (xOverlap >= minXOverlap || xGap <= maxGap);
            if (!shouldMerge) continue;

            const nx0 = Math.min(ax0, bx0);
            const ny0 = Math.min(ay0, by0);
            const nx1 = Math.max(ax1, bx1);
            const ny1 = Math.max(ay1, by1);
            out[i] = {
              x: nx0,
              y: ny0,
              w: nx1 - nx0 + 1,
              h: ny1 - ny0 + 1,
              area: (nx1 - nx0 + 1) * (ny1 - ny0 + 1),
              textDensity: Math.max(a.textDensity || 0, b.textDensity || 0),
              score: Math.max(a.score || 0, b.score || 0) + 2,
              mechanism: "box",
              border_pixels: [
                ...(Array.isArray(a.border_pixels) ? a.border_pixels : []),
                ...(Array.isArray(b.border_pixels) ? b.border_pixels : []),
              ],
            };
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
        const borderPixels = [];

        while (q.length) {
          const [cx, cy] = q.shift();
          borderCount += 1;
          borderPixels.push({ x: cx, y: cy });
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
          border_pixels: borderPixels,
        });
      }
    }

    // box_vtrim tem prioridade espacial: box_yellow nao pode detectar dentro dessa area.
    const boxOnlyNegativeMask = new Uint8Array(width * height);
    for (const candidate of rawCandidates) {
      if (candidate.mechanism !== "box") continue;
      const padX = Math.max(geoCfg.negativeMaskPadXMin, Math.round(candidate.w * geoCfg.negativeMaskPadXRatio));
      const padY = Math.max(geoCfg.negativeMaskPadYMin, Math.round(candidate.h * geoCfg.negativeMaskPadYRatio));
      paintMaskRect(
        boxOnlyNegativeMask,
        candidate.x - padX,
        candidate.y - padY,
        candidate.x + candidate.w - 1 + padX,
        candidate.y + candidate.h - 1 + padY,
        1,
      );
    }

    const yellowSearchMask = new Uint8Array(width * height);
    for (let i = 0; i < yellowTextMask.length; i += 1) {
      yellowSearchMask[i] = (yellowTextMask[i] && !boxOnlyNegativeMask[i]) ? 1 : 0;
    }

    const yellowComponentsRaw = connectedComponentsBoxes(yellowSearchMask, new Uint8Array(width * height), 16);
    const yellowRectsSeed = yellowComponentsRaw
      .filter((b) => b.w >= 8 && b.h >= 6 && b.area >= 90)
      .map((b) => ({
        x: b.minX,
        y: b.minY,
        w: b.w,
        h: b.h,
        area: b.area,
      }));
    const yellowRectsMerged = mergeNearbyYellowRects(yellowRectsSeed);
    for (const r of yellowRectsMerged) {
      if (r.w < 60 || r.h < 14) continue;
      const ar = r.w / Math.max(1, r.h);
      if (ar < 1.2 || ar > 28) continue;
      const rx0 = Math.max(0, r.x);
      const ry0 = Math.max(0, r.y);
      const rx1 = Math.min(width - 1, r.x + r.w - 1);
      const ry1 = Math.min(height - 1, r.y + r.h - 1);
      let yellowCount = 0;
      let n = 0;
      for (let y = ry0; y <= ry1; y += 1) {
        const row = y * width;
        for (let x = rx0; x <= rx1; x += 1) {
          n += 1;
          if (yellowSearchMask[row + x]) yellowCount += 1;
        }
      }
      const textDensity = yellowCount / Math.max(1, n);
      if (yellowCount < 26 || textDensity < 0.03) continue;
      const score = (textDensity * 2500) + (Math.log10(r.area + 1) * 4.8);
      rawCandidates.push({
        x: rx0,
        y: ry0,
        w: rx1 - rx0 + 1,
        h: ry1 - ry0 + 1,
        area: (rx1 - rx0 + 1) * (ry1 - ry0 + 1),
        textDensity,
        score,
        mechanism: "box_yellow",
      });
    }

    // Build negative mask from gray boxes, so color search runs only outside these areas.
    const negativeMask = new Uint8Array(width * height);
    for (const candidate of rawCandidates) {
      if (candidate.mechanism !== "box" && candidate.mechanism !== "box_yellow") continue;
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

    // Merge de candidatos de cor desativado para os testes atuais de split por linha.
    // Motivo: este merge pode unir verticalmente caixas próximas e esconder linhas distintas.
    const finalColorCandidates = ENABLE_COLOR_CANDIDATE_MERGE
      ? mergeOverlappingColorCandidates(colorCandidatesRaw)
      : colorCandidatesRaw;
    const finalColorCandidatesMerged = mergeHorizontalTouchingColorCandidates(finalColorCandidates);
    finalColorCandidatesMerged.forEach((c) => rawCandidates.push(c));

    const selected = [];

    const addIfNoStrongOverlap = (candidate) => {
      const overlaps = selected.some((s) => iou(candidate, s) > geoCfg.selectionIouMax);
      if (!overlaps) selected.push(candidate);
    };

    const boxCandidatesRaw = rawCandidates.filter((c) => c.mechanism === "box");
    const boxCandidates = (ENABLE_BOX_CANDIDATE_MERGE
      ? mergeNearbyBoxCandidates(boxCandidatesRaw)
      : boxCandidatesRaw)
      .sort((a, b) => b.score - a.score);

    const boxYellowCandidates = rawCandidates
      .filter((c) => c.mechanism === "box_yellow")
      .sort((a, b) => b.score - a.score);

    const colorCandidatesRanked = rawCandidates
      .filter((c) => c.mechanism !== "box" && c.mechanism !== "box_yellow")
      .sort((a, b) => b.score - a.score);

    for (const candidate of boxCandidates) {
      addIfNoStrongOverlap(candidate);
      if (selected.length >= 12) break;
    }

    for (const candidate of boxYellowCandidates) {
      addIfNoStrongOverlap(candidate);
      if (selected.length >= 16) break;
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
    const tag = roi.debug_label || `#${idx + 1}`;
    cap.textContent = `${tag}${mech} • x:${roi.x} y:${roi.y} w:${roi.w} h:${roi.h}${textDensity}`;

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

  function buildLineSplitDebugCard(sourceCanvas, parentRoi, debugInfo) {
    const wrap = document.createElement("div");
    wrap.className = "meta";
    const header = document.createElement("div");
    header.innerHTML = `<strong>Split debug ROI #${escapeHtml(debugInfo?.roi_label || "-")}</strong> • half=${escapeHtml(debugInfo?.chosen_side || "-")} • spacing=${escapeHtml(String(debugInfo?.line_spacing || "-"))}`;
    wrap.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "rois-grid";
    grid.style.marginTop = "6px";

    const mkFigure = (src, title) => {
      const fig = document.createElement("figure");
      fig.className = "roi-item";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = src;
      img.alt = title;
      const cap = document.createElement("figcaption");
      cap.textContent = title;
      fig.appendChild(img);
      fig.appendChild(cap);
      return fig;
    };

    const original = extractRoiCanvas(sourceCanvas, parentRoi).toDataURL("image/png");
    grid.appendChild(mkFigure(original, "box_vtrim original"));
    if (debugInfo?.chosen_half_data_url) grid.appendChild(mkFigure(debugInfo.chosen_half_data_url, "metade escolhida"));
    if (debugInfo?.mask_data_url) grid.appendChild(mkFigure(debugInfo.mask_data_url, "mascara amarela"));
    if (debugInfo?.projection_data_url) grid.appendChild(mkFigure(debugInfo.projection_data_url, "projecao + bandas + vales"));
    wrap.appendChild(grid);
    return wrap;
  }

  function createOcrResultLine(roiRecord) {
    const wrap = document.createElement("section");
    wrap.className = "ocr-compare-card";

    const header = document.createElement("div");
    header.className = "ocr-compare-header";
    const idx = Number(roiRecord.roi_index || 0);
    const idxTag = roiRecord.roi_label || (idx > 0 ? `#${idx}` : roiRecord.roi_id);
    header.innerHTML = `<strong>${idxTag}</strong> • ${roiRecord.roi_kind === OCR_KIND.MEASURE ? "medida" : "legenda"} • pendente`;

    const preview = document.createElement("img");
    preview.className = "ocr-compare-thumb";
    const roiImageId = roiRecord.roi_image_id;
    if (roiImageId && imageStore.items[roiImageId]?.objectUrl) {
      preview.src = imageStore.items[roiImageId].objectUrl;
    } else {
      preview.alt = "ROI";
    }
    preview.loading = "lazy";
    preview.alt = `Crop ${idxTag}`;

    const detail = document.createElement("div");
    detail.className = "ocr-compare-details";
    detail.textContent = "Pendente...";

    wrap.appendChild(header);
    wrap.appendChild(preview);
    wrap.appendChild(detail);
    return {
      root: wrap,
      line: header,
      detail,
    };
  }

  function renderizarComparativoOCR(roiRecord, mountEl) {
    const attempts = Array.isArray(roiRecord.ocr_attempts) ? roiRecord.ocr_attempts : [];
    const preserveLineBreaks = Array.isArray(roiRecord.trigger_flags) && roiRecord.trigger_flags.includes("paddle_original_box_eval");
    const finalText = formatarTextoOcrParaExibicao(roiRecord.ocr_text_raw || "", preserveLineBreaks);
    const finalConf = typeof roiRecord.ocr_confidence === "number" ? `${(roiRecord.ocr_confidence * 100).toFixed(1)}%` : "--";
    const selectedId = String(roiRecord.ocr_selected_attempt_id || "").trim();
    const technicalNotes = Array.isArray(roiRecord.ocr_technical_notes) ? roiRecord.ocr_technical_notes : [];

    const cardsHtml = attempts.map((attempt) => {
      const conf = typeof attempt.confidence === "number" ? `${(attempt.confidence * 100).toFixed(1)}%` : "--";
      const rawText = formatarTextoOcrParaExibicao(attempt.text || "", preserveLineBreaks);
      const psm = attempt.psm || "-";
      const flags = [];
      if (attempt.disableSystemDawg) flags.push("no_system_dawg");
      if (attempt.disableFreqDawg) flags.push("no_freq_dawg");
      if (attempt.whitelist) flags.push("whitelist");
      if (attempt.preprocess && attempt.preprocess !== "original") flags.push(`pre:${attempt.preprocess}`);
      if (attempt.vocabAware) flags.push("vocab");
      const appliedInfo = attempt.applied_parameters_summary || "";
      const fallbackInfo = Array.isArray(attempt.fallback_notes) && attempt.fallback_notes.length
        ? attempt.fallback_notes.join(" | ")
        : "";
      const cfg = [flags.join(","), appliedInfo, fallbackInfo].filter(Boolean).join(" | ");
      const selected = selectedId && selectedId === attempt.id ? " selected" : "";
      return `<article class="ocr-attempt-card${selected}">
        <div class="ocr-attempt-title">${escapeHtml(attempt.label || attempt.id || "-")}</div>
        <div class="ocr-attempt-meta"><strong>PSM:</strong> ${escapeHtml(psm)}</div>
        <div class="ocr-attempt-meta"><strong>Conf:</strong> ${escapeHtml(conf)}</div>
        <div class="ocr-attempt-meta"><strong>Config:</strong> ${escapeHtml(cfg || "-")}</div>
        <div class="ocr-attempt-text">${escapeHtmlWithLineBreaks(rawText || "[sem texto]")}</div>
      </article>`;
    }).join("");

    const notesHtml = technicalNotes.length
      ? `<div class="ocr-tech-notes"><strong>Notas técnicas:</strong> ${escapeHtml(technicalNotes.join(" | "))}</div>`
      : "";

    mountEl.innerHTML = [
      `<div class="ocr-final-text"><strong>Texto final:</strong> ${escapeHtmlWithLineBreaks(finalText || "[sem texto]")} <span class="ocr-final-conf">(${escapeHtml(finalConf)})</span></div>`,
      attempts.length
        ? `<div class="ocr-attempt-cards">${cardsHtml}</div>`
        : `<div class="placeholder">Sem tentativas registradas.</div>`,
      notesHtml,
    ].join("");
  }

  function buildMetaCell(messageId, metaSummary) {
    const box = document.createElement("div");
    box.className = "meta";
    const allTagsJson = safeMetadataJson(metaSummary.raw);
    box.innerHTML = [
      `<strong>Paciente:</strong> ${escapeHtml(metaSummary.patient)}`,
      `<br><strong>Data:</strong> ${escapeHtml(metaSummary.date)}`,
      `<br><strong>Registro:</strong> ${escapeHtml(metaSummary.pid)}`,
      `<br><strong>Modalidade:</strong> ${escapeHtml(metaSummary.modality)}`,
      `<br><strong>Fabricante:</strong> ${escapeHtml(metaSummary.manufacturer)}`,
      `<br><strong>Modelo:</strong> ${escapeHtml(metaSummary.model)}`,
      `<br><code>message_id: ${escapeHtml(messageId || "-")}</code>`,
      `<br><details><summary><strong>Metadados DICOM (todas as tags extraídas)</strong></summary><pre>${escapeHtml(allTagsJson)}</pre></details>`,
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
    const targetOrigin = eventOrigin || parentBridgeOrigin || BRIDGE_ORIGIN;
    window.parent.postMessage({ type: "ack", message_id: messageId }, targetOrigin);
  }

  function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (origin === BRIDGE_ORIGIN) return true;
    if (origin === parentBridgeOrigin) return true;
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
    const legendVocabulary = await legendVocabularyPromise;
    const legendVocabularyAux = {
      tokens: Array.isArray(legendVocabulary?.tokens) ? legendVocabulary.tokens.slice(0, 2500) : [],
      abbreviations: Array.isArray(legendVocabulary?.abbreviations) ? legendVocabulary.abbreviations : [],
    };
    const preprocessProfile = resolvePreprocessProfile(data.metadata, preprocessConfig);
    const decoded = await decodeImage(pngBuffer);
    const parentMessageId = data.message_id || String(Date.now());
    const anonymizedId = `${parentMessageId}_anonimyzed`;
    const original = drawImageToCanvas(decoded.image);
    const preprocessedBase = applyPreprocessCrop(original.canvas, preprocessProfile);
    const preprocessed = trimTopBlackBorder(preprocessedBase, preprocessProfile.tuning, 5);
    const detectedRoisRaw = detectCandidateRois(preprocessed.ctx, preprocessed.width, preprocessed.height, preprocessProfile.tuning);
    // Limpa pixels verdes de margem dos ROIs de box no canvas base ANTES de split/sub-ROI/debug.
    limparMargemVerdeDosBoxesDetectados(preprocessed.canvas, detectedRoisRaw, preprocessProfile.tuning, 8);
    // Reduz pela metade as margens verticais vazias (topo/base) antes do split.
    const detectedRois = reduzirPaddingVerticalDosRois(
      detectedRoisRaw,
      preprocessed.canvas,
      preprocessProfile.tuning,
      ROI_VERTICAL_TIGHTEN_OPTIONS,
    );
    const detectedRoisFiltered = detectedRois.filter((roi) => {
      const d = Number(roi?.textDensity);
      if (!Number.isFinite(d)) return true;
      return d >= MIN_ORIGINAL_ROI_TEXT_DENSITY;
    });
    const detectedRoisExpanded = expandirMargemDosRois(
      detectedRoisFiltered,
      preprocessed.canvas,
      ROI_MARGIN_X,
      ROI_MARGIN_Y,
    );
    const rois = separarLinhasDentroDosRois(detectedRoisExpanded, preprocessed.canvas, preprocessProfile.tuning);
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
    const originalTitle = document.createElement("div");
    originalTitle.className = "meta";
    originalTitle.innerHTML = "<strong>ROIs originais detectados:</strong>";
    tdRois.appendChild(originalTitle);

    const originalGrid = document.createElement("div");
    originalGrid.className = "rois-grid";
    if (!detectedRoisExpanded.length) {
      const noRoi = document.createElement("div");
      noRoi.className = "placeholder";
      noRoi.textContent = "Nenhuma ROI detectada acima do limite de txt >= 10%.";
      originalGrid.appendChild(noRoi);
    } else {
      detectedRoisExpanded.forEach((roi, i) => {
        originalGrid.appendChild(buildRoiThumb(preprocessed.canvas, { ...roi, debug_label: `#${i + 1} (orig)` }, i));
      });
    }
    tdRois.appendChild(originalGrid);

    const roiDescriptors = await Promise.all(
      rois.map(async (roi, index) => {
        const parentIdx = Number(roi.parent_roi_index || roi.source_index || (index + 1));
        const lineIdx = Number(roi.line_index || 1);
        const hasSplit = Boolean(roi.is_line_split);
        const usePaddleForRoi = !hasSplit && isOriginalBoxPaddleCandidate(roi);
        const roiLabel = hasSplit ? `${parentIdx}.${lineIdx}` : `${parentIdx}`;
        const roiId = hasSplit
          ? `${parentMessageId}_roi_${parentIdx}_${lineIdx}`
          : `${parentMessageId}_roi_${parentIdx}`;
        const roiImageId = `${roiId}_anonimyzed`;
        const roiKind = classificarTipoRoi(roi);
        const ocrPlan = usePaddleForRoi
          ? []
          : roiKind === OCR_KIND.LEGEND
          ? montarTentativasOCRLegenda(legendVocabulary)
          : montarTentativasOCRMedida();
        const saturationThreshold = getSaturationThresholdFromTuning(preprocessProfile?.tuning);
        const roiCanvas = extractRoiCanvas(preprocessed.canvas, roi);
        const roiBlob = await canvasToBlob(roiCanvas, "image/png");
        saveImageVariantToStore(roiImageId, parentMessageId, data.metadata, preprocessProfile, roiBlob);

        const created = {
          roi_id: roiId,
          roi_index: (parentIdx * 100) + lineIdx,
          roi_label: roiLabel,
          parent_message_id: parentMessageId,
          parent_image_id: parentMessageId,
          parent_image_anonymized_id: anonymizedId,
          roi_image_id: roiImageId,
          roi_box: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
          roi_parent_index: parentIdx,
          roi_line_index: lineIdx,
          roi_area: roi.w * roi.h,
          roi_kind: roiKind,
          roi_mechanism: roi.mechanism || "",
          device: {
            manufacturer: preprocessProfile.manufacturer,
            model: preprocessProfile.model,
          },
          crop_profile: preprocessProfile.crop,
          ocr_status: "pending",
          ocr_text_raw: "",
          ocr_confidence: 0,
          ocr_attempts: [],
          ocr_selected_attempt_id: "",
          ocr_technical_notes: [],
          trigger_flags: usePaddleForRoi ? ["paddle_original_box_eval"] : [],
          exclude_from_parent_summary: !usePaddleForRoi && isBoxPaddleBackedMechanism(roi.mechanism),
          created_at: Date.now(),
        };
        upsertOcrRecord(created);

        return {
          roi_id: roiId,
          roi_index: (parentIdx * 100) + lineIdx,
          roi_label: roiLabel,
          parent_message_id: parentMessageId,
          x: roi.x,
          y: roi.y,
          w: roi.w,
          h: roi.h,
          roi_kind: roiKind,
          roi_mechanism: roi.mechanism || "",
          roi_parent_index: parentIdx,
          roi_line_index: lineIdx,
          ocr_plan: ocrPlan,
          vocabulary_aux: roiKind === OCR_KIND.LEGEND ? legendVocabularyAux : null,
          preprocess_options: {
            saturation_threshold: saturationThreshold,
          },
          ocr_engine: usePaddleForRoi ? "paddle" : "tesseract",
          exclude_from_parent_summary: !usePaddleForRoi && isBoxPaddleBackedMechanism(roi.mechanism),
          image_blob: roiBlob,
        };
      }),
    );
    const allRoiDescriptors = roiDescriptors;

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
      `<br><strong>Borda preta sup. removida:</strong> ${preprocessed.topBorderTrim || 0}px`,
      `<br><strong>Origem:</strong> ${preprocessProfile.isFallback ? "modelo não identificado, usando Default" : "metadado"}`,
      `<br><code>id imagem: ${parentMessageId}</code>`,
    ].join("");
    tdOcr.appendChild(cropCaption);

    const ocrPanel = document.createElement("div");
    ocrPanel.className = "meta";
    ocrPanel.style.marginTop = "8px";
    ocrPanel.innerHTML = "<strong>Resultado OCR:</strong>";
    tdOcr.appendChild(ocrPanel);

    if (!allRoiDescriptors.length) {
      const empty = document.createElement("div");
      empty.className = "placeholder";
      empty.textContent = "Sem ROIs para OCR nesta imagem.";
      tdOcr.appendChild(empty);
    } else {
      allRoiDescriptors.forEach((item) => {
        const record = getRoiStoreRecord(item.roi_id) || { roi_id: item.roi_id };
        const line = createOcrResultLine(record);
        ocrRuntime.uiByRoiId[item.roi_id] = line;
        tdOcr.appendChild(line.root);
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

    const vocabInfo = legendVocabulary?.loaded_files
      ? ` | Vocab JSON: ${legendVocabulary.loaded_files} arquivo(s)`
      : "";
    setStatus(`Total: ${state.total} imagem(ns) processadas | Última: ${state.lastMessageId || "sem id"} | Perfil: ${preprocessProfile.manufacturer} ${preprocessProfile.model} | ROIs originais: ${detectedRois.length} | sub-ROIs: ${rois.length}${vocabInfo}`);
    if (allRoiDescriptors.length) {
      enqueueOcrJob({
        parentMessageId,
        rois: allRoiDescriptors,
      });
    }
    postAck(event.origin, data.message_id);
  }

  function onMessage(event) {
    if (!isAllowedOrigin(event.origin)) return;
    parentBridgeOrigin = event.origin || parentBridgeOrigin;
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
    window.parent.postMessage(payload, parentBridgeOrigin || BRIDGE_ORIGIN);
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

  setStatus(`Aguardando imagens via postMessage... origem permitida principal: ${parentBridgeOrigin}`);
  setInterval(postSettingsUpdate, 1500);
  window.addEventListener("DOMContentLoaded", () => {
    postSettingsUpdate();
    initOcrWorkerIfNeeded().catch((err) => {
      setStatus(`OCR worker não inicializado: ${err.message}`);
    });
  });
})();
