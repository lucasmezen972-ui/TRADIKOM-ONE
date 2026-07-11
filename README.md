# TRADIKOM ONE

> **Le système d’exploitation intelligent des entreprises locales.**  
> Créez votre site, centralisez vos prospects, automatisez vos relances, connectez vos logiciels et pilotez votre activité depuis un seul endroit.

---

## À propos du projet

**TRADIKOM ONE** est une plateforme SaaS tout-en-un conçue pour les TPE, indépendants et entreprises locales.

Elle ne se limite pas à créer un site internet ou à programmer des publications. Son objectif est de relier toute la chaîne commerciale d’une entreprise :

**Visibilité → Contact → Qualification → Rendez-vous → Devis → Vente → Avis → Fidélisation**

TRADIKOM ONE agit comme une couche intelligente au-dessus des outils déjà utilisés par l’entreprise. Le client peut conserver son logiciel métier, sa caisse, son agenda ou son outil de facturation : TRADIKOM ONE les connecte, centralise leurs données et automatise les actions utiles.

### Promesse

> **Vous gardez vos outils. TRADIKOM ONE leur donne un cerveau.**

---

## Vision

Les entreprises locales utilisent souvent plusieurs outils qui ne communiquent pas entre eux :

- site internet ;
- réseaux sociaux ;
- WhatsApp ;
- agenda ;
- logiciel de caisse ;
- logiciel de devis et facturation ;
- CRM ;
- plateforme de réservation ;
- outils d’emailing ;
- plateformes d’avis.

TRADIKOM ONE réunit ces usages dans un environnement unique, simple et automatisé.

La plateforme doit permettre à un dirigeant de piloter son activité avec des commandes simples telles que :

> « Relance les devis sans réponse depuis cinq jours. »

> « Crée une campagne pour remplir les créneaux libres de vendredi. »

> « Mets à jour mes horaires partout. »

> « Crée une page pour ma nouvelle prestation et annonce-la à mes clients. »

---

## Objectifs du MVP

La première version de TRADIKOM ONE doit démontrer un parcours complet :

1. création d’un compte utilisateur ;
2. création d’une organisation ;
3. onboarding de l’entreprise ;
4. génération d’un **Business Twin** ;
5. création automatique d’un site internet ;
6. modification et prévisualisation du site ;
7. publication sur une URL dédiée ;
8. réception d’une demande via un formulaire ;
9. création automatique du prospect dans le CRM ;
10. lancement d’un workflow de relance ;
11. affichage de l’activité dans le tableau de bord ;
12. connexion à un webhook générique ou import CSV ;
13. journalisation des actions importantes.

---

## Fonctionnalités principales

### Business Twin

Chaque entreprise dispose d’un double numérique structuré contenant notamment :

- identité de l’entreprise ;
- prestations et produits ;
- zones géographiques ;
- horaires ;
- ton de communication ;
- objectifs commerciaux ;
- questions fréquentes ;
- éléments autorisés ou interdits dans les contenus ;
- préférences d’automatisation ;
- paramètres du site internet.

Le Business Twin sert de source de vérité pour les sites, contenus, automatisations, réponses et recommandations.

### Website Factory

TRADIKOM ONE peut générer un site internet professionnel à partir des informations du Business Twin.

Fonctionnalités prévues :

- génération de sites responsives ;
- modèles sectoriels ;
- pages de services ;
- galerie ;
- avis clients ;
- FAQ ;
- horaires ;
- zones d’intervention ;
- formulaires de contact ;
- boutons WhatsApp ;
- appels à l’action ;
- prévisualisation mobile et ordinateur ;
- gestion des versions ;
- publication ;
- optimisation SEO locale ;
- architecture compatible avec les domaines personnalisés.

Les sites sont générés à partir de données structurées. Le système ne crée pas un projet indépendant et impossible à maintenir pour chaque client.

### CRM

Le CRM centralise :

- contacts ;
- entreprises ;
- prospects ;
- opportunités ;
- notes ;
- tâches ;
- activités ;
- sources commerciales ;
- historique des échanges.

Pipeline par défaut :

- Nouveau contact ;
- À qualifier ;
- Rendez-vous prévu ;
- Devis envoyé ;
- Gagné ;
- Perdu.

### Moteur d’automatisation

Le moteur de workflows repose sur des événements.

Exemples de déclencheurs :

- formulaire envoyé ;
- contact créé ;
- prospect créé ;
- étape commerciale modifiée ;
- site publié ;
- synchronisation terminée.

Exemples d’actions :

- créer une tâche ;
- ajouter une étiquette ;
- mettre à jour un contact ;
- créer une activité ;
- envoyer une notification ;
- appeler un webhook ;
- attendre un délai ;
- demander une validation humaine.

### Connect Store

TRADIKOM ONE doit pouvoir se connecter aux logiciels existants grâce à plusieurs méthodes :

- OAuth 2.0 ;
- clé API ;
- webhooks ;
- import CSV ;
- SFTP ;
- lecture d’emails structurés ;
- connecteurs natifs ;
- outils d’orchestration externes.

Premiers connecteurs du MVP :

- webhook générique ;
- import de contacts CSV ;
- logiciel métier simulé.

### Tableau de bord

Le tableau de bord met en avant les actions utiles plutôt que les métriques de vanité.

Il affiche notamment :

- nouveaux prospects ;
- contacts ;
- tâches à traiter ;
- opportunités par étape ;
- statut du site ;
- formulaires reçus ;
- état des connecteurs ;
- exécutions de workflows ;
- activités récentes ;
- opportunités commerciales détectées.

### Opportunity Radar

Le radar détecte les opportunités oubliées ou les problèmes à traiter.

Exemples :

- prospect non contacté depuis plus de 24 heures ;
- devis sans relance ;
- opportunité inactive ;
- brouillon de site non publié ;
- connecteur en erreur ;
- formulaire sans responsable assigné.

---

## Secteurs ciblés

Le projet est d’abord pensé pour les entreprises locales francophones, notamment en Martinique et dans les Antilles françaises.

Secteurs prioritaires :

- restauration et CHR ;
- garages et automobile ;
- coiffure, beauté et bien-être ;
- artisans ;
- tourisme ;
- conciergeries ;
- commerces indépendants ;
- services professionnels.

---

## Architecture technique envisagée

### Stack principale

- **TypeScript**
- **Next.js** avec App Router
- **PostgreSQL**
- **Tailwind CSS**
- **ORM ou couche SQL typée**
- **Playwright** pour les tests end-to-end
- **Docker Compose** pour l’environnement local
- **pnpm** pour la gestion des dépendances

### Structure proposée

```text
apps/
  web/
  worker/

packages/
  ai/
  auth/
  config/
  connectors/
  core/
  db/
  observability/
  ui/
  website-engine/
  workflows/
```

Cette structure pourra évoluer selon les décisions d’architecture prises pendant le développement.

---

## Architecture multi-tenant

Chaque entreprise est isolée dans son propre tenant.

Principes obligatoires :

- aucune donnée ne doit être accessible depuis un autre tenant ;
- l’isolation ne doit pas dépendre uniquement de l’interface ;
- les autorisations doivent être contrôlées côté serveur ;
- les rôles doivent être appliqués à chaque opération ;
- les actions sensibles doivent être journalisées ;
- des tests automatiques doivent prouver l’isolation des données.

Rôles prévus :

- propriétaire ;
- administrateur ;
- manager ;
- collaborateur ;
- lecture seule.

---

## Intelligence artificielle

L’IA est intégrée derrière une couche d’abstraction afin de ne pas dépendre d’un seul fournisseur.

Usages prévus :

- génération du Business Twin ;
- création des textes du site ;
- génération de FAQ ;
- reformulation ;
- qualification de prospects ;
- recommandations commerciales ;
- commandes en langage naturel.

Les contenus générés doivent :

- être validés par des schémas ;
- conserver leur source et leur version ;
- être associés à un statut d’approbation ;
- ne jamais être publiés automatiquement lorsqu’une validation est requise.

Sans clé API, l’application doit rester utilisable grâce à des modèles déterministes.

---

## Sécurité

La sécurité est une exigence de base du projet.

Le produit doit prévoir :

- séparation stricte des tenants ;
- contrôle d’accès par rôles ;
- sessions sécurisées ;
- hachage des mots de passe ;
- validation systématique des entrées ;
- protection contre les injections ;
- protection contre le XSS ;
- limitation de débit ;
- chiffrement des identifiants de connecteurs ;
- audit des actions ;
- journalisation sans secrets ;
- protection des webhooks ;
- gestion des consentements ;
- export et suppression des données ;
- architecture compatible avec les exigences RGPD.

La présence de fonctionnalités RGPD ne signifie pas que le produit est automatiquement conforme. Une validation juridique et organisationnelle restera nécessaire avant la mise en production.

---

## Installation locale

### Prérequis

- Node.js version LTS récente ;
- pnpm ;
- Docker ;
- Docker Compose ;
- Git.

### Installation

```bash
git clone <URL_DU_DEPOT>
cd tradikom-one
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

L’application devrait ensuite être accessible sur :

```text
http://localhost:3000
```

### Données de démonstration

Le seed local doit créer une entreprise fictive :

**Garage Caraïbes Auto**  
Le Lamentin, Martinique

Prestations :

- entretien automobile ;
- diagnostic ;
- climatisation ;
- freinage ;
- vidange.

Les identifiants de démonstration devront être indiqués dans la sortie de la commande de seed ou dans la documentation locale.

---

## Variables d’environnement

Les variables exactes seront documentées dans `.env.example`.

Exemple :

```env
DATABASE_URL=
AUTH_SECRET=
APP_URL=http://localhost:3000
ENCRYPTION_KEY=
OPENAI_API_KEY=
REDIS_URL=
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

Aucun identifiant réel ne doit être ajouté au dépôt.

---

## Commandes utiles

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

Les scripts disponibles peuvent évoluer au fur et à mesure de l’implémentation.

---

## Tests attendus

Le projet doit comporter :

- tests unitaires ;
- tests d’intégration ;
- tests end-to-end ;
- tests d’isolation des tenants ;
- tests des permissions ;
- tests de publication de site ;
- tests formulaire vers CRM ;
- tests des workflows ;
- tests des webhooks ;
- tests des imports CSV.

Parcours end-to-end prioritaire :

1. inscription ;
2. création d’une organisation ;
3. onboarding ;
4. génération du site ;
5. publication ;
6. envoi d’un formulaire public ;
7. création du prospect dans le CRM ;
8. création d’une tâche de relance.

---

## État du projet

**Statut : conception et construction du MVP.**

Le dépôt doit d’abord livrer un parcours vertical complet et fiable avant d’ajouter de nombreuses intégrations.

### Inclus dans la première phase

- authentification ;
- multi-tenant ;
- onboarding ;
- Business Twin ;
- création de site ;
- publication locale ;
- formulaire public ;
- CRM ;
- workflow de relance ;
- webhook générique ;
- import CSV ;
- connecteur simulé ;
- tableau de bord ;
- journal d’audit.

### Hors périmètre initial

- publication réelle sur Google et Meta ;
- messagerie WhatsApp réelle ;
- centaines de connecteurs ;
- facturation de production ;
- gestion avancée de campagnes publicitaires ;
- application mobile ;
- e-commerce complet ;
- automatisation sans garde-fous ;
- gestion automatisée des domaines personnalisés.

---

## Feuille de route

### Phase 1 — Socle MVP

- authentification ;
- organisations ;
- Business Twin ;
- Website Factory ;
- CRM ;
- workflows ;
- connecteurs de démonstration ;
- dashboard ;
- sécurité et tests.

### Phase 2 — Acquisition et réputation

- réseaux sociaux ;
- Google Business Profile ;
- collecte et gestion des avis ;
- campagnes email et SMS ;
- agenda ;
- demandes de devis ;
- WhatsApp.

### Phase 3 — Connect Store

- SDK connecteurs ;
- premiers logiciels métiers ;
- synchronisation bidirectionnelle ;
- rapprochement des contacts ;
- gestion avancée des erreurs ;
- marketplace de connecteurs.

### Phase 4 — Autopilot

- Opportunity Radar avancé ;
- commandes conversationnelles ;
- recommandations commerciales ;
- relances intelligentes ;
- attribution du chiffre d’affaires ;
- prévision des périodes creuses ;
- automatisations sectorielles.

---

## Principes de développement

- privilégier la simplicité et la maintenabilité ;
- garder les modules petits et cohérents ;
- éviter les dépendances inutiles ;
- ne jamais contourner les règles multi-tenant ;
- documenter les décisions importantes ;
- tester les parcours critiques ;
- protéger les actions sensibles ;
- ne jamais prétendre qu’un test est passé sans l’avoir exécuté ;
- conserver toute l’interface client en français ;
- utiliser des données de démonstration réalistes, jamais de `Lorem ipsum`.

---

## Contribution

Le projet est actuellement privé et en phase de construction.

Avant toute contribution :

1. lire `AGENTS.md` ;
2. consulter la documentation d’architecture ;
3. créer une branche dédiée ;
4. ajouter ou mettre à jour les tests ;
5. vérifier le lint, les types et le build ;
6. documenter les changements importants.

---

## Licence

Projet propriétaire. Tous droits réservés.

L’utilisation, la copie, la distribution ou l’exploitation commerciale du code sont interdites sans autorisation écrite du propriétaire du projet.

---

## Identité

**TRADIKOM ONE**  
*Visible partout. Connecté à tout. Automatisé pour vendre.*
