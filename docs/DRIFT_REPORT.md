# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `8d80ec3`
- Commit fonctionnel : `423c9d1`
- Travail effectué : fabrique bornée du client Twilio officiel et bootstrap serveur du keyring depuis des références opaques de gestionnaire de secrets, sans activation externe.

## Impact north star

Une réponse approuvée dans la conversation peut désormais traverser les gardes tenant/policy, résoudre éphémèrement coffre, destination et credentials, puis construire le SDK officiel au dernier moment sans configuration globale. La tranche reste strictement Conversation -> WhatsApp -> preuve; aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 37, 64, 66 et 69 : adaptateur sans logique métier, exécution durable après membership/policy, secrets rotatifs issus d'une configuration serveur gérée, provider fail-closed sans clés, erreurs sûres, zéro réseau en état non autorisé et preuves provider/sécurité.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; fabrique officielle sans lecture globale avec retry SDK désactivé, lazy loading, timeout et sockets bornés; construction réelle du SDK avec credentials factices sans fetch; bootstrap refusé côté navigateur, version active explicite, références opaques uniques, resolver injecté, clés base64url canoniques de 32 octets et erreurs du gestionnaire neutralisées; registre toujours `transportEnabled: false`; 8 fichiers/62 tests ciblés, audit, lint, typecheck, build, continuité et diff check verts.
- Écarts restants : vérification de santé/readiness, composition d'activation explicite, procédure opérateur, Sandbox, endpoint public et preuve réelle web + WhatsApp. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker lease/backoff, callbacks monotones, coffre chiffré/rotatif tenant-aware, résolveurs éphémères, bootstrap keyring géré et fabrique SDK officielle bornée.
- Réel préparé : inbound WhatsApp signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans composition active ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients et réponses Twilio injectés; canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-client.ts` : adaptation minimale du SDK officiel, options bornées et aucun I/O à la construction;
- `src/modules/channels/channel-provider-secrets-bootstrap.ts` : configuration versionnée par références, garde serveur, décodage strict et resolver injecté;
- `src/modules/channels/provider-registry.ts` et `.env.example` : références gérées obligatoires sans promotion vers `ready` ni valeur secrète;
- tests fabrique officielle, bootstrap, registre, transport, coffre et service sortant.

## Risques

- Le SDK et les valeurs claires existent nécessairement en mémoire pendant l'envoi; JavaScript ne permet pas de garantir leur effacement immédiat. Ils ne sont ni persistés ailleurs, ni audités, ni retournés.
- L'interface de resolver est livrée mais aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve sont factices.
- Les routes entrantes utilisent encore la configuration Twilio préparée et le registre demeure volontairement incapable de produire `ready`; aucune santé fournisseur réelle n'est prouvée.
- La suite Vitest monolithique locale reproduit le blocage PGlite silencieux connu. Les lots ciblés passent; la CI Linux/PostgreSQL reste l'autorité exhaustive.

## Validations

- `pnpm agent:continuity-check` initial/final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31258560475` et continuité `31258560449` vertes sur `8d80ec3`;
- local ciblé : 8 fichiers/62 tests verts, plus 2 fichiers/15 tests après construction du SDK officiel réel sans réseau;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuity-check et diff check verts;
- exhaustif local : Vitest monolithique silencieux et interrompu sans assertion en échec; CI PostgreSQL requise pour suite complète et Playwright;
- GitHub fonctionnel : continuité `31259897728` verte; CI PostgreSQL `31259897751` verte en 14 min 20 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 111 fichiers/454 tests, build et 20/20 Playwright. La PR #11 reste brouillon, fusionnable et `CLEAN`.

## Prochaine action recommandée

Ajouter `src/modules/channels/whatsapp-twilio-readiness.ts` et une composition d'activation explicite sans résolution de secret, construction de client ni réseau avant toutes les gardes. Documenter ensuite santé, activation, rotation, révocation et désactivation; ne créer ni Sandbox, credential réel, endpoint public ni message réel avant l'autorisation humaine de `docs/OS5_PROVIDER_SELECTION.md`.
