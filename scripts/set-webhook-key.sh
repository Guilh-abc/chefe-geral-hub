#!/bin/sh
# Grava o valor do cabeçalho Authorization do webhook. Você digita ou cola; nada aparece na tela nem no log.
set -e
DIR="$HOME/Library/Application Support/ChefeGeral"
mkdir -p "$DIR" && chmod 700 "$DIR"
echo "Cole o valor do cabeçalho Authorization exatamente como aparece no painel da rotina"
printf "(ex.: Bearer xxxxx). Valor: "
stty -echo 2>/dev/null; read -r VALOR; stty echo 2>/dev/null; echo
[ -z "$VALOR" ] && { echo "Nada gravado."; exit 1; }
umask 077
printf '%s' "$VALOR" > "$DIR/webhook.key"
chmod 600 "$DIR/webhook.key"
unset VALOR
echo "Chave gravada em $DIR/webhook.key (permissão 600)."
echo "Testando a ponte com um pedido de teste..."
curl -s -X POST http://127.0.0.1:8788/pedido -H 'Content-Type: application/json' \
  -d '{"versao":1,"origem":"chefe-geral-ponte","tipo":"teste","pedido":{"id":"teste","texto":"Teste da ponte do Mac. Pode ignorar."}}' \
  | /usr/bin/python3 -c 'import json,sys; j=json.load(sys.stdin); print("Webhook respondeu HTTP", j.get("webhook_status"), "(ok)" if j.get("ok") else "")'
