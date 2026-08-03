"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, signIn } from "@/lib/auth";
import {
  type ActionState,
  actionError,
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
    const { name, organizationName, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return actionError("Please fix the highlighted fields.", {
        email: "An account with this email already exists. Try signing in instead.",
      });
    }

    const passwordHash = await hashPassword(password);

    try {
      await db.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: organizationName } });
        await tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            role: "ADMIN",
            organizationId: org.id,
          },
        });
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
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: invite.email,
            name,
            passwordHash,
            role: invite.role,
            organizationId: invite.organizationId,
          },
        });

        if (invite.tenantId) {
          await tx.tenant.update({
            where: { id: invite.tenantId },
            data: { userId: user.id },
          });
        }

        await tx.invitation.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
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

export async function signOutAction(): Promise<void> {
  const { signOut } = await import("@/lib/auth");
  await signOut({ redirectTo: "/login" });
  redirect("/login");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
