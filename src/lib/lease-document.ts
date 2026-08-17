import type { LeaseDocumentStatus } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { formatDate, ordinalDay } from "@/lib/dates";

/**
 * The lease-builder merge engine: turns a template's plain-text body plus a
 * lease's actual terms into the document a tenant will be asked to sign.
 *
 * Deliberately plain text, not HTML or markdown — the merged output is
 * rendered with `white-space: pre-wrap` (see LeaseDocumentPaper), so there's
 * no markup layer to sanitize or keep in sync with a renderer. Templates are
 * `{{token}}` substitution only; there's no conditional logic beyond which
 * optional clauses are appended, kept simple on purpose so a landlord who
 * isn't a developer can read and edit one directly in Settings.
 */

export type LeaseForDocument = {
  rentAmountCents: number;
  depositCents: number;
  startDate: Date;
  endDate: Date | null;
  rentDueDay: number;
  tenant: { firstName: string; lastName: string; email: string };
  unit: {
    label: string;
    property: {
      name: string;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
    };
  };
  organization: { name: string; graceDays: number; lateFeeCents: number };
};

type Clause = {
  id: string;
  label: string;
  hint: string;
  defaultOn: boolean;
  body: string; // may itself contain {{tokens}}
};

/**
 * The fixed catalog of optional provisions the builder lets staff toggle per
 * document. Kept in code rather than editable per-org, unlike the template
 * body itself — these are the common clauses almost every residential lease
 * needs a stance on, and letting the wording drift per-org would make "did
 * we include a pet clause" a lot harder to audit across a portfolio.
 */
export const LEASE_CLAUSES: Clause[] = [
  {
    id: "late_fee",
    label: "Late fee & grace period",
    hint: "Pulled from this organization's rent policy.",
    defaultOn: true,
    body: "Rent not received within {{grace_days}} day(s) of the due date is late. A late fee of {{late_fee_amount}} applies to each late payment, in addition to the rent owed.",
  },
  {
    id: "governing_law",
    label: "Governing law",
    hint: "States which state's law governs the lease.",
    defaultOn: true,
    body: "This Lease is governed by the laws of the State of {{state}}. Both parties remain subject to any additional local ordinances that apply to the Property.",
  },
  {
    id: "pets",
    label: "Pets",
    hint: "No pets without written landlord consent.",
    defaultOn: false,
    body: "No animal of any kind may be kept on the Property without the Landlord's prior written consent. Where consent is given, Landlord may require an additional pet deposit or pet rent, documented separately.",
  },
  {
    id: "parking",
    label: "Parking",
    hint: "Assigned/unassigned parking terms.",
    defaultOn: false,
    body: "Tenant's use of any parking space at the Property is included with this Lease but is not guaranteed to be reserved or assigned unless the parties agree otherwise in writing.",
  },
  {
    id: "smoking",
    label: "Smoke-free property",
    hint: "Prohibits smoking on the premises.",
    defaultOn: false,
    body: "Smoking of any kind is prohibited inside the premises and in any common areas of the Property. A violation of this provision is a material breach of this Lease.",
  },
  {
    id: "subletting",
    label: "No subletting",
    hint: "Requires written consent to sublet or assign.",
    defaultOn: false,
    body: "Tenant may not sublet the premises or assign this Lease, in whole or in part, without Landlord's prior written consent.",
  },
  {
    id: "utilities",
    label: "Utilities",
    hint: "Tenant responsible for utilities not covered by Landlord.",
    defaultOn: false,
    body: "Except for any utilities Landlord expressly agrees in writing to cover, Tenant is responsible for arranging and paying for all utility services to the premises, including electricity, gas, water, and internet/cable.",
  },
  {
    id: "maintenance",
    label: "Maintenance responsibilities",
    hint: "Who fixes what.",
    defaultOn: false,
    body: "Landlord is responsible for maintaining the Property in habitable condition and for repairs to major systems and appliances provided with the unit. Tenant is responsible for keeping the premises clean and promptly reporting needed repairs, and may be charged for damage beyond normal wear and tear.",
  },
  {
    id: "entry_notice",
    label: "Right of entry",
    hint: "Landlord notice before entering the unit.",
    defaultOn: false,
    body: "Landlord may enter the premises to inspect, make repairs, or show the unit after giving Tenant reasonable notice, except in the case of an emergency threatening life or property, where no notice is required.",
  },
];

export function defaultSelectedClauseIds(): string[] {
  return LEASE_CLAUSES.filter((c) => c.defaultOn).map((c) => c.id);
}

// Matches BadgeTone in src/components/ui.tsx — kept as this module's own type
// rather than importing a UI-layer type into framework-free domain logic,
// same separation as ApplicationStatusTone/InsuranceStatusTone.
export type LeaseDocumentStatusTone = "green" | "amber" | "blue" | "red" | "slate";

const DOCUMENT_STATUS_META: Record<LeaseDocumentStatus, { label: string; tone: LeaseDocumentStatusTone }> = {
  DRAFT: { label: "Draft", tone: "slate" },
  SENT: { label: "Awaiting signature", tone: "amber" },
  SIGNED: { label: "Signed", tone: "green" },
  VOIDED: { label: "Voided", tone: "red" },
};

export function leaseDocumentStatusLabel(status: LeaseDocumentStatus): string {
  return DOCUMENT_STATUS_META[status].label;
}

export function leaseDocumentStatusTone(status: LeaseDocumentStatus): LeaseDocumentStatusTone {
  return DOCUMENT_STATUS_META[status].tone;
}

function tokensFor(lease: LeaseForDocument): Record<string, string> {
  const p = lease.unit.property;
  const addressLines = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");
  return {
    organization_name: lease.organization.name,
    property_name: p.name,
    property_address: `${addressLines}, ${p.city}, ${p.state} ${p.postalCode}`,
    unit_label: lease.unit.label,
    tenant_name: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    tenant_email: lease.tenant.email,
    rent_amount: formatCents(lease.rentAmountCents),
    deposit_amount: formatCents(lease.depositCents),
    start_date: formatDate(lease.startDate),
    term_description: lease.endDate
      ? `and ends on ${formatDate(lease.endDate)}`
      : "and continues on a month-to-month basis until ended as provided by law",
    rent_due_day: ordinalDay(lease.rentDueDay),
    grace_days: String(lease.organization.graceDays),
    late_fee_amount: formatCents(lease.organization.lateFeeCents),
    state: p.state,
  };
}

const TOKEN_RE = /\{\{(\w+)\}\}/g;

/** Leaves an unrecognized `{{token}}` in place rather than silently dropping it — a typo in a template should be visible, not swallowed. */
export function mergeTokens(body: string, tokens: Record<string, string>): string {
  return body.replace(TOKEN_RE, (match, key: string) => (key in tokens ? tokens[key] : match));
}

/**
 * Renders the "Additional Provisions" section: each selected clause's body
 * (merged with the same tokens as the rest of the document), followed by any
 * free-text terms staff typed in by hand. Unknown clause ids are ignored —
 * a template edited to drop a clause shouldn't be able to resurrect it via a
 * stale form value.
 */
function renderAdditionalProvisions(
  selectedClauseIds: string[],
  tokens: Record<string, string>,
  extraTerms: string,
): string {
  const selected = new Set(selectedClauseIds);
  const parts = LEASE_CLAUSES.filter((c) => selected.has(c.id)).map(
    (c, i) => `${i + 1}. ${c.label.toUpperCase()}\n${mergeTokens(c.body, tokens)}`,
  );
  const extra = extraTerms.trim();
  if (extra) parts.push(`${parts.length + 1}. ADDITIONAL TERMS\n${extra}`);
  return parts.length > 0 ? parts.join("\n\n") : "None.";
}

/** Shared by the builder form's placeholder and createLeaseDocumentAction's fallback, so they can't drift apart. */
export function defaultDocumentTitle(lease: {
  tenant: { firstName: string; lastName: string };
  unit: { label: string; property: { name: string } };
}): string {
  return `Residential Lease — ${lease.tenant.firstName} ${lease.tenant.lastName} — ${lease.unit.property.name} ${lease.unit.label}`;
}

export function renderLeaseDocument(args: {
  templateBody: string;
  lease: LeaseForDocument;
  selectedClauseIds: string[];
  extraTerms?: string;
}): string {
  const tokens = tokensFor(args.lease);
  const withProvisions = {
    ...tokens,
    additional_provisions: renderAdditionalProvisions(
      args.selectedClauseIds,
      tokens,
      args.extraTerms ?? "",
    ),
  };
  return mergeTokens(args.templateBody, withProvisions).trim();
}

/**
 * Seeded into a new organization's first generated document, and editable
 * afterward at /app/settings/lease-template. Ordinary residential-lease
 * boilerplate — see docs/lease-signing.md for why this is a starting point
 * to review, not a substitute for state-specific legal advice.
 */
export const DEFAULT_TEMPLATE_BODY = `RESIDENTIAL LEASE AGREEMENT

This Lease Agreement ("Lease") is made between {{organization_name}} ("Landlord") and {{tenant_name}} ("Tenant") for the residential property described below.

1. PROPERTY
Landlord leases to Tenant the premises located at:
{{property_address}}
Unit: {{unit_label}}

2. TERM
This Lease begins on {{start_date}} {{term_description}}.

3. RENT
Tenant agrees to pay Landlord monthly rent of {{rent_amount}}, due on the {{rent_due_day}} of each month.

4. SECURITY DEPOSIT
Tenant shall pay a security deposit of {{deposit_amount}} prior to move-in, refundable subject to the condition of the premises at move-out and any applicable state law.

5. USE OF PREMISES
Tenant shall use the premises as a private residence only, and shall comply with all applicable laws, ordinances, and rules governing the Property.

6. ADDITIONAL PROVISIONS
{{additional_provisions}}

7. ENTIRE AGREEMENT
This Lease, together with any attachments referenced above, is the entire agreement between Landlord and Tenant regarding the Property and supersedes any prior discussions. Any changes to this Lease must be in writing and signed by both parties.

By signing below, both parties agree to the terms of this Lease.`;
