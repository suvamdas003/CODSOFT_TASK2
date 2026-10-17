import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const control =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:bg-stone-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(control, "h-10 pr-8", className)} {...props} />;
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-stone-800", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-stone-800", className)}>
      <input type="checkbox" className="text-brand-600 accent-brand-600 h-4 w-4 rounded border-stone-300" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Label + control + hint/error, wired up with aria attributes. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string | string[];
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint && !message ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-stone-500">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs font-medium text-red-600" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on a control inside <Field> for accessible error linking. */
export function fieldAria(id: string, error?: string | string[]) {
  const hasError = Boolean(Array.isArray(error) ? error.length : error);
  return {
    id,
    "aria-invalid": hasError || undefined,
    "aria-describedby": hasError ? `${id}-error` : undefined,
  } as const;
}
