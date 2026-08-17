import { formatDateTime } from "@/lib/dates";
import { bytesToBase64 } from "@/lib/encoding";
import type { LeaseDocumentView } from "@/lib/lease-document-view";

const ROLE_LABEL: Record<"LANDLORD" | "TENANT", string> = {
  LANDLORD: "Landlord",
  TENANT: "Tenant",
};

/**
 * The document itself, styled to print cleanly — this is the "PDF" a
 * landlord or tenant walks away with, via the browser's own Print → Save as
 * PDF, not a generated file. Always renders in light colors regardless of
 * the app's theme: a legal document shouldn't come out on dark paper because
 * a reader had dark mode on.
 */
export function LeaseDocumentPaper({ document }: { document: LeaseDocumentView }) {
  const p = document.lease.unit.property;
  const addressLine = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none sm:p-12">
      <header className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-xl font-semibold">{document.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {p.name} — Unit {document.lease.unit.label}
        </p>
        <p className="text-sm text-slate-500">
          {addressLine}, {p.city}, {p.state} {p.postalCode}
        </p>
      </header>

      <div className="whitespace-pre-wrap text-sm leading-relaxed">{document.body}</div>

      <section className="mt-10 border-t border-slate-200 pt-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Signatures</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {document.signatures.map((sig) => (
            <div key={sig.id} className="break-inside-avoid rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {ROLE_LABEL[sig.role]}
              </p>
              {sig.signedAt ? (
                <>
                  {sig.signatureImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small inline data URI, not a real asset Next's image pipeline should optimize
                    <img
                      src={`data:image/png;base64,${bytesToBase64(sig.signatureImage)}`}
                      alt={`${sig.signerName}'s signature`}
                      className="mt-2 h-14 max-w-full object-contain object-left"
                    />
                  ) : null}
                  <p className="mt-1 font-serif text-xl italic">{sig.typedSignature}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {sig.signerName} · {sig.signerEmail}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Signed electronically {formatDateTime(sig.signedAt)}
                    {sig.ipAddress ? ` · IP ${sig.ipAddress}` : ""}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400 italic">
                  Awaiting signature — {sig.signerName}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
