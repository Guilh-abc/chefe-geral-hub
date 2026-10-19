#!/bin/sh
launchctl bootout "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.chefegeral.relay.plist"
launchctl bootout "gui/$(id -u)/com.chefegeral.ollama-origins" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.chefegeral.ollama-origins.plist"
rm -rf "$HOME/Library/Application Support/ChefeGeral/relay"
echo "Ponte removida. Chaves e logs ficaram em ~/Library/Application Support/ChefeGeral e ~/Library/Logs/ChefeGeral (apague se quiser)."
