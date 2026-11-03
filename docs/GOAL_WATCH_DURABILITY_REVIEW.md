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


## Finalisation du 3 novembre 2026 — objectifs et première action CRM réelle

Le consentement Goal Watch est maintenant durable et obligatoire. Les anciens objectifs sans contrôle restent non autorisés. La pause bloque les évaluations, la reprise exige une nouvelle confirmation et l’arrêt est terminal. Les créations sont dédupliquées par demande et les changements de version sont contrôlés. Les évaluations et changements d’état verrouillent les mêmes lignes ; les écritures sont annulées si l’audit échoue. La sélection SQL porte seulement sur les objectifs dus, répartit les entrées par entreprise et recule les objectifs invalides pour ne pas bloquer les lots.

Migrations additives 125/126 et miroirs SQL 0119/0120 : contrôles durables, relations tenant/fil/entrée et RLS des objectifs, preuves et audits. La règle générique tenant_isolation est retirée des contrôles : elle permettait sinon une lecture indue lors d’une activation différée de la RLS. Les identités et clés des preuves Goal Watch/actions natives sont réservées au runtime système.

Conversation propose aussi la création explicite d’une vraie tâche pour un contact CRM de cette entreprise. La visibilité équipe est confirmée. La tâche, l’activité CRM, le rapport dans le fil et l’audit forment une transaction ; un rejeu n’en crée pas une deuxième. Le pipeline de plans mock reste identifié comme mock et n’est pas renommé en intégration réelle. Aucun message externe n’est envoyé.

Preuves locales : lots service/RLS verts, 17 tests de service/RLS sur PostgreSQL 17.5 embarqué, 20 tests de migrations existantes verts, 3 tests des tâches natives verts et 2 scénarios Playwright de bout en bout verts. Le test de tâche retrouve la vraie tâche sur la fiche du contact. Les lots se recouvrent. La suite exhaustive et le build du candidat sont suivis séparément. Ces migrations ne sont pas encore appliquées à Supabase ; la préversion publiée reste le socle 0dfa1f2/schema124.


## État courant — 3 novembre 2026

Les limites historiques de la section antérieure sont remplacées pour le consentement, la pause/reprise/arrêt, la RLS spécialisée et la sélection équitable des objectifs dus : ces éléments sont implémentés et vérifiés. Le candidat 0da2c88 n’est pas encore activé sur Supabase. L’interface indique explicitement que les évaluations automatiques ne sont pas programmées sur cette préversion. Les confirmations 125/126 puis 125–132 ont expiré sans effet. Voir PRODUCT_FINALIZATION_2026-11-03.md et AGENT_STATE.json pour la recette courante et les blocages opérateur.
