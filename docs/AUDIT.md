# Audit report — 2026-10-17

Scope: full source, dependencies/lockfile, Prisma schema/migrations/seed,
authentication, API routes, server actions, services, UI, tests, environment
handling, documentation and deployment. Every item below was checked against
the code; “Evidence” names the test or command that demonstrates the fix.

## Findings and status

| # | Severity | Finding | Status | Evidence |
| - | -------- | ------- | ------ | -------- |
| 1 | High | **Login rate limit bypass / global lockout.** Next.js forwards a client-supplied `X-Forwarded-For` unchanged and Better Auth keys rate limits on it: rotating forged IPs gave unlimited password guesses; unresolvable IPs shared one global bucket. The availability limiter used the forgeable *first* hop. | Fixed: nginx in front of the app overwrites the header; app limiters use only the right-most hop; Better Auth IP header/trusted proxies configured (`TRUSTED_PROXY_CIDRS`). | `tests/unit/environment-and-ip.test.ts`; live: 7 logins with 7 different forged IPs through nginx → `401 401 401 401 429 429 429`. |
| 2 | High | **No production deployment path**: no app image, no migration step, and the only way to obtain an admin was the demo seed (which correctly refuses production). | Fixed: multi-stage `Dockerfile`, `docker-compose.yml` (db/migrate/app/web), `npm run admin:create`, `npm run env:init:prod`. | Clean `docker compose up --build -d` from an empty volume; admin created and signed in; `tests/integration/admin-bootstrap.test.ts`. |
| 3 | High | **First page load on a fresh database returned HTTP 500** — concurrent `getSettings()` calls raced to insert the default settings row (Prisma upsert is not atomic). Found during the clean Docker start. | Fixed: atomic `INSERT … ON CONFLICT DO NOTHING`. | `tests/integration/fresh-database.test.ts` fails on the old code (`restaurant_settings_pkey`) and passes now; all pages 200 on an unseeded Docker stack. |
| 4 | Medium | Paid orders could be cancelled, and a manual payment could race an online payment, with no signal that a refund is owed. | Fixed: audit events `order.cancelled_paid` / `payment.duplicate` and “Refund required” / “Paid more than once” banners on the admin order page. | `tests/integration/payments.test.ts` → “refund safety flags”. |
| 5 | Medium | Rate-limit kill switches (`AUTH_RATE_LIMIT_ENABLED=false`, `APP_RATE_LIMIT_DISABLED=true`) were honoured in production. | Fixed: ignored in production and rejected at startup. | `environment-and-ip.test.ts`. |
| 6 | Medium | Placeholder/short `BETTER_AUTH_SECRET` (e.g. copied from `.env.example`) accepted with a warning; non-HTTPS public URLs allowed in production. | Fixed: startup validation; production exits with code 1 and the reasons. | `environment-and-ip.test.ts`; container started with the placeholder secret exits 1 with “Refusing to start”. |
| 7 | Medium | Public cart-quote server action unthrottled (up to 50 priced lines per call). | Fixed: 60/min per user or client IP. | Code review (server actions cannot be invoked outside a Next request in tests); limiter itself unit-tested. |
| 8 | Medium | `GET /api/orders/<malformed id>` returned 500 and logged an error. | Fixed: 422 validation error. | E2E “a new customer can register…” asserts 422. |
| 9 | Medium | `Secure` cookie flag tied to `NODE_ENV`, not the actual scheme (production over HTTP on a LAN IP silently broke login; HTTPS dev lacked `Secure`). | Fixed: `Secure` iff `BETTER_AUTH_URL` is HTTPS; production requires HTTPS except localhost. | `environment-and-ip.test.ts`; cookie inspected on the Docker stack (`HttpOnly`, not `Secure` on http://localhost). |
| 10 | Medium | E2E tests wrote into the development database and reruns tripped the login limiter. | Fixed: dedicated `DATABASE_URL_E2E`, reset + seeded per run, own server on port 3101, refuses unsafe DB names. | 12/12 E2E passing on consecutive runs. |
| 11 | Medium | `next build` initialised Better Auth without secrets (“default secret” errors in build logs). | Fixed: Better Auth instance created lazily (`getAuth()`). | Docker build log contains no Better Auth errors. |
| 12 | Low | Two admin actions accepted an unvalidated `kind` argument. | Fixed: Zod enum. | Type-checked; code review. |
| 13 | Low | Online-card orders totalling 0 (100 % discount) could never be paid (Stripe rejects 0). | Fixed: rejected at checkout with a clear message; discount redemption rolled back. | `payments.test.ts` → “rejects online payment for orders with nothing to pay”. |
| 14 | Low | Order page kept polling for finished, unpaid cash orders. | Fixed: polls only while preparing or awaiting an online payment. | Code review. |
| 15 | Low | Kitchen staff saw a checkout form that always failed. | Fixed: explanatory notice instead. | E2E “staff accounts are told they cannot check out”. |
| 16 | Low | Reservation helper ignored bookings without an id when no exclusion was given (found in the previous round). | Fixed earlier. | `tests/unit/reservation-slots.test.ts`. |
| 17 | Low | `npm audit`: `braces` (GHSA-vfj7-8cjw-p6xm) via `eslint-config-next`. | **Not fixed** — dev-only lint dependency, no patched release; `npm audit fix --force` would install the incompatible Next 14 config. Not in the runtime image. | `npm audit --omit=dev` → 0 vulnerabilities. |

## Requirements verification

| Area | Result | Evidence |
| ---- | ------ | -------- |
| Registration, login, sessions, logout | Pass | E2E registration + role sign-ins; integration Better Auth tests (wrong password, deactivated user, role cannot be self-assigned, rate limit 429). |
| Menu browsing, search, filters, options, sold-out items | Pass | E2E sold-out flow; `getPublicMenu` integration tests. |
| Cart, server-side pricing, taxes, service charge, delivery fee, discounts | Pass | `pricing.test.ts`; `orders.test.ts` (client prices stripped, DB prices used, snapshots survive price changes, discount limit under concurrency). |
| Duplicate-order prevention | Pass | 5 concurrent submissions with one idempotency key → 1 order. |
| Order history, tracking, receipts, customer isolation | Pass | E2E order/receipt pages; another customer gets 404 (page and API). |
| Reservations: availability, booking, change, cancel, overlap/concurrency | Pass | 6 concurrent bookings for the last table → 1 succeeds; DB exclusion constraint test; E2E change + cancel. |
| Kitchen queue and status transitions | Pass | `order-status.test.ts`; concurrent identical updates → 1 applied; E2E kitchen accept. |
| Admin: menu, categories, tables, staff/roles, settings, reports, audit log | Pass | Integration CRUD + audit events, last-admin protection, currency lock; E2E admin flows; reports checked against stored data. |
| Manual payments and refunds | Pass | `payments.test.ts`; E2E manual payment. |
| Stripe test mode: verified webhooks, idempotency, amount checks | Pass (offline) | Real signature verification with a fake transport; duplicate and concurrent deliveries; amount mismatch → FAILED. **A live Stripe round trip was not run** (needs your test keys — see PAYMENTS.md). |
| Docker: clean start, migrations, health checks, persistence, graceful stop, backup/restore | Pass | Fresh volume start in ~20 s; data unchanged across `down`/`up`; `stop` → exit 143 in ~1 s; backup → mutate → restore verified; E2E 12/12 against the stack. |

## Known limitations (not defects)

- No password reset or email verification — no email provider is configured.
- Availability is a per-item/option flag; stock quantities are not counted.
- Discount redemptions are not returned when an order is cancelled.
- In-memory app rate limits are per instance; use a shared store for several instances.
- On Docker Desktop all host clients may reach nginx from one gateway IP, so they share login rate-limit buckets; real client IPs are used on a Linux host or behind a configured proxy.
- The demo seed leaves existing restaurant settings untouched (it is idempotent).
