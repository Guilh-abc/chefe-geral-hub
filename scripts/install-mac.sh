#!/bin/sh
# Instala uma cópia local no Mac (opcional; o link do GitHub Pages já funciona sozinho).
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Applications/ChefeGeral-Console"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
rsync -a --delete --exclude .git "$SRC/" "$DEST/"
sed "s#__DIR__#$DEST#g" "$SRC/launchagent/com.chefegeral.console.plist" > "$HOME/Library/LaunchAgents/com.chefegeral.console.plist"
launchctl bootout "gui/$(id -u)/com.chefegeral.console" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.chefegeral.console.plist"
osacompile -o "$HOME/Applications/Chefe Geral.app" -e 'open location "http://localhost:8787/"'
echo "Pronto: http://localhost:8787  (atalho: ~/Applications/Chefe Geral.app)"
