#!/bin/sh
# Instala a Ponte do Mac (127.0.0.1:8788) e o LaunchAgent com.chefegeral.relay.
# Uso: ./scripts/install-relay.sh [URL_DO_WEBHOOK]
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/Library/Application Support/ChefeGeral"
LOGDIR="$HOME/Library/Logs/ChefeGeral"
PLIST="$HOME/Library/LaunchAgents/com.chefegeral.relay.plist"
mkdir -p "$DIR/relay" "$LOGDIR" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
cp "$REPO/relay/relay.py" "$DIR/relay/relay.py"
if [ ! -f "$DIR/relay.json" ]; then
  URL="$1"
  [ -z "$URL" ] && { printf "URL do webhook da rotina: "; read -r URL; }
  /usr/bin/python3 -c 'import json,sys; json.dump({"webhook_url": sys.argv[1], "chat_id": "", "porta": 8788}, open(sys.argv[2], "w"), indent=2)' "$URL" "$DIR/relay.json"
elif [ -n "$1" ]; then
  /usr/bin/python3 -c 'import json,sys; p=sys.argv[2]; c=json.load(open(p)); c["webhook_url"]=sys.argv[1]; json.dump(c, open(p,"w"), indent=2)' "$1" "$DIR/relay.json"
fi
sed -e "s#__DIR__#$DIR#g" -e "s#__LOGDIR__#$LOGDIR#g" "$REPO/launchagent/com.chefegeral.relay.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
# Motor 2: OLLAMA_ORIGINS persistente (roda a cada login)
OPLIST="$HOME/Library/LaunchAgents/com.chefegeral.ollama-origins.plist"
cp "$REPO/launchagent/com.chefegeral.ollama-origins.plist" "$OPLIST"
launchctl bootout "gui/$(id -u)/com.chefegeral.ollama-origins" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$OPLIST" || true
echo "OLLAMA_ORIGINS=$(launchctl getenv OLLAMA_ORIGINS)  (reabra o Ollama para valer)"
sleep 1
curl -s http://127.0.0.1:8788/health && echo
echo "Ponte instalada. Próximo passo: ./scripts/set-webhook-key.sh"
