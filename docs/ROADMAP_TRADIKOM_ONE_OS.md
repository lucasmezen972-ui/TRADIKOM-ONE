# Roadmap TRADIKOM ONE OS

La roadmap progresse par tranches verticales utilisables. Une tranche horizontale ou un nouvel écran métier n'est pas prioritaire s'il ne rapproche pas la conversation continue d'un résultat auditable.

| Phase | Objectif | État | Critère de sortie |
| --- | --- | --- | --- |
| OS-0 | Audit, recadrage et continuité | Terminé | Audit, ADR, drift report, état de reprise, automations et suite verte |
| OS-1 | Conversation Hub canonique | En cours | Un fil visible sur le web et un canal de test, identité, idempotence, anti-boucle, plan, validation, deux capacités mock, audit et reprise |
| OS-2 | Omnicanal réel préparé | Verrouillé | Adaptateurs WhatsApp, Teams, Slack et email feature-flaggés, signatures et erreurs normalisées, sans fausse intégration |
| OS-3 | Connector Runtime générique | Partiel | Deux capacités génériques exécutables sous policy, preuve, idempotence, quota et classification d'échec |
| OS-4 | Mission durable | Partiel | Plan confirmé, exécution multi-étapes, attente, retry, reprise et compensation |
| OS-5 | Premier fournisseur réel | Bloqué fournisseur | Un fournisseur officiel activé en sandbox ou vrai read-only avec clés, consentement et parcours vérifié |
| OS-6 | Goal and Watch Engine | À faire | Un objectif permanent surveillé et rapporté dans la conversation |
| OS-7 | Expérience mobile | À faire | Chat, vocal, document et validations fortes sur mobile |
| OS-8 | Marketplace SDK | À faire | Un connecteur tiers minimal installé, testé et révocable |

## Règles de passage

- Une phase n'est ouverte que si la précédente passe lint, typecheck, tests, migrations, build et Playwright pertinents.
- Toute table tenant porte RLS, un index commençant par `tenant_id` et des relations tenant-composées.
- Tout fournisseur sans clés reste `not_configured`, `disabled`, `mock` ou `manual`; aucun statut réel n'est inventé.
- Toute action sensible passe par politique, validation humaine et audit sans secret.
- Les publications publiques lisent un snapshot immuable.
- Les sorties IA sont structurées, versionnées, sourcées et approuvées avant tout effet.

## Réutilisation du socle

OS-1 réutilise le runtime PostgreSQL/RLS, les transactions tenant, l'audit, les approvals, les workflows durables, les événements, les notifications et le Connector Runtime existants. Il n'ajoute pas un deuxième moteur d'exécution.

## Réutilisation de la PR #10

La PR #10 ne doit pas être fusionnée comme une tranche unique. Les éléments suivants peuvent être extraits et revalidés séparément : suppression de compte, centre d'approbation, provider email HTTP et suppressions, assets, révision de contenu et normalisation WhatsApp. Le Kanban, l'ordre des cartes, les préférences de pipeline et les enrichissements du dashboard restent secondaires tant qu'OS-1 n'est pas livré.
