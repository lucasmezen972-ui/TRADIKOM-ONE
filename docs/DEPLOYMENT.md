# Deployment

Chemin recommande :

1. PostgreSQL manage avec migrations `src/db/migrations` et RLS.
2. Variables d'environnement separees par environnement.
3. Secrets stockes hors depot.
4. Workers pour workflows et connecteurs.
5. Observabilite : logs structures, traces, alertes.
6. Build Next.js puis migrations controlees.

Avant production, utiliser exclusivement `DATABASE_URL` avec un role applicatif non proprietaire, executer les migrations avec un role separe et privilegie, conserver `CONNECTOR_ENCRYPTION_KEY` hors depot, et laisser la validation de demarrage refuser toute configuration dangereuse. PostgreSQL permet au proprietaire des tables de contourner RLS par conception : le role web/worker ne doit donc pas etre proprietaire.

Les fournisseurs email externes, SMS, WhatsApp, connecteurs OAuth, stockage d'assets et appels OpenAI reels restent des integrations ulterieures. Les fournisseurs console/test et actions `send_mock_*` ne sont pas des livraisons de production.
