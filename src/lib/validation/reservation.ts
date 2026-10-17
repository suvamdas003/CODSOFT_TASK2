import { z } from "zod";
import { ReservationStatus } from "@/generated/prisma/enums";
import { idSchema, intFromInput, isoDateSchema, nameSchema, optionalText, phoneSchema } from "@/lib/validation/common";

export const availabilityQuerySchema = z.object({
  date: isoDateSchema,
  partySize: intFromInput(1, 100, "Party size"),
  excludeReservationId: idSchema.optional(),
});

export const createReservationSchema = z.object({
  date: isoDateSchema,
  startMinute: intFromInput(0, 1439, "Start time"),
  partySize: intFromInput(1, 100, "Party size"),
  contactName: nameSchema,
  contactPhone: phoneSchema,
  notes: optionalText(300),
});

export const modifyReservationSchema = z.object({
  reservationId: idSchema,
  date: isoDateSchema,
  startMinute: intFromInput(0, 1439, "Start time"),
  partySize: intFromInput(1, 100, "Party size"),
  notes: optionalText(300),
});

export const reservationStatusUpdateSchema = z.object({
  reservationId: idSchema,
  expectedStatus: z.enum(ReservationStatus),
  toStatus: z.enum(ReservationStatus),
});

export const reservationListFilterSchema = z.object({
  date: isoDateSchema.optional().catch(undefined),
  status: z.enum(ReservationStatus).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type CreateReservationInput = z.input<typeof createReservationSchema>;
