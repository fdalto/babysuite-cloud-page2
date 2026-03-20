# Importação

## Objetivo

Este documento descreve como integrar o OCR validado neste projeto em outro site.

O formato recomendado é `browser-only`, sem backend de inferência.

## Ponto de Entrada

O OCR recebe uma imagem contendo a ROI do bloco de medidas.

Entradas possíveis:

- `File` vindo de input HTML
- `Blob`
- `ImageBitmap`
- caminho local servido por HTTP

No fluxo atual de teste, a entrada é consumida pela função de carregamento da página browser-only em [script/browser_ocr.js](/D:/SuperLaudo_Agent/OCR/script/browser_ocr.js).

## Saídas

As saídas principais do OCR são:

- bloco de texto reescrito
- medições estruturadas
- lista de detecções com texto reconhecido
- imagens intermediárias para debug

Saída textual esperada:

```text
Medidas:
PS       -46.84 cm/s
DF       -22.52 cm/s
TMmax    -31.57 cm/s
IP       0.77
IR       0.52
SP/DF    2.08
DF/PS    0.48
```

## Fluxo de Integração em Outro Site

### Opção 1. Embutir a página pronta

Copiar a pasta `ocrpaddle` para o site e servir:

- `ocrpaddle/browser_roi.html`
- `ocrpaddle/script/browser_ocr.js`
- `ocrpaddle/script/site.css`
- `ocrpaddle/models/...`

Uso:

1. Servir os arquivos por HTTP.
2. Abrir a página.
3. Passar a ROI para o input local ou adaptar a carga da imagem.

### Opção 2. Reusar apenas o motor

Se o outro site já tiver interface própria, o melhor caminho é reaproveitar só a lógica de [script/browser_ocr.js](/D:/SuperLaudo_Agent/OCR/script/browser_ocr.js).

Pontos que normalmente precisam ser adaptados:

- origem da imagem
- gatilho do processamento
- renderização das saídas
- estilo visual

## Pontos de Entrada da Imagem

No código atual, o ponto de entrada está concentrado em:

- carregamento do arquivo local
- carregamento de amostra via `fetch`

Para outro site, você pode substituir isso por:

```js
const bitmap = await createImageBitmap(fileOrBlob);
```

ou

```js
const response = await fetch(urlDaImagem);
const blob = await response.blob();
const bitmap = await createImageBitmap(blob);
```

## Pontos de Saída do OCR

No fluxo atual, o resultado final é produzido depois do processamento completo no navegador.

Os dados principais que devem ser capturados por outro site são:

- `plainText`
- `structuredMeasurements`
- `detections`

Se quiser transformar isso em função reutilizável, a interface recomendada é:

```js
const result = await processRoiImage(fileOrBlob);
```

com retorno no formato:

```js
{
  plainText: \"Medidas:\\nPS       -46.84 cm/s\",
  structuredMeasurements: [
    { label: \"PS\", value: \"-46.84\", unit: \"cm/s\" }
  ],
  detections: [
    {
      recognizedText: \"PS -46.84 cm/s\",
      recognizedScore: 0.98
    }
  ]
}
```

## Dependências

O modo browser-only depende de:

- `onnxruntime-web` carregado por CDN
- modelos ONNX servidos por HTTP
- dicionários de caracteres servidos por HTTP

Não depende de backend Python para rodar os modelos.

## Arquivos Necessários

Para integração mínima, copie:

- [browser_roi.html](/D:/SuperLaudo_Agent/OCR/browser_roi.html)
- [script/browser_ocr.js](/D:/SuperLaudo_Agent/OCR/script/browser_ocr.js)
- [script/site.css](/D:/SuperLaudo_Agent/OCR/script/site.css)
- [models/onnx/det.onnx](/D:/SuperLaudo_Agent/OCR/models/onnx/det.onnx)
- [models/onnx/rec.onnx](/D:/SuperLaudo_Agent/OCR/models/onnx/rec.onnx)
- [models/paddle/rec/ppocrv5_en_dict.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/ppocrv5_en_dict.txt)
- [models/paddle/rec/en_dict.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/en_dict.txt)
- [models/paddle/rec/ppocr_keys_v1.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/ppocr_keys_v1.txt)
- [ocr_substitutions.json](/D:/SuperLaudo_Agent/OCR/ocr_substitutions.json)

## Recomendação de Produção

Para produção, o ideal é transformar o código de `browser_ocr.js` em um módulo com API explícita, por exemplo:

```js
import { processRoiImage } from \"./ocr-engine.js\";
```

Assim o outro site usa apenas:

1. entrada da ROI
2. chamada do OCR
3. consumo do texto e dos campos estruturados

sem depender da página de teste.
