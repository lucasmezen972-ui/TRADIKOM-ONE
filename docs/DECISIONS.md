# Decisions

## ADR-001 : Application unique pour Phase 1

Decision : demarrer avec une application Next.js unique. Raison : workspace vide, MVP vertical slice prioritaire. Les frontieres restent explicites dans `src/lib`.

## ADR-002 : PGlite pour la demo locale

Decision : utiliser PGlite local. Raison : Docker absent dans l'environnement courant, mais besoin de SQL et migrations proches de Postgres.

## ADR-003 : Generation deterministic fallback

Decision : generer Business Twin et site sans API IA. Raison : le MVP doit fonctionner sans credentials payants. L'architecture prepare un provider OpenAI futur.

## ADR-004 : Workflow durable Phase 2

Decision : persister les definitions, executions, reprises et evenements avant traitement par un worker durable. Raison : idempotence, retries, approbations, reprise apres redemarrage et visibilite dead-letter sans chemin special cache.
