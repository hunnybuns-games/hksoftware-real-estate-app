import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Defaults prefetch to false for every internal link in the authenticated
 * app. Next's default prefetch fires a real, DB-backed RSC fetch for every
 * link visible in the viewport — on a list page with dozens of rows, or the
 * always-visible sidebar, that's dozens of authenticated queries firing on
 * every page load, then again periodically as the prefetch cache
 * revalidates itself. better-sqlite3 is synchronous, so a big enough
 * backlog of those blocks the Node event loop badly enough to stall a real
 * request behind it — confirmed in testing: "Post rent charges" got stuck
 * mid-run after nothing more than browsing five list pages first.
 *
 * loading.tsx on the routes these links point at is what actually covers
 * the perceived-speed job prefetching was doing, so there's no gap this
 * leaves open. Pass `prefetch` explicitly on a specific Link to opt back in
 * where it's genuinely wanted.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
