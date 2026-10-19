#!/bin/sh
# Serve o app em http://localhost:8787 (e na rede local, para o celular no mesmo Wi-Fi).
cd "$(dirname "$0")/.." && exec /usr/bin/python3 -m http.server "${PORT:-8787}" --bind "${HOST:-0.0.0.0}"
