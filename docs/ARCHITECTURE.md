# Architecture

Le MVP est une application Next.js unique pour reduire le cout de coordination. Les frontieres de packages futures sont preservees dans `src/lib` :

- `db.ts` : PGlite local et migrations.
- `services.ts` : couche applicative tenant-aware.
- `generation.ts` : Business Twin et generation deterministic fallback.
- `security.ts` : sessions, hash, helpers securite.
- `site-renderer.tsx` : rendu schema-driven du site public et preview.

PGlite est choisi pour executer le MVP sans Docker dans cet environnement. Le chemin production cible PostgreSQL avec RLS, workers separes, stockage objet, queue et observabilite centralisee.

Les routes Next.js restent fines : elles chargent le contexte, appellent les services et rendent l'UI.
