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
5. Remove borda preta superior quando presente (até 5 px).
6. Detecta ROIs no resultado cropado.
7. Limpa verde de borda dos boxes detectados.
8. Aplica ajuste vertical (vtrim), filtro `txt >= 10%` e expansão de margem final.
9. Salva variantes de imagem em memória (original/crop/ROI).
10. Envia ROIs em lote para worker OCR.
11. Consolida texto por imagem apenas ao terminar todos os ROIs.

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
- Faixas HSV dedicadas ao `box_yellow`
- Critério de cinza para borda
- Contraste mínimo para pixel de borda cinza
- Dilatação de máscara de cor
- Filtros geométricos e densidade
- parâmetros de merge e padding dos ROIs

## Detecção de ROI

A detecção combina:

1. `box`
- busca contornos retangulares cinza
- valida texto colorido no interior
- aceita borda cinza ou verde
- merge de boxes próximos ativo

2. `box_yellow`
- detecta componentes amarelos com thresholds dedicados
- não detecta dentro da máscara de `box`

3. `color_pipeline`
- máscara HSV
- dilatação horizontal/vertical
- connected components
- merge horizontal de candidatos colados (eixo x)
- filtros geométricos/densidade

Ordem de execução:

- `box` primeiro
- depois `box_yellow` (bloqueado por máscara de `box`)
- gera máscara negativa de `box + box_yellow`
- roda `color_pipeline` fora dessa máscara

## OCR atual

### Tecnologia

- OCR rodando em `Web Worker`
- implementação atual usando `Tesseract.js`
- modo configurado em `ocr/ocr_runtime_config.json`

### Variações

- tentativa ativa no app: `saturation_invert` (`PSM 6`)

### Filtro de confiança

- no worker, resultado final com `conf < 50%` é descartado (texto final vazio)
- nota técnica de descarte é adicionada no resultado

## Formato de saída na UI

No painel "Resultado OCR":

- cada ROI mostra comparativo das tentativas e texto final selecionado
- resultado consolidado por imagem é uma linha única, ordenada por leitura natural

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

Regras da consolidação:
- só consolida quando todos os ROIs da imagem estão em estado terminal
- ordena por leitura natural:
  - primeiro por linha (`y`, com tolerância por altura)
  - depois por coluna (`x`)

## Interface

- Coluna da tabela: `Resultado OCR`
- Não exibe blocos de debug/split de linha de `box_vtrim`
- Exibe origem do perfil (`metadado` ou "modelo não identificado, usando Default")

## Comunicação com site pai

- Recebe: `dicom_image`, `dicom_sr`
- Envia ACK: `{ type: "ack", message_id }`
- Publica `settings_update`

## Observações operacionais

- Todo o fluxo permanece isolado em `ocrdeveloping`.
- Não há persistência em disco/servidor no frontend; os stores são memória da aba.
- Ao limpar a tabela, imagens e OCR em memória são limpos e `objectUrl` revogados.
