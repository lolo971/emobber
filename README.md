# emobber

## Skills Claude Code

| Skill | Rôle |
|-------|------|
| [`chief-of-staff`](.claude/skills/chief-of-staff/SKILL.md) | Briefing du jour, tri des priorités, préparation de réunions, suivi et relances, revue de la semaine, rédaction de messages à valider. |
| [`formation-contenu`](.claude/skills/formation-contenu/SKILL.md) | Rédiger les formations AKASHA (leçons, quiz, visuels) sans rien inventer, faire évoluer l'outil et le publier. |
| [`ui-ux-pro-max`](.claude/skills/ui-ux-pro-max/SKILL.md) | Base de règles UI/UX interrogeable : 119 règles d'ergonomie, styles, palettes, typographies, graphiques, 22 technologies. |
| [`frontend-design`](.claude/skills/frontend-design/SKILL.md) | Direction artistique distinctive, éviter le rendu « généré par IA » (Anthropic). |
| [`responsive-design`](.claude/skills/responsive-design/SKILL.md) | Mobile d'abord, container queries, typographie fluide, points de rupture. |
| [`accessibility-compliance`](.claude/skills/accessibility-compliance/SKILL.md) | WCAG 2.2, lecteurs d'écran (VoiceOver, TalkBack), clavier, contrastes. |
| [`mobile-ios-design`](.claude/skills/mobile-ios-design/SKILL.md) | Apple Human Interface Guidelines, SwiftUI. |
| [`mobile-android-design`](.claude/skills/mobile-android-design/SKILL.md) | Material Design 3, Jetpack Compose. |
| [`mobile-native`](.claude/skills/mobile-native/SKILL.md) | Faire « app installée » sur téléphone : hover collant, flash au toucher, 100vh, zoom des champs, encoche, latence des taps. |
| [`emil-design-eng`](.claude/skills/emil-design-eng/SKILL.md) | Philosophie de finition d'Emil Kowalski : animations, composants, détails invisibles. |
| [`animate`](.claude/skills/animate/SKILL.md) | Construire une animation juste : courbe, durée, propriétés, interruption, sortie. |
| [`apple-design`](.claude/skills/apple-design/SKILL.md) | Mouvement fluide et physique à la manière d'Apple, transposé au web : ressorts, gestes, tiroirs, matières. |
| [`interaction-design`](.claude/skills/interaction-design/SKILL.md) | Micro-interactions, transitions, chargements, toasts, menus. |
| [`animation-performance`](.claude/skills/animation-performance/SKILL.md) | 60 images/s : propriétés composées, causes des saccades. |
| [`find-animation-opportunities`](.claude/skills/find-animation-opportunities/SKILL.md) · [`improve-animations`](.claude/skills/improve-animations/SKILL.md) · [`review-animations`](.claude/skills/review-animations/SKILL.md) | Trouver où animer, auditer et relire le mouvement existant (les deux derniers sur demande explicite). |
| [`animation-vocabulary`](.claude/skills/animation-vocabulary/SKILL.md) | Le bon mot pour chaque effet (« pop in », « rubber-banding »…). |
| [`break-ui`](.claude/skills/break-ui/SKILL.md) | Éprouver l'interface avec des données extrêmes (noms très longs, listes vides…). |

Origine, licences et **ordre de priorité** (l'identité AKASHA prime toujours) : [`.claude/skills/SOURCES.md`](.claude/skills/SOURCES.md).

Les skills placés dans `.claude/skills/` sont chargés automatiquement par Claude Code
quand une session s'ouvre sur ce dépôt. Exemples de demandes :

- « Fais-moi mon briefing »
- « Prépare ma réunion de 14 h avec le fournisseur »
- « Quelles relances dois-je faire ? »
- « Ajoute un niveau sur … à la formation »
- « Publie la formation »

## Formation AKASHA

Site de formation à niveaux déblocables par quiz (mobile d'abord, ludique) et back-office
pour créer les formations, leurs textes et leurs visuels. Hébergé sur le Raspberry Pi :
voir [`formation/README.md`](formation/README.md).
