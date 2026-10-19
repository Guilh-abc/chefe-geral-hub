#!/bin/sh
# Grava o cabeçalho Authorization do webhook ("Bearer <chave>"; aceita a chave pura ou já com Bearer). Você digita ou cola; nada aparece na tela nem no log.
set -e
DIR="$HOME/Library/Application Support/ChefeGeral"
mkdir -p "$DIR" && chmod 700 "$DIR"
echo "Cole a chave do webhook da rotina (só a chave, ex.: crsr_..., ou já com Bearer na frente)."
printf "Chave: "
stty -echo 2>/dev/null; read -r VALOR; stty echo 2>/dev/null; echo
# Tira espaços das pontas e põe "Bearer " na frente se faltar.
VALOR=$(printf '%s' "$VALOR" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
[ -z "$VALOR" ] && { echo "Nada gravado."; exit 1; }
case "$VALOR" in
  [Bb][Ee][Aa][Rr][Ee][Rr]\ *) VALOR="Bearer ${VALOR#* }" ;;
  *) VALOR="Bearer $VALOR" ;;
esac
umask 077
printf '%s' "$VALOR" > "$DIR/webhook.key"
chmod 600 "$DIR/webhook.key"
unset VALOR
echo "Chave gravada em $DIR/webhook.key (permissão 600)."
echo "Testando a ponte com um pedido de teste..."
curl -s -X POST http://127.0.0.1:8788/pedido -H 'Content-Type: application/json' \
  -d '{"versao":1,"origem":"chefe-geral-ponte","tipo":"teste","pedido":{"id":"teste","texto":"Teste da ponte do Mac. Pode ignorar."}}' \
  | /usr/bin/python3 -c 'import json,sys; j=json.load(sys.stdin); print("Webhook respondeu HTTP", j.get("webhook_status"), "(ok)" if j.get("ok") else "")'
