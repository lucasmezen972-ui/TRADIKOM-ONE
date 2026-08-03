# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

OS-3 est clos sur `232bbb4`. La CI `30782705428` et la continuité `30782705423` sont vertes. Les deux capacités génériques passent par le manifeste `tradikom_mock`, produisent une preuve durable sans entrée métier dans les métadonnées et n'effectuent aucun appel réseau.

La prochaine action est l'audit OS-4 de `src/modules/workflows/engine.ts`, `src/modules/workflows/worker.ts`, `src/modules/workflows/repository.ts` et du chemin d'exécution de l'orchestrateur. Il faut identifier la plus petite lacune empêchant une mission confirmée de reprendre après panne ou signal humain sans rejouer une étape réussie.

## Référence prompt maître

Relire avant toute modification OS-4 les pages 17-18, 28, 31-33, 35-36, 46, 48 et 69, en plus des pages cœur 3-7 et 69-71. La page 31 fixe le succès OS-4 : « plan confirmé, exécution multi-step, reprise, idempotence ». Les pages 18, 32 et 69 imposent workflow déterministe, activities IO, signaux humains, retries, compensation, preuve PostgreSQL/RLS et Playwright.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer que la PR #11 contient `232bbb4` et que les runs `30782705428` et `30782705423` restent verts.
4. Relire les pages 17-18, 28, 31-33, 35-36, 46, 48 et 69 avant de modifier les workflows.
5. Auditer d'abord reprise, retries, signaux, annulation, compensation et idempotence dans engine, worker et repository; ne pas créer un second moteur.
6. Choisir une seule lacune durable et la prouver sur le plan conversationnel confirmé, avec une reprise qui ne rejoue aucune étape réussie.
7. Conserver `tradikom_mock`, ne connecter aucun fournisseur réel, ne demander aucun secret et ne présenter aucune simulation comme réelle.
```

## Critères du prochain checkpoint

- plan immuable déjà confirmé avant démarrage de mission;
- état durable tenant-scoped avec RLS et audit sans contenu sensible;
- retry d'une erreur temporaire sans replay d'une étape réussie;
- échec permanent, annulation et compensation classifiés et prouvés;
- signal humain de reprise ou d'annulation idempotent;
- résultat et état de mission visibles dans le fil canonique;
- tests unitaires, intégration, PostgreSQL/RLS, workflow, sécurité et Playwright pertinents;
- interface française et parcours mobile non régressés;
- fichiers de reprise synchronisés avant l'arrêt.

## État de vérité

- Livré : OS-1, OS-2 et OS-3; manifeste et runtime `tradikom_mock` inclus.
- Réel préparé : frontières Resend, WhatsApp/Twilio, Teams et Slack.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée.
- Mock : canal test, deux capacités génériques, exécution déterministe, compensation et événements fournisseur de test.
- Bloqué humain : credentials, consentements, MFA, endpoints publics, quotas et dépenses.
- Hors périmètre immédiat : activation fournisseur OS-5, OS-6 à OS-8, fusion et déploiement.
