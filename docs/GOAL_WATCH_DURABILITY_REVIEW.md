# Goal Watch : correctif de durabilité vérifié

Le source `fa3b391fdc80b7a477a929af038e32aa3c17096b` corrige la publication d'un rapport avant le rejet d'une observation périmée, les rejeux limités à la dernière clé et les évaluations concurrentes lisant le même état.

## Comportement obtenu

- Une transaction contient les lectures, le rapport Conversation, l'identité système et l'audit. Le rollback est prouvé sur PostgreSQL.
- L'objectif puis le fil sont verrouillés. Deux backends concurrents n'émettent qu'une preuve ; un fil archivé refuse le rejeu.
- Une clé historique retrouve sa preuve sans modifier la dernière observation. Sa réutilisation avec une autre date échoue.
- Une nouvelle clé à date égale ou antérieure est refusée avant le rapport. Les preuves sont ordonnées par observedAt, indépendamment d'un identifiant aléatoire d'audit.
- PGlite réserve sa connexion via sa transaction native. PostgreSQL conserve ses verrous jusqu'au commit.
- Observations et audits partagent le même contrat temporel : précision milliseconde, offset inférieur à 16 heures, année à partir de 0001 et Date.parse fini. Un historique hors contrat est refusé fermé, sans troncature.

## Preuve

52 tests natifs réussis sur quatre fichiers : 9 service, 3 accès, 38 horodatages et 2 PostgreSQL. Les cas PostgreSQL vérifient le blocage réel entre deux connexions et l'annulation du rapport/identité si l'audit échoue. Le test efface son snapshot de statistiques à chaque lecture de pg_stat_activity.

Installation gelée, audit complet zéro avis, lint, typecheck, build et 20 scénarios Playwright sont verts sur ce même source. La revue indépendante a fait corriger les écarts de précision, d'offset, d'année zéro et de snapshot du test. Voir [VALIDATION_2026-10-30.md](./VALIDATION_2026-10-30.md) pour distinguer cette recette ciblée de la suite exhaustive de la base.

## Limites maintenues

La tranche ne livre pas de migration, contrainte unique dédiée aux évaluations, RLS Goal Watch spécialisée, sélection équitable/pagination, interface de consentement/arrêt ou activation de maintenance. OS-6 reste partiel. Aucun fournisseur réel, objectif récurrent, fusion ou déploiement n'est activé.
