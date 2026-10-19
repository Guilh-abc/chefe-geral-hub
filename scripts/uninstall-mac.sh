#!/bin/sh
launchctl bootout "gui/$(id -u)/com.chefegeral.console" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.chefegeral.console.plist"
rm -rf "$HOME/Applications/ChefeGeral-Console" "$HOME/Applications/Chefe Geral.app"
echo "Removido. Dados do app no navegador não foram apagados."
