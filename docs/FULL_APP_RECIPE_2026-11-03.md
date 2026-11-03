# Recette TRADIKOM ONE — checkpoint du 3 novembre 2026

La préversion protégée du source `8c4c93e832a9c769073e3cefb9aeb0c2c3ecec57`, déploiement `dpl_kSML4ukksxj4vzadWFHcvMyXsLpj`, est **READY**, sur le schéma 134. Le corpus local est terminé : **1 153 tests réussis, 37 ignorés, aucun échec**, dans 203 fichiers. Cinq scénarios mobiles locaux distincts passent sur le source final, en deux exécutions avec une reprise ciblée. Les limites ci-dessous empêchent de déclarer toute l’application terminée.

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

Le corpus de **203 fichiers** est entièrement parcouru sur le code métier `c8817c6ec849ba6fb0e4705c8f8c0e37801b1073`, arbre `66d551a92f757ee959e4e3ac50b5a089c76f7b99` : **1 153 tests réussis, 37 ignorés, aucun échec**, soit 1 190 tests. 187 fichiers comportent des assertions réussies et 16 sont entièrement ignorés. Chaque fichier dispose d’un processus terminé avec code zéro et d’un rapport JSON cohérent. Une tentative CRM interrompue sans rapport est conservée dans l’historique ; sa reprise réussie est comptée une seule fois. Les tests ignorés restent non prouvés.

Lint et TypeScript passent ; continuité « ready », avec l’avertissement du PDF maître inaccessible conservé. Ces contrôles portent sur le même arbre métier, sous Node **24.22.1** et PGlite local. Ils ne remplacent pas une qualification PostgreSQL physique distante. Du source testé au source final 8c4c93e, seuls `globals.css`, le lien de téléchargement de la page Données et sa documentation changent ; services, actions, SQL et tests sont identiques. Le complément possède ses preuves natives distinctes et le build fournisseur du SHA final réussit sous **Node 22**. Aucun build local complet supplémentaire n’est revendiqué. [Rapports, empreintes et ignorés](LOCAL_TEST_VERIFICATION_2026-11-03.json).

La matrice recense statiquement 42 pages, 17 gestionnaires HTTP, 143 actions serveur et 38 groupes ; 216 fichiers Vitest concernent le candidat135; le release134 découvre203 fichiers Vitest et25 déclarations Playwright séparées. Ces présences constituent une cartographie, pas des résultats d’exécution.

## Recette mobile locale du source final

Chrome Headless Shell 156, écran tactile émulé **390 × 844**, Node 24.22.1, fixtures PGlite et profils navigateur privés : cinq scénarios distincts passent sur **8c4c93e**.

- Demande Conversation, confirmation et vraie tâche CRM locale, puis fiche contact.
- Refus durable d’une proposition, sans création de tâche.
- Consentement, pause, nouveau consentement, reprise et arrêt terminal d’objectif.
- Dictée simulée et brouillon modifiable ; document TXT privé réellement importé, filtré, extrait, retéléchargé puis rechargé localement.
- Installation et révocation du connecteur GitHub dans la fixture locale, sans lecture du réseau GitHub.

La première exécution termine quatre scénarios et échoue avant les assertions du scénario objectif : connexion refusée pendant le redémarrage du serveur Next de développement à son seuil mémoire. Le seul scénario affecté est rejoué avec une fixture neuve et un plafond mémoire de 3 072 MiB ; il passe. **Cinq scénarios distincts réussis sur deux exécutions, six passages au total ; aucune exécution unique de cinq tests tous verts.** Le résultat initial reste conservé. Fontes et image externes sont remplacées par des fixtures hors réseau. Cela qualifie une émulation mobile locale de développement, pas une nouvelle recette mobile hébergée, un microphone physique ou une lecture fournisseur réelle. Les 19 autres scénarios UI et un scénario API nécessitant PostgreSQL partagé n’ont pas été exécutés dans cette campagne. [Preuve mobile structurée](MOBILE_LOCAL_VERIFICATION_2026-11-03.json).

## Candidat 135 conservé séparément

Branche `codex/tradikom-one-schema135-candidate`, tête `954ff25d23eeb5930c88e817620b7efec24bdb83`. Ses preuves locales (54 tests distincts de stockage/associations et 3 tests de restauration) restent distinctes de la livraison 134.

La confirmation native de migration a **expiré** : migration 135 jamais appliquée, jamais contournée, aucun déploiement 135. Le stockage d’images PostgreSQL et les brokers publics préparés ne sont donc pas livrés dans cette préversion. L’échec réel du PNG de 5 513 octets reste une limite ouverte. Une nouvelle confirmation native valide est nécessaire avant cette migration.

## Limites et compléments attendus

Les anciennes preuves mobiles hébergées gardent leurs références ; la nouvelle recette mobile est locale. Providers externes non activés, IA modèle désactivée et budgets global/tenant à 0/0 ; plans moteur mock et propositions locales distingués d’une exécution réelle. Aucun OCR, antivirus ou microphone physique qualifié. Tests PostgreSQL distants ignorés, 20 scénarios Playwright non exécutés, restauration complète de plateforme et segment interne pooler/base restent non qualifiés. Les fichiers de recette sont petits : aucun essai de charge ou de volumes maximaux n’est déduit. PDF maître inaccessible dans ce cloud ; aucune nouvelle lecture revendiquée.

Prochaine étape restante : obtenir une nouvelle confirmation native valide pour la migration 135, puis qualifier schéma, stockage image et publication sur leur SHA exact. Ne pas relancer automatiquement la demande expirée, activer de budget ou recréer les comptes. Conserver les résultats de cette campagne.


## Santé, journaux et conservation

Health natif du source final : ok=true/database=ok à 20:11:32.651Z puis 21:09:37.419Z. Journaux du déploiement exact aux niveaux error/warning/fatal sur les trois fenêtres 19:55:53Z–20:13:14Z, 20:13:14Z–20:33:07Z et 20:33:07Z–21:19:52Z : aucun groupe retrouvé ; cela ne constitue pas une garantie globale. Supabase : zéro avis sécurité, schéma134/app_private absent/zéro asset ; compte propriétaire préservé, trois contacts, tâche initiale ouverte et tâche dédiée terminée. La dernière lecture confirme le schéma, le propriétaire, les trois contacts et l’absence des deux anciens comptes jetables, sans nouveau nettoyage.

Les images de contraste avant/après sont conservées dans docs/evidence. La capture après concerne8612862; le même contraste et l’ancre native sont vérifiés séparément par DOM et SQL sur8c4c93e. Voir [preuve structurée native](NATIVE_RECIPE_VERIFICATION_2026-11-03.json).
