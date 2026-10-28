# Formation AKASHA

Outil de formation aux couleurs d'AKASHA, en deux parties :

- **Site apprenant** (`/formation/`), pensé pour le téléphone. On choisit une formation, puis on suit un chemin de niveaux. Chaque niveau propose une leçon découpée en cartes et un quiz d'une question par écran, corrigé aussitôt. Le niveau suivant se débloque au seuil de réussite (80 % par défaut). Étoiles, points ✦, série de jours 🔥 et révision des questions manquées. La progression est gardée dans le navigateur.
- **Back-office** (`/formation/admin/`), protégé par mot de passe : créer et éditer les formations, les niveaux, les leçons (texte enrichi, encadrés, images, étapes) et les quiz (choix, bonnes réponses, explications, visuels). Brouillon ou publication, aperçu.

Un serveur Node sans aucune dépendance (Node 18 ou plus) sert les deux parties. Il garde les formations en fichiers JSON sur le Pi.

## Arborescence

```
formation/
├── serveur.js                  serveur HTTP : pages, API, médias, sessions du back-office
├── lib/                        boutique (offres, Stripe, comptes, e-mails), stockage, outils HTTP
├── public/
│   ├── index.html, app.js, style.css      site apprenant
│   ├── admin/                             back-office (formations, offres, inscriptions)
│   ├── boutique/                          agenda, réservation, espace stagiaire
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

## Boutique Maât Soby : offres, paiements, espace stagiaire (étape 1)

- **Agenda public** : `/boutique/` (liste des offres, fiche, réservation). **Espace stagiaire** : `/boutique/#/compte`.
- **Back-office** : onglets **Offres** (créer cercles, rituels, stages, accompagnements ; prix ; places ; paiement en 3 fois ;
  formations ouvertes après paiement ; liens personnels après un Appel d'Âme ; inscription réglée hors ligne) et
  **Inscriptions** (encaissements, commission, versements, retrait d'accès, lien de connexion à envoyer par WhatsApp).
- **Formation réservée** : case « Réservée aux inscrits » dans les paramètres d'une formation ; elle s'ouvre aux
  stagiaires inscrits à une offre qui la contient.
- **Comptes sans mot de passe** : lien de connexion par e-mail (20 min, usage unique), session de 30 jours. Au retour du
  paiement, connexion directe seulement si le compte vient d'être créé (payer avec l'adresse d'autrui n'ouvre pas son espace).
- **Paiement** : Stripe Connect, charges directes sur le compte de Maât Soby, commission de la plateforme prélevée sur
  chaque paiement (`application_fee_amount`, 10 % par défaut). En 3 fois : le 1er versement par Stripe Checkout, la carte
  est gardée, les versements 2 et 3 sont prélevés automatiquement à un et deux mois (contrôle toutes les heures).
- **Agenda, rappels, liste d'attente** : bouton « Ajouter à mon agenda » (fichier `.ics`, alarme la veille) sur la
  fiche, la confirmation, l'e-mail et l'espace stagiaire ; rappel par e-mail dans les 26 h qui précèdent le rendez-vous ;
  quand c'est complet, liste d'attente : dès qu'une place se libère, les premières personnes sont prévenues par e-mail.
- **Pour le site de Maât Soby** : `GET /api/boutique/offres` (JSON, lisible depuis `https://maatsoby.nubitech.org`),
  chaque offre a une adresse `url` vers sa fiche de réservation.

Réglages (dans `/etc/akasha-formation.env`, puis `sudo systemctl restart akasha-formation`) :

```
FORMATION_URL_PUBLIQUE=https://akasha-formation.nubitech.org
STRIPE_CLE_SECRETE=sk_test_…        # clé secrète du compte Stripe de la plateforme (Laurent)
STRIPE_COMPTE=acct_…                # compte Stripe connecté de Maât Soby
STRIPE_SECRET_WEBHOOK=whsec_…       # webhook « comptes connectés » → https://akasha-formation.nubitech.org/api/stripe/webhook
BOUTIQUE_COMMISSION=10
BOUTIQUE_COURRIEL_WEBHOOK=https://…  # webhook n8n qui envoie l'e-mail { a, sujet, texte, html }
BOUTIQUE_COURRIEL_SECRET=…          # secret partagé, vérifié par le workflow n8n (en-tête X-Courriel-Secret)
BOUTIQUE_COURRIEL_ADMIN=…           # prévenu à chaque inscription
```

Le workflow n8n prêt à importer est dans `deploy/n8n-courriel-boutique.json` (webhook → vérification du secret →
envoi par le compte SMTP choisi → réponse). Remplacer `__SECRET__` et `__EXPEDITEUR__` avant l'import, puis choisir
l'identifiant SMTP dans le nœud « Envoyer l'e-mail » et activer le workflow.

Événements à cocher sur le webhook Stripe (onglet « comptes connectés ») : `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.payment_failed`. Sans clé Stripe, seules les offres gratuites se réservent ; `BOUTIQUE_SIMULATION=1`
simule les paiements pour les essais (jamais en production). Le forfait mensuel de 25 € se facture à part (abonnement
Stripe Billing du compte de la plateforme). Données : `<données>/boutique/*.json` (droits 600).

## Sécurité

- Back-office : mot de passe comparé en temps constant (empreinte scrypt), blocage de 15 minutes après 5 essais ratés (connexion et changement de mot de passe), session en cookie `HttpOnly` / `SameSite=Strict` (12 h), en-tête anti-CSRF exigé sur chaque écriture.
- Le HTML des leçons est nettoyé à l'enregistrement et à l'affichage : pas de script, pas d'attribut `on…`, liens `http(s)`/`mailto` seulement. Une politique CSP stricte est servie.
- Images : PNG, JPEG, WebP ou GIF, reconnus par leur contenu et non par leur extension, 8 Mo maximum. Le SVG est refusé.
- Les bonnes réponses sont envoyées au navigateur. L'outil sert à apprendre et à s'auto-évaluer, pas à faire passer un examen certifiant.
