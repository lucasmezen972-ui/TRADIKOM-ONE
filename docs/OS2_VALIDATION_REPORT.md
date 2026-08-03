# Rapport de validation OS-2 — Omnicanal réel préparé

- Date de clôture : 2 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head fonctionnel : `6c0c204`
- Continuité : run `30570074023`, vert
- CI fonctionnelle : run `30570073983`, vert
- Source normative : prompt maître PDF, pages 13-15, 22, 31-33, 46, 48 et 64-71

## Décision de portée

OS-2 prépare quatre frontières fournisseur réelles et vérifiables sans prétendre les avoir connectées. Les routes, vérificateurs officiels, mappings tenant et ingestions canoniques existent; aucun compte fournisseur, consentement OAuth, credential, endpoint public ni transport sortant n'est activé.

Le terme « réel préparé » signifie ici : protocole fournisseur authentique, sécurité fail-closed, persistance tenant-aware, états honnêtes et tests exécutables. Il ne signifie ni « connecté », ni « prêt en production », ni « message externe effectivement envoyé ».

## Classification honnête de la livraison

| Qualification | État OS-2 |
| --- | --- |
| Livré | contrats, vérificateurs, routes fail-closed, mappings tenant, ingestions canoniques, migrations, tests et documentation sont versionnés sur la branche |
| Réel préparé | les protocoles officiels et frontières de sécurité sont implémentés, mais aucun fournisseur n'est connecté à un compte réel |
| Réel connecté | aucun canal fournisseur, endpoint public ou transport externe |
| Sandbox | aucune sandbox fournisseur n'est configurée ou validée |
| Mock | les événements fournisseur utilisés par les tests sont simulés; l'exécution Conversation existante reste en mock strict et explicite |
| Bloqué humain | comptes, consentements OAuth/administrateur, MFA, credentials et éventuelle dépense exigent une autorisation humaine ultérieure |
| Hors périmètre OS-2 | transports sortants WhatsApp, Teams et Slack, récupération des médias, activation production, DNS et déploiement |

## Résultat démontrable

Après vérification cryptographique d'un événement fournisseur simulé par les tests, WhatsApp, Teams et Slack peuvent résoudre un endpoint autorisé vers un tenant, pseudonymiser l'identité et le fil, puis ingérer un message dans le Conversation Hub avec replay idempotent et audit. Resend peut vérifier les webhooks Svix, réserver une livraison tenant-scoped et persister des événements tardifs sans régression d'état.

Dans tous les cas, une configuration absente ou incomplète ferme la route avant ingestion. Les médias, pièces jointes et fichiers distants ne sont ni téléchargés, ni persistés sous forme d'URL fournisseur.

## Matrice des quatre canaux

| Canal | Frontière officielle | Mapping et ingestion | État runtime honnête | Limite conservée |
| --- | --- | --- | --- | --- |
| Email / Resend | `svix@1.99.1`, corps brut, trois en-têtes Svix, fenêtre anti-rejeu et taille 512 Kio | livraisons et événements tenant-scoped, `svix-id` global, ordre tardif sans régression, audit sans adresse | `disabled`, `not_configured` ou `awaiting_human_auth`; le provider HTTP n'est pas sélectionné | aucun domaine/expéditeur vérifié, clé réelle, webhook public ou livraison externe |
| WhatsApp / Twilio | `twilio@6.0.2`, signature sur URL publique exacte et formulaire/JSON brut, limite 512 Kio | endpoint HMAC compte/destination, identité et fil pseudonymisés, replay `MessageSid`, médias non téléchargés | route refusée par défaut; aucun chemin actuel vers `ready` | aucun numéro, token, endpoint public, consentement ou envoi sortant |
| Microsoft Teams | `@microsoft/teams.apps@2.0.14`, JWT/JWKS, audience, émetteur, expiration et RS256, limite 1 Mio | endpoint HMAC application/tenant Microsoft, identité et fil pseudonymisés, replay Activity ID, pièces jointes non téléchargées | route refusée par défaut; aucun chemin actuel vers `ready` | aucune application Entra, permission administrateur, credential ou transport Microsoft |
| Slack | signature v0 HMAC-SHA256 sur corps brut, comparaison constante, fenêtre cinq minutes, limite 1 Mio | endpoint HMAC application/workspace, identité et conversation pseudonymisées, replay `event_id`, fichiers non téléchargés | route refusée par défaut; aucun chemin actuel vers `ready` | aucune application, installation OAuth, signing secret réel, token ou transport Slack |

## Invariants transversaux — pages 13 à 15

| Exigence | Preuve | État |
| --- | --- | --- |
| Conversation Hub comme modèle canonique | les ingestions appellent `ingestSystemConversationMessage`; aucun modèle de conversation fournisseur parallèle | Conforme |
| Adaptateurs sans logique métier | `src/modules/channels` vérifie, projette et route; les effets métier restent dans Conversation Hub, orchestrateur et workflows | Conforme |
| Identité omnicanale | identité, participant et fil dérivent d'empreintes HMAC tenant-scoped distinctes | Conforme |
| Idempotence et anti-boucle | `MessageSid`, Activity ID et `event_id` portent replay/corrélation; bots et sous-types Slack sont ignorés | Conforme |
| États fournisseur véridiques | registre borné; aucun état `ready` n'est produit par la configuration actuelle | Conforme |
| Consentement avant activation | toute configuration apparemment complète reste `awaiting_human_auth` | Conforme |
| Erreurs normalisées et sans fuite | réponses HTTP françaises, `no-store`, statuts temporaires/permanents bornés, aucun payload provider retourné | Conforme |

## Definition of Done — page 32

| Exigence | Preuve | État |
| --- | --- | --- |
| État du dépôt audité et enregistré | audit OS-2, worklog, drift report, état de reprise et ce rapport versionnés | Conforme |
| Migrations additives, tenant-scoped et RLS | migrations 071-074, miroirs 0065-0068, relations tenant-composées, index tenant-leading et résolution système bornée | Conforme |
| Base vide et base déjà migrée | étapes CI `Verify migrations` et `Verify backup and restore` vertes sur `6c0c204` | Conforme |
| Tests unitaires, intégration, PostgreSQL/RLS et Playwright | localement 94 fichiers et 352 tests verts, 13 ignorés; CI : 96 fichiers, 365 tests, build production et 20 scénarios Chromium verts | Conforme |
| Fournisseurs sans clé désactivés et explicites | registre fail-closed; routes refusées avant lecture/base dans les états non prêts | Conforme |
| Aucun comportement production fictif | aucun compte, secret, endpoint, OAuth, téléchargement ou transport réel | Conforme |
| Idempotence, audit et classification | replay fournisseur, HMAC tenant, événements append-only et erreurs bornées couverts par tests | Conforme |
| Policy et validation des actions sensibles | réservation/statut réservés aux propriétaires et administrateurs; audits sans PII | Conforme |
| Continuité conversationnelle | WhatsApp, Teams et Slack rejoignent un fil externe stable dans le Conversation Hub | Conforme |
| Pas d'interface mobile coupée | aucun nouvel écran OS-2; parcours Conversation au clavier sur desktop et mobile vert en Playwright | Conforme |
| État de reprise à jour | `AGENT_STATE.json`, `WORKLOG.md`, `NEXT_STEPS.md`, `DRIFT_REPORT.md` | Conforme |

## Matrice de tests — page 69

| Couche | Preuve OS-2 | État |
| --- | --- | --- |
| Unit : schémas, signatures et projections | suites Resend, Twilio, Teams, Slack, registre et lecteurs HTTP bornés | Vert localement |
| Intégration : webhook vérifié vers Conversation Hub | replay, fil stable, mapping absent/désactivé, pseudonymisation et absence de téléchargement | Vert localement |
| RLS : lecture/écriture inter-tenant refusée | migrations endpoint/email et suite PostgreSQL RLS | Vert en CI sur le head |
| Workflow : reprise, retry et idempotence | suites existantes non régressées; événements provider rejouables et tardifs | Vert localement |
| Provider : non configuré, temporaire, permanent | états fail-closed, erreurs Resend normalisées et réponses provider invalides réessayables | Vert localement |
| Sécurité : altération, secret, replay et payload hostile | signature avant parsing/base, corps UTF-8 bornés, timestamp, HMAC, payloads bruts et PII exclus | Vert localement |
| Playwright : desktop et mobile | 20 scénarios Chromium, dont la verticale Conversation en `1440x900` et `390x844` | Vert en CI sur le head |
| Accessibilité | plan, validation et exécution focalisés puis activés avec Entrée; libellés français ciblés par rôle | Vert en Playwright |

## Preuves de refus et d'absence d'effet externe

- les routes refusent les états `disabled`, `not_configured` et `awaiting_human_auth` avant toute ingestion;
- une signature altérée n'ouvre pas la base et n'appelle pas le consommateur;
- un mapping absent ou désactivé ne crée ni fil, ni identité, ni message;
- un replay retourne le même message canonique sans doublon;
- les identifiants utilisateur, workspace, tenant Microsoft et numéros WhatsApp bruts ne sont pas persistés;
- les URL média/fichier et les pièces jointes distantes restent hors base;
- les tests d'ingestion interdisent tout appel `fetch`;
- aucun secret réel n'a été créé, lu dans une console ou versionné.

## Limites de production restantes

- aucun envoi sortant WhatsApp, Teams ou Slack n'est implémenté ni activé;
- le provider Resend préparé n'est pas sélectionné par le runtime de production;
- aucun parcours OAuth, consentement administrateur, rotation/révocation de credential ou stockage de token réel n'est exécuté;
- aucun endpoint public fournisseur n'est enregistré et aucun webhook externe n'a été reçu;
- les médias et fichiers attendent une future politique explicite de récupération, antivirus, stockage et rétention;
- aucun test contractuel ne s'exécute encore contre une sandbox fournisseur réelle;
- aucun merge, déploiement de production, changement DNS ni dépense n'est autorisé par ce rapport.

## Décision de passage

Le run CI `30570073983` a validé migrations, sauvegarde/restauration, PostgreSQL/RLS, lint, typecheck, 96 fichiers et 365 tests, build et 20 scénarios Playwright sur `6c0c204`; la continuité `30570074023` est également verte. OS-2 est donc terminé au sens strict « omnicanal réel préparé ». OS-3, Connector Runtime avec deux capacités génériques exécutables en mock strict, devient la prochaine phase candidate.

OS-5 demeure le premier fournisseur effectivement activable et reste bloqué par les credentials, consentements et environnements fournisseur. Cette séparation empêche de transformer une préparation technique robuste en fausse intégration.
