"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { OrderStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/ui/interactive";
import { markRefundedAction, recordManualPaymentAction } from "@/features/admin/actions";
import { updateOrderStatusAction } from "@/features/orders/actions";
import { humanize } from "@/lib/utils";

export function AdminOrderStatusControls({
  orderId,
  status,
  transitions,
}: {
  orderId: string;
  status: OrderStatus;
  transitions: OrderStatus[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!transitions.length) return <p className="text-sm text-stone-500">No further status changes are possible.</p>;

  const run = (toStatus: OrderStatus, reason?: string) =>
    new Promise<string | null>((resolve) =>
      start(async () => {
        setError(null);
        const result = await updateOrderStatusAction({ orderId, expectedStatus: status, toStatus, reason });
        router.refresh();
        if (!result.ok) setError(result.error);
        resolve(result.ok ? null : result.error);
      }),
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {transitions
          .filter((to) => to !== "CANCELLED")
          .map((to) => (
            <Button key={to} size="sm" disabled={pending} onClick={() => void run(to)}>
              Mark {humanize(to).toLowerCase()}
            </Button>
          ))}
        {transitions.includes("CANCELLED") ? (
          <ConfirmButton
            title="Cancel this order?"
            description="Pending payments will be voided. Paid orders must be refunded separately."
            confirmLabel="Cancel order"
            onConfirm={() => run("CANCELLED", "Cancelled by admin")}
          >
            Cancel order
          </ConfirmButton>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ManualPaymentForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState(recordManualPaymentAction, null);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-dashed border-stone-300 p-3">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-sm font-medium text-stone-800">Record a manual payment</p>
      <p className="text-xs text-stone-500">
        Use only after receiving cash or a counter card payment. This is recorded as a manual entry, not an online transaction.
      </p>
      <Field label="Receipt / reference (optional)" htmlFor={`ref-${orderId}`}>
        <Input id={`ref-${orderId}`} name="reference" maxLength={60} placeholder="e.g. till receipt number" />
      </Field>
      <FormMessage result={state} />
      <SubmitButton size="sm" variant="success" pendingText="Recording…">
        Mark as paid (manual)
      </SubmitButton>
    </form>
  );
}

export function RefundButton({ paymentId, orderId, online }: { paymentId: string; orderId: string; online: boolean }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title="Mark payment as refunded?"
      description={
        online
          ? "This only updates DineDesk records. Issue the actual refund in your Stripe Dashboard first."
          : "Confirm that the money has been returned to the customer."
      }
      confirmLabel="Mark refunded"
      onConfirm={async () => {
        const result = await markRefundedAction({ paymentId, orderId });
        if (!result.ok) return result.error;
        router.refresh();
      }}
    >
      Mark refunded
    </ConfirmButton>
  );
}
