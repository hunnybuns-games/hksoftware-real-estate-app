import { appUrl, sendEmailSafely } from "@/lib/email";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * Email copy lives here so the wording is consistent and reviewable in one
 * place. Keep it plain and human — the audience is a tenant on a phone, not a
 * procurement department.
 */

type Recipient = { email: string; name: string };

export function notifyRentDue(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  amountCents: number;
  dueDate: Date;
  unitLabel: string;
  propertyName: string;
  dedupeKey: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "RENT_DUE",
    organizationId: args.organizationId,
    dedupeKey: args.dedupeKey,
    subject: `Rent of ${formatCents(args.amountCents)} is due ${formatDate(args.dueDate)}`,
    body: `Hi ${args.to.name},

This is a reminder that rent for ${args.propertyName} — ${args.unitLabel} is due on ${formatDate(args.dueDate)}.

Amount due: ${formatCents(args.amountCents)}

You can pay online here: ${appUrl("/portal")}

— ${args.orgName}`,
  });
}

export function notifyRentLate(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  amountCents: number;
  dueDate: Date;
  daysLate: number;
  dedupeKey: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "RENT_LATE",
    organizationId: args.organizationId,
    dedupeKey: args.dedupeKey,
    subject: `Rent is ${args.daysLate} day${args.daysLate === 1 ? "" : "s"} past due`,
    body: `Hi ${args.to.name},

Our records show a balance of ${formatCents(args.amountCents)} that was due on ${formatDate(args.dueDate)}.

If you've already sent payment, you can ignore this. Otherwise you can pay here: ${appUrl("/portal")}

If something's come up, please reply to this email and let us know — we'd rather hear from you than not.

— ${args.orgName}`,
  });
}

export function notifyRentReceived(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  amountCents: number;
  processing: boolean;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "RENT_RECEIVED",
    organizationId: args.organizationId,
    subject: args.processing
      ? `We've received your payment of ${formatCents(args.amountCents)}`
      : `Payment of ${formatCents(args.amountCents)} confirmed`,
    body: args.processing
      ? `Hi ${args.to.name},

We've received your payment of ${formatCents(args.amountCents)}. Bank transfers take a few business days to clear — we'll email you again once it settles.

— ${args.orgName}`
      : `Hi ${args.to.name},

Your payment of ${formatCents(args.amountCents)} has cleared. Thank you!

You can see your full payment history at ${appUrl("/portal")}

— ${args.orgName}`,
  });
}

export function notifyMaintenanceCreated(args: {
  to: Recipient;
  organizationId: string;
  requestId: string;
  title: string;
  unitLabel: string;
  propertyName: string;
  priority: string;
  submittedBy: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "MAINTENANCE_CREATED",
    organizationId: args.organizationId,
    subject: `New maintenance request: ${args.title}`,
    body: `${args.submittedBy} submitted a maintenance request.

Property: ${args.propertyName}
Unit: ${args.unitLabel}
Priority: ${args.priority}
Request: ${args.title}

Open it here: ${appUrl(`/app/maintenance/${args.requestId}`)}`,
  });
}

export function notifyMaintenanceUpdated(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  title: string;
  status: string;
  note?: string | null;
}) {
  const statusLabel = args.status.toLowerCase().replace("_", " ");
  return sendEmailSafely({
    to: args.to.email,
    type: "MAINTENANCE_UPDATED",
    organizationId: args.organizationId,
    subject: `Your maintenance request is ${statusLabel}: ${args.title}`,
    body: `Hi ${args.to.name},

Your request "${args.title}" is now marked ${statusLabel}.${
      args.note ? `\n\nNote from the team:\n${args.note}` : ""
    }

You can follow along at ${appUrl("/portal/maintenance")}

— ${args.orgName}`,
  });
}

export function notifyStaffInvite(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  inviterName: string;
  role: string;
  token: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "STAFF_INVITE",
    organizationId: args.organizationId,
    subject: `${args.inviterName} invited you to ${args.orgName}`,
    body: `Hi ${args.to.name},

${args.inviterName} has invited you to join ${args.orgName} as ${args.role.toLowerCase()}.

Accept the invitation and set your password here:
${appUrl(`/invite/${args.token}`)}

This link expires in 7 days.`,
  });
}

export function notifyTenantInvite(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  token: string;
  propertyName: string;
  unitLabel: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "TENANT_INVITE",
    organizationId: args.organizationId,
    subject: `Set up your resident portal for ${args.propertyName}`,
    body: `Hi ${args.to.name},

${args.orgName} has set up a resident portal for ${args.propertyName} — ${args.unitLabel}. You can use it to pay rent and submit maintenance requests.

Create your password here:
${appUrl(`/invite/${args.token}`)}

This link expires in 7 days.`,
  });
}

export function notifyApplicationReceived(args: {
  to: Recipient;
  organizationId: string;
  applicationId: string;
  applicantName: string;
  unitLabel: string;
  propertyName: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "APPLICATION_RECEIVED",
    organizationId: args.organizationId,
    subject: `New rental application: ${args.applicantName}`,
    body: `${args.applicantName} applied for ${args.propertyName} — ${args.unitLabel}.

Review it here: ${appUrl(`/app/applications/${args.applicationId}`)}`,
  });
}

/**
 * Sent to the applicant, not a signed-in user — there's no account behind this
 * address, so unlike every other notify* here this is never deduped or tied to
 * a recipient who could look the message up again later. Only sent for the two
 * decisions an applicant is actually waiting on; UNDER_REVIEW and WITHDRAWN
 * don't get an email.
 */
export function notifyApplicationDecided(args: {
  to: Recipient;
  organizationId: string;
  orgName: string;
  approved: boolean;
  propertyName: string;
  unitLabel: string;
}) {
  return sendEmailSafely({
    to: args.to.email,
    type: "APPLICATION_DECIDED",
    organizationId: args.organizationId,
    subject: args.approved
      ? `Your application for ${args.propertyName} — ${args.unitLabel} was approved`
      : `Update on your application for ${args.propertyName} — ${args.unitLabel}`,
    body: args.approved
      ? `Hi ${args.to.name},

Good news — your application for ${args.propertyName} — ${args.unitLabel} has been approved. ${args.orgName} will be in touch about next steps.`
      : `Hi ${args.to.name},

Thanks for applying for ${args.propertyName} — ${args.unitLabel}. ${args.orgName} has decided to go in a different direction for this unit. We appreciate your interest.`,
  });
}
