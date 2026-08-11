/**
 * Theme preference: the small amount of logic that both the server-rendered
 * inline script and the client toggle have to agree on.
 *
 * Three states, not two. "system" is a real choice and the default — most
 * people never touch a theme switch and expect an app to match the rest of
 * their machine. Storing only a boolean would lose the difference between "I
 * want light" and "I haven't said", so a user who picked light on a light OS
 * would silently flip to dark the day they change their OS setting.
 */

export const THEME_STORAGE_KEY = "rentwell-theme";

export const THEME_CHOICES = ["light", "system", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

/**
 * The stored preference, defaulting to "system". Anything unrecognised — a
 * hand-edited value, a key left over from an older build — is treated as
 * unset rather than trusted. Reading throws in some privacy modes, so it's
 * wrapped; see THEME_INIT_SCRIPT below for the same guard.
 */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Resolves a choice to a concrete theme and puts it on <html>. */
export function applyThemeChoice(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * The script that decides the theme before the first paint.
 *
 * This has to run synchronously in <head>, ahead of the body, or the browser
 * paints the light stylesheet first and every dark-mode user gets a white flash
 * on every navigation. That rules out doing it in a component effect, which is
 * why it's a string of JavaScript rather than React.
 *
 * Deliberately does the minimum: read the preference, resolve "system" against
 * the media query, set one class. Wrapped in try/catch because localStorage
 * throws outright in some privacy modes, and a theme preference is never worth
 * breaking the page over — the catch leaves the class off, which is light mode.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
