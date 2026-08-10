"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { ActionState } from "@/lib/forms";

/**
 * Thin wrappers over React 19's form actions. The point is that every form in
 * the app gets pending state, error display and field-level errors without each
 * page re-implementing them.
 */

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  ...rest
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const variantClass = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    danger: "btn-danger",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      className={clsx(variantClass, className)}
      {...rest}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormError({ state }: { state: ActionState }) {
  if (!state || state.ok) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-200"
    >
      {state.error}
    </div>
  );
}

export function FormSuccess({ state }: { state: ActionState }) {
  if (!state?.ok || !state.message) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-200 dark:border-emerald-400/25 bg-emerald-50 dark:bg-emerald-500/12 px-3.5 py-2.5 text-sm text-emerald-800 dark:text-emerald-200"
    >
      {state.message}
    </div>
  );
}

export function Field({
  label,
  name,
  state,
  hint,
  children,
  required,
  className,
}: {
  label: string;
  name: string;
  state?: ActionState;
  hint?: ReactNode;
  children?: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">
        {label}
        {required ? <span className="ml-0.5 text-red-500 dark:text-red-400">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="hint">{hint}</p> : null}
      {error ? (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  name,
  state,
  className,
  ...rest
}: { name: string; state?: ActionState } & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return (
    <input
      id={name}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className={clsx("input", error && "input-error", className)}
      {...rest}
    />
  );
}

export function TextArea({
  name,
  state,
  className,
  ...rest
}: { name: string; state?: ActionState } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return (
    <textarea
      id={name}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className={clsx("input", error && "input-error", className)}
      {...rest}
    />
  );
}

export function Select({
  name,
  state,
  className,
  children,
  ...rest
}: { name: string; state?: ActionState } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return (
    <select
      id={name}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      className={clsx("input", error && "input-error", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

/** Text input prefixed with a `$` for dollar amounts. */
export function MoneyInput({
  name,
  state,
  ...rest
}: { name: string; state?: ActionState } & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">
        $
      </span>
      <input
        id={name}
        name={name}
        inputMode="decimal"
        placeholder="0.00"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={clsx("input pl-7", error && "input-error")}
        {...rest}
      />
    </div>
  );
}

/**
 * The standard form shell: binds an action, surfaces its state, and hands the
 * state back to the caller so fields can show their own errors.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  className?: string;
  successMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={clsx("space-y-4", className)}>
      <FormError state={state} />
      {successMessage ? <FormSuccess state={state} /> : null}
      {children(state)}
    </form>
  );
}
