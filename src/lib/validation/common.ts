import { z } from "zod";

export const idSchema = z.string().trim().min(1, "Missing identifier.").max(64, "Invalid identifier.");

export const nameSchema = z.string().trim().min(2, "Must be at least 2 characters.").max(80, "Must be 80 characters or fewer.");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : undefined));

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number.");

export const optionalPhoneSchema = z
  .union([phoneSchema, z.literal("")])
  .optional()
  .transform((value) => (value ? value : undefined));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")).pipe(z.string().max(254));

export const passwordSchema = z.string().min(10, "Use at least 10 characters.").max(128, "Use 128 characters or fewer.");

/** Checkbox values from FormData ("on"/"true") or booleans. */
export const checkboxSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === "on" || value === "true");

export const intFromInput = (min: number, max: number, label = "Value") =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

export const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD date format.");
