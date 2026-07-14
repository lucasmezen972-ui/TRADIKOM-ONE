# Phase 3.5 - Stabilisation

## Etat verifie

- Base initiale `main`: `c0edf7b5a76197008a38ac0d2da4e8b00e822577`.
- PR #1 Phase 2 fusionnee; PR #3 API Intelligence fusionnee.
- Run initial `main` `29301275644`: vert.
- Branche: `codex/phase-3-5-stabilization`.
- PR #4: stabilisation et recuperation du centre de pilotage.
- PR #2 reste non fusionnee et doit etre fermee comme remplacee apres validation du parcours recupere.

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

## Gate restant

1. Faire passer la CI de fermeture avec tous les checkpoints.
2. Fermer la PR #2 comme remplacee par la PR #4.
3. Mettre la PR #4 en revue et la fusionner uniquement si elle est mergeable et verte.
4. Verifier la CI de `main`.
5. Creer `docs/PHASE_4_ENTRY_CHECK.md` seulement apres ce vert final.
