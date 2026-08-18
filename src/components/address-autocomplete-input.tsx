"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ActionState } from "@/lib/forms";
import {
  buildForwardGeocodeUrl,
  mapboxEnabled,
  parseMapboxFeature,
  suggestionLabel,
  type MapboxFeature,
  type ParsedAddress,
} from "@/lib/geocoding";

/**
 * A plain text input that, when NEXT_PUBLIC_MAPBOX_TOKEN is configured,
 * offers live address suggestions and fills in the sibling city/state/ZIP
 * fields when one is picked. With no token set it's indistinguishable from
 * TextInput — the lookup is skipped entirely, never a broken or half-working
 * dropdown. See src/lib/geocoding.ts and docs/address-autocomplete.md.
 *
 * A suggestion is a convenience, not a gate: every field this fills in stays
 * a normal editable input, so a wrong or missing suggestion never blocks
 * typing the address by hand.
 */
export function AddressAutocompleteInput({
  name,
  state,
  value,
  onValueChange,
  onSelect,
  className,
  ...rest
}: {
  name: string;
  state?: ActionState;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires when a suggestion is picked — not to be confused with the native DOM text-selection event of the same name, which this shadows on purpose. */
  onSelect: (parsed: ParsedAddress) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "name" | "onSelect">) {
  const error = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Cancel any in-flight lookup and pending debounce on unmount, so a slow
  // response can't call setState after the form has moved on.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function scheduleLookup(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!mapboxEnabled() || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const url = buildForwardGeocodeUrl(query);
      if (!url) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Mapbox request failed: ${res.status}`);
        const data: unknown = await res.json();
        const features =
          data && typeof data === "object" && Array.isArray((data as { features?: unknown }).features)
            ? ((data as { features: MapboxFeature[] }).features)
            : [];
        setSuggestions(features);
        setOpen(features.length > 0);
      } catch (err) {
        // A network hiccup or bad token degrades to "no suggestions" — the
        // field itself is never disrupted, see the module comment above.
        if ((err as Error).name !== "AbortError") setSuggestions([]);
      }
    }, 250);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={name}
        name={name}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          scheduleLookup(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        // The browser's own address-book autofill would compete with these
        // suggestions for the same field — this component is the autofill.
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${name}-listbox`}
        aria-autocomplete="list"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={clsx("input", error && "input-error", className)}
        {...rest}
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={`${name}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-surface shadow-lg"
        >
          {suggestions.map((feature, i) => (
            <li key={i} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onSelect(parseMapboxFeature(feature));
                  setSuggestions([]);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {suggestionLabel(feature)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
