"use client";

import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import { updatePortfolioMappingAction } from "@/actions/portfolio-import";
import { PORTFOLIO_COLUMNS, type PortfolioMapping } from "@/lib/portfolio-import";

/** Field labels, in the order a person reads a rent roll left to right. */
const LABELS: Record<(typeof PORTFOLIO_COLUMNS)[number], { label: string; hint?: string }> = {
  propertyName: { label: "Property name", hint: "Falls back to the street address." },
  addressLine1: { label: "Street address" },
  city: { label: "City" },
  state: { label: "State" },
  postalCode: { label: "ZIP" },
  unitLabel: { label: "Unit", hint: 'Blank becomes "House".' },
  bedrooms: { label: "Bedrooms" },
  bathrooms: { label: "Bathrooms" },
  tenantName: { label: "Tenant name", hint: '"John Smith" or "Smith, John".' },
  tenantEmail: { label: "Tenant email", hint: "Missing emails get a placeholder." },
  tenantPhone: { label: "Tenant phone" },
  rentAmount: { label: "Monthly rent" },
  depositAmount: { label: "Security deposit" },
  leaseStart: { label: "Lease start", hint: "Blank becomes today." },
  leaseEnd: { label: "Lease end", hint: "Blank leaves it open-ended." },
};

export function MappingForm({
  batchId,
  headers,
  mapping,
}: {
  batchId: string;
  headers: string[];
  mapping: PortfolioMapping;
}) {
  const action = updatePortfolioMappingAction.bind(null, batchId);

  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PORTFOLIO_COLUMNS.map((column) => (
              <Field
                key={column}
                label={LABELS[column].label}
                name={column}
                state={state}
                hint={LABELS[column].hint}
              >
                <Select name={column} state={state} defaultValue={mapping[column] ?? ""}>
                  <option value="">Not in this file</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          <SubmitButton pendingLabel="Updating…">Update preview</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
