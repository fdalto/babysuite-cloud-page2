// =========================
// VARIÁVEIS INICIAIS
// =========================
let NomeFrases = ["Derrame", "Artrose", "Sinovite", "Ruptura Parcial"];
let PlavrasModificadoras = ["Direito", "Esquerdo", "medindo", "supraespinal", "infraespinal"];
let modelos = [];

let activeLineIndex = -1; // linha ativa no PROMPT (0-based)
let lastPromptSelection = { start: 0, end: 0 };
const MODELO_GROUPS = [
  "Ginecologia Obstetrícia",
  "Vascular",
  "Músculo",
  "Medicina Interna"
];

// Relatório normal (HTML) inicial: US Partes Moles (Arial 12)
let RelatorioNormal = `
<div style="font-family: Arial; font-size: 12pt;">
  <div style="text-align:center;"><b>ULTRASSONOGRAFIA DE PARTES MOLES</b></div>
  <br/>
  <b>TÉCNICA:</b><br/>
  Exame realizado com transdutor linear de alta frequência, com avaliação em planos ortogonais.
  <br/><br/>
  <b>ACHADOS:</b><br/>
  - Planos cutâneo e subcutâneo com espessura e ecotextura preservadas.<br/>
  - Ausência de coleções, massas sólidas ou sinais de processo inflamatório significativo.<br/>
  - Estruturas musculares avaliadas sem roturas evidentes.<br/>
  <br/>
  <b>CONCLUSÃO:</b><br/>
  Exame sem alterações significativas no segmento avaliado.
</div>
`;



// Frases do Modelo (HTML em texto, exibido no campo (4))
let FrasesdoModelo = `
<div style="font-family: Arial; font-size: 10pt;">
  <b>Abaixo estão as instruções para realizar substituição de frases no laudo:</b><br/>
  1. <b>acromioclavicular</b>: Irregularidade das superfícies articulares e osteófitos marginais na articulação acromioclavicular, compatível com alterações degenerativas.<br/>
  2. <b>derrame</b>: Presença de distensão líquida na articulação glenoumeral e na bainha da cabeça longa do bíceps.<br/>
  3. <b>bursite</b>: Distensão líquida e espessamento da bursa subacromial-subdeltóidea, compatível com bursite.<br/>
  4. <b>tendinopatia supraespinal</b>: Espessamento e hipoecogenicidade do tendão supraespinal na região insercional, com perda do padrão fibrilar habitual, compatível com tendinopatia, sem evidência de ruptura.<br/>
  5. <b>ruptura parcial</b>: Descontinuidade focal das fibras do tendão do [supraespinal/infraespinal/subescapular], envolvendo a face [bursal/articular], medindo cerca de [medida] cm, compatível com ruptura parcial.<br/>
  6. <b>ruptura transfixante</b>: Descontinuidade completa das fibras do tendão do [supraespinal/infraespinal/subescapular], com falha transfixante medindo cerca de [medida] cm, podendo haver retração do coto tendíneo.<br/>
  <br/>
  <b>Fim da lista de frases para substituições.</b>
</div>
`;

// =========================
// HELPERS DE UI
// =========================

async function atualizarModelosDaPasta(){
  try{
    const resp = await fetch("./modelos/index.json", { cache: "no-store" });

    if (!resp.ok){
      throw new Error(`Erro HTTP ${resp.status}`);
    }

    const lista = await resp.json();

    if (!Array.isArray(lista)){
      throw new Error("index.json não contém um array válido.");
    }

    const nomes = lista
      .map(n => String(n).trim())
      .filter(Boolean);

    const modelosComGrupo = await Promise.all(
      nomes.map(async (nome) => {
        try{
          const modelResp = await fetch(`./modelos/${nome}.json`, { cache: "no-store" });
          if (!modelResp.ok) throw new Error(`HTTP ${modelResp.status}`);
          const data = await modelResp.json();
          return {
            nome,
            grupo: MODELO_GROUPS.includes(data.grupo) ? data.grupo : "Medicina Interna"
          };
        } catch (err){
          console.warn(`Não foi possível ler o grupo do modelo ${nome}:`, err);
          return { nome, grupo: "Medicina Interna" };
        }
      })
    );

    modelos = modelosComGrupo;

    renderModelos(); // sua função que recria os botões

    console.log("Modelos atualizados:", modelos);

  } catch (err){
    console.warn("Não foi possível atualizar modelos automaticamente:", err);
  }
}


function el(id){ return document.getElementById(id); }

function clearNode(node){
  while (node.firstChild) node.removeChild(node.firstChild);
}

function createButton({ label, className, onClick }){
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn-chip ${className}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renderButtons(){
  const areaNome = el("botoes_nome_frases");
  const areaMod = el("botoes_palavras_modificadoras");

  clearNode(areaNome);
  clearNode(areaMod);

  NomeFrases.forEach(nome => {
    areaNome.appendChild(createButton({
      label: nome,
      className: "btn-blue",
      onClick: () => insertNewLineAtLastCursor(`incluir frase ${nome}`)
    }));
  });

  PlavrasModificadoras.forEach(palavra => {
    areaMod.appendChild(createButton({
      label: palavra,
      className: "btn-orange",
      onClick: () => applyModifierToActiveLine(palavra)
    }));
  });
}

function applyModifierToActiveLine(word){
  syncActiveLineWithLastCursor();
  const lines = getPromptLines();

  // Se não existe linha ativa, cria nova linha com o modificador
  if (activeLineIndex < 0){
    insertNewLineInPrompt(`ajustar para ${word}`);
    return;
  }

  while (lines.length <= activeLineIndex) lines.push("");

  let current = (lines[activeLineIndex] || "").trim();

  // Se a linha ativa estiver vazia, só preenche
  if (current === ""){
    lines[activeLineIndex] = `ajustar para ${word}`;
    setPromptLines(lines);
    focusPromptEnd();
    return;
  }

  // Já existe "ajustar para ..."?
  const m = current.match(/ajustar para\s+(.+)$/i);
  if (m){
    const tail = m[1].trim(); // tudo após "ajustar para"
    // adiciona com " e "
    lines[activeLineIndex] = current.replace(
      /ajustar para\s+(.+)$/i,
      `ajustar para ${tail} e ${word}`
    );
  } else {
    // Se ainda não tem, acrescenta ao final
    lines[activeLineIndex] = `${current} ajustar para ${word}`.trim();
  }

  setPromptLines(lines);
  focusPromptEnd();
}


function getPromptLines(){
  const raw = el("campoPrompt").value.replace(/\r\n/g, "\n");
  // Mantém linhas vazias (importante para não “colar tudo” sem querer)
  return raw.split("\n");
}

function getPromptEl(){
  return el("campoPrompt");
}

function lineIndexFromPosition(value, position){
  const safeValue = String(value || "").replace(/\r\n/g, "\n");
  const safePos = Math.max(0, Math.min(Number(position) || 0, safeValue.length));
  return safeValue.slice(0, safePos).split("\n").length - 1;
}

function rememberPromptSelection(){
  const t = getPromptEl();
  if (!t) return;
  const start = Number.isFinite(t.selectionStart) ? t.selectionStart : t.value.length;
  const end = Number.isFinite(t.selectionEnd) ? t.selectionEnd : start;
  lastPromptSelection = { start, end };
  activeLineIndex = Math.max(0, lineIndexFromPosition(t.value, start));
}

function syncActiveLineWithLastCursor(){
  const t = getPromptEl();
  if (!t) return;
  const pos = Math.max(0, Math.min(lastPromptSelection.start || 0, t.value.length));
  activeLineIndex = Math.max(0, lineIndexFromPosition(t.value, pos));
}

function insertTextAtLastCursor(text, { asNewLine = false } = {}){
  const t = getPromptEl();
  if (!t) return;

  const value = t.value.replace(/\r\n/g, "\n");
  const start = Math.max(0, Math.min(lastPromptSelection.start || 0, value.length));
  const end = Math.max(start, Math.min(lastPromptSelection.end || start, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);

  let insert = String(text || "");
  if (asNewLine) {
    insert = insert.trim();
    if (before.length > 0 && !before.endsWith("\n")) insert = `\n${insert}`;
    if (after.length > 0 && !after.startsWith("\n")) insert = `${insert}\n`;
  }

  const nextValue = `${before}${insert}${after}`;
  const nextCaret = before.length + insert.length;
  t.value = nextValue;
  t.selectionStart = t.selectionEnd = nextCaret;
  t.focus();
  rememberPromptSelection();
}

function insertNewLineAtLastCursor(text){
  insertTextAtLastCursor(text, { asNewLine: true });
}

function appendPromptLineToEnd(text){
  const t = getPromptEl();
  if (!t) return;
  const line = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!line) return;

  const value = t.value.replace(/\r\n/g, "\n");
  const nextValue = value.trim() ? `${value}\n\n${line}` : line;
  t.value = nextValue;
  const end = nextValue.length;
  t.selectionStart = t.selectionEnd = end;
  rememberPromptSelection();
}

window.appendPromptLineToEnd = appendPromptLineToEnd;

function setPromptLines(lines){
  ensureTrailingSpaceOnActiveLine(lines);
  const t = getPromptEl();
  if (!t) return;
  t.value = lines.join("\n");
  const linePos = Math.max(0, Math.min(activeLineIndex, lines.length - 1));
  let pos = 0;
  for (let i = 0; i < linePos; i++){
    pos += (lines[i] || "").length + 1;
  }
  pos += (lines[linePos] || "").length;
  t.selectionStart = t.selectionEnd = pos;
  rememberPromptSelection();
}


function insertNewLineInPrompt(text){
  const lines = getPromptLines();

  // Se estiver completamente vazio:
  if (lines.length === 1 && lines[0].trim() === ""){
    lines[0] = text;
    lines.push(""); // prepara próxima linha
    activeLineIndex = 0;
    setPromptLines(lines);
    focusPromptEnd();
    return;
  }

  // Se última linha está vazia, preenche ela; senão cria nova
  if (lines[lines.length - 1].trim() === ""){
    lines[lines.length - 1] = text;
    lines.push("");
    activeLineIndex = lines.length - 2;
  } else {
    lines.push(text);
    lines.push("");
    activeLineIndex = lines.length - 2;
  }

  setPromptLines(lines);
  focusPromptEnd();
}

function appendToActiveLine(word){
  syncActiveLineWithLastCursor();
  const lines = getPromptLines();

  // Se não existe linha ativa, cria uma nova linha com a palavra (fallback)
  if (activeLineIndex < 0){
    insertNewLineInPrompt(word);
    return;
  }

  // Garante que o array tem tamanho suficiente
  while (lines.length <= activeLineIndex) lines.push("");

  const current = (lines[activeLineIndex] || "").trim();

  if (current === ""){
    lines[activeLineIndex] = word;
  } else {
    // evita duplicar espaço
    lines[activeLineIndex] = `${current} ${word}`.trim();
  }

  setPromptLines(lines);
  focusPromptEnd();
}

function focusPromptAtActiveLineEnd(){
  const t = getPromptEl();
  t.focus();

  const value = t.value.replace(/\r\n/g, "\n");
  const lines = value.split("\n");

  const idx = Math.max(0, Math.min(activeLineIndex, lines.length - 1));

  let pos = 0;
  for (let i = 0; i < idx; i++){
    pos += lines[i].length + 1;
  }

  // final da linha ativa
  pos += lines[idx].length;

  // Se a linha ativa termina com espaço, o cursor já ficará “1 espaço depois”.
  // (pos já aponta depois desse espaço)
  t.selectionStart = t.selectionEnd = pos;
  rememberPromptSelection();
}


function focusPromptEnd(){ // (se algum lugar ainda chamar)
  focusPromptAtActiveLineEnd();
}

function ensureTrailingSpaceOnActiveLine(lines){
  if (activeLineIndex < 0) return lines;
  if (activeLineIndex >= lines.length) return lines;

  const s = lines[activeLineIndex] ?? "";
  if (s.length === 0) return lines;

  // se já termina com espaço, ok
  if (/\s$/.test(s)) return lines;

  // senão, adiciona 1 espaço
  lines[activeLineIndex] = s + " ";
  return lines;
}


function extrairNomesFrasesDoHTML(html){
  // Converte HTML em texto, preservando quebras
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";

  // Preserva quebras
  tmp.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  tmp.querySelectorAll("p, div, li").forEach(n => {
    if (!n.textContent.endsWith("\n")) n.appendChild(document.createTextNode("\n"));
  });

  const text = (tmp.textContent || "").replace(/\r\n/g, "\n");

  // Regex: início de linha -> número -> ponto/fecha-parêntese -> captura até ":".
  // Aceita: "1. termo:" e "1) termo:"
  const re = /^\s*\d+\s*[.)]\s*([^:\n]+?)\s*:/gm;

  const out = [];
  const seen = new Set();

  let m;
  while ((m = re.exec(text)) !== null){
    const term = (m[1] || "").trim();
    if (!term) continue;

    const key = term.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(term);
  }

  return out;
}

function getRelatorioHTML(){
  // Seu container do Quill no HTML é: <div id="editorRelatorio" ...>
  const editor = document.querySelector("#editorRelatorio .ql-editor");
  if (!editor) return "";
  return editor.innerHTML || "";
}

function criarJSON(){
  const nome = window.prompt("Nome:");
  if (!nome) return;

  const modsRaw = window.prompt(
    "Palavras modificadoras:\n(Coloque cada uma separada por vírgula)\nEx.: Direito, Esquerdo, medindo, supraespinal, infraespinal"
  );
  if (modsRaw === null) return; // cancel

  // Array de modificadoras: separa por vírgula, remove vazios e espaços
  const NovasPlavrasModificadoras = modsRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  // HTML do relatório (Quill)
  const NovoRelatorio = getRelatorioHTML();

  // HTML renderizado das Frases do Modelo (campo (4) é contenteditable)
  const frasesEl = el("campoFrases");
  const NovasFrasesModelo = frasesEl ? frasesEl.innerHTML : "";

  // Extrai nomes numerados "N. <nome>:"
  const NovaNomeFrases = extrairNomesFrasesDoHTML(NovasFrasesModelo);

  // JSON final (compatível para re-renderizar o site futuramente)
  const obj = {
    NomeFrases: NovaNomeFrases,
    PlavrasModificadoras: NovasPlavrasModificadoras,
    RelatorioNormal: NovoRelatorio,
    FrasesdoModelo: NovasFrasesModelo
  };

  const jsonText = JSON.stringify(obj, null, 2);

  // Download como <nome>.json
  const safeName = nome.trim().replace(/[\\/:*?"<>|]+/g, "-");
  baixarArquivo(`${safeName}.json`, jsonText, "application/json;charset=utf-8");
}

function baixarArquivo(filename, content, mime){
  const blob = new Blob([content], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // libera memória
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// =========================
// QUILL
// =========================
let quill = null;

function initQuill(){
  // Toolbar (HTML) — simples e gratuito
  el("quillToolbar").innerHTML = `
    <span class="ql-formats">
      <select class="ql-font"></select>
      <select class="ql-size"></select>
    </span>
    <span class="ql-formats">
      <button class="ql-bold"></button>
      <button class="ql-italic"></button>
      <button class="ql-underline"></button>
    </span>
    <span class="ql-formats">
      <select class="ql-align"></select>
    </span>
    <span class="ql-formats">
      <button class="ql-list" value="ordered"></button>
      <button class="ql-list" value="bullet"></button>
    </span>
    <span class="ql-formats">
      <button class="ql-clean"></button>
    </span>
  `;

  quill = new Quill("#editorRelatorio", {
    theme: "snow",
    modules: {
      toolbar: "#quillToolbar"
    }
  });

  setEditorHTML(RelatorioNormal);
}

function setEditorHTML(html){
  if (!quill) return;
  quill.clipboard.dangerouslyPasteHTML(html || "");
}

// =========================
// PAINEL MODELOS
// =========================
function renderModelos(){
  const groupsMap = {
    "Ginecologia Obstetrícia": el("listaModelosGineco"),
    "Vascular": el("listaModelosVascular"),
    "Músculo": el("listaModelosMusculo"),
    "Medicina Interna": el("listaModelosMedicinaInterna")
  };

  Object.values(groupsMap).forEach((node) => {
    if (node) clearNode(node);
  });

  modelos.forEach((modelo) => {
    const target = groupsMap[modelo.grupo] || groupsMap["Medicina Interna"];
    if (!target) return;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-modelo-item";
    b.textContent = modelo.nome;
    b.addEventListener("click", () => atualizaVariaveis(modelo.nome));
    target.appendChild(b);
  });

  Object.entries(groupsMap).forEach(([, node]) => {
    if (!node || node.children.length > 0) return;
    const empty = document.createElement("div");
    empty.className = "modelos-column-empty";
    empty.textContent = "Sem modelos neste grupo.";
    node.appendChild(empty);
  });
}

function wireModelosUI(){
  const bf = el("btnFrases");
  if (bf) bf.addEventListener("click", () => toggleFrasesPane());
  const bjson = el("btnJSON");
  if (bjson) bjson.addEventListener("click", () => criarJSON());
}


// =========================
// DIVISÓRIA AJUSTÁVEL (vertical)
// =========================
function initVerticalSplitter(){
  const splitter = el("splitter");
  const left = el("leftPane");
  const main = document.querySelector(".main");

  let dragging = false;

  const onMove = (clientX) => {
    const rect = main.getBoundingClientRect();
    const x = clientX - rect.left;
    const minLeft = 220;
    const maxLeft = rect.width * 0.55;
    const newW = Math.max(minLeft, Math.min(maxLeft, x));
    left.style.width = `${newW}px`;
  };

  splitter.addEventListener("mousedown", (ev) => {
    dragging = true;
    document.body.style.userSelect = "none";
    onMove(ev.clientX);
  });

  window.addEventListener("mousemove", (ev) => {
    if (!dragging) return;
    onMove(ev.clientX);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
  });
}
// =========================
// ajuste divisoria menu direito quando tiver muitos itens
// =========================
function atualizaLayoutPorQuantidadeDeFrases(){
  const many = Array.isArray(NomeFrases) && NomeFrases.length > 10;

  document.body.classList.toggle("layout-many-frases", many);

  // Ajusta a largura inicial para 30% (mantém a divisória arrastável funcionando depois)
  const left = el("leftPane");
  if (!left) return;

  if (many){
    left.style.width = "30%";
  } else {
    left.style.width = ""; // volta para o padrão do CSS (15% / min-width etc.) :contentReference[oaicite:1]{index=1}
  }
}

async function atualizaVariaveis(nomeModelo){
  try{
    const url = `./modelos/${nomeModelo}.json`;
    const resp = await fetch(url, { cache: "no-store" });

    if (!resp.ok){
      console.warn(`Não consegui ler ${url} (HTTP ${resp.status}). Mantendo variáveis atuais.`);
      return;
    }

    const data = await resp.json();

    if (Array.isArray(data.NomeFrases)) NomeFrases = data.NomeFrases;
    if (Array.isArray(data.PlavrasModificadoras)) PlavrasModificadoras = data.PlavrasModificadoras;

    if (typeof data.RelatorioNormal === "string"){
      RelatorioNormal = data.RelatorioNormal;
      setEditorHTML(RelatorioNormal);
      const promptEl = el("campoPrompt");
      if (promptEl) promptEl.value = "";
      activeLineIndex = -1;
    }

    

    if (typeof data.FrasesdoModelo === "string"){
      FrasesdoModelo = data.FrasesdoModelo;
      setFrasesContent(FrasesdoModelo);
    }
    renderButtons();
    atualizaLayoutPorQuantidadeDeFrases();
    if (typeof window.activateIndex2Tab === "function") {
      window.activateIndex2Tab("tab-laudo");
    }
  } catch(err){
    console.error("Erro em atualizaVariaveis:", err);
  }
}

// SELETOR DE PROCESSAMENTO //

function initAnaliseSelector(){
  const btn = document.getElementById("analiseBtn");
  const menu = document.getElementById("analiseMenu");
  const label = document.getElementById("analiseLabel");
  const wrap = document.getElementById("analiseSelector");

  if (!btn || !menu || !label || !wrap) return;

  function setChoice(choice){
    const c = String(choice || "Ambos").trim();
    label.textContent = c;
    window.analiseChoice = { tipo: c }; // <-- variável global usada pelo queue_poller.js
  }

  function openMenu(){
    menu.classList.add("open");
    btn.classList.add("open");
    menu.setAttribute("aria-hidden", "false");
  }

  function closeMenu(){
    menu.classList.remove("open");
    btn.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
  }

  function toggleMenu(){
    if (menu.classList.contains("open")) closeMenu();
    else openMenu();
  }

  // Estado inicial (se já veio setado de antes)
  setChoice(window.analiseChoice?.tipo || "Ambos");

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  // Clique nas opções
  menu.querySelectorAll(".analise-item").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const choice = b.getAttribute("data-choice") || b.textContent;
      setChoice(choice);
      closeMenu();
    });
  });

  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeMenu();
  });

  // Fecha com ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

// =========================
// INIT
// =========================
function init(){
  renderButtons();
  atualizaLayoutPorQuantidadeDeFrases()
  renderModelos();
  wireModelosUI();
  initVerticalSplitter();
  initQuill();
  atualizarModelosDaPasta();
  setFrasesContent(FrasesdoModelo);
  initRightSplitter();
  closeFrasesPane();
  initSRButton();
  window.modelActivated = window.modelActivated || {};
  window.analiseChoice = window.analiseChoice || { tipo: "Ambos" };
  initAnaliseSelector();
  const prompt = getPromptEl();
  if (prompt) {
    ["click", "keyup", "mouseup", "select", "input", "focus", "blur"].forEach((evt) => {
      prompt.addEventListener(evt, rememberPromptSelection);
    });
    rememberPromptSelection();
  }
}

document.addEventListener("DOMContentLoaded", init);


// =========================
// (4) FRASES PANE (mostrar/ocultar + redimensionar)
// =========================
let frasesPaneWidthPx = null;

function setFrasesContent(htmlText){
  const d = el("campoFrases");
  if (!d) return;
  d.innerHTML = htmlText || "";
}

function openFrasesPane(){
  const pane = el("frasesPane");
  const splitter2 = el("splitter2");
  if (!pane || !splitter2) return;

  pane.classList.add("open");
  pane.setAttribute("aria-hidden", "false");
  splitter2.hidden = false;

  // largura padrão: ~20% do viewport, com mínimo de 240px
  if (!frasesPaneWidthPx){
    frasesPaneWidthPx = Math.max(240, Math.round(window.innerWidth * 0.20));
  }
  pane.style.width = `${frasesPaneWidthPx}px`;

  // coloca o cursor no começo (opcional) sem roubar foco do prompt
  // el("campoFrases")?.focus();
}

function closeFrasesPane(){
  const pane = el("frasesPane");
  const splitter2 = el("splitter2");
  if (!pane || !splitter2) return;

  pane.setAttribute("aria-hidden", "true");
  pane.classList.remove("open");
  pane.style.width = "0px";
  splitter2.hidden = true;
}

function toggleFrasesPane(){
  const pane = el("frasesPane");
  if (!pane) return;
  const isOpen = pane.classList.contains("open");
  if (isOpen) closeFrasesPane();
  else openFrasesPane();
}

function initRightSplitter(){
  const splitter = el("splitter2");
  const pane = el("frasesPane");
  const main = document.querySelector(".main");
  if (!splitter || !pane || !main) return;

  let dragging = false;

  const onMove = (clientX) => {
    const rect = main.getBoundingClientRect();
    // largura da pane é distância do mouse até a borda direita do main
    let newW = rect.right - clientX;

    const minW = 220;
    const maxW = rect.width * 0.45;

    newW = Math.max(minW, Math.min(maxW, newW));
    frasesPaneWidthPx = Math.round(newW);
    pane.style.width = `${frasesPaneWidthPx}px`;
  };

  splitter.addEventListener("mousedown", (ev) => {
    if (splitter.hidden) return;
    dragging = true;
    document.body.style.userSelect = "none";
    onMove(ev.clientX);
  });

  window.addEventListener("mousemove", (ev) => {
    if (!dragging) return;
    onMove(ev.clientX);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
  });
}

function getCurrentSRHtml(){
  const sr = window.__CURRENT_SR__;
  if (!sr) return "";
  // tenta achar o HTML em campos comuns
  const html = (sr.sr_html || sr.html || sr.content || "");
  return (typeof html === "string") ? html.trim() : "";
}

function updateSRButtonState(){
  const b = document.getElementById("SRButton");
  if (!b) return;

  const html = getCurrentSRHtml();
  const has = html.length > 0;

  b.classList.toggle("has-sr", has);
  b.setAttribute("aria-disabled", String(!has));
}

function openCurrentSR(){
  const html = getCurrentSRHtml();
  if (!html) return;

  // abre em nova aba como HTML real
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");

  // libera memória depois
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function initSRButton(){
  const b = document.getElementById("SRButton");
  if (!b) return;

  b.addEventListener("click", () => {
    // só abre se tiver conteúdo
    if (b.classList.contains("has-sr")) openCurrentSR();
  });

  updateSRButtonState();

  // se seu código atualiza window.__CURRENT_SR__ em algum momento,
  // chame updateSRButtonState() logo depois de setar o valor.
  // (fallback: checagem periódica leve)
  setInterval(updateSRButtonState, 800);
}
