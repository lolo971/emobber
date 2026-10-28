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
