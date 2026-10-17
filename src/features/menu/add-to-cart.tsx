"use client";

import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form-controls";
import { Dialog } from "@/components/ui/interactive";
import { cart } from "@/features/cart/cart-store";
import { formatMoney } from "@/lib/money";
import { MAX_LINE_QUANTITY } from "@/lib/validation/order";

type ItemForCart = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  imageUrl: string | null;
  variants: { id: string; name: string; priceDeltaMinor: number }[];
  addOns: { id: string; name: string; priceMinor: number }[];
};

export function AddToCartButton({
  item,
  currency,
  locale,
  disabled,
  disabledLabel,
}: {
  item: ItemForCart;
  currency: string;
  locale: string;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [added, setAdded] = useState(false);

  const variant = item.variants.find((candidate) => candidate.id === variantId) ?? null;
  const selectedAddOns = item.addOns.filter((addOn) => addOnIds.includes(addOn.id));
  const unit = Math.max(
    0,
    item.priceMinor + (variant?.priceDeltaMinor ?? 0) + selectedAddOns.reduce((sum, addOn) => sum + addOn.priceMinor, 0),
  );
  const money = (minor: number) => formatMoney(minor, currency, locale);

  function reset() {
    setVariantId(item.variants[0]?.id ?? null);
    setAddOnIds([]);
    setQuantity(1);
    setNotes("");
    setAdded(false);
  }

  function add() {
    cart.add({
      menuItemId: item.id,
      variantId,
      addOnIds,
      quantity,
      notes: notes.trim() || undefined,
      display: {
        name: item.name,
        variantName: variant?.name ?? null,
        addOnNames: selectedAddOns.map((addOn) => addOn.name),
        unitPriceMinor: unit,
        imageUrl: item.imageUrl,
      },
    });
    setAdded(true);
  }

  if (disabled) {
    return (
      <Button size="sm" variant="outline" disabled>
        {disabledLabel ?? "Unavailable"}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label={`Add ${item.name} to cart`}
      >
        <Plus className="h-4 w-4" aria-hidden /> Add
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={item.name} description={item.description}>
        {added ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Added {quantity} × {item.name} to your cart.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Keep browsing
              </Button>
              <Link href="/cart" className={buttonVariants()}>
                Go to cart
              </Link>
            </div>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            {item.variants.length ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-stone-800">Choose an option</legend>
                <div className="grid gap-2">
                  {item.variants.map((option) => (
                    <label
                      key={option.id}
                      className="has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 flex cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="variant"
                          value={option.id}
                          checked={variantId === option.id}
                          onChange={() => setVariantId(option.id)}
                          className="accent-brand-600"
                        />
                        {option.name}
                      </span>
                      <span className="text-stone-600">{money(item.priceMinor + option.priceDeltaMinor)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {item.addOns.length ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-stone-800">Extras (optional)</legend>
                <div className="grid gap-2">
                  {item.addOns.map((addOn) => (
                    <label
                      key={addOn.id}
                      className="has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 flex cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={addOnIds.includes(addOn.id)}
                          onChange={(event) =>
                            setAddOnIds((ids) => (event.target.checked ? [...ids, addOn.id] : ids.filter((id) => id !== addOn.id)))
                          }
                          className="accent-brand-600"
                        />
                        {addOn.name}
                      </span>
                      <span className="text-stone-600">+{money(addOn.priceMinor)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <Field label="Special instructions" htmlFor={`notes-${item.id}`} hint="Allergies or preferences (max 200 characters).">
              <Textarea id={`notes-${item.id}`} value={notes} maxLength={200} onChange={(event) => setNotes(event.target.value)} rows={2} />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2" role="group" aria-label="Quantity">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <span className="w-8 text-center font-semibold" aria-live="polite">
                  {quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity((value) => Math.min(MAX_LINE_QUANTITY, value + 1))}
                  aria-label="Increase quantity"
                  disabled={quantity >= MAX_LINE_QUANTITY}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button type="submit">Add to cart · {money(unit * quantity)}</Button>
            </div>
            <p className="text-xs text-stone-500">Final prices are confirmed at checkout.</p>
          </form>
        )}
      </Dialog>
    </>
  );
}
