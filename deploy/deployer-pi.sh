#!/usr/bin/env bash
# Publie le CODE de la formation sur le Raspberry Pi, puis redémarre le service.
# Les formations créées dans le back-office vivent sur le Pi (/var/lib/akasha-formation)
# et ne sont jamais écrasées par ce script.
#
# Usage : deploy/deployer-pi.sh [utilisateur@hote]
# Par défaut : $FORMATION_PI, sinon pi@192.168.1.21
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
pi="${1:-${FORMATION_PI:-pi@192.168.1.21}}"

echo "→ Vérification des données initiales"
node "$racine/formation/outils/verifier-contenu.mjs"

echo "→ Copie du code vers $pi:/opt/akasha-formation/"
rsync -av --delete --exclude 'donnees/' --exclude 'README.md' --exclude 'deploy/' \
  "$racine/formation/" "$pi:/opt/akasha-formation/"
rsync -av "$racine/deploy/akasha-formation.service" "$racine/deploy/nginx-formation.conf" "$racine/deploy/apache-formation.conf" \
  "$pi:/opt/akasha-formation/deploy/"

echo "→ Redémarrage du service"
ssh "$pi" 'sudo systemctl restart akasha-formation && systemctl is-active akasha-formation'

echo "✓ Déployé : http://192.168.1.21:8092/  ·  back-office : /admin/"
