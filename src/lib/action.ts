import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isAppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type ActionResult<T = null> =
  { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Converts any thrown error into a safe, user-facing ActionResult. */
export function toActionError(error: unknown, context?: Record<string, unknown>): ActionResult<never> {
  if (isAppError(error)) {
    return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: flattenZod(error) };
  }
  logger.error("Unhandled server action error", { ...context, error });
  return { ok: false, error: GENERIC_ERROR };
}

/**
 * Wraps a server action body: Next.js control-flow errors (redirect,
 * notFound) are re-thrown, domain errors are returned as messages, and
 * unexpected errors are logged and replaced with a generic message.
 */
export async function runAction<T>(name: string, fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error, { action: name });
  }
}

export function flattenZod(error: z.ZodError): Record<string, string[]> {
  const flattened = z.flattenError(error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(messages) && messages.length) fieldErrors[key] = messages as string[];
  }
  if (flattened.formErrors.length) fieldErrors._form = flattened.formErrors;
  return fieldErrors;
}

/** Parses untrusted input, throwing a ValidationError with field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors = flattenZod(result.error);
    const first = Object.values(fieldErrors)[0]?.[0];
    throw new ValidationError(first ?? "Please check the highlighted fields.", fieldErrors);
  }
  return result.data;
}

/** Reads FormData into a plain object (single values; repeated keys become arrays). */
export function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value !== "string") continue;
    const existing = output[key];
    if (existing === undefined) output[key] = value;
    else output[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return output;
}
