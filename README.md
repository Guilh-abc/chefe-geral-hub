# Chefe Geral: hub pessoal (PWA)

**Penso, falo, executo.** O app é a casa; os módulos são os cômodos; os canais (Telegram, microfone, Obsidian) se ligam à casa; os motores (Chefe Geral/Grok agora, IA aberta no Mac depois) fazem o trabalho.

- Link (GitHub Pages): **https://guilh-abc.github.io/chefe-geral-hub/** (a raiz `guilh-abc.github.io` dá 404, é normal)
- 100% estático: HTML, CSS e JavaScript puro (ES modules), sem npm e sem servidor.
- Segredos nunca vão para o repositório. Na Ponte do Mac, a chave do webhook e o token do Telegram ficam em `~/Library/Application Support/ChefeGeral/` (chmod 600), digitados por você. No modo avançado e para o Obsidian, ficam só no localStorage do aparelho.
- Regra de ouro: **nada vai para ninguém, nem grava na agenda, sem o seu toque em Enviar.**

## O que funciona nesta versão

| Módulo | Estado | Como |
|---|---|---|
| Início | pronto | Campo grande com microfone (pt-BR do navegador), motor por pedido, indicador **Ponte do Mac: ligada/desligada**. |
| Pedidos | pronto | 7 camadas, lista paginada, arquivamento, reenviar. Sem a ponte: fila + botão **Abrir no Telegram**. |
| Reuniões | pronto | Gravar ou subir áudio/transcrição, regras editáveis, resumo (local, Chefe Geral ou Motor 2), revisão e envio só para o seu Telegram. |
| Agenda | pronto | Monte o evento, confira e grave você mesmo (Google, Outlook, .ics) ou peça ao Chefe Geral gravar, depois do seu OK. |
| Mensagens | pronto | Entrada: o que você mandou ao bot (pela ponte). Saída: mensagem para o seu chat, com portão de confirmação. |
| Tarefas | pronto | Hoje, próximas, feitas; prazo e prioridade; "Pedir ao Chefe Geral". |
| Notas de voz | pronto | Grava no aparelho (áudio não sai sozinho), transcrição ao vivo, vira pedido ou tarefa. |
| Segundo cérebro | pronto | Estado do Obsidian, fila, sincronizar, trazer capturas do Telegram, busca (a mesma do `obsidian_context`). |
| Canais e motores | pronto | Ponte do Mac, Telegram, Obsidian, Ollama. |

Transcrição no Mac: **VoiceStudio** (faster-whisper large-v3, pt, local). Voz e áudio mandados ao bot são transcritos pela ponte, e só o texto vai ao Chefe Geral (o áudio é apagado do Mac depois). No app do Mac, "Transcrever no Mac" em Notas de voz e Reuniões manda o áudio para `POST /transcrever` e mostra o texto. Com o VoiceStudio fechado, o bot responde "VoiceStudio fechado, transcrevo quando abrir" e a ponte tenta de novo a cada minuto. As gravações ficam no aparelho onde foram feitas.

### As 7 camadas de um pedido
1 Captura · 2 Triagem · 3 Contexto (notas do Obsidian) · 4 Envio ao motor · 5 Plano e seu OK · 6 Execução · 7 Retorno.
O app marca sozinho 1 a 4 (e 7 quando o motor já devolve a resposta). As camadas 5 e 6 acontecem no chat com o Chefe Geral; marque no app com os botões do pedido.

## Instalar no celular e no Mac

**iPhone:** Safari › abra o link › botão Compartilhar › Adicionar à Tela de Início.
**Android:** Chrome › abra o link › menu ⋮ › Instalar app (ou Adicionar à tela inicial).
**Mac (Chrome):** abra o link › ícone de instalar na barra de endereço (ou menu ⋮ › Transmitir, salvar e compartilhar › Instalar página como app).
**Mac (Safari 17+):** Arquivo › Adicionar ao Dock.

Microfone: na primeira vez o navegador pede permissão. A transcrição ao vivo funciona no Chrome (Mac e Android) e no Safari do iPhone; onde não houver, use o ditado do teclado ou cole a transcrição.

## Configurar (aba Canais)

### 1. Motor 1: Chefe Geral pela Ponte do Mac (padrão)
O webhook da rotina não aceita chamadas direto do navegador (CORS). Por isso o app fala com a **Ponte do Mac** em `http://127.0.0.1:8788`, que guarda a chave e repassa.

No Terminal do Mac (uma vez):
```
cd ~/Documents/ChefeGeral/chefe-geral-hub && git pull
./scripts/install-relay.sh "URL_DO_WEBHOOK"   # instala a ponte e o OLLAMA_ORIGINS fixo
./scripts/set-webhook-key.sh                   # cole a chave crsr_... (com ou sem "Bearer "; não aparece na tela); testa e mostra o HTTP
./scripts/set-telegram.sh                      # cole o token do BotFather e mande /start ao bot
./scripts/relay-status.sh                      # estado, log e saúde
curl -s http://127.0.0.1:8788/health
```
Use o **Chrome** no Mac (o Safari bloqueia `http://127.0.0.1` a partir de um site https). O Chrome pode pedir permissão para "acessar dispositivos da rede local": permita.
Logs: `~/Library/Logs/ChefeGeral/relay.log` (sem chave e sem token). Remover: `./scripts/uninstall-relay.sh`.
Modo direto (avançado, só se o webhook liberar CORS): Canais › Motor 1 › Avançado.

### Pelo celular
O celular não alcança o Mac. Dois caminhos:
1. **Telegram (recomendado):** mande texto ou voz ao seu bot. A ponte do Mac pega (só do seu chat_id), repassa ao Chefe Geral e responde "Recebido. A resposta completa chega no chat do Chefe Geral." (a rotina responde no chat do Grok Bot, não no Telegram). O Telegram guarda as mensagens por até 24 h se o Mac estiver desligado.
2. **App no celular:** o pedido fica na fila e o botão **Abrir no Telegram** abre o chat do bot com o pedido pronto; você toca em Enviar lá. Na reunião, o app compartilha o arquivo da transcrição com o Telegram.
Quando o app do Mac vê a ponte ligada, reenvia a fila sozinho (sem duplicar).

### Ponte na nuvem (opcional, não ativada)
`cloud/` tem a versão Cloudflare Worker (Telegram em modo webhook, segredos por `wrangler secret put`). Veja `cloud/README.md`.

### 2. Telegram (único canal de mensagens, gratuito)
1. No Telegram, fale com **@BotFather** › `/newbot` › escolha nome e usuário (terminando em `bot`).
2. Copie o **token**. Com a ponte: rode `./scripts/set-telegram.sh` no Mac e cole lá. Para o app enviar direto ao seu chat (Reuniões, Mensagens), cole também em Canais › Telegram (fica só no aparelho).
3. Abra o seu bot e mande `/start`.
4. Toque em **Descobrir chat_id** (usa `getUpdates`), confira o número e toque em **Salvar**.
5. Toque em **Enviar teste** e confirme. A mensagem chega no seu chat.

Envio: até 4096 caracteres vai como mensagem (`sendMessage`); acima disso vai como arquivo `.md` (`sendDocument`). Na reunião você pode anexar a transcrição completa em `.md`.

### 3. Segundo cérebro: Obsidian (pela Ponte do Mac)
A ponte grava as notas **direto no cofre**, só dentro de `Chefe Geral/`, e nunca altera notas existentes (não sobrescreve; sem duplicar por id). Configure o cofre uma vez (o caminho fica só no Mac, em relay.json):
```
./scripts/set-obsidian.sh ~/Documents/Obsidian
```
- Capturas do Telegram (texto, voz transcrita, `/reuniao`) viram nota na hora.
- O app manda a fila dele para `POST /obsidian/nota` sempre que alcança o Mac (do celular, quando você abrir o app no Mac).
- Cada nota ganha uma linha em `Chefe Geral/Diario/AAAA-MM-DD.md`.
- Contexto: `GET /obsidian/busca?q=` procura no cofre inteiro (só leitura, sem `.obsidian/`), até 5 trechos. A ponte preenche `obsidian_context` quando o app não mandou.
- **Permissão do macOS para a busca:** o macOS protege `~/Documents` e não aceita bem o python solto. A ponte roda dentro de um app pequeno, **Chefe Geral Ponte** (`~/Applications`), que recebe a permissão:
  ```
  ./scripts/build-ponte-app.sh && ./scripts/install-relay.sh
  open "$HOME/Applications/Chefe Geral Ponte.app"   # só na primeira vez, para o pedido aparecer
  ```
  Aparece "“Chefe Geral Ponte” gostaria de acessar arquivos na sua pasta Documentos." › **Permitir**. Se mesmo assim `curl -s http://127.0.0.1:8788/health` mostrar `busca_erro`: Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco › `+` › Cmd+Shift+G › `~/Applications` › Chefe Geral Ponte › Abrir › ativar, e `launchctl kickstart -k gui/$(id -u)/com.chefegeral.relay`. Recompilar o app muda a assinatura e pode pedir a permissão de novo.
- `/salvar texto` no bot guarda o texto em `Chefe Geral/Respostas/` sem mandar ao Chefe Geral (use para salvar respostas do chat).
- Plugin Local REST API: opcional (Canais › Obsidian).
```
Chefe Geral/
  Pedidos/  Reunioes/  Notas de voz/  Tarefas/  Agenda/  Respostas/  Inbox/
  Diario/AAAA-MM-DD.md
```
Frontmatter de cada nota: `data` (BRT), `modulo`, `id`, `origem`, `tags`.

### 4. Motor 2: Ollama no Mac (experimental)
IA aberta e gratuita. Responde aqui no app; não executa nas ferramentas.
```
ollama pull llama3.2   (já instalado no seu Mac)
# install-relay.sh já instala o LaunchAgent com.chefegeral.ollama-origins (roda no login):
launchctl setenv OLLAMA_ORIGINS "https://guilh-abc.github.io,http://localhost:*,http://127.0.0.1:*"
# feche e abra o app do Ollama
```
No app: Canais › Motor 2 › **Testar motor**. Funciona no Chrome do Mac (o navegador pode pedir permissão para acessar a rede local).

## Rodar localmente (para desenvolver)
```
./scripts/run-local.sh          # http://localhost:8787
```
Opcional, para abrir sozinho no login do Mac: `./scripts/install-mac.sh` (instala em `~/Applications/ChefeGeral-Console`, cria LaunchAgent `com.chefegeral.console` e um atalho "Chefe Geral.app"). Remover: `./scripts/uninstall-mac.sh`.

## Estrutura do código
```
index.html, manifest.webmanifest, sw.js, icons/   casca do PWA
core/        shell.js (casa, cartões, roteador), db.js (IndexedDB paginado + arquivamento),
             config.js (localStorage), pipeline.js (7 camadas), gate.js (portão de confirmação),
             voz.js (gravação + transcrição), ui.js, app.css
modules/     um arquivo por cômodo, carregado só quando aberto (import dinâmico)
channels/    telegram.js (outros canais se ligam aqui)
engines/     grok-webhook.js (Motor 1), ollama.js (Motor 2), rascunho-local.js
memory/      obsidian.js (captura e busca de contexto)
data/        vertentes.json (mapa das vertentes e atalhos)
config/      config.example.json (formato dos ajustes, sem segredos)
docs/        arquitetura, payload do webhook, fase 2 open source
scripts/, launchagent/   execução local no Mac
```
Leveza: a casca tem cerca de 50 KB; cada módulo é baixado só quando você abre. O service worker guarda a casca na instalação e os módulos depois do primeiro uso. Listas carregam em páginas de 15 e itens antigos podem ser arquivados.

## Novo cômodo
1. Crie `modules/<id>.js` com `export default async function abrir(el) { ... }`.
2. Registre em `MODULOS` dentro de `core/shell.js` (nome, descrição, canais, `pronto: true`, `resumo` opcional).
3. Qualquer envio para fora passa por `confirmar()` de `core/gate.js`.
