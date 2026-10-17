# Database

PostgreSQL via Prisma 7 (`prisma/schema.prisma`, driver adapter
`@prisma/adapter-pg`). Connection settings come from `prisma.config.ts` →
`DATABASE_URL`.

## Conventions

- **Money** is stored as integers in **minor units** (`*Minor` columns, e.g.
  paise/cents). The number of minor digits comes from the ISO 4217 currency via
  `Intl`, so zero-decimal currencies (JPY) work. The restaurant currency is in
  `restaurant_settings.currency` and is **snapshotted** onto every order and
  payment. Changing currency is blocked while priced menu items exist.
- **Rates** (tax, service charge, percentage discounts) are **basis points**
  (`500` = 5 %). Rounding is half-up on integers.
- **Times** are stored in UTC. Reservation `startsAt`/`endsAt` are
  `timestamptz`. Opening hours are minutes after local midnight in the
  restaurant time zone.
- IDs are CUIDs (strings); `orders.orderNumber` is a sequential integer shown
  as `DD-000123`.

## Models

| Model | Purpose / notable fields |
| ----- | ------------------------ |
| `User`, `Session`, `Account`, `Verification`, `RateLimit` | Better Auth tables. `User.role` (`CUSTOMER`/`KITCHEN_STAFF`/`ADMIN`), `User.isActive`. Passwords are scrypt hashes in `Account.password`. |
| `MenuCategory` | Name/slug unique, `isActive`, sort order. |
| `MenuItem` | `priceMinor`, `dietaryLabels[]`, `isPublished` (visible), `isAvailable` (orderable), `isFeatured`, soft delete via `archivedAt`. |
| `ItemVariant` | Mutually exclusive options; `priceDeltaMinor` (may be negative). Unique per item by name. |
| `AddOn` | Optional extras with `priceMinor`. Unique per item by name. |
| `RestaurantTable` | `label` unique, `capacity`, `isActive`. |
| `Reservation` | `code` unique, table, party size, `startsAt`/`endsAt`, status `PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW`. |
| `Order` | `type`, `status`, **separate** `paymentStatus`, totals breakdown, applied rates, discount code, `idempotencyKey`, per-status timestamps. |
| `OrderItem` | **Snapshot** of name, option, add-ons (JSON), base/unit/line prices, quantity, notes. `menuItemId` is kept for reporting but set to `NULL` if an item is ever hard-deleted. |
| `OrderStatusEvent` | Status history with actor and timestamp. |
| `Payment` | Provider (`MANUAL`/`STRIPE`), method, status `PENDING/PAID/FAILED/CANCELLED/REFUNDED`, amount, currency, provider reference, transaction reference, who recorded it. |
| `WebhookEvent` | Processed provider event ids (idempotency). |
| `DiscountCode` | `PERCENT` (bps) or `FIXED` (minor units), min subtotal, cap, date window, usage limit and counter. |
| `RestaurantSettings` | Singleton row (`id = 1`). |
| `OpeningHours` | One row per weekday (0 = Sunday). |
| `AuditEvent` | Who did what to which entity, with a summary and non-sensitive metadata. |

## Integrity rules

Declared in the schema:

- Unique: user email, category name/slug, item slug, variant/add-on name per
  item, table label, reservation code, order number,
  `(customerId, idempotencyKey)` on orders, `(provider, providerRef)` on
  payments, `(provider, eventId)` on webhook events, discount code.
- Foreign keys with explicit delete policies: categories → items `RESTRICT`;
  items → variants/add-ons `CASCADE`; orders/reservations → users `RESTRICT`
  (users are deactivated, never deleted); order items → menu items `SET NULL`;
  sessions/accounts → users `CASCADE`.
- Indexes for the main queries (orders by status/time and customer,
  reservations by table/time, menu by category).

Added by hand in `prisma/migrations/*_init/migration.sql` (Prisma cannot express
these, and ignores them when diffing):

- `reservations_no_overlap` — `EXCLUDE USING gist (tableId WITH =,
  tstzrange(startsAt, endsAt) WITH &&) WHERE status IN (PENDING, CONFIRMED,
  SEATED)` (requires `btree_gist`).
- CHECK constraints: non-negative prices and amounts, positive quantities,
  capacities and party sizes, `endsAt > startsAt`,
  `orders.totalMinor = subtotal − discount + service + tax + delivery`,
  `order_items.lineTotalMinor = unitPriceMinor × quantity`, percentage
  discounts ≤ 100 %, redemptions ≤ limit, settings singleton and rate ranges,
  valid opening hours.

## Transactions and concurrency

| Operation | Protection |
| --------- | ---------- |
| Order creation | One transaction; idempotency key unique constraint; discount redemption via a conditional `UPDATE … WHERE redemptionCount < maxRedemptions`. |
| Status changes | Conditional `updateMany` on the expected status + status event in the same transaction. |
| Reservations | Per-table row lock (`FOR UPDATE`) + overlap re-check + exclusion constraint. |
| Payments | Webhook event insert (`ON CONFLICT DO NOTHING`) and its effects in one transaction; conditional updates on payment/order status. |
| Staff roles | Advisory lock around “at least one active admin” checks. |

## Workflow

```bash
npm run db:migrate -- --name describe_your_change
```

Edit `schema.prisma`, run the command above to create and apply a migration,
and commit the generated SQL. Use `npm run db:deploy` in CI/production.
`npm run db:validate` checks the schema.

| Database | Purpose |
| --- | --- |
| `DATABASE_URL` (`dinedesk`) | Development data (`npm run dev`, seed). |
| `DATABASE_URL_TEST` (`dinedesk_test`) | Vitest integration suite; tables truncated between tests. |
| `DATABASE_URL_E2E` (`dinedesk_e2e`) | Playwright; reset and re-seeded at the start of every run. |
| Docker `pgdata` volume | Production stack; migrated by the one-shot `migrate` service with `prisma migrate deploy`. |

Production never runs `migrate dev`/`reset`; `migrate deploy` only applies new
migrations. Back up before upgrading ([DEPLOYMENT.md](DEPLOYMENT.md#backup-and-restore)).
