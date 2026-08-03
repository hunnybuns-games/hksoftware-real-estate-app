"use client";

import {
  ActionForm,
  Field,
  MoneyInput,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/form";
import type { ActionState } from "@/lib/forms";

export type UnitOption = {
  id: string;
  label: string;
  propertyName: string;
  status: string;
  marketRent: string;
  hasActiveLease: boolean;
};

export type TenantOption = { id: string; name: string; email: string };

export type LeaseFormValues = {
  unitId: string;
  tenantId: string;
  status: "DRAFT" | "ACTIVE" | "ENDED";
  startDate: string;
  endDate: string;
  rent: string;
  deposit: string;
  rentDueDay: string;
  notes: string;
};

export function LeaseForm({
  action,
  units,
  tenants,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  units: UnitOption[];
  tenants: TenantOption[];
  defaults: LeaseFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Unit"
              name="unitId"
              state={state}
              required
              hint="Units with an active lease are marked so you don't double-book."
            >
              <Select name="unitId" state={state} defaultValue={defaults.unitId} required>
                <option value="">Choose a unit…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.propertyName} — {u.label}
                    {u.hasActiveLease ? " (leased)" : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tenant" name="tenantId" state={state} required>
              <Select name="tenantId" state={state} defaultValue={defaults.tenantId} required>
                <option value="">Choose a tenant…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.email}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Start date" name="startDate" state={state} required>
              <TextInput
                name="startDate"
                state={state}
                type="date"
                defaultValue={defaults.startDate}
                required
              />
            </Field>

            <Field
              label="End date"
              name="endDate"
              state={state}
              hint="Leave blank for month-to-month."
            >
              <TextInput name="endDate" state={state} type="date" defaultValue={defaults.endDate} />
            </Field>

            <Field label="Monthly rent" name="rentAmountCents" state={state} required>
              <MoneyInput
                name="rentAmountCents"
                state={state}
                defaultValue={defaults.rent}
                required
              />
            </Field>

            <Field label="Security deposit" name="depositCents" state={state} required>
              <MoneyInput
                name="depositCents"
                state={state}
                defaultValue={defaults.deposit}
                required
              />
            </Field>

            <Field
              label="Rent due on"
              name="rentDueDay"
              state={state}
              required
              hint="Day of the month, 1–28."
            >
              <Select name="rentDueDay" state={state} defaultValue={defaults.rentDueDay} required>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {ordinal(d)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Status"
              name="status"
              state={state}
              required
              hint="Only active leases are billed rent."
            >
              <Select name="status" state={state} defaultValue={defaults.status} required>
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft — not billed yet</option>
                <option value="ENDED">Ended</option>
              </Select>
            </Field>
          </div>

          <Field label="Notes" name="notes" state={state} hint="Internal only.">
            <TextArea name="notes" state={state} defaultValue={defaults.notes} rows={3} />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
            <a href={cancelHref} className="btn-ghost">
              Cancel
            </a>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
