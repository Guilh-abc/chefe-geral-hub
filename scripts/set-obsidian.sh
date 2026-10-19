#!/bin/sh
# Diz à Ponte do Mac onde fica o seu cofre do Obsidian. A ponte só cria notas em "<cofre>/Chefe Geral/".
# Uso: ./scripts/set-obsidian.sh "/caminho/do/cofre"
set -e
DIR="$HOME/Library/Application Support/ChefeGeral"
COFRE="$1"
[ -z "$COFRE" ] && { printf "Caminho do cofre (pasta que tem .obsidian): "; read -r COFRE; }
COFRE="${COFRE%/}"
[ -d "$COFRE/.obsidian" ] || { echo "Não achei $COFRE/.obsidian. Confira o caminho do cofre."; exit 1; }
mkdir -p "$DIR"
/usr/bin/python3 - "$COFRE" "$DIR/relay.json" <<'PY'
import json, sys, os
cofre, p = sys.argv[1], sys.argv[2]
c = json.load(open(p)) if os.path.exists(p) else {"porta": 8788}
c["obsidian_cofre"] = cofre
c.setdefault("obsidian_pasta", "Chefe Geral")
json.dump(c, open(p, "w"), indent=2, ensure_ascii=False)
PY
launchctl kickstart -k "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || true
sleep 2
curl -s http://127.0.0.1:8788/health | /usr/bin/python3 -c 'import json,sys; o=json.load(sys.stdin)["obsidian"]; print("Obsidian na ponte:", o)'
