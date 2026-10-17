"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { DietaryLabel } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { Checkbox, Field, fieldAria, Input, Select, Textarea } from "@/components/ui/form-controls";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/ui/interactive";
import {
  addAddOnAction,
  addVariantAction,
  archiveItemAction,
  deleteCategoryAction,
  deleteOptionAction,
  restoreItemAction,
  saveCategoryAction,
  saveMenuItemAction,
  setItemAvailabilityAction,
  setOptionAvailabilityAction,
} from "@/features/admin/actions";
import { humanize } from "@/lib/utils";

type MenuItemFormProps = {
  categories: { id: string; name: string }[];
  currency: string;
  item?: {
    id: string;
    categoryId: string;
    name: string;
    description: string;
    price: string;
    imageUrl: string | null;
    dietaryLabels: DietaryLabel[];
    isPublished: boolean;
    isAvailable: boolean;
    isFeatured: boolean;
    prepTimeMinutes: number | null;
    sortOrder: number;
  };
};

export function MenuItemForm({ categories, currency, item }: MenuItemFormProps) {
  const [state, action] = useActionState(saveMenuItemAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="grid gap-5" noValidate>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={errors.name} required>
          <Input {...fieldAria("name", errors.name)} name="name" defaultValue={item?.name} maxLength={80} required />
        </Field>
        <Field label="Category" htmlFor="categoryId" error={errors.categoryId} required>
          <Select {...fieldAria("categoryId", errors.categoryId)} name="categoryId" defaultValue={item?.categoryId ?? categories[0]?.id}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description" htmlFor="description" error={errors.description}>
        <Textarea
          {...fieldAria("description", errors.description)}
          name="description"
          defaultValue={item?.description}
          maxLength={600}
          rows={3}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={`Base price (${currency})`}
          htmlFor="price"
          error={errors.price}
          hint="Before tax. Variants adjust this price."
          required
        >
          <Input
            {...fieldAria("price", errors.price)}
            name="price"
            inputMode="decimal"
            defaultValue={item?.price}
            placeholder="0.00"
            required
          />
        </Field>
        <Field label="Prep time (minutes)" htmlFor="prepTimeMinutes" error={errors.prepTimeMinutes}>
          <Input
            {...fieldAria("prepTimeMinutes", errors.prepTimeMinutes)}
            name="prepTimeMinutes"
            type="number"
            min={0}
            max={240}
            defaultValue={item?.prepTimeMinutes ?? ""}
          />
        </Field>
        <Field label="Sort order" htmlFor="sortOrder" error={errors.sortOrder} hint="Lower numbers appear first.">
          <Input
            {...fieldAria("sortOrder", errors.sortOrder)}
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={item?.sortOrder ?? 0}
          />
        </Field>
      </div>
      <Field
        label="Image"
        htmlFor="imageUrl"
        error={errors.imageUrl}
        hint="A path under /images/ (e.g. /images/menu/paneer-tikka.svg) or an https:// URL."
      >
        <Input {...fieldAria("imageUrl", errors.imageUrl)} name="imageUrl" defaultValue={item?.imageUrl ?? ""} maxLength={500} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-stone-800">Dietary labels</legend>
        <div className="flex flex-wrap gap-4">
          {Object.values(DietaryLabel).map((label) => (
            <Checkbox
              key={label}
              name="dietaryLabels"
              value={label}
              defaultChecked={item?.dietaryLabels.includes(label)}
              label={humanize(label)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap gap-6">
        <legend className="mb-2 text-sm font-medium text-stone-800">Visibility</legend>
        <Checkbox name="isPublished" defaultChecked={item?.isPublished ?? true} label="Published on menu" />
        <Checkbox name="isAvailable" defaultChecked={item?.isAvailable ?? true} label="Available to order" />
        <Checkbox name="isFeatured" defaultChecked={item?.isFeatured ?? false} label="Featured" />
      </fieldset>
      <FormMessage result={state} />
      <div>
        <SubmitButton>{item ? "Save changes" : "Create item"}</SubmitButton>
      </div>
    </form>
  );
}

export function ItemRowActions({ id, name, isAvailable, archived }: { id: string; name: string; isAvailable: boolean; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (archived) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await restoreItemAction(id);
            if (!result.ok) setError(result.error);
            router.refresh();
          })
        }
      >
        Restore
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant={isAvailable ? "outline" : "success"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await setItemAvailabilityAction(id, !isAvailable);
            if (!result.ok) setError(result.error);
            router.refresh();
          })
        }
      >
        {isAvailable ? "Mark sold out" : "Mark available"}
      </Button>
      <ConfirmButton
        title={`Archive “${name}”?`}
        description="It will be hidden from the menu and can no longer be ordered. Past orders keep their receipts. You can restore it later."
        confirmLabel="Archive"
        onConfirm={async () => {
          const result = await archiveItemAction(id);
          if (!result.ok) return result.error;
          router.refresh();
        }}
      >
        Archive
      </ConfirmButton>
      {error ? (
        <p role="alert" className="w-full text-right text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Option = { id: string; name: string; priceLabel: string; isAvailable: boolean };

export function OptionsManager({
  kind,
  menuItemId,
  options,
  currency,
}: {
  kind: "variant" | "addon";
  menuItemId: string;
  options: Option[];
  currency: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(kind === "variant" ? addVariantAction : addOnFormAction, null);
  const [pending, start] = useTransition();
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const prefix = `${kind}-new`;

  return (
    <div className="space-y-4">
      {options.length === 0 ? (
        <p className="text-sm text-stone-500">
          {kind === "variant" ? "No size/portion options. Customers order the base item." : "No extras configured."}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {options.map((option) => (
            <li key={option.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{option.name}</span> <span className="text-stone-500">{option.priceLabel}</span>{" "}
                {!option.isAvailable ? <Badge tone="amber">Unavailable</Badge> : null}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await setOptionAvailabilityAction(kind, option.id, !option.isAvailable);
                      router.refresh();
                    })
                  }
                >
                  {option.isAvailable ? "Disable" : "Enable"}
                </Button>
                <ConfirmButton
                  title={`Delete “${option.name}”?`}
                  description="Past orders keep their recorded option names and prices."
                  confirmLabel="Delete"
                  onConfirm={async () => {
                    const result = await deleteOptionAction(kind, option.id);
                    if (!result.ok) return result.error;
                    router.refresh();
                  }}
                >
                  Delete
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end" noValidate>
        <input type="hidden" name="menuItemId" value={menuItemId} />
        <input type="hidden" name="isAvailable" value="on" />
        <Field label={kind === "variant" ? "Option name" : "Extra name"} htmlFor={`${prefix}-name`} error={errors.name}>
          <Input
            {...fieldAria(`${prefix}-name`, errors.name)}
            name="name"
            maxLength={60}
            placeholder={kind === "variant" ? "e.g. Large" : "e.g. Extra cheese"}
          />
        </Field>
        <Field
          label={kind === "variant" ? `Price change (${currency})` : `Price (${currency})`}
          htmlFor={`${prefix}-price`}
          error={kind === "variant" ? errors.priceDelta : errors.price}
        >
          <Input
            {...fieldAria(`${prefix}-price`, kind === "variant" ? errors.priceDelta : errors.price)}
            name={kind === "variant" ? "priceDelta" : "price"}
            inputMode="decimal"
            defaultValue="0"
          />
        </Field>
        <SubmitButton size="md" variant="secondary" pendingText="Adding…">
          Add
        </SubmitButton>
        <div className="sm:col-span-3">
          <FormMessage result={state} />
        </div>
      </form>
    </div>
  );
}

const addOnFormAction = addAddOnAction;

export function CategoryForm({
  category,
}: {
  category?: { id: string; name: string; description: string | null; sortOrder: number; isActive: boolean };
}) {
  const [state, action] = useActionState(saveCategoryAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const prefix = category ? `cat-${category.id}` : "cat-new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_100px_auto_auto] sm:items-end" noValidate>
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <Field label="Name" htmlFor={`${prefix}-name`} error={errors.name}>
        <Input {...fieldAria(`${prefix}-name`, errors.name)} name="name" defaultValue={category?.name} maxLength={80} />
      </Field>
      <Field label="Description" htmlFor={`${prefix}-description`} error={errors.description}>
        <Input
          {...fieldAria(`${prefix}-description`, errors.description)}
          name="description"
          defaultValue={category?.description ?? ""}
          maxLength={300}
        />
      </Field>
      <Field label="Order" htmlFor={`${prefix}-sort`} error={errors.sortOrder}>
        <Input
          {...fieldAria(`${prefix}-sort`, errors.sortOrder)}
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={category?.sortOrder ?? 0}
        />
      </Field>
      <Checkbox name="isActive" defaultChecked={category?.isActive ?? true} label="Active" className="h-10" />
      <SubmitButton variant={category ? "outline" : "primary"}>{category ? "Save" : "Add category"}</SubmitButton>
      <div className="sm:col-span-5">
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title={`Delete category “${name}”?`}
      description="Only empty categories can be deleted. Deactivate a category to hide it without deleting."
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteCategoryAction(id);
        if (!result.ok) return result.error;
        router.refresh();
      }}
    >
      Delete
    </ConfirmButton>
  );
}
