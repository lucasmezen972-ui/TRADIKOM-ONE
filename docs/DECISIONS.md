# Decisions

## ADR-001 : Application unique pour Phase 1

Decision : demarrer avec une application Next.js unique. Raison : workspace vide, MVP vertical slice prioritaire. Les frontieres restent explicites dans `src/lib`.

## ADR-002 : PGlite pour la demo locale

Decision : utiliser PGlite local. Raison : Docker absent dans l'environnement courant, mais besoin de SQL et migrations proches de Postgres.

## ADR-003 : Generation deterministic fallback

Decision : generer Business Twin et site sans API IA. Raison : le MVP doit fonctionner sans credentials payants. L'architecture prepare un provider OpenAI futur.

## ADR-004 : Workflow synchrone MVP

Decision : executer le workflow de lead dans la meme transaction applicative logique. Raison : demonstrabilite locale. Les tables preparent worker, retries et dead-letter.
