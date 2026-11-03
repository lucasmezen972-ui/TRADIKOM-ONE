# Recette TRADIKOM ONE — checkpoint du 3 novembre 2026

La préversion protégée du source `8c4c93e832a9c769073e3cefb9aeb0c2c3ecec57`, déploiement `dpl_kSML4ukksxj4vzadWFHcvMyXsLpj`, est **READY**, sur le schéma 134. La qualification globale reste en cours ; ce bilan ne conclut pas que toute l’application est terminée.

## Preuves natives hébergées acquises

| Contrôle | Résultat observé |
| --- | --- |
| Export CSV | 3 lignes, 259 octets ; SHA256 identique au payload SQL |
| Export JSON | 3 lignes, 408 octets ; SHA256 identique au payload SQL |
| Export XLSX | 3 lignes, 6 753 octets ; SHA256 identique au payload SQL, aucune cellule formule |
| Statut CRM | « Importé » conservé après sauvegarde, rechargement et contrôle SQL |
| Téléchargement natif | Audit serveur 9 avant clic → 10 après clic explicite → 10 après rechargement ; octets et hash conservés |
| Contraste | Texte blanc `rgb(255,255,255)` sur fond `rgb(8, 17,31)` ; ancre native avec attribut `download` |

Les exports contiennent uniquement les données fictives de recette. Le contrôle d’audit porte sur ce parcours observé ; les événements historiques sont conservés.

Les autres parcours natifs restent rattachés à leurs SHA d’origine : imports, notes et tâches CRM, opportunités, TXT/PDF texte avec extraction et téléchargement identique, objectifs consentis jusqu’à l’arrêt terminal, modules déterministes et décisions persistantes. Sur8c4c93e, le PDF privé a été retéléchargé à l’identique (1484octets, SHA conservé), l’extrait reste visible et l’objectif est toujours arrêté sans bouton de reprise. La dictée est désactivée sans consentement et l’IA est visiblement désactivée. Les autres parcours ne sont pas tous rejoués sur8c4c93e. Compte personnel, organisation fictive, données antérieures et session conservés.

## Tests locaux et inventaire

Le corpus de **203 fichiers** tourne encore sur le code métier `c8817c6ec849ba6fb0e4705c8f8c0e37801b1073`. **Aucun résultat final, total vert ou couverture complète n’est annoncé.** Les compléments de présentation et de téléchargement de 8c4c93e ont leurs preuves natives distinctes ci-dessus.

La matrice recense statiquement 42 pages, 17 gestionnaires HTTP, 143 actions serveur et 38 groupes ; 216 fichiers Vitest concernent le candidat135; le release134 découvre203 fichiers Vitest et25 déclarations Playwright séparées. Ces présences constituent une cartographie, pas des résultats d’exécution.

## Candidat 135 conservé séparément

Branche `codex/tradikom-one-schema135-candidate`, tête `954ff25d23eeb5930c88e817620b7efec24bdb83`. Ses preuves locales (54 tests distincts de stockage/associations et 3 tests de restauration) restent distinctes de la livraison 134.

La confirmation native de migration a **expiré** : migration 135 jamais appliquée, jamais contournée, aucun déploiement 135. Le stockage d’images PostgreSQL et les brokers publics préparés ne sont donc pas livrés dans cette préversion. L’échec réel du PNG de 5 513 octets reste une limite ouverte. Une nouvelle confirmation native valide est nécessaire avant cette migration.

## Limites et compléments attendus

Pas de nouvelle recette mobile sur le SHA final ; les anciennes preuves mobiles gardent leurs références. Providers externes non activés, IA modèle désactivée et budgets global/tenant à 0/0 ; plans moteur mock et propositions locales distingués d’une exécution réelle. Aucun OCR, antivirus ou microphone physique qualifié. Tests PostgreSQL distants ignorés et restauration complète de plateforme restent non qualifiés. PDF maître inaccessible dans ce cloud ; aucune nouvelle lecture revendiquée.

À compléter avant publication du bilan : résultats exacts du corpus 203 (échecs et ignorés compris), portée des contrôles locaux et journaux bornés du déploiement final. Aucun résultat futur à préremplir.


## Santé, journaux et conservation

Health natif du source final : ok=true/database=ok à20:11:32.651Z. Journaux du déploiement exact aux niveaux error/warning/fatal sur19:55:53Z–20:13:14Z : aucun groupe retrouvé; cela ne constitue pas une garantie globale. Supabase : zéro avis sécurité, schéma134/app_private absent/zéro asset; compte propriétaire préservé, trois contacts, tâche initiale ouverte et tâche dédiée terminée. Les deux anciens comptes jetables sont absents, sans nouveau nettoyage.

Les images de contraste avant/après sont conservées dans docs/evidence. La capture après concerne8612862; le même contraste et l’ancre native sont vérifiés séparément par DOM et SQL sur8c4c93e. Voir [preuve structurée native](NATIVE_RECIPE_VERIFICATION_2026-11-03.json).
