import { SITE, absoluteUrl } from "@/lib/site";

/**
 * JSON-LD for the public landing page.
 *
 * This is the machine-readable version of what the page already says in prose,
 * and that constraint is the point: structured data that claims something the
 * page doesn't support is what gets a site a manual action, so everything here
 * is traceable to visible copy. No aggregateRating, no review count, no `offers`
 * — this app has no ratings and its pricing isn't settled, and inventing either
 * to win a rich result is exactly the kind of thing that gets rich results
 * revoked.
 *
 * Emitted as one @graph rather than three separate script tags so the entities
 * can reference each other by @id — the WebSite is published by the
 * Organization, and the SoftwareApplication is the thing the WebSite is about.
 *
 * The nonce is threaded through because this app's CSP is nonce-based (see
 * src/middleware.ts). A `type="application/ld+json"` block is data rather than
 * executable script and browsers generally don't apply script-src to it, but
 * passing the nonce costs nothing and removes the question.
 */
export function StructuredData({ nonce, faqs }: { nonce?: string; faqs: { q: string; a: string }[] }) {
  const organizationId = absoluteUrl("/#organization");
  const websiteId = absoluteUrl("/#website");

  const graph = [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: SITE.name,
      url: absoluteUrl(),
      logo: absoluteUrl("/icon.svg"),
      description: SITE.description,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: absoluteUrl(),
      name: SITE.name,
      description: SITE.description,
      publisher: { "@id": organizationId },
      inLanguage: "en-US",
    },
    {
      "@type": "SoftwareApplication",
      "@id": absoluteUrl("/#software"),
      name: SITE.name,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Property Management Software",
      // It runs in a browser; naming a real requirement is more useful to a
      // crawler than the "Windows, macOS" boilerplate most listings carry.
      operatingSystem: "Web browser",
      url: absoluteUrl(),
      description: SITE.description,
      publisher: { "@id": organizationId },
      isAccessibleForFree: false,
      featureList: [
        "Property and unit tracking with occupancy",
        "Lease management with rent, deposit and due-day terms",
        "Section 8 / housing assistance payment splits",
        "Online rent collection by bank transfer",
        "Bank statement import and payment reconciliation",
        "Automatic bank feed sync",
        "Maintenance requests with photos",
        "Resident portal",
        "Owner statements with per-property access",
        "Rent roll and profit-and-loss reporting",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": absoluteUrl("/#faq"),
      // Sourced from the same array the page renders, so the two cannot drift.
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // The content is built above from our own constants, not from user input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
