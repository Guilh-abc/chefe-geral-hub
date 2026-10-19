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
