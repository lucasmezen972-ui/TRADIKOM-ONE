# Phase 3 - API Intelligence

## Point de depart verifie

- Base `main`: `05a7c7a099ad7ea458cb395cfdd9ccdf73a6f622`.
- Phase 2 fusionnee par la PR #1.
- Validation de `main`: run GitHub Actions `29250246503`, entierement vert.
- Branche: `codex/phase-3-api-intelligence`.
- La PR #2 reste separee et aucun de ses commits n'est inclus.

## Premier parcours vertical

L'espace administrateur `Intelligence API` permet a un administrateur plateforme de:

1. enregistrer un logiciel et soumettre son domaine officiel;
2. approuver ou suspendre ce domaine;
3. enregistrer un produit API et une source OpenAPI, Postman ou GraphQL officielle;
4. recuperer la source sous la politique de decouverte;
5. conserver un snapshot avec provenance, ETag, Last-Modified et hash;
6. previsualiser puis importer un document OpenAPI JSON/YAML, une collection Postman v2.1 JSON ou un schema GraphQL fourni;
7. extraire les operations, schemas et preuves puis approuver leurs claims;
8. proposer puis approuver un mapping tenant vers l'ontologie canonique;
9. produire une analyse de compatibilite explicable;
10. generer une proposition de connecteur desactivee;
11. executer les tests de contrat mock locaux;
12. soumettre puis approuver le connecteur pour le sandbox uniquement;
13. afficher le connecteur dans le Connect Store prive.

## Moniteur de changements

Chaque nouvelle observation HTTP 200 est comparee au snapshot precedent, y compris lorsque
le contenu est identique mais que l'ETag ou Last-Modified change. Une reponse 304
reutilise le dernier snapshot sans dupliquer l'historique. Le moniteur
detecte les ajouts et suppressions d'operations, les schemas, l'authentification,
les scopes, les webhooks, la version, l'URL de base, les signaux de rate limit,
les deprecations et les decisions de politique d'acces.

Les changements sont classes `informational`, `additive`,
`potentially_breaking`, `breaking`, `security_relevant` ou
`access_policy_change`. Une rupture touchant un manifeste existant:

- cree un impact tenant protege par RLS et une alerte Opportunity Radar;
- garde la proposition et son entree Connect Store desactivees;
- execute un contrat statique `api-change-1` sans acces Internet;
- genere un plan de reparation desactive et soumis a decision humaine;
- conserve le blocage meme apres approbation du plan, jusqu'a regeneration et
  nouveaux tests sandbox.

## Relectures planifiees

Un administrateur plateforme peut activer, modifier ou suspendre une frequence
horaire, toutes les six heures, quotidienne ou hebdomadaire pour une source
officielle dont le domaine reste approuve. La planification conserve uniquement
son etat operationnel, un contexte tenant d'audit et des codes d'erreur bornes.

Le worker traite au plus trois sources sequentiellement par batch. Chaque travail
est reclame avec un bail unique, un bail expire est replanifie, les erreurs
transitoires utilisent un backoff exponentiel et `Retry-After` reste prioritaire.
Une source non officielle, un domaine suspendu ou une autorisation plateforme
revoquee bloque et desactive la planification avant tout acces reseau. Le fetcher
commun conserve les controles robots, SSRF/DNS, taille, delai, rate limit,
ETag, Last-Modified, hash et redaction.

## Garanties du checkpoint

- Les mutations globales exigent un role `platform_admin` et un role owner ou administrator sur le tenant actif.
- Les URL sont limitees au domaine HTTPS explicitement approuve, sans redirection.
- Le fetcher bloque les adresses privees, loopback, link-local et metadata, valide toutes les reponses DNS puis epingle l'adresse publique pour la connexion TLS.
- `robots.txt`, les tailles, les delais, l'encodage et la frequence par domaine sont controles.
- Les contenus sont traites comme des donnees non fiables; les secrets en valeur sont rediges.
- Les references OpenAPI externes sont bloquees et la taille, la profondeur, les references et les alias YAML sont bornes.
- Les collections Postman sont bornees en taille, profondeur, dossiers, variables, exemples et scripts; aucune valeur, corps, requete ou script n'est execute ou persiste.
- Les schemas GraphQL utilisent le parseur officiel, acceptent uniquement du SDL ou un resultat d'introspection JSON fourni et bornent taille, tokens, profondeur, noeuds, types, champs, arguments et operations.
- Aucune introspection GraphQL en direct n'est envoyee; descriptions, raisons de deprecation et valeurs par defaut ne sont pas persistees dans les claims structurels.
- Une previsualisation est reverifiee contre le snapshot autoritatif avant persistance.
- Les metadonnees, operations et schemas importes restent `under_review` jusqu'a une decision humaine auditee.
- Un mapping doit citer la preuve exacte d'un schema approuve.
- Seules les operations et metadonnees approuvees alimentent la compatibilite et Connector Copilot.
- Un resultat ne peut pas etre `ready_now` sans connecteur approuve pour la production.
- Toute proposition generee garde `enabled = false`, y compris apres approbation sandbox.
- Une rupture API bloque toute mise a niveau automatique et identifie les connecteurs et tenants affectes.
- Les impacts tenant utilisent RLS, un index tenant et un trigger d'integrite vers la proposition concernee.
- Les tests automatises utilisent des fixtures locales et aucun acces Internet.

## Limites assumees

- Ce checkpoint importe OpenAPI 3.0/3.1 en JSON/YAML, Postman Collection v2.1 en JSON et GraphQL fourni en SDL ou introspection JSON. OAuth reste a implementer.
- Un produit API conserve un seul format autoritatif pour ses operations: un remplacement OpenAPI/Postman est refuse tant que le modele multi-source n'existe pas.
- L'ajout de source reste manuel et limite a une URL approuvee. Les relectures planifiees sont disponibles; le scan de sitemap et la detection de nouvelles pages restent a implementer.
- Les tests de contrat sont mock uniquement. Aucun appel sandbox externe ni ecriture reelle n'est execute.
- L'approbation production, l'installation et l'activation de connecteur ne sont pas disponibles.
- Les plans de reparation ne sont pas appliques automatiquement; la regeneration et les nouveaux tests sandbox restent explicites.

## Validation

- `git diff --check`: propre avant le premier checkpoint.
- La validation Node locale reste instable et a ete arretee apres un delai raisonnable sans diagnostic.
- Le head `e971d1367527671670b2964bdfdc13cb45b2e780` est vert.
- Run push `29258483303`: migrations PostgreSQL/RLS, lint, types, 109 tests, build production et trois Playwright passes.
- Run pull request `29258489327`: meme suite complete passee.
- Le checkpoint API Change Monitor est vert au head `b0bd77fa1b6e64161abdcf7a78a031b1b1249d7a`.
- Runs push `29264958738` et pull request `29264962308`: migrations PostgreSQL/RLS, lint, types, 111 tests, build production et trois Playwright passes.
- Le checkpoint de relecture planifiee est vert au head `76a1487dc567f902bb478ac0f399224945c2b74c`.
- Runs push `29267465626` et pull request `29267468487`: migration PostgreSQL, lint, types, 38 fichiers/122 tests, build production et trois Playwright passes.
- Le checkpoint Postman v2.1 est vert au head `a1fcaf1800a766937e8f8fd600d539b9fb36b428`.
- Runs push `29291951679` et pull request `29291954167`: migrations PostgreSQL, lint, types, 38 fichiers/126 tests, build production et trois Playwright passes.
- Le checkpoint GraphQL fourni est vert au head `54b81993eed7a95b58a0ffdd37beec8e8e9079d9`.
- Runs push `29293876882` et pull request `29293878753`: migrations PostgreSQL, lint, types, 40 fichiers/129 tests, build production et trois Playwright passes.
- La PR #3 reste en brouillon pendant la suite de Phase 3.
