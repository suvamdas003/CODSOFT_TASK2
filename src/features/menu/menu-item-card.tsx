import { Badge } from "@/components/ui/display";
import { MenuImage } from "@/components/shared/menu-image";
import { AddToCartButton } from "@/features/menu/add-to-cart";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/utils";
import type { PublicMenuItem } from "@/server/repositories/menu-repository";
import type { PublicSettings } from "@/server/repositories/settings-repository";

export function MenuItemCard({ item, settings }: { item: PublicMenuItem; settings: PublicSettings }) {
  const fromPrice = item.variants.length
    ? Math.min(...item.variants.map((variant) => item.priceMinor + variant.priceDeltaMinor))
    : item.priceMinor;
  const soldOut = !item.isAvailable;

  return (
    <article
      className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
      aria-labelledby={`item-${item.id}`}
    >
      <div className="relative aspect-[4/3] bg-stone-100">
        <MenuImage src={item.imageUrl} alt={item.name} className={soldOut ? "opacity-60 grayscale" : undefined} />
        {soldOut ? (
          <span className="absolute top-3 left-3 rounded-full bg-stone-900/85 px-2.5 py-1 text-xs font-semibold text-white">Sold out</span>
        ) : item.isFeatured ? (
          <span className="text-brand-700 absolute top-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold">
            Chef&apos;s pick
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 id={`item-${item.id}`} className="font-semibold text-stone-900">
            {item.name}
          </h3>
          <p className="font-semibold whitespace-nowrap text-stone-900">
            {item.variants.length > 1 ? <span className="mr-1 text-xs font-normal text-stone-500">from</span> : null}
            {formatMoney(fromPrice, settings.currency, settings.locale)}
          </p>
        </div>
        <p className="mt-1 line-clamp-3 text-sm text-stone-600">{item.description}</p>
        {item.dietaryLabels.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Dietary information">
            {item.dietaryLabels.map((label) => (
              <li key={label}>
                <Badge tone={label === "SPICY" ? "red" : label === "VEGAN" || label === "VEGETARIAN" ? "green" : "neutral"}>
                  {humanize(label)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="text-xs text-stone-500">{item.prepTimeMinutes ? `~${item.prepTimeMinutes} min` : null}</span>
          <AddToCartButton
            item={{
              id: item.id,
              name: item.name,
              description: item.description,
              priceMinor: item.priceMinor,
              imageUrl: item.imageUrl,
              variants: item.variants,
              addOns: item.addOns,
            }}
            currency={settings.currency}
            locale={settings.locale}
            disabled={soldOut || !settings.acceptingOrders}
            disabledLabel={soldOut ? "Sold out" : "Ordering paused"}
          />
        </div>
      </div>
    </article>
  );
}
