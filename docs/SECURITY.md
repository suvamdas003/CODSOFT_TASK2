# Security

## Authentication and sessions

- **Better Auth** email/password accounts. Passwords are hashed with scrypt;
  length 10–128 characters.
- Sessions are database-backed (revocable), sent as `HttpOnly`, `SameSite=Lax`
  cookies, marked `Secure` whenever `BETTER_AUTH_URL` is `https://`; 7-day
  lifetime, refreshed daily. Production refuses non-HTTPS public URLs other
  than localhost, so real deployments always get `Secure` cookies.
- Deactivating a user deletes their sessions immediately, and a database hook
  blocks new sessions for inactive accounts.
- `role` and `isActive` are declared `input: false`, so sign-up requests cannot
  set them (covered by an integration test).
- Sign-in error messages do not reveal whether an email exists.

## Authorization

- Every page calls `requireUser`/`requireRole`; every server action and API
  route resolves the actor with `getActor(roles)`; every service re-checks with
  `assertRole` (defence in depth). `src/proxy.ts` only does an optimistic
  redirect for signed-out visitors and is **not** relied on for security.
- Role and active status are re-read from the database on each request, so role
  changes take effect immediately.
- **Object-level authorization:** customers can only read or change their own
  orders and reservations. Unauthorized lookups return “not found” so record
  ids cannot be probed. Staff access is role-based.
- Admin-only: menu, prices, tables, staff/roles, settings, discounts, manual
  payments/refunds, reservation status, reports, audit log. Kitchen staff can
  only change preparation status (and cancel orders that have not started).
- Safety rails: admins cannot change their own role or deactivate themselves,
  and the last active admin cannot be removed.

## Input validation and injection

- All untrusted input (forms, action arguments, query strings, route params) is
  parsed with **Zod** on the server. Unknown fields — including any
  client-supplied price or total — are stripped; prices always come from the
  database.
- Database access goes through Prisma's parameterised queries. The few raw SQL
  statements use tagged templates (parameterised); the only `$executeRawUnsafe`
  is the test-database reset helper, which builds table names from
  `pg_tables`.
- Admin-entered image URLs are restricted to `/images/…` paths or `https://`
  URLs. React escapes all rendered text; there is no `dangerouslySetInnerHTML`.
- Post-login redirects (`?next=`) only accept same-site relative paths.

## CSRF

- Server actions: Next.js only accepts POSTs whose `Origin` matches the host.
- Better Auth endpoints: origin check against `BETTER_AUTH_URL`/`TRUSTED_ORIGINS`.
- Cookies are `SameSite=Lax`.
- The Stripe webhook is authenticated by its HMAC signature, not cookies.

## Rate limiting

| What | Limit | Storage |
| ---- | ----- | ------- |
| Sign-in | 5 / minute per client IP | Database (Better Auth) |
| Sign-up | 10 / hour per client IP | Database |
| Other auth endpoints | 100 / minute | Database |
| Place order, reservations, payment start | 10 / minute per user | In-memory (per process) |
| Availability API, cart price quotes | 60 / minute per user or client IP | In-memory |

**Client IP trust.** Next.js passes a client-supplied `X-Forwarded-For` header
through unchanged, so the app must not be exposed directly in production. The
Docker stack puts nginx in front, which **overwrites** `X-Forwarded-For` with
the connecting address; Better Auth and the in-app limiter key on it (the app
uses only the right-most hop). If you add another proxy/load balancer in front
of nginx, list its CIDR in `TRUSTED_PROXY_CIDRS`. Kill switches
(`AUTH_RATE_LIMIT_ENABLED=false`, `APP_RATE_LIMIT_DISABLED=true`) work only
outside production; in production they are rejected at startup.

The in-memory limiter suits a single app instance. For several instances,
replace the `store` in `src/lib/rate-limit.ts` with a shared store (e.g. Redis).

## Payments

No card data ever reaches DineDesk (hosted Stripe Checkout). Webhooks are
signature-verified with a 5-minute replay window, processed idempotently, and
amounts and currencies are compared to the stored payment. See
[PAYMENTS.md](PAYMENTS.md).

## Errors and logging

- Domain errors carry user-safe messages; unexpected errors are logged and
  replaced with a generic message. API errors never include stack traces.
  The error page shows only an opaque digest.
- The JSON logger redacts keys such as `password`, `secret`, `token`,
  `authorization`, `cookie`, `card`, `signature`, `apiKey`.
- Significant admin operations are written to the `audit_events` table
  (Admin → Audit log).

## HTTP headers

`next.config.ts` sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
a restrictive `Permissions-Policy`, and a CSP with `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'` and `form-action` limited to the site
and Stripe Checkout. The `X-Powered-By` header is disabled.

## Secrets and data

- Secrets come only from environment variables. `.env` (development) and
  `.env.production` (Docker) are git-ignored and excluded from the Docker build
  context; only `.env.example` / `.env.production.example` with placeholders are
  distributed. `npm run env:init` / `env:init:prod` generate random secrets.
- **Startup validation** (`src/instrumentation.ts` → `src/lib/env.ts`): in
  production the server refuses to start if `BETTER_AUTH_SECRET` is missing,
  shorter than 32 characters or still the placeholder, if `BETTER_AUTH_URL` is
  invalid or plain HTTP for a non-local host, if only one Stripe secret is set,
  or if a rate-limit kill switch is set.
- The seed creates synthetic data only and refuses to run when
  `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set explicitly. Real
  deployments create their first administrator with `npm run admin:create`
  (12+ character password, read from the environment, audited).
- Secret rotation procedures: [DEPLOYMENT.md](DEPLOYMENT.md#rotating-secrets).
- Integration tests refuse to run unless the test database name contains
  `test` and differs from `DATABASE_URL`.

## Container hardening (docker-compose.yml)

- App runs as the non-root `node` user from a minimal standalone image, with a
  read-only root filesystem, all Linux capabilities dropped and
  `no-new-privileges`. nginx runs unprivileged with the same restrictions.
- PostgreSQL and the app sit on an internal network; only nginx publishes a port.
- Migrations run in a separate one-shot container; the runtime image contains
  no Prisma CLI, compilers or source.

## Production checklist

- `npm run env:init:prod` (fresh random secrets); set `BETTER_AUTH_URL`/`APP_URL`
  to the public **HTTPS** origin and terminate TLS in front of `web`.
- Keep nginx (or another proxy that overwrites `X-Forwarded-For`) in front of the app.
- Do **not** run the demo seed. Create the first admin with `npm run admin:create`.
- Use a database user without superuser rights where your provider allows it;
  `btree_gist` must exist (trusted extension on PostgreSQL 13+).
- Use a shared rate-limit store when running more than one app instance.
- Use live Stripe keys only in production and register the production webhook.
- Schedule encrypted, off-host database backups ([DEPLOYMENT.md](DEPLOYMENT.md#backup-and-restore)).

## Known dependency advisory

`npm audit` reports `braces` (GHSA-vfj7-8cjw-p6xm) through
`eslint-config-next → fast-glob → micromatch`. It is a **development-only**
lint dependency that only processes the project's own glob patterns; no
patched version exists, and `npm audit fix --force` would downgrade the lint
config to Next.js 14 (incompatible). It is not present in the runtime image.
Production dependencies report 0 vulnerabilities (`npm audit --omit=dev`).
