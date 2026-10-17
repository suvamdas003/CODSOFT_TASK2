"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { DiscountType, OrderType, PaymentMethod, Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, fieldAria, Input, Select } from "@/components/ui/form-controls";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/ui/interactive";
import {
  changeRoleAction,
  createDiscountAction,
  createStaffAction,
  deleteTableAction,
  saveOpeningHoursAction,
  saveSettingsAction,
  saveTableAction,
  setDiscountActiveAction,
  setUserActiveAction,
} from "@/features/admin/actions";
import { humanize } from "@/lib/utils";

const errorsOf = (state: { ok: boolean; fieldErrors?: Record<string, string[]> } | null) =>
  state && !state.ok ? (state.fieldErrors ?? {}) : {};

// ─── Tables ─────────────────────────────────────────────────────────────────

export function TableForm({
  table,
}: {
  table?: { id: string; label: string; capacity: number; location: string | null; isActive: boolean };
}) {
  const [state, action] = useActionState(saveTableAction, null);
  const errors = errorsOf(state);
  const prefix = table ? `table-${table.id}` : "table-new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[100px_100px_1fr_auto_auto] sm:items-end" noValidate>
      {table ? <input type="hidden" name="id" value={table.id} /> : null}
      <Field label="Label" htmlFor={`${prefix}-label`} error={errors.label}>
        <Input {...fieldAria(`${prefix}-label`, errors.label)} name="label" defaultValue={table?.label} maxLength={20} />
      </Field>
      <Field label="Seats" htmlFor={`${prefix}-capacity`} error={errors.capacity}>
        <Input
          {...fieldAria(`${prefix}-capacity`, errors.capacity)}
          name="capacity"
          type="number"
          min={1}
          max={50}
          defaultValue={table?.capacity ?? 2}
        />
      </Field>
      <Field label="Location" htmlFor={`${prefix}-location`} error={errors.location}>
        <Input {...fieldAria(`${prefix}-location`, errors.location)} name="location" defaultValue={table?.location ?? ""} maxLength={60} />
      </Field>
      <Checkbox name="isActive" defaultChecked={table?.isActive ?? true} label="Active" className="h-10" />
      <SubmitButton variant={table ? "outline" : "primary"}>{table ? "Save" : "Add table"}</SubmitButton>
      <div className="sm:col-span-5">
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function DeleteTableButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title={`Delete table ${label}?`}
      description="Tables with reservation history cannot be deleted — deactivate them instead."
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteTableAction(id);
        if (!result.ok) return result.error;
        router.refresh();
      }}
    >
      Delete
    </ConfirmButton>
  );
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export function StaffCreateForm() {
  const [state, action] = useActionState(createStaffAction, null);
  const errors = errorsOf(state);
  return (
    <form
      action={action}
      className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_160px_auto] lg:items-end"
      noValidate
      autoComplete="off"
    >
      <Field label="Name" htmlFor="staff-name" error={errors.name}>
        <Input {...fieldAria("staff-name", errors.name)} name="name" maxLength={80} />
      </Field>
      <Field label="Email" htmlFor="staff-email" error={errors.email}>
        <Input {...fieldAria("staff-email", errors.email)} name="email" type="email" />
      </Field>
      <Field label="Temporary password" htmlFor="staff-password" error={errors.password} hint="10+ characters.">
        <Input {...fieldAria("staff-password", errors.password)} name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Role" htmlFor="staff-role" error={errors.role}>
        <Select id="staff-role" name="role" defaultValue={Role.KITCHEN_STAFF}>
          {Object.values(Role).map((role) => (
            <option key={role} value={role}>
              {humanize(role)}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton pendingText="Creating…">Create account</SubmitButton>
      <div className="md:col-span-2 lg:col-span-5">
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function UserRowControls({ userId, role, isActive, isSelf }: { userId: string; role: Role; isActive: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (isSelf) return <span className="text-xs text-stone-500">This is you</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="sr-only" htmlFor={`role-${userId}`}>
        Role
      </label>
      <select
        id={`role-${userId}`}
        className="h-8 rounded-lg border border-stone-300 bg-white px-2 text-sm"
        defaultValue={role}
        disabled={pending}
        onChange={(event) => {
          const nextRole = event.target.value as Role;
          start(async () => {
            setError(null);
            const result = await changeRoleAction({ userId, role: nextRole });
            if (!result.ok) {
              setError(result.error);
              event.target.value = role;
            }
            router.refresh();
          });
        }}
      >
        {Object.values(Role).map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </select>
      {isActive ? (
        <ConfirmButton
          title="Deactivate this account?"
          description="They will be signed out immediately and cannot sign in until reactivated. Their history is kept."
          confirmLabel="Deactivate"
          onConfirm={async () => {
            const result = await setUserActiveAction({ userId, isActive: false });
            if (!result.ok) return result.error;
            router.refresh();
          }}
        >
          Deactivate
        </ConfirmButton>
      ) : (
        <Button
          size="sm"
          variant="success"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setUserActiveAction({ userId, isActive: true });
              if (!result.ok) setError(result.error);
              router.refresh();
            })
          }
        >
          Reactivate
        </Button>
      )}
      {error ? (
        <p role="alert" className="w-full text-right text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─── Discounts ──────────────────────────────────────────────────────────────

export function DiscountForm({ currency }: { currency: string }) {
  const [state, action] = useActionState(createDiscountAction, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-3" noValidate>
      <Field label="Code" htmlFor="d-code" error={errors.code}>
        <Input {...fieldAria("d-code", errors.code)} name="code" maxLength={32} className="uppercase" />
      </Field>
      <Field label="Type" htmlFor="d-type" error={errors.type}>
        <Select id="d-type" name="type" defaultValue={DiscountType.PERCENT}>
          <option value={DiscountType.PERCENT}>Percentage off</option>
          <option value={DiscountType.FIXED}>Fixed amount off ({currency})</option>
        </Select>
      </Field>
      <Field label="Value" htmlFor="d-value" error={errors.value} hint="Percent (e.g. 10) or amount (e.g. 50.00).">
        <Input {...fieldAria("d-value", errors.value)} name="value" inputMode="decimal" />
      </Field>
      <Field label={`Minimum order (${currency})`} htmlFor="d-min" error={errors.minSubtotal}>
        <Input {...fieldAria("d-min", errors.minSubtotal)} name="minSubtotal" inputMode="decimal" placeholder="0" />
      </Field>
      <Field label={`Maximum discount (${currency})`} htmlFor="d-max" error={errors.maxDiscount} hint="Optional cap for percentage codes.">
        <Input {...fieldAria("d-max", errors.maxDiscount)} name="maxDiscount" inputMode="decimal" />
      </Field>
      <Field label="Usage limit" htmlFor="d-limit" error={errors.maxRedemptions} hint="Optional total number of uses.">
        <Input {...fieldAria("d-limit", errors.maxRedemptions)} name="maxRedemptions" type="number" min={1} />
      </Field>
      <Field label="Starts" htmlFor="d-start" error={errors.startsAt}>
        <Input {...fieldAria("d-start", errors.startsAt)} name="startsAt" type="datetime-local" />
      </Field>
      <Field label="Ends" htmlFor="d-end" error={errors.endsAt}>
        <Input {...fieldAria("d-end", errors.endsAt)} name="endsAt" type="datetime-local" />
      </Field>
      <Field label="Description" htmlFor="d-desc" error={errors.description}>
        <Input {...fieldAria("d-desc", errors.description)} name="description" maxLength={120} />
      </Field>
      <div className="flex items-center gap-4 md:col-span-3">
        <Checkbox name="isActive" defaultChecked label="Active" />
        <SubmitButton pendingText="Creating…">Create code</SubmitButton>
      </div>
      <div className="md:col-span-3">
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function DiscountToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setDiscountActiveAction(id, !isActive);
          router.refresh();
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type SettingsFormValues = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  locale: string;
  timezone: string;
  taxRate: string;
  serviceCharge: string;
  deliveryFee: string;
  enabledOrderTypes: OrderType[];
  enabledPaymentMethods: PaymentMethod[];
  acceptingOrders: boolean;
  customerCancelWindowMinutes: number;
  reservationDurationMinutes: number;
  reservationSlotMinutes: number;
  reservationLeadMinutes: number;
  reservationMaxDaysAhead: number;
  maxPartySize: number;
  autoConfirmReservations: boolean;
  kitchenLateMinutes: number;
};

export function SettingsForm({ values, onlinePaymentsConfigured }: { values: SettingsFormValues; onlinePaymentsConfigured: boolean }) {
  const [state, action] = useActionState(saveSettingsAction, null);
  const errors = errorsOf(state);
  const text = (name: keyof SettingsFormValues, label: string, props: { hint?: string; type?: string; inputMode?: "decimal" } = {}) => (
    <Field label={label} htmlFor={`s-${name}`} error={errors[name]} hint={props.hint}>
      <Input
        {...fieldAria(`s-${name}`, errors[name])}
        name={name}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        defaultValue={String(values[name] ?? "")}
      />
    </Field>
  );
  return (
    <form action={action} className="space-y-8" noValidate>
      <section className="grid gap-4 md:grid-cols-2">
        <h3 className="text-sm font-semibold tracking-wide text-stone-500 uppercase md:col-span-2">Restaurant</h3>
        {text("name", "Restaurant name")}
        {text("tagline", "Tagline")}
        {text("phone", "Phone")}
        {text("email", "Email", { type: "email" })}
        <div className="md:col-span-2">{text("address", "Address")}</div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <h3 className="text-sm font-semibold tracking-wide text-stone-500 uppercase md:col-span-3">Money & locale</h3>
        {text("currency", "Currency (ISO 4217)", { hint: "e.g. INR, USD, EUR. Locked while menu items exist." })}
        {text("locale", "Locale", { hint: "e.g. en-IN, en-US" })}
        {text("timezone", "Time zone", { hint: "IANA name, e.g. Asia/Kolkata" })}
        {text("taxRate", "Tax rate (%)", { inputMode: "decimal" })}
        {text("serviceCharge", "Service charge (%) — dine-in", { inputMode: "decimal" })}
        {text("deliveryFee", "Delivery fee", { inputMode: "decimal" })}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <h3 className="text-sm font-semibold tracking-wide text-stone-500 uppercase md:col-span-2">Ordering</h3>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-stone-800">Order types offered</legend>
          <div className="flex flex-wrap gap-4">
            {Object.values(OrderType).map((type) => (
              <Checkbox
                key={type}
                name="enabledOrderTypes"
                value={type}
                defaultChecked={values.enabledOrderTypes.includes(type)}
                label={humanize(type)}
              />
            ))}
          </div>
          {errors.enabledOrderTypes ? <p className="mt-1 text-xs text-red-600">{errors.enabledOrderTypes[0]}</p> : null}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-stone-800">Payment methods offered</legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              name="enabledPaymentMethods"
              value="CASH"
              defaultChecked={values.enabledPaymentMethods.includes("CASH")}
              label="Pay at restaurant (manual)"
            />
            <Checkbox
              name="enabledPaymentMethods"
              value="ONLINE_CARD"
              defaultChecked={values.enabledPaymentMethods.includes("ONLINE_CARD")}
              label={`Online card${onlinePaymentsConfigured ? "" : " (not configured)"}`}
            />
          </div>
          {!onlinePaymentsConfigured ? (
            <p className="mt-1 text-xs text-stone-500">
              Online card payments stay hidden from customers until Stripe keys are configured (see docs/PAYMENTS.md).
            </p>
          ) : null}
          {errors.enabledPaymentMethods ? <p className="mt-1 text-xs text-red-600">{errors.enabledPaymentMethods[0]}</p> : null}
        </fieldset>
        <Checkbox name="acceptingOrders" defaultChecked={values.acceptingOrders} label="Accepting online orders" />
        {text("customerCancelWindowMinutes", "Customer cancellation window (minutes)", {
          type: "number",
          hint: "0 disables self-service cancellation.",
        })}
        {text("kitchenLateMinutes", "Kitchen ‘late’ threshold (minutes)", { type: "number" })}
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <h3 className="text-sm font-semibold tracking-wide text-stone-500 uppercase md:col-span-3">Reservations</h3>
        {text("reservationDurationMinutes", "Booking length (minutes)", { type: "number" })}
        {text("reservationSlotMinutes", "Slot interval (minutes)", { type: "number" })}
        {text("reservationLeadMinutes", "Minimum notice (minutes)", { type: "number" })}
        {text("reservationMaxDaysAhead", "Book up to (days ahead)", { type: "number" })}
        {text("maxPartySize", "Max party size online", { type: "number" })}
        <Checkbox
          name="autoConfirmReservations"
          defaultChecked={values.autoConfirmReservations}
          label="Auto-confirm bookings"
          className="h-10 self-end"
        />
      </section>
      <FormMessage result={state} />
      <SubmitButton>Save settings</SubmitButton>
    </form>
  );
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function OpeningHoursForm({ days }: { days: { dayOfWeek: number; isClosed: boolean; open: string; close: string }[] }) {
  const [state, action] = useActionState(saveOpeningHoursAction, null);
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-stone-500 uppercase">
              <th className="py-2 pr-4">Day</th>
              <th className="py-2 pr-4">Opens</th>
              <th className="py-2 pr-4">Closes</th>
              <th className="py-2">Closed all day</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.dayOfWeek}>
                <td className="py-1.5 pr-4 font-medium">{DAY_NAMES[day.dayOfWeek]}</td>
                <td className="py-1.5 pr-4">
                  <Input
                    aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
                    type="time"
                    name={`open-${day.dayOfWeek}`}
                    defaultValue={day.open}
                    className="w-32"
                  />
                </td>
                <td className="py-1.5 pr-4">
                  <Input
                    aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
                    type="time"
                    name={`close-${day.dayOfWeek}`}
                    defaultValue={day.close}
                    className="w-32"
                  />
                </td>
                <td className="py-1.5">
                  <input
                    aria-label={`${DAY_NAMES[day.dayOfWeek]} closed`}
                    type="checkbox"
                    name={`closed-${day.dayOfWeek}`}
                    defaultChecked={day.isClosed}
                    className="accent-brand-600 h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Closing after midnight is not supported. Existing bookings are not changed.</p>
      <FormMessage result={state} />
      <SubmitButton>Save opening hours</SubmitButton>
    </form>
  );
}
