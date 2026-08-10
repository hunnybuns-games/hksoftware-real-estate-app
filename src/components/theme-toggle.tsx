"use client";

import { useEffect, useSyncExternalStore } from "react";
import clsx from "clsx";
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  applyThemeChoice,
  readThemeChoice,
} from "@/lib/theme";

/**
 * Light / System / Dark, as a three-way segmented control.
 *
 * A single cycling button would be smaller, but this control has to answer
 * "which am I on?" at a glance, and with three states a cycle button can't —
 * you'd have to click through to find out.
 */

const LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  system: "System",
  dark: "Dark",
};

/*
 * The preference lives in localStorage, which is an external store, so it's read
 * through useSyncExternalStore rather than mirrored into state in an effect.
 * That's not just style: it's what lets the server render "System" and the
 * client correct it during hydration without a mismatch, and it's how a change
 * in one tab reaches the toggle in another.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // `storage` only fires in *other* tabs, which is exactly the case a same-tab
  // click can't cover. Re-apply the class there too, or the second tab would
  // show the right pressed button with the wrong colours.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyThemeChoice(readThemeChoice());
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * "system" during server render and hydration. The server has no way to know the
 * preference, and guessing would light up the wrong segment; the inline script in
 * the layout has already applied the correct *theme* by then, so the only thing
 * catching up here is which button looks pressed.
 */
const serverSnapshot = (): ThemeChoice => "system";

export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, serverSnapshot);

  /*
   * While on "system", follow the OS if it changes mid-session — someone with a
   * sunset-triggered schedule shouldn't have to reload. This only touches the
   * DOM, never React state: the *choice* is still "system" either way.
   */
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeChoice("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  function select(next: ThemeChoice) {
    applyThemeChoice(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failure. The theme still applies for this page
      // load; it just won't be remembered, which beats not working at all.
    }
    notify();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={clsx(
        "inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5",
        className,
      )}
    >
      {THEME_CHOICES.map((value) => {
        const selected = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(value)}
            className={clsx(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              selected
                ? "bg-surface text-slate-900 shadow-xs dark:shadow-none"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            {LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
