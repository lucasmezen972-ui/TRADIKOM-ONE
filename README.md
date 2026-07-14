# TRADIKOM ONE

TRADIKOM ONE est un SaaS en francais pour les entreprises locales : compte utilisateur, organisation, Business Twin, site publie par snapshots immuables, formulaire public, CRM, workflows durables, connecteurs encadres, API Intelligence, centre de pilotage et journal d'audit.

## Stack

- Next.js 16.2.10 App Router
- React 19.2.4
- TypeScript 5
- Tailwind CSS 4
- PGlite 0.5.4 pour la demo locale sans Docker
- PostgreSQL 17 via `DATABASE_URL` pour le runtime principal Phase 2
- Drizzle ORM 0.45.2 pour la couche typée PostgreSQL
- Vitest 4.1.10
- Playwright 1.61.1

## Demarrage rapide

```bash
pnpm install
cp .env.example .env.local
# Activer uniquement la demo locale explicite : FEATURE_PUBLIC_DEMO=true
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Demo locale uniquement (`FEATURE_PUBLIC_DEMO=true`) :

- Email : `patron@garage-caraibes-auto.example`
- Mot de passe : `Tradikom!2026`
- Site local : `/sites/garage-caraibes-auto`

Le seed et ces identifiants partages sont refuses en production.

## Commandes

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm db:verify
pnpm db:reset
```

PostgreSQL 17 est le runtime de production. PGlite reste un mode local borne; il ne remplace ni les migrations, ni les tests RLS PostgreSQL de la CI.

## Phase 2

La Phase 2 est fusionnee dans `main` par la PR #1. Elle apporte PostgreSQL, RLS, sessions hashees/revocables, workflows durables, webhooks securises, connecteurs bornes et publication par snapshots immuables. Voir `docs/PHASE_2_IMPLEMENTATION.md`.

## Phase 3

La Phase 3 est fusionnee dans `main` par la PR #3. API Intelligence accepte uniquement des sources officielles explicitement approuvees, importe des contrats bornes, conserve les preuves et genere des propositions de connecteurs toujours desactivees. Voir `docs/PHASE_3_API_INTELLIGENCE.md` et `docs/API_SECURITY_MODEL.md`.

## Limites de production

- Aucun connecteur genere n'est active en production.
- Aucun test de contrat n'effectue d'ecriture sandbox ou reelle.
- SMS et WhatsApp restent des actions simulees.
- La decouverte Internet generale est desactivee.
- Un fournisseur email de production doit etre configure; le fournisseur console n'est pas accepte par defaut en production.
- La checklist complete est dans `docs/PRODUCTION_READINESS.md`.
