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
# site : http://127.0.0.1:8090/   back-office : http://127.0.0.1:8090/admin/
```

Sans `FORMATION_MOT_DE_PASSE`, le site fonctionne mais le back-office reste fermé.

## Mise en place sur le Raspberry Pi (une seule fois)

```bash
# Node 18+ et nginx
node -v                       # sinon : sudo apt install nodejs
sudo apt install nginx rsync

# Dossiers
sudo mkdir -p /opt/akasha-formation /var/lib/akasha-formation
sudo chown pi: /opt/akasha-formation /var/lib/akasha-formation

# Mot de passe du back-office (lisible par root seulement)
echo 'FORMATION_MOT_DE_PASSE=<un mot de passe long>' | sudo tee /etc/akasha-formation.env
sudo chmod 600 /etc/akasha-formation.env
```

Depuis le poste qui a le dépôt, premier envoi du code : `deploy/deployer-pi.sh`. Le script copie aussi le fichier de service et la configuration nginx dans `/opt/akasha-formation/deploy/`. Au premier envoi, le redémarrage échoue tant que le service n'existe pas : c'est attendu. Puis, sur le Pi :

```bash
sudo cp /opt/akasha-formation/deploy/akasha-formation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now akasha-formation
```

Si l'utilisateur du Pi ne s'appelle pas `pi`, adapter `User=` dans le fichier de service.

Ajouter le bloc de `/opt/akasha-formation/deploy/nginx-formation.conf` dans le `server { … }` de nginx. Si l'outil de revient est déjà servi par un serveur web sur le Pi, ajouter ce bloc à sa configuration au lieu d'installer nginx une deuxième fois. Puis : `sudo nginx -t && sudo systemctl reload nginx`.

## Mettre à jour le code

```bash
deploy/deployer-pi.sh                    # cible par défaut : pi@raspberrypi.local
deploy/deployer-pi.sh laurent@192.168.1.20
```

Le script vérifie les données initiales, copie le code dans `/opt/akasha-formation`, puis redémarre le service. Il ne touche jamais aux formations créées dans le back-office.

## Sauvegarde

Tout le contenu tient dans `/var/lib/akasha-formation`. Le sauvegarder suffit :

```bash
rsync -a pi@raspberrypi.local:/var/lib/akasha-formation/ ~/sauvegardes/akasha-formation/
```

## Sécurité

- Back-office : mot de passe comparé en temps constant, blocage de 15 minutes après 5 essais ratés, session en cookie `HttpOnly` / `SameSite=Strict` (12 h), en-tête anti-CSRF exigé sur chaque écriture.
- Le HTML des leçons est nettoyé à l'enregistrement et à l'affichage : pas de script, pas d'attribut `on…`, liens `http(s)`/`mailto` seulement. Une politique CSP stricte est servie.
- Images : PNG, JPEG, WebP ou GIF, reconnus par leur contenu et non par leur extension, 8 Mo maximum. Le SVG est refusé.
- Les bonnes réponses sont envoyées au navigateur. L'outil sert à apprendre et à s'auto-évaluer, pas à faire passer un examen certifiant.
