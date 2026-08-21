import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { disclosureScopeLine, FCRA_DISCLOSURE_PARAGRAPHS } from "@/lib/screening";
import { ConsentForm } from "./_components/consent-form";

export const metadata: Metadata = { title: "Screening consent" };

export default async function ScreeningConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const request = await db.screeningRequest.findUnique({
    where: { consentToken: token },
    select: {
      id: true,
      status: true,
      wantCredit: true,
      wantBackground: true,
      wantEviction: true,
      organization: { select: { name: true } },
      application: {
        select: {
          firstName: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });
  if (!request) notFound();

  const orgName = request.organization.name;
  const disclosure = FCRA_DISCLOSURE_PARAGRAPHS.map((p) => p.replaceAll("[ORGANIZATION NAME]", orgName));

  if (request.status !== "AWAITING_CONSENT") {
    return (
      <div className="card p-7 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {request.status === "IN_PROGRESS" || request.status === "COMPLETED"
            ? "Already handled"
            : "This link has already been used"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {request.status === "DECLINED"
            ? "You already declined this screening request. If that was a mistake, contact " +
              orgName +
              " directly."
            : "This screening request has already been responded to. There's nothing more to do here."}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Screening consent</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Hi {request.application.firstName} — {orgName} is asking for your consent before running a
        screening report for your application at {request.application.unit.property.name} —{" "}
        {request.application.unit.label}.
      </p>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {disclosure.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p className="font-medium">
          {disclosureScopeLine({
            wantCredit: request.wantCredit,
            wantBackground: request.wantBackground,
            wantEviction: request.wantEviction,
          })}
        </p>
      </div>

      <ConsentForm token={token} />
    </div>
  );
}
