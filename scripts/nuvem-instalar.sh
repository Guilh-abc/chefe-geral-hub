#!/bin/bash
# Liga a ponte do Chefe Geral na nuvem (Cloudflare Worker GRÁTIS, na SUA conta). Rode no Mac, na pasta do repo:
#   ./scripts/nuvem-instalar.sh
# O que faz: login no Cloudflare (abre o navegador), cria o banco D1, publica o Worker, grava os segredos
# (lidos dos arquivos que a ponte do Mac já tem; tokens novos gerados aqui), liga o webhook do Telegram,
# grava ~/Library/Application Support/ChefeGeral/nuvem.json (600) e põe a ponte do Mac em "modo": "nuvem".
# Pode rodar de novo sem estragar nada (reaproveita o banco e gera tokens novos). Desfazer: ./scripts/nuvem-desfazer.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"; CLOUD="$REPO/cloud"
DIR="$HOME/Library/Application Support/ChefeGeral"
LOCAL_TOML="$CLOUD/wrangler.local.toml"   # gerado aqui, fica fora do git
W="npx -y wrangler@4"
# Mostra o erro real, sem tokens, e para.
limpar(){ printf '%s' "$1" | sed -E 's/bot[0-9]+:[A-Za-z0-9_-]+/bot<token>/g; s/[0-9a-f]{40,}/<token>/g; s/(Bearer|token[=:]) *[^ "]+/\1 <token>/gI'; }
falha(){ echo; echo "Erro ao $1:"; limpar "$2" | tail -n 25; echo; echo "Nada foi mudado na ponte do Mac. Corrija e rode o script de novo."; exit 1; }
trap 'echo "Erro inesperado na linha $LINENO (comando: $(limpar "$BASH_COMMAND"))."' ERR

if ! command -v npx >/dev/null 2>&1; then
  echo "Falta o Node.js (npx). Instale com:  brew install node   (ou baixe em https://nodejs.org) e rode de novo."; exit 1
fi
for f in webhook.key telegram.token relay.json; do
  [ -s "$DIR/$f" ] || { echo "Falta $DIR/$f (a ponte do Mac precisa estar configurada antes)."; exit 1; }
done
CHAT_ID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("chat_id",""))' "$DIR/relay.json")
[ -n "$CHAT_ID" ] || { echo "chat_id vazio em relay.json"; exit 1; }
WH_URL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("webhook_url",""))' "$DIR/relay.json")
[ -n "$WH_URL" ] || { echo "webhook_url vazio em relay.json"; exit 1; }
TG_TOKEN=$(tr -d '\r\n' < "$DIR/telegram.token")

echo "1/7 Login no Cloudflare (abre o navegador; crie a conta grátis se ainda não tiver)..."
cd "$CLOUD"
logado(){ local o; o=$($W whoami 2>&1) || return 1; ! echo "$o" | grep -qiE "not authenticated|not logged in|nao autenticado"; }
if ! logado; then
  echo "   Abrindo o login. Se o navegador não abrir, copie o link que aparecer abaixo."
  $W login </dev/tty || true
fi
if ! logado; then
  echo "Você não está logado no Cloudflare. Rode no Terminal:  npx -y wrangler@4 login"
  echo "Autorize no navegador e depois rode este script de novo."; exit 1
fi
echo "   Logado no Cloudflare."

echo "2/7 Banco D1 'chefe-geral'..."
LISTA=$($W d1 list --json 2>&1) || falha "listar bancos D1" "$LISTA"
DBID=$(printf '%s' "$LISTA" | python3 -c 'import json,sys
try:
  l=json.load(sys.stdin)
except Exception: l=[]
print(next((d.get("uuid") or d.get("database_id") or "" for d in l if d.get("name")=="chefe-geral"),""))')
if [ -z "$DBID" ]; then
  OUT=$($W d1 create chefe-geral 2>&1) || falha "criar o banco D1" "$OUT"
  DBID=$(echo "$OUT" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi
[ -n "$DBID" ] || { echo "Não consegui o id do banco D1. Rode: npx wrangler d1 list"; exit 1; }
sed -e "s/00000000-0000-0000-0000-000000000000/$DBID/" -e "s/^CHAT_ID = \"\".*/CHAT_ID = \"$CHAT_ID\"/" -e "s|^WEBHOOK_URL = \"\".*|WEBHOOK_URL = \"$WH_URL\"|" wrangler.toml > "$LOCAL_TOML"
OUT=$($W d1 execute chefe-geral --remote --yes --file schema.sql -c "$LOCAL_TOML" 2>&1) || falha "criar as tabelas no D1" "$OUT"

echo "3/7 Publicando o Worker..."
OUT=$($W deploy -c "$LOCAL_TOML" 2>&1) || falha "publicar o Worker" "$OUT"
URL=$(echo "$OUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "$OUT"; echo "Não achei a URL do Worker na saída acima."; exit 1; }
echo "   $URL"

echo "4/7 Segredos (não aparecem na tela)..."
APP_TOKEN=$(openssl rand -hex 24); RESP_TOKEN=$(openssl rand -hex 24); TG_SECRET=$(openssl rand -hex 24)
put(){ local o; o=$(printf '%s' "$2" | $W secret put "$1" -c "$LOCAL_TOML" 2>&1) || falha "gravar o segredo $1" "$o"; echo "   $1 ok"; }
put WEBHOOK_KEY "$(tr -d '\r\n' < "$DIR/webhook.key")"
put TELEGRAM_TOKEN "$TG_TOKEN"
put TELEGRAM_SECRET "$TG_SECRET"
put APP_TOKEN "$APP_TOKEN"
put RESPOSTA_TOKEN "$RESP_TOKEN"
sleep 3
curl -fsS "$URL/health" | grep -q '"chave_presente":true' && echo "   Worker respondeu /health" || echo "   Aviso: /health ainda não confirmou a chave; confira em alguns segundos: curl $URL/health"

echo "5/7 Ponte do Mac em modo nuvem (para o long-poll do Telegram)..."
umask 077
python3 - "$DIR/nuvem.json" "$URL" "$APP_TOKEN" <<'PY'
import json, os, sys
json.dump({"url": sys.argv[2], "token": sys.argv[3]}, open(sys.argv[1], "w")); os.chmod(sys.argv[1], 0o600)
PY
python3 - "$DIR/relay.json" <<'PY'
import json, sys
p = sys.argv[1]; c = json.load(open(p)); c["modo"] = "nuvem"; json.dump(c, open(p, "w"), ensure_ascii=False, indent=2)
PY
mkdir -p "$DIR/relay" && cp "$REPO/relay/relay.py" "$DIR/relay/relay.py"   # ponte 1.4 (sabe o modo nuvem)
launchctl kickstart -k "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || echo "   (reinicie a ponte: ./scripts/install-relay.sh)"
sleep 2

echo "6/7 Webhook do Telegram -> Worker..."
R=$(curl -sS "https://api.telegram.org/bot$TG_TOKEN/setWebhook" --data-urlencode "url=$URL/telegram" \
  --data-urlencode "secret_token=$TG_SECRET" --data-urlencode 'allowed_updates=["message"]' --data-urlencode "max_connections=5")
echo "$R" | grep -q '"ok":true' && echo "   webhook ligado" || { echo "   setWebhook falhou: $(limpar "$R")"; echo "   Para voltar: ./scripts/nuvem-desfazer.sh"; exit 1; }

echo "7/7 Pronto. Guarde estes dois valores AGORA (não aparecem de novo; rodar este script de novo gera outros):"
echo
echo "   URL do Worker:     $URL"
echo "   Token do app:      $APP_TOKEN"
echo "      -> no app (Mac e celular): Canais > Ponte na nuvem: marque, cole URL e token, Salvar, Testar."
echo "   Token de resposta: $RESP_TOKEN"
echo "      -> cole no campo seguro que o Chefe Geral pedir no chat (só grava respostas; não lê nada)."
echo
echo "Teste: mande uma mensagem ao bot no Telegram com o Mac ligado e depois com ele desligado."
