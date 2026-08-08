# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head fonctionnel audité : `d27e3cf`
- Travail effectué : ouverture OS-5 par audit comparatif des quatre frontières préparées et sélection de WhatsApp via Twilio Sandbox, sans activation externe.

## Impact north star

La décision privilégie le premier parcours réellement conversationnel : un message WhatsApp signé rejoint le fil canonique web, puis une réponse approuvée repart vers le même téléphone. Resend est plus simple à envoyer mais ne fournit pas encore un fil entrant dans le code; Slack et Teams ajoutent davantage de consentements. La complexité fournisseur reste derrière l'adaptateur et le runtime commun.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-15, 26-33, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : ouvrir OS-5 page 31 avec un seul provider capable d'être activé en sandbox, sans enfreindre l'interdiction des pages 5, 6, 29, 32 et 48 de présenter une préparation comme réelle, d'utiliser un provider sans clé/consentement ou de déployer en production.
- Preuve obtenue : PDF de 71 pages au SHA-256 exact; audit du registre, des quatre routes, des ingestions et transports; documentation officielle actuelle de Twilio, Resend, Slack et Microsoft; matrice comparative; sélection unique Twilio Sandbox; contrat de preuve web + WhatsApp; checkpoint humain exact; zéro mutation externe.
- Écarts restants : aucun transport WhatsApp sortant réel, callback de livraison, secret manager provider, sandbox, endpoint public, compte ou message externe. OS-5 reste `in_progress` et ne satisfait pas encore le critère de succès page 31 ni toute la Definition of Done page 32.

## Classification honnête

- Livré : audit comparatif, recommandation unique et bloc de reprise humain.
- Réel préparé : Resend outbound/livraison et inbound canonique WhatsApp, Teams et Slack, tous fail-closed.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : événements provider en tests, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials, URL HTTPS et autorisation des messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation des trois autres providers, OS-6 à OS-8, fusion et déploiement.

## Modules et documents concernés

- `src/modules/channels/provider-registry.ts` : quatre états préparés, aucun chemin vers `ready`;
- `src/modules/channels/whatsapp-twilio-*` et `provider-endpoints-*` : signature, projection, mapping tenant et replay déjà livrés;
- `src/modules/email/*`, routes Teams et Slack : base de comparaison repository-grounded;
- `docs/OS5_PROVIDER_SELECTION.md` : décision, preuves, sources, checkpoint humain et écarts;
- les quatre fichiers de continuité.

## Risques

- les unités d'essai Twilio ne sont pas une gratuité illimitée; tout envoi doit être refusé si le solde gratuit n'est pas explicitement visible;
- la Sandbox impose un `join`, un téléphone autorisé, des templates hors fenêtre de service et un endpoint HTTPS; ces contraintes doivent rester visibles dans la preuve;
- le transport sortant absent ne doit pas être contourné par un appel direct depuis React ou une server action;
- aucun SID, token, numéro, texte métier ou payload brut ne doit entrer dans les audits ou logs;
- le futur test sandbox reste tributaire d'un endpoint HTTPS temporaire et doit inclure sa révocation au handoff.

## Validations

- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte et 71 pages;
- inspection textuelle et visuelle : pages cœur et OS-5 attendues;
- local : lint, typecheck, 96 fichiers / 361 tests verts / 13 ignores et build production avec configuration CI factice;
- GitHub : PR #11 ouverte, brouillon et `CLEAN`; continuité `31242028100` et CI `31242028098` vertes sur `d27e3cf`, incluant audit, migrations, backup/restauration, RLS, lint, typecheck, 361 tests, build et Playwright;
- code : aucune mutation runtime, aucun réseau fournisseur et aucun secret.

## Prochaine action recommandée

Implémenter le transport WhatsApp sortant fail-closed derrière `ChannelAdapter`, policy, idempotence tenant-aware et audit sûr avec doubles de test. Ne créer ni sandbox, credential, endpoint public ni message réel avant l'autorisation humaine définie dans `docs/OS5_PROVIDER_SELECTION.md`.
