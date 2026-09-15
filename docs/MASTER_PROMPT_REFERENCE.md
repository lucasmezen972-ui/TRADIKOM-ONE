# Référence canonique du prompt maître TRADIKOM ONE OS

Ce document est un index de navigation et un contrat de continuité. Il ne remplace pas le PDF : en cas d'écart, le PDF canonique prévaut.

## Source canonique

- fichier local : `/Users/TRADIKOM/Downloads/Tradikom_One_OS_Prompt_Maitre_Codex_Acces_Ordinateur.pdf`;
- titre PDF : `TRADIKOM ONE OS - Prompt maitre ultra-complet`;
- version : `1.0 - juillet 2026`;
- nombre de pages : `71`;
- SHA-256 : `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`;
- inspection de référence : texte extrait sur 71/71 pages; pages 1, 5, 31, 46, 69 et 71 rendues et vérifiées visuellement le 30 juillet 2026.

Le chemin local peut être remplacé par `TRADIKOM_MASTER_PROMPT_PATH` sans changer l'empreinte attendue. Le PDF ne contient ni formulaire, ni JavaScript, ni chiffrement.

## Boucle obligatoire de chaque automation

1. Lire `docs/AGENT_STATE.json`, ce document, `docs/WORKLOG.md`, `docs/NEXT_STEPS.md` et `docs/DRIFT_REPORT.md`.
2. Exécuter `pnpm agent:continuity-check`; le script utilise le support TypeScript natif de Node 22 et, en local, vérifie aussi l'empreinte du PDF canonique.
3. Relire directement dans le PDF les pages cœur `3-7`, `31-33`, `46`, `48` et `69-71`. Ces pages définissent mandat, north star, anti-dérive, autonomie, continuité, roadmap, Definition of Done, reprise, démonstration, ordre d'exécution, tests et handoff.
4. Déterminer la première étape incomplète de l'ordre exact de la page 48. Ne pas sélectionner une tâche parce qu'elle est facile ou déjà proche du code courant.
5. Relire les pages métier et techniques associées à cette étape à l'aide de la carte ci-dessous.
6. Avant de modifier le code, écrire dans `AGENT_STATE.json` les pages et sections retenues ainsi que la preuve attendue.
7. Avant de s'arrêter, ajouter dans `DRIFT_REPORT.md` une section `Alignement prompt maître` qui cite les pages, l'exigence servie, la preuve obtenue et tout écart restant.
8. Une tranche n'est jamais déclarée terminée sans satisfaire la Definition of Done de la page 32 et la matrice de la page 69.

Si le PDF est absent ou si son empreinte diffère, l'automation ne doit pas inventer son contenu. Elle marque l'alignement comme bloqué, produit un bloc de reprise exact et poursuit seulement les tâches dont les exigences sont déjà prouvées par l'état versionné.

## Ordre directeur non négociable

La page 48 impose cet ordre : audit, documentation de vision OS, automation de continuité, schéma conversation, RLS, service d'ingestion, adaptateur de test, web chat minimal, schéma de plan, validation unique, exécution mock durable, Playwright, documentation, rapport.

Conséquences immédiates :

- ne pas ouvrir OS-2 avant la verticale OS-1 verte de bout en bout;
- ne pas ajouter de module métier visible, améliorer le Kanban ou enrichir un dashboard avant le parcours conversationnel;
- ne pas brancher de fournisseur réel sans clés et consentement;
- ne jamais présenter un mock comme réel;
- ne pas déployer en production sans autorisation explicite.

## Carte des pages

| Pages | Sections | Usage de décision |
| --- | --- | --- |
| 1-3 | Mandat et instructions immédiates | Source de vérité, autonomie, interdits et reprise |
| 4-5 | Vision et doctrine anti-dérive | Test conversation-first et contenu obligatoire du drift report |
| 6-8 | Autonomie et automation | Limites d'autorité, fichiers de continuité et contrôle périodique |
| 9 | Audit initial | Dépôt, branches, PR #10, dette et réutilisation |
| 10-12 | Architecture et Conversation Hub | Fil, message, provenance, idempotence et anti-boucle |
| 13-14 | Identité et canaux | Identité omnicanale, adaptateurs et états réels |
| 15-18 | Connecteurs, capacités, orchestrateur, workflows | Capability Manifest, plans structurés, actions durables |
| 19-21 | Goals, mémoire, politique | Objectifs permanents, Business Brain et autonomie graduée |
| 22 | PostgreSQL et RLS | Isolation tenant, contraintes et migrations |
| 23 | Multimodal | Pièces jointes, documents et provenance |
| 24-25 | UX et mobile | Interface française simple, mobile-first et décisions accessibles |
| 26-30 | Environnements et intégrations | CI/CD, GitHub, observabilité, fournisseurs et SDK |
| 31-33 | Roadmap, Definition of Done et reprise | Passage de phase, preuves obligatoires et handoff |
| 34-45 | Annexes de sécurité et architecture | Shadow mode, compensation, RGPD, injection, modèles IA, structure |
| 46-48 | Démonstration, risques et ordre exact | Parcours vertical prioritaire et séquencement obligatoire |
| 49-50 | Gouvernance et références | Ambition produit et sources techniques à vérifier |
| 51-63 | Catalogue et playbooks métier | Capacités génériques et risques par domaine |
| 64-68 | Runtime et fournisseurs sans clés | Squelette provider, webhooks, Twilio, Resend et WebChat |
| 69 | Matrice de tests | Unit, intégration, RLS, workflow, provider, sécurité, Playwright, a11y |
| 70-71 | Handoff et dernière instruction | État de reprise et critère suprême conversationnel |

## Références OS-1 actuelles

La phase active doit croiser au minimum :

- pages 10-12 pour le Conversation Hub;
- pages 16-18 pour capacités, planification et durabilité;
- page 22 pour PostgreSQL/RLS;
- page 24 pour la simplicité de l'interface;
- pages 35-38 et 43-44 pour simulation, compensation, données non fiables et abstraction IA;
- page 46 pour le parcours démontrable;
- page 48 pour l'ordre d'implémentation;
- pages 64 et 68 pour le provider runtime et le WebChat sans clé;
- page 69 pour les tests;
- pages 70-71 pour la reprise et le critère suprême.

## Contrat de preuve

Chaque passage doit laisser quatre éléments vérifiables :

1. `pagesConsulted` : pages réellement consultées pour la tâche;
2. `requirements` : exigences du PDF servies par la tranche;
3. `evidence` : tests, migration, écran, audit ou état fournisseur qui prouvent le résultat;
4. `remainingGaps` : exigences non encore satisfaites, sans les masquer derrière un statut vague.

La question de sortie reste celle de la page 71 : cette action permet-elle à un professionnel d'obtenir un résultat métier plus simplement par la conversation ?
