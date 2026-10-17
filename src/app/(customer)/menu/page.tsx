import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { DietaryLabel } from "@/generated/prisma/enums";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form-controls";
import { MenuItemCard } from "@/features/menu/menu-item-card";
import { cn, firstParam, humanize } from "@/lib/utils";
import { getPublicMenu } from "@/server/repositories/menu-repository";
import { getSettings, toPublicSettings } from "@/server/repositories/settings-repository";

export const metadata: Metadata = { title: "Menu" };

const filterSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,80}$/)
    .optional()
    .catch(undefined),
  dietary: z.enum(DietaryLabel).optional().catch(undefined),
});

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MenuPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const filters = filterSchema.parse({
    q: firstParam(raw.q) || undefined,
    category: firstParam(raw.category) || undefined,
    dietary: firstParam(raw.dietary) || undefined,
  });
  const [{ categories, allCategories }, settings] = await Promise.all([getPublicMenu(filters), getSettings()]);
  const publicSettings = toPublicSettings(settings);

  const chipHref = (slug?: string) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.dietary) params.set("dietary", filters.dietary);
    if (slug) params.set("category", slug);
    const query = params.toString();
    return query ? `/menu?${query}` : "/menu";
  };
  const hasFilters = Boolean(filters.q || filters.category || filters.dietary);

  return (
    <div>
      <PageHeader title="Our menu" description="Prices include all options shown; tax and any service charge are added at checkout." />

      {!settings.acceptingOrders ? (
        <Alert tone="warning" className="mb-6" title="Online ordering is paused">
          You can browse the menu, but new orders cannot be placed right now.
        </Alert>
      ) : null}

      <form method="get" action="/menu" className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
        <label className="relative block">
          <span className="sr-only">Search dishes</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input name="q" defaultValue={filters.q} placeholder="Search dishes…" className="pl-9" maxLength={60} />
        </label>
        <label>
          <span className="sr-only">Dietary preference</span>
          <Select name="dietary" defaultValue={filters.dietary ?? ""}>
            <option value="">All dietary needs</option>
            {Object.values(DietaryLabel).map((label) => (
              <option key={label} value={label}>
                {humanize(label)}
              </option>
            ))}
          </Select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Apply
        </button>
      </form>

      <nav aria-label="Categories" className="mb-8 flex gap-2 overflow-x-auto pb-1">
        <Link
          href={chipHref()}
          aria-current={!filters.category ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
            !filters.category ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
          )}
        >
          All
        </Link>
        {allCategories.map((category) => (
          <Link
            key={category.id}
            href={chipHref(category.slug)}
            aria-current={filters.category === category.slug ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              filters.category === category.slug
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
            )}
          >
            {category.name}
          </Link>
        ))}
      </nav>

      {categories.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No dishes match your filters" : "The menu is being prepared"}
          description={hasFilters ? "Try a different search or clear the filters." : "Please check back soon."}
          action={
            hasFilters ? (
              <Link href="/menu" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-12">
          {categories.map((category) => (
            <section key={category.id} aria-labelledby={`cat-${category.slug}`}>
              <h2 id={`cat-${category.slug}`} className="font-display text-2xl font-semibold text-stone-900">
                {category.name}
              </h2>
              {category.description ? <p className="mt-1 text-sm text-stone-600">{category.description}</p> : null}
              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {category.items.map((item) => (
                  <MenuItemCard key={item.id} item={item} settings={publicSettings} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
