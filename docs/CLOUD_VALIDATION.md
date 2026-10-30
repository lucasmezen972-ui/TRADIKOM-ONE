# Recette distante sans GitHub Actions

## Recette gratuite et dépendances corrigées — 30 octobre 2026

Cette section remplace les anciennes instructions de reprise : aucune dépense additionnelle n'est autorisée. GitHub est accessible sur le bon compte et le workflow planifié `tradikom-continuity.yml` a été désactivé manuellement, bannière relue. Aucun GitHub Actions n'a été lancé.

Un Codespace de validation de deux cœurs a été créé dans le quota inclus, après vérification d'une garde de dépense nulle. Il dispose d'un utilisateur OS non-root (UID1000), de Node22.23.4 et de Docker29.9.2-2. Aucun prébuild ou port public n'est configuré. La recette complète n'a pas encore démarré : récupérer le nouveau SHA GitHub exact et exécuter `scripts/verify-isolated.sh`, conserver les preuves puis arrêter l'environnement.

Le runtime distant Work Mode a installé le lockfile du dépôt sans utiliser le Mac. Sur les dépendances mises à jour : lint et typecheck complets verts; 23 tests natifs OpenAI/accès objectifs et 10 tests de compatibilité Teams/MSAL verts. L'audit `--prod` passe de 41 avis (4 critiques) à zéro, sans avis ignoré. Voir [DEPENDENCY_SECURITY.md](./DEPENDENCY_SECURITY.md) pour les versions et limites de l'override MSAL.

Le build natif est vert sur la baseline `0c84f609`, avant ces mises à jour. Le build des dépendances corrigées, Vitest exhaustif, PostgreSQL/RLS, la restauration et Playwright restent à exécuter dans Codespaces. La première suite Vitest exhaustive a été interrompue pour corriger les dépendances; elle n'est pas présentée comme verte. Le contrôle de continuité retourne `ready` avec l'avertissement explicite que le PDF canonique n'est pas disponible dans ce runtime distant.

Le premier essai Colab reste un historique non vérifié jusqu'à sa fin d'installation; il est remplacé pour la suite par ce Codespace. Supabase reste inactif et distinct de la base jetable. Aucun fournisseur métier n'est activé, aucun déploiement ou achat n'est effectué.


## Environnement préparé

Le projet Vercel `tradikom-one` existe dans l'équipe sélectionnée. Il utilise Node.js 22, conserve la protection SSO standard et désactive les préversions automatiques. Aucun déploiement n'est publié.

- Project ID : `prj_O2ELIL9DNsaEvTdikMzVlXC0mFsM`
- Team ID : `team_eOj0znuFk29qlFsws8LfLC9W`
- Sources : `lucasmezen972-ui/TRADIKOM-ONE`, branche `codex/tradikom-one-os`
- GitHub Actions : aucun lancement autorisé pour ce travail ; commits `[skip ci]`. Une planification historique existe sur `main` dans `tradikom-continuity.yml` (toutes les six heures). La suspendre dans GitHub après connexion : `[skip ci]` ne désactive pas les événements `schedule`.
- Mac : aucun clone ni installation de dépendances.

La console Supabase doit être rétablie par l'opérateur avant de valider le runtime de l'application. Les tests peuvent utiliser un PostgreSQL jetable distinct : ils ne doivent pas réutiliser une base ou une clé de production.

## Runner de recette proposé, non lancé

Une session Linux jetable Vercel Sandbox peut exécuter la recette avec Node.js 22 et Docker. La session proposée est limitée à 20 minutes, 2 vCPU, sans persistance, snapshot ni port public. Avant sa création, vérifier le forfait, les quotas et le budget autorisé. La préparation du projet n'est pas une autorisation de dépense.

Le script `scripts/verify-isolated.sh` :

- refuse macOS, un moteur Docker distant, une `DATABASE_URL` préexistante ou un SHA différent ;
- exige Node.js 22 et pnpm 11.7.0 ;
- crée et supprime uniquement son conteneur PostgreSQL 17 jetable ;
- utilise des données de test et retire les principales variables de fournisseurs ;
- installe le lockfile, vérifie les dépendances, les migrations et la restauration ;
- exécute lint, typecheck, tests, build et Playwright sur le serveur local du runner ;
- ne crée ni programmation, ni token, ni appel fournisseur réel.

Les clés cryptographiques de test sont générées dans le runner et ne sont pas affichées. Les identifiants PostgreSQL fixes du script concernent uniquement ce conteneur jetable accessible en loopback.

## Exécution, exclusivement dans le runner autorisé

Lire le SHA intégral courant dans GitHub et le conserver séparément comme `TRADIKOM_EXPECTED_SHA`. Ne pas remplacer cette vérification par une lecture automatique du HEAD local après coup.

```bash
git clone --single-branch --branch codex/tradikom-one-os \
  https://github.com/lucasmezen972-ui/TRADIKOM-ONE.git
cd TRADIKOM-ONE
git checkout --detach "$TRADIKOM_EXPECTED_SHA"
corepack enable
corepack prepare pnpm@11.7.0 --activate
TRADIKOM_VERIFY_ISOLATED=1 bash scripts/verify-isolated.sh
```

La variable `TRADIKOM_EXPECTED_SHA` doit être exportée par l'opérateur avant ces commandes. Docker doit fonctionner dans le runner lui-même ; aucun daemon distant n'est accepté.

Conserver les sorties de commandes et les diagnostics Playwright avec le SHA exact. Un runner qui expire, une dépendance indisponible ou une étape non exécutée ne constitue pas une recette verte.

## Validation réellement disponible

Pour le lot de préparation du 30 octobre 2026 :

- analyse syntaxique TypeScript 5.9.3 et lint ESLint 9.39.4 ciblés : aucun diagnostic ;
- 13 vérifications des requêtes SQL réelles sur SQLite en mémoire : réussies ; limites PostgreSQL/RLS explicites ;
- 8 vérifications des schémas de création/révision avec le Zod embarqué par Next.js : réussies ;
- 20 callbacks de scénarios du générateur IA exécutés en mémoire avec transport et matchers adaptés : réussis, sans réseau.

Ces contrôles isolés utilisent des composants préinstallés et des doubles ; ils ne remplacent pas la suite native Vitest, PostgreSQL/RLS, le build ou Playwright. Le runner complet est préparé mais non exécuté.

## Avant production

Rétablir la base, vérifier le rôle applicatif restreint et les secrets dans les consoles officielles, puis effectuer la recette sur le SHA choisi. Les fournisseurs, le stockage, le worker et toute programmation d'objectifs doivent être configurés et autorisés explicitement. Examiner les objectifs internes existants avant toute activation de maintenance. Aucune fusion ou mise en production n'est déduite de ce document.

## Essai gratuit du 30 octobre 2026 — reprise requise

La demande actuelle fixe un budget additionnel de **0 $**. Aucun Vercel Sandbox, achat de crédit ou abonnement n'a été lancé. Les outils Vercel ne donnent pas ici le solde de crédits permettant de garantir une exécution sans facturation.

Un scratchpad Google Colab existant, sans copie Drive ni montage Drive, a obtenu un runtime CPU standard Linux : 2 CPU, 12,67 Go de RAM, Node.js 22.23.4. La sonde distante et l'accès Git public ont réussi. Le clone distant a été relu au SHA `4e08facdd18ee898764b7d5fcecec34b8e5c177f` et l'installation de pnpm 11.7.0 s'est terminée avec le code 0.

L'installation du lockfile a démarré, puis la connexion à l'ordinateur est devenue indisponible. Sa fin, les tests natifs, PostgreSQL/RLS, le build et Playwright restent **non vérifiés**. Reprendre le scratchpad ouvert et lire sa sortie avant de relancer une installation. Le script Docker du dépôt n'a pas été exécuté ; Docker et PostgreSQL étaient absents lors de la sonde Colab. Prévoir une base jetable adaptée au runner avant les vérifications PostgreSQL et restauration.

- Scratchpad à reprendre : https://colab.research.google.com/notebooks/empty.ipynb#scrollTo=lIYdn1woOS1n
- Documentation officielle : https://research.google.com/colaboratory/faq.html

Les ressources gratuites sont limitées et peuvent être interrompues. Ne pas ouvrir de tunnel, de port public, de service permanent, de montage Drive ou d'option payante pour ce travail. Une reconnexion GitHub reste en attente du choix de compte par l'opérateur.
