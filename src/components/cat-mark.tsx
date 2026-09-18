/**
 * The brand mark: an orange cat asleep on a blue cushion. Same drawing as
 * src/app/icon.svg — that file is the favicon and is what the raster app
 * icons are rendered from, so if the mark changes, change it there first and
 * mirror the paths here. Kept as JSX rather than an <img> so it inherits
 * nothing it shouldn't and can be dropped into other SVG scenes at any scale
 * (see src/app/_components/hero-scene.tsx).
 *
 * Colours are literals on purpose. The cushion is the brand blue resolved out
 * of oklch(); the cat's orange, stripe and eye colours are illustration
 * colours, not UI tokens, and they look the same in both themes.
 */

export const CAT = {
  cushion: "#1f6f8b",
  fur: "#e8923a",
  stripe: "#c7712a",
  eye: "#4a2a10",
} as const;

/** The shapes alone, in the 32-unit space, for composing into a bigger drawing. */
export function CatShapes() {
  return (
    <>
      <path
        d="M1 22c0-3 6.5-5.5 15-5.5s15 2.5 15 5.5c0 4.5-6.5 8-15 8S1 26.5 1 22z"
        fill={CAT.cushion}
      />
      <path
        d="M27.5 19c2.8 1.2 2.4 5-1.6 5"
        fill="none"
        stroke={CAT.fur}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M4.5 19.5C1.5 15 4 8.5 10 8.5c2.5 0 3.5 1.2 4.5 1.2 8-1 13 3.2 13 8 0 2.2-2.2 3.8-5 3.8H7.5c-1.8 0-3-1-3-2z"
        fill={CAT.fur}
      />
      <path
        d="M5.4 11.2C4.4 9.2 4.2 6.6 4.9 4.4c2 .9 3.9 2.5 5.4 4.6z"
        fill={CAT.fur}
        stroke={CAT.fur}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12.2 9.5c1-2.2 2.2-4 3.6-5.2.9 1.8 1.3 3.9 1.3 6z"
        fill={CAT.fur}
        stroke={CAT.fur}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 12.3l-1 3.2M23 12.8l-1 3.2"
        fill="none"
        stroke={CAT.stripe}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7.2 15q1.2 1.1 2.5 0M12.2 15q1.2 1.1 2.5 0"
        fill="none"
        stroke={CAT.eye}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  );
}

/** The mark as a standalone image. Size it with a className (`size-7`, etc). */
export function CatMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <CatShapes />
    </svg>
  );
}
