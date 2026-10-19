#!/bin/bash
# Volta ao modo local: desliga o webhook do Telegram e a ponte do Mac volta ao long-poll.
# O Worker e o banco continuam na sua conta (sem custo). Para apagar de vez:
#   cd cloud && npx wrangler delete -c wrangler.local.toml && npx wrangler d1 delete chefe-geral
set -euo pipefail
DIR="$HOME/Library/Application Support/ChefeGeral"
TG_TOKEN=$(tr -d '\r\n' < "$DIR/telegram.token")
R=$(curl -sS "https://api.telegram.org/bot$TG_TOKEN/deleteWebhook" -d drop_pending_updates=false)
echo "$R" | grep -q '"ok":true' && echo "Webhook do Telegram desligado." || echo "Aviso: deleteWebhook respondeu $R"
python3 - "$DIR/relay.json" <<'PY'
import json, sys
p = sys.argv[1]; c = json.load(open(p)); c["modo"] = "local"; json.dump(c, open(p, "w"), ensure_ascii=False, indent=2)
PY
launchctl kickstart -k "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || echo "(reinicie a ponte: ./scripts/install-relay.sh)"
echo "Ponte do Mac de volta ao modo local. No app: Canais > Ponte na nuvem > desmarque e Salvar (em cada aparelho)."
echo "O nuvem.json fica guardado; para ligar de novo sem refazer tudo, ponha \"modo\": \"nuvem\" no relay.json e rode o setWebhook (ou o instalador)."
