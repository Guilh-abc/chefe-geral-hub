#!/bin/sh
# Monta ~/Applications/Chefe Geral Ponte.app: um lançador compilado que roda a ponte (relay.py) como filho,
# para o macOS pedir e guardar a permissão da pasta Documentos (cofre do Obsidian) em nome deste app.
# Precisa das Command Line Tools (clang). Assinatura ad hoc (codesign -s -).
# Atenção: recompilar muda a assinatura e o macOS pode pedir a permissão de novo.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Chefe Geral Ponte.app"
EXE="$APP/Contents/MacOS/chefe-geral-ponte"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.chefegeral.ponte</string>
  <key>CFBundleName</key><string>Chefe Geral Ponte</string>
  <key>CFBundleDisplayName</key><string>Chefe Geral Ponte</string>
  <key>CFBundleExecutable</key><string>chefe-geral-ponte</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSDocumentsFolderUsageDescription</key><string>A Ponte do Chefe Geral lê o seu cofre do Obsidian em Documentos para buscar contexto e grava notas novas só na pasta Chefe Geral. Nenhuma outra nota é alterada.</string>
</dict></plist>
PLIST
xcrun clang -O2 -Wall -o "$EXE" "$REPO/launcher/ponte.c"
codesign --force --deep -s - --identifier com.chefegeral.ponte "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature" || true
echo "App pronto: $APP"
