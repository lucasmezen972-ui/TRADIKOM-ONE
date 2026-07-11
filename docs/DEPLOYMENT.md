# Deployment

Chemin recommande :

1. PostgreSQL managé avec migrations `src/db/migrations` et RLS.
2. Variables d'environnement separees par environnement.
3. Secrets stockes hors depot.
4. Workers pour workflows et connecteurs.
5. Stockage objet S3-compatible pour assets.
6. Observabilite : logs structures, traces, alertes.
7. Build Next.js puis migrations controlees.

Avant production, utiliser exclusivement `DATABASE_URL`, verifier les policies RLS avec un role applicatif restreint, ajouter rate limiting distribue et finaliser la rotation de secrets.
