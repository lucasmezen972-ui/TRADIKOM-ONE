# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `12a588a`
- Commit fonctionnel audité : `3b96716`
- Travail effectué : frontière de transport Twilio à client et résolveurs injectés, sans activation externe.

## Impact north star

Une réponse issue de la conversation peut désormais franchir toute la chaîne durable jusqu'au contrat exact du client Twilio, après membership, contexte et policy, sans que le cœur connaisse un numéro ou un secret. Le travail reste dans la verticale Conversation -> WhatsApp -> preuve; aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 37, 64, 66 et 69 : adaptateur sans logique métier, exécution après policy et idempotence durable, références tenant-scoped, secrets éphémères, callback HTTPS, erreurs classées, provider sans clés fail-closed et preuves provider/sécurité.
- Preuve obtenue : PDF de 71 pages au SHA-256 exact; service transmettant `endpointId` seulement après ses gardes; état indisponible refusé avant toute résolution; résolveurs credentials/destination tenant/endpoint/identité; formats Account SID/Auth Token/adresses WhatsApp/SID bornés; client injecté; payload strict `from/to/body/statusCallback`; normalisation des statuts et erreurs; réponse publique et audits sans secret, numéro, corps ni SID; 42 tests ciblés et 99 tests de régression découpée verts.
- Écarts restants : coffre chiffré/rotatif et RLS derrière les résolveurs, fabrique du client Twilio officiel, secret manager, Sandbox, endpoint public et preuve réelle web + WhatsApp. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker lease/backoff, callbacks monotones et frontière client/résolveurs avec doubles.
- Réel préparé : inbound WhatsApp signé/tenant-mappé et chaîne outbound jusqu'au contrat Twilio, sans stockage de secrets ni client officiel.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : résolveurs, client et réponses Twilio injectés; canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-transport.ts` : résolutions éphémères, validation, client injecté, payload et classifications sûres;
- `src/modules/channels/contracts.ts` : référence endpoint optionnelle dans le contrat générique;
- `src/modules/channels/whatsapp-twilio-outbound-service.ts` : transmission de l'endpoint après gardes tenant/policy;
- `src/modules/channels/whatsapp-twilio-outbound.ts` : normalisation sûre des erreurs de validation du transport;
- tests transport, service et worker : fail-closed, ordre des gardes, références, formats, payload, statuts, erreurs, idempotence et absence de fuite.

## Risques

- Les valeurs sensibles existent nécessairement en mémoire au moment de construire la requête; aucune implémentation de résolveur réelle n'est encore branchée. Le prochain lot doit chiffrer au repos, borner la durée de vie et tester rotation/révocation.
- Le client est une interface injectée, pas encore la fabrique officielle `twilio`. Cela interdit honnêtement tout appel réel mais laisse la preuve Sandbox incomplète.
- Twilio ne fournit pas de clé d'idempotence Message Create générique dans le payload utilisé; l'idempotence reste portée par la réservation durable et la même livraison, comme avant ce lot.
- La suite Vitest monolithique bloque silencieusement localement. Les lots ciblés sont verts et la CI Linux/PostgreSQL reste l'autorité exhaustive.

## Validations

- `pnpm agent:continuity-check` initial/final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31249262463` et continuité `31249262461` vertes sur `12a588a`;
- local : 4 fichiers/42 tests ciblés, puis 13 fichiers/99 tests de régression en lots et 1 test PostgreSQL/RLS ignoré sans `DATABASE_URL`;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuité et diff check verts;
- exhaustif local : `pnpm test` bloqué silencieusement sans assertion en échec;
- GitHub fonctionnel : continuité `31250907674` verte; CI PostgreSQL `31250907675` verte en 10 min 57 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 105 fichiers/427 tests, build et 20/20 Playwright. La PR #11 reste brouillon, fusionnable et `CLEAN`.

## Prochaine action recommandée

Implémenter le coffre chiffré et rotatif tenant-aware derrière les résolveurs de credentials, sender et destination, avec migration additive, RLS, relations composées, révocation et audits sans valeur sensible. Ne créer ni Sandbox, credential réel, endpoint public ni message réel avant l'autorisation humaine de `docs/OS5_PROVIDER_SELECTION.md`.
