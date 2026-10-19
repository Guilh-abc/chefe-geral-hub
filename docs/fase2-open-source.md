# Fase 2: pilha aberta e gratuita no Mac

Objetivo: o Mac vira um motor local que se liga à casa, sem custo e sem mandar dados para fora quando não precisa.

| Peça | Ferramenta aberta | Papel |
|---|---|---|
| Transcrição | whisper.cpp (`whisper-cli`, modelo `ggml-small` ou `large-v3-turbo`, pt) | Transcrever áudios enviados e notas de voz do Telegram, sem a Web Speech API |
| IA local | Ollama (`llama3.2:3b` para rápido, `qwen2.5:7b` ou `llama3.1:8b` para resumo) | Motor 2: triagem, resumo de reuniões, rascunhos |
| Embeddings | Ollama `nomic-embed-text` ou `bge-m3` | Busca semântica no cofre do Obsidian |
| Índice | SQLite com `sqlite-vec` (ou arquivo JSON simples no começo) | Vetores das notas da pasta `Chefe Geral` e do cofre principal |
| Ponte | Pequeno servidor Python stdlib em `127.0.0.1` | Recebe áudio do app, roda whisper.cpp, devolve texto; indexa o cofre |

## Passos
1. Motor 2 já existe no app (Canais › Motor 2). Liberar a origem: `launchctl setenv OLLAMA_ORIGINS "https://guilh-abc.github.io"`.
2. Instalar whisper.cpp (`brew install whisper-cpp`) e baixar um modelo. A ponte local expõe `POST /transcrever` e o módulo Reuniões passa a transcrever arquivos.
3. Embeddings sobre o cofre: a ponte lê as notas `.md` (somente leitura), gera vetores com `nomic-embed-text` e responde `POST /contexto` com os trechos mais parecidos. `memory/obsidian.js` passa a usar isso no lugar do `/search/simple/`.
4. Telegram como entrada: a ponte faz `getUpdates`, baixa notas de voz, transcreve e cria pedidos na casa.
5. Seleção de motor por tipo de tarefa: resumo e triagem no Motor 2; execução em ferramentas continua no Motor 1.

Regras que continuam valendo: nada sai sem o seu toque; o cofre só recebe notas novas na pasta `Chefe Geral`; nenhum segredo no repositório.
