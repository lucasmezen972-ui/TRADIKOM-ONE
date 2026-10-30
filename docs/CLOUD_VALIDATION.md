# Recette distante sans GitHub Actions

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
