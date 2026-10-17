"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/display";
import { Field, fieldAria, Input, Select, Textarea } from "@/components/ui/form-controls";
import { createReservationAction, modifyReservationAction } from "@/features/reservations/actions";
import { cn } from "@/lib/utils";
import type { SlotResult } from "@/server/services/reservation-slots";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  partySize: z.coerce.number().int().min(1),
  startMinute: z.coerce.number({ error: "Choose a time." }).int().min(0, "Choose a time."),
  contactName: z.string().trim().min(2, "Enter a name.").max(80),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number."),
  notes: z.string().trim().max(300),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export type ReservationFormProps = {
  mode: "create" | "modify";
  minDate: string;
  maxDate: string;
  maxPartySize: number;
  timezone: string;
  durationMinutes: number;
  successPath: string;
  initial?: {
    reservationId: string;
    date: string;
    partySize: number;
    startMinute: number;
    contactName: string;
    contactPhone: string;
    notes: string;
  };
  defaultContact?: { name: string };
};

export function ReservationForm(props: ReservationFormProps) {
  const router = useRouter();
  // Slot data is keyed by the request, so "loading" is derived rather than set in the effect.
  const [reloadToken, setReloadToken] = useState(0);
  const [slotState, setSlotState] = useState<{ key: string; slots: SlotResult | null; error: string | null }>({
    key: "",
    slots: null,
    error: null,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: props.initial?.date ?? props.minDate,
      partySize: props.initial?.partySize ?? 2,
      startMinute: props.initial?.startMinute ?? -1,
      contactName: props.initial?.contactName ?? props.defaultContact?.name ?? "",
      contactPhone: props.initial?.contactPhone ?? "",
      notes: props.initial?.notes ?? "",
    },
  });
  const date = useWatch({ control: form.control, name: "date" });
  const partySize = useWatch({ control: form.control, name: "partySize" });
  const startMinute = Number(useWatch({ control: form.control, name: "startMinute" }));
  const errors = form.formState.errors;

  const excludeId = props.initial?.reservationId;
  const requestKey = `${date}|${String(partySize)}|${reloadToken}`;
  const loadingSlots = Boolean(date && partySize) && slotState.key !== requestKey;
  const slots = loadingSlots ? null : slotState.slots;
  const slotError = loadingSlots ? null : slotState.error;

  useEffect(() => {
    if (!date || !partySize) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ date, partySize: String(partySize as number) });
    if (excludeId) params.set("exclude", excludeId);
    fetch(`/api/reservations/availability?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Could not load available times.");
        setSlotState({ key: requestKey, slots: data as SlotResult, error: null });
        const current = Number(form.getValues("startMinute"));
        const stillValid = (data as SlotResult).slots.some((slot) => slot.startMinute === current && slot.available);
        if (!stillValid) form.setValue("startMinute", -1);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setSlotState({ key: requestKey, slots: null, error: error.message });
      });
    return () => controller.abort();
  }, [date, partySize, excludeId, form, requestKey]);

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    start(async () => {
      const result =
        props.mode === "create"
          ? await createReservationAction(values)
          : await modifyReservationAction({
              reservationId: props.initial!.reservationId,
              date: values.date,
              startMinute: values.startMinute,
              partySize: values.partySize,
              notes: values.notes,
            });
      if (!result.ok) {
        setSubmitError(result.error);
        // Reload slots — the chosen time may have just been taken.
        form.setValue("startMinute", -1);
        setReloadToken((token) => token + 1);
        return;
      }
      const code = (result.data as { code?: string }).code ?? "";
      router.push(`${props.successPath}${code ? `?created=${encodeURIComponent(code)}` : "?updated=1"}`);
      router.refresh();
    });
  });

  const availableCount = slots?.slots.filter((slot) => slot.available).length ?? 0;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="date" error={errors.date?.message} required>
          <Input
            {...fieldAria("date", errors.date?.message)}
            type="date"
            min={props.minDate}
            max={props.maxDate}
            {...form.register("date")}
          />
        </Field>
        <Field label="Guests" htmlFor="partySize" error={errors.partySize?.message} required>
          <Select {...fieldAria("partySize", errors.partySize?.message)} {...form.register("partySize")}>
            {Array.from({ length: props.maxPartySize }, (_, index) => index + 1).map((size) => (
              <option key={size} value={size}>
                {size} {size === 1 ? "guest" : "guests"}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-stone-800">
          Time{" "}
          <span className="font-normal text-stone-500">
            ({props.timezone}, {props.durationMinutes} min booking)
          </span>
        </legend>
        {loadingSlots ? <Spinner label="Loading available times" /> : null}
        {slotError ? <Alert tone="error">{slotError}</Alert> : null}
        {slots?.unavailableReason ? <Alert tone="warning">{slots.unavailableReason}</Alert> : null}
        {slots && !slots.unavailableReason ? (
          <>
            {availableCount === 0 ? (
              <Alert tone="warning" className="mb-3">
                All tables are booked for this date and party size. Please try another day.
              </Alert>
            ) : null}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {slots.slots.map((slot) => {
                const selected = startMinute === slot.startMinute;
                return (
                  <button
                    key={slot.startMinute}
                    type="button"
                    disabled={!slot.available}
                    aria-pressed={selected}
                    aria-label={`${slot.label}${slot.available ? "" : slot.reason === "PAST" ? " — too soon to book" : " — fully booked"}`}
                    onClick={() => form.setValue("startMinute", slot.startMinute, { shouldValidate: true })}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                      selected
                        ? "border-brand-600 bg-brand-600 text-white"
                        : slot.available
                          ? "hover:border-brand-400 hover:bg-brand-50 border-stone-300 bg-white text-stone-800"
                          : "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 line-through",
                    )}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-stone-500">Crossed-out times are fully booked or too soon to reserve online.</p>
          </>
        ) : null}
        {errors.startMinute ? (
          <p role="alert" className="mt-2 text-xs font-medium text-red-600">
            {errors.startMinute.message}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="contactName" error={errors.contactName?.message} required>
          <Input
            {...fieldAria("contactName", errors.contactName?.message)}
            autoComplete="name"
            disabled={props.mode === "modify"}
            {...form.register("contactName")}
          />
        </Field>
        <Field label="Phone" htmlFor="contactPhone" error={errors.contactPhone?.message} required>
          <Input
            {...fieldAria("contactPhone", errors.contactPhone?.message)}
            type="tel"
            autoComplete="tel"
            disabled={props.mode === "modify"}
            {...form.register("contactPhone")}
          />
        </Field>
      </div>
      <Field
        label="Requests (optional)"
        htmlFor="notes"
        error={errors.notes?.message}
        hint="Occasion, accessibility needs, seating preference…"
      >
        <Textarea {...fieldAria("notes", errors.notes?.message)} rows={2} maxLength={300} {...form.register("notes")} />
      </Field>

      {submitError ? <Alert tone="error">{submitError}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending || startMinute < 0}>
        {pending ? "Saving…" : props.mode === "create" ? "Confirm reservation" : "Save changes"}
      </Button>
    </form>
  );
}
