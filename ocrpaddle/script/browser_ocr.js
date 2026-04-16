import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.min.mjs";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
ort.env.wasm.numThreads = 1;

const fileInput = document.querySelector("#fileInput");
const sampleSelect = document.querySelector("#sampleSelect");
const runButton = document.querySelector("#runBrowserButton");
const statusEl = document.querySelector("#browserStatus");
const statsEl = document.querySelector("#browserStats");
const plainTextEl = document.querySelector("#browserPlainText");
const structuredEl = document.querySelector("#browserStructured");
const stepsEl = document.querySelector("#browserSteps");
const detectionsEl = document.querySelector("#browserDetections");
const stepTemplate = document.querySelector("#browserStepCardTemplate");
const detectionTemplate = document.querySelector("#browserDetectionTemplate");

const BASE_URL = "https://arquivos-cinebaby.duckdns.org";
const TOKEN = "tokenBaby123!";
const REC_MODEL_URL = `${BASE_URL}/rec.onnx?token=${TOKEN}`;
const DET_MODEL_URL = `${BASE_URL}/det.onnx?token=${TOKEN}`;
const DICT_CANDIDATES = [
  "models/paddle/rec/ppocrv5_en_dict.txt",
  "models/paddle/rec/en_dict.txt",
  "models/paddle/rec/ppocr_keys_v1.txt",
];
const SUBSTITUTIONS_PATH = "ocr_substitutions.json";

let sessionsPromise = null;
let modelCache = {};

window.addEventListener("error", (event) => {
  try {
    setStatus(`Erro de runtime: ${event.message}`, true);
  } catch {}
});

window.addEventListener("unhandledrejection", (event) => {
  try {
    const reason = event.reason?.message || String(event.reason);
    setStatus(`Promise rejeitada: ${reason}`, true);
  } catch {}
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setBusy(isBusy) {
  runButton.disabled = isBusy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

async function createSessions() {
  const [detModel, recModel, substitutionsText, ...dictTexts] = await Promise.all([
    getModel(DET_MODEL_URL),
    getModel(REC_MODEL_URL),
    loadText(SUBSTITUTIONS_PATH).catch(() => null),
    ...DICT_CANDIDATES.map((path) => loadText(path).catch(() => null)),
  ]);
  const [detSession, recSession] = await Promise.all([
    ort.InferenceSession.create(detModel, { executionProviders: ["wasm"] }),
    ort.InferenceSession.create(recModel, { executionProviders: ["wasm"] }),
  ]);

  const dictConfigs = dictTexts
    .map((text, index) => {
      if (!text) return null;
      const chars = text.split(/\r?\n/);
      return {
        path: DICT_CANDIDATES[index],
        chars,
        containsSpace: chars.includes(" "),
      };
    })
    .filter(Boolean);

  return {
    detSession,
    recSession,
    dictConfigs,
    decoder: null,
    substitutions: substitutionsText ? JSON.parse(substitutionsText).replacements || [] : [],
    detInputName: detSession.inputNames[0],
    recInputName: recSession.inputNames[0],
  };
}

function chooseDecoderConfig(candidates, classCount) {
  if (!candidates.length) {
    throw new Error("Nenhum dicionário encontrado para o modelo de reconhecimento.");
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

function ensureDecoder(sessionState, recTensorOut) {
  if (!sessionState.decoder) {
    const dims = recTensorOut.dims || [];
    const classCount = typeof dims[2] === "number" ? dims[2] : null;
    sessionState.decoder = chooseDecoderConfig(sessionState.dictConfigs, classCount);
  }
  return sessionState.decoder;
}

function getSessions() {
  if (!sessionsPromise) sessionsPromise = createSessions();
  return sessionsPromise;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadSelectedImage() {
  if (fileInput.files?.[0]) {
    const bitmap = await createImageBitmap(fileInput.files[0]);
    return { bitmap, name: fileInput.files[0].name };
  }
  if (sampleSelect.value) {
    const response = await fetch(sampleSelect.value);
    if (!response.ok) throw new Error(`Falha ao carregar ${sampleSelect.value}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { bitmap, name: sampleSelect.value.split("/").pop() };
  }
  throw new Error("Selecione uma imagem local ou uma amostra.");
}

function bitmapToImageData(bitmap) {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function imageDataToDataUrl(imageData) {
  const canvas = createCanvas(imageData.width, imageData.height);
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
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
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let y = 0; y < resized.height; y++) {
    for (let x = 0; x < resized.width; x++) {
      const idx = (y * resized.width + x) * 4;
      const r = resized.data[idx] / 255;
      const g = resized.data[idx + 1] / 255;
      const b = resized.data[idx + 2] / 255;
      const base = y * resized.width + x;
      floatData[base] = (r - mean[0]) / std[0];
      floatData[resized.width * resized.height + base] = (g - mean[1]) / std[1];
      floatData[2 * resized.width * resized.height + base] = (b - mean[2]) / std[2];
    }
  }

  return {
    tensor: new ort.Tensor("float32", floatData, [1, 3, resized.height, resized.width]),
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
  throw new Error(`Saída inesperada do detector: ${dims.join("x")}`);
}

function connectedComponentBoxes(predMap, binThresh = 0.3, boxThresh = 0.5, minSize = 3) {
  const { width, height, data } = predMap;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const boxes = [];

  for (let start = 0; start < data.length; start++) {
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

function rectFromBox(box) {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function mapBoxesToOriginal(boxes, meta) {
  return boxes.map((item) => ({
    score: item.score,
    box: item.box.map(([x, y]) => [clamp(Math.round(x / meta.ratioW), 0, meta.origW - 1), clamp(Math.round(y / meta.ratioH), 0, meta.origH - 1)]),
  }));
}

function boxesTouch(a, b, gapX = 0, gapY = 1) {
  return !(a.x2 + gapX < b.x1 || b.x2 + gapX < a.x1 || a.y2 + gapY < b.y1 || b.y2 + gapY < a.y1);
}

function mergeTouchingBoxes(boxes, gapX = 0, gapY = 1) {
  const rects = boxes.map((item) => ({ ...rectFromBox(item.box), score: item.score }));
  const visited = new Array(rects.length).fill(false);
  const merged = [];

  for (let i = 0; i < rects.length; i++) {
    if (visited[i]) continue;
    let rect = { ...rects[i] };
    let score = rects[i].score;
    const stack = [i];
    visited[i] = true;

    while (stack.length) {
      stack.pop();
      for (let j = 0; j < rects.length; j++) {
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

function drawBoxes(imageData, boxes) {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (const item of boxes) {
    const rect = rectFromBox(item.box);
    for (let x = rect.x1; x <= rect.x2; x++) {
      setPixel(out.data, out.width, x, rect.y1, 0, 255, 0);
      setPixel(out.data, out.width, x, rect.y2, 0, 255, 0);
    }
    for (let y = rect.y1; y <= rect.y2; y++) {
      setPixel(out.data, out.width, rect.x1, y, 0, 255, 0);
      setPixel(out.data, out.width, rect.x2, y, 0, 255, 0);
    }
  }
  return out;
}

function setPixel(target, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0) return;
  const idx = (y * width + x) * 4;
  if (idx < 0 || idx + 3 >= target.length) return;
  target[idx] = r;
  target[idx + 1] = g;
  target[idx + 2] = b;
  target[idx + 3] = a;
}

function predMapStats(predMap) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of predMap.data) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return {
    min,
    max,
    mean: predMap.data.length ? sum / predMap.data.length : 0,
  };
}
function predMapToImageData(predMap) {
  const { width, height, data } = predMap;
  let min = Infinity;
  let max = -Infinity;
  for (const value of data) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    const value = max > min ? (data[i] - min) / (max - min) : 0;
    const v = Math.round(value * 255);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = Math.round(v * 0.7);
    rgba[i * 4 + 2] = 255 - v;
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function binaryMaskToImageData(predMap, threshold = 0.3) {
  const { width, height, data } = predMap;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] > threshold ? 255 : 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function buildLineBands(maskImageData, minInkPerRow = 2, minLineHeight = 10, minValleyHeight = 3) {
  const rowInk = new Array(maskImageData.height).fill(0);
  for (let y = 0; y < maskImageData.height; y++) {
    let count = 0;
    for (let x = 0; x < maskImageData.width; x++) {
      const idx = (y * maskImageData.width + x) * 4;
      if (maskImageData.data[idx] > 0) count += 1;
    }
    rowInk[y] = count;
  }

  const smoothed = rowInk.map((_, y) => {
    let sum = 0;
    let count = 0;
    for (let k = -1; k <= 1; k++) {
      const yy = y + k;
      if (yy < 0 || yy >= rowInk.length) continue;
      sum += rowInk[yy];
      count += 1;
    }
    return count ? sum / count : 0;
  });

  const textRows = smoothed.map((value) => value >= minInkPerRow);
  const bands = [];
  let start = null;
  let valley = 0;

  for (let y = 0; y < textRows.length; y++) {
    if (textRows[y]) {
      if (start == null) start = y;
      valley = 0;
    } else if (start != null) {
      valley += 1;
      if (valley >= minValleyHeight) {
        const end = y - valley;
        if (end - start + 1 >= minLineHeight) bands.push({ y1: start, y2: end });
        start = null;
        valley = 0;
      }
    }
  }

  if (start != null) {
    const end = textRows.length - 1;
    if (end - start + 1 >= minLineHeight) bands.push({ y1: start, y2: end });
  }

  return bands;
}

function expandBox(box, padX, padY, width, height) {
  const expanded = box.map(([x, y]) => [x, y]);
  expanded[0][1] = clamp(expanded[0][1] - padY, 0, height - 1);
  expanded[1][1] = clamp(expanded[1][1] - padY, 0, height - 1);
  expanded[2][1] = clamp(expanded[2][1] + padY, 0, height - 1);
  expanded[3][1] = clamp(expanded[3][1] + padY, 0, height - 1);
  return expanded;
}

function cropImageData(imageData, box) {
  const rect = rectFromBox(box);
  const width = rect.x2 - rect.x1 + 1;
  const height = rect.y2 - rect.y1 + 1;
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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

function rgbToHsv(r, g, b) {
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

function dilateMask(mask, width, height, size) {
  const out = new Uint8Array(mask.length);
  const radius = size - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let ky = 0; ky <= radius && !on; ky++) {
        for (let kx = 0; kx <= radius; kx++) {
          const nx = x + kx - radius;
          const ny = y + ky - radius;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function erodeMask(mask, width, height, size) {
  const out = new Uint8Array(mask.length);
  const radius = size - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 1;
      for (let ky = 0; ky <= radius && on; ky++) {
        for (let kx = 0; kx <= radius; kx++) {
          const nx = x + kx - radius;
          const ny = y + ky - radius;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            on = 0;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function ensureTightCrop(imageData) {
  const { width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const [h, s, v] = rgbToHsv(r, g, b);
      const yellow = inRange(h, s, v, [12, 70, 70], [42, 255, 255]);
      const orange = inRange(h, s, v, [6, 90, 90], [18, 255, 255]);
      const green = inRange(h, s, v, [43, 45, 55], [90, 255, 255]);
      const whiteGray = inRange(h, s, v, [0, 0, 120], [179, 55, 255]);
      const redA = inRange(h, s, v, [0, 70, 60], [8, 255, 255]);
      const redB = inRange(h, s, v, [170, 70, 60], [179, 255, 255]);
      mask[y * width + x] = (yellow || orange || green) && !(whiteGray || redA || redB) ? 1 : 0;
    }
  }

  const closed = erodeMask(dilateMask(mask, width, height, 2), width, height, 2);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!closed[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return { tight: imageData, preview: imageData };

  const pad = 4;
  minX = clamp(minX - pad, 0, width - 1);
  minY = clamp(minY - pad, 0, height - 1);
  maxX = clamp(maxX + pad, 0, width - 1);
  maxY = clamp(maxY + pad, 0, height - 1);

  const cropped = cropImageData(imageData, [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]);
  const preview = new ImageData(cropped.width, cropped.height);
  for (let y = 0; y < cropped.height; y++) {
    for (let x = 0; x < cropped.width; x++) {
      const idx = (y * cropped.width + x) * 4;
      const r = cropped.data[idx];
      const g = cropped.data[idx + 1];
      const b = cropped.data[idx + 2];
      const [h, s, v] = rgbToHsv(r, g, b);
      const isText =
        (inRange(h, s, v, [12, 70, 70], [42, 255, 255]) || inRange(h, s, v, [6, 90, 90], [18, 255, 255]) || inRange(h, s, v, [43, 45, 55], [90, 255, 255])) &&
        !inRange(h, s, v, [0, 0, 120], [179, 55, 255]);
      preview.data[idx] = isText ? 255 : 8;
      preview.data[idx + 1] = isText ? 220 : 8;
      preview.data[idx + 2] = isText ? 0 : 8;
      preview.data[idx + 3] = 255;
    }
  }
  return { tight: cropped, preview };
}

function imageDataToRecTensor(imageData) {
  const targetH = 48;
  const targetW = 320;
  const ratio = imageData.width / Math.max(1, imageData.height);
  const resizedW = clamp(Math.ceil(targetH * ratio), 1, targetW);
  const resized = resizeImageData(imageData, resizedW, targetH);
  const floatData = new Float32Array(3 * targetH * targetW);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < resizedW; x++) {
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
  return new ort.Tensor("float32", floatData, [1, 3, targetH, targetW]);
}

function decodeCTC(tensor, decoder) {
  const [batch, timeSteps, classes] = tensor.dims;
  const chars = ["blank", ...decoder.chars];
  const data = tensor.data;
  const results = [];
  for (let b = 0; b < batch; b++) {
    let lastIdx = null;
    const textParts = [];
    const tokenParts = [];
    const probs = [];
    for (let t = 0; t < timeSteps; t++) {
      let bestIdx = 0;
      let bestProb = -Infinity;
      for (let c = 0; c < classes; c++) {
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
        tokenParts.push(`[${bestIdx}:${decoder.indexOverrides[bestIdx]}]`);
      } else if (bestIdx < chars.length) {
        textParts.push(chars[bestIdx]);
        tokenParts.push(`[${bestIdx}]`);
      } else {
        textParts.push(`[UNK${bestIdx}]`);
        tokenParts.push(`[${bestIdx}]`);
      }
      probs.push(bestProb);
      lastIdx = bestIdx;
    }
    results.push({ text: normalizeMeasurementText(textParts.join("")), tokens: tokenParts.join(""), score: probs.length ? probs.reduce((sum, value) => sum + value, 0) / probs.length : 0 });
  }
  return results;
}

function normalizeMeasurementText(text) {
  return text.replace(/\|/g, "I").replace(/,/g, ".").replace(/cni\/s/g, "cm/s").replace(/crn\/s/g, "cm/s").replace(/\s+/g, " ").trim();
}

function buildLooseMatchRegex(match) {
  const escapedChars = [...match]
    .map((char) => char.replace(/[\^$.*+?()[\]{}|]/g, "\$&"))
    .join("\s*");
  return new RegExp(escapedChars, "gi");
}

function applySubstitutions(text, substitutions) {

  let output = text;
  const ordered = [...(substitutions || [])].sort((a, b) => (b?.match || "").length - (a?.match || "").length);
  for (const rule of ordered) {
    if (!rule?.match) continue;
    output = output.replace(buildLooseMatchRegex(rule.match), rule.replace || "");
  }
  return output.replace(/\s+/g, " ").trim();
}

function parseMeasurementText(text) {
  const normalized = normalizeMeasurementText(text);
  if (!normalized) return null;
  let match = normalized.replace(/\s+/g, "").match(/^([A-Za-z0-9/]+)([-:]?)(-?[0-9]+(?:\.[0-9]+)?)([A-Za-z/%]+)?$/);
  if (match) return { label: match[1], value: match[3], unit: match[4] || "", raw: normalized };
  match = normalized.match(/^([A-Za-z0-9/ ]+?)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*([A-Za-z/%]+)?$/);
  if (match) return { label: match[1].trim(), value: match[2], unit: match[3] || "", raw: normalized };
  return null;
}

function buildPlainTextBlock(detections, lineBands = null) {
  const segments = detections.filter((item) => item.recognizedText).map((item) => {
    const rect = rectFromBox(item.box);
    return { text: item.recognizedText, parsed: item.parsed, x1: rect.x1, x2: rect.x2, y1: rect.y1, y2: rect.y2, yCenter: (rect.y1 + rect.y2) / 2 };
  }).sort((a, b) => a.yCenter - b.yCenter || a.x1 - b.x1);
  if (!segments.length) return "";

  let rows = [];
  if (lineBands?.length) {
    rows = lineBands
      .map((band) => segments.filter((segment) => segment.yCenter >= band.y1 && segment.yCenter <= band.y2).sort((a, b) => a.x1 - b.x1))
      .filter((row) => row.length > 0);
  }

  if (!rows.length) {
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
  }

  rows.sort((a, b) => mean(a.map((x) => x.yCenter)) - mean(b.map((x) => x.yCenter)));

  let header = null;
  if (rows[0]?.[0] && ["1", "2", "3"].includes(rows[0][0].text)) {
    header = "Medidas:";
    rows[0] = rows[0].slice(1);
    if (!rows[0].length) rows.shift();
  }

  const useRawLineOrder = Array.isArray(lineBands) && lineBands.length > 0;

  if (useRawLineOrder) {
    const lines = [];
    if (header) lines.push(header);
    for (const row of rows) {
      const rowText = row.map((item) => item.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (rowText) lines.push(rowText);
    }
    return lines.join("\n");
  }

  const normalizedRows = rows.map((row) => {
    const labels = row.filter((segment) => !/^-?\d/.test(segment.text.replace(/\s+/g, "")));
    const values = row.filter((segment) => /^-?\d/.test(segment.text.replace(/\s+/g, "")));
    const left = labels.map((item) => item.text).join(" ").trim();
    const right = values.map((item) => item.text).join(" ").trim();
    if (!left && row[0]?.parsed) return [row[0].parsed.label, `${row[0].parsed.value} ${row[0].parsed.unit}`.trim()];
    return [left, right];
  });

  const leftWidth = Math.max(...normalizedRows.map(([left]) => left.length), 0) + 4;
  const lines = [];
  if (header) lines.push(header);
  for (const [left, right] of normalizedRows) {
    if (!left && !right) continue;
    lines.push(right ? `${left.padEnd(leftWidth, " ")}${right}` : left);
  }
  return lines.join("\n");
}

function renderStats(stats) {
  statsEl.innerHTML = "";
  const items = [
    `boxes brutos: ${stats.rawBoxCount}`,
    `boxes fundidos: ${stats.mergedBoxCount}`,
    `pred min: ${stats.predMin.toFixed(6)}`,
    `pred max: ${stats.predMax.toFixed(6)}`,
    `pred mean: ${stats.predMean.toFixed(6)}`,
  ];
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "stat-chip";
    chip.textContent = item;
    statsEl.append(chip);
  }
}

function renderStructured(items) {
  structuredEl.innerHTML = "";
  structuredEl.classList.toggle("empty", items.length === 0);
  if (!items.length) {
    structuredEl.textContent = "Nenhuma medida parseada automaticamente.";
    return;
  }
  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = "measure-chip";
    chip.textContent = `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`;
    structuredEl.append(chip);
  }
}

function renderSteps(steps) {
  stepsEl.innerHTML = "";
  for (const step of steps) {
    const node = stepTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = step.title;
    const img = node.querySelector("img");
    img.src = step.image;
    img.alt = step.title;
    stepsEl.append(node);
  }
}

function appendImageBlock(container, title, src) {
  const wrapper = document.createElement("div");
  const caption = document.createElement("p");
  caption.className = "image-caption";
  caption.textContent = title;
  const img = document.createElement("img");
  img.src = src;
  img.alt = title;
  wrapper.append(caption, img);
  container.append(wrapper);
}

function renderDetections(detections) {
  detectionsEl.innerHTML = "";
  for (const detection of detections) {
    const node = detectionTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = `Detecção ${detection.index}`;
    node.querySelector(".pill").textContent = `score det ${detection.score.toFixed(4)}`;
    const imageStack = node.querySelector(".image-stack");
    appendImageBlock(imageStack, "Crop", detection.cropImage);
    appendImageBlock(imageStack, "Tight", detection.tightPreview);

    const summary = node.querySelector(".recognition-summary");
    const primary = document.createElement("div");
    primary.className = "summary-box";
    primary.innerHTML = `
      <strong>OCR</strong>
      <div>Texto: ${detection.recognizedText || "(vazio)"}</div>
      <div>Score: ${detection.recognizedScore.toFixed(4)}</div>
      <div>Modo: paddle</div>
      <div>Variante: tight</div>
    `;
    summary.append(primary);

    const parsed = document.createElement("div");
    parsed.className = "summary-box";
    if (detection.parsed) {
      parsed.innerHTML = `
        <strong>Parse</strong>
        <div>Label: ${detection.parsed.label}</div>
        <div>Valor: ${detection.parsed.value}${detection.parsed.unit ? ` ${detection.parsed.unit}` : ""}</div>
        <div>Raw: ${detection.parsed.raw}</div>
      `;
    } else {
      parsed.innerHTML = "<strong>Parse</strong><div>Sem parse automático.</div>";
    }
    summary.append(parsed);

    const tbody = node.querySelector("tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>tight</td>
      <td>paddle</td>
      <td>${detection.recognizedText || "(vazio)"}</td>
      <td>${detection.recognizedScore.toFixed(4)}</td>
    `;
    tbody.append(tr);
    detectionsEl.append(node);
  }
}

async function processInBrowser() {
  setBusy(true);
  setStatus("Carregando modelos...");
  try {
    const [{ bitmap, name }, sessions] = await Promise.all([loadSelectedImage(), getSessions()]);
    setStatus(`Processando ${name} no navegador...`);

    const imageData = bitmapToImageData(bitmap);
    const { tensor, meta } = imageDataToDetTensor(imageData);
    const detOutputs = await sessions.detSession.run({ [sessions.detInputName]: tensor });
    const predTensor = detOutputs[sessions.detSession.outputNames[0]];
    const predMap = tensorToPredMap(predTensor);
    const rawBoxes = connectedComponentBoxes(predMap);
    const mappedBoxes = mapBoxesToOriginal(rawBoxes, meta);
    const mergedBoxes = mergeTouchingBoxes(mappedBoxes, 0, 1);
    const overlay = drawBoxes(imageData, mergedBoxes);
    const lineMask = resizeImageData(binaryMaskToImageData(predMap), imageData.width, imageData.height);
    const lineBands = buildLineBands(lineMask, 2, 10, 3);

    const detections = [];
    for (let i = 0; i < mergedBoxes.length; i++) {
      const expandedBox = expandBox(mergedBoxes[i].box, 2, 5, imageData.width, imageData.height);
      const crop = cropImageData(imageData, expandedBox);
      const { tight, preview } = ensureTightCrop(crop);
      const recTensor = imageDataToRecTensor(tight);
      const recOutputs = await sessions.recSession.run({ [sessions.recInputName]: recTensor });
      const recTensorOut = recOutputs[sessions.recSession.outputNames[0]];
      const decoder = ensureDecoder(sessions, recTensorOut);
      const decoded = decodeCTC(recTensorOut, decoder)[0];
      const substitutedText = applySubstitutions(decoded.text, sessions.substitutions);
      detections.push({
        index: i,
        score: mergedBoxes[i].score,
        box: mergedBoxes[i].box,
        cropBox: expandedBox,
        cropImage: imageDataToDataUrl(crop),
        tightPreview: imageDataToDataUrl(preview),
        recognizedText: substitutedText,
        recognizedScore: decoded.score,
        parsed: parseMeasurementText(substitutedText),
      });
    }

    plainTextEl.textContent = buildPlainTextBlock(detections, lineBands) || "Nenhum bloco de texto gerado.";
    renderStructured(detections.map((item) => item.parsed).filter(Boolean));
    const stats = predMapStats(predMap);
    renderStats({
      rawBoxCount: rawBoxes.length,
      mergedBoxCount: mergedBoxes.length,
      predMin: stats.min,
      predMax: stats.max,
      predMean: stats.mean,
    });
    renderSteps([
      { title: "Original", image: imageDataToDataUrl(imageData) },
      { title: "Mapa do detector", image: imageDataToDataUrl(resizeImageData(predMapToImageData(predMap), imageData.width, imageData.height)) },
      { title: "Máscara binária", image: imageDataToDataUrl(lineMask) },
      { title: "Boxes", image: imageDataToDataUrl(overlay) },
    ]);
    renderDetections(detections);
    setStatus(`Concluído em browser-only para ${name}.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

runButton.addEventListener("click", processInBrowser);











