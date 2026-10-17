# DineDesk

Restaurant ordering and table-management platform: digital menu, cart and
checkout, live order tracking, reservations, a kitchen display and an admin
dashboard. One Next.js 16 app + PostgreSQL, with role-based access for
**customers**, **kitchen staff** and **admins** enforced on the server.

Docs: [Deployment (Docker)](docs/DEPLOYMENT.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [Payments](docs/PAYMENTS.md) ·
[Audit report](docs/AUDIT.md)

## Prerequisites

- Node.js **20.9+** (developed on 24 LTS) and npm 10+
- PostgreSQL **13+** (tested on 17) — local install, or Docker Desktop
- Docker Desktop 4.x with Compose v2 — only for the containerised deployment

All commands below are **Windows PowerShell**, run from the project folder.

## Option 1 — Run with Docker (production build)

```powershell
npm run env:init:prod
```

```powershell
docker compose up --build -d
```

Open <http://localhost:8080>. `env:init:prod` creates `.env.production` with
random secrets (no Node? see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Then
either create your own administrator:

```powershell
$env:ADMIN_EMAIL = "you@example.com"; $env:ADMIN_PASSWORD = Read-Host "Admin password (12+ chars)"
```

```powershell
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD migrate npm run admin:create
```

…or load **demo data** into a throwaway stack (accounts below):

```powershell
docker compose --profile demo run --rm seed
```

Port 8080 busy? Set `$env:APP_PORT = "8090"` and change `BETTER_AUTH_URL`/`APP_URL`
in `.env.production` to match. Backups, logs and troubleshooting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Option 2 — Local development

```powershell
npm ci
```

```powershell
npm run env:init
```

```powershell
npm run db:dev:up
```

```powershell
npm run db:deploy
```

```powershell
npm run db:seed
```

```powershell
npm run dev
```

Open <http://localhost:3000>. `db:dev:up` starts a development PostgreSQL in
Docker on port **5433** with `dinedesk`, `dinedesk_test` and `dinedesk_e2e`
databases. Using a locally installed PostgreSQL instead? Create those three
databases (owned by one login role) and point `DATABASE_URL`,
`DATABASE_URL_TEST` and `DATABASE_URL_E2E` in `.env` at them.

If port 3000 is taken, run `npx next dev -p 3100` **and** set `BETTER_AUTH_URL`
and `APP_URL` in `.env` to `http://localhost:3100` (sign-in checks the origin).

## Demo access (local/demo data only)

| Role | Email | Password (from `.env.example`) | Lands on |
| --- | --- | --- | --- |
| Admin | `admin@dinedesk.test` | `DevOnly-Admin-2026!` | `/admin` |
| Kitchen staff | `kitchen@dinedesk.test` | `DevOnly-Kitchen-2026!` | `/kitchen` |
| Customer | `customer@dinedesk.test` | `DevOnly-Customer-2026!` | `/menu` |

These exist only after seeding. The seed refuses to run in production unless
`ALLOW_DEMO_SEED=true` is set explicitly (the Docker `demo` profile does this).
Never seed a real deployment — use `admin:create` instead.

## Environment

| File | Used by | Created from |
| --- | --- | --- |
| `.env` | `npm run dev`, tests, Prisma CLI | `.env.example` via `npm run env:init` |
| `.env.production` | Docker stack | `.env.production.example` via `npm run env:init:prod` |

Both real files are git-ignored and excluded from the Docker build context.
Key variables: `DATABASE_URL` (+ `_TEST`, `_E2E` for the suites),
`BETTER_AUTH_SECRET` (32+ random chars; the app refuses to start in production
with a placeholder), `BETTER_AUTH_URL`/`APP_URL` (the exact URL users open),
optional `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` ([docs/PAYMENTS.md](docs/PAYMENTS.md)).

## Tests and checks

```powershell
npm run lint; npm run typecheck; npm run format:check; npm run db:validate
```

```powershell
npm test
```

```powershell
npm run test:integration
```

```powershell
npx playwright install chromium; npm run test:e2e
```

```powershell
npm run build
```

Integration tests run against the disposable `DATABASE_URL_TEST` database and
end-to-end tests against `DATABASE_URL_E2E` (reset and re-seeded each run, own
dev server on port 3101). Both refuse to run unless the database name contains
`test`/`e2e` and differs from `DATABASE_URL`.

## Open in VS Code and publish to GitHub

```powershell
code .
```

```powershell
git init; git add .; git commit -m "Initial commit: DineDesk"
```

```powershell
git branch -M main; git remote add origin https://github.com/<you>/<repo>.git; git push -u origin main
```

Before pushing, run `git status` and confirm no `.env` or `.env.production` is staged.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `env file ... .env.production not found` | Run `npm run env:init:prod` first. |
| App container exits: "DineDesk configuration problems" | Fix the listed variables in `.env.production` (placeholder secret, non-HTTPS public URL, …). |
| Sign-in fails / “Invalid origin” | `BETTER_AUTH_URL` must exactly match the browser URL, including port. |
| “Too many attempts” on login | Limit is 5 attempts per minute per client; wait a minute. |
| `P1001: Can't reach database server` | Start the database (`npm run db:dev:up` or your local service) and check `.env`. |
| `permission denied to create extension "btree_gist"` | Use PostgreSQL 13+, or run `CREATE EXTENSION btree_gist;` once as superuser. |
| `Cannot find module '@/generated/prisma/client'` | `npm ci` (runs `prisma generate`) or `npm run db:generate`. |
| Port 3000/8080 already in use | See the port notes in Options 1 and 2. |
| Warning “client.query() when the client is already executing a query” | Emitted inside `@prisma/adapter-pg`; harmless. |
