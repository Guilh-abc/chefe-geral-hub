#!/bin/bash
# Atualiza a ponte na nuvem JÁ instalada, sem trocar tokens nem mexer no webhook do Telegram. Rode no Mac, na pasta do repo:
#   ./scripts/nuvem-atualizar.sh
# O que faz: cria o bucket R2 'chefe-geral-obsidian' se faltar (idempotente), recria cloud/wrangler.local.toml (fora do git)
# a partir do modelo, aplica o schema no D1, publica o Worker novo, copia a ponte do Mac (relay.py) e reinicia.
# Antes de trocar a ponte, guarda relay.py.bak-<versão> ao lado. Qualquer erro para o script e mostra a mensagem (sem tokens).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"; CLOUD="$REPO/cloud"
DIR="$HOME/Library/Application Support/ChefeGeral"
LOCAL_TOML="$CLOUD/wrangler.local.toml"
W="npx -y wrangler@4"
limpar(){ printf '%s' "$1" | sed -E 's/bot[0-9]+:[A-Za-z0-9_-]+/bot<token>/g; s/[0-9a-f]{40,}/<token>/g; s/(Bearer|token[=:]) *[^ "]+/\1 <token>/gI'; }
falha(){ echo; echo "Erro ao $1:"; limpar "$2" | tail -n 25; echo; echo "A ponte do Mac não foi trocada. Corrija e rode de novo."; exit 1; }
trap 'echo "Erro inesperado na linha $LINENO (comando: $(limpar "$BASH_COMMAND"))."' ERR

[ -s "$DIR/nuvem.json" ] || { echo "Falta $DIR/nuvem.json: a nuvem ainda não foi instalada. Rode ./scripts/nuvem-instalar.sh"; exit 1; }
CHAT_ID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("chat_id",""))' "$DIR/relay.json")
WH_URL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("webhook_url",""))' "$DIR/relay.json")
URL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("url",""))' "$DIR/nuvem.json")
[ -n "$CHAT_ID" ] && [ -n "$WH_URL" ] && [ -n "$URL" ] || { echo "relay.json ou nuvem.json incompletos (chat_id, webhook_url, url)."; exit 1; }
cd "$CLOUD"

echo "1/5 Cloudflare..."
O=$($W whoami 2>&1) || falha "conferir o login (rode: npx -y wrangler@4 login)" "$O"
echo "$O" | grep -qiE "not authenticated|not logged in" && { echo "Não logado. Rode: npx -y wrangler@4 login  e depois este script de novo."; exit 1; }

echo "2/5 Bucket R2 'chefe-geral-obsidian'..."
OUT=$($W r2 bucket list 2>&1) || falha "listar os buckets R2 (ative o R2 em dash.cloudflare.com > R2 Object Storage, plano grátis, e rode de novo)" "$OUT"
if ! printf '%s' "$OUT" | grep -Eq '(^|[[:space:]"])chefe-geral-obsidian([[:space:]"]|$)'; then
  OUT=$($W r2 bucket create chefe-geral-obsidian 2>&1) || falha "criar o bucket R2 chefe-geral-obsidian (ative o R2 no painel e rode de novo)" "$OUT"
  echo "   bucket criado"
else
  echo "   bucket já existe"
fi

echo "3/5 Banco D1 e configuração local..."
LISTA=$($W d1 list --json 2>&1) || falha "listar bancos D1" "$LISTA"
DBID=$(printf '%s' "$LISTA" | python3 -c 'import json,sys
try:
  l=json.load(sys.stdin)
except Exception: l=[]
print(next((d.get("uuid") or d.get("database_id") or "" for d in l if d.get("name")=="chefe-geral"),""))')
[ -n "$DBID" ] || { echo "Banco D1 'chefe-geral' não encontrado. Rode ./scripts/nuvem-instalar.sh"; exit 1; }
sed -e "s/00000000-0000-0000-0000-000000000000/$DBID/" -e "s/^CHAT_ID = \"\".*/CHAT_ID = \"$CHAT_ID\"/" -e "s|^WEBHOOK_URL = \"\".*|WEBHOOK_URL = \"$WH_URL\"|" wrangler.toml > "$LOCAL_TOML"
OUT=$($W d1 execute chefe-geral --remote --yes --file schema.sql -c "$LOCAL_TOML" 2>&1) || falha "aplicar as tabelas no D1" "$OUT"

echo "4/5 Publicando o Worker..."
OUT=$($W deploy -c "$LOCAL_TOML" 2>&1) || falha "publicar o Worker" "$OUT"
sleep 3
H=$(curl -fsS "$URL/health" 2>&1) || falha "conferir $URL/health" "$H"
echo "$H" | grep -q '"obsidian":"R2"' && echo "   Worker no ar com o Obsidian no R2" || falha "confirmar o R2 no /health" "$H"

echo "5/5 Ponte do Mac..."
R="$DIR/relay"; mkdir -p "$R"
if [ -f "$R/relay.py" ]; then
  V=$(sed -n 's/^VERSAO = "\(.*\)"/\1/p' "$R/relay.py" | head -1)
  [ -e "$R/relay.py.bak-$V" ] || cp "$R/relay.py" "$R/relay.py.bak-$V"
fi
cp "$REPO/relay/relay.py" "$R/relay.py"
launchctl kickstart -k "gui/$(id -u)/com.chefegeral.relay" || { echo "Não consegui reiniciar a ponte. Rode: ./scripts/install-relay.sh"; exit 1; }
sleep 4
curl -fsS http://127.0.0.1:8788/health | python3 -c 'import json,sys;j=json.load(sys.stdin);print("   ponte", j.get("versao"), "modo", j.get("modo"))'
echo
echo "Pronto. Em até 2 minutos as notas de Chefe Geral sobem para a nuvem. Veja no app: Arquivo > Obsidian."
