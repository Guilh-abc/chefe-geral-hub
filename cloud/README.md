# Ponte na nuvem (Cloudflare Worker): documentada, NÃO ativada

Alternativa à Ponte do Mac para quando o Mac estiver desligado. Mesmo contrato (`/health`, `/pedido`, `/mensagens`, `/memoria`), mais o modo **webhook do Telegram** (em vez de long-poll). Nada aqui foi publicado nem ligado.

## Quando faz sentido
- Mandar pedidos do celular com o Mac desligado.
- Custo: plano gratuito do Workers (100 mil requisições/dia) cobre o uso pessoal.

## Diferenças para a Ponte do Mac
- Não transcreve áudio (não há motor local). O áudio vai como `telegram_file_id` no payload.
- Não fala com o Obsidian; capturas ficam no KV até o app trazer (Segundo cérebro › Trazer capturas).
- O app precisa de um token próprio (`APP_TOKEN`), porque a nuvem é alcançável por qualquer um. A ponte do Mac não precisa (só escuta em 127.0.0.1).
- **Webhook e long-poll não convivem**: com o webhook do Telegram ligado, a Ponte do Mac deixa de receber mensagens do bot. Escolha um dos dois.

## Ativar (só quando decidir)
```
npm i -g wrangler            # ou: npx wrangler ...
cd cloud
wrangler login
# CHAT_ID em wrangler.toml (não é segredo). Opcional: KV para mensagens/capturas
wrangler kv namespace create CHEFE   # cole o id em wrangler.toml
wrangler secret put WEBHOOK_URL       # URL da rotina "Console Chefe Geral, pedidos do app"
wrangler secret put WEBHOOK_KEY       # a chave (você cola; não fica em arquivo)
wrangler secret put TELEGRAM_TOKEN    # token do BotFather
wrangler secret put TELEGRAM_SECRET   # uma frase aleatória longa (ex.: openssl rand -hex 24)
wrangler secret put APP_TOKEN         # outra frase aleatória; você cola no app em Canais
wrangler deploy                       # mostra https://chefe-geral-ponte.<sua-conta>.workers.dev
```
Ligar o webhook do Telegram (desliga o long-poll da Ponte do Mac):
```
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url="https://chefe-geral-ponte.<sua-conta>.workers.dev/telegram" \
  -d secret_token="<TELEGRAM_SECRET>" -d allowed_updates='["message"]'
```
No app: Canais › Motor 1 › Endereço da ponte = a URL do Worker; Token da ponte na nuvem = o `APP_TOKEN`.

## Desligar e voltar para o Mac
```
curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
wrangler delete
```
E em Canais volte o endereço para `http://127.0.0.1:8788`.

## Segurança
- Segredos só via `wrangler secret put`. Nada em `wrangler.toml` ou no repositório.
- Só o `CHAT_ID` configurado é atendido; o restante é ignorado.
- `/telegram` exige o `secret_token`; as rotas do app exigem `X-Chefe-Token` e a origem https://guilh-abc.github.io (ou localhost no dev).
- Nada é enviado a terceiros nem grava agenda: o Worker só repassa ao Chefe Geral, que pede o seu OK.
