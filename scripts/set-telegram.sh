#!/bin/sh
# Liga o Telegram na ponte: grava o token (sem mostrar) e descobre o seu chat_id.
set -e
DIR="$HOME/Library/Application Support/ChefeGeral"
mkdir -p "$DIR" && chmod 700 "$DIR"
printf "Cole o token do BotFather: "
stty -echo 2>/dev/null; read -r TOKEN; stty echo 2>/dev/null; echo
[ -z "$TOKEN" ] && { echo "Nada gravado."; exit 1; }
umask 077
printf '%s' "$TOKEN" > "$DIR/telegram.token"
chmod 600 "$DIR/telegram.token"
unset TOKEN
echo "Token gravado (permissão 600)."
launchctl bootout "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || true
echo "Agora abra o seu bot no Telegram e mande /start. Depois aperte Enter aqui."
read -r _
/usr/bin/python3 - "$DIR" <<'PY'
import json, sys, urllib.request, os
d = sys.argv[1]
tok = open(os.path.join(d, "telegram.token")).read().strip()
me = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getMe", timeout=20))["result"]
ups = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getUpdates?limit=50", timeout=20))["result"]
chats = {}
for u in ups:
    m = u.get("message") or {}
    c = m.get("chat") or {}
    if c.get("type") == "private":
        chats[str(c["id"])] = c.get("first_name") or c.get("username") or ""
if not chats:
    print("Não achei conversa. Mande /start ao bot @" + me["username"] + " e rode de novo."); sys.exit(1)
cid = list(chats)[-1]
p = os.path.join(d, "relay.json")
c = json.load(open(p)) if os.path.exists(p) else {"porta": 8788, "webhook_url": ""}
c["chat_id"] = cid; c["bot"] = me["username"]
json.dump(c, open(p, "w"), indent=2)
print(f"Bot @{me['username']} ligado ao chat {cid} ({chats[cid]}). Só esse chat é aceito.")
PY
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.chefegeral.relay.plist"
echo "Ponte reiniciada. Mande uma mensagem ao bot para testar."
