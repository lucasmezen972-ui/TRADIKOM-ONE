# Audit d'entrée TRADIKOM ONE OS

Date : 2026-07-29
Branche : `codex/tradikom-one-os`
Base : `origin/main` à `aa46bb1cf948ffdafd0c089608bc059516da7041`

## Résumé exécutif

Le dépôt est un socle SaaS multi-tenant avancé, pas encore un OS conversationnel. Il contient 42 modules bornés, 66 migrations runtime et 60 miroirs SQL, 73 fichiers de tests, PostgreSQL/RLS, des workflows durables, un audit, des approvals et un Connector Runtime mock contrôlé. La pièce structurante absente est le Conversation Hub canonique avec identité omnicanale, anti-boucle et continuité inter-canaux.

La prochaine verticale est donc OS-1. Aucun nouveau Kanban, dashboard ou silo métier ne doit la précéder.

## État Git et GitHub

- `main` distant : `aa46bb1`; le clone local avait des références anciennes et a été actualisé sans perdre l'état précédent.
- Sauvegarde récupérable de l'ancien worktree : stash `8b7219f`.
- PR #6 : fusionnée, run Phase 5 `29513872220` vert.
- PR #7 : brouillon ouvert depuis le 16 juillet, basé sur `7ac09bf`, CI rouge dans `29518832560` au niveau des tests. Elle doit être rebasée et réauditée ou fermée comme remplacée; ne pas la fusionner en l'état.
- PR #10 : brouillon ouvert, fusionnable, head `c787249`, 21 commits, 121 fichiers, 9 813 ajouts, 276 suppressions. Son run `30483590061` est vert.
- Dernier run de `main` `30127033174` : échec précoce de `pnpm audit` sur PostCSS 8.5.16. Le pin `>=8.5.18` validé par la PR #10 est repris dans OS-0; les autres étapes n'avaient pas démarré.

### Plan pour la PR #10

Ne pas fusionner les vingt lots en bloc : la taille et le mélange CRM, sécurité, fournisseurs et médias contredisent la règle d'une tranche verticale démontrable. Conserver la PR en brouillon, rebaser après OS-0 puis extraire en unités indépendantes :

1. conformité : suppression de compte;
2. validation conversationnelle : centre d'approbation, report et révision de contenus;
3. provider : transport Resend + suppression d'adresses, désactivé sans configuration;
4. multimodal : assets sûrs, seulement après le modèle de message OS-1;
5. canal : normalisation et lien WhatsApp, sans le présenter comme un adaptateur entrant réel;
6. différer pipeline, Kanban, préférences et dashboard après OS-1.

## Existant réutilisable

- PostgreSQL primaire avec PGlite local, transactions tenant et contexte serveur.
- RLS PostgreSQL, tests restricted-role, index tenant-leading et intégrité tenant-composée.
- Sessions et tokens hachés/révocables; credentials OAuth chiffrés et versionnés.
- Audit tenant-aware sans secret et approvals réutilisables.
- Workflows durables : outbox, leases, retry/backoff, wait, cancellation, dead letter et idempotence.
- Connector Runtime : policy, scopes, quota, idempotence, santé et erreurs normalisées.
- Publication de site par snapshots immuables.
- Import/export borné avec neutralisation tableur, rétention et rollback.
- API Intelligence : sources officielles approuvées, fetch HTTPS borné, preuves, contrats et blocage des ruptures.

## À refactorer

- `src/lib/services.ts` reste une façade de composition volumineuse; aucun nouveau domaine OS ne doit y être implémenté.
- Le catalogue statique affiche encore des libellés comme `Connecté` sans vocabulaire d'état commun à toutes les intégrations.
- `OpenAiProvider` est sélectionnable mais renvoie aujourd'hui le fallback déterministe; il ne doit pas être présenté comme une génération OpenAI réelle.
- Les documents `RESUME_STATE.md` et `NIGHT_SHIFT_*` contiennent un historique utile mais un checkpoint Phase 5 obsolète. `AGENT_STATE.json` devient canonique.
- Les nombreux modules IA ont chacun leur propre proposition/approbation; OS-1 devra les exposer comme capacités sans dupliquer leur logique.

## À remplacer progressivement

- Les cartes de connecteurs statiques par un Capability Manifest versionné, validé et indépendant du fournisseur.
- Les redirections entre écrans de décision par des décisions visibles et reprenables dans le fil canonique.
- Les statuts textuels hétérogènes par une taxonomie explicite : `disabled`, `not_configured`, `mock`, `sandbox`, `read_only`, `real`.

## À supprimer plus tard

- Les duplications de documentation de reprise une fois leur historique archivé.
- Les chemins de compatibilité du monolithe uniquement après migration de tous les appelants et tests de non-régression.
- Aucun fichier métier n'est supprimé dans OS-0.

## Modules IA

| Module | État réel | Limite |
| --- | --- | --- |
| `ai/provider` | abstraction active, provider déterministe réel | `OpenAiProvider` n'effectue pas encore d'appel structuré |
| Business Brain | mémoire versionnée et sourcée | pas un graphe causal autonome |
| Strategic Advisor | règles déterministes, approbation planning-only | aucune exécution |
| Autonomous Marketing | brouillons versionnés | aucun envoi ni lancement |
| Website AI | proposition appliquée au brouillon | aucune publication automatique |
| Sales AI | score explicable | aucun message, devis, prix ou remise |
| Reputation AI | analyse et réponse brouillon sur import manuel | aucun monitoring ni envoi externe |
| Competitor Intelligence | observations manuelles publiques | aucun crawl ou scraping |
| Financial AI | calculs sur données déclarées | aucune banque, comptabilité ou paiement |
| AI Employees | profils, permissions et activité | aucun agent autonome d'exécution |
| Self Improvement | règles mesurées et décisions planning-only | aucun changement automatique |

## Connecteurs et fournisseurs

| Capacité | État | Réalité |
| --- | --- | --- |
| Webhook générique entrant | réel borné | HMAC, replay, quota, audit; dépend d'une configuration serveur |
| Webhook workflow sortant | réel borné | HTTPS, SSRF/DNS rebinding, timeout, idempotence; pas un fournisseur métier |
| CSV/JSON/XLSX | réel local | import/export tenant, sans fournisseur externe |
| `mock_business` | mock read-only | aucun réseau ni donnée client |
| OAuth `mock_business` | mock | PKCE, chiffrement et anti-rejeu réels, fournisseur fictif |
| DNS `.test` | mock/manual | aucune modification DNS externe |
| Google Business Profile | disabled/planned | aucune OAuth réelle |
| Email console/test | local/test | interdit comme preuve de livraison production |
| Email production | not configured | aucun provider réel sur `main`; Resend existe seulement dans la PR #10 |
| API Intelligence | réel read-only contrôlé | fetch de sources officielles approuvées, aucune opération fournisseur |

## Données, RLS et migrations

- Le runtime expose 66 migrations jusqu'à `066_phase5_website_domain_bindings_rls`; les miroirs SQL vont jusqu'à `0060`.
- `scripts/verify-migrations.ts` applique deux fois une base vide, teste l'upgrade depuis Phase 2, vérifie toutes les tables `tenant_id` pour RLS/policy `ALL` et exige un index commençant par `tenant_id`.
- Les tests PostgreSQL contrôlent un rôle restreint et les relations inter-tenant.
- Limite : le dernier run `main` n'a pas atteint ces contrôles à cause de l'audit de dépendances; OS-0 doit les relancer.

## Bloqué par intervention humaine

- création et consentement des applications OAuth fournisseurs;
- MFA, captcha, vérification d'identité et acceptation contractuelle;
- clés Resend/Twilio/WhatsApp/Teams/Slack et secrets de webhook réels;
- achat, quota payant, domaine, ressource durable ou déploiement production;
- modification DNS réelle et validation d'un expéditeur WhatsApp.

Les clés ne doivent jamais être demandées dans le chat. Elles passent par les gestionnaires de secrets et variables d'environnement officielles.

## Risques de dérive

- 42 modules visibles augmentent déjà la charge cognitive.
- La PR #10 consacre une part importante au pipeline et au dashboard.
- Les profils IA et marketplaces peuvent être confondus avec des agents exécutants alors qu'ils restent planning-only.
- Des fixtures mock techniquement complètes peuvent être prises pour des intégrations fournisseurs réelles.
- L'absence de fil canonique entretient la navigation par écrans plutôt que l'expérience conversationnelle.

## Prochaine verticale

OS-1 doit prouver de bout en bout : fil canonique, identité web + canal test, idempotence, anti-boucle, plan structuré, validation unique, deux capacités mock explicites, résultat répliqué, audit et reprise. La Definition of Done est celle de `docs/ROADMAP_TRADIKOM_ONE_OS.md` et d'`AGENT_STATE.json`.
