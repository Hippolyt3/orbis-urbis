#!/bin/bash
# Change le numéro de version des fichiers du jeu dans index.html,
# pour que les navigateurs téléchargent la nouvelle version au lieu de garder l'ancienne en cache.
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M)
sed -i '' -E "s#(css/style\.css|js/(config|mvt|boundaries|game)\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
echo "Version $V"
