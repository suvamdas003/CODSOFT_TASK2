# Payments

## Principles

- **Order status ≠ payment status.** `orders.status` tracks preparation;
  `orders.paymentStatus` (`UNPAID`/`PAID`/`REFUNDED`) summarises the
  `payments` rows.
- **Nothing is marked paid without proof.** Online payments become `PAID` only
  from a signature-verified webhook or a direct server-to-server query to the
  provider. The browser redirect after checkout is never trusted.
- **No card data.** Customers pay on the provider's hosted page. DineDesk stores
  only the provider's object ids, amounts, currency and status.
- **Manual payments are labelled as manual.** Cash and counter payments are
  recorded by an admin, stored with provider `MANUAL`, the admin's id and a
  reference, and shown as “Recorded manually by staff — not an online
  transaction”.

## Payment methods

Configured under **Admin → Settings → Payment methods offered**:

| Method | Provider | How it is settled |
| ------ | -------- | ----------------- |
| `CASH` — pay at restaurant | `MANUAL` | An admin opens the order and uses **Mark as paid (manual)**. |
| `ONLINE_CARD` — pay online | `STRIPE` | Stripe Checkout + verified webhook. Hidden from customers until Stripe is configured. |

Every order gets a `PENDING` payment row at checkout for its total. Cancelling
an order voids pending payments. Refunds are recorded with **Mark refunded**;
for Stripe payments, issue the actual refund in the Stripe Dashboard first.
If an online payment arrives for an order that was already cancelled, the
payment is still recorded and an audit event flags that a refund is needed.

## Provider interface

`src/server/payments/types.ts` defines `OnlinePaymentProvider`:

```ts
createCheckout(params) → { providerRef, redirectUrl }
retrieveCheckout(providerRef) → VerifiedCheckoutState
verifyWebhook(rawBody, headers) → VerifiedWebhookEvent   // throws if the signature is invalid
```

`src/server/payments/stripe.ts` implements it against the Stripe REST API with
`fetch` (no SDK). To add another provider, implement the interface, add an enum
value to `PaymentProvider`, and return it from `getOnlinePaymentProvider()`.

## Enabling Stripe in test mode (sandbox)

1. Create a Stripe account and switch the Dashboard to **Test mode**.
2. Copy the **test** secret key (`sk_test_…`) into `.env` as `STRIPE_SECRET_KEY`.
3. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and log in:

   ```bash
   stripe login
   ```

4. Forward webhooks to your local server (port 3000 for `npm run dev`, 8080 for the Docker stack):

   ```bash
   stripe listen --forward-to localhost:3000/api/payments/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired
   ```

   Copy the printed signing secret (`whsec_…`) into `.env` as
   `STRIPE_WEBHOOK_SECRET` (in `.env`, or `.env.production` for Docker), then restart `npm run dev` / run `docker compose up -d`.

5. Make sure **ONLINE_CARD** is enabled in Admin → Settings, then place an order
   choosing **Pay online by card**. Pay with Stripe's test card
   `4242 4242 4242 4242`, any future expiry date and any CVC (entered on
   Stripe's page, never in DineDesk).
6. After the redirect, the order page asks Stripe for the session status, and
   the webhook marks the payment `PAID`. The UI shows “Stripe test mode” next to
   the payment option while a `sk_test_` key is configured.

For production, register `https://<your-domain>/api/payments/stripe/webhook` in
the Stripe Dashboard with the four events above and use live keys.

> Stripe amounts are in the currency's smallest unit, which matches DineDesk's
> minor units for most currencies. Check
> [Stripe's currency list](https://docs.stripe.com/currencies) for special cases
> before using an unusual currency.

## Webhook handling

`POST /api/payments/stripe/webhook`:

1. Returns 503 if Stripe is not configured; rejects bodies over 256 KB.
2. Verifies `Stripe-Signature` (HMAC-SHA256, constant-time compare, 5-minute
   timestamp tolerance). Invalid → 400.
3. In one transaction: inserts the event id into `webhook_events`
   (`ON CONFLICT DO NOTHING`). If it already exists, the event is acknowledged
   as a duplicate and nothing else happens.
4. For checkout events: finds the payment by `metadata.paymentId`, checks the
   session id, **compares amount and currency** with the stored payment
   (a mismatch marks the payment `FAILED` and is logged), then updates the
   payment and order conditionally so repeated or concurrent deliveries are
   harmless.
5. On an unexpected error, returns 500 so Stripe retries. The event id is not
   kept because the transaction rolled back.

These behaviours are covered by `tests/unit/stripe-signature.test.ts` and
`tests/integration/payments.test.ts`. The integration tests use the real
signature verification with network calls replaced by an in-memory fake.

## What was not verified here

A live round trip against Stripe's servers needs your own test-mode keys, so it
has not been run as part of this project's automated checks. Follow the steps
above to try it end to end.
