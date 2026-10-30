# Recette distante sans GitHub Actions

## Résultat actuel

La recette ciblée de `fa3b391fdc80b7a477a929af038e32aa3c17096b` se termine avec le code zéro : installation gelée, audit complet zéro avis, migrations, vérification, sauvegarde/restauration, lint, typecheck, 52 tests Goal Watch avec PostgreSQL, build et 20 scénarios Playwright. Le contrôle de continuité retourne ready avec zéro erreur et l'avertissement PDF absent du runner.

La base `69a06604c033ba35670578fd97581a8292799838` avait auparavant passé la suite exhaustive de 1 048 tests sur 181 fichiers. Son build a ensuite été interrompu, code 143. La suite exhaustive n'a pas été rejouée après le correctif Goal Watch. Les périmètres et preuves exacts figurent dans [VALIDATION_2026-10-30.md](./VALIDATION_2026-10-30.md).

## Runner et frontières

Codespace `grim-spooky-phantasm-69756wwgw9v734v5`, deux cœurs, UID 1000, Node 22.23.4, pnpm 11.7.0, Docker et PostgreSQL 17 jetable. Les ports réacheminés sont privés ; aucun port public ou prébuild.

Une garde de dépense nulle a été vérifiée avant création. Aucun Vercel Sandbox, achat ou option payante. Aucun clone ou node_modules installé sur le Mac. Le workflow planifié `tradikom-continuity.yml` est désactivé manuellement ; les commits portent `[skip ci]`.

Le dernier conteneur PostgreSQL a été supprimé par le trap de recette ; l'absence de conteneurs a été vérifiée. Le Codespace a été arrêté via GitHub et la confirmation relue. Il n'est pas supprimé : ses journaux restent disponibles tant qu'il est conservé.

## Reproduire uniquement dans un runner autorisé

1. Vérifier le quota et le budget zéro avant tout redémarrage.
2. Obtenir le SHA exact à tester depuis GitHub, conserver cette valeur séparément et vérifier le checkout.
3. Utiliser Linux distant avec Node 22, pnpm 11.7.0 et le moteur Docker local ; aucune DATABASE_URL existante.
4. Définir TRADIKOM_VERIFY_ISOLATED=1 et TRADIKOM_EXPECTED_SHA puis lancer scripts/verify-isolated.sh pour une recette exhaustive.
5. Conserver les sorties et leur SHA, vérifier le code final, puis arrêter le runner.

Le script refuse macOS, une base préexistante, un moteur Docker distant ou un SHA différent. Il crée sa propre base, génère une clé de test non affichée, désactive les fournisseurs et nettoie seulement son conteneur. Playwright utilise le loopback. Les identifiants PostgreSQL fixes concernent uniquement le conteneur jetable.

La variante ciblée exécutée remplace seulement pnpm test par les quatre fichiers Goal Watch et ajoute pnpm audit --json. Le reste de la recette canonique est conservé, notamment ses gardes, migrations, restauration, lint, typecheck, build et Playwright. Elle est conservée dans /tmp/tradikom-goal-verify.sh du Codespace arrêté.

## Infrastructure applicative

Supabase reste inactif et distinct de la base jetable. Le projet Vercel dédié conserve sa protection SSO et les préversions automatiques désactivées ; aucun déploiement. Les fournisseurs métier et la programmation des objectifs ne sont pas activés.

L'essai Colab antérieur est historique : sa fin d'installation et ses tests n'avaient pas été récupérés. Il n'est pas utilisé comme preuve verte.
