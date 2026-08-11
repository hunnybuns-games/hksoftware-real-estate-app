import { cache } from "react";
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

/**
 * Reads the signed-in user's *current* state from the database rather than
 * trusting what the session token says.
 *
 * Sessions here are stateless JWTs with a 30-day lifetime, so a token keeps
 * asserting whatever was true when it was issued. Without this lookup:
 *
 *  - removing a team member didn't revoke anything — their existing login kept
 *    full access to the organization they'd been removed from, for up to a
 *    month;
 *  - demoting an admin to staff didn't take effect until their token happened
 *    to refresh;
 *  - and a token naming an organization that no longer exists sailed through
 *    every guard, leaving pages to render blank when their own queries came
 *    back empty (which is exactly how this surfaced: two settings tabs going
 *    silently empty after a database restore rolled past a signup).
 *
 * Wrapped in React's cache() so the several guard calls in one render — a
 * layout and its page both calling requireStaff(), typically — collapse to a
 * single query per request.
 */
const loadLiveUser = cache(async (userId: string): Promise<SessionUser | null> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      organization: { select: { id: true } },
      tenant: { select: { id: true } },
    },
  });
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    // The database is authoritative for both of these, not the token.
    role: user.role,
    // If the organization row is gone, report no organization rather than a
    // dangling id. The guards below then route to onboarding, which is a
    // recoverable state, instead of letting a page render nothing.
    organizationId: user.organization ? user.organizationId : null,
    tenantId: user.tenant?.id ?? null,
  };
});

/**
 * The signed-in user as the database currently sees them, or null if nobody is
 * signed in *or* the token names an account that no longer exists.
 *
 * Anything that *routes* on whether someone is signed in — the root page, the
 * login page — must use this rather than calling auth() directly. If those
 * pages decide from the raw token while the guards below decide from the
 * database, the two disagree about a stale session and bounce redirects off
 * each other indefinitely (/app → /login → / → /app → …). That loop is not
 * hypothetical: it's what this returned before the helper existed.
 */
export async function liveSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return loadLiveUser(session.user.id);
}

/**
 * Any signed-in user whose account still exists. Redirects to /login otherwise
 * — which covers both "never signed in" and "signed in with a token whose user
 * has since been deleted".
 */
export async function requireUser(): Promise<SessionUser> {
  const live = await liveSessionUser();
  if (!live) redirect("/login");
  return live;
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

// There is deliberately no requireAdmin() page guard. Admin-only *screens*
// don't exist: settings, team and payments all use requireStaff() and then
// render read-only for a STAFF viewer (see `isAdmin` / `readOnly` in those
// pages), so staff can see the configuration they work under without being
// able to change it. Admin is enforced on the writes instead, by assertAdmin()
// below — which is the boundary that actually matters.

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
 *
 * These matter more than the page guards, because they gate writes: a removed
 * employee hitting a stale browser tab shouldn't just be unable to *read* the
 * org, they shouldn't be able to edit a lease or void a payment either. Same
 * database-backed check, same cached lookup.
 */
async function liveUserOrThrow(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthorizationError("You need to sign in.");
  const live = await loadLiveUser(session.user.id);
  if (!live) throw new AuthorizationError("Your account is no longer active. Please sign in again.");
  return live;
}

export async function assertStaff(): Promise<StaffContext> {
  const u = await liveUserOrThrow();
  if (u.role !== "ADMIN" && u.role !== "STAFF") throw new AuthorizationError();
  if (!u.organizationId) throw new AuthorizationError("No organization yet.");
  return { ...u, organizationId: u.organizationId };
}

export async function assertAdmin(): Promise<StaffContext> {
  const ctx = await assertStaff();
  if (ctx.role !== "ADMIN") {
    throw new AuthorizationError("Only an admin can do that.");
  }
  return ctx;
}

export async function assertTenant(): Promise<TenantContext> {
  const u = await liveUserOrThrow();
  if (u.role !== "TENANT" || !u.tenantId) throw new AuthorizationError();
  return { ...u, tenantId: u.tenantId };
}

/**
 * Server-action/API-route equivalent of requireOwner. Used by the CSV export
 * routes, which need JSON error responses rather than a page redirect.
 */
export async function assertOwner(): Promise<OwnerContext> {
  const u = await liveUserOrThrow();
  if (u.role !== "OWNER" || !u.organizationId) throw new AuthorizationError();

  const links = await db.propertyOwner.findMany({
    where: { userId: u.id, property: { organizationId: u.organizationId } },
    select: { propertyId: true },
  });

  return {
    ...u,
    organizationId: u.organizationId,
    propertyIds: links.map((l) => l.propertyId),
  };
}
