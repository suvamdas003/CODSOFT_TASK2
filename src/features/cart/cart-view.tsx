"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { OrderType, PaymentMethod } from "@/generated/prisma/enums";
import { MenuImage } from "@/components/shared/menu-image";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, EmptyState, Spinner } from "@/components/ui/display";
import { Field, fieldAria, Input, Select, Textarea } from "@/components/ui/form-controls";
import { cart, useCart } from "@/features/cart/cart-store";
import { placeOrderAction, quoteCartAction } from "@/features/orders/actions";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/utils";
import type { PublicSettings } from "@/server/repositories/settings-repository";
import type { Quote } from "@/server/services/order-service";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Pay at the restaurant (cash / card at counter)",
  ONLINE_CARD: "Pay online by card",
};

const ORDER_TYPE_HELP: Record<OrderType, string> = {
  DINE_IN: "Eat at the restaurant",
  TAKEAWAY: "Collect from the counter",
  DELIVERY: "Delivered to your address",
};

const formSchema = z
  .object({
    type: z.enum(OrderType),
    paymentMethod: z.enum(PaymentMethod),
    contactName: z.string().trim().min(2, "Enter your name.").max(80),
    contactPhone: z
      .string()
      .trim()
      .refine((value) => !value || /^\+?[0-9 ()-]{7,20}$/.test(value), "Enter a valid phone number."),
    deliveryAddress: z.string().trim().max(300),
    tableId: z.string(),
    notes: z.string().trim().max(500),
  })
  .superRefine((value, ctx) => {
    if (value.type === OrderType.DELIVERY) {
      if (value.deliveryAddress.length < 8)
        ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Enter a full delivery address." });
      if (!value.contactPhone)
        ctx.addIssue({ code: "custom", path: ["contactPhone"], message: "A phone number is required for delivery." });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function CartView({
  settings,
  paymentMethods,
  onlineTestMode,
  tables,
  user,
}: {
  settings: PublicSettings;
  paymentMethods: PaymentMethod[];
  onlineTestMode: boolean;
  tables: { id: string; label: string; capacity: number }[];
  user: { name: string; role: string } | null;
}) {
  const router = useRouter();
  const lines = useCart();
  const canOrder = user?.role === "CUSTOMER" || user?.role === "ADMIN";
  // One idempotency key per checkout page visit, reused for retries so a
  // double click or network retry cannot create two orders.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [quoteState, setQuoteState] = useState<{ key: string; quote: Quote | null; error: string | null }>({
    key: "",
    quote: null,
    error: null,
  });
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: settings.enabledOrderTypes[0] ?? OrderType.TAKEAWAY,
      paymentMethod: paymentMethods[0] ?? PaymentMethod.CASH,
      contactName: user?.name ?? "",
      contactPhone: "",
      deliveryAddress: "",
      tableId: "",
      notes: "",
    },
  });
  const orderType = useWatch({ control: form.control, name: "type" });
  const errors = form.formState.errors;

  const cartPayload = useMemo(
    () =>
      lines.map((line) => ({
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        addOnIds: line.addOnIds,
        quantity: line.quantity,
        notes: line.notes,
      })),
    [lines],
  );

  // Server-side re-pricing, keyed by the inputs so "is quoting" is derived state.
  const quoteKey = useMemo(() => JSON.stringify({ cartPayload, orderType, appliedCode }), [cartPayload, orderType, appliedCode]);
  const quoting = cartPayload.length > 0 && quoteState.key !== quoteKey;
  const quote = quoting ? null : quoteState.quote;
  const quoteError = quoting ? null : quoteState.error;

  useEffect(() => {
    if (!cartPayload.length) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await quoteCartAction({ items: cartPayload, type: orderType, discountCode: appliedCode });
      if (cancelled) return;
      setQuoteState(result.ok ? { key: quoteKey, quote: result.data, error: null } : { key: quoteKey, quote: null, error: result.error });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cartPayload, orderType, appliedCode, quoteKey]);

  if (!lines.length) {
    return (
      <EmptyState
        icon={<ShoppingBag className="h-10 w-10" aria-hidden />}
        title="Your cart is empty"
        description="Add a few dishes from the menu to get started."
        action={
          <Link href="/menu" className={buttonVariants()}>
            Browse the menu
          </Link>
        }
      />
    );
  }

  const issuesByIndex = new Map((quote?.issues ?? []).map((issue) => [issue.index, issue.message]));
  const blocked = Boolean(quote?.issues.length) || !settings.acceptingOrders;

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    startSubmit(async () => {
      const result = await placeOrderAction({
        idempotencyKey,
        items: cartPayload,
        type: values.type,
        paymentMethod: values.paymentMethod,
        contactName: values.contactName,
        contactPhone: values.contactPhone,
        deliveryAddress: values.type === OrderType.DELIVERY ? values.deliveryAddress : undefined,
        tableId: values.type === OrderType.DINE_IN ? values.tableId : "",
        notes: values.notes,
        discountCode: appliedCode,
      });
      if (!result.ok) {
        setSubmitError(result.error);
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in values) form.setError(field as keyof FormValues, { message: messages[0] });
        }
        return;
      }
      cart.clear();
      if (result.data.redirectUrl) {
        window.location.assign(result.data.redirectUrl);
        return;
      }
      const params = new URLSearchParams({ placed: "1" });
      if (result.data.paymentError) params.set("paymentError", "1");
      router.push(`/orders/${result.data.orderId}?${params.toString()}`);
    });
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Items" description={`${lines.reduce((sum, line) => sum + line.quantity, 0)} item(s)`} />
          <ul className="divide-y divide-stone-100">
            {lines.map((line, index) => {
              const issue = issuesByIndex.get(index);
              const serverLine = quote && !issue ? quote.lines[index - [...issuesByIndex.keys()].filter((i) => i < index).length] : null;
              return (
                <li key={line.key} className="flex gap-4 px-5 py-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                    <MenuImage src={line.display.imageUrl} alt="" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-stone-900">{line.display.name}</p>
                        {line.display.variantName ? <p className="text-sm text-stone-600">{line.display.variantName}</p> : null}
                        {line.display.addOnNames.length ? (
                          <p className="text-sm text-stone-600">+ {line.display.addOnNames.join(", ")}</p>
                        ) : null}
                        {line.notes ? <p className="text-sm text-stone-500 italic">“{line.notes}”</p> : null}
                      </div>
                      <p className="font-medium whitespace-nowrap text-stone-900">
                        {serverLine ? money(serverLine.lineTotalMinor) : money(line.display.unitPriceMinor * line.quantity)}
                      </p>
                    </div>
                    {issue ? (
                      <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-sm text-red-700">
                        {issue}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Decrease quantity of ${line.display.name}`}
                        onClick={() => cart.setQuantity(line.key, line.quantity - 1)}
                      >
                        <Minus className="h-4 w-4" aria-hidden />
                      </Button>
                      <span className="w-8 text-center text-sm font-semibold">{line.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Increase quantity of ${line.display.name}`}
                        onClick={() => cart.setQuantity(line.key, line.quantity + 1)}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" className="ml-auto text-red-700" onClick={() => cart.remove(line.key)}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Remove
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {user && !canOrder ? (
          <Alert tone="info" title="Staff accounts cannot place orders">
            Sign in with a customer account to check out.
          </Alert>
        ) : user ? (
          <Card>
            <CardHeader title="Checkout details" description="We only ask for what we need to prepare your order." />
            <CardBody>
              <form id="checkout-form" onSubmit={onSubmit} className="grid gap-5" noValidate>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-stone-800">How would you like your order?</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {settings.enabledOrderTypes.map((type) => (
                      <label
                        key={type}
                        className="has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 cursor-pointer rounded-lg border border-stone-200 px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <input type="radio" value={type} {...form.register("type")} className="accent-brand-600" />
                          {humanize(type)}
                        </span>
                        <span className="mt-0.5 block text-xs text-stone-500">{ORDER_TYPE_HELP[type]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name for the order" htmlFor="contactName" error={errors.contactName?.message} required>
                    <Input
                      {...fieldAria("contactName", errors.contactName?.message)}
                      autoComplete="name"
                      {...form.register("contactName")}
                    />
                  </Field>
                  <Field
                    label="Phone"
                    htmlFor="contactPhone"
                    error={errors.contactPhone?.message}
                    required={orderType === OrderType.DELIVERY}
                    hint={orderType === OrderType.DELIVERY ? "Required for delivery." : "Optional — so we can reach you about your order."}
                  >
                    <Input
                      {...fieldAria("contactPhone", errors.contactPhone?.message)}
                      type="tel"
                      autoComplete="tel"
                      {...form.register("contactPhone")}
                    />
                  </Field>
                </div>

                {orderType === OrderType.DELIVERY ? (
                  <Field label="Delivery address" htmlFor="deliveryAddress" error={errors.deliveryAddress?.message} required>
                    <Textarea
                      {...fieldAria("deliveryAddress", errors.deliveryAddress?.message)}
                      autoComplete="street-address"
                      rows={2}
                      {...form.register("deliveryAddress")}
                    />
                  </Field>
                ) : null}

                {orderType === OrderType.DINE_IN && tables.length ? (
                  <Field label="Table (optional)" htmlFor="tableId" hint="Choose your table if you are already seated.">
                    <Select id="tableId" {...form.register("tableId")}>
                      <option value="">I&apos;m not seated yet</option>
                      {tables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.label} (seats {table.capacity})
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                <Field label="Order notes (optional)" htmlFor="notes" error={errors.notes?.message}>
                  <Textarea {...fieldAria("notes", errors.notes?.message)} rows={2} maxLength={500} {...form.register("notes")} />
                </Field>

                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-stone-800">Payment</legend>
                  {paymentMethods.length === 0 ? (
                    <Alert tone="warning">No payment method is currently available. Please contact the restaurant.</Alert>
                  ) : (
                    <div className="grid gap-2">
                      {paymentMethods.map((method) => (
                        <label
                          key={method}
                          className="has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"
                        >
                          <input type="radio" value={method} {...form.register("paymentMethod")} className="accent-brand-600" />
                          {PAYMENT_LABELS[method]}
                          {method === "ONLINE_CARD" && onlineTestMode ? (
                            <span className="ml-auto text-xs font-medium text-amber-700">Stripe test mode</span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-stone-500">
                    Card details are entered on the payment provider&apos;s secure page — DineDesk never sees or stores them.
                  </p>
                </fieldset>
              </form>
            </CardBody>
          </Card>
        ) : (
          <Alert tone="info" title="Sign in to place your order">
            <p>Your cart is saved on this device.</p>
            <div className="mt-3 flex gap-2">
              <Link href="/login?next=/cart" className={buttonVariants({ size: "sm" })}>
                Sign in
              </Link>
              <Link href="/register?next=/cart" className={buttonVariants({ size: "sm", variant: "outline" })}>
                Create account
              </Link>
            </div>
          </Alert>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader title="Order summary" action={quoting ? <Spinner label="Updating prices" /> : null} />
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <label htmlFor="discountCode" className="sr-only">
                Discount code
              </label>
              <Input
                id="discountCode"
                placeholder="Discount code"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                maxLength={32}
              />
              <Button variant="outline" onClick={() => setAppliedCode(codeInput.trim() || undefined)}>
                Apply
              </Button>
            </div>
            {quote?.discountMessage ? (
              <p className="text-sm text-red-700" role="alert">
                {quote.discountMessage}
              </p>
            ) : null}
            {quote?.discountCode ? (
              <p className="text-sm text-emerald-700" role="status">
                Code {quote.discountCode} applied.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setAppliedCode(undefined);
                    setCodeInput("");
                  }}
                >
                  Remove
                </button>
              </p>
            ) : null}

            {quoteError ? <Alert tone="error">{quoteError}</Alert> : null}
            {quote ? (
              <dl className="space-y-2 text-sm">
                <Row label="Subtotal" value={money(quote.totals.subtotalMinor)} />
                {quote.totals.discountMinor ? <Row label="Discount" value={`− ${money(quote.totals.discountMinor)}`} /> : null}
                {quote.totals.serviceChargeMinor ? (
                  <Row label={`Service charge (${settings.serviceChargeBps / 100}%)`} value={money(quote.totals.serviceChargeMinor)} />
                ) : null}
                <Row label={`Tax (${settings.taxRateBps / 100}%)`} value={money(quote.totals.taxMinor)} />
                {quote.totals.deliveryFeeMinor ? <Row label="Delivery fee" value={money(quote.totals.deliveryFeeMinor)} /> : null}
                <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold text-stone-900">
                  <dt>Total</dt>
                  <dd>{money(quote.totals.totalMinor)}</dd>
                </div>
              </dl>
            ) : (
              <Spinner label="Calculating total" />
            )}

            {!settings.acceptingOrders ? <Alert tone="warning">Online ordering is paused right now.</Alert> : null}
            {quote?.issues.length ? <Alert tone="error">Please fix the highlighted items before checking out.</Alert> : null}
            {submitError ? <Alert tone="error">{submitError}</Alert> : null}

            {user && canOrder ? (
              <Button
                type="submit"
                form="checkout-form"
                size="lg"
                className="w-full"
                disabled={blocked || submitting || !quote || paymentMethods.length === 0}
              >
                {submitting ? "Placing order…" : `Place order${quote ? ` · ${money(quote.totals.totalMinor)}` : ""}`}
              </Button>
            ) : null}
            <p className="text-xs text-stone-500">Prices are verified by the restaurant when you place the order.</p>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-stone-700">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
