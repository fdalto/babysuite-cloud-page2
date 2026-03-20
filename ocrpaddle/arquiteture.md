# Arquitetura

## Objetivo

Este projeto implementa OCR para blocos de medidas em imagens de ultrassom.

O fluxo validado para uso prático ficou em modo `browser-only`, com execução no navegador usando:

- `det.onnx` para detectar regiões de texto
- `rec.onnx` para reconhecer o texto
- pré-processamento `tight`
- reconstrução textual em linhas e colunas

## Componentes Principais

### 1. Interface browser-only

Arquivo: [browser_roi.html](/D:/SuperLaudo_Agent/OCR/browser_roi.html)

Responsabilidades:

- carregar a interface de teste
- receber imagem local ou amostra
- exibir etapas visuais
- mostrar bloco final reescrito

### 2. Runtime OCR no navegador

Arquivo: [script/browser_ocr.js](/D:/SuperLaudo_Agent/OCR/script/browser_ocr.js)

Responsabilidades:

- carregar `onnxruntime-web`
- carregar `det.onnx` e `rec.onnx`
- carregar dicionários de caracteres
- pré-processar a imagem para o detector
- rodar o detector
- converter mapa de probabilidade em boxes
- fundir boxes vizinhas quando necessário
- expandir a box antes do crop para não cortar letras
- aplicar o pré-processamento `tight`
- preparar tensor para o reconhecedor
- fazer CTC decode
- reconstruir o bloco textual

### 3. Modelos ONNX

Arquivos:

- [models/onnx/det.onnx](/D:/SuperLaudo_Agent/OCR/models/onnx/det.onnx)
- [models/onnx/rec.onnx](/D:/SuperLaudo_Agent/OCR/models/onnx/rec.onnx)

Responsabilidades:

- `det.onnx`: localizar regiões de texto
- `rec.onnx`: reconhecer o texto da ROI/crop

### 4. Dicionários do reconhecimento

Arquivos:

- [models/paddle/rec/ppocrv5_en_dict.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/ppocrv5_en_dict.txt)
- [models/paddle/rec/en_dict.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/en_dict.txt)
- [models/paddle/rec/ppocr_keys_v1.txt](/D:/SuperLaudo_Agent/OCR/models/paddle/rec/ppocr_keys_v1.txt)

Responsabilidades:

- mapear índices de saída do `rec.onnx` para caracteres
- permitir fallback quando o shape do modelo variar
- tratar o índice de espaço observado no modelo

### 5. Dicionário de substituições

Arquivo: [ocr_substitutions.json](/D:/SuperLaudo_Agent/OCR/ocr_substitutions.json)

Responsabilidades:

- aplicar pós-processamento textual orientado por domínio
- corrigir labels médicas reconhecidas sem separação correta
- padronizar descrições estruturadas antes do bloco final

### 6. Estilo visual

Arquivo: [script/site.css](/D:/SuperLaudo_Agent/OCR/script/site.css)

Responsabilidades:

- layout da página
- visualização das etapas
- blocos de texto, tabelas e cards de detecção

## Pipeline Atual

1. A imagem é carregada no navegador.
2. A imagem é redimensionada para múltiplos de 32.
3. O detector gera um mapa de probabilidade.
4. O mapa é binarizado.
5. Componentes conectados são convertidos em boxes.
6. Boxes próximas podem ser fundidas com critério restritivo horizontal.
7. Cada box é expandida antes do crop para preservar margens do texto.
8. O crop passa pelo pré-processamento `tight`.
9. O reconhecedor roda em modo `paddle`.
10. O texto reconhecido é reorganizado em linhas.
11. As linhas são reescritas em bloco de texto.

## Estratégia de Organização das Linhas

No estado atual, a organização textual usa dois mecanismos:

- segmentação por linhas baseada em vales da máscara binária
- fallback para agrupamento geométrico quando a segmentação não é suficiente

Na segmentação por linhas:

- a máscara binária é projetada no eixo Y
- vales pretos separam uma linha da outra
- cada linha detectada vira uma faixa lógica
- boxes dentro da mesma faixa são ordenadas da esquerda para a direita

Isso reduz inversões causadas por pequenas flutuações na altura das boxes.

## Estrutura Mínima para Distribuição

A pasta `ocrpaddle` contém apenas os arquivos necessários para reutilização:

- HTML da interface browser-only
- JS do OCR
- CSS
- modelos ONNX
- dicionários de reconhecimento
- dicionário JSON de substituições
- documentação de arquitetura e integração
