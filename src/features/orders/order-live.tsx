"use client";

import { CreditCard, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/interactive";
import { cancelOrderAction, payOnlineAction, syncPaymentAction } from "@/features/orders/actions";

const POLL_MS = 10_000;

/**
 * Keeps the server-rendered order page fresh: polls a small JSON endpoint and
 * calls router.refresh() only when the status or payment status changes.
 * Polling stops when the order is finished or the tab is hidden.
 */
export function OrderAutoRefresh({
  orderId,
  status,
  paymentStatus,
  active,
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  active: boolean;
}) {
  const router = useRouter();
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const known = useRef({ status, paymentStatus });
  useEffect(() => {
    known.current = { status, paymentStatus };
  }, [status, paymentStatus]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    async function poll() {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { status: string; paymentStatus: string };
        if (stopped) return;
        setFailed(false);
        setLastChecked(new Date());
        if (data.status !== known.current.status || data.paymentStatus !== known.current.paymentStatus) router.refresh();
      } catch {
        if (!stopped) setFailed(true);
      }
    }
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => !document.hidden && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, orderId, router]);

  if (!active) return null;
  return (
    <p className="no-print flex items-center gap-1.5 text-xs text-stone-500" aria-live="polite">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      {failed
        ? "Live updates paused — retrying…"
        : `Updates automatically every ${POLL_MS / 1000}s${lastChecked ? ` · last checked ${lastChecked.toLocaleTimeString()}` : ""}`}
    </p>
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title="Cancel this order?"
      description="The kitchen has not accepted it yet. This cannot be undone."
      confirmLabel="Cancel order"
      onConfirm={async () => {
        const result = await cancelOrderAction(orderId);
        if (!result.ok) return result.error;
        router.refresh();
      }}
    >
      Cancel order
    </ConfirmButton>
  );
}

export function PayOnlineButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await payOnlineAction(orderId);
            if (!result.ok) return setError(result.error);
            if (result.data.redirectUrl) window.location.assign(result.data.redirectUrl);
            else router.refresh();
          })
        }
      >
        <CreditCard className="h-4 w-4" aria-hidden />
        {pending ? "Opening secure payment…" : "Pay online now"}
      </Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}

/** After returning from the hosted checkout, ask the server to verify with the provider. */
export function PaymentReturnSync({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "done" | "error">("checking");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    syncPaymentAction(orderId).then((result) => {
      setState(result.ok ? "done" : "error");
      router.replace(`/orders/${orderId}`);
      router.refresh();
    });
  }, [orderId, router]);
  if (state === "checking") return <Alert tone="info">Checking your payment with the payment provider…</Alert>;
  if (state === "error")
    return <Alert tone="warning">We could not confirm your payment yet. It will update automatically once the provider confirms it.</Alert>;
  return null;
}

export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()} className="no-print">
      Print receipt
    </Button>
  );
}
