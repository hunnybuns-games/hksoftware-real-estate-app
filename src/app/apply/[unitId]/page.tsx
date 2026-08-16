import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { submitApplicationAction } from "@/actions/applications";
import { ApplicationForm } from "./_components/application-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ unitId: string }>;
}): Promise<Metadata> {
  const { unitId } = await params;
  const unit = await db.unit.findUnique({
    where: { id: unitId },
    select: { label: true, property: { select: { name: true } } },
  });
  return { title: unit ? `Apply — ${unit.property.name}` : "Apply" };
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const [{ unitId }, { submitted }] = await Promise.all([params, searchParams]);

  const unit = await db.unit.findUnique({
    where: { id: unitId },
    select: {
      id: true,
      label: true,
      bedrooms: true,
      bathrooms: true,
      sqft: true,
      marketRentCents: true,
      property: {
        select: {
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
        },
      },
    },
  });
  if (!unit) notFound();

  if (submitted) {
    return (
      <div className="card p-7 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Application received
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Thanks for applying to {unit.property.name} — {unit.label}. We&apos;ll be in touch by
          email once it&apos;s been reviewed.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Apply — {unit.property.name}, {unit.label}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {unit.property.addressLine1}
        {unit.property.addressLine2 ? `, ${unit.property.addressLine2}` : ""} · {unit.property.city},{" "}
        {unit.property.state}
      </p>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        {unit.bedrooms} bd · {unit.bathrooms} ba
        {unit.sqft ? ` · ${unit.sqft.toLocaleString()} sqft` : ""}
        {unit.marketRentCents > 0 ? ` · ${formatCents(unit.marketRentCents)}/mo` : ""}
      </p>

      <ApplicationForm action={submitApplicationAction.bind(null, unit.id)} />
    </div>
  );
}
