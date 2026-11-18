#!/bin/bash
# Double-cliquez sur ce fichier pour lancer le jeu dans votre navigateur.
cd "$(dirname "$0")"
PORT=8770
echo "Orbis Urbis tourne sur http://localhost:$PORT  (fermez cette fenêtre pour l'arrêter)"
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server "$PORT"
