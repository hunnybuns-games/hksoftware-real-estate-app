import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  tenantId: string | null;
};

/** Any signed-in user. Redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
    organizationId: session.user.organizationId,
    tenantId: session.user.tenantId,
  };
}

/**
 * The landing route for a role. Used after login and by the guards below so a
 * user who wanders into the wrong area lands somewhere useful instead of a 403.
 */
export function homeFor(user: Pick<SessionUser, "role" | "organizationId">): string {
  switch (user.role) {
    case "TENANT":
      return "/portal";
    case "OWNER":
      return "/owner";
    case "ADMIN":
    case "STAFF":
      return user.organizationId ? "/app" : "/onboarding";
  }
}

export type StaffContext = SessionUser & { organizationId: string };

/** ADMIN or STAFF, with an organization. This is the management app's guard. */
export async function requireStaff(): Promise<StaffContext> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "STAFF") redirect(homeFor(user));
  if (!user.organizationId) redirect("/onboarding");
  return { ...user, organizationId: user.organizationId };
}

/** ADMIN only — team management, Stripe connection, org settings. */
export async function requireAdmin(): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (ctx.role !== "ADMIN") redirect("/app");
  return ctx;
}

export type TenantContext = SessionUser & { tenantId: string };

export async function requireTenant(): Promise<TenantContext> {
  const user = await requireUser();
  if (user.role !== "TENANT" || !user.tenantId) redirect(homeFor(user));
  return { ...user, tenantId: user.tenantId };
}

export type OwnerContext = SessionUser & {
  organizationId: string;
  propertyIds: string[];
};

/** OWNER — read-only, limited to the properties explicitly assigned to them. */
export async function requireOwner(): Promise<OwnerContext> {
  const user = await requireUser();
  if (user.role !== "OWNER" || !user.organizationId) redirect(homeFor(user));
  const links = await db.propertyOwner.findMany({
    where: { userId: user.id, property: { organizationId: user.organizationId } },
    select: { propertyId: true },
  });
  return {
    ...user,
    organizationId: user.organizationId,
    propertyIds: links.map((l) => l.propertyId),
  };
}

/**
 * Thrown by action-layer assertions. Server actions catch this and return it as
 * a form error rather than crashing the page.
 */
export class AuthorizationError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Staff org id for use inside `generateMetadata`. That function runs
 * independently of the page body — its own `requireStaff()` redirect does
 * not protect it — and metadata generation must never throw or redirect, so
 * this returns null (rather than the guards above) on anything short of a
 * signed-in ADMIN/STAFF with an organization. Callers fall back to a generic
 * title when this is null, and must still scope their own lookup by the
 * returned organizationId — this only tells you who's asking, not what
 * they're allowed to see.
 */
export async function staffOrganizationIdForMetadata(): Promise<string | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  if (user.role !== "ADMIN" && user.role !== "STAFF") return null;
  return user.organizationId ?? null;
}

/**
 * Server-action equivalents of the guards above. Actions must not `redirect()`
 * on an authorization failure — they return a field error instead.
 */
export async function assertStaff(): Promise<StaffContext> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) throw new AuthorizationError("You need to sign in.");
  if (u.role !== "ADMIN" && u.role !== "STAFF") throw new AuthorizationError();
  if (!u.organizationId) throw new AuthorizationError("No organization yet.");
  return {
    id: u.id,
    email: u.email ?? "",
    name: u.name ?? "",
    role: u.role,
    organizationId: u.organizationId,
    tenantId: u.tenantId,
  };
}

export async function assertAdmin(): Promise<StaffContext> {
  const ctx = await assertStaff();
  if (ctx.role !== "ADMIN") {
    throw new AuthorizationError("Only an admin can do that.");
  }
  return ctx;
}

export async function assertTenant(): Promise<TenantContext> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) throw new AuthorizationError("You need to sign in.");
  if (u.role !== "TENANT" || !u.tenantId) throw new AuthorizationError();
  return {
    id: u.id,
    email: u.email ?? "",
    name: u.name ?? "",
    role: u.role,
    organizationId: u.organizationId,
    tenantId: u.tenantId,
  };
}

/**
 * Server-action/API-route equivalent of requireOwner. Used by the CSV export
 * routes, which need JSON error responses rather than a page redirect.
 */
export async function assertOwner(): Promise<OwnerContext> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) throw new AuthorizationError("You need to sign in.");
  if (u.role !== "OWNER" || !u.organizationId) throw new AuthorizationError();

  const links = await db.propertyOwner.findMany({
    where: { userId: u.id, property: { organizationId: u.organizationId } },
    select: { propertyId: true },
  });

  return {
    id: u.id,
    email: u.email ?? "",
    name: u.name ?? "",
    role: u.role,
    organizationId: u.organizationId,
    tenantId: u.tenantId,
    propertyIds: links.map((l) => l.propertyId),
  };
}
