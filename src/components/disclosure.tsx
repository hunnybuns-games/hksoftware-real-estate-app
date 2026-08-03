import type { ReactNode } from "react";

/**
 * A native <details> disclosure styled as a button. Used for inline "add"
 * forms so a landlord can add three units in a row without three page loads,
 * with no client JS and no modal focus-trap to get wrong.
 */
export function Disclosure({
  label,
  children,
  variant = "secondary",
  open = false,
}: {
  label: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  open?: boolean;
}) {
  return (
    <details open={open} className="group">
      <summary
        className={`${variant === "primary" ? "btn-primary" : "btn-secondary"} cursor-pointer list-none`}
      >
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Close</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
