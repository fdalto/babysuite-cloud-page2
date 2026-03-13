# Pipeline de Detecção de Texto Colorido a partir de ImageData

Este documento descreve conceitualmente um pipeline de processamento de imagem voltado para detectar **linhas de texto colorido** em imagens utilizando apenas dados de `ImageData` obtidos de um `canvas` no navegador.

O objetivo é identificar regiões prováveis de texto (ROIs) que posteriormente poderão ser enviadas para um sistema de OCR.

---

# Visão geral do pipeline

O processamento segue as seguintes etapas:

ImageData  
→ máscara HSV (verde/amarelo/laranja)  
→ dilatação horizontal  
→ dilatação vertical leve  
→ connected components  
→ merge de boxes próximos  
→ filtro por formato  
→ geração das ROIs

Cada etapa é descrita em detalhes abaixo.

---

# 1. Entrada: ImageData

O pipeline começa com um objeto `ImageData` obtido de um elemento `canvas`.

Esse objeto contém:

- largura da imagem (`width`)
- altura da imagem (`height`)
- um array linear de pixels no formato RGBA

Estrutura típica do array:

```
data = [R,G,B,A, R,G,B,A, ...]
```

Cada pixel ocupa **4 posições consecutivas** no array.

Para acessar um pixel `(x,y)`:

```
index = (y * width + x) * 4
```

Então:

```
R = data[index]
G = data[index + 1]
B = data[index + 2]
```

Esses valores são usados para determinar se o pixel pertence ao texto colorido.

---

# 2. Construção da máscara HSV (detecção de cor)

O texto na imagem aparece normalmente em cores específicas:

- verde
- amarelo
- laranja

Detectar essas cores diretamente em RGB não é ideal. Portanto, os pixels são convertidos para o espaço de cor **HSV (Hue, Saturation, Value)**.

Para cada pixel:

1. converter RGB → HSV
2. verificar se a cor pertence a uma faixa desejada

## Faixas de Hue aproximadas

```
verde   → H entre 70° e 170°
amarelo → H entre 35° e 75°
laranja → H entre 15° e 40°
```

## Saturação mínima

Evita detectar pixels quase cinza:

```
S > 0.25
```

## Brilho mínimo

Evita ruído muito escuro:

```
V > 0.2
```

Se o pixel satisfaz esses critérios:

```
mask[x,y] = 1
```

Caso contrário:

```
mask[x,y] = 0
```

Resultado:

Uma **imagem binária** onde:

- `1` representa pixel com cor parecida com o texto
- `0` representa fundo

---

# 3. Dilatação horizontal

Texto possui letras separadas por pequenos espaços.

Se a máscara fosse usada diretamente, cada letra poderia virar um componente isolado.

Para resolver isso, aplica-se **dilatação horizontal**.

A lógica:

Para cada pixel marcado como `1`, também marcar alguns pixels à esquerda e à direita.

Visualmente:

Antes:

```
█   █   █
```

Depois:

```
█████████
```

Isso ajuda a:

- unir letras da mesma palavra
- fechar pequenas falhas na máscara

Tamanho típico da dilatação:

```
3 a 8 pixels
```

Esse valor depende da resolução da imagem.

---

# 4. Dilatação vertical leve

Após a dilatação horizontal, aplica-se uma **dilatação vertical pequena**.

Objetivo:

- unir partes da mesma linha que estejam levemente desalinhadas
- preencher pequenos buracos verticais

Exemplo:

Antes:

```
██ ██
██ ██
```

Depois:

```
█████
█████
```

A dilatação vertical deve ser **bem menor que a horizontal** para evitar unir linhas diferentes.

Valores típicos:

```
1 ou 2 pixels
```

---

# 5. Detecção de componentes conectados

Depois das dilatações, a máscara contém regiões contínuas.

Agora é necessário identificar **blocos conectados de pixels**.

Isso é feito com um algoritmo chamado **Connected Components Labeling**.

A ideia:

Percorrer todos os pixels da máscara e agrupar pixels vizinhos que estejam marcados como `1`.

Os vizinhos considerados podem ser:

```
4-conectividade
ou
8-conectividade
```

A **8-conectividade** costuma funcionar melhor para texto.

Para cada componente encontrado, calcula-se um **bounding box**:

```
minX
minY
maxX
maxY
```

Também é útil calcular:

```
width
height
area
```

Cada componente representa uma **região candidata a texto**.

---

# 6. Merge de boxes próximos

Mesmo após a dilatação, uma linha de texto pode aparecer como vários componentes separados.

Exemplo:

```
palavra1   palavra2
```

ou

```
texto   quebrado
```

Por isso é feita uma etapa de **merge de bounding boxes**.

Dois boxes devem ser unidos quando:

## Distância horizontal pequena

```
gapX < limite
```

Exemplo típico:

```
8–15 pixels
```

## Sobreposição vertical suficiente

Para garantir que pertencem à mesma linha.

Pode-se calcular:

```
overlap = interseção vertical
overlapRatio = overlap / menorAltura
```

Exemplo de regra:

```
overlapRatio > 0.4
```

Quando essas condições são satisfeitas:

- os dois boxes são substituídos por um único box maior.

Esse processo pode ser repetido até não haver mais merges possíveis.

---

# 7. Filtro por formato

Após o merge, alguns componentes ainda podem ser ruído.

Aplica-se então um filtro baseado nas características geométricas.

Critérios comuns:

## Largura mínima

Remove regiões muito pequenas.

```
width > 20 px
```

## Altura mínima

Evita linhas muito finas.

```
height > 6 px
```

## Área mínima

Remove pequenos pontos.

```
area > 30 pixels
```

## Razão largura/altura

Linhas de texto tendem a ser mais largas que altas.

```
width / height > 1.2
```

Esses valores devem ser ajustados conforme a resolução da imagem.

---

# 8. Geração das ROIs

Depois dos filtros, os boxes restantes são considerados **regiões candidatas a texto**.

Para cada box:

```
ROI = imagem[minX:maxX, minY:maxY]
```

Essa região é então:

- recortada da imagem original
- armazenada como ROI
- preparada para envio ao OCR

Também é comum **expandir o box alguns pixels** para evitar cortar caracteres:

```
expandir 3–5 pixels em cada lado
```

sempre respeitando os limites da imagem.

---

# 9. Resultado final

O resultado do pipeline é uma lista de ROIs contendo:

```
x
y
width
height
imagem recortada
```

Essas regiões representam **linhas de texto detectadas pela cor**.

Posteriormente cada ROI poderá ser enviada para um motor de OCR.

---

# 10. Fluxo resumido

O pipeline completo pode ser representado assim:

```
ImageData
↓
converter RGB → HSV
↓
detectar pixels verde/amarelo/laranja
↓
gerar máscara binária
↓
dilatação horizontal (unir letras)
↓
dilatação vertical leve
↓
detectar componentes conectados
↓
gerar bounding boxes
↓
unir boxes próximos
↓
filtrar boxes inválidos
↓
recortar ROIs
```

---

# 11. Objetivo

O objetivo desse pipeline é produzir **regiões candidatas de texto** que possam ser processadas posteriormente por um sistema de OCR.

A abordagem funciona especialmente bem quando:

- o texto possui cor característica
- o fundo é relativamente diferente dessas cores
- as linhas de texto são aproximadamente horizontais.

