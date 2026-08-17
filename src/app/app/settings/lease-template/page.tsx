import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { ensureDefaultTemplate, updateLeaseTemplateAction } from "@/actions/lease-templates";
import { LEASE_CLAUSES } from "@/lib/lease-document";
import { Card } from "@/components/ui";
import { LeaseTemplateForm } from "../_components/lease-template-form";

export const metadata: Metadata = { title: "Lease template" };

export default async function LeaseTemplateSettingsPage() {
  const ctx = await requireStaff();
  const template = await ensureDefaultTemplate(ctx.organizationId);

  return (
    <div className="max-w-3xl space-y-6">
      <Card
        title="Standard lease template"
        description="The base wording every new lease document starts from. Editing this doesn't change any document already generated — see Generate lease document on a lease."
      >
        <LeaseTemplateForm
          action={updateLeaseTemplateAction.bind(null, template.id)}
          defaults={{ name: template.name, body: template.body }}
        />
      </Card>

      <Card title="Optional clauses">
        <p className="mb-4 text-sm text-slate-600">
          These are chosen per lease when a document is generated — they&apos;re not part of the
          template text above. Each one is inserted into{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">{"{{additional_provisions}}"}</code>{" "}
          only when picked.
        </p>
        <ul className="divide-y divide-slate-100 text-sm">
          {LEASE_CLAUSES.map((clause) => (
            <li key={clause.id} className="flex items-start justify-between gap-4 py-2.5">
              <div>
                <p className="font-medium text-slate-900">{clause.label}</p>
                <p className="text-xs text-slate-500">{clause.hint}</p>
              </div>
              {clause.defaultOn ? (
                <span className="shrink-0 text-xs text-slate-400">On by default</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
