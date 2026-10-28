# Skills importés — origine, licence, ordre de priorité

| Skill | Origine (commit) | Licence | Modifié ? |
|-------|------------------|---------|-----------|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) `28b3b8d` | MIT | Chemins du script rendus relatifs au dépôt (`.claude/skills/ui-ux-pro-max/scripts/search.py`) ; tests retirés. |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `dbd4588` | Apache-2.0 | Non |
| `mobile-ios-design` | [wshobson/agents](https://github.com/wshobson/agents) `0874a27`, plugin `ui-design` | MIT | Non |
| `mobile-android-design` | idem | MIT | Non |
| `responsive-design` | idem | MIT | Non |
| `accessibility-compliance` | idem | MIT | Non |
| `interaction-design` | idem | MIT | Non |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `2d22863` (auteur de Sonner et Vaul, cours animations.dev) | MIT | Non |
| `animate` | idem | MIT | Non |
| `review-animations` | idem | MIT | Non |
| `improve-animations` | idem | MIT | Non |
| `find-animation-opportunities` | idem | MIT | Non |
| `animation-performance` | idem | MIT | Non |
| `animation-vocabulary` | idem | MIT | Non |
| `apple-design` | idem | MIT | Non |
| `mobile-native` | idem | MIT | Non |
| `break-ui` | idem | MIT | Non |

Non importés (hors de notre pile HTML/CSS/JS sans framework) : `animate-expo` (React Native), `write-swift`,
`ask-sonner` et `pick-ui-library` (bibliothèques React), `prototype`.

Contenu relu avant import (aucun appel réseau, aucune commande système dans les scripts ; aucune
instruction cachée dans les références). Le script de UI UX Pro Max ne demande que Python 3 :

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<requête>" --domain ux
```

## Ordre de priorité pour tout travail d'interface AKASHA

1. **L'identité AKASHA** — skill `akasha-design-system` et les jetons de `formation/public/commun/theme.css`
   (nuit, or, Cinzel / EB Garamond / IBM Plex Mono, couleurs de registre). Elle prime toujours.
2. **La ligne éditoriale** — « Relier sans confondre », registres, rien d'inventé (`formation-contenu`).
3. **Les skills génériques ci-dessus** — pour l'ergonomie, l'accessibilité, le responsive, les conventions
   iOS / Android et la qualité d'exécution. Leurs palettes, polices ou styles « recommandés » ne remplacent
   jamais l'identité AKASHA : on n'en retient que les règles d'usage (cibles tactiles, contrastes,
   navigation, mouvements, formulaires…).
