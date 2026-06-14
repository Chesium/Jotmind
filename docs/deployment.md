# Deployment & operations

JotMind is privacy-first and self-hostable. This guide distinguishes three
deployment modes and the hardening required for public internet exposure.

| Mode                                                             | Audience                         | Network binding             | TLS                           |
| ---------------------------------------------------------------- | -------------------------------- | --------------------------- | ----------------------------- |
| [Local development](#local-development)                          | A developer's machine            | `127.0.0.1` (loopback)      | none                          |
| [Local / LAN production-style](#local--lan-production-style-use) | Home/office machine, trusted LAN | `127.0.0.1`, opt-in LAN     | optional (recommended on LAN) |
| [VPS / cloud self-hosting](#vps--cloud-self-hosting)             | Internet-exposed server          | loopback behind a TLS proxy | **required**                  |

Key safety defaults:

- The API binds to **`127.0.0.1` (loopback) by default**. LAN/public binding is
  an **explicit opt-in** (`HOST` env / `API_BIND` for Compose).
- **CORS is deny-by-default.** Cross-origin requests are rejected unless you set
  an exact `CORS_ALLOWED_ORIGINS` allowlist; the wildcard `*` is never honored
  (it is incompatible with cookie auth).
- All data routes require an **authenticated session**; mutations also require a
  **CSRF token**. (`/api/health` and the first-run setup/login endpoints are
  intentionally reachable without a session.)

---

## Local development

Run the apps directly with hot reload (web on `:5173`, API on `:3001`, with the
Vite dev server proxying `/api` to the API):

```bash
docker compose up -d --build db        # PostgreSQL + AGE + pgvector on 127.0.0.1:5432
cp .env.example .env                   # adjust as needed
pnpm --filter @jotmind/api db:migrate  # create/upgrade the schema
pnpm dev                               # run web + API in parallel
```

Cookies are plain HTTP (`COOKIE_SECURE=false`); do not expose this mode beyond
your machine.

---

## Local / LAN production-style use

### Single-origin via Docker Compose (simplest)

The reference `docker-compose.yml` includes a **stateless Node API container**
that also **serves the built web assets** — open a single origin
(`http://127.0.0.1:3001`) for both the UI and the API:

```bash
docker compose up -d --build          # starts db + api; api runs migrations on boot
# open http://127.0.0.1:3001 and complete first-run admin setup
```

The API container is stateless — all canonical data lives in the `db` service
(`jotmind-db` volume). Back that volume up (see
[backup-restore.md](backup-restore.md)).

### Exposing on the LAN (opt-in)

By default the API port is published only to `127.0.0.1`. To reach it from other
machines on a **trusted** LAN, opt in explicitly:

```bash
API_BIND=0.0.0.0 docker compose up -d
```

Running the API outside Docker binds loopback unless you set `HOST`:

```bash
HOST=0.0.0.0 pnpm --filter @jotmind/api start   # logs a security warning
```

> **Complete first-run admin setup _before_ exposing the API on a LAN.** Until
> the first admin exists, `POST /api/auth/setup` is reachable without auth, so
> anyone who can reach the port could claim the initial admin account.

On a LAN, prefer HTTPS (a reverse proxy or `mkcert`-style certs) and set
`COOKIE_SECURE=true` so session cookies are not sent in clear text.

### Deploying the web app separately (different origin)

The frontend can be deployed as **static assets** pointing at an API on another
origin. The API base URL is configured at **build time**:

```bash
VITE_API_BASE_URL=https://api.example.com pnpm --filter @jotmind/web build
# deploy apps/web/dist to any static host
```

On the API, allow that origin (exact match — no wildcard):

```bash
CORS_ALLOWED_ORIGINS=https://app.example.com
```

> Cookie auth across origins works reliably only when the web app and API are on
> the **same site** (e.g. `app.example.com` + `api.example.com`). For truly
> cross-site static hosting you would need `SameSite=None` cookies over HTTPS,
> which is not enabled by default. The single-origin setup avoids this entirely.

---

## VPS / cloud self-hosting

When exposing JotMind to the public internet, **all** of the following are
required:

- **HTTPS via a trusted TLS reverse proxy** (e.g. Caddy, nginx, Traefik). Bind
  the API to loopback or a private network and let the proxy terminate TLS;
  never publish the raw API port to the internet.
- **Exact `CORS_ALLOWED_ORIGINS`** — list only your real frontend origin(s).
  Never use `*` (it is rejected anyway and breaks cookie auth).
- **`COOKIE_SECURE=true`** (or run with `NODE_ENV=production`) so session/CSRF
  cookies are HTTPS-only.
- **Strong authentication** — set a strong admin password during first-run setup
  and create per-user accounts; do not share accounts.
- **Firewall PostgreSQL.** Never publish the database port publicly; the
  reference Compose binds it to `127.0.0.1` only.
- **Back up the `jotmind-db` volume** regularly (see
  [backup-restore.md](backup-restore.md)).
- **Keep images/packages updated** for security fixes.

Example reverse-proxy shape (Caddy):

```caddy
app.example.com {
  reverse_proxy 127.0.0.1:3001
}
```

With the proxy terminating TLS, run the API bound to loopback
(`HOST=127.0.0.1`) or on the internal Docker network, set `COOKIE_SECURE=true`,
and add the public origin to `CORS_ALLOWED_ORIGINS` only if the frontend is
served from a different origin than the API.

---

## Environment variables

See [`.env.example`](../.env.example) for the full list. Deployment-relevant
ones:

| Variable                | Default              | Purpose                                                                  |
| ----------------------- | -------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`          | —                    | PostgreSQL connection string (AGE + pgvector).                           |
| `HOST`                  | `127.0.0.1`          | API bind address; loopback by default, LAN/public is an explicit opt-in. |
| `PORT`                  | `3001`               | API port.                                                                |
| `WEB_DIST_PATH`         | unset                | Directory of built web assets to serve single-origin; unset = JSON only. |
| `CORS_ALLOWED_ORIGINS`  | empty                | Comma-separated exact-match allowlist; empty = same-origin only.         |
| `COOKIE_SECURE`         | `false`              | Mark cookies `Secure` (HTTPS-only); set `true` behind TLS.               |
| `WORKER_INLINE`         | `false`              | Run the durable-jobs worker in-process (Compose sets `true`).            |
| `API_BIND` / `API_PORT` | `127.0.0.1` / `3001` | Docker Compose host binding for the API service.                         |
| `VITE_API_BASE_URL`     | empty                | **Build-time** API base URL for separately-deployed static web assets.   |
