# Arquitetura: a casa, os cômodos, os canais e os motores

- **Casa (hub):** `core/`. Estado no IndexedDB (`pedidos`, `reunioes`, `memoria`, `acoes`, `blobs`...), ajustes no localStorage, pipeline de 7 camadas, portão de confirmação e roteador.
- **Cômodos (módulos):** `modules/*.js`, cada um um passo a passo de uma área da vida. Carregados com `import()` só quando abertos.
- **Canais:** `channels/` (Telegram hoje). Entrada: voz e texto. Saída: só para o seu chat e só depois do seu toque.
- **Motores:** `engines/`. Motor 1 = Chefe Geral (Grok) via webhook, executa nas ferramentas (Microsoft 365, Google, Notion, LinkedIn, Canva, agenda, Telegram) pedindo o seu OK no chat. Motor 2 = Ollama no Mac (experimental), só responde.
- **Memória:** `memory/obsidian.js`. Captura contínua em Markdown com frontmatter, só na pasta `Chefe Geral`, sem sobrescrever. Busca de contexto para o motor (`obsidian_context`).

## Portão de confirmação
`core/gate.js` mostra exatamente o que vai sair e para quem. Só executa no toque em Enviar e registra a decisão em `acoes`. Mensagens para terceiros e escrita na agenda ficam com o Chefe Geral, que também pede o seu OK no chat antes de executar.

## Leveza
Casca de cerca de 50 KB. Módulos sob demanda. Listas paginadas (15 por vez) por cursor no índice `criado_em`. Arquivamento de concluídos com mais de 30 dias. Áudios ficam em `blobs`, fora das listas.
