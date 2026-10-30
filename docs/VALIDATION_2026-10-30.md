# Validation du 30 octobre 2026

## Résultat et périmètre

Le source validé est `fa3b391fdc80b7a477a929af038e32aa3c17096b`. Le commit documentaire qui contient ce compte rendu conserve ce code. La validation ne vaut pas livraison des fournisseurs réels ou de la production.

| Contrôle | Commit | Résultat |
| --- | --- | --- |
| Suite Vitest exhaustive PostgreSQL | `69a0660` | 181 fichiers, 1 048 tests, zéro échec ou ignoré ; 2 317,95 secondes |
| Recette de la base | `69a0660` | Migrations, schéma, restauration, lint et typecheck réussis ; build compilé puis interrompu avec le code 143 ; Playwright non exécuté |
| Tests Goal Watch finaux | `fa3b391` | 4 fichiers, 52 tests, zéro échec ou ignoré |
| Répartition des 52 tests | `fa3b391` | 9 service, 3 accès, 38 horodatages et 2 durabilité PostgreSQL |
| Installation gelée et audit complet | `fa3b391` | Réussis ; zéro avis de production ou développement ; aucune exception masquée |
| Migrations, vérification et sauvegarde/restauration | `fa3b391` | Réussies sur PostgreSQL 17 jetable |
| Lint et typecheck globaux | `fa3b391` | Réussis |
| Build Next.js 16.4.1 | `fa3b391` | Réussi, compilation et TypeScript terminés |
| Playwright Chromium | `fa3b391` | 20 scénarios réussis, dont Conversation mock desktop/mobile |
| Continuité | `fa3b391` | ready, zéro erreur ; avertissement explicite sur le PDF absent du runner |
| Reçu final | `fa3b391` | finished, exitCode 0 |
| État final | Après la recette | git diff propre ; aucun conteneur de test restant ; Codespace arrêté et confirmation GitHub relue |

La suite exhaustive de 1 048 tests n'a pas été rejouée après les changements Goal Watch. Les 52 tests couvrent ce module et ses régressions ; les contrôles globaux et Playwright ont été rejoués sur le source final. Ces suites se recouvrent : ne pas additionner leurs nombres comme un total de tests uniques.

## Garanties contrôlées pour Goal Watch

Rapport Conversation, identité système et audit partagent la même transaction. Un échec de l'audit annule le rapport et ses annexes, puis le retry reste possible. Deux connexions PostgreSQL distinctes attendent le verrou de l'objectif et n'émettent qu'une seule preuve. Le fil est verrouillé et son archive vérifiée.

Le rejeu consulte tout l'historique des clés. Une même clé avec une autre date, une nouvelle clé à date égale et une observation périmée sont refusées avant tout rapport. Les audits sont classés selon l'instant observé. Les dates acceptées sont comparables avec Date.parse et PostgreSQL : précision de zéro à trois décimales, offset inférieur à 16 heures, année minimale 0001.

Les limites restantes du module sont décrites dans [GOAL_WATCH_DURABILITY_REVIEW.md](./GOAL_WATCH_DURABILITY_REVIEW.md).

## Environnement et coût

Codespace personnel de deux cœurs dans le quota inclus, avec garde de dépense nulle vérifiée avant création. UID 1000, Node 22.23.4, pnpm 11.7.0, Docker 29.9.2-2, PostgreSQL 17. Aucun port public, prébuild, achat ou Vercel Sandbox. Aucun clone ou node_modules installé sur le Mac.

Les fournisseurs sont désactivés pour ces contrôles. Les tests SDK Teams/MSAL et OpenAI utilisent des doubles de transport ; ils ne prouvent pas une authentification ou génération réelle.

Le workflow planifié `tradikom-continuity.yml` a été désactivé manuellement. Les commits portent `[skip ci]` ; aucun run Actions associé aux commits source corrigés lors des vérifications.

## Preuves conservées

Le résumé structuré est [VALIDATION_2026-10-30.json](./VALIDATION_2026-10-30.json).

Dans le Codespace arrêté `grim-spooky-phantasm-69756wwgw9v734v5` :

- `/tmp/tradikom-final-verification.log` et `/tmp/tradikom-final-result.json` : base 69a0660.
- `/tmp/tradikom-goal-verification.log` et `/tmp/tradikom-goal-result.json` : correctif intermédiaire b8a83e9, 49 tests et 20 scénarios verts.
- `/tmp/tradikom-goal-final-verification.log` et `/tmp/tradikom-goal-final-result.json` : source final fa3b391, code zéro.
- `/tmp/tradikom-goal-verify.sh` : variante ciblée de la recette canonique, conservant ses gardes, le PostgreSQL jetable et son nettoyage ; seul le lancement Vitest exhaustif est remplacé par les quatre fichiers Goal Watch, avec audit complet ajouté.

Ces journaux sont disponibles tant que le Codespace est conservé. Aucun résultat ancien ou interrompu n'est attribué à un nouveau commit. Le PDF canonique a été lu dans la session antérieure et son SHA confirmé ; aucune nouvelle lecture de pages n'est attribuée au runner distant où il était absent.
