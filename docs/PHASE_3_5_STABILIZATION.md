# Phase 3.5 - Stabilisation

## Etat verifie

- Base initiale `main`: `c0edf7b5a76197008a38ac0d2da4e8b00e822577`.
- PR #1 Phase 2 fusionnee; PR #3 API Intelligence fusionnee.
- Run initial `main` `29301275644`: vert.
- Branche: `codex/phase-3-5-stabilization`.
- PR #4: stabilisation et recuperation du centre de pilotage.
- PR #2 a ete fermee sans fusion comme remplacee par la PR #4; son historique reste disponible.

## Recuperation du centre de pilotage

Le patch obsolete de la PR #2 a ete relu sans cherry-pick. Son intention utile a ete recreee contre les services actuels: priorites, retards, leads, opportunites, Radar, workflows, dead letters, connecteurs, sources API, ruptures, approbations, publication et activites. Les metriques decoratives, anciennes formes de donnees et liens obsoletes n'ont pas ete repris.

Chaque lecture est tenant-scoped. Les approbations sont filtrees par role, les contacts archives/fusionnes, evenements annules et alertes resolues ne gonflent pas les compteurs. La journee metier utilise un fuseau IANA configure. Le scenario Playwright couvre le lead public, le worker, le Radar, l'action recommandee, un echec source, une approbation, l'isolation d'un second tenant et les etats vides.

## Audits executes

- Migrations: base PostgreSQL 17 vide, rejeu idempotent, ordre exact et upgrade depuis la migration Phase 2 `016` avec donnees conservees.
- RLS: chaque table tenant possede RLS et un index commencant par `tenant_id`; la suite restricted-role couvre lectures, ecritures et relations croisees.
- Dependances: installation figee et `pnpm audit --prod --audit-level high` dans la CI; permissions Actions limitees a `contents: read`.
- Sauvegarde: dump custom, restauration dans une base vide, rejeu des migrations et verification de donnees dans la CI.
- API Intelligence: DNS/SSRF, parseurs bornes, statuts, preuves, relectures, reparations et activation desactivee relus.
- Retention: evenements termines 90 jours, notifications envoyees 180 jours, snapshots orphelins 365 jours, contrats non courants 180 jours et propositions anciennes non referencees 365 jours.

## Classification securite

### Corrige avant fusion

- Validation de configuration production refuse demo, cookies non surs, fournisseur email test, integrations live et fuseau invalide.
- Relectures API terminees apres huit tentatives sans stocker le message brut.
- Connector Copilot refuse une preuve devenue invalide, une authentification inconnue et une operation hors format.
- CI verifie les migrations, la restauration, l'audit de dependances, les tests, le build et Playwright.

### Risques moyens ou limites acceptees

- Les contrats connecteurs sont mock/statiques; aucun appel sandbox reel.
- Aucune activation production de connecteur.
- Pas de crawling Internet general ni fusion multi-format autoritative.
- Pas de livraison externe SMS/WhatsApp.
- Le plan de reprise des secrets, DNS et futur stockage objet depend de l'operateur.

### Critical/high

Aucun finding critical ou high ouvert n'est accepte pour la fusion. Cette section doit rester vraie au moment du passage de la PR en revue; sinon la fusion est bloquee.

## Performance et bornes

Les agregations du centre de pilotage sont calculees en SQL par tenant, avec compteurs distincts et listes bornees; la pagination des listes ne modifie pas les totaux. Contacts, opportunites, evenements, sources, snapshots, propositions et approbations disposent d'index tenant verifies par catalogue. Les parseurs, batches workers et resultats JSON ont des limites explicites. Aucun Redis, moteur de recherche ou graphe n'est requis par les mesures actuelles.

Un test PostgreSQL isole cree 10 000 contacts, 1 000 opportunites, 100 workflows actifs, 10 000 evenements, 1 000 sources, 100 snapshots par source, 100 propositions et 100 approbations. Il verifie les totaux exacts du centre de pilotage et les listes bornees a dix elements. Un test de charge sur la topologie de production reste une etape operateur avant trafic significatif.

## Validation de fermeture

Le head `3d0f7ca040d5fda99df94b75f9033fc42919e8be` a passe le run GitHub Actions `29306404397`: installation figee, audit des dependances de production, migrations propres et upgrade, sauvegarde/restauration, lint, typecheck, 44 fichiers et 143 tests, build de production et Playwright E2E. Aucun check obligatoire de ce run n'est ignore, annule ou en attente.

## Gate restant

La PR #4 a ete fusionnee au SHA `83371cb5144f8c70b4fd90df8eb88079bf3658c2`. Le run `main` `29307027757` est vert. Le controle d'entree Phase 4 est cree dans `docs/PHASE_4_ENTRY_CHECK.md`; aucun travail Phase 4 n'est execute dans cette stabilisation.
