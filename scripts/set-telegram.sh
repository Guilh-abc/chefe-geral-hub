#!/bin/sh
# Liga o Telegram na ponte: valida e grava o token (sem mostrar) e descobre o seu chat_id.
# A ponte só é parada depois do token validado, e é religada no fim mesmo se algo falhar.
DIR="$HOME/Library/Application Support/ChefeGeral"
PLIST="$HOME/Library/LaunchAgents/com.chefegeral.relay.plist"
ALVO="gui/$(id -u)/com.chefegeral.relay"
PAROU=0
religar() {
  if [ "$PAROU" = 1 ] && [ -f "$PLIST" ]; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl kickstart -k "$ALVO" 2>/dev/null || true
    echo "Ponte religada."
  fi
}
trap religar EXIT
trap 'exit 130' INT TERM
mkdir -p "$DIR" && chmod 700 "$DIR"

printf "Cole o token do BotFather (/mybots > seu bot > API Token): "
stty -echo 2>/dev/null; read -r TOKEN; stty echo 2>/dev/null; echo
[ -z "$TOKEN" ] && { echo "Nada gravado."; exit 1; }

# 1) Limpa, confere o formato e valida com getMe ANTES de mexer na ponte. O token vai pela entrada padrão (não aparece no ps).
printf '%s' "$TOKEN" | /usr/bin/python3 -c '
import json, os, re, sys, urllib.error, urllib.request
d = sys.argv[1]
bruto = sys.stdin.read()
tok = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", bruto)        # sequências de escape (ex.: colagem 200~ / 201~)
tok = re.sub(r"\x1b[@-_]", "", tok)
tok = re.sub(r"[\x00-\x1f\x7f\s]", "", tok)                  # caracteres de controle e espaços
if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{30,}", tok):
    print("Isso não parece um token do Telegram (formato 123456789:AAAA...). Nada gravado.")
    print("Pegue o token no @BotFather: /mybots > seu bot > API Token."); sys.exit(2)
try:
    me = json.load(urllib.request.urlopen("https://api.telegram.org/bot" + tok + "/getMe", timeout=20))["result"]
except urllib.error.HTTPError as e:
    if e.code in (401, 404):
        print("O Telegram recusou o token (HTTP %d). Pegue o token certo em @BotFather: /mybots > seu bot > API Token. Nada gravado." % e.code)
    else:
        print("O Telegram respondeu HTTP %d. Tente de novo em instantes. Nada gravado." % e.code)
    sys.exit(3)
except Exception as e:
    print("Sem conexão com o Telegram (%s). Nada gravado." % type(e).__name__); sys.exit(4)
os.umask(0o077)
p = os.path.join(d, "telegram.token")
with open(p, "w") as f:
    f.write(tok)
os.chmod(p, 0o600)
print("Token válido do bot @" + me["username"] + " (gravado, permissão 600).")
' "$DIR" || { unset TOKEN; exit 1; }
unset TOKEN

# 2) Para a ponte só agora (ela e este script disputariam as mensagens do bot) e descobre o chat_id.
launchctl bootout "$ALVO" 2>/dev/null && PAROU=1 || PAROU=1
echo "Agora abra o seu bot no Telegram e mande /start. Depois aperte Enter aqui."
read -r _
/usr/bin/python3 - "$DIR" <<'PY'
import json, os, sys, time, urllib.error, urllib.request
d = sys.argv[1]
tok = open(os.path.join(d, "telegram.token")).read().strip()
def api(metodo):
    for tentativa in range(3):
        try:
            return json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/{metodo}", timeout=20))["result"]
        except urllib.error.HTTPError as e:
            if e.code == 409 and tentativa < 2:
                time.sleep(3); continue  # a ponte ainda estava lendo; espera e tenta de novo
            msg = {401: "token recusado (pegue em /mybots > API Token)", 409: "outro programa está lendo o bot (feche e tente de novo)"}.get(e.code, f"HTTP {e.code}")
            print("Telegram: " + msg + "."); sys.exit(1)
        except Exception as e:
            print(f"Sem conexão com o Telegram ({type(e).__name__})."); sys.exit(1)
me = api("getMe")
ups = api("getUpdates?limit=50")
chats = {}
for u in ups:
    c = ((u.get("message") or {}).get("chat")) or {}
    if c.get("type") == "private":
        chats[str(c["id"])] = c.get("first_name") or c.get("username") or ""
if not chats:
    print("Não achei conversa. Mande /start ao bot @" + me["username"] + " e rode o script de novo."); sys.exit(1)
cid = list(chats)[-1]
p = os.path.join(d, "relay.json")
c = json.load(open(p)) if os.path.exists(p) else {"porta": 8788, "webhook_url": ""}
c["chat_id"] = cid; c["bot"] = me["username"]
tmp = p + ".tmp"
json.dump(c, open(tmp, "w"), indent=2, ensure_ascii=False); os.replace(tmp, p)
print(f"Bot @{me['username']} ligado ao chat {cid} ({chats[cid]}). Só esse chat é aceito.")
PY
R=$?
[ $R = 0 ] && echo "Pronto. Mande uma mensagem ao bot para testar."
exit $R
