# TRADIKOM ONE

> **Transformer toute la complexité d’une entreprise en une conversation simple, continue, sûre et orientée résultats.**

TRADIKOM ONE est conçu pour devenir le **système d’exploitation conversationnel de l’entreprise**.

Le professionnel ne doit plus apprendre à utiliser quinze logiciels, construire des automatisations techniques ou naviguer entre une multitude de tableaux de bord. Il exprime ce qu’il veut obtenir, depuis WhatsApp, Microsoft Teams, Slack, le web, le mobile, l’email ou la voix. TRADIKOM ONE comprend l’intention, retrouve le contexte autorisé, choisit les bons outils, construit un plan, demande les validations nécessaires, exécute les actions permises et explique le résultat.

Le CRM, le Business Brain, le site, les workflows, les connecteurs, les approbations et les modules métier ne sont pas le produit final : ils constituent l’infrastructure interne de cet assistant universel.

## North Star

Le scénario cible est le suivant :

1. Un professionnel envoie une demande ou une note vocale depuis WhatsApp.
2. TRADIKOM ONE comprend l’objectif métier, pas seulement une commande technique.
3. Il consulte plusieurs outils connectés et les règles de l’entreprise.
4. Il construit un plan structuré, évalue le risque, le coût et la réversibilité.
5. Il demande une seule confirmation lorsque cela est nécessaire.
6. L’utilisateur peut confirmer depuis Teams, Slack, le web ou un autre canal.
7. TRADIKOM ONE exécute une mission multi-outils durable et idempotente.
8. Le même fil de conversation reste accessible sur tous les canaux autorisés.
9. Les résultats, preuves, décisions et erreurs sont enregistrés et explicables.
10. L’assistant poursuit l’objectif et adapte son plan dans les limites définies.

Exemples de demandes cibles :

- « Relance les devis de plus de dix jours, sauf les clients déjà contactés cette semaine. »
- « Vérifie les notes de frais sans justificatif et demande les pièces manquantes. »
- « Organise ma journée de demain en tenant compte de mes priorités et du temps de trajet. »
- « Explique pourquoi les ventes ont diminué et commence à corriger ce qui est sans risque. »
- « Fais signer ce contrat, relance dans trois jours si nécessaire, puis crée le client dans l’ERP. »
- « Maintiens notre délai de réponse client sous deux heures. »
- « Prépare le lancement de cette offre avec un budget maximum de 5 000 €, et demande mon accord uniquement pour les dépenses supérieures à 1 000 €. »

## Principes produit non négociables

- **Une seule identité visible :** l’utilisateur parle toujours à TRADIKOM ONE, même si plusieurs agents spécialisés travaillent derrière.
- **Une seule conversation canonique :** les canaux sont des projections d’un fil central détenu par TRADIKOM ONE.
- **Une seule mémoire autorisée :** les faits, règles, préférences, décisions et hypothèses restent sourcés, versionnés et contrôlables.
- **Des capacités métier universelles :** l’orchestrateur raisonne en actions telles que `crm.contacts.search` ou `calendar.event.create`, pas directement en noms de fournisseurs.
- **Une autonomie graduelle :** observation, brouillon, confirmation, autonomie encadrée ou autonomie limitée à un processus précis.
- **La sécurité avant le spectacle :** aucun texte généré par un modèle ne déclenche directement une action externe.
- **Des réponses orientées résultats :** l’utilisateur voit ce qui a été obtenu, pas des messages techniques incompréhensibles.
- **Une vérité explicite :** chaque fonctionnalité est clairement identifiée comme simulée, brouillon, prête à confirmer, exécutée, échouée ou non configurée.
- **Aucune dérive vers un CRM classique :** une nouvelle fonctionnalité est prioritaire uniquement si elle aide l’utilisateur à obtenir un résultat plus facilement par la conversation.

## Architecture cible

```text
WhatsApp ───────┐
Microsoft Teams ┤
Slack ──────────┤
Web / Mobile ───┼──► Conversation Hub canonique
Email / Voix ───┘              │
                               ▼
                    Identité omnicanale et mémoire
                               │
                               ▼
                    Orchestrateur conversationnel
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
          Policy Engine   Goal & Watch   Approval Center
                 │             │             │
                 └─────────────┼─────────────┘
                               ▼
                    Runtime de capacités
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      Connecteurs natifs   API unifiées   Connecteurs privés
              │                │                │
              └────────────────┼────────────────┘
                               ▼
      CRM, ERP, RH, finance, e-commerce, support, marketing, BI…
```

### Conversation Hub

La future source de vérité des échanges devra gérer :

- conversations, messages, réponses, participants et pièces jointes ;
- canal d’origine et identifiant externe ;
- réplication vers plusieurs canaux ;
- statuts de livraison, échecs et lectures lorsque disponibles ;
- confidentialité, rôles et visibilité ;
- plans d’action, validations et résultats ;
- déduplication des webhooks et prévention des boucles ;
- continuité de contexte entre WhatsApp, Teams, Slack et le web.

### Connector Runtime

TRADIKOM ONE doit pouvoir connecter progressivement les logiciels professionnels modernes et les systèmes plus anciens grâce à plusieurs niveaux :

1. connecteurs natifs approfondis ;
2. API unifiées par métier ;
3. plateformes d’intégration externes ;
4. connecteurs OpenAPI, REST et GraphQL ;
5. webhooks entrants et sortants ;
6. imports CSV, XLSX et JSON ;
7. SFTP et bases SQL ;
8. traitement d’emails et de documents ;
9. passerelle locale pour logiciels installés ou réseaux privés ;
10. automatisation navigateur en dernier recours, signalée comme fragile.

Les familles visées comprennent notamment : CRM, ERP, RH/SIRH, notes de frais, caisse, distribution, e-commerce, collaboration, gestion de projet, signature, GED, marketing, support, téléphonie, Business Intelligence, banque, comptabilité et facturation.

### Orchestrateur et actions durables

Une mission doit pouvoir :

- utiliser plusieurs connecteurs dans un même plan ;
- attendre une réponse humaine pendant plusieurs jours ;
- survivre à un redémarrage ou à une panne réseau ;
- reprendre après expiration d’un jeton ;
- éviter toute double exécution ;
- appliquer des retries bornés ;
- demander une validation depuis un autre canal ;
- annuler ou compenser les actions réversibles ;
- conserver une preuve complète de son exécution.

## État actuel du dépôt

Le dépôt contient déjà une base solide et testée pour construire cette vision :

- comptes, organisations, memberships et rôles ;
- sessions sécurisées, révocables et tenant-scoped ;
- PostgreSQL, migrations, relations composites et RLS ;
- Business Twin et Business Brain avec preuves et versions ;
- CRM, contacts, opportunités, activités et pipeline ;
- site public versionné par snapshots immuables ;
- workflows durables et worker ;
- imports et exports encadrés ;
- connecteurs bornés et cœur OAuth sécurisé ;
- API Intelligence et contrats de fournisseurs contrôlés ;
- moteurs de conseil, marketing, site, vente, réputation, concurrence et finance ;
- centre de pilotage et centre d’approbation ;
- journal d’audit ;
- fournisseur email HTTP Resend configurable ;
- gestion d’images avec validation binaire ;
- messages WhatsApp prêts à envoyer par lien `wa.me` ;
- suppression de compte RGPD ;
- tests unitaires, intégration, PostgreSQL/RLS et Playwright.

### Important : limites actuelles

Le produit n’est pas encore le système conversationnel omnicanal décrit ci-dessus.

- Le module WhatsApp actuel prépare un message et ouvre `wa.me` ; il ne reçoit pas encore les messages WhatsApp dans un Conversation Hub.
- Il n’existe pas encore de fil canonique partagé entre WhatsApp, Teams, Slack et le web.
- Les connecteurs de production restent limités, simulés, en lecture seule ou désactivés selon le module.
- Les véritables connecteurs OAuth nécessitent encore leur configuration fournisseur et leurs tests de contrat.
- Les moteurs IA restent majoritairement déterministes ou protégés par feature flags.
- Les actions de production sensibles ne doivent pas être présentées comme exécutées lorsqu’elles sont seulement préparées ou simulées.
- Le stockage d’images local doit être remplacé par un stockage objet persistant avant un déploiement serverless complet.
- La checklist de production reste la source de vérité pour les éléments non finalisés.

## Tranche prioritaire suivante

La prochaine vertical slice doit prouver le cœur architectural de TRADIKOM ONE OS :

1. schéma canonique des conversations ;
2. identité omnicanale sécurisée ;
3. messages et livraisons idempotentes ;
4. prévention des boucles de réplication ;
5. Web Chat réel ;
6. interface commune d’adaptateurs de canaux ;
7. adaptateur de test complet ;
8. structures WhatsApp Cloud API, Teams et Slack derrière feature flags ;
9. plan d’action structuré utilisant au moins deux capacités ;
10. validation unique depuis un autre canal ;
11. exécution contrôlée ou simulée clairement étiquetée ;
12. audit, RLS, tests PostgreSQL et Playwright.

Le critère de réussite n’est pas l’ajout d’une nouvelle page : c’est la capacité à commencer une mission sur un canal, la poursuivre sur un autre et conserver le même contexte, les mêmes droits et le même plan.

## Stack actuelle

- Next.js `16.2.11` App Router
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
- PostgreSQL `17`
- Drizzle ORM `0.45.2`
- PGlite `0.5.4` pour la démonstration locale bornée
- OpenAI SDK `6.46.0` derrière abstraction et feature flag
- Zod `4.4.3`
- Vitest `4.1.10`
- Playwright `1.61.1`

PostgreSQL est le runtime de référence. PGlite reste un mode local borné et ne remplace ni les migrations, ni les contraintes, ni les tests RLS PostgreSQL de la CI.

## Démarrage local

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Pour activer explicitement la démonstration locale :

```env
FEATURE_PUBLIC_DEMO=true
```

Identifiants de démonstration locale uniquement :

- Email : `patron@garage-caraibes-auto.example`
- Mot de passe : `Tradikom!2026`
- Site local : `/sites/garage-caraibes-auto`

Le seed partagé et ces identifiants sont refusés en production.

## Configuration

Variables principales disponibles dans `.env.example` :

```env
APP_URL=http://localhost:3000
DATABASE_URL=postgres://tradikom:tradikom_local@localhost:5432/tradikom_one
DATABASE_POOL_MAX=10
BUSINESS_TIME_ZONE=America/Martinique

EMAIL_PROVIDER=console
RESEND_API_KEY=
EMAIL_FROM=
ALLOW_CONSOLE_EMAIL_IN_PRODUCTION=false

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
FEATURE_AI_GENERATION=false
FEATURE_LIVE_INTEGRATIONS=false
FEATURE_PUBLIC_DEMO=false

CONNECTOR_ENCRYPTION_KEY=change-me-change-me-change-me-32b
ASSET_STORAGE_DIR=.data/tradikom-one-assets
COOKIE_SECURE=false

WORKER_MODE=once
WORKER_BATCH_SIZE=25
WORKER_POLL_INTERVAL_MS=5000
MAINTENANCE_BATCH_SIZE=500
```

### Services externes et accès Codex

Codex peut utiliser l’ordinateur, le navigateur, les CLI et les connecteurs disponibles pour configurer les services requis au fur et à mesure : GitHub, Vercel, Supabase, Temporal, Twilio, Resend, Expo et autres fournisseurs.

Règles impératives :

- ne jamais inventer une clé, un secret ou un identifiant ;
- ne jamais committer de secret dans Git ;
- ne jamais afficher un secret dans les logs, captures, audits ou comptes rendus ;
- demander l’intervention humaine uniquement lorsqu’une authentification, un MFA, un consentement, un paiement, une vérification d’identité ou une action irréversible l’exige ;
- préparer entièrement l’intégration lorsqu’un accès n’est pas encore disponible : variables, adaptateur, contrat, feature flag, tests, documentation et procédure d’activation ;
- continuer le reste du travail sans se bloquer sur un fournisseur indisponible.

## Commandes

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:e2e
pnpm db:migrate
pnpm db:verify
pnpm db:seed
pnpm db:reset
pnpm db:generate
pnpm worker
pnpm maintenance
```

## Qualité et sécurité

Toute nouvelle table tenant-owned doit inclure :

- `tenant_id` ;
- relations composites empêchant les références cross-tenant ;
- index tenant-leading ;
- politiques RLS PostgreSQL ;
- tests avec au moins deux organisations ;
- règles applicatives cohérentes avec la base.

Toute intégration externe doit inclure :

- authentification et révocation ;
- chiffrement et rotation des jetons ;
- vérification des signatures de webhook ;
- protection anti-replay ;
- idempotence ;
- limites de taille ;
- timeouts et retries bornés ;
- distinction des erreurs temporaires et définitives ;
- journalisation sans secret ni contenu sensible ;
- mode simulation ;
- permissions et niveaux de risque ;
- compensation lorsque possible.

Les contenus provenant des messages, documents, emails, sites ou outils connectés sont non fiables. Ils ne peuvent jamais remplacer les règles système, modifier les permissions, exfiltrer un secret ou déclencher directement une action.

## Doctrine de développement autonome

Codex peut prendre les décisions techniques nécessaires pour faire avancer le produit sans attendre une validation pour chaque détail réversible.

Il doit toutefois :

1. inspecter le dépôt et l’état des branches avant de modifier ;
2. travailler par vertical slices complètes ;
3. conserver la compatibilité avec les migrations existantes ;
4. maintenir `docs/RESUME_STATE.md` et les journaux d’avancement ;
5. enregistrer le dernier commit validé, les tests passés, les limites et la prochaine action exacte ;
6. reprendre depuis ce checkpoint après une interruption ou une limite d’utilisation ;
7. comparer régulièrement le travail à la North Star pour éviter la dérive ;
8. ne pas fusionner, déployer en production, engager une dépense ou réaliser une action irréversible sans les contrôles requis ;
9. ne jamais masquer un test rouge, une limitation ou une fonctionnalité simulée ;
10. laisser le dépôt dans un état exploitable et documenté à chaque checkpoint.

Si une session s’interrompt, la session suivante doit lire en priorité :

- `README.md` ;
- `docs/RESUME_STATE.md` ;
- `docs/NIGHT_SHIFT_LOG.md` lorsqu’il existe ;
- la PR active et ses checks ;
- les derniers commits ;
- les migrations et tests ajoutés.

Elle reprend ensuite la prochaine action documentée sans recommencer le projet ni ouvrir un nouveau chantier sans rapport.

## Documentation

Points d’entrée utiles :

- `docs/PHASE_2_IMPLEMENTATION.md`
- `docs/PHASE_3_API_INTELLIGENCE.md`
- `docs/API_SECURITY_MODEL.md`
- `docs/PHASE_4_AUTONOMOUS_PLATFORM.md`
- `docs/PRODUCTION_READINESS.md`
- `docs/RESUME_STATE.md`
- `docs/COMMAND_CENTER.md`
- `docs/APPROVAL_CENTER.md`
- `docs/PIPELINE.md`
- `docs/STRATEGIC_ADVISOR.md`
- `docs/EMAIL_PROVIDER.md`
- `docs/ASSET_UPLOAD.md`
- `docs/WHATSAPP.md`

## Règle finale

Avant d’ajouter une fonctionnalité, répondre honnêtement à cette question :

> **Est-ce que cela permet à une personne autorisée d’obtenir un meilleur résultat métier, plus simplement, par une conversation continue et sûre ?**

Si la réponse est non, le chantier n’est probablement pas prioritaire.
