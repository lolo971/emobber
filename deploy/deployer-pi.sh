#!/usr/bin/env bash
# Publie le site de formation sur le Raspberry Pi.
# Usage : deploy/deployer-pi.sh [utilisateur@hote:/chemin/]
# Par défaut : $FORMATION_CIBLE, sinon pi@raspberrypi.local:/var/www/formation/
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
cible="${1:-${FORMATION_CIBLE:-pi@raspberrypi.local:/var/www/formation/}}"

echo "→ Vérification du contenu"
node "$racine/formation/outils/verifier-contenu.mjs"

echo "→ Copie vers $cible"
rsync -av --delete \
  --exclude 'outils/' --exclude 'README.md' \
  "$racine/formation/" "$cible"

echo "✓ Déployé. Ouvrir http://<adresse-du-pi>/formation/"
