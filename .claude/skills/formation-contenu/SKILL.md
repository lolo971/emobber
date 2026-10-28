---
name: formation-contenu
description: À utiliser quand Laurent veut créer, enrichir ou corriger un niveau, une leçon ou un quiz de l'outil de formation (dossier formation/), changer l'ordre ou le seuil des niveaux, démarrer un nouveau parcours, ou publier la formation sur le Raspberry Pi. Déclencheurs : « ajoute un niveau », « fais un quiz sur… », « transforme ce document en leçon », « nouvelle formation », « publie la formation ».
---

# Rédiger le contenu de formation

Le site (`formation/index.html`, `style.css`, `app.js`) ne change pas pour ajouter
du contenu : tout se passe dans `formation/contenu/`. Format complet :
`formation/README.md`.

## Règles de fond

- **Rien d'inventé.** Chaque affirmation d'une leçon vient du document, des notes ou
  des explications fournies par Laurent, ou d'une source que tu cites. S'il manque une
  information pour une question, demande-la au lieu de la supposer.
- **Une leçon = une idée maîtresse**, lisible en 5 minutes maximum. Si la matière est
  plus longue, découpe-la en plusieurs niveaux, du plus simple au plus avancé.
- **Le quiz vérifie la leçon, rien de plus** : chaque question doit trouver sa réponse
  dans le texte du niveau (ou des niveaux précédents).

## Écrire un niveau

1. **Dossier** : `formation/contenu/niveaux/NN-slug/` (NN = position sur deux chiffres).
2. **`lecon.html`** — fragment HTML, sans `<html>`, `<head>`, `<style>` ni `<script>` :
   - titres de section en `<h3>` (le `<h1>` est généré par le site) ;
   - paragraphes courts, listes, `<table>` pour les chiffres ;
   - au plus deux ou trois encadrés : `<div class="encadre">` (notion clé),
     `<div class="exemple">` (cas chiffré concret), `<div class="attention">` (piège) ;
   - images dans le dossier du niveau, référencées par
     `contenu/niveaux/NN-slug/image.png`, avec un `alt` descriptif.
3. **`niveau.json`** — 4 à 8 questions :
   - `id` court et unique dans le niveau, `enonce` sans ambiguïté ;
   - 3 ou 4 `choix` plausibles : les mauvais choix reprennent les erreurs réelles
     (confusion de notions, erreur de calcul classique), jamais d'absurdité ;
   - `bonnes` : numéros **à partir de 0** ; plusieurs numéros = choix multiple, à
     annoncer clairement dans l'énoncé si ce n'est pas évident ;
   - `explication` pour chaque question : pourquoi la bonne réponse est bonne ;
   - ne mets pas toujours la bonne réponse à la même position ;
   - `"seuil"` seulement si ce niveau doit différer du seuil du parcours.
4. **Déclaration** dans `formation/contenu/parcours.json` : ajouter
   `{ "id", "titre", "resume", "dossier" }` à la bonne place de `niveaux`.
   Ne change jamais l'`id` d'un niveau existant : la progression des apprenants y est
   rattachée.

## Nouveau parcours

Remplacer le parcours de démonstration : nouvel `id` (la progression est stockée par
`id` de parcours), nouveau `titre` / `sousTitre`, nouvelle liste `niveaux`, et
supprimer les dossiers de démonstration devenus inutiles.

## Contrôler

```bash
node formation/outils/verifier-contenu.mjs
python3 -m http.server 8000 -d formation
```

Le vérificateur doit finir par `✓ Contenu valide`. Ensuite, ouvre le site et passe le
quiz du niveau modifié : une fois avec les bonnes réponses (le niveau suivant doit
s'ouvrir), une fois avec une erreur. Si Playwright est disponible, fais-le en
navigateur automatisé et vérifie aussi l'affichage en largeur téléphone.

## Livrer

Commit avec un message `formation: <ce qui a changé>`. La publication sur le Pi
(`deploy/deployer-pi.sh`) se lance depuis un poste qui a accès au Pi : donne la
commande à Laurent plutôt que de la lancer sans accès vérifié.
