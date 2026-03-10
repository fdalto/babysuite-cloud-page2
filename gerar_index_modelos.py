import os
import json

# Caminho da pasta modelos (ajuste se necessário)
PASTA_MODELOS = "modelos"

def gerar_index():
    if not os.path.isdir(PASTA_MODELOS):
        print(f"Pasta '{PASTA_MODELOS}' não encontrada.")
        return

    nomes = []

    for arquivo in os.listdir(PASTA_MODELOS):
        if arquivo.lower().endswith(".json") and arquivo != "index.json":
            nome = os.path.splitext(arquivo)[0]
            nomes.append(nome)

    nomes.sort()

    caminho_saida = os.path.join(PASTA_MODELOS, "index.json")

    with open(caminho_saida, "w", encoding="utf-8") as f:
        json.dump(nomes, f, ensure_ascii=False, indent=2)

    print("index.json gerado com sucesso:")
    print(nomes)

if __name__ == "__main__":
    gerar_index()
