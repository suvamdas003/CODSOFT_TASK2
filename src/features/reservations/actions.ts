"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { parseInput, runAction, type ActionResult } from "@/lib/action";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validation/common";
import { createReservationSchema, modifyReservationSchema, reservationStatusUpdateSchema } from "@/lib/validation/reservation";
import { cancelReservation, createReservation, modifyReservation, updateReservationStatus } from "@/server/services/reservation-service";

export async function createReservationAction(input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction("createReservation", async () => {
    const actor = await getActor(["CUSTOMER", "ADMIN"]);
    enforceRateLimit(`reservation:${actor.id}`, RATE_LIMITS.reservation);
    const reservation = await createReservation(actor, parseInput(createReservationSchema, input));
    revalidatePath("/reservations");
    revalidatePath("/admin/reservations");
    return { id: reservation.id, code: reservation.code };
  });
}

export async function modifyReservationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("modifyReservation", async () => {
    const actor = await getActor(["CUSTOMER", "ADMIN"]);
    enforceRateLimit(`reservation:${actor.id}`, RATE_LIMITS.reservation);
    const reservation = await modifyReservation(actor, parseInput(modifyReservationSchema, input));
    revalidatePath("/reservations");
    revalidatePath("/admin/reservations");
    return { id: reservation.id };
  });
}

export async function cancelReservationAction(reservationId: string): Promise<ActionResult> {
  return runAction(
    "cancelReservation",
    async () => {
      const actor = await getActor(["CUSTOMER", "ADMIN"]);
      await cancelReservation(actor, parseInput(idSchema, reservationId));
      revalidatePath("/reservations");
      revalidatePath("/admin/reservations");
      return null;
    },
    "Reservation cancelled.",
  );
}

export async function updateReservationStatusAction(input: z.input<typeof reservationStatusUpdateSchema>): Promise<ActionResult> {
  return runAction("updateReservationStatus", async () => {
    const actor = await getActor(["ADMIN"]);
    await updateReservationStatus(actor, parseInput(reservationStatusUpdateSchema, input));
    revalidatePath("/admin/reservations");
    return null;
  });
}
