# Architecture

DineDesk is one Next.js 16 App Router application. There is no separate
backend server: React Server Components render pages, **server actions**
handle form mutations, and a few **route handlers** serve polling endpoints,
authentication and the payment webhook. All of them call the same server-side
service layer.

```
Browser ──► nginx (Docker; overwrites X-Forwarded-For) ──► proxy.ts (optimistic “signed in?” redirect only)
   │
   ├─► Server Components (pages) ─┐
   ├─► Server Actions  ───────────┼─► session.ts (who?) ─► services (may they? + business rules) ─► Prisma ─► PostgreSQL
   └─► Route Handlers (/api/*) ───┘                          │
                                                             └─► payments/ provider (Stripe REST)
```

## Layers

| Layer | Location | Responsibility |
| ----- | -------- | -------------- |
| Pages & layouts | `src/app/**` | Fetch data via services/repositories, render UI, call `requireUser`/`requireRole` for redirects. |
| Feature UI + actions | `src/features/<feature>/` | Client components and `"use server"` actions. Actions: resolve the actor → rate-limit → validate with Zod → call a service → `revalidatePath`. They return a typed `ActionResult` with safe messages only. |
| Services | `src/server/services/` | All business rules and authorization (`assertRole`, ownership). Each takes an explicit `Actor`, which makes them directly testable. Writes run in transactions. |
| Pure domain logic | `pricing.ts`, `order-status.ts`, `reservation-slots.ts` | No I/O; unit tested. |
| Repositories | `src/server/repositories/` | Shared read models (public menu, settings). |
| Payments | `src/server/payments/` | `OnlinePaymentProvider` interface and the Stripe implementation (plain `fetch`, no SDK). |
| Infrastructure | `src/lib/` | Prisma client, Better Auth, session helpers, Zod schemas, money/time helpers, errors, logger, rate limiter. |

Business logic lives only in services — the kitchen board, admin pages and
customer pages all use the same `updateOrderStatus`, `createOrder`, etc.

## Key flows

**Checkout.** The browser keeps a cart of ids + quantities in `localStorage`.
The cart page calls `quoteCartAction`, which re-prices every line from the
database and reports per-line issues (sold out, missing option…). Placing the
order sends ids, quantities, contact details and a client-generated
**idempotency key**. `createOrder` re-validates everything inside one
transaction, consumes a discount redemption atomically, computes totals with
integer maths, snapshots item names/prices, writes the first status event and a
`PENDING` payment record. A unique `(customerId, idempotencyKey)` constraint
turns double submissions into a lookup of the original order.

**Order status.** `order-status.ts` defines the state machine
(PENDING → CONFIRMED → PREPARING → READY → COMPLETED, CANCELLED before READY)
and which role may make which move. Updates use optimistic concurrency
(`UPDATE … WHERE id = ? AND status = expected`), so two kitchen screens
pressing the same button produce one change and one “already updated” message.

**Live updates.** The order page polls `GET /api/orders/:id` every 10 s and
calls `router.refresh()` only when the status changes; the kitchen display
polls `GET /api/kitchen/orders` every 5 s. Polling pauses while the tab is
hidden. This is simple, works behind any proxy and needs no extra
infrastructure; WebSockets/SSE could replace it later without touching services.

**Reservations.** Availability is computed by a pure function from opening
hours (restaurant time zone), booking length, slot interval, lead time, active
tables and existing bookings. Booking tries candidate tables smallest-first;
each attempt locks the table row (`SELECT … FOR UPDATE`), re-checks overlaps and
inserts. A PostgreSQL **exclusion constraint** guarantees no overlap even if
application checks were bypassed.

**Payments.** Order status and payment status are separate fields. Cash
payments are recorded manually by an admin. Online payments go through a hosted
Stripe Checkout page and are marked paid only from a signature-verified webhook
or a server-side query to Stripe — never from the browser redirect. See
[PAYMENTS.md](PAYMENTS.md).

## Rendering model

Next.js 16 enables Cache Components by default in new projects. DineDesk turns
it off and marks the root layout `dynamic = "force-dynamic"`: nearly every page
depends on the signed-in user or live records, and fully dynamic rendering keeps
authorization simple and avoids serving stale prices or statuses.

## Configuration

- Environment variables: see `.env.example`.
- Restaurant settings (currency, locale, time zone, tax, service charge,
  delivery fee, order types, payment methods, cancellation window, reservation
  rules, kitchen “late” threshold) live in the `restaurant_settings` table and
  are edited under **Admin → Settings**.
- Startup validation of security-relevant variables: `src/instrumentation.ts`.
- Deployment: multi-stage `Dockerfile` (`runner` and `tools` targets) and
  `docker-compose.yml` — see [DEPLOYMENT.md](DEPLOYMENT.md).
