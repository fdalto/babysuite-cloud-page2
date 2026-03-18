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
  };
}

async function initTesseract(cfg) {
  self.importScripts(cfg.tesseractScriptUrl);
  if (!self.Tesseract) {
    throw new Error("Tesseract.js nao foi carregado no worker");
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

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function extractTokens(text) {
  const matches = String(text || "").match(/[A-Za-z\u00c0-\u00ff0-9]+(?:[./-][A-Za-z\u00c0-\u00ff0-9]+)*/g) || [];
  return matches
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 2);
}

function extractAbbreviations(text) {
  const matches = String(text || "").match(/\b[A-Z]{2,6}\./g) || [];
  return matches.map((abbr) => abbr.toUpperCase());
}

function buildVocabularyIndex(vocabularyAux) {
  const tokens = new Set(
    (Array.isArray(vocabularyAux?.tokens) ? vocabularyAux.tokens : [])
      .map((t) => normalizeToken(t))
      .filter(Boolean),
  );
  const abbreviations = new Set(
    (Array.isArray(vocabularyAux?.abbreviations) ? vocabularyAux.abbreviations : [])
      .map((a) => String(a || "").trim().toUpperCase())
      .filter(Boolean),
  );
  return { tokens, abbreviations };
}

function scoreTesseractText(text, confidence) {
  const t = normalizeText(text);
  const confNorm = Math.max(0, Math.min(1, Number(confidence || 0) / 100));
  const alnumCount = (t.match(/[A-Za-z0-9\u00c0-\u00ff]/g) || []).length;
  const garbageCount = (t.match(/[#@~`^*_+=|\\<>]/g) || []).length;
  const lengthBonus = Math.min(0.22, t.length * 0.006);
  const alnumBonus = t.length ? (alnumCount / t.length) * 0.24 : 0;
  const garbagePenalty = t.length ? (garbageCount / t.length) * 0.35 : 0;
  return confNorm + lengthBonus + alnumBonus - garbagePenalty;
}

function scoreVocabularyBonus(text, vocabIndex) {
  if (!vocabIndex || (!vocabIndex.tokens.size && !vocabIndex.abbreviations.size)) return 0;
  const tokens = extractTokens(text);
  if (!tokens.length) return 0;

  const tokenHits = tokens.filter((token) => vocabIndex.tokens.has(token)).length;
  const tokenBonus = Math.min(0.22, tokenHits * 0.03);

  const abbrs = extractAbbreviations(text);
  const abbrHits = abbrs.filter((abbr) => vocabIndex.abbreviations.has(abbr)).length;
  const abbrBonus = Math.min(0.2, abbrHits * 0.05);

  return tokenBonus + abbrBonus;
}

function getAttemptPlan(roi) {
  const plans = Array.isArray(roi?.ocr_plan) ? roi.ocr_plan : [];
  if (plans.length) return plans;
  return [{ id: "A", label: "Teste A", psm: runtime.config.psm || "7", mode: "baseline" }];
}

function buildAttemptParameters(attempt) {
  const params = {
    tessedit_pageseg_mode: String(attempt?.psm || runtime.config.psm || "7"),
    tessedit_ocr_engine_mode: String(runtime.config.oem || "1"),
    preserve_interword_spaces: "1",
  };

  if (attempt?.whitelist) params.tessedit_char_whitelist = String(attempt.whitelist);
  // Tentativa real de desligar DAWGs quando solicitado (testes C/D).
  // Se a runtime nao suportar, o fallback fica registrado em fallback_notes.
  if (attempt?.disableSystemDawg) params.load_system_dawg = "0";
  if (attempt?.disableFreqDawg) params.load_freq_dawg = "0";

  return params;
}

async function applyAttemptParameters(attempt, params) {
  const applied = {};
  const notApplied = [];
  const worker = runtime.tesseract.worker;

  for (const [key, value] of Object.entries(params)) {
    try {
      await worker.setParameters({ [key]: String(value) });
      applied[key] = String(value);
    } catch (error) {
      notApplied.push(`${key}: ${String(error?.message || error)}`);
    }
  }

  if (attempt?.vocabAware) {
    // Tesseract.js no browser nao oferece API estavel para injetar word-list dinamica
    // via user_words diretamente. O fallback aplicado e usar vocabulario no scoring.
    notApplied.push("user_words: fallback por scoring pos-OCR (limitacao do wrapper/browser)");
  }

  return { applied, notApplied };
}

function summarizeAppliedParameters(applied) {
  const psm = applied.tessedit_pageseg_mode ? `psm=${applied.tessedit_pageseg_mode}` : "";
  const hasWhitelist = applied.tessedit_char_whitelist ? "whitelist" : "";
  const noSystem = applied.load_system_dawg === "0" ? "no_system_dawg" : "";
  const noFreq = applied.load_freq_dawg === "0" ? "no_freq_dawg" : "";
  return [psm, hasWhitelist, noSystem, noFreq].filter(Boolean).join(" | ");
}

async function inferTesseract(roiBlob, roi) {
  const attempts = getAttemptPlan(roi);
  const vocabIndex = buildVocabularyIndex(roi?.vocabulary_aux || {});
  const rows = [];
  const technicalNotes = [];
  let best = null;

  for (const attempt of attempts) {
    const params = buildAttemptParameters(attempt);
    const { applied, notApplied } = await applyAttemptParameters(attempt, params);
    if (notApplied.length) {
      technicalNotes.push(`${attempt?.id || "?"}: ${notApplied.join(" | ")}`);
    }

    const rec = await runtime.tesseract.worker.recognize(roiBlob);
    const text = normalizeText(rec?.data?.text || "");
    const rawConfidence = Number(rec?.data?.confidence || 0);
    const confidence = rawConfidence / 100;
    const baseScore = scoreTesseractText(text, rawConfidence);
    const vocabularyBonus = attempt?.vocabAware ? scoreVocabularyBonus(text, vocabIndex) : 0;
    const score = baseScore + vocabularyBonus;

    const row = {
      id: String(attempt?.id || "-"),
      label: String(attempt?.label || attempt?.id || "Teste"),
      text,
      confidence,
      score,
      psm: String(attempt?.psm || params.tessedit_pageseg_mode || ""),
      whitelist: String(attempt?.whitelist || ""),
      disableSystemDawg: Boolean(attempt?.disableSystemDawg),
      disableFreqDawg: Boolean(attempt?.disableFreqDawg),
      vocabAware: Boolean(attempt?.vocabAware),
      applied_parameters: applied,
      applied_parameters_summary: summarizeAppliedParameters(applied),
      fallback_notes: notApplied,
    };

    rows.push(row);

    if (!best || row.score > best.score || (row.score === best.score && row.text.length > best.text.length)) {
      best = row;
    }
  }

  return {
    text: best?.text || "",
    confidence: typeof best?.confidence === "number" ? best.confidence : 0,
    attempts: rows,
    selected_attempt_id: best?.id || "",
    technical_notes: technicalNotes,
    debug: {
      attempts: rows,
      selected_attempt_id: best?.id || "",
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
        const decoded = await inferTesseract(roi.image_blob, roi);
        results.push({
          roi_id: roiId,
          parent_message_id: roi?.parent_message_id || parentMessageId || null,
          roi_kind: roi?.roi_kind || "legend",
          status: "done",
          text: decoded.text,
          confidence: decoded.confidence,
          attempts: decoded.attempts,
          selected_attempt_id: decoded.selected_attempt_id,
          technical_notes: decoded.technical_notes,
          model_used: runtime.config.modelTag || "tesseract",
          latency_ms: Date.now() - t0,
          debug: decoded.debug,
          error: "",
        });
      } else {
        results.push({
          roi_id: roiId,
          parent_message_id: roi?.parent_message_id || parentMessageId || null,
          roi_kind: roi?.roi_kind || "legend",
          status: "waiting_model",
          text: "",
          confidence: 0,
          attempts: [],
          selected_attempt_id: "",
          technical_notes: ["OCR mode nao suportado no worker"],
          model_used: runtime.mode,
          latency_ms: Date.now() - t0,
          debug: null,
          error: "OCR mode nao suportado no worker",
        });
      }
    } catch (error) {
      results.push({
        roi_id: roiId,
        parent_message_id: roi?.parent_message_id || parentMessageId || null,
        roi_kind: roi?.roi_kind || "legend",
        status: "error",
        text: "",
        confidence: 0,
        attempts: [],
        selected_attempt_id: "",
        technical_notes: [String(error?.message || error)],
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
