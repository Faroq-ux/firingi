/**
 * Demo accounts are long-established customers and suppliers: approved, signed up and with
 * their addresses about a year ago — as real accounts would be. (FIRINGI's risk checks look at
 * how new an account, a user or a delivery address is.)
 */
import type { PrismaClient } from "@prisma/client";

export async function establishDemoAccounts(db: PrismaClient) {
  await db.$executeRaw`UPDATE "Company" SET "approvedAt" = now() - interval '400 days', "createdAt" = LEAST("createdAt", now() - interval '400 days') WHERE "approvedAt" IS NOT NULL AND "approvedAt" > now() - interval '400 days'`;
  await db.$executeRaw`UPDATE "User" SET "createdAt" = now() - interval '400 days' WHERE "createdAt" > now() - interval '400 days'`;
  await db.$executeRaw`UPDATE "Address" SET "createdAt" = now() - interval '400 days' WHERE "createdAt" > now() - interval '400 days'`;
}
