#!/bin/bash
# Acrescenta uma linha ao "Chefe Geral/Registro de criacoes.md" do cofre Obsidian.
# Uso: ./scripts/registrar-criacao.sh <tipo> "<titulo>" "<onde esta>" ["<nota do cofre>"]
#   tipo: app | site | doc | video | firmware | infra | email | notion | memoria | script
#   ex.: ./scripts/registrar-criacao.sh doc "Historia da Maria Alice" "~/Documents/Maria Alice" "Chefe Geral/Projetos/Historias da Maria Alice"
# So acrescenta (nunca apaga nem reescreve). Recusa texto que pareca segredo ou coordenada.
set -euo pipefail

if [ $# -lt 3 ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
TIPO="$1"; TITULO="$2"; ONDE="$3"; NOTA="${4:-}"

case "$TIPO" in
  app|site|doc|video|firmware|infra|email|notion|memoria|script) ;;
  *) echo "Tipo invalido: $TIPO (use app, site, doc, video, firmware, infra, email, notion, memoria ou script)"; exit 1;;
esac

TUDO="$TITULO $ONDE $NOTA"
if printf '%s' "$TUDO" | grep -Eiq 'crsr_|bearer |gh[opsu]_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{10,}|[0-9]{6,}:[A-Za-z0-9_-]{30,}|api[_-]?key|token=|senha|password|secret='; then
  echo "Recusado: o texto parece conter um segredo. Registre so o caminho do arquivo onde ele fica."; exit 1
fi
if printf '%s' "$TUDO" | grep -Eq -- '-?[0-9]{1,3}\.[0-9]{4,}[ ,;]+-?[0-9]{1,3}\.[0-9]{4,}'; then
  echo "Recusado: o texto parece conter coordenadas. Coordenadas nao vao para o cofre."; exit 1
fi
if printf '%s' "$TUDO" | grep -Fq '|'; then
  echo "Recusado: nao use o caractere | no texto."; exit 1
fi

CFG="$HOME/Library/Application Support/ChefeGeral/relay.json"
COFRE="${OBSIDIAN_COFRE:-}"
if [ -z "$COFRE" ] && [ -f "$CFG" ]; then
  COFRE="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("obsidian_cofre",""))' "$CFG" 2>/dev/null || true)"
fi
COFRE="${COFRE:-$HOME/Documents/Obsidian}"
REG="$COFRE/Chefe Geral/Registro de criacoes.md"
if [ ! -f "$REG" ]; then
  echo "Nao achei $REG. Confira o caminho do cofre (OBSIDIAN_COFRE)."; exit 1
fi

DIA="$(date +%Y-%m-%d)"; HORA="$(date +%H:%M)"
LINHA="- $DIA $HORA | $TIPO | $TITULO | $ONDE |"
[ -n "$NOTA" ] && LINHA="$LINHA [[${NOTA%.md}]]"

if ! grep -qx "## $DIA" "$REG"; then
  printf '\n## %s\n' "$DIA" >> "$REG"
fi
printf '%s\n' "$LINHA" >> "$REG"
echo "Registrado em $REG:"
echo "$LINHA"
