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

## Validation réalisée et restante

Sur le lot corrigé, Node22.23.4 et pnpm11.7.0 : lint global, typecheck global,23 tests natifs OpenAI/accès objectifs,10 tests natifs SDK et audit de production passent. Le build de la baseline0c84f609 est vert avant la mise à jour des dépendances. La suite exhaustive, PostgreSQL/RLS, sauvegarde/restauration, build corrigé et Playwright restent à exécuter sur le SHA publié exact dans le Codespace de validation.

Aucun GitHub Actions, appel fournisseur réel, déploiement ou dépense additionnelle n'est lancé. Aucun code ou node_modules n'est installé sur le Mac. Les anciens résultats verts ne sont pas attribués à ce lot.

## Sources officielles

- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-mh99-v99m-4gvg
- https://github.com/advisories/GHSA-xcx6-jx8p-x3h5
- https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/msal-node-v7.1.0/lib/msal-node/docs
- https://github.com/microsoft/teams.ts
