"use client";

import { useState } from "react";
import clsx from "clsx";

/** Copies fixed text to the clipboard and shows a brief "Copied!" confirmation. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access can be denied by the browser; nothing useful to
          // recover into beyond just not showing the "Copied!" confirmation.
        }
      }}
      className={clsx("btn-secondary", className)}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
