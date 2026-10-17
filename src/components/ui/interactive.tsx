"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Submit button that disables itself while its form's server action runs. */
export function SubmitButton({ children, pendingText, disabled, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

/**
 * Accessible modal dialog built on the native <dialog> element (focus
 * trapping, Escape to close and inert background are provided by the browser).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl",
        className,
      )}
    >
      {open ? (
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm text-stone-600">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
              aria-label="Close dialog"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Button that asks for confirmation before running a destructive action.
 * `onConfirm` may return an error message to show inside the dialog.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  variant = "outline",
  confirmVariant = "danger",
  size = "sm",
  disabled,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<string | null | void>;
  variant?: ButtonProps["variant"];
  confirmVariant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const message = await onConfirm();
      if (message) setError(message);
      else setOpen(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onClose={() => !pending && setOpen(false)} title={title} description={description}>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Keep it
          </Button>
          <Button variant={confirmVariant} onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Small inline message area for form results. */
export function FormMessage({ result }: { result: { ok: boolean; error?: string; message?: string } | null | undefined }) {
  if (!result) return null;
  if (result.ok) {
    return result.message ? (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {result.message}
      </p>
    ) : null;
  }
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {result.error}
    </p>
  );
}
