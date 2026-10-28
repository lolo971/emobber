# emobber

## Skills Claude Code

| Skill | Rôle |
|-------|------|
| [`chief-of-staff`](.claude/skills/chief-of-staff/SKILL.md) | Briefing du jour, tri des priorités, préparation de réunions, suivi et relances, revue de la semaine, rédaction de messages à valider. |
| [`formation-contenu`](.claude/skills/formation-contenu/SKILL.md) | Rédiger les niveaux, leçons et quiz de l'outil de formation, puis les vérifier et les publier. |

Les skills placés dans `.claude/skills/` sont chargés automatiquement par Claude Code
quand une session s'ouvre sur ce dépôt. Exemples de demandes :

- « Fais-moi mon briefing »
- « Prépare ma réunion de 14 h avec le fournisseur »
- « Quelles relances dois-je faire ? »
- « Ajoute un niveau sur … à la formation »
- « Publie la formation »

## Outil de formation

Site de formation à niveaux déblocables par quiz, hébergé sur le Raspberry Pi :
voir [`formation/README.md`](formation/README.md).
