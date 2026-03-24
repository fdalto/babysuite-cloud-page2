# Arquitetura do site em nuvem

## Objetivo

O conteúdo de `cloud_page` é o frontend hospedado na nuvem. Ele não recebe DICOM diretamente.  
Quem recebe DICOM é o APP local (`agent_app.py` + `api_server.py`).  
O site em nuvem funciona como interface do médico e cliente do bridge local.

## Papéis

- APP local (`agent_app.py`)
  - Sobe DICOM SCP (`0.0.0.0:11112`, AE Title `BABYSUITE`).
  - Extrai metadados DICOM e converte:
    - imagem -> PNG
    - SR -> HTML
  - Enfileira tudo em memória.
  - Mantém módulo MWL em background com cache em memória.
  - Sobe API local (`http://<host>:8787`, bind `0.0.0.0`).
  - Sobe bridge estático (`http://<host>:8099/bridge/index.html`).
  - Sobe bridge worklist (`http://<host>:8099/bridge/index_worklist.html`).
  - Persistência de config em `./CONFIG/CONFIG.JSON`.
  - Persistência de resultado worklist em `./WORKLIST_DATA/`.

- Bridge local (`bridge/bridge.js`)
  - Lê fila da API local.
  - Busca payload (`/payload/{message_id}`).
  - Entrega para o site cloud via `postMessage`.
  - Recebe `ack`/`settings_update` do site e repassa para API local.

- Bridge worklist (`bridge/index_worklist.html` + `bridge/bridge_worklist.js`)
  - Consulta `GET /worklist/raw`.
  - Envia `WORKLIST_DATA` ao iframe cloud via `postMessage`.
  - Recebe `ANAMNESE_RESULT` do iframe.
  - Persiste resultado via `POST /worklist/result`.

- Site cloud (`cloud_page`)
  - Carrega interface principal (`index2.html`).
  - Recebe `dicom_image` e `dicom_sr`.
  - Mantém imagens/SR em memória para fluxo de laudo, impressão e OCR.
  - Publica `settings_update` para o APP local.

## Fluxo principal

1. Ultrassom envia C-STORE para o APP local.
2. APP local extrai metadados e gera item de fila (`image` ou `sr`).
3. Bridge local chama `GET /queue/dequeue?n=1`.
4. Bridge baixa o conteúdo em `GET /payload/{message_id}`.
5. Bridge envia para o cloud:
   - `dicom_image` com `png_buffer` + `metadata`
   - `dicom_sr` com `sr_html` + `metadata`
6. Site processa e responde `ack`.
7. Bridge chama `POST /ack` e remove o item da fila.

## Endpoints locais usados pelo bridge

Base: `http://127.0.0.1:8787`

- `GET /heartbeat`
- `GET /queue/dequeue?n=1..20`
- `GET /payload/{message_id}`
- `POST /ack` body `{ "message_id": "..." }`
- `POST /settings` body `{ "MODEL_ACTIVATED": {...}, "ANALISE_CHOICE": {...} }`
- `POST /bridge/ping`
- `GET /worklist/config`
- `POST /worklist/config`
- `GET /worklist/status`
- `GET /worklist/items` (retorna cache atual e dispara refresh assíncrono)
- `GET /worklist/patients` (retorna lista derivada de pacientes e dispara refresh assíncrono)
- `POST /worklist/refresh`
- `GET /worklist/raw` (retorna payload bruto JSON-safe da worklist)
- `POST /worklist/result` (salva retorno do cloud em `./WORKLIST_DATA/`)

## Contrato de mensagens (cloud <-> bridge)

Origem bridge: `http://127.0.0.1:8099`

- Recebidas pelo cloud:
  - `dicom_image` -> `{ type, message_id, metadata, png_buffer }`
  - `dicom_sr` -> `{ type, message_id, metadata, sr_html }`

- Enviadas pelo cloud:
  - `ack` -> `{ type: "ack", message_id }`
  - `settings_update` -> `{ type: "settings_update", MODEL_ACTIVATED, ANALISE_CHOICE }`

## Contrato de mensagens (bridge worklist <-> cloud)

Origem bridge worklist: `http://<host>:8099`

- Enviadas pelo bridge worklist:
  - `WORKLIST_DATA` -> `{ type, source, timestamp, payload: { count, items, status, source } }`

- Recebidas do cloud:
  - `ANAMNESE_RESULT` -> `{ type, source, timestamp, payload: { header, selected_item, text } }`

## OCR no site

O OCR roda em iframe interno (`ocrdeveloping/index2.html`) e recebe mensagens encaminhadas por `bridge_client.js`.

- O campo de metadados do OCR exibe temporariamente o JSON completo de tags recebidas.
- A escolha de perfil de pré-processamento usa metadados DICOM:
1. tenta `fabricante + modelo`
2. se modelo não casar, tenta perfil por `fabricante`
3. se não casar fabricante, usa `default`
- O texto OCR consolidado é gerado por imagem (uma linha única) somente após finalizar todos os ROIs da imagem.
- A ordem da linha consolidada segue leitura natural dos boxes (linha por `y`, depois `x`).

Fabricantes reconhecidos por conteúdo textual nas tags: `Samsung`, `Philips`, `Vinno`, `GE`, `Toshiba`, `Canon`, `Esaote`.

## Worklist para integração futura do site

O frontend ainda não exibe controles de MWL, mas a infraestrutura backend já está pronta.

Fluxo esperado para consumo futuro:
1. Site chama `GET /worklist/items` ou `GET /worklist/patients`.
2. API responde imediatamente com o cache em memória atual.
3. Após responder, o backend dispara atualização MWL em background.
4. Nova chamada do site já tende a receber cache atualizado.

Para integração rápida de teste cloud, existe:

- `cloud_page/cloud_test_worklist.html`

## Metadados DICOM relevantes no fluxo

Além dos campos básicos, o APP tenta enviar:
- `Manufacturer` `(0008,0070)`
- `ManufacturerModelName` `(0008,1090)`
- `Modality` `(0008,0060)`
- `CodeMeaning` `(0008,0104)`
- `StudyDescription` `(0008,1030)`
- `SeriesDescription` `(0008,103E)`
- `ProtocolName` `(0018,1030)`
- `TransducerData` `(0018,5010)`
- `ProcessingFunction` `(0018,5020)`
- `SequenceOfUltrasoundRegions` `(0018,6011)`
- `TransducerType` `(0018,6031)`
- privadas `0019,xx10` e `0019,xx20` (normalizadas como `PrivateCreator0019` e `PresetName0019`)

## Estrutura principal do frontend

- `index2.html`: interface principal carregada no iframe cloud.
- `bridge_client.js`: integração com bridge local, ACK, settings, memória de imagens/SR.
- `script_main.js`: editor de laudo, modelos, prompt e estado da UI.
- `script_IA.js`: envio de conteúdo para endpoint de IA/n8n.
- `ocrdeveloping/index2.html` + `ocrdeveloping/app.js`: pipeline de OCR local no navegador.

## Regras arquiteturais

- O cloud não acessa DICOM diretamente.
- Toda integração com o APP local passa pelo bridge local.
- Dados recebidos (`png_buffer`, `sr_html`, metadata) são tratados como temporários em memória.
- `ack` só deve ser enviado após recebimento/processamento do item.
- Validação de `origin` no `postMessage` é obrigatória nos dois lados.
