/**
 * gerar_relatorio_US()
 * - Extrai HTML do Quill (#editorRelatorio)
 * - Envia para o n8n (webhook analisar-US)
 * - Insere a resposta ao final do relatório no Quill
 */
document.addEventListener("DOMContentLoaded", () => {
  const botaoIA = document.getElementById("IAButton");
  if (botaoIA) {
    botaoIA.addEventListener("click", gerar_relatorio_US);
  } else {
    console.warn("Botão IAButton não encontrado.");
  }
});

function setIAButtonLoading(isLoading) {
  const botaoIA = document.getElementById("IAButton");
  if (!botaoIA) return;
  botaoIA.classList.toggle("is-loading", isLoading);
  botaoIA.disabled = isLoading;
  botaoIA.setAttribute("aria-busy", isLoading ? "true" : "false");
}

async function sendCurrentSRToN8N() {
  const cur = getCurrentSR();
  if (!cur?.sr_html) return;

  if (sendCurrentSRToN8N._busy) return;
  sendCurrentSRToN8N._busy = true;

  try {
    const r = await fetch("SEU_WEBHOOK_DO_N8N", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sr_html: cur.sr_html })
    });
    if (!r.ok) return;

    const data = await r.json();
    const processedText = data.text || "";
    if (processedText) setProcessedResultAndClearMemory(processedText);
  } catch (e) {
    // falha: mantém em memória e no localStorage (backup)
  } finally {
    sendCurrentSRToN8N._busy = false;
  }
}

async function gerar_relatorio_US() {
  if (gerar_relatorio_US._busy) {
    return;
  }

  gerar_relatorio_US._busy = true;
  setIAButtonLoading(true);

  let quill = null;
  let backupConteudo = "";
  try {
    const editorEl = document.getElementById("editorRelatorio");
    if (!editorEl) {
      alert("❌ Editor do relatório (Quill) não encontrado (#editorRelatorio).");
      return;
    }

    quill = editorEl.__quill;
    if (!quill) {
      alert("❌ O Quill ainda não foi inicializado (editorEl.__quill vazio).");
      return;
    }

    // HTML do relatório (mantém formatação)
    const relatorioHTML = (quill.root.innerHTML || "").trim();

    // Quill vazio costuma ser "<p><br></p>"
    if (!relatorioHTML || relatorioHTML === "<p><br></p>") {
      alert("❌ O relatório está vazio.");
      return;
    }

    // Extrai texto limpo dos campos de prompt e frases
    const promptEl = document.getElementById("campoPrompt");
    const frasesEl = document.getElementById("campoFrases");

    const promptText = (promptEl?.value || "").trim();          // texto limpo
    const frasesText = (frasesEl?.innerText || "").trim();      // texto limpo (sem HTML)

    function getFontData(el) {
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        return {
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight
        };
    }

    // pega o elemento “real” onde o Quill renderiza o texto
    const relatorioEditorEl = document.querySelector("#editorRelatorio .ql-editor");
    const FontData = getFontData(relatorioEditorEl);
    const sr_report = window.__CURRENT_SR__ || {
      id: null,
      ts: Date.now(),
      sr_html: "<div>Relatório sem medidas.</div>"
    };

    const resposta = await fetch("https://n8ndovitordalto.duckdns.org/webhook/analisar-US", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            relatorio: relatorioHTML,   // HTML do Quill (mantém formatação do laudo)
            prompt: promptText,         // texto puro
            frases: frasesText,          // texto puro
            fontData: FontData,          // informações da fonte usada no relatório (para manter consistência na resposta)
            sr_report: sr_report,         // conteúdo do SR report (se existir, para contexto adicional no n8n)
        })
    });

    if (!resposta.ok) throw new Error("Erro ao enviar o relatório para o n8n.");
    backupConteudo = quill.root.innerHTML;
    const respostaJson = await resposta.json();
    const textoResposta = respostaJson.text || "⚠️ Resposta vazia.";

    const blocoHTML = `<div>${String(textoResposta).replace(/\n/g, "<br>")}</div>`;

     // ✅ Substitui TODO o conteúdo do relatório
    quill.setText("", "silent"); // limpa tudo (evita sobras)
    quill.clipboard.dangerouslyPasteHTML(0, blocoHTML, "user");
    quill.setSelection(quill.getLength(), 0, "silent");
    // colocar aqui para zerar o conteudo da memoria do SR report, para evitar que o botão de SR report fique ativo com um conteúdo antigo
    window.__CURRENT_SR__ = null;
    // Atualiza o estado do botão (desativa se não tiver mais SR)
    updateSRButtonState(); 
  } catch (e) {
    console.error("Falha ao substituir relatório, restaurando backup:", e);

    if (quill && backupConteudo) {
      // ✅ Restaura o conteúdo original se algo der errado
      quill.setText("", "silent");
      quill.clipboard.dangerouslyPasteHTML(0, backupConteudo, "silent");
      quill.setSelection(quill.getLength(), 0, "silent");
    }

    alert("❌ Erro ao atualizar o relatório. O conteúdo original foi restaurado.");
  } finally {
    gerar_relatorio_US._busy = false;
    setIAButtonLoading(false);
  }
}
