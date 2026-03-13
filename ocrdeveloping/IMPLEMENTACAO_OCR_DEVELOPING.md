# Implementação OCR Developing

Este documento resume o estado atual do laboratório `ocrdeveloping`.

## Objetivo

Disponibilizar um ambiente isolado para:

- receber imagens via `postMessage`
- aplicar pré-processamento por equipamento
- detectar ROIs de texto
- executar OCR no navegador
- salvar resultados estruturados com vínculo da imagem de origem

## Estrutura atual

- `ocrdeveloping/index.html` (redirect para `index2.html`)
- `ocrdeveloping/index2.html` (UI principal)
- `ocrdeveloping/styles.css` (estilo da tabela/ROI)
- `ocrdeveloping/app.js` (pipeline principal)
- `ocrdeveloping/device_preprocessing.json` (perfis de equipamento e tuning)
- `ocrdeveloping/ocr/worker.js` (OCR em worker)
- `ocrdeveloping/ocr/ocr_runtime_config.json` (config do OCR)

## Fluxo geral

1. Recebe `dicom_image` via `postMessage`.
2. Decodifica a imagem e lê metadados DICOM.
3. Resolve perfil por fabricante/modelo.
4. Aplica crop por perfil (`[left, top, right]`).
5. Detecta ROIs no resultado cropado.
6. Salva variantes de imagem em memória (original/crop/ROI).
7. Envia ROIs em lote para worker OCR.
8. Atualiza tabela com resultado OCR por ROI e consolida OCR final por imagem.

## Perfis por equipamento (JSON)

Arquivo: `device_preprocessing.json`

Cada perfil pode definir:

- `crop`
- `tuning` (parâmetros da detecção + confiança OCR)

### Regra de herança (importantíssimo)

Para cada imagem, os parâmetros são montados nesta ordem:

1. `DEFAULT_TUNING` (no `app.js`)
2. `fallback.tuning` (JSON)
3. `profile.tuning` (JSON do equipamento)

Isso permite criar novo profile com **apenas alguns campos**; os demais vêm do default.

### Fallback

- `Samsung / HS40` é o fallback.
- Se o equipamento não for identificado, usa fallback automaticamente.

## Parâmetros editáveis por perfil

Atualmente os seguintes grupos são configuráveis por profile:

- crop por perfil
- Faixas HSV/chroma para texto colorido
- Critério de cinza para borda
- Contraste mínimo para pixel de borda cinza
- Dilatação de máscara de cor
- Filtros geométricos e densidade
- Confiança mínima global OCR (`ocrMinConfidence`)

## Detecção de ROI

A detecção combina:

1. `box`
- busca contornos retangulares cinza
- valida texto colorido no interior

2. `color_pipeline`
- máscara HSV
- dilatação horizontal/vertical
- connected components
- merge de boxes
- filtros geométricos/densidade

Ordem de execução:

- `box` primeiro
- gera máscara negativa dessas áreas
- roda `color_pipeline` fora dessa máscara

## OCR atual

### Tecnologia

- OCR rodando em `Web Worker`
- implementação atual usando `Tesseract.js`
- modo configurado em `ocr/ocr_runtime_config.json`

### Variações

- atualmente configurado para `normal` (sem inversão)
- pode-se habilitar variantes no config (`normal`, `invert`)

### Filtro de confiança

- resultado com confiança abaixo de `ocrMinConfidence` do perfil é descartado
- status interno: `filtered_low_conf`

## Formato de saída na UI

No painel "Resultado OCR":

- formato: `#n (conf%): texto`
- sem exibir numeração técnica de ROI id
- sem exibir confidence em resultados descartados como texto final

## Armazenamento em memória

### Imagens

Store global:

- `window.__OCR_DEV_IMAGE_STORE__`

IDs utilizados:

- original: `message_id`
- crop da imagem mãe: `message_id_anonimyzed`
- crop por ROI: `message_id_roi_n_anonimyzed`

Campos por item:

- `id`
- `parentId`
- `ts`
- `metadata`
- `preprocessProfile`
- `blob`
- `objectUrl`
- `ocr_text_line` (quando consolidado)

### OCR

Store global:

- `window.__OCR_DEV_OCR_RESULTS__`

Estruturas:

- `byRoiId`
- `byParentId`
- `byParentSummary`
- `order`

Para cada imagem mãe, também é salvo:

- `byParentSummary[parent_message_id].text_line`

`text_line` é uma string única (uma linha), sem quebra, contendo apenas textos OCR aceitos.

## Interface

- Coluna da tabela: `Resultado OCR`
- Não exibe mais `"(futuro)"`
- Não exibe `"Pré-processamento: crop"`
- Não exibe `id crop`
- Exibe origem do perfil (`metadado` ou "modelo não identificado, usando Default")

## Comunicação com site pai

- Recebe: `dicom_image`, `dicom_sr`
- Envia ACK: `{ type: "ack", message_id }`
- Publica `settings_update`

## Observações operacionais

- Todo o fluxo permanece isolado em `ocrdeveloping`.
- Não há persistência em disco/servidor no frontend; os stores são memória da aba.
- Ao limpar a tabela, imagens e OCR em memória são limpos e `objectUrl` revogados.
