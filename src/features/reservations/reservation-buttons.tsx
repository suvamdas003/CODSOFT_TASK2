"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/interactive";
import { cancelReservationAction, updateReservationStatusAction } from "@/features/reservations/actions";
import { humanize } from "@/lib/utils";

export function CancelReservationButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title="Cancel this reservation?"
      description="Your table will be released for other guests."
      confirmLabel="Cancel reservation"
      onConfirm={async () => {
        const result = await cancelReservationAction(reservationId);
        if (!result.ok) return result.error;
        router.refresh();
      }}
    >
      Cancel
    </ConfirmButton>
  );
}

/** Admin front-of-house transition buttons (confirm, seat, complete, no-show). */
export function ReservationStatusButtons({
  reservationId,
  status,
  transitions,
}: {
  reservationId: string;
  status: ReservationStatus;
  transitions: ReservationStatus[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const quick = transitions.filter((to) => to !== "CANCELLED");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {quick.map((to) => (
        <Button
          key={to}
          size="sm"
          variant={to === "NO_SHOW" ? "outline" : "secondary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await updateReservationStatusAction({ reservationId, expectedStatus: status, toStatus: to });
              if (!result.ok) setError(result.error);
              router.refresh();
            })
          }
        >
          {to === "SEATED" ? "Seat" : to === "NO_SHOW" ? "No-show" : humanize(to)}
        </Button>
      ))}
      {transitions.includes("CANCELLED") ? <CancelReservationButton reservationId={reservationId} /> : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
