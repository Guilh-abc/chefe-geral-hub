#!/bin/sh
# Mostra se a Ponte do Mac está ligada e as últimas linhas do log (o log nunca tem chaves).
curl -s -m 3 http://127.0.0.1:8788/health | /usr/bin/python3 -m json.tool || echo "Ponte desligada"
launchctl print "gui/$(id -u)/com.chefegeral.relay" 2>/dev/null | grep -E "state =|pid =" | head -2
tail -n 15 "$HOME/Library/Logs/ChefeGeral/relay.log" 2>/dev/null
