First, Install `pnpm`

# Development

```powershell
pnpm nx run-many -t serve -p api web
```

# Build
```powershell
sha=$(git rev-parse --short HEAD)
docker build -f infra/docker/api.Dockerfile -t myrepo/api:$sha -t myrepo/api:latest .
docker build -f infra/docker/web.Dockerfile -t myrepo/web:$sha -t myrepo/web:latest .

docker compose --env-file .env -f infra/compose/docker-compose.prod.yml up -d
```