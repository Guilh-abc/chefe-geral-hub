# Ponte na nuvem (Cloudflare Worker grátis)

Com ela, o Chefe Geral atende você 24 horas, mesmo com o Mac desligado. Tudo roda numa conta Cloudflare sua, no plano grátis.

## Como fica

- **Telegram** → Worker (webhook). O Worker transcreve áudio com o Whisper da Cloudflare, em português, repassa à rotina do Chefe Geral e confirma no bot.
- **App** (Mac e celular) → Worker, com o token do app. CORS liberado só para `https://guilh-abc.github.io`.
- **Respostas**: a box manda no Telegram, como hoje, e também grava no Worker.
- **Mac ligado**: a ponte do Mac para de ler o Telegram (o Telegram não deixa usar webhook e leitura direta ao mesmo tempo). A cada minuto ela puxa da nuvem o que é novo e grava no Obsidian, em `Chefe Geral/` (Pedidos, Transcricoes, Respostas, Reunioes). A cada 6 horas ela manda à nuvem um índice só com os nomes das notas da pasta Chefe Geral, para dar contexto aos pedidos.

## Com o Mac desligado

| Funciona | Espera o Mac ligar |
|---|---|
| Pedidos por texto, pelo bot ou pelo app | Gravação no Obsidian (fica na nuvem até lá) |
| Notas de voz e `/reuniao` transcritas na nuvem | Contexto com o conteúdo das notas (a nuvem só tem os nomes) |
| Respostas no Telegram e na aba Arquivo do app | Documentos e a busca no cofre na aba Arquivo |
| `/salvar` (vai para Respostas quando o Mac ligar) | Áudio que a nuvem não conseguiu transcrever (o Mac transcreve no VoiceStudio) |

## Ligar (uma vez, no Mac)

1. Se `npx -v` não responder no Terminal, instale o Node: `brew install node`.
2. `cd ~/Documents/ChefeGeral/chefe-geral-hub && git pull && ./scripts/nuvem-instalar.sh`
3. O navegador abre para o login no Cloudflare. Crie a conta grátis se ainda não tiver e autorize.
4. No fim, o script mostra a **URL do Worker**, o **token do app** e o **token de resposta**, uma vez só.
5. No app, no Mac e no celular: **Canais › Ponte na nuvem**. Marque a opção, cole a URL e o token do app, toque em Salvar e depois em Testar.
6. Cole o token de resposta no campo seguro que o Chefe Geral pedir no chat.

## Voltar ao modo local

`./scripts/nuvem-desfazer.sh` desliga o webhook e devolve o Telegram à ponte do Mac. Depois, em cada aparelho, vá em Canais › Ponte na nuvem, desmarque a opção e toque em Salvar.

## Limites do plano grátis

- Workers: 100 mil requisições por dia e 10 ms de CPU por requisição. A espera pela IA não conta como CPU.
- Workers AI: 10 mil neurons por dia. O Whisper turbo gasta uns 47 neurons por minuto de áudio, então dá umas 3 horas e meia de áudio por dia.
- D1: 5 GB, 5 milhões de leituras e 100 mil gravações por dia.
- Áudio: o bot do Telegram só baixa arquivos de até 20 MB. Reuniões longas podem passar do tempo de CPU ou do limite do Whisper. Nesse caso o áudio fica pendente e o Mac transcreve no VoiceStudio quando ligar.

## Segurança

- Os segredos ficam só no Cloudflare (`wrangler secret`): a chave da rotina, o token do bot, o segredo do webhook, o token do app e o token de resposta.
- O bot só atende o seu chat_id. Mensagens de outras pessoas são ignoradas.
- No Mac, `nuvem.json` tem permissão 600. No app, o token fica só no localStorage do aparelho.

## Obsidian na nuvem (Worker 2.1 + ponte do Mac 1.5)

A pasta **Chefe Geral** do cofre (`~/Documents/Obsidian/Chefe Geral`) tem uma cópia privada na sua conta Cloudflare, no bucket R2 `chefe-geral-obsidian` (plano grátis: 10 GB). Só essa pasta, só notas `.md` de até 1 MB. Nada é público: toda rota pede o token do app.

**Como sincroniza** (a ponte do Mac, a cada 2 minutos, com o Mac ligado e `"modo": "nuvem"`):

| Situação | O que acontece |
|---|---|
| Nota nova ou alterada no Mac | sobe para a nuvem |
| Nota nova ou alterada na nuvem (respostas, transcrições, notas pedidas pelo Telegram) | desce para o cofre |
| Mudou dos dois lados | as duas versões ficam: a da nuvem vira `Nome (conflito nuvem AAAA-MM-DD HHhMM).md` ao lado |
| Apagou de um lado | não propaga. Nada é apagado em lugar nenhum |
| Nota com cara de segredo ou coordenada | não sobe (aparece no log da ponte) |

O estado fica em `~/Library/Application Support/ChefeGeral/obsidian-nuvem-estado.json`. Para desligar só o espelho: `"obsidian_nuvem": false` no `relay.json` e reinicie a ponte.

**Rotas novas do Worker** (Bearer do app): `GET /obsidian/list`, `GET /obsidian/get?caminho=`, `POST /obsidian/put {caminho, md, base_sha}`, `GET /obsidian/busca?q=`. O token de resposta (box) só cria nota nova. Os pedidos que chegam pela nuvem levam trechos dessas notas como contexto (`fonte: obsidian-nuvem`), mesmo com o Mac desligado.

**No app** (cache `cg-v9`): Arquivo › Obsidian mostra as notas da nuvem e tem busca, no celular e no Mac.

**Instalar ou atualizar**
- Primeira vez: `./scripts/nuvem-instalar.sh` (já cria o bucket).
- Já tem a nuvem: `./scripts/nuvem-atualizar.sh` cria o bucket se faltar, publica o Worker e troca a ponte para a 1.5 (backup `relay.py.bak-1.4`), **sem trocar tokens**.
- Se aparecer erro de R2: ative em dash.cloudflare.com › R2 Object Storage (plano grátis; a Cloudflare pode pedir um cartão para ativar, sem cobrança dentro do limite) e rode de novo.

**Testar**
1. Mac ligado: crie `Chefe Geral/Inbox/teste nuvem.md` no Obsidian. Em até 2 min ela aparece no app do celular em Arquivo › Obsidian.
2. Mac desligado: mande no Telegram uma pergunta sobre algo que está nessas notas. A resposta usa o trecho. Ao ligar o Mac, respostas e notas novas descem para o cofre.
3. Conflito: edite a mesma nota no Mac e na nuvem antes de sincronizar; aparece o arquivo `(conflito ...)` ao lado.
