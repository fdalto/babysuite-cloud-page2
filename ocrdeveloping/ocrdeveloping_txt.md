# ocrdeveloping.txt

## Objetivo geral

Este documento descreve o conceito inicial de um projeto experimental para processamento de imagens no navegador com foco em detecção de regiões candidatas a OCR.

A ideia é construir um ambiente de desenvolvimento isolado que permita testar o fluxo completo de:

1. Recebimento de imagens
2. Pré‑processamento
3. Detecção de regiões candidatas
4. Recorte das ROIs
5. Preparação para OCR

O objetivo inicial **não é implementar o OCR completo**, mas sim validar a arquitetura de captura e preparação das imagens.

---

# Arquitetura conceitual do pipeline

O fluxo planejado para o processamento das imagens é o seguinte:

imagem da API
↓
decode para ImageBitmap / canvas
↓
OpenCV.js
↓
pré-processamento
↓
detecção de regiões candidatas
↓
recorte das ROIs
↓
normalização de cada ROI
↓
PaddleOCR em ONNX Runtime Web
↓
pós-processamento / filtro / merge
↓
resultado final

Nesta fase inicial do projeto iremos implementar apenas até:

**detecção das regiões candidatas e recorte das ROIs.**

---

# Novo site de desenvolvimento

Para testar essa arquitetura será criado **um novo site dedicado ao desenvolvimento do OCR experimental**.

Este site ficará separado da interface principal do sistema.

Estrutura planejada:

./ocrdeveloping/index.html

Este site servirá como um **laboratório de testes para processamento de imagens**.

---

# Integração com o BabySuite

O novo site deverá receber imagens enviadas pelo sistema BabySuite.

O fluxo será:

agent_app.py (BabySuite)
↓
index.html (servido pelo APP)
↓
postMessage
↓
ocrdeveloping/index2.html

Ou seja, o site experimental deverá **escutar mensagens via `window.postMessage`** contendo:

- a imagem
- metadados da imagem

Essas mensagens serão enviadas pelo `index.html` que já recebe dados do `agent_app.py`.

---

# Reaproveitamento do projeto cloud_page

O novo site **não será construído do zero**.

Ele deve reutilizar partes do projeto existente **cloud_page**, especificamente:

- comunicação com a API
- recebimento das imagens
- recebimento dos metadados
- organização da sequência de imagens

Essas partes já resolvem o problema de:

- autenticação
- chamadas de API
- streaming das imagens
- organização dos estudos

Portanto o novo projeto deve **importar ou copiar apenas os módulos necessários** para esse funcionamento.

---

# Componentes que NÃO serão utilizados

Para este projeto experimental **não precisamos de várias funcionalidades presentes no cloud_page**.

Devem ser removidos ou ignorados:

- editor de texto
- abas de frases
- página de impressão
- modelos de relatório
- botões de frases
- palavras modificadoras
- lógica baseada em JSON para montagem de laudos

O objetivo aqui é apenas trabalhar com **as imagens**.

---

# Comportamento da interface

O novo site deve se comportar de forma semelhante à página de impressão do sistema atual.

Porém, em vez de gerar uma página final de relatório, ele deverá montar **uma tabela dinâmica para análise das imagens**.

Estrutura da tabela:

Coluna 1
Imagem original

Coluna 2
ROIs detectadas

Coluna 3
Resultado do OCR (futuro)

---

# Atualização dinâmica

Cada vez que uma nova imagem chegar via `postMessage`:

- uma nova linha deve ser criada na tabela
- essa linha deve ser inserida **no topo da tabela**

Ou seja:

imagem mais recente
↑
imagens anteriores abaixo

Isso facilita o acompanhamento do processamento em tempo real.

---

# Etapas futuras

Após validar o recebimento das imagens e a detecção das regiões candidatas, as próximas etapas do projeto serão:

1. Integração com OpenCV.js para segmentação mais robusta
2. Implementação da normalização das ROIs
3. Integração com PaddleOCR
4. Execução do modelo via ONNX Runtime Web
5. Pós-processamento do texto reconhecido

---

# Objetivo final

Criar um pipeline de OCR totalmente executado no navegador capaz de:

- receber imagens em tempo real
- detectar regiões com possível texto
- recortar automaticamente essas regiões
- executar OCR local
- retornar resultados estruturados

Tudo isso **sem enviar as imagens para servidores externos**.

Este projeto será usado inicialmente como **plataforma de experimentação** para testar diferentes técnicas de detecção e OCR.

