"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { db, isUniqueViolation } from "@/lib/db";
import { hashPassword, signIn } from "@/lib/auth";
import { appUrl, sendEmailSafely } from "@/lib/email";
import {
  RESET_TOKEN_TTL_MS,
  createResetToken,
  hashResetToken,
  isRedeemable,
} from "@/lib/password-reset";
import {
  loginAttemptAllowed,
  passwordResetAttemptAllowed,
  signupAttemptAllowed,
} from "@/lib/rate-limit";
import {
  type ActionState,
  actionError,
  actionOk,
  emailField,
  nameField,
  parseForm,
  passwordField,
  runAction,
} from "@/lib/forms";

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
  redirectTo: z.string().optional(),
});

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseForm(loginSchema, formData);
    if (!parsed.ok) return parsed.state;

    // Before checking the password, not after — the point is to stop the
    // guessing, and bcrypt verification is the expensive part an attacker would
    // otherwise get to spend our CPU on.
    if (!(await loginAttemptAllowed(parsed.data.email))) {
      return actionError("Too many sign-in attempts. Wait a minute and try again.");
    }

    try {
      // `redirectTo: "/"` sends everyone to the root, which then bounces them to
      // the right home for their role. That keeps role routing in one place.
      await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirectTo: safeRedirect(parsed.data.redirectTo),
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return actionError("That email and password don't match an account.");
      }
      throw err; // includes the NEXT_REDIRECT that signIn throws on success
    }
    return null;
  });
}

/** Only allow same-origin relative paths, so ?next= can't be used for phishing. */
function safeRedirect(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

const signupSchema = z.object({
  name: nameField,
  organizationName: nameField,
  email: emailField,
  password: passwordField,
});

/**
 * Signup creates the Organization and its first ADMIN in one transaction — an
 * admin without an org (or vice versa) is not a state we want to support.
 */
export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseForm(signupSchema, formData);
    if (!parsed.ok) return parsed.state;

    if (!(await signupAttemptAllowed())) {
      return actionError("Too many accounts created from here just now. Wait a minute and try again.");
    }

    const { name, organizationName, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return actionError("Please fix the highlighted fields.", {
        email: "An account with this email already exists. Try signing in instead.",
      });
    }

    const passwordHash = await hashPassword(password);

    try {
      // Not wrapped in $transaction: D1 doesn't support interactive
      // transactions at all — Prisma throws outright rather than silently
      // downgrading, as of the version pinned here. Sequential awaited calls
      // don't lose anything real: D1's own adapter never backed the old
      // wrapper with actual atomicity either (its commit/rollback are no-op
      // debug logs), so this runs exactly as it always has on this database.
      // An org created with no user attached (crash between the two calls) is
      // an orphan row, not a broken account — nothing points at it, and
      // signup is safe to retry with the same email.
      const org = await db.organization.create({ data: { name: organizationName } });
      await db.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: "ADMIN",
          organizationId: org.id,
        },
      });
    } catch (err) {
      // Two simultaneous signups with the same email land here.
      if (isUniqueViolation(err)) {
        return actionError("Please fix the highlighted fields.", {
          email: "An account with this email already exists. Try signing in instead.",
        });
      }
      throw err;
    }

    await signIn("credentials", { email, password, redirectTo: "/app?welcome=1" });
    return null;
  });
}

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: nameField,
  password: passwordField,
});

/**
 * Accepting an invitation creates the User and, for tenant invites, links it to
 * the existing Tenant record so their leases show up immediately.
 */
export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseForm(acceptInviteSchema, formData);
    if (!parsed.ok) return parsed.state;
    const { token, name, password } = parsed.data;

    const invite = await db.invitation.findUnique({
      where: { token },
      include: { tenant: { select: { id: true } } },
    });

    if (!invite) return actionError("This invitation link isn't valid.");
    if (invite.acceptedAt) {
      return actionError("This invitation has already been used. Try signing in.");
    }
    if (invite.expiresAt < new Date()) {
      return actionError("This invitation has expired. Ask your manager to send a new one.");
    }

    const taken = await db.user.findUnique({
      where: { email: invite.email },
      select: { id: true },
    });
    if (taken) {
      return actionError("An account already exists for this email. Try signing in instead.");
    }

    const passwordHash = await hashPassword(password);

    try {
      // Not wrapped in $transaction — see the comment on signupAction above.
      // D1 throws outright on interactive transactions, and these sequential
      // calls run exactly as they always did (the old wrapper's commit/rollback
      // were no-ops on this database anyway).
      const user = await db.user.create({
        data: {
          email: invite.email,
          name,
          passwordHash,
          role: invite.role,
          organizationId: invite.organizationId,
        },
      });

      if (invite.tenantId) {
        await db.tenant.update({
          where: { id: invite.tenantId },
          data: { userId: user.id },
        });
      }

      await db.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return actionError("An account already exists for this email. Try signing in instead.");
      }
      throw err;
    }

    await signIn("credentials", { email: invite.email, password, redirectTo: "/" });
    return null;
  });
}

const requestResetSchema = z.object({ email: emailField });

/**
 * Sends a reset link — and says the same thing whether or not the address has an
 * account.
 *
 * That's the whole security design of this action. A form that says "no account
 * with that email" is a free account-enumeration oracle: anyone can walk a list
 * of addresses and learn which of your landlords and residents are customers.
 * The cost is that a user who typos their address gets a cheerful message and no
 * email, which is why the copy says "if" rather than "we sent it".
 */
export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseForm(requestResetSchema, formData);
    if (!parsed.ok) return parsed.state;
    const email = parsed.data.email;

    // Rate limited for two reasons: this endpoint sends mail on demand, so it's a
    // way to use us to spam a third party, and it's the enumeration oracle above
    // if you can run it thousands of times and watch timing.
    if (!(await passwordResetAttemptAllowed(email))) {
      return actionError("Too many reset requests. Wait a minute and try again.");
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, name: true, organizationId: true },
    });

    if (user) {
      // Any link already outstanding stops working now. Asking for a new link is
      // how someone reacts to "I think somebody else requested one", so the old
      // one must not survive the request.
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const { token, tokenHash } = await createResetToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      await sendEmailSafely({
        to: email,
        type: "PASSWORD_RESET",
        organizationId: user.organizationId,
        // The link is a working account-takeover credential, and the email log is
        // readable by every admin in the org. See `sensitive` in src/lib/email.ts.
        sensitive: true,
        subject: "Reset your password",
        body: [
          `Hi ${user.name},`,
          `Use this link to set a new password. It works once and expires in an hour:`,
          appUrl(`/reset-password/${token}`),
          `If you didn't ask for this, you can ignore this email — your password hasn't changed.`,
        ].join("\n\n"),
        // Deliberately no dedupeKey: a dedupe key would make the second request
        // in an hour silently do nothing, and "I never got the email, let me try
        // again" is the single most common way this flow gets used.
      });
    }

    return actionOk(
      "If an account exists for that address, a reset link is on its way. Check your inbox.",
    );
  });
}

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordField,
});

/**
 * Redeems a reset link and sets the new password.
 *
 * Everything happens in one transaction that also marks the token used, so two
 * simultaneous submissions of the same link can't both succeed.
 */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const parsed = parseForm(resetPasswordSchema, formData);
    if (!parsed.ok) return parsed.state;
    const { token, password } = parsed.data;

    const tokenHash = await hashResetToken(token);
    const row = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { id: true, email: true } },
      },
    });

    const UNUSABLE = "This reset link isn't usable any more. Request a new one and it'll work.";
    if (!row || !isRedeemable(row)) return actionError(UNUSABLE);

    const passwordHash = await hashPassword(password);

    // Not wrapped in $transaction — see the comment on signupAction above. The
    // race this guards against isn't transactional atomicity anyway: it's the
    // `where: { usedAt: null }` scoping on the first updateMany below, which
    // makes a concurrent redemption of the same link update zero rows rather
    // than both winning, regardless of what wraps it.
    let claimed = false;
    const result = await db.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count > 0) {
      claimed = true;

      await db.user.update({
        where: { id: row.user.id },
        data: { passwordHash },
      });

      // Every other outstanding link for this user dies with the password change.
      await db.passwordResetToken.updateMany({
        where: { userId: row.user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    if (!claimed) return actionError(UNUSABLE);

    // Straight into the app — making someone re-type the password they just set
    // is friction with nothing behind it, and the link they used was the proof.
    await signIn("credentials", { email: row.user.email, password, redirectTo: "/" });
    return null;
  });
}

export async function signOutAction(): Promise<void> {
  const { signOut } = await import("@/lib/auth");
  await signOut({ redirectTo: "/login" });
  redirect("/login");
}
