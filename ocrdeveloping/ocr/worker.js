const runtime = {
  mode: "stub",
  initialized: false,
  config: {},
  tesseract: {
    module: null,
    worker: null,
  },
};

function postWorkerError(error) {
  self.postMessage({
    type: "worker_error",
    error: String(error || "Erro desconhecido no worker OCR"),
  });
}

function normalizeConfig(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  return {
    mode: c.mode || "tesseract",
    modelTag: c.modelTag || "tesseract",
    tesseractScriptUrl: c.tesseractScriptUrl || "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    language: c.language || "eng",
    psm: String(c.psm || "6"),
    oem: String(c.oem || "1"),
    testVariants: Array.isArray(c.testVariants) && c.testVariants.length
      ? c.testVariants
      : ["normal", "invert"],
  };
}

async function initTesseract(cfg) {
  self.importScripts(cfg.tesseractScriptUrl);
  if (!self.Tesseract) {
    throw new Error("Tesseract.js não foi carregado no worker");
  }

  runtime.tesseract.module = self.Tesseract;
  runtime.tesseract.worker = await self.Tesseract.createWorker(cfg.language);
  await runtime.tesseract.worker.setParameters({
    tessedit_pageseg_mode: cfg.psm,
    tessedit_ocr_engine_mode: cfg.oem,
    preserve_interword_spaces: "1",
  });
}

async function initRuntime(config) {
  const cfg = normalizeConfig(config);
  runtime.mode = cfg.mode;
  runtime.config = cfg;

  if (cfg.mode === "tesseract") {
    await initTesseract(cfg);
  }

  runtime.initialized = true;
  self.postMessage({
    type: "ready",
    mode: runtime.mode,
    model: cfg.modelTag,
  });
}

async function preprocessVariantBlob(roiBlob, variant) {
  const bitmap = await createImageBitmap(roiBlob);
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  if (variant === "invert") {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    ctx.putImageData(img, 0, 0);
  }

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return outBlob;
}

function scoreTesseractText(text, confidence) {
  const t = String(text || "").trim();
  const confNorm = Math.max(0, Math.min(1, Number(confidence || 0) / 100));
  const alnumCount = (t.match(/[A-Za-z0-9À-ÿ]/g) || []).length;
  const garbageCount = (t.match(/[#@~`^*_+=|\\<>]/g) || []).length;
  const lengthBonus = Math.min(0.22, t.length * 0.006);
  const alnumBonus = t.length ? (alnumCount / t.length) * 0.24 : 0;
  const garbagePenalty = t.length ? (garbageCount / t.length) * 0.35 : 0;
  return confNorm + lengthBonus + alnumBonus - garbagePenalty;
}

async function inferTesseract(roiBlob) {
  const variants = runtime.config.testVariants;
  const variantResults = [];
  let best = null;

  for (const variant of variants) {
    const prepared = await preprocessVariantBlob(roiBlob, variant);
    const rec = await runtime.tesseract.worker.recognize(prepared);
    const text = String(rec?.data?.text || "").replace(/\s+/g, " ").trim();
    const confidence = Number(rec?.data?.confidence || 0) / 100;
    const score = scoreTesseractText(text, rec?.data?.confidence || 0);

    const row = {
      variant,
      text,
      confidence,
      score,
    };
    variantResults.push(row);
    if (!best || row.score > best.score) best = row;
  }

  return {
    text: best?.text || "",
    confidence: best?.confidence || 0,
    debug: {
      variant: best?.variant || "normal",
      dims: null,
      blankUsed: null,
      variants: variantResults,
    },
  };
}

async function processBatch(parentMessageId, rois) {
  const list = Array.isArray(rois) ? rois : [];
  const startedAt = Date.now();
  const results = [];

  for (const roi of list) {
    const t0 = Date.now();
    const roiId = roi?.roi_id || "";
    if (!roiId) continue;

    try {
      if (runtime.mode === "tesseract") {
        const decoded = await inferTesseract(roi.image_blob);
        results.push({
          roi_id: roiId,
          parent_message_id: roi?.parent_message_id || parentMessageId || null,
          status: "done",
          text: decoded.text,
          confidence: decoded.confidence,
          model_used: runtime.config.modelTag || "tesseract",
          latency_ms: Date.now() - t0,
          debug: decoded.debug,
          error: "",
        });
      } else {
        results.push({
          roi_id: roiId,
          parent_message_id: roi?.parent_message_id || parentMessageId || null,
          status: "waiting_model",
          text: "",
          confidence: 0,
          model_used: runtime.mode,
          latency_ms: Date.now() - t0,
          debug: null,
          error: "OCR mode não suportado no worker",
        });
      }
    } catch (error) {
      results.push({
        roi_id: roiId,
        parent_message_id: roi?.parent_message_id || parentMessageId || null,
        status: "error",
        text: "",
        confidence: 0,
        model_used: runtime.config.modelTag || runtime.mode,
        latency_ms: Date.now() - t0,
        debug: null,
        error: String(error?.message || error),
      });
    }
  }

  self.postMessage({
    type: "batch_result",
    parent_message_id: parentMessageId || null,
    latency_ms: Date.now() - startedAt,
    results,
  });
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};
  try {
    if (data.type === "init") {
      await initRuntime(data.config || {});
      return;
    }

    if (data.type === "process_batch") {
      if (!runtime.initialized) {
        await initRuntime({ mode: "tesseract" });
      }
      await processBatch(data.parent_message_id, data.rois || []);
    }
  } catch (error) {
    postWorkerError(error?.message || error);
  }
});
