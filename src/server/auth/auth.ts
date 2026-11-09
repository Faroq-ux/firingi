/**
 * better-auth configuration (email + password, DB sessions).
 * Account approval / permissions are NOT handled here — see src/server/context.ts.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/services/audit";

export const auth = betterAuth({
  appName: "FIRINGI",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // Self-service sign-up is blocked at the route handler; accounts are created by the
    // registration flow (Phase 2) or by company admins, always server-side.
    autoSignIn: false,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 h
    updateAge: 60 * 60, // refresh at most hourly
    cookieCache: { enabled: false }, // always read the DB so disabling a user is immediate
    additionalFields: {
      activeCompanyId: { type: "string", required: false, input: false },
    },
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, input: false },
      status: { type: "string", required: false, input: false },
    },
  },
  // Brute-force protection: sign-in attempts per IP per minute (configurable for load / e2e tests).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 60, max: Number(process.env.AUTH_SIGNIN_RATE_LIMIT ?? 10) } },
  },
  databaseHooks: {
    session: {
      create: {
        // Disabled users can never obtain a session.
        before: async (session) => {
          const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } });
          if (!user || user.status !== "ACTIVE") return false;
          return { data: session };
        },
        after: async (session) => {
          await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
          await writeAudit({
            actorUserId: session.userId,
            action: "auth.login",
            entityType: "User",
            entityId: session.userId,
            ip: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
