"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import {
  notifyScreeningConsentResponse,
  notifyScreeningRequested,
} from "@/lib/notifications";
import { screeningConsentAttemptAllowed } from "@/lib/rate-limit";
import { canRecordResults, canStartNewScreening } from "@/lib/screening";

/** Same header Cloudflare hands the rate limiter — see src/lib/rate-limit.ts. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("cf-connecting-ip");
}

async function clientUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

const boolField = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const requestSchema = z
  .object({
    wantCredit: boolField,
    wantBackground: boolField,
    wantEviction: boolField,
  })
  .refine((v) => v.wantCredit || v.wantBackground || v.wantEviction, {
    message: "Pick at least one report type.",
    path: ["wantCredit"],
  });

/**
 * Staff kicks off screening for an application. Doesn't pull anything itself
 * — it creates the consent request and emails the applicant the disclosure
 * link. See docs/tenant-screening.md.
 */
export async function requestScreeningAction(
  applicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(requestSchema, formData);
    if (!parsed.ok) return parsed.state;

    const application = await db.application.findFirst({
      where: { id: applicationId, organizationId: ctx.organizationId },
      select: {
        id: true,
        leaseId: true,
        firstName: true,
        email: true,
        organization: { select: { name: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
        screeningRequests: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!application) return actionError("That application no longer exists.");
    if (application.leaseId) {
      return actionError("This application already became a lease.");
    }

    const latest = application.screeningRequests[0]?.status ?? null;
    if (!canStartNewScreening(latest)) {
      return actionError(
        "There's already a screening request in progress for this application.",
      );
    }

    const consentToken = randomBytes(32).toString("base64url");

    await db.screeningRequest.create({
      data: {
        organizationId: ctx.organizationId,
        applicationId: application.id,
        wantCredit: parsed.data.wantCredit,
        wantBackground: parsed.data.wantBackground,
        wantEviction: parsed.data.wantEviction,
        consentToken,
        requestedById: ctx.id,
      },
    });

    await notifyScreeningRequested({
      to: { email: application.email, name: application.firstName },
      organizationId: ctx.organizationId,
      orgName: application.organization.name,
      propertyName: application.unit.property.name,
      unitLabel: application.unit.label,
      consentToken,
    });

    revalidatePath(`/app/applications/${applicationId}`);
    return actionOk("Screening requested — the applicant has been emailed for consent.");
  });
}

/** Staff calls off a request before the applicant has responded. */
export async function cancelScreeningRequestAction(
  screeningRequestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const request = await db.screeningRequest.findFirst({
      where: { id: screeningRequestId, organizationId },
      select: { id: true, status: true, applicationId: true },
    });
    if (!request) return actionError("That screening request no longer exists.");
    if (request.status !== "AWAITING_CONSENT") {
      return actionError("Only a request still awaiting consent can be canceled.");
    }

    await db.screeningRequest.update({
      where: { id: request.id },
      data: { status: "CANCELED" },
    });

    revalidatePath(`/app/applications/${request.applicationId}`);
    return actionOk("Screening request canceled.");
  });
}

const consentSchema = z.object({
  decision: z.enum(["consent", "decline"]),
});

/**
 * The applicant's response to /screening/[token] — no login, reached only by
 * the token in their email. Records the ESIGN-style audit trail (IP, user
 * agent, timestamp) the same way lease e-signatures do, for the same reason:
 * "permissible purpose" needs to be demonstrable later, not just asserted.
 * See docs/tenant-screening.md for how far that goes toward real FCRA
 * compliance (not all the way — read that file before relying on this).
 */
export async function respondToScreeningConsentAction(
  token: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    if (!(await screeningConsentAttemptAllowed())) {
      return actionError("Too many attempts. Please wait a minute and try again.");
    }

    const parsed = parseForm(consentSchema, formData);
    if (!parsed.ok) return parsed.state;

    const request = await db.screeningRequest.findUnique({
      where: { consentToken: token },
      select: {
        id: true,
        status: true,
        applicationId: true,
        organizationId: true,
        application: { select: { firstName: true, lastName: true } },
      },
    });
    if (!request) return actionError("This link isn't valid.");
    if (request.status !== "AWAITING_CONSENT") {
      return actionError("This request has already been responded to.");
    }

    const given = parsed.data.decision === "consent";
    const ip = await clientIp();
    const userAgent = await clientUserAgent();

    await db.screeningRequest.update({
      where: { id: request.id },
      data: given
        ? {
            status: "IN_PROGRESS",
            consentGivenAt: new Date(),
            consentIpAddress: ip,
            consentUserAgent: userAgent,
          }
        : {
            status: "DECLINED",
            consentDeclinedAt: new Date(),
            consentIpAddress: ip,
            consentUserAgent: userAgent,
          },
    });

    const staff = await db.user.findMany({
      where: { organizationId: request.organizationId, role: { in: ["ADMIN", "STAFF"] } },
      select: { email: true, name: true },
    });
    await Promise.all(
      staff.map((s) =>
        notifyScreeningConsentResponse({
          to: { email: s.email, name: s.name },
          organizationId: request.organizationId,
          applicantName: `${request.application.firstName} ${request.application.lastName}`,
          applicationId: request.applicationId,
          given,
        }),
      ),
    );

    return actionOk();
  });
}

const resultsSchema = z.object({
  resultSummary: optionalText(4000),
  reportUrl: optionalText(500),
});

/**
 * Staff records what came back. Nothing here pulls a report — this app has
 * no live provider integration (see docs/tenant-screening.md) — it's a place
 * to write down what happened wherever the report was actually run.
 */
export async function recordScreeningResultsAction(
  screeningRequestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(resultsSchema, formData);
    if (!parsed.ok) return parsed.state;

    const request = await db.screeningRequest.findFirst({
      where: { id: screeningRequestId, organizationId: ctx.organizationId },
      select: { id: true, status: true, applicationId: true },
    });
    if (!request) return actionError("That screening request no longer exists.");
    if (!canRecordResults(request.status)) {
      return actionError("Results can only be recorded once the applicant has consented.");
    }

    await db.screeningRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        resultSummary: parsed.data.resultSummary ?? null,
        reportUrl: parsed.data.reportUrl ?? null,
        completedAt: new Date(),
        completedById: ctx.id,
      },
    });

    revalidatePath(`/app/applications/${request.applicationId}`);
    return actionOk("Screening results saved.");
  });
}
