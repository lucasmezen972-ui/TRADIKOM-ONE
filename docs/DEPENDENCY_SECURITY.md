# Dépendances corrigées — 30 octobre 2026

## Périmètre et mesure

La baseline `0c84f609d27f3043cb5e1d3c25a2a7cac8fb62b3` signale41 avis dans `pnpm audit --prod --json` :4 critiques,20 élevés,16 modérés et1 faible. Après les changements ci-dessous, le même audit signale **zéro avis de production**, sans `ignoreGhsas`. Ce résultat décrit la base d'avis connue au moment du contrôle; il ne garantit pas l'absence de toute vulnérabilité.

## Changements

| Dépendance | Version précédente | Version corrigée |
| --- | --- | --- |
| Next.js |16.3.4|16.4.1|
| eslint-config-next |16.3.4|16.4.1|
| Zod |4.4.3|4.6.6|
| csv-parse |7.0.1|7.0.2|
| brace-expansion1.x |1.1.18 forcée|1.1.21, API CJS conservée|
| brace-expansion2.x |2.1.4 forcée|2.1.7, API CJS conservée|
| sharp |borne0.35.4|borne0.35.5 et lockfile actualisé|
| MSAL de Teams |5.x|7.1.0 via override limité à Teams|

Les transitives ont été rafraîchies dans les plages autorisées, notamment Axios, follow-redirects, proxy-addr, body-parser, qs et source-map-js. Les SDK Teams2.0.14, Twilio6.0.2 et OpenAI6.46.0 conservent leur version directe. Les plages de développement d'origine sont conservées; le lockfile actualise leurs résolutions compatibles.

L'ancienne exception brace-expansion et son commentaire devenu obsolète sont retirés : les correctifs rétroportés permettent de conserver les API CJS sans masquer un avis.

## Exception de compatibilité MSAL, sans exception d'audit

Teams2.0.14 déclare une plage MSAL5.x. Le correctif de l'avis GHSA-xcx6-jx8p-x3h5 est disponible en7.1.0; l'override est donc hors plage déclarée par Teams et limité à cette dépendance. Il n'est pas présenté comme une prise en charge officielle de Microsoft.

Le test `tests/teams-sdk-compatibility.test.ts` résout MSAL depuis Teams lui-même et exige exactement7.1.0. Il utilise les vraies classes pour le validateur entrant, les clients confidentiels et les constructeurs d'identité managée. Les flux client credentials, assertion fournie par callback, cache et rejet OAuth passent par un transport local. Fetch et Socket.connect sont bloqués. Le test passe10 scénarios avec la version corrigée.

Limites : aucune authentification Azure, découverte/JWKS Microsoft, acquisition de jeton d'identité managée ou connexion de production n'est prouvée. Les canaux réels restent désactivés. Surveiller une version Teams qui déclare une version MSAL corrigée, puis retirer cet override seulement après les mêmes contrôles.

## Dernier correctif des outils de développement

L'audit complet, incluant le développement, avait encore9 avis (1 élevé,7 modérés,1 faible). Vitest passe de4.1.10 à4.1.12, Vite est verrouillé à8.1.6, et l'override limité `@esbuild-kit/core-utils>esbuild` à0.25.12 remplace le moteur vulnérable du chargeur Drizzle. L'audit complet retourne désormais **zéro avis**, sans exception masquée.

Cet override esbuild dépasse la plage déclarée par core-utils. Un smoke hors ligne a vérifié la résolution réelle depuis Drizzle vers0.25.12, les transformations CJS/ESM, leur exécution, les sourcemaps et le rejet de TypeScript invalide : vert, zéro tentative réseau, sans injection ni cache disque. Le SDK Teams conserve ses10 tests verts sous Vitest4.1.12. La suite exhaustive de la base69a0660 et la recette ciblée du source final sont distinguées ci-dessous ; aucun résultat de879ef66 ne leur est attribué.

## Validation finale

Sur le source fa3b391fdc80b7a477a929af038e32aa3c17096b, l'audit complet production et développement retourne zéro avis. Installation gelée, lint, typecheck, 52 tests Goal Watch avec PostgreSQL, build Next.js 16.4.1 et 20 scénarios Playwright réussissent. La suite exhaustive de la base 69a0660 passe 1 048 tests ; elle n'a pas été rejouée après le correctif Goal Watch.

Les 23 tests natifs OpenAI/accès objectifs, dix tests natifs Teams/MSAL et le smoke de résolution Drizzle/esbuild ont aussi été récoltés dans la session. Les limites d'authentification de production des overrides demeurent.

Le Codespace est arrêté ; aucun fournisseur réel, GitHub Actions, achat ou déploiement. Voir VALIDATION_2026-10-30.md pour les SHA, périmètres et traces.

## Sources officielles

- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-mh99-v99m-4gvg
- https://github.com/advisories/GHSA-xcx6-jx8p-x3h5
- https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/msal-node-v7.1.0/lib/msal-node/docs
- https://github.com/microsoft/teams.ts
