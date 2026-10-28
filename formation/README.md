# Formation AKASHA

Outil de formation aux couleurs d'AKASHA, en deux parties :

- **Site apprenant** (`/formation/`), pensé pour le téléphone. On choisit une formation, puis on suit un chemin de niveaux. Chaque niveau propose une leçon découpée en cartes et un quiz d'une question par écran, corrigé aussitôt. Le niveau suivant se débloque au seuil de réussite (80 % par défaut). Étoiles, points ✦, série de jours 🔥 et révision des questions manquées. La progression est gardée dans le navigateur.
- **Back-office** (`/formation/admin/`), protégé par mot de passe : créer et éditer les formations, les niveaux, les leçons (texte enrichi, encadrés, images, étapes) et les quiz (choix, bonnes réponses, explications, visuels). Brouillon ou publication, aperçu.

Un serveur Node sans aucune dépendance (Node 18 ou plus) sert les deux parties. Il garde les formations en fichiers JSON sur le Pi.

## Arborescence

```
formation/
├── serveur.js                  serveur HTTP : pages, API, médias, sessions du back-office
├── public/
│   ├── index.html, app.js, style.css      site apprenant
│   ├── admin/                             back-office
│   └── commun/                            identité AKASHA, règles de validation, nettoyage du HTML
├── donnees-initiales/          copiées au premier démarrage si le dossier de données est vide
└── outils/verifier-contenu.mjs vérifie un dossier de formations (mêmes règles que la publication)
```

Données (hors dépôt, sur le Pi : `/var/lib/akasha-formation`) :

```
formations/<id>.json   une formation complète
medias/                images envoyées depuis le back-office
historique/<id>/       les 30 dernières versions de chaque formation
corbeille/             formations supprimées (récupérables)
```

## Lancer en local

```bash
cd formation
FORMATION_MOT_DE_PASSE=essai node serveur.js
# site : http://127.0.0.1:8092/   back-office : http://127.0.0.1:8092/admin/
```

Sans `FORMATION_MOT_DE_PASSE`, le site fonctionne mais le back-office reste fermé.

## Installation actuelle sur le Pi (LORAWAN, 192.168.1.21)

Installée le 28/10/2026, accessible **depuis le réseau local uniquement** :

- site : **http://192.168.1.21:8092/** · back-office : **http://192.168.1.21:8092/admin/**
- mot de passe du back-office : modifiable par l'administrateur dans le back-office (bouton **Mot de passe**) ; mot de passe de secours : `sudo cat /etc/akasha-formation.env`
- code : `/opt/akasha-formation` (copie de `~/emobber/formation`) · données : `/var/lib/akasha-formation`
- service : `akasha-formation` (systemd, utilisateur `pi`, `FORMATION_PORT=8092`, `FORMATION_HOTE=0.0.0.0`)
- le port 8090 est pris par le conteneur `atelier-redirection` ; le serveur web du Pi est **Apache** (pas nginx) et n'a pas été modifié ; aucune exposition Internet (cloudflared intact).

### Adresse publique (Cloudflare)

- Site : **https://akasha-formation.nubitech.org/** — publié par le tunnel `cloudflared` déjà présent sur le Pi
  (nom d'hôte → `http://localhost:8092`) ; aucun port ouvert sur la box.
- Derrière le tunnel, le serveur lit l'adresse réelle du visiteur (`CF-Connecting-IP`) — uniquement pour les
  requêtes venues de la machine elle-même — afin que la limite d'essais s'applique par visiteur.
- **Le mot de passe de secours (`/etc/akasha-formation.env`) ne fonctionne que sur le réseau local.** Depuis
  Internet, la connexion au back-office exige le mot de passe choisi dans l'écran « Mot de passe » : le changer
  d'abord depuis http://192.168.1.21:8092/admin/.

### Mettre à jour le code (sur le Pi)

```bash
git -C ~/emobber pull
rsync -a --delete --exclude donnees/ ~/emobber/formation/ /opt/akasha-formation/
node /opt/akasha-formation/outils/verifier-contenu.mjs
sudo systemctl restart akasha-formation && systemctl is-active akasha-formation
```

Les formations du back-office vivent dans `/var/lib/akasha-formation` : la mise à jour n'y touche jamais.
Depuis un autre poste avec accès SSH : `deploy/deployer-pi.sh pi@192.168.1.21`.

### Option : une adresse en /formation/ via Apache

`deploy/apache-formation.conf` contient le bloc à ajouter au VirtualHost d'Apache (après sauvegarde,
avec `a2enmod proxy proxy_http`). Le service peut alors repasser en `FORMATION_HOTE=127.0.0.1`.

### Désinstaller

```bash
sudo systemctl disable --now akasha-formation
sudo rm /etc/systemd/system/akasha-formation.service /etc/akasha-formation.env
sudo systemctl daemon-reload
sudo rm -rf /opt/akasha-formation
rm -rf ~/emobber
# garder /var/lib/akasha-formation pour conserver les formations, sinon : sudo rm -rf /var/lib/akasha-formation
```

## Installer sur une autre machine

1. Node 18+ ; `sudo mkdir -p /opt/akasha-formation /var/lib/akasha-formation && sudo chown $USER: /opt/akasha-formation /var/lib/akasha-formation`
2. Copier `formation/` dans `/opt/akasha-formation`.
3. `echo "FORMATION_MOT_DE_PASSE=$(openssl rand -base64 18)" | sudo tee /etc/akasha-formation.env >/dev/null && sudo chmod 600 /etc/akasha-formation.env`
4. Copier `deploy/akasha-formation.service` dans `/etc/systemd/system/` (adapter `User=`, le port s'il est pris), puis `sudo systemctl daemon-reload && sudo systemctl enable --now akasha-formation`.
5. Accès : direct sur le port (`FORMATION_HOTE=0.0.0.0`), ou derrière nginx (`deploy/nginx-formation.conf`) / Apache (`deploy/apache-formation.conf`).

## Sauvegarde

Tout le contenu tient dans `/var/lib/akasha-formation`. Le sauvegarder suffit :

```bash
rsync -a pi@raspberrypi.local:/var/lib/akasha-formation/ ~/sauvegardes/akasha-formation/
```

## Mot de passe de l'administrateur

- **Le changer** : back-office → **Mot de passe**. Il faut être connecté et saisir le mot de passe actuel.
  Règles : au moins 10 caractères, au moins une lettre, au moins un chiffre ou un symbole, pas d'espace
  au début ni à la fin, différent de l'actuel. Elles sont affichées en direct et revérifiées par le serveur.
- Le mot de passe choisi est stocké sous forme d'**empreinte scrypt** (avec sel) dans
  `<données>/admin.json` (droits 600), jamais en clair. Après un changement, les autres sessions sont déconnectées.
- **Mot de passe oublié** : sur le Pi, `sudo rm /var/lib/akasha-formation/admin.json && sudo systemctl restart akasha-formation`
  — le mot de passe de secours de `/etc/akasha-formation.env` redevient valable ; le changer ensuite dans le back-office.

## Sécurité

- Back-office : mot de passe comparé en temps constant (empreinte scrypt), blocage de 15 minutes après 5 essais ratés (connexion et changement de mot de passe), session en cookie `HttpOnly` / `SameSite=Strict` (12 h), en-tête anti-CSRF exigé sur chaque écriture.
- Le HTML des leçons est nettoyé à l'enregistrement et à l'affichage : pas de script, pas d'attribut `on…`, liens `http(s)`/`mailto` seulement. Une politique CSP stricte est servie.
- Images : PNG, JPEG, WebP ou GIF, reconnus par leur contenu et non par leur extension, 8 Mo maximum. Le SVG est refusé.
- Les bonnes réponses sont envoyées au navigateur. L'outil sert à apprendre et à s'auto-évaluer, pas à faire passer un examen certifiant.
