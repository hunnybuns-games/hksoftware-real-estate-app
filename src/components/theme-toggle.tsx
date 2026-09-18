"use client";

import { useSyncExternalStore } from "react";
import clsx from "clsx";
import {
  THEME_STORAGE_KEY,
  type ThemeChoice,
  applyThemeChoice,
  readThemeChoice,
  resolveTheme,
} from "@/lib/theme";

/**
 * Light or dark, as one round button: a circle that is white on top and dark
 * underneath. Pressing it flips to the other theme; in dark mode the circle
 * turns over so the dark half is on top, which is how it answers "which am I
 * on?" without a label.
 *
 * There used to be a third option, System. It's gone from the control but
 * not from the model: with nothing stored, the theme still follows the OS
 * (see THEME_INIT_SCRIPT). The first press stores an explicit choice and
 * from then on the page keeps it. That is what people expect from a switch
 * — the OS option was a setting for the one person in a hundred who
 * wanted to explain the difference.
 */

/*
 * The preference lives in localStorage, which is an external store, so it's read
 * through useSyncExternalStore rather than mirrored into state in an effect.
 * That's what lets the server render a neutral state and the client correct it
 * during hydration without a mismatch, and it's how a change in one tab
 * reaches the toggle in another.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // `storage` only fires in *other* tabs, which is exactly the case a same-tab
  // click can't cover. Re-apply the class there too, or the second tab would
  // show the right button state with the wrong colours.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyThemeChoice(readThemeChoice());
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  // With nothing stored the theme follows the OS, so an OS change mid-session
  // (a sunset schedule) has to reach both the class and this control.
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    applyThemeChoice(readThemeChoice());
    onStoreChange();
  };
  query.addEventListener("change", onScheme);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
    query.removeEventListener("change", onScheme);
  };
}

/** What's actually on screen right now — the stored choice resolved against the OS. */
function readResolved(): "light" | "dark" {
  return resolveTheme(readThemeChoice());
}

/**
 * "light" during server render and hydration. The server can't know, and the
 * inline script in the layout has already painted the correct theme by then;
 * the only thing catching up here is the switch's aria state. The orb itself
 * doesn't wait for React at all — its rotation is keyed on the html class
 * via `dark:`, so it's right from the first paint.
 */
const serverSnapshot = (): "light" | "dark" => "light";

export function ThemeToggle({ className }: { className?: string }) {
  const resolved = useSyncExternalStore(subscribe, readResolved, serverSnapshot);
  const dark = resolved === "dark";

  function flip() {
    const next: ThemeChoice = dark ? "light" : "dark";
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
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={flip}
      className={clsx(
        "inline-flex size-8 items-center justify-center rounded-full text-slate-500",
        "hover:bg-slate-100 hover:text-slate-700",
        className,
      )}
    >
      {/*
       * Literal colours, not tokens: this circle depicts light and dark, it
       * doesn't wear the theme. The outline is the one themed part, so the orb
       * has an edge against either background.
       */}
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="size-5 transition-transform duration-300 motion-reduce:transition-none dark:rotate-180"
      >
        <path d="M1 10a9 9 0 0 1 18 0z" fill="#ffffff" />
        <path d="M1 10a9 9 0 0 0 18 0z" fill="#1b2630" />
        <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}
