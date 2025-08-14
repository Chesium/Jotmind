First, Install `pnpm`

# Add `.env` To the root folder

```
DEV_WEB_PORT=4200
DEV_API_PORT=3000
PORT=3000
BETTER_AUTH_SECRET=...
HOST=http://localhost
VITE_API_BASE_URL=http://localhost:3000
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
DOZER_BASE=...
NEO4J_PASSWORD=12345678
```

And `/api/.env.development`

```
BETTER_AUTH_SECRET=...
NEO4J_URL=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=12345678
```

Then, unzip the Neo4j Database File `dozerdata.zip` to `$DOZER_BASE` path. e.g. `A:/T/dozer_1`.

# Development

```powershell
pnpm nx run-many -t serve -p api web
```

Visit `localhost:4200/login`.

# Build Docker Image
```powershell
sha=$(git rev-parse --short HEAD)
docker build -f infra/docker/api.Dockerfile -t myrepo/api:$sha -t myrepo/api:latest .
docker build -f infra/docker/web.Dockerfile -t myrepo/web:$sha -t myrepo/web:latest .

docker compose --env-file .env -f infra/compose/docker-compose.prod.yml up -d
```