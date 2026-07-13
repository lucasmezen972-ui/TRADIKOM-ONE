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
3. enregistrer un produit API et une source OpenAPI officielle;
4. recuperer la source sous la politique de decouverte;
5. conserver un snapshot avec provenance, ETag, Last-Modified et hash;
6. previsualiser puis importer un document OpenAPI JSON ou YAML;
7. extraire les operations, schemas et preuves puis approuver leurs claims;
8. proposer puis approuver un mapping tenant vers l'ontologie canonique;
9. produire une analyse de compatibilite explicable;
10. generer une proposition de connecteur desactivee;
11. executer les tests de contrat mock locaux;
12. soumettre puis approuver le connecteur pour le sandbox uniquement;
13. afficher le connecteur dans le Connect Store prive.

## Garanties du checkpoint

- Les mutations globales exigent un role `platform_admin` et un role owner ou administrator sur le tenant actif.
- Les URL sont limitees au domaine HTTPS explicitement approuve, sans redirection.
- Le fetcher bloque les adresses privees, loopback, link-local et metadata, valide toutes les reponses DNS puis epingle l'adresse publique pour la connexion TLS.
- `robots.txt`, les tailles, les delais, l'encodage et la frequence par domaine sont controles.
- Les contenus sont traites comme des donnees non fiables; les secrets en valeur sont rediges.
- Les references OpenAPI externes sont bloquees et la taille, la profondeur, les references et les alias YAML sont bornes.
- Une previsualisation est reverifiee contre le snapshot autoritatif avant persistance.
- Les metadonnees, operations et schemas importes restent `under_review` jusqu'a une decision humaine auditee.
- Un mapping doit citer la preuve exacte d'un schema approuve.
- Seules les operations et metadonnees approuvees alimentent la compatibilite et Connector Copilot.
- Un resultat ne peut pas etre `ready_now` sans connecteur approuve pour la production.
- Toute proposition generee garde `enabled = false`, y compris apres approbation sandbox.
- Les tests automatises utilisent des fixtures locales et aucun acces Internet.

## Limites assumees

- Ce checkpoint importe OpenAPI 3.0/3.1 en JSON et YAML. Postman, GraphQL et OAuth restent a implementer.
- La decouverte est manuelle et limitee a une URL approuvee. Le scan de sitemap et les relectures planifiees restent a implementer.
- Les tests de contrat sont mock uniquement. Aucun appel sandbox externe ni ecriture reelle n'est execute.
- L'approbation production, l'installation et l'activation de connecteur ne sont pas disponibles.
- Le suivi des changements d'API et les alertes de rupture restent a implementer.

## Validation

- `git diff --check`: propre avant le premier checkpoint.
- La validation Node locale reste instable et a ete arretee apres un delai raisonnable sans diagnostic.
- GitHub Actions est l'environnement de validation autoritatif pour migrations PostgreSQL, lint, types, tests, build et E2E.
