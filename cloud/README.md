# Ponte na nuvem (Cloudflare Worker)

Passo a passo e limites: [docs/nuvem.md](../docs/nuvem.md). Para instalar, rode `scripts/nuvem-instalar.sh` no Mac. Para voltar, rode `scripts/nuvem-desfazer.sh`.

- `worker.js`: as rotas estão no cabeçalho do arquivo.
- `schema.sql`: as tabelas do D1. O Worker também as cria sozinho.
- `wrangler.toml`: o modelo, sem segredos. O instalador gera `wrangler.local.toml` com o id do D1 e o chat_id, e esse arquivo fica fora do git.

Testes, na box ou no Mac:
```
node cloud/test/unit.mjs
node cloud/test/mock.mjs &          # Telegram e rotina falsos na porta 9911
cd cloud/test && cp .dev.vars.exemplo .dev.vars && npx wrangler dev -c wrangler.test.toml --port 8799 --local &
./cloud/test/integracao.sh
```
