import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string | null;
      tenantId: string | null;
    } & DefaultSession["user"];
  }

  /** What `authorize()` returns and what the `jwt` callback receives as `user`. */
  interface User {
    role: Role;
    organizationId: string | null;
    tenantId: string | null;
  }
}

// In Auth.js v5 the JWT type lives in @auth/core, not next-auth/jwt.
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    organizationId?: string | null;
    tenantId?: string | null;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            passwordHash: true,
            organizationId: true,
            tenant: { select: { id: true } },
          },
        });

        // Compare against a dummy hash when the user is missing so that a
        // wrong email and a wrong password take the same amount of time.
        const hash =
          user?.passwordHash ??
          "$2b$12$0000000000000000000000000000000000000000000000000000";
        const ok = await bcrypt.compare(parsed.data.password, hash);
        if (!user || !ok) return null;

        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          tenantId: user.tenant?.id ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.tenantId = user.tenantId;
      } else if (trigger === "update" && token.sub) {
        // Re-read after the org is created during signup, or a role changes.
        const fresh = await db.user.findUnique({
          where: { id: token.sub },
          select: {
            role: true,
            organizationId: true,
            tenant: { select: { id: true } },
          },
        });
        if (fresh) {
          token.role = fresh.role;
          token.organizationId = fresh.organizationId;
          token.tenantId = fresh.tenant?.id ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = (token.role ?? "STAFF") as Role;
      session.user.organizationId = token.organizationId ?? null;
      session.user.tenantId = token.tenantId ?? null;
      return session;
    },
  },
});

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
