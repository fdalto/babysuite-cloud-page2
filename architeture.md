# Arquitetura do site em nuvem

## Objetivo

O conteúdo de `cloud_page` é o frontend hospedado na nuvem. Ele não recebe DICOM direto. Quem recebe DICOM é o APP local (`agent_app.py` + `api_server.py`). O site em nuvem funciona como interface de trabalho do médico e como cliente do bridge local.

## Papéis de cada parte

- `agent_app.py`
  - Sobe o servidor DICOM local.
  - Converte imagens para PNG ou SR para HTML.
  - Guarda tudo em fila em memória.
  - Sobe o bridge local em `http://127.0.0.1:8099`.
  - Sobe a API local em `http://127.0.0.1:8787`.

- Site em nuvem (`cloud_page`)
  - Mostra a interface de edição do laudo.
  - Carrega modelos JSON locais do próprio site.
  - Recebe imagens e SR do bridge local via `postMessage`.
  - Envia `ack` para remover itens da fila local.
  - Publica configurações do site para o APP local.
  - Pode enviar o conteúdo para IA/n8n.

## Fluxo principal

1. O APP local recebe um DICOM.
2. O APP converte o conteúdo para um item de fila:
   - imagem: PNG
   - structured report: HTML
3. O bridge local busca itens na API local.
4. O bridge local entrega o item para o site em nuvem via `postMessage`.
5. O site em nuvem processa:
   - `dicom_image`: salva a imagem em memória para visualização/impressão
   - `dicom_sr`: salva o SR atual em memória para consulta e uso pela IA
6. O site responde com `ack`.
7. O bridge local confirma o `ack` na API local e remove o item da fila.

## APIs locais necessárias para o site funcionar

Base local: `http://127.0.0.1:8787`

- `GET /heartbeat`
  - Estado geral do APP, fila, último DICOM, configurações e bridge ativo.

- `GET /queue/dequeue?n=1..20`
  - Retorna metadados dos próximos itens pendentes.

- `GET /payload/{message_id}`
  - Retorna o conteúdo do item.
  - `image/png` para imagem.
  - `text/html` para SR.

- `POST /ack`
  - Body: `{ "message_id": "..." }`
  - Remove da fila um item já entregue.

- `POST /settings`
  - Body:
    `{ "MODEL_ACTIVATED": {...}, "ANALISE_CHOICE": {...} }`
  - Recebe as preferências definidas no site.

- `POST /bridge/ping`
  - Mantém presença do bridge e detecta múltiplos sites abertos.

## Contrato entre site em nuvem e bridge local

Origem do bridge local: `http://127.0.0.1:8099`

Mensagens recebidas pelo site:

- `dicom_image`
  - Campos principais:
    - `message_id`
    - `metadata`
    - `png_buffer` (`ArrayBuffer`)

- `dicom_sr`
  - Campos principais:
    - `message_id`
    - `metadata`
    - `sr_html`

Mensagens enviadas pelo site:

- `ack`
  - `{ type: "ack", message_id }`

- `settings_update`
  - `{ type: "settings_update", MODEL_ACTIVATED, ANALISE_CHOICE }`

## Estrutura do frontend em `cloud_page`

- `index.html`
  - Tela principal com abas de laudo, impressão e ferramentas externas.

- `script_main.js`
  - Editor Quill, modelos, frases, prompt e estado de UI.
  - Mantém globais como `window.modelActivated` e `window.analiseChoice`.

- `bridge_client.js`
  - Arquivo central da integração com o APP local.
  - Recebe `postMessage`, salva imagem/SR, envia `ack` e publica settings.

- `script_IA.js`
  - Envia laudo + prompt + frases + SR atual para webhook externo do n8n/IA.

- `modelos/*.json`
  - Templates de laudo usados pelo editor.

## Regras de arquitetura

- O site em nuvem não deve depender de acesso direto ao DICOM.
- Toda comunicação com o APP local deve passar pelo bridge local.
- O frontend deve tratar imagem e SR como dados temporários em memória.
- O `ack` deve ser enviado somente após o item ser recebido com sucesso.
- As preferências do usuário no site devem ser refletidas no APP via `settings_update`.
- A validação de origem é obrigatória nos dois lados do `postMessage`.

## Observação importante

Os arquivos `queue_poller.js` e `print_tab.js` parecem ser legados e não refletem a API atual do APP local. O fluxo compatível com `api_server.py` atual é o usado pelo bridge com:

- `GET /queue/dequeue`
- `GET /payload/{message_id}`
- `POST /ack`
- `POST /settings`
