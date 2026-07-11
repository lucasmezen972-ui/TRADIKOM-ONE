# TRADIKOM ONE

TRADIKOM ONE est un MVP SaaS en francais pour les entreprises locales : compte utilisateur, organisation, Business Twin, generation de site, publication locale, formulaire public, CRM, workflow de relance, connecteurs mock, import CSV, webhook, dashboard et audit log.

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
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Demo :

- Email : `patron@garage-caraibes-auto.example`
- Mot de passe : `Tradikom!2026`
- Site local : `/sites/garage-caraibes-auto`

## Commandes

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm db:reset
```

Docker Compose est fourni pour le futur chemin PostgreSQL, mais Docker n'est pas requis pour lancer cette demo locale.

## Phase 2

La branche `codex/phase-2-production-foundation` introduit CI, PostgreSQL, migrations RLS, sessions hashées/révocables, workflow/outbox, SDK connecteurs, abstraction IA, et publication par snapshots immuables. Voir `docs/PHASE_2_IMPLEMENTATION.md`.
