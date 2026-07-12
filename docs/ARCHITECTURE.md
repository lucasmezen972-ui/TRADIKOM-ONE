# Architecture

Le MVP est une application Next.js unique pour reduire le cout de coordination. Les frontieres de packages futures sont preservees dans `src/lib` :

- `db.ts` : adaptateur runtime qui utilise PostgreSQL quand `DATABASE_URL` existe, sinon PGlite local hors production.
- `src/db/` : client PostgreSQL, schema Drizzle, migrations SQL, transaction tenant-aware.
- `services.ts` : couche applicative tenant-aware.
- `src/modules/` : nouveaux modules bornes Phase 2 pour workflows, connecteurs et IA.
- `generation.ts` : Business Twin et generation deterministic fallback.
- `security.ts` : sessions, hash, helpers securite.
- `site-renderer.tsx` : rendu schema-driven du site public et preview.

PostgreSQL est le runtime primaire Phase 2. PGlite reste utile pour la demo locale sans Docker. Le chemin production exige RLS testee avec un role restreint, workers durables, stockage objet et observabilite centralisee.

Les routes Next.js restent fines : elles chargent le contexte, appellent les services et rendent l'UI.
