# AGENTS.md: Chefe Geral hub

Guia para agentes (opencode e outros) que trabalham neste repositório.

## O que é
PWA estático publicado no GitHub Pages. **Endereço do app: https://guilh-abc.github.io/chefe-geral-hub/** (com a barra final).
Um 404 em https://guilh-abc.github.io/ (a raiz, sem `/chefe-geral-hub/`) é **esperado**: não existe site de usuário e não deve ser criado. Não crie o repositório `guilh-abc.github.io` nem redirecionamentos.
HTML, CSS e JavaScript puro (ES modules). Sem npm, sem build, sem framework.

## Arquitetura: a casa
- **Casa (hub):** `core/`
  - `shell.js`: tela inicial ("Penso, falo, executo"), cartões dos cômodos, roteador por hash (`#/modulo`), registro `MODULOS`.
  - `db.js`: IndexedDB com paginação por cursor (`pagina`), contagem e arquivamento (`arquivarAntigos`).
  - `config.js`: ajustes no localStorage (`cg.ajustes.v1`). Único lugar onde ficam chaves, e só no aparelho.
  - `pipeline.js`: as 7 camadas de um pedido (Captura, Triagem, Contexto, Envio ao motor, Plano e seu OK, Execução, Retorno).
  - `gate.js`: portão de confirmação (`confirmar()`), obrigatório para qualquer coisa que saia do aparelho.
  - `voz.js`: MediaRecorder + Web Speech API (pt-BR).
- **Cômodos (módulos):** `modules/<id>.js`, `export default async function abrir(el)`. Carregados com `import()` só quando abertos.
- **Canais:** `channels/` (hoje só `telegram.js`, Bot API, mensagens só para o chat do próprio Guilherme).
- **Motores:** `engines/`
  - Motor 1 (padrão): `grok-webhook.js`, Chefe Geral via rotina de webhook. Executa nas ferramentas dele.
  - Motor 2 (experimental): `ollama.js`, Ollama no Mac em `http://127.0.0.1:11434`. Só responde, não executa.
  - `rascunho-local.js`: rascunho estruturado sem IA.
- **Memória:** `memory/obsidian.js`, plugin Local REST API do Obsidian. Escreve só na pasta `Chefe Geral` do cofre.
- Formato do payload do webhook: `docs/webhook-payload.md`.

## Regras (obrigatórias)
1. Toda a interface em português do Brasil.
2. Escreva **Telekom** com K.
3. Não use travessão (o caractere em-dash) em nenhum texto, código ou commit.
4. **Nenhum segredo no repositório**: URL e chave do webhook, token e chat_id do Telegram, API key do Obsidian ficam só no localStorage do aparelho. Antes de cada commit: `rg -n -i "bearer |bot[0-9]{6,}:|api[_-]?key" .`
5. **Nada é enviado a ninguém, nem grava na agenda, sem o toque explícito do Guilherme.** Qualquer envio passa por `confirmar()` de `core/gate.js`.
6. Módulos leves e carregados sob demanda. A casca (index, core, css) deve ficar abaixo de ~100 KB. Nada de bibliotecas externas.
7. Obsidian: só criar notas novas dentro de `Chefe Geral/`. Nunca alterar ou apagar notas existentes.
8. Nunca tocar em `~/Documents/nrf9151-ntn`.
9. Nunca mencionar BMW.
10. Ao mudar arquivos da casca, suba a versão do cache em `sw.js` (`const V = "cg-vN"`).

## Novo cômodo
1. Crie `modules/<id>.js` com `export default async function abrir(el) {}`.
2. Em `core/shell.js`, no array `MODULOS`, marque `pronto: true` e, se quiser, uma função `resumo`.
3. Dados novos: adicione a store em `STORES` de `core/db.js` e suba `VERSAO`.

## Ponte do Mac e Motor 2
- Ponte: `relay/relay.py` em 127.0.0.1:8788 (LaunchAgent `com.chefegeral.relay`). Instalar: `./scripts/install-relay.sh`. Estado: `./scripts/relay-status.sh`.
- Chave do webhook e token do Telegram ficam em `~/Library/Application Support/ChefeGeral/` (chmod 600) e são digitados pelo Guilherme em `./scripts/set-webhook-key.sh` e `./scripts/set-telegram.sh`. Agentes nunca leem, imprimem ou registram esses arquivos.
- Ollama (Motor 2): `OLLAMA_ORIGINS` fica fixo no login pelo LaunchAgent `com.chefegeral.ollama-origins` (instalado junto com a ponte), com valor `https://guilh-abc.github.io,http://localhost:*,http://127.0.0.1:*`. Depois de mudar, reabra o Ollama.
- Transcrição no Mac (STT): pausada até o Guilherme escolher o motor (VoiceStudio ou SoundCraft). Não instale modelos.

## Testar localmente
```
cd ~/Documents/ChefeGeral/chefe-geral-hub
python3 -m http.server 8787
# abra http://localhost:8787 no Chrome e veja o Console (Cmd+Option+J): não pode haver erros
```
Checklist: tela inicial com cartões; abrir cada cômodo; criar um pedido; Reuniões com um .txt; nenhum erro no console.

## Publicar
Só depois que o Guilherme confirmar:
```
git add -A && git commit -m "mensagem em português" && git push
```
O GitHub Pages publica a branch `main` (raiz) em 1 a 2 minutos em https://guilh-abc.github.io/chefe-geral-hub/
