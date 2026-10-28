# Outil de formation

Site statique (HTML/CSS/JS, sans dépendance ni compilation) qui présente un parcours
en niveaux. Chaque niveau = une leçon + un quiz ; le niveau suivant se débloque quand
le quiz atteint le seuil de réussite (80 % par défaut). La progression est enregistrée
dans le navigateur (export / import possibles).

## Arborescence

```
formation/
├── index.html, style.css, app.js     le site (ne pas toucher pour ajouter du contenu)
├── contenu/
│   ├── parcours.json                 titre, seuil, liste ordonnée des niveaux
│   └── niveaux/<dossier>/
│       ├── lecon.html                texte de la leçon (fragment HTML)
│       └── niveau.json               questions du quiz (+ "seuil" optionnel)
└── outils/verifier-contenu.mjs       contrôle avant publication
```

Format d'une question :

```json
{ "id": "tva", "enonce": "…", "choix": ["A", "B", "C"], "bonnes": [2], "explication": "…" }
```

`bonnes` liste les numéros des bons choix, **à partir de 0**. Plusieurs numéros = choix multiple
(il faut cocher exactement les bons).

Classes disponibles dans les leçons : `encadre` (notion clé), `exemple`, `attention` (piège).

Pour rédiger un niveau avec Claude, demander par exemple « ajoute un niveau sur … » :
le skill `.claude/skills/formation-contenu` décrit la marche à suivre.

## Tester en local

```bash
node formation/outils/verifier-contenu.mjs
python3 -m http.server 8000 -d formation    # puis http://localhost:8000
```

## Mise en place sur le Raspberry Pi (une seule fois)

```bash
sudo apt install nginx rsync
sudo mkdir -p /var/www/formation && sudo chown "$USER" /var/www/formation
```

Ajouter le bloc de `deploy/nginx-formation.conf` dans le `server { … }` de
`/etc/nginx/sites-available/default`, puis `sudo nginx -t && sudo systemctl reload nginx`.
Si l'outil de revient est déjà servi par un autre serveur web sur le Pi, ajouter ce bloc
dans sa configuration plutôt que d'installer nginx en double.

## Publier

Depuis le poste qui a le dépôt (Node et rsync installés, accès SSH au Pi) :

```bash
deploy/deployer-pi.sh                              # cible par défaut : pi@raspberrypi.local
deploy/deployer-pi.sh laurent@192.168.1.20:/var/www/formation/
```

## Limites connues

- Les réponses sont lisibles dans les fichiers du site : outil d'apprentissage et
  d'auto-évaluation, pas d'examen certifiant.
- Progression par navigateur : pas de suivi centralisé des apprenants. Si besoin plus tard,
  ajouter un petit service sur le Pi qui reçoit les scores (comptes, base SQLite).
