# Deployment with Docker

`docker-compose.yml` is the **production** stack. (`docker-compose.dev.yml`
only provides a development/test database; never use it for real data.)

```
browser ──► web (nginx, published :8080) ──► app (Next.js standalone, :3000)
                                               │
                         migrate (one-shot) ──►├──► db (PostgreSQL 17, volume "pgdata")
```

| Service | Image / target | Role |
| --- | --- | --- |
| `db` | `postgres:17-alpine` | Data in the named volume `dinedesk-prod_pgdata`. Only on the internal `backend` network — not published to the host. |
| `migrate` | `Dockerfile` → `tools` | Runs `prisma migrate deploy` once, then exits. The app waits for it to succeed. Also used for one-off jobs (admin bootstrap). |
| `app` | `Dockerfile` → `runner` | Non-root, read-only filesystem, all capabilities dropped. Health check: `GET /api/health`. Refuses to start with unsafe config. |
| `web` | `nginxinc/nginx-unprivileged` | The only published port (`APP_PORT`, default 8080). Overwrites `X-Forwarded-For` so rate limits use the real client IP. |
| `seed` | `tools`, profile `demo` | Optional demo data; never runs unless requested. |

All commands are Windows PowerShell from the project folder.

## 1. Configure

```powershell
npm run env:init:prod
```

This creates `.env.production` from `.env.production.example` with a random
`BETTER_AUTH_SECRET` and database password. Without Node.js on the host:

```powershell
docker run --rm -v "${PWD}:/w" -w /w node:24-bookworm-slim node scripts/init-env.mjs --production
```

Edit `.env.production` if needed:

- `BETTER_AUTH_URL` and `APP_URL` — exactly the URL users open. Use `https://`
  for anything other than localhost (the app refuses plain HTTP for non-local
  hosts in production). Put a TLS-terminating proxy or load balancer in front
  of `web` for real deployments, and add its CIDR to `TRUSTED_PROXY_CIDRS`.
- `STRIPE_*` — optional, see [PAYMENTS.md](PAYMENTS.md).

`.env.production` is git-ignored and excluded from the build context by
`.dockerignore`; secrets are passed only at runtime and never baked into images.

## 2. Start

```powershell
docker compose up --build -d
```

```powershell
docker compose ps
```

Startup order is enforced with health checks: `db` healthy → `migrate`
completed → `app` healthy → `web`. The site is at <http://localhost:8080>
(or your `APP_PORT`).

## 3. First administrator

```powershell
$env:ADMIN_EMAIL = "owner@example.com"; $env:ADMIN_PASSWORD = Read-Host "Admin password (12+ chars)"
```

```powershell
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD migrate npm run admin:create
```

`-e NAME` without a value forwards the variable from your session, so the
password never appears on the command line. Add `-e ADMIN_PROMOTE_EXISTING=true`
(with `$env:ADMIN_PROMOTE_EXISTING = "true"`) to promote an existing account.
Further staff are created in **Admin → Staff & users**.

## 4. Demo data (evaluation only)

```powershell
docker compose --profile demo run --rm seed
```

Loads the synthetic menu, tables and the three demo accounts listed in the
README. It needs the explicit `ALLOW_DEMO_SEED=true` opt-in that this profile
sets; never run it against real data.

## Updates and migrations

```powershell
docker compose up --build -d
```

Rebuilding re-runs `migrate`, which applies only new migrations (`prisma migrate
deploy` never resets data). Take a backup first.

## Logs

```powershell
docker compose logs -f app
```

```powershell
docker compose logs --tail 100 migrate db web
```

The app writes one JSON object per line with secrets redacted. Docker keeps up
to 3 × 10 MB per container (`json-file` rotation).

## Backup and restore

Back up to a file on the host (custom format; written inside the container
first so PowerShell does not re-encode the binary stream):

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
```

```powershell
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/dinedesk.dump'
```

```powershell
docker compose cp db:/tmp/dinedesk.dump "backups/dinedesk-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```

Restore (replaces current data — stop the app first):

```powershell
docker compose stop app web
```

```powershell
docker compose cp backups/<file>.dump db:/tmp/restore.dump
```

```powershell
docker compose exec db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restore.dump'
```

```powershell
docker compose start app web
```

`backups/` and `*.dump` are git-ignored. Store backups encrypted and off the host.

## Stop, restart, remove

| Command | Effect |
| --- | --- |
| `docker compose stop` | Stops containers gracefully (SIGTERM, 30 s grace period). Data kept. |
| `docker compose up -d` | Starts again; data persists in the `pgdata` volume. |
| `docker compose down` | Removes containers and networks. **Data kept.** |
| `docker compose down -v` | **Deletes the database volume.** Only for throwaway stacks. |

## Rotating secrets

- **`BETTER_AUTH_SECRET`**: generate a new value
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`),
  put it in `.env.production`, run `docker compose up -d`. Then sign everyone
  out by clearing sessions:
  `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM sessions;"'`.
- **Database password**: change it inside PostgreSQL first
  (`ALTER ROLE dinedesk WITH PASSWORD '...'` via `docker compose exec db psql ...`),
  then update both `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env.production`
  and run `docker compose up -d`. (`POSTGRES_PASSWORD` is only applied by the
  image when the volume is first initialised.)
- **Stripe keys**: roll them in the Stripe Dashboard, update `.env.production`,
  `docker compose up -d`.
- **Demo passwords** in `.env.example` are public by design — never use them
  outside local development. If a demo account exists in a real deployment,
  deactivate it in Admin → Staff & users.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `env file ... .env.production not found` | Run step 1. |
| `app` restarts; log says “DineDesk configuration problems” | Fix the listed settings in `.env.production`, then `docker compose up -d`. |
| `migrate` exited with an error | `docker compose logs migrate`. Usually a wrong `DATABASE_URL` password (must match `POSTGRES_PASSWORD`). |
| `password authentication failed` after changing `POSTGRES_PASSWORD` | The volume keeps the old password; see “Rotating secrets”. |
| Port 8080 already allocated | `$env:APP_PORT = "8090"`, update `BETTER_AUTH_URL`/`APP_URL`, `docker compose up -d`. |
| Sign-in returns 403 / “Invalid origin” | `BETTER_AUTH_URL` must match the browser URL exactly (scheme, host, port). |
| Build fails fetching fonts or packages | The build needs internet access (npm registry, Google Fonts). Retry or configure your proxy. |
| All users share one login rate-limit bucket | Docker Desktop may present every host client with the same gateway IP. On a Linux server, or behind a proxy listed in `TRUSTED_PROXY_CIDRS`, real client IPs are used. |
