# OCR Architecture - Estado Atual (2026-03-20)

Este arquivo descreve o estado atual do pipeline OCR em `cloud_page/ocrdeveloping`.

## Fluxo geral
1. Decodifica PNG e resolve perfil por equipamento (`device_preprocessing.json`).
2. Aplica crop por perfil e remove borda preta superior (`trimTopBlackBorder(..., maxRows=5)`).
3. Detecta ROIs candidatas em 3 mecanismos e ordem fixa:
   - `box` (`box_vtrim`)
   - `box_yellow`
   - `color_pipeline`
4. Limpa verde de margem de boxes detectados (`limparMargemVerdeDosBoxesDetectados`).
5. Faz ajuste vertical de ROI (`reduzirPaddingVerticalDosRois`).
6. Filtra ROI original por densidade de texto (`txt >= 10%`).
7. Expande margens finais de ROI (`+10px` laterais, `+6px` topo/base).
8. Envia ROIs para OCR (tentativa fixa `saturation_invert`, `PSM 6`).
9. Consolida o texto final por imagem apenas quando todos os ROIs terminam.

## Estado atual da detecção

### 1) `box` (prioridade alta)
- Borda aceita cinza ou verde.
- Merge de candidatos de box ativo (`ENABLE_BOX_CANDIDATE_MERGE = true`).
- Serve de base para máscaras negativas dos próximos estágios.

### 2) `box_yellow`
- Detecta componentes de texto amarelo com thresholds dedicados:
  - `boxYellowHueMin/Max = 54/86`
  - `boxYellowSatMin = 0.0785`
  - `boxYellowValueMin = 0.392`
- Regra de prioridade: `box_yellow` **não detecta** dentro da máscara de `box`.

### 3) `color_pipeline`
- Roda somente fora da máscara negativa de `box` + `box_yellow`.
- Merge global de cor permanece desativado (`ENABLE_COLOR_CANDIDATE_MERGE = false`).
- Merge horizontal específico está ativo para candidatos colados:
  - `COLOR_HORIZONTAL_MERGE_GAP_PX = 2`
  - `COLOR_HORIZONTAL_MERGE_MIN_Y_OVERLAP = 0.35`
- Padding lateral de ROI de cor reduzido:
  - `colorRoiPadXMin = 5`
  - `colorRoiPadXRatio = 0.096` (GE override `0.078`)

## Split de linha
- O split de linha está desativado no fluxo atual.
- `separarLinhasDentroDosRois(...)` retorna 1 ROI por entrada (`is_line_split = false`).
- Painéis visuais de sub-ROI/debug de split foram removidos da página.

## OCR e consolidação final
- Worker OCR: `Tesseract.js` (idioma atual no runtime, default `eng`).
- Tentativa ativa: `saturation_invert` com whitelist e `PSM 6`.
- Descarte por confiança final no worker:
  - `MIN_FINAL_OCR_CONFIDENCE = 0.5` (50%).
  - Abaixo disso, texto final do ROI vira vazio.
- Consolidação por imagem:
  - Só ocorre quando todos os ROIs da imagem estão em estado terminal (`done/error/waiting_model`).
  - Ordenação em leitura natural por coordenada:
    - agrupamento por linha via `y` (centro do box),
    - ordenação por `x` dentro da linha.
  - Envia uma linha única `ocr_text_line` para o pai (`ocr_result_local`).

## Pontos de configuração principais
- `cloud_page/ocrdeveloping/app.js`
  - seleção de candidatos e prioridades
  - máscaras negativas entre pipelines
  - parâmetros de margem/filtro/merge
  - consolidação ordenada por imagem
- `cloud_page/ocrdeveloping/ocr/worker.js`
  - threshold de descarte por confiança final (`50%`)
- `cloud_page/ocrdeveloping/device_preprocessing.json`
  - perfis por equipamento
  - HSV e geometria com override por profile
