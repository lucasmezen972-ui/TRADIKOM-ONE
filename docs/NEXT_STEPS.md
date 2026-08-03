# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

OS-2 est clos sur `6c0c204`. La CI `30570073983` et la continuité `30570074023` sont vertes, et `docs/OS2_VALIDATION_REPORT.md` distingue les frontières livrées de toute connexion réelle.

La prochaine action est l'audit OS-3 de `src/modules/connector-execution`, `src/modules/connectors`, `src/modules/orchestrator` et `src/modules/workflows`. Il faut ensuite choisir la plus petite tranche conversation-first qui prouve deux capacités génériques exécutables en mock strict, sans réactiver un chantier CRM, Kanban ou dashboard.

## Référence prompt maître

Relire avant toute modification OS-3 les pages 15-18, 26-30, 35-38 et 69, en plus des pages cœur 3-7, 31-33, 46, 48 et 69-71. La page 31 fixe le succès OS-3 : « deux capacités génériques exécutables en mock strict ». Les pages 32 et 69 imposent migrations, RLS, idempotence, retry, classification d'erreurs, sécurité, Playwright et état de reprise.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer que la PR #11 reste sur un head dont la CI et la continuité sont vertes.
4. Relire les pages 15-18, 26-30, 35-38 et 69 avant de modifier le Connector Runtime.
5. Auditer d'abord l'existant dans connector-execution, connectors, orchestrator et workflows; ne pas dupliquer le monolithe historique.
6. Choisir deux capacités génériques conversationnelles et les exécuter en mock strict avec tenant, RLS, audit, idempotence et erreurs normalisées.
7. Ne connecter aucun fournisseur réel, ne demander aucun secret et ne présenter aucune sandbox ou simulation comme réelle.
```

## Critères du prochain checkpoint

- deux capacités génériques identifiées par manifeste versionné et schémas bornés;
- exécution en mock strict uniquement, avec état explicite et sans réseau;
- mutation tenant-scoped via service, RLS et audit sans contenu sensible;
- idempotence, retry, échec temporaire, échec permanent et compensation testés;
- policy et validation unique avant toute action sensible;
- résultat et preuve reliés au fil canonique Conversation Hub;
- tests unitaires, intégration, PostgreSQL/RLS, provider mock, sécurité et Playwright pertinents;
- interface visible en français et parcours mobile non régressé;
- fichiers de reprise synchronisés avant l'arrêt.

## État de vérité

- Livré : OS-1 et OS-2, rapport OS-2 inclus.
- Réel préparé : frontières Resend, WhatsApp/Twilio, Teams et Slack.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée.
- Mock : canal test, exécution déterministe et événements fournisseur de test.
- Bloqué humain : credentials, consentements, MFA, endpoints publics, quotas et dépenses.
- Hors périmètre immédiat : OS-4 à OS-8, activation fournisseur OS-5, fusion et déploiement.
