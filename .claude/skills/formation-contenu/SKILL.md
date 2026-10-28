---
name: formation-contenu
description: À utiliser quand Laurent veut créer, enrichir ou corriger une formation AKASHA (dossier formation/) — un niveau, une leçon, un quiz, des visuels — à partir de ses fiches, packs ou documents ; ou faire évoluer le site apprenant / le back-office ; ou publier la formation sur le Raspberry Pi. Déclencheurs : « ajoute un niveau », « fais un quiz sur… », « transforme cette fiche en leçon », « nouvelle formation », « publie la formation ».
---

# Formation AKASHA — rédiger et faire évoluer

L'outil vit dans `formation/` (voir `formation/README.md`) : un serveur Node sans
dépendance, un site apprenant (`/formation/`) et un back-office (`/formation/admin/`).
Les formations sont des fichiers JSON dans le dossier de données du Pi
(`/var/lib/akasha-formation/formations/<id>.json`), édités normalement **depuis le
back-office**. Le dépôt ne contient que le code et `donnees-initiales/`.

## Ligne éditoriale (non négociable — celle d'AKASHA)

« Relier sans confondre. Explorer sans imposer. Comprendre avant d'interpréter. »

- **Rien d'inventé.** Chaque affirmation vient des fiches/packs AKASHA validés par
  Laurent, d'un document qu'il fournit, ou d'une source de qualité citée (texte
  primaire, ouvrage de référence, encyclopédie universitaire) — jamais d'un blog ou
  d'un site commercial. Ce qui n'est pas validé par Laurent est signalé « à vérifier »
  et reste en **brouillon**.
- **Un vide reste un vide** : s'il manque une information pour une question, on la
  demande, on ne la suppose pas.
- **Jamais d'identité entre traditions.** Une correspondance s'enseigne avec son point
  commun ET sa différence ; un parallèle de fonction n'est pas une filiation. Le bon
  endroit pour la différence : l'encadré « ⚠︎ À ne pas confondre ».
- **Les essences de Laurent sont intouchables** : on les cite telles quelles.

## Écrire un niveau

- **Une idée maîtresse par niveau**, lisible en 5 minutes. Matière longue → plusieurs
  niveaux, du simple au complexe.
- **Leçon** = fragment HTML découpé en **cartes** par `<hr class="etape">` (une idée par
  carte, 3 à 5 cartes). Autorisé : `<h3>`, `<h4>`, `<p>`, `<strong>`, `<em>`, listes,
  `<table>`, `<blockquote>`, `<figure><img src="medias/…" alt="…"><figcaption>`, liens
  `https://`. Encadrés : `<div class="encadre">` (✦ À retenir),
  `<div class="exemple">` (◈ Exemple), `<div class="attention">` (⚠︎ À ne pas confondre).
  Tout le reste est retiré par le nettoyeur (`public/commun/nettoyer.js`).
- **Quiz** = 4 à 8 questions qui trouvent leur réponse dans la leçon :
  - mauvais choix **plausibles** (les vraies confusions : tradition voisine, attribut
    d'une autre figure), jamais absurdes ;
  - `bonnes` : index **à partir de 0**, plusieurs = choix multiple ;
  - une `explication` par question, qui cite la source quand c'est utile ;
  - `image` facultative (`medias/…`) pour une question visuelle.
- **Identifiants** : celui d'un niveau est fixé à sa création et porte la progression
  des apprenants — ne jamais le changer ; renommer le titre est sans risque.

Format JSON complet et règles de publication : `public/commun/valider.js`
(`normaliserFormation`, `verifierFormation`).

## Livrer du contenu

1. Rédige les niveaux en JSON (même forme que `donnees-initiales/formations/*.json`).
2. `node formation/outils/verifier-contenu.mjs <dossier-contenant-formations/>` : aucune
   erreur.
3. Deux chemins :
   - **Recommandé** : donne à Laurent le contenu à coller dans le back-office, ou
     le fichier `<id>.json` à déposer dans `/var/lib/akasha-formation/formations/` du Pi
     (en **brouillon** : `"publie": false`), puis il relit et publie lui-même ;
   - pour une formation livrée avec le code : l'ajouter à `donnees-initiales/` (copiée
     seulement si le dossier de données est vide).

## Faire évoluer le code

- Zéro dépendance : Node standard côté serveur, modules ES natifs côté navigateur.
- Identité : tokens de `public/commun/theme.css` (alignés sur l'app AKASHA déployée :
  `--void`, `--basalt`, `--gold`, `--bone`, `--faience`, `--lapis`, `--ember` ; Cinzel
  pour les titres, EB Garamond pour le corps, IBM Plex Mono en petites capitales pour
  les étiquettes). Toute animation reste sous `prefers-reduced-motion`.
- Mobile d'abord : cibles ≥ 44 px, action principale en bas, pas de défilement
  horizontal à 390 px.
- Tester avant de livrer : lancer le serveur avec un dossier de données jetable et
  `FORMATION_MOT_DE_PASSE`, puis parcourir en navigateur automatisé (Playwright) le
  back-office (créer, éditer, publier) et le parcours apprenant à 390 px (leçon, quiz
  raté puis réussi, déblocage, révision).

## Publier sur le Pi

`deploy/deployer-pi.sh [utilisateur@hote]` copie le code et redémarre le service ; il ne
touche jamais aux données. À lancer depuis un poste qui a accès au Pi : donne la commande
à Laurent plutôt que de la lancer sans accès vérifié.
