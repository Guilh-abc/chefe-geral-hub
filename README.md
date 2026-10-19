# Chefe Geral: hub pessoal (PWA)

**Penso, falo, executo.** O app é a casa; os módulos são os cômodos; os canais (Telegram, microfone, Obsidian) se ligam à casa; os motores (Chefe Geral/Grok agora, IA aberta no Mac depois) fazem o trabalho.

- Link (GitHub Pages): `https://guilh-abc.github.io/chefe-geral-hub/` (depois de publicado)
- 100% estático: HTML, CSS e JavaScript puro (ES modules), sem npm e sem servidor.
- Chaves (webhook, Telegram, Obsidian) ficam **só no localStorage do aparelho**. Nada de segredo neste repositório.
- Regra de ouro: **nada vai para ninguém, nem grava na agenda, sem o seu toque em Enviar.**

## O que funciona nesta versão (fase 1)

| Módulo | Estado | Como |
|---|---|---|
| Início | pronto | Campo grande com microfone (transcrição pt-BR do navegador) e botão Pedir. Escolha do motor por pedido. |
| Pedidos | pronto | Cada pedido com as 7 camadas, lista paginada, arquivamento, reenviar, marcar camadas. |
| Reuniões | pronto | Gravar (MediaRecorder) com transcrição ao vivo, ou subir áudio/transcrição. Regras editáveis. Rascunho no navegador, resumo pelo Chefe Geral ou pelo Motor 2. Revisão e envio só para o seu Telegram. |
| Canais e motores | pronto | Webhook do Chefe Geral, Telegram (assistente BotFather + teste), Obsidian, Ollama. |
| Agenda, Mensagens, Tarefas, Notas de voz, Segundo cérebro (tela) | próxima versão | Cartões já aparecem. Enquanto isso, peça pela tela inicial. |

A captura para o Obsidian já funciona por baixo: pedidos, transcrições e resumos enviados viram notas (fila no aparelho ou gravação direta pelo plugin).

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

### 1. Motor 1: Chefe Geral (webhook)
1. No Grok Bot, abra o painel da rotina **"Console Chefe Geral, pedidos do app"**.
2. Copie a **URL do webhook** e a **chave**. O painel mostra o formato do cabeçalho.
3. No app: Canais › Motor 1 › cole a URL; cabeçalho `Authorization` (padrão); no valor, cole exatamente como o painel mostra (por exemplo `Bearer xxxxx`, se for assim que aparece).
4. Toque em **Testar motor**. Deve aparecer "Entregue ao Chefe Geral (HTTP 200)".

Se o teste falhar com "rede ou CORS", o webhook não aceita chamadas direto do navegador. Veja `docs/webhook-payload.md`.

### 2. Telegram (único canal de mensagens, gratuito)
1. No Telegram, fale com **@BotFather** › `/newbot` › escolha nome e usuário (terminando em `bot`).
2. Copie o **token** e cole em Canais › Telegram.
3. Abra o seu bot e mande `/start`.
4. Toque em **Descobrir chat_id** (usa `getUpdates`), confira o número e toque em **Salvar**.
5. Toque em **Enviar teste** e confirme. A mensagem chega no seu chat.

Envio: até 4096 caracteres vai como mensagem (`sendMessage`); acima disso vai como arquivo `.md` (`sendDocument`). Na reunião você pode anexar a transcrição completa em `.md`.

### 3. Segundo cérebro: Obsidian
O app grava **só** dentro da pasta `Chefe Geral` do cofre e **nunca** altera notas existentes (confere antes e não sobrescreve).
1. Obsidian no Mac › Ajustes › Plugins da comunidade › Ativar plugins da comunidade › Procurar › **Local REST API** › Instalar › Ativar.
2. Nas opções do plugin, copie a **API Key**.
3. No Chrome do Mac, abra `https://127.0.0.1:27124` uma vez e aceite o certificado do plugin.
4. No app: Canais › Obsidian › cole a chave, informe o nome do cofre, **Testar** e **Sincronizar fila**.

Estrutura criada no cofre:
```
Chefe Geral/
  Pedidos/      AAAA-MM-DD HHhMM titulo id.md
  Reunioes/     transcrição e resumo
  Notas de voz/
  Inbox/
  Diario/       AAAA-MM-DD.md (uma linha por captura, com link)
```
Cada nota tem frontmatter YAML: `data` (BRT), `modulo`, `id`, `origem`, `tags`.
Sem o plugin (ou no celular), as notas ficam na fila do aparelho (IndexedDB) e vão para o cofre quando você tocar em Sincronizar no Mac.
Contexto: antes de enviar um pedido, o app busca notas relacionadas (`/search/simple/` do plugin, ou a fila local) e manda os trechos no campo `obsidian_context`.

### 4. Motor 2: Ollama no Mac (experimental)
IA aberta e gratuita. Responde aqui no app; não executa nas ferramentas.
```
ollama pull llama3.2   (já instalado no seu Mac)
launchctl setenv OLLAMA_ORIGINS "https://guilh-abc.github.io"
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
