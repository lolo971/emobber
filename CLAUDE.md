# Consignes de Laurent

## Langue — RÈGLE ABSOLUE
- **Toujours répondre à Laurent en français**, dans tous les messages, rapports, résumés et questions,
  sans exception (y compris les rapports de sessions lancées sur le Raspberry Pi).
- Les messages de commit, la documentation et les textes des interfaces sont aussi en français.

## Contexte
- Laurent travaille depuis son téléphone : réponses claires, étapes numérotées, commandes à copier
  courtes ; lui dire précisément où cliquer.
- Raspberry Pi « LORAWAN » (192.168.1.21) : AKASHA, la formation (`akasha-formation`, port 8092,
  https://akasha-formation.nubitech.org), maatsoby (conteneur, port 8098), n8n, etc.
  Tunnel Cloudflare : les routes publiques se gèrent dans le tableau de bord Cloudflare.
- Projet AKASHA : identité et règles éditoriales dans les skills `akasha-*` ; « Relier sans confondre ».

## Travailler sur le Pi
- Sessions lancées par `create_session` dans l'environnement du Pi (Remote Control, `~/akasha-code`),
  lues avec `list_events` (kinds `result`). Laurent dit « regarde » pour le compte rendu, « archive les
  sessions du Pi » pour les ranger.
- Doctrine : mesure → sauvegarde (`.bak-AAAAMMJJ-HHMM`) → application → preuve et contre-preuve ;
  retour arrière si une preuve échoue. Jamais afficher un secret (`/etc/akasha-formation.env`,
  `admin.json`, `sessions.json`, jetons) : on ne vérifie que les NOMS de variables.
- Ne pas toucher sans accord : AKASHA, Apache, Docker, n8n (sauf le scénario boutique), cloudflared,
  le site maatsoby (`/DATA/AppData/maatsoby`, lecture seule).
- `~/.claude/settings.json` du Pi autorise d'avance les commandes courantes (lecture, `git -C ~/emobber
  pull --ff-only origin main`, sauvegarde/rsync/chown/restart de `akasha-formation`). Éviter les
  substitutions `$(...)` dans les consignes (elles redemandent une autorisation) : calculer la date avec
  `date` puis l'écrire en clair.
- Déployer la formation : `git -C ~/emobber pull --ff-only origin main` → `verifier-contenu.mjs` et
  `node --check` → sauvegarde `/opt/akasha-formation.bak-…tgz` → `sudo rsync -a --delete --exclude donnees/
  ~/emobber/formation/ /opt/akasha-formation/` → `chown pi:pi` → `systemctl restart akasha-formation`.
  `~/emobber` du Pi suit `main`. Pousser sur `main` seulement quand Laurent le demande.

## État au 28/10/2026 (boutique Maât Soby, dans `formation/`)
- En ligne sur le Pi (version de `main`) : étape 1 (offres, Stripe Connect avec commission 10 %,
  comptes stagiaires par lien, formations réservées), e-mails via n8n, étape 2 (agenda .ics, rappel la
  veille, liste d'attente), onglet Facturation (forfait 25 €/mois à partir de 2026-11).
- **Paiement en ligne fermé** (simulation coupée le 29/10) : les offres payantes se réservent par message
  (`BOUTIQUE_CONTACT` = son WhatsApp). Attendre le compte Stripe de Maât Soby (« branchons Stripe ») :
  clé plateforme de Laurent, compte connecté, webhook.
- **Son site lit l'agenda de la boutique** depuis le 29/10 (`deploy/maatsoby/brancher-agenda-boutique.mjs`,
  appliqué sur `/DATA/AppData/maatsoby`, sauvegarde dans `sauvegardes/20261029-1332/`). Son code est copié
  dans l'image : toute modif = `docker compose up -d --build` dans ce dossier (pas de git chez elle).
- E-mails : Gmail dédié maatsoby.inscriptions@gmail.com, scénario n8n « Boutique Maât Soby — envoi des
  e-mails » (doit rester actif), protégé par un secret partagé (`BOUTIQUE_COURRIEL_SECRET`).
- Offres (données du Pi `/var/lib/akasha-formation/boutique/offres.json`), **publiées** : Cercle de guidance
  35 € (30/10 19 h), 7 Portes 790 € (31/10, 3×, sur invitation, lieu caché), Stage Éveil 450 € (20-22/11, 3×,
  sur invitation, lieu caché, ouvre aussi Orishas), Cercle de guérison 35 € (22/11 18 h 30) ; en brouillon :
  Osso 397 €, Incarnation 1 497 € (3×), Appel d'Âme (prix plus tard).
- Module « Préparer le Stage Éveil » : brouillon réservé aux inscrits, tiré mot pour mot des textes de
  Maât Soby ; à compléter par elle (horaires, tenue, alimentation, à apporter, contre-indications).
- Back-office : https://akasha-formation.nubitech.org/admin/ (mot de passe choisi par Laurent ; le
  mot de passe de secours ne marche que sur le réseau local).
- À faire / en attente : brancher Stripe ; relecture du module de préparation (document claude.ai « Préparer
  le Stage Éveil — à relire », https://claude.ai/artifact/Gj4bqaHUK5c4RC4V72mZL5) ; fin réelle des 7 Portes
  (durée « 7 semaines + 21 jours » lue comme 21 jours par l'agenda) ; Stage Éveil et Cercle de guérison le même
  22/11 ? ; accès limité au back-office pour Maât Soby ; décider si Orishas reste ouverte avec le Stage Éveil ; étape 3 possible (bons
  cadeaux, abonnements) ; boutons des stages/accompagnements du site maatsoby (demande une modif de son code).
- Proposition commerciale : artefact « Proposition Maât Soby » (https://claude.ai/artifact/SHoK5equ8HmvKWvyc2dFZd),
  à partager par Laurent.
