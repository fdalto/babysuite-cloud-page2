const runtime = {
  mode: "stub",
  initialized: false,
  config: {},
  tesseract: {
    module: null,
    worker: null,
  },
  paddle: {
    initialized: false,
    ort: null,
    detSession: null,
    recSession: null,
    dictConfigs: [],
    decoder: null,
    substitutions: [],
    detInputName: "",
    recInputName: "",
  },
};
const MIN_FINAL_OCR_CONFIDENCE = 0.5;
const BASE_URL = "https://arquivos-cinebaby.duckdns.org";
const TOKEN = "tokenBaby123!";
const REC_MODEL_URL = `${BASE_URL}/rec.onnx?token=${TOKEN}`;
const DET_MODEL_URL = `${BASE_URL}/det.onnx?token=${TOKEN}`;
let modelCache = {};

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
    paddleScriptUrl: c.paddleScriptUrl || "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.min.js",
    paddleWasmPaths: c.paddleWasmPaths || "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/",
    paddleDetModelPath: c.paddleDetModelPath || DET_MODEL_URL,
    paddleRecModelPath: c.paddleRecModelPath || REC_MODEL_URL,
    paddleDictCandidates: Array.isArray(c.paddleDictCandidates) && c.paddleDictCandidates.length
      ? c.paddleDictCandidates
      : [
          "../../ocrpaddle/models/paddle/rec/ppocrv5_en_dict.txt",
          "../../ocrpaddle/models/paddle/rec/en_dict.txt",
          "../../ocrpaddle/models/paddle/rec/ppocr_keys_v1.txt",
        ],
    paddleSubstitutionsPath: c.paddleSubstitutionsPath || "../../ocrpaddle/ocr_substitutions.json",
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

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Falha ao carregar ${path}`);
  return response.text();
}

async function loadModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar modelo ONNX ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function getModel(url) {
  if (modelCache[url]) return modelCache[url];

  const buffer = await loadModel(url);
  modelCache[url] = buffer;
  return buffer;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function ensurePaddleRuntime() {
  if (runtime.paddle.initialized) return runtime.paddle;

  if (!self.ort) {
    self.importScripts(runtime.config.paddleScriptUrl);
  }
  if (!self.ort) {
    throw new Error("onnxruntime-web nao foi carregado no worker");
  }

  self.ort.env.wasm.wasmPaths = runtime.config.paddleWasmPaths;
  self.ort.env.wasm.numThreads = 1;

  const [detModel, recModel, substitutionsText, ...dictTexts] = await Promise.all([
    getModel(runtime.config.paddleDetModelPath),
    getModel(runtime.config.paddleRecModelPath),
    loadText(runtime.config.paddleSubstitutionsPath).catch(() => null),
    ...runtime.config.paddleDictCandidates.map((path) => loadText(path).catch(() => null)),
  ]);
  const [detSession, recSession] = await Promise.all([
    self.ort.InferenceSession.create(detModel, { executionProviders: ["wasm"] }),
    self.ort.InferenceSession.create(recModel, { executionProviders: ["wasm"] }),
  ]);

  runtime.paddle.ort = self.ort;
  runtime.paddle.detSession = detSession;
  runtime.paddle.recSession = recSession;
  runtime.paddle.dictConfigs = dictTexts
    .map((text, index) => {
      if (!text) return null;
      const chars = text.split(/\r?\n/);
      return {
        path: runtime.config.paddleDictCandidates[index],
        chars,
        containsSpace: chars.includes(" "),
      };
    })
    .filter(Boolean);
  runtime.paddle.decoder = null;
  runtime.paddle.substitutions = substitutionsText ? (JSON.parse(substitutionsText).replacements || []) : [];
  runtime.paddle.detInputName = detSession.inputNames[0];
  runtime.paddle.recInputName = recSession.inputNames[0];
  runtime.paddle.initialized = true;
  return runtime.paddle;
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

function rectFromBox(box) {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
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
  return [{ id: "A", label: "Teste A", psm: runtime.config.psm || "6", mode: "baseline" }];
}

function sanitizePsm(psmValue) {
  const psm = String(psmValue || "6");
  if (psm === "13") return "11";
  return psm;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const maxc = Math.max(rn, gn, bn);
  const minc = Math.min(rn, gn, bn);
  const d = maxc - minc;
  const s = maxc === 0 ? 0 : d / maxc;
  const v = maxc;
  return { s, v };
}

function rgbToHsvFull(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return [h / 2, s * 255, max * 255];
}

function inRange(h, s, v, lower, upper) {
  return h >= lower[0] && h <= upper[0] && s >= lower[1] && s <= upper[1] && v >= lower[2] && v <= upper[2];
}

async function createCanvasFromBlob(roiBlob) {
  const bitmap = await createImageBitmap(roiBlob);
  const canvas = new OffscreenCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, ctx };
}

function createCanvas(width, height) {
  return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
}

function bitmapToImageData(bitmap) {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function resizeImageData(imageData, targetWidth, targetHeight) {
  const srcCanvas = createCanvas(imageData.width, imageData.height);
  srcCanvas.getContext("2d").putImageData(imageData, 0, 0);
  const dstCanvas = createCanvas(targetWidth, targetHeight);
  const ctx = dstCanvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

function resizeToMultipleOf32(imageData, maxSideLen = 960) {
  const { width, height } = imageData;
  let ratio = 1.0;
  const maxSide = Math.max(width, height);
  if (maxSide > maxSideLen) ratio = maxSideLen / maxSide;

  const resizedW = Math.max(32, Math.round((width * ratio) / 32) * 32);
  const resizedH = Math.max(32, Math.round((height * ratio) / 32) * 32);
  const resized = resizeImageData(imageData, resizedW, resizedH);
  return { resized, ratioW: resizedW / width, ratioH: resizedH / height };
}

function imageDataToDetTensor(imageData) {
  const { resized, ratioW, ratioH } = resizeToMultipleOf32(imageData, 960);
  const floatData = new Float32Array(3 * resized.height * resized.width);
  const meanValues = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let y = 0; y < resized.height; y += 1) {
    for (let x = 0; x < resized.width; x += 1) {
      const idx = (y * resized.width + x) * 4;
      const r = resized.data[idx] / 255;
      const g = resized.data[idx + 1] / 255;
      const b = resized.data[idx + 2] / 255;
      const base = y * resized.width + x;
      floatData[base] = (r - meanValues[0]) / std[0];
      floatData[resized.width * resized.height + base] = (g - meanValues[1]) / std[1];
      floatData[2 * resized.width * resized.height + base] = (b - meanValues[2]) / std[2];
    }
  }

  return {
    tensor: new runtime.paddle.ort.Tensor("float32", floatData, [1, 3, resized.height, resized.width]),
    meta: {
      origW: imageData.width,
      origH: imageData.height,
      ratioW,
      ratioH,
    },
  };
}

function tensorToPredMap(tensor) {
  const dims = tensor.dims;
  const data = tensor.data;
  if (dims.length === 4) return { width: dims[3], height: dims[2], data: data.slice(0, dims[2] * dims[3]) };
  if (dims.length === 3) return { width: dims[2], height: dims[1], data: data.slice(0, dims[1] * dims[2]) };
  throw new Error(`Saida inesperada do detector: ${dims.join("x")}`);
}

function connectedComponentBoxes(predMap, binThresh = 0.3, boxThresh = 0.5, minSize = 3) {
  const { width, height, data } = predMap;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const boxes = [];

  for (let start = 0; start < data.length; start += 1) {
    if (visited[start] || data[start] <= binThresh) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let scoreSum = 0;
    let count = 0;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = (current / width) | 0;
      scoreSum += data[current];
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= data.length || visited[next] || data[next] <= binThresh) continue;
        const nx = next % width;
        const ny = (next / width) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (Math.min(boxW, boxH) < minSize) continue;
    const score = scoreSum / count;
    if (score < boxThresh) continue;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const expandedW = boxW * 1.2;
    const expandedH = boxH * 1.5;
    boxes.push({
      score,
      box: [
        [clamp(Math.round(cx - expandedW / 2), 0, width - 1), clamp(Math.round(cy - expandedH / 2), 0, height - 1)],
        [clamp(Math.round(cx + expandedW / 2), 0, width - 1), clamp(Math.round(cy - expandedH / 2), 0, height - 1)],
        [clamp(Math.round(cx + expandedW / 2), 0, width - 1), clamp(Math.round(cy + expandedH / 2), 0, height - 1)],
        [clamp(Math.round(cx - expandedW / 2), 0, width - 1), clamp(Math.round(cy + expandedH / 2), 0, height - 1)],
      ],
    });
  }

  return boxes;
}

function mapBoxesToOriginal(boxes, meta) {
  return boxes.map((item) => ({
    score: item.score,
    box: item.box.map(([x, y]) => [
      clamp(Math.round(x / meta.ratioW), 0, meta.origW - 1),
      clamp(Math.round(y / meta.ratioH), 0, meta.origH - 1),
    ]),
  }));
}

function boxesTouch(a, b, gapX = 0, gapY = 1) {
  return !(a.x2 + gapX < b.x1 || b.x2 + gapX < a.x1 || a.y2 + gapY < b.y1 || b.y2 + gapY < a.y1);
}

function mergeTouchingBoxes(boxes, gapX = 0, gapY = 1) {
  const rects = boxes.map((item) => ({ ...rectFromBox(item.box), score: item.score }));
  const visited = new Array(rects.length).fill(false);
  const merged = [];

  for (let i = 0; i < rects.length; i += 1) {
    if (visited[i]) continue;
    let rect = { ...rects[i] };
    let score = rects[i].score;
    const stack = [i];
    visited[i] = true;

    while (stack.length) {
      stack.pop();
      for (let j = 0; j < rects.length; j += 1) {
        if (visited[j] || !boxesTouch(rect, rects[j], gapX, gapY)) continue;
        visited[j] = true;
        stack.push(j);
        rect = {
          x1: Math.min(rect.x1, rects[j].x1),
          y1: Math.min(rect.y1, rects[j].y1),
          x2: Math.max(rect.x2, rects[j].x2),
          y2: Math.max(rect.y2, rects[j].y2),
        };
        score = Math.max(score, rects[j].score);
      }
    }

    merged.push({
      score,
      box: [
        [rect.x1, rect.y1],
        [rect.x2, rect.y1],
        [rect.x2, rect.y2],
        [rect.x1, rect.y2],
      ],
    });
  }

  return merged.sort((a, b) => {
    const ay = a.box.reduce((sum, point) => sum + point[1], 0) / 4;
    const by = b.box.reduce((sum, point) => sum + point[1], 0) / 4;
    return ay - by || a.box[0][0] - b.box[0][0];
  });
}

function cropImageData(imageData, box) {
  const rect = rectFromBox(box);
  const width = rect.x2 - rect.x1 + 1;
  const height = rect.y2 - rect.y1 + 1;
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIdx = ((rect.y1 + y) * imageData.width + (rect.x1 + x)) * 4;
      const dstIdx = (y * width + x) * 4;
      out.data[dstIdx] = imageData.data[srcIdx];
      out.data[dstIdx + 1] = imageData.data[srcIdx + 1];
      out.data[dstIdx + 2] = imageData.data[srcIdx + 2];
      out.data[dstIdx + 3] = imageData.data[srcIdx + 3];
    }
  }
  return out;
}

function ensureTightCrop(imageData) {
  const { width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const [h, s, v] = rgbToHsvFull(r, g, b);
      const yellow = inRange(h, s, v, [12, 70, 70], [42, 255, 255]);
      const orange = inRange(h, s, v, [6, 90, 90], [18, 255, 255]);
      const green = inRange(h, s, v, [43, 45, 55], [90, 255, 255]);
      const whiteGray = inRange(h, s, v, [0, 0, 120], [179, 55, 255]);
      const redA = inRange(h, s, v, [0, 70, 60], [8, 255, 255]);
      const redB = inRange(h, s, v, [170, 70, 60], [179, 255, 255]);
      mask[y * width + x] = (yellow || orange || green) && !(whiteGray || redA || redB) ? 1 : 0;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return imageData;

  const pad = 4;
  minX = clamp(minX - pad, 0, width - 1);
  minY = clamp(minY - pad, 0, height - 1);
  maxX = clamp(maxX + pad, 0, width - 1);
  maxY = clamp(maxY + pad, 0, height - 1);

  return cropImageData(imageData, [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]);
}

function imageDataToRecTensor(imageData) {
  const targetH = 48;
  const targetW = 320;
  const ratio = imageData.width / Math.max(1, imageData.height);
  const resizedW = clamp(Math.ceil(targetH * ratio), 1, targetW);
  const resized = resizeImageData(imageData, resizedW, targetH);
  const floatData = new Float32Array(3 * targetH * targetW);

  for (let y = 0; y < targetH; y += 1) {
    for (let x = 0; x < resizedW; x += 1) {
      const idx = (y * resized.width + x) * 4;
      const r = resized.data[idx] / 255;
      const g = resized.data[idx + 1] / 255;
      const b = resized.data[idx + 2] / 255;
      const base = y * targetW + x;
      floatData[base] = (r - 0.5) / 0.5;
      floatData[targetH * targetW + base] = (g - 0.5) / 0.5;
      floatData[2 * targetH * targetW + base] = (b - 0.5) / 0.5;
    }
  }

  return new runtime.paddle.ort.Tensor("float32", floatData, [1, 3, targetH, targetW]);
}

function chooseDecoderConfig(candidates, classCount) {
  if (!candidates.length) {
    throw new Error("Nenhum dicionario encontrado para o modelo de reconhecimento.");
  }
  if (classCount == null) {
    return { chars: candidates[0].chars, indexOverrides: {} };
  }

  const exact = candidates.find((c) => c.chars.length + 1 === classCount);
  if (exact) return { chars: exact.chars, indexOverrides: {} };

  const spaceAugmented = candidates.find((c) => !c.containsSpace && c.chars.length + 2 === classCount);
  if (spaceAugmented) {
    return { chars: [...spaceAugmented.chars, " "], indexOverrides: {} };
  }

  const fallback = [...candidates].sort(
    (a, b) => Math.abs(a.chars.length + 1 - classCount) - Math.abs(b.chars.length + 1 - classCount),
  )[0];
  const indexOverrides = classCount > 437 ? { 437: " " } : {};
  return { chars: fallback.chars, indexOverrides };
}

function ensurePaddleDecoder(state, recTensorOut) {
  if (!state.decoder) {
    const dims = recTensorOut.dims || [];
    const classCount = typeof dims[2] === "number" ? dims[2] : null;
    state.decoder = chooseDecoderConfig(state.dictConfigs, classCount);
  }
  return state.decoder;
}

function normalizeMeasurementText(text) {
  return String(text || "")
    .replace(/\|/g, "I")
    .replace(/,/g, ".")
    .replace(/cni\/s/g, "cm/s")
    .replace(/crn\/s/g, "cm/s")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeCTC(tensor, decoder) {
  const [batch, timeSteps, classes] = tensor.dims;
  const chars = ["blank", ...decoder.chars];
  const data = tensor.data;
  const results = [];
  for (let b = 0; b < batch; b += 1) {
    let lastIdx = null;
    const textParts = [];
    const probs = [];
    for (let t = 0; t < timeSteps; t += 1) {
      let bestIdx = 0;
      let bestProb = -Infinity;
      for (let c = 0; c < classes; c += 1) {
        const value = data[b * timeSteps * classes + t * classes + c];
        if (value > bestProb) {
          bestProb = value;
          bestIdx = c;
        }
      }
      if (bestIdx === 0) {
        lastIdx = bestIdx;
        continue;
      }
      if (lastIdx === bestIdx) continue;
      if (decoder.indexOverrides[bestIdx] != null) {
        textParts.push(decoder.indexOverrides[bestIdx]);
      } else if (bestIdx < chars.length) {
        textParts.push(chars[bestIdx]);
      } else {
        textParts.push(`[UNK${bestIdx}]`);
      }
      probs.push(bestProb);
      lastIdx = bestIdx;
    }
    results.push({
      text: normalizeMeasurementText(textParts.join("")),
      score: probs.length ? probs.reduce((sum, value) => sum + value, 0) / probs.length : 0,
    });
  }
  return results;
}

function buildLooseMatchRegex(match) {
  const escapedChars = [...match]
    .map((char) => char.replace(/[\^$.*+?()[\]{}|]/g, "\\$&"))
    .join("\\s*");
  return new RegExp(escapedChars, "gi");
}

function applySubstitutions(text, substitutions) {
  let output = String(text || "");
  const ordered = [...(substitutions || [])].sort((a, b) => (b?.match || "").length - (a?.match || "").length);
  for (const rule of ordered) {
    if (!rule?.match) continue;
    output = output.replace(buildLooseMatchRegex(rule.match), rule.replace || "");
  }
  return output.replace(/\s+/g, " ").trim();
}

function buildPlainTextBlock(detections) {
  const segments = detections
    .filter((item) => item.recognizedText)
    .map((item) => {
      const rect = rectFromBox(item.box);
      return {
        text: item.recognizedText,
        x1: rect.x1,
        y1: rect.y1,
        y2: rect.y2,
        yCenter: (rect.y1 + rect.y2) / 2,
      };
    })
    .sort((a, b) => a.yCenter - b.yCenter || a.x1 - b.x1);

  if (!segments.length) return "";

  const rows = [];
  let currentRow = [];
  let currentTop = null;
  let currentBottom = null;
  const tolerance = 4;
  for (const segment of segments) {
    if (currentTop == null || (segment.y1 <= currentBottom + tolerance && segment.y2 >= currentTop - tolerance)) {
      currentRow.push(segment);
      currentTop = currentTop == null ? segment.y1 : Math.min(currentTop, segment.y1);
      currentBottom = currentBottom == null ? segment.y2 : Math.max(currentBottom, segment.y2);
    } else {
      rows.push(currentRow.sort((a, b) => a.x1 - b.x1));
      currentRow = [segment];
      currentTop = segment.y1;
      currentBottom = segment.y2;
    }
  }
  if (currentRow.length) rows.push(currentRow.sort((a, b) => a.x1 - b.x1));

  rows.sort((a, b) => mean(a.map((x) => x.yCenter)) - mean(b.map((x) => x.yCenter)));
  return rows
    .map((row) => row.map((item) => item.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function blobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    return bitmapToImageData(bitmap);
  } finally {
    bitmap.close();
  }
}

async function inferPaddle(roiBlob) {
  const paddle = await ensurePaddleRuntime();
  const imageData = await blobToImageData(roiBlob);
  const { tensor, meta } = imageDataToDetTensor(imageData);
  const detOutputs = await paddle.detSession.run({ [paddle.detInputName]: tensor });
  const predTensor = detOutputs[paddle.detSession.outputNames[0]];
  const predMap = tensorToPredMap(predTensor);
  const rawBoxes = connectedComponentBoxes(predMap);
  const mappedBoxes = mapBoxesToOriginal(rawBoxes, meta);
  const mergedBoxes = mergeTouchingBoxes(mappedBoxes, 0, 1);

  const detections = [];
  for (let i = 0; i < mergedBoxes.length; i += 1) {
    const crop = cropImageData(imageData, mergedBoxes[i].box);
    const tight = ensureTightCrop(crop);
    const recTensor = imageDataToRecTensor(tight);
    const recOutputs = await paddle.recSession.run({ [paddle.recInputName]: recTensor });
    const recTensorOut = recOutputs[paddle.recSession.outputNames[0]];
    const decoder = ensurePaddleDecoder(paddle, recTensorOut);
    const decoded = decodeCTC(recTensorOut, decoder)[0];
    const substitutedText = applySubstitutions(decoded?.text || "", paddle.substitutions);
    detections.push({
      index: i,
      score: mergedBoxes[i].score,
      box: mergedBoxes[i].box,
      recognizedText: substitutedText,
      recognizedScore: Number(decoded?.score || 0),
    });
  }

  const finalText = buildPlainTextBlock(detections);
  const bestScore = detections.reduce((max, item) => Math.max(max, Number(item.recognizedScore || 0)), 0);
  return {
    text: finalText,
    confidence: bestScore,
    attempts: [
      {
        id: "P-ROI",
        label: "Paddle ROI original",
        text: finalText,
        confidence: bestScore,
        psm: "-",
        preprocess: "paddle_det+rec",
        applied_parameters_summary: `det=${rawBoxes.length} bruto(s) | merge=${mergedBoxes.length}`,
        fallback_notes: [],
      },
    ],
    selected_attempt_id: "P-ROI",
    technical_notes: [`deteccoes: ${detections.length}`],
    debug: {
      detections,
      raw_box_count: rawBoxes.length,
      merged_box_count: mergedBoxes.length,
    },
  };
}

function buildBinaryFromSaturation(ctx, w, h, saturationThreshold) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const satNormThreshold = Math.max(0, Math.min(255, Number(saturationThreshold || 56))) / 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const { s, v } = rgbToHsv(r, g, b);
    const keep = s >= satNormThreshold && v > 0.12;
    const value = keep ? 255 : 0;
    d[i] = value;
    d[i + 1] = value;
    d[i + 2] = value;
    d[i + 3] = 255;
  }
  return img;
}

function applyBoxBlur3x3(binaryImageData, w, h) {
  const src = binaryImageData.data;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const idx = (ny * w + nx) * 4;
          sum += src[idx];
          count += 1;
        }
      }
      const avg = count ? (sum / count) : 0;
      const rebinarized = avg >= 110 ? 255 : 0;
      const outIdx = (y * w + x) * 4;
      out[outIdx] = rebinarized;
      out[outIdx + 1] = rebinarized;
      out[outIdx + 2] = rebinarized;
      out[outIdx + 3] = 255;
    }
  }
  return new ImageData(out, w, h);
}

function invertImageData(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
    d[i + 3] = 255;
  }
  return imageData;
}

async function preprocess_saturation(roiBlob, options = {}) {
  const { canvas, ctx } = await createCanvasFromBlob(roiBlob);
  const w = canvas.width;
  const h = canvas.height;
  const binary = buildBinaryFromSaturation(ctx, w, h, options.saturation_threshold);
  ctx.putImageData(binary, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function preprocess_saturation_blur(roiBlob, options = {}) {
  const { canvas, ctx } = await createCanvasFromBlob(roiBlob);
  const w = canvas.width;
  const h = canvas.height;
  const binary = buildBinaryFromSaturation(ctx, w, h, options.saturation_threshold);
  const blurredBinary = applyBoxBlur3x3(binary, w, h);
  ctx.putImageData(blurredBinary, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function preprocess_saturation_invert(roiBlob, options = {}) {
  const { canvas, ctx } = await createCanvasFromBlob(roiBlob);
  const w = canvas.width;
  const h = canvas.height;
  const binary = buildBinaryFromSaturation(ctx, w, h, options.saturation_threshold);
  const inverted = invertImageData(binary);
  ctx.putImageData(inverted, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function preprocessBlobForAttempt(roiBlob, attempt, roi) {
  const mode = String(attempt?.preprocess || "original");
  const options = roi?.preprocess_options || {};
  if (mode === "saturation") return preprocess_saturation(roiBlob, options);
  if (mode === "saturation_blur") return preprocess_saturation_blur(roiBlob, options);
  if (mode === "saturation_invert") return preprocess_saturation_invert(roiBlob, options);
  return roiBlob;
}

function buildAttemptParameters(attempt) {
  const params = {
    tessedit_pageseg_mode: sanitizePsm(attempt?.psm || runtime.config.psm || "6"),
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

    const preparedBlob = await preprocessBlobForAttempt(roiBlob, attempt, roi);
    const rec = await runtime.tesseract.worker.recognize(preparedBlob);
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
      psm: String(params.tessedit_pageseg_mode || attempt?.psm || ""),
      whitelist: String(attempt?.whitelist || ""),
      preprocess: String(attempt?.preprocess || "original"),
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
      const requestedEngine = String(roi?.ocr_engine || "").trim().toLowerCase();
      const usePaddle = requestedEngine === "paddle";
      if (usePaddle || runtime.mode === "tesseract") {
        const decoded = usePaddle
          ? await inferPaddle(roi.image_blob, roi)
          : await inferTesseract(roi.image_blob, roi);
        const confidence = Number(decoded.confidence || 0);
        const accepted = usePaddle || confidence >= MIN_FINAL_OCR_CONFIDENCE;
        const technicalNotes = Array.isArray(decoded.technical_notes) ? decoded.technical_notes.slice() : [];
        if (!accepted) {
          technicalNotes.push(`descartado: conf final ${(confidence * 100).toFixed(1)}% < ${(MIN_FINAL_OCR_CONFIDENCE * 100).toFixed(0)}%`);
        }
        results.push({
          roi_id: roiId,
          parent_message_id: roi?.parent_message_id || parentMessageId || null,
          roi_kind: roi?.roi_kind || "legend",
          status: "done",
          text: accepted ? decoded.text : "",
          confidence,
          attempts: decoded.attempts,
          selected_attempt_id: decoded.selected_attempt_id,
          technical_notes: technicalNotes,
          model_used: usePaddle ? "paddle-ocr-browser" : (runtime.config.modelTag || "tesseract"),
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
