import { z } from "zod";
import { AuthorizationError, NotFoundError } from "@/lib/rbac";

/**
 * Every server action in this app returns the same shape, so every form can use
 * the same `useActionState` wiring and the same <FormError/> component.
 */
export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export function actionError(error: string, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, error, fieldErrors };
}

export function actionOk(message?: string): ActionState {
  return { ok: true, message };
}

/** Flattens a Zod error into one message per field, first message wins. */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.output<S> } | { ok: false; state: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue; // files are handled explicitly
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      state: actionError("Please fix the highlighted fields.", fieldErrorsFrom(result.error)),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Wraps an action body so authorization/not-found failures become form errors
 * and unexpected failures are logged without leaking internals to the browser.
 * `redirect()` throws internally in Next, so that control-flow signal is
 * deliberately re-thrown.
 */
export async function runAction(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof AuthorizationError) return actionError(err.message);
    if (err instanceof NotFoundError) return actionError(err.message);
    console.error("[action] unhandled failure", err);
    return actionError("Something went wrong on our end. Please try again.");
  }
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (err as { digest: string }).digest === "NEXT_NOT_FOUND")
  );
}

// --- reusable field schemas -------------------------------------------------

export const emailField = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("That doesn't look like an email address.")
  .transform((v) => v.toLowerCase());

export const passwordField = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.");

export const nameField = z.string().trim().min(1, "Required.").max(120, "Too long.");

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, "Too long.")
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/** Dollar-amount text input -> cents. */
export const centsField = (label = "Amount") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine((v) => /^\$?\s*\d{1,9}(,\d{3})*(\.\d{1,2})?$|^\$?\s*\d+(\.\d{1,2})?$/.test(v), {
      message: `Enter ${label.toLowerCase()} as a dollar amount, e.g. 1850 or 1850.00.`,
    })
    .transform((v) => Math.round(Number(v.replace(/[$,\s]/g, "")) * 100));

/** Dollar-amount text input -> cents, or null when left blank. */
export const optionalCentsField = (label = "Amount") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine(
      (v) =>
        v === "" ||
        /^\$?\s*\d{1,9}(,\d{3})*(\.\d{1,2})?$|^\$?\s*\d+(\.\d{1,2})?$/.test(v),
      { message: `Enter ${label.toLowerCase()} as a dollar amount, e.g. 1850 or 1850.00.` },
    )
    .transform((v) => (v === "" ? null : Math.round(Number(v.replace(/[$,\s]/g, "")) * 100)));

export const dateField = (label = "Date") =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required.`)
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), `${label} isn't a real date.`);

export const optionalDateField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "That isn't a real date.");

export const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} can be at most ${max}.`);

/** Whole-number text input -> number, or null when left blank. */
export const optionalIntField = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v === "" || /^\d+$/.test(v), `${label} must be a whole number.`)
    .transform((v) => (v === "" ? null : Number(v)))
    .refine(
      (v) => v === null || (v >= min && v <= max),
      `${label} must be between ${min} and ${max}.`,
    );
