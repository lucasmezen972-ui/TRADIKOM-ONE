# Local Development

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Si la base locale doit etre reconstruite :

```bash
pnpm db:reset
pnpm db:migrate
pnpm db:seed
```

Docker n'est pas requis pour le MVP local. `docker-compose.yml` documente le chemin Postgres futur.

Pour tester le chemin PostgreSQL :

```bash
docker compose up -d
DATABASE_URL=postgres://tradikom:tradikom_local@localhost:5432/tradikom_one pnpm db:migrate
```

Depannage :

- Si le seed existe deja, la commande est idempotente.
- Si un port est occupe, lancer `pnpm dev -- --port 3001`.
- Si les scripts pnpm sont bloques, lancer `pnpm approve-builds --all`.
