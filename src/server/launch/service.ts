/**
 * Phase 33 — Launch.
 *
 * • Launch readiness: one live checklist of everything that has to be true before real customers
 *   use FIRINGI — server settings, FIRINGI's invoicing details per country, certified invoicing,
 *   payments, messages, backups and jobs, the marketplace itself (open countries, delivery zones,
 *   suppliers, offers, VAT rates) and the legal links. Each check is pass / warning / fail with the
 *   page that fixes it. Any fail = not ready; only warnings = ready for a pilot.
 * • FIRINGI's legal entities (the seller on every sales invoice) can be added and edited here —
 *   a production start (bootstrap) creates none.
 * • Pilot mode: registration is by invitation only. FIRINGI creates an invite (business, e-mail,
 *   type, country), the link is e-mailed in the country's language, and the invite is used once.
 */
import { randomBytes } from "node:crypto";
import type { CompanyType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { checkEnv } from "@/server/env";

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;

// ── settings ────────────────────────────────────────────────────────────────

export type LaunchSettings = { termsUrl: string; privacyUrl: string; supportEmail: string; pilot: boolean; pilotBanner: boolean };
export const LAUNCH_DEFAULTS: LaunchSettings = { termsUrl: "", privacyUrl: "", supportEmail: "", pilot: false, pilotBanner: true };
const KEY = "launch.settings";

export async function launchSettings(): Promise<LaunchSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return { ...LAUNCH_DEFAULTS, ...((row?.value ?? {}) as Partial<LaunchSettings>) };
}

const staffView = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.settings.view", "admin.settings.manage"]);
const staffManage = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.settings.manage");

const isUrl = (s: string) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(s) || /^\/[^\s]*$/.test(s);

export async function saveLaunchSettings(ctx: Ctx, input: Partial<LaunchSettings>) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const cur = await launchSettings();
  const next: LaunchSettings = {
    ...cur, ...input,
    termsUrl: (input.termsUrl ?? cur.termsUrl).trim(), privacyUrl: (input.privacyUrl ?? cur.privacyUrl).trim(), supportEmail: (input.supportEmail ?? cur.supportEmail).trim().toLowerCase(),
  };
  if (next.termsUrl && !isUrl(next.termsUrl)) throw new ValidationError("Terms of service: a full address (https://…) or a path on this site (/…).", { termsUrl: ["Invalid address"] });
  if (next.privacyUrl && !isUrl(next.privacyUrl)) throw new ValidationError("Privacy policy: a full address (https://…) or a path on this site (/…).", { privacyUrl: ["Invalid address"] });
  if (next.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.supportEmail)) throw new ValidationError("Support e-mail: enter a valid address.", { supportEmail: ["Invalid e-mail"] });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: cur.pilot !== next.pilot ? (next.pilot ? "launch.pilot_on" : "launch.pilot_off") : "launch.settings_changed", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

/** What the public pages need (registration links, pilot banner). */
export async function publicLaunchInfo() {
  const s = await launchSettings();
  return { termsUrl: s.termsUrl || null, privacyUrl: s.privacyUrl || null, supportEmail: s.supportEmail || null, pilot: s.pilot, pilotBanner: s.pilot && s.pilotBanner };
}

// ── IBAN / demo markers ─────────────────────────────────────────────────────

export function ibanValid(iban: string | null | undefined) {
  const s = (iban ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
const DEMO_MAIL = /\.(test|example|invalid|localhost)$/i;
const isDemoMail = (e: string | null | undefined) => !!e && DEMO_MAIL.test(e.split("@")[1] ?? "");

// ── readiness ───────────────────────────────────────────────────────────────

export type CheckState = "pass" | "warn" | "fail";
export type LaunchSection = "server" | "security" | "company" | "invoicing" | "payments" | "messages" | "operations" | "marketplace" | "legal";
export type LaunchCheck = { key: string; section: LaunchSection; label: string; state: CheckState; detail: string; fix?: { href: string; label: string } };
export const SECTION_LABEL: Record<LaunchSection, string> = {
  server: "Server settings", security: "Security", company: "FIRINGI company details", invoicing: "Certified invoicing", payments: "Payments",
  messages: "Messages & AI", operations: "Backups & scheduled jobs", marketplace: "Marketplace", legal: "Legal & support",
};

const A = "/admin";
const FIX = {
  env: { href: `${A}/settings/system-health`, label: "Server settings (production.env)" },
  company: { href: `${A}/settings/company`, label: "Company Settings" },
  iban: { href: `${A}/settings/payment`, label: "Payment Settings" },
  invoicing: { href: `${A}/invoices/settings`, label: "Invoice Settings" },
  payments: { href: `${A}/finance/online-payments`, label: "Online Payments" },
  security: { href: `${A}/settings/security`, label: "Security" },
  users: { href: `${A}/users`, label: "Users" },
  health: { href: `${A}/settings/system-health`, label: "System Health" },
  countries: { href: `${A}/international`, label: "International" },
  zones: { href: `${A}/delivery`, label: "Delivery" },
  suppliers: { href: `${A}/vendors`, label: "Vendors" },
  tax: { href: `${A}/settings/tax`, label: "Tax Settings" },
  launch: { href: `${A}/settings/launch`, label: "Launch settings below" },
  pilot: { href: `${A}/settings/launch/pilot`, label: "Pilot & invites" },
};

export type LaunchReport = { at: string; verdict: "ready" | "pilot" | "not-ready"; counts: Record<CheckState, number>; checks: LaunchCheck[] };

/** The whole checklist. `env` can be passed in (tests); defaults to the running server's settings. */
export async function launchReadiness(ctx: Ctx, opts: { env?: Record<string, string | undefined>; now?: Date } = {}): Promise<LaunchReport> {
  if (!staffView(ctx)) throw new ForbiddenError();
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const checks: LaunchCheck[] = [];
  const add = (c: LaunchCheck) => checks.push(c);

  // ── server settings
  const production = env.FIRINGI_ENV === "production";
  add({ key: "production", section: "server", label: "Production mode", state: production ? "pass" : "fail", detail: production ? "FIRINGI_ENV=production: strict checks and no test shortcuts." : "FIRINGI_ENV is not \"production\" — set it in production.env so the strict checks apply.", fix: FIX.env });
  const findings = checkEnv(env);
  const errs = findings.filter((f) => f.level === "error");
  add({ key: "env", section: "server", label: "Required server settings", state: errs.length ? "fail" : "pass", detail: errs.length ? errs.map((f) => `${f.key}: ${f.message}`).join(" · ") : "Public https address, sign-in secret, scheduler secret, storage and providers are set.", fix: FIX.env });
  const storageS3 = env.STORAGE_DRIVER === "s3";
  add({ key: "storage", section: "server", label: "File storage", state: storageS3 ? "pass" : "warn", detail: storageS3 ? "S3-compatible storage." : "Files (photos, documents, PDFs) are on the server's disk — fine if that volume is in the backups; S3 storage is safer.", fix: FIX.env });
  add({ key: "sentry", section: "server", label: "External error tracking", state: env.SENTRY_DSN ? "pass" : "warn", detail: env.SENTRY_DSN ? "Sentry is connected." : "No Sentry — FIRINGI's own error log and alerts still work.", fix: FIX.env });

  // ── security
  const staff = await prisma.membership.findMany({
    where: { status: "ACTIVE", company: { type: "ADMIN" }, user: { status: "ACTIVE" } },
    select: { user: { select: { email: true, twoFactorEnabled: true } }, roles: { select: { role: { select: { key: true } } } } },
  });
  const supers = staff.filter((m) => m.roles.some((r) => r.role.key === "SUPER_ADMIN"));
  const noTwoFa = staff.filter((m) => !m.user.twoFactorEnabled);
  const superNoTwoFa = supers.filter((m) => !m.user.twoFactorEnabled);
  add({
    key: "2fa", section: "security", label: "Two-factor sign-in for FIRINGI staff",
    state: superNoTwoFa.length ? "fail" : noTwoFa.length ? "warn" : "pass",
    detail: !noTwoFa.length ? `All ${staff.length} staff accounts use two-factor sign-in.` : `${noTwoFa.length} of ${staff.length} staff without two-factor sign-in${superNoTwoFa.length ? ` (including ${superNoTwoFa.length} super admin${superNoTwoFa.length > 1 ? "s" : ""})` : ""}: ${noTwoFa.slice(0, 5).map((m) => m.user.email).join(", ")}${noTwoFa.length > 5 ? ` and ${noTwoFa.length - 5} more` : ""}.`,
    fix: FIX.security,
  });
  add({ key: "superadmins", section: "security", label: "Two or more super admins", state: supers.length >= 2 ? "pass" : "warn", detail: supers.length >= 2 ? `${supers.length} super admins.` : "Only one super admin — if that person is locked out, nobody can manage FIRINGI. Add a second.", fix: FIX.users });
  const [demoUsers, demoEntities] = await Promise.all([
    prisma.user.count({ where: { OR: [{ email: { endsWith: ".test" } }, { email: { endsWith: ".example" } }, { email: { endsWith: ".invalid" } }] } }),
    prisma.legalEntity.count({ where: { OR: [{ email: { endsWith: ".test" } }, { iban: { startsWith: "PT50 0000" } }] } }),
  ]);
  const demo = demoUsers + demoEntities > 0 || !!env.SEED_PASSWORD;
  add({
    key: "demo", section: "security", label: "No demo data", state: demo ? "fail" : "pass",
    detail: demo ? `Demo data found (${demoUsers} demo accounts${demoEntities ? `, ${demoEntities} demo invoicing entit${demoEntities > 1 ? "ies" : "y"}` : ""}${env.SEED_PASSWORD ? ", SEED_PASSWORD set" : ""}). Start production from an empty database with the bootstrap command — never with the demo seed.` : "No demo accounts.",
    fix: FIX.users,
  });
  const rate = Number(env.AUTH_SIGNIN_RATE_LIMIT ?? 10);
  add({ key: "ratelimit", section: "security", label: "Sign-in attempt limit", state: rate > 30 ? "warn" : "pass", detail: rate > 30 ? `Raised to ${rate} (a testing value?) — keep about 10.` : `${rate} attempts per window.`, fix: FIX.env });

  // ── FIRINGI company details (sellers on invoices)
  const [open, entities] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true, OR: [{ customerMarketEnabled: true }, { wholesalerMarketEnabled: true }, { distributorSourcingEnabled: true }] }, select: { id: true, code: true, customerMarketEnabled: true, wholesalerMarketEnabled: true, distributorSourcingEnabled: true }, orderBy: { code: "asc" } }),
    prisma.legalEntity.findMany({ where: { isActive: true }, include: { country: { select: { code: true } } } }),
  ]);
  const buyerCountries = open.filter((c) => c.customerMarketEnabled || c.wholesalerMarketEnabled);
  const missingLe = buyerCountries.filter((c) => !entities.some((e) => e.countryId === c.id));
  add({
    key: "entity", section: "company", label: "Invoicing entity for every country with buyers",
    state: missingLe.length || !entities.length ? "fail" : "pass",
    detail: !buyerCountries.length ? (entities.length ? `${entities.length} invoicing entit${entities.length > 1 ? "ies" : "y"}; no country is open to buyers yet.` : "No invoicing entity yet — every sales invoice needs FIRINGI's legal details.") :
      missingLe.length ? `Missing for ${missingLe.map((c) => c.code).join(", ")} — orders from there can't be invoiced.` : `${buyerCountries.map((c) => c.code).join(", ")}: set.`,
    fix: FIX.company,
  });
  for (const e of entities) {
    const problems: string[] = [];
    if (isDemoMail(e.email)) problems.push(`invoicing e-mail ${e.email} is a demo address`);
    if (!e.vatNumber) problems.push("no VAT number");
    if (!e.phone) problems.push("no phone");
    add({ key: `entity:${e.id}`, section: "company", label: `${e.country.code} · ${e.legalName}`, state: problems.length ? "fail" : "pass", detail: problems.length ? problems.join(" · ") : `NIF ${e.taxId} · ${e.addressLine}, ${e.postalCode} ${e.city} · ${e.email}`, fix: FIX.company });
    add({ key: `iban:${e.id}`, section: "company", label: `${e.country.code} · bank account (IBAN)`, state: ibanValid(e.iban) ? "pass" : "fail", detail: !e.iban ? "No IBAN — customers paying by transfer don't know where to pay." : ibanValid(e.iban) ? `${e.iban}` : `${e.iban} is not a valid IBAN (check digits).`, fix: FIX.iban });
  }

  // ── certified invoicing
  const { fiscalSettings } = await import("@/server/invoicing/fiscal");
  const { moloniMode } = await import("@/server/invoicing/moloni/client");
  const fs = await fiscalSettings();
  const mode = env === process.env ? moloniMode() : env.MOLONI_SIMULATE === "1" ? "simulated" : !env.MOLONI_CLIENT_ID || !env.MOLONI_CLIENT_SECRET || !env.MOLONI_USERNAME || !env.MOLONI_PASSWORD ? "off" : env.MOLONI_SANDBOX === "true" ? "sandbox" : "live";
  const ptInvoicing = entities.some((e) => e.country.code === "PT");
  if (fs.provider !== "moloni")
    add({ key: "fiscal", section: "invoicing", label: "Invoices issued by certified software", state: ptInvoicing ? "fail" : "warn", detail: `FIRINGI issues invoices itself, marked "not a fiscal document". ${ptInvoicing ? "In Portugal invoices must come from AT-certified software — connect Moloni." : "Connect a certified provider before invoicing in Portugal."}`, fix: FIX.invoicing });
  else {
    const cfgMissing = (["companyId", "invoiceSetId", "creditNoteSetId", "maturityDateId", "paymentMethodId", "categoryId", "unitId"] as const).filter((k) => !fs.moloni[k]);
    add({
      key: "fiscal", section: "invoicing", label: "Invoices issued by certified software",
      state: mode === "live" && !cfgMissing.length ? "pass" : mode === "sandbox" && !cfgMissing.length ? "warn" : "fail",
      detail: mode === "simulated" ? "Moloni is SIMULATED (MOLONI_SIMULATE=1) — its documents are not fiscal." : mode === "off" ? "Moloni is chosen but its keys are not set (MOLONI_CLIENT_ID, MOLONI_CLIENT_SECRET, MOLONI_USERNAME, MOLONI_PASSWORD)." :
        cfgMissing.length ? `Moloni (${mode}): choose ${cfgMissing.join(", ")} on Invoice Settings.` : mode === "sandbox" ? "Moloni sandbox — test documents only. Switch MOLONI_SANDBOX off for real invoices." : "Moloni (live), all mappings chosen.",
      fix: mode === "simulated" || mode === "off" ? FIX.env : FIX.invoicing,
    });
  }
  const [fiscalFailed, fiscalStuck] = await Promise.all([
    prisma.invoice.count({ where: { fiscalStatus: "FAILED" } }),
    prisma.invoice.count({ where: { fiscalStatus: "PENDING", issuedAt: { lt: new Date(now.getTime() - 3600_000) } } }),
  ]);
  add({ key: "fiscal-queue", section: "invoicing", label: "Invoices waiting at the provider", state: fiscalFailed || fiscalStuck ? "warn" : "pass", detail: fiscalFailed || fiscalStuck ? `${fiscalFailed} refused · ${fiscalStuck} pending over an hour.` : "None waiting.", fix: FIX.invoicing });

  // ── payments
  const payKey = env.PAYMENTS_PROVIDER === "sim" || env.PAYMENTS_PROVIDER === "stripe" ? env.PAYMENTS_PROVIDER : env.PAYMENTS_SIMULATE === "1" ? "sim" : env.STRIPE_SECRET_KEY ? "stripe" : null;
  add({
    key: "payments", section: "payments", label: "Online payments (card, MB WAY, Multibanco, direct debit)",
    state: payKey === "sim" ? "fail" : payKey === "stripe" ? (env.STRIPE_SECRET_KEY?.startsWith("sk_live_") && env.STRIPE_WEBHOOK_SECRET ? "pass" : env.STRIPE_WEBHOOK_SECRET ? "warn" : "fail") : "warn",
    detail: payKey === "sim" ? "The SIMULATED provider is on — no real money moves." : payKey === "stripe" ? (!env.STRIPE_WEBHOOK_SECRET ? "Stripe needs STRIPE_WEBHOOK_SECRET, or payments are never confirmed." : env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "Stripe (live)." : "Stripe in TEST mode — no real payments.") : "No online payments — customers pay by bank transfer only. Fine for a pilot.",
    fix: payKey === "sim" || !payKey || !env.STRIPE_WEBHOOK_SECRET ? FIX.env : FIX.payments,
  });

  // ── messages & AI
  const mail = env.MAIL_DRIVER === "smtp" && !!env.SMTP_URL;
  add({ key: "email", section: "messages", label: "E-mail sending", state: mail ? "pass" : "fail", detail: mail ? "SMTP." : "E-mails are only written to a log — nobody receives invoices, password resets or order messages. Set MAIL_DRIVER=smtp and SMTP_URL.", fix: FIX.env });
  const sms = !!env.SMS_DRIVER && env.SMS_DRIVER !== "log", wa = !!env.WHATSAPP_DRIVER && env.WHATSAPP_DRIVER !== "log";
  add({ key: "sms", section: "messages", label: "SMS & WhatsApp", state: sms || wa ? "pass" : "warn", detail: sms || wa ? [sms && `SMS (${env.SMS_DRIVER})`, wa && `WhatsApp (${env.WHATSAPP_DRIVER})`].filter(Boolean).join(" · ") : "Not connected — delivery updates go by e-mail and the app only.", fix: FIX.env });
  const push = env.PUSH_DRIVER === "webpush" && !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
  add({ key: "push", section: "messages", label: "Phone notifications (push)", state: push ? "pass" : "warn", detail: push ? "Web push." : "Not set (PUSH_DRIVER=webpush + VAPID keys) — drivers and buyers get no push messages.", fix: FIX.env });
  add({
    key: "ai", section: "messages", label: "AI assistant", state: env.ANTHROPIC_API_KEY ? "pass" : env.ASSISTANT_SIMULATE === "1" ? "fail" : "warn",
    detail: env.ANTHROPIC_API_KEY ? "Claude is connected." : env.ASSISTANT_SIMULATE === "1" ? "The SIMULATED assistant is on (fixed rules, not the AI)." : "No ANTHROPIC_API_KEY — the assistant pages say it's off. Everything else works.",
    fix: FIX.env,
  });

  // ── backups & jobs
  const { jobStatus } = await import("@/server/ops/jobs");
  const jobs = await jobStatus(now);
  const backup = jobs.find((j) => j.key === "backup");
  add({
    key: "backup", section: "operations", label: "Nightly database backup",
    state: backup?.state === "ok" ? "pass" : "fail",
    detail: !backup || backup.state === "never" ? "No backup has run yet — start the backup service (docker-compose.prod.yml) and wait for the first one." : backup.state === "ok" ? `Last good backup ${Math.round((backup.ageMin ?? 0) / 60)} h ago.` : `Backups are ${backup.state.replace("-", " ")}.`,
    fix: FIX.health,
  });
  add({ key: "encrypt", section: "operations", label: "Backups encrypted", state: env.BACKUP_ENCRYPTION_KEY ? "pass" : "warn", detail: env.BACKUP_ENCRYPTION_KEY ? "Yes." : "Set BACKUP_ENCRYPTION_KEY — backups hold every customer's data.", fix: FIX.env });
  const restore = jobs.find((j) => j.key === "restore-test");
  add({ key: "restore", section: "operations", label: "Backup restore tested", state: restore?.state === "ok" ? "pass" : "warn", detail: restore?.state === "ok" ? "A restore test passed this month." : "No successful restore test yet — a backup is only proven once it has been restored.", fix: FIX.health });
  const sched = jobs.filter((j) => j.path);
  const bad = sched.filter((j) => j.state === "failing" || j.state === "stale");
  const never = sched.filter((j) => j.state === "never");
  add({
    key: "jobs", section: "operations", label: "Scheduled jobs running",
    state: bad.length ? "fail" : never.length ? "warn" : "pass",
    detail: bad.length ? `Not running properly: ${bad.map((j) => j.label).join(", ")}.` : never.length ? `${never.length} of ${sched.length} jobs have never run here (is the scheduler service up?): ${never.slice(0, 4).map((j) => j.label).join(", ")}${never.length > 4 ? ` and ${never.length - 4} more` : ""}.` : `All ${sched.length} jobs ran recently.`,
    fix: FIX.health,
  });

  // ── marketplace
  const custCountries = open.filter((c) => c.customerMarketEnabled);
  add({ key: "countries", section: "marketplace", label: "Countries open to customers", state: custCountries.length ? "pass" : "fail", detail: custCountries.length ? custCountries.map((c) => c.code).join(", ") : "No country is open to customers.", fix: FIX.countries });
  for (const c of buyerCountries) {
    const [zones, rates, suppliers, offers] = await Promise.all([
      prisma.deliveryZone.count({ where: { countryId: c.id, isActive: true } }),
      prisma.taxRate.count({ where: { countryId: c.id, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] } }),
      prisma.company.count({ where: { status: "APPROVED", type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, OR: [{ countryId: c.id }, { serviceAreas: { some: { countryId: c.id } } }] } }),
      prisma.vendorOffer.count({ where: { status: "ACTIVE", countryId: c.id } }),
    ]);
    add({ key: `zones:${c.code}`, section: "marketplace", label: `${c.code} · delivery zones`, state: zones ? "pass" : "fail", detail: zones ? `${zones} active zone${zones > 1 ? "s" : ""}.` : "No active delivery zone — nothing can be delivered.", fix: FIX.zones });
    add({ key: `vat:${c.code}`, section: "marketplace", label: `${c.code} · VAT rates`, state: rates ? "pass" : "fail", detail: rates ? `${rates} rate${rates > 1 ? "s" : ""} in force.` : "No VAT rate in force.", fix: FIX.tax });
    add({ key: `suppliers:${c.code}`, section: "marketplace", label: `${c.code} · approved suppliers`, state: suppliers >= 3 ? "pass" : suppliers ? "warn" : "fail", detail: suppliers ? `${suppliers} approved supplier${suppliers > 1 ? "s" : ""}${suppliers < 3 ? " — a few more give buyers a real choice." : "."}` : "No approved supplier.", fix: FIX.suppliers });
    add({ key: `offers:${c.code}`, section: "marketplace", label: `${c.code} · products on sale`, state: offers >= 20 ? "pass" : offers ? "warn" : "fail", detail: offers ? `${offers} active offer${offers > 1 ? "s" : ""}${offers < 20 ? " — a thin catalogue for launch." : "."}` : "Nothing on sale.", fix: FIX.suppliers });
  }

  // ── legal & support
  const ls = await launchSettings();
  add({ key: "terms", section: "legal", label: "Terms of service link", state: ls.termsUrl ? "pass" : "fail", detail: ls.termsUrl ? ls.termsUrl : "Every business accepts the terms when it registers — give the link to your terms (checked by a lawyer).", fix: FIX.launch });
  add({ key: "privacy", section: "legal", label: "Privacy policy link", state: ls.privacyUrl ? "pass" : "fail", detail: ls.privacyUrl ? ls.privacyUrl : "GDPR: users must be able to read how their data is used — give the link to your privacy policy.", fix: FIX.launch });
  add({ key: "support", section: "legal", label: "Support e-mail", state: ls.supportEmail && !isDemoMail(ls.supportEmail) ? "pass" : "warn", detail: ls.supportEmail ? (isDemoMail(ls.supportEmail) ? `${ls.supportEmail} is a demo address.` : ls.supportEmail) : "Shown to businesses waiting for an invitation and in the pilot banner.", fix: FIX.launch });
  add({ key: "pilot", section: "legal", label: "Registration", state: "pass", detail: ls.pilot ? "Pilot: by invitation only." : "Open: any business in an open country can apply (FIRINGI still approves each one).", fix: FIX.pilot });

  const counts = { pass: 0, warn: 0, fail: 0 } as Record<CheckState, number>;
  for (const c of checks) counts[c.state]++;
  return { at: now.toISOString(), verdict: counts.fail ? "not-ready" : counts.warn ? "pilot" : "ready", counts, checks };
}

// ── FIRINGI legal entities ──────────────────────────────────────────────────

export type LegalEntityInput = { countryCode: string; legalName: string; taxId: string; vatNumber: string; addressLine: string; postalCode: string; city: string; email: string; phone: string };

export async function legalEntities(ctx: Ctx) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const [rows, countries] = await Promise.all([
    prisma.legalEntity.findMany({ include: { country: { select: { code: true, flag: true } }, _count: { select: { invoices: true } } }, orderBy: [{ isActive: "desc" }, { legalName: "asc" }] }),
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { code: true, flag: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return { rows: rows.map(({ _count, ...e }) => ({ ...e, invoices: _count.invoices, ibanOk: ibanValid(e.iban) })), countries };
}

export async function saveLegalEntity(ctx: Ctx, input: LegalEntityInput, id?: string) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const country = await prisma.country.findUnique({ where: { code: input.countryCode.toUpperCase() } });
  if (!country || !country.isSchengen) throw new ValidationError("FIRINGI invoices only from Schengen countries.", { countryCode: ["Not available"] });
  const { normaliseTaxId } = await import("@/server/services/registration");
  const taxId = normaliseTaxId(country.code, input.taxId);
  if (country.code === "PT") {
    const { isValidPtNif } = await import("@/lib/tax-id");
    if (!isValidPtNif(taxId)) throw new ValidationError("Invalid Portuguese NIF.", { taxId: ["Invalid NIF"] });
  }
  const vat = input.vatNumber.replace(/[\s.-]/g, "").toUpperCase();
  const prefix = country.vatPrefix ?? country.code;
  if (!vat.startsWith(prefix) || vat.length < prefix.length + 5) throw new ValidationError(`VAT number starts with ${prefix}, e.g. ${prefix}${taxId}.`, { vatNumber: [`Starts with ${prefix}`] });
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Invoicing e-mail: enter a valid address.", { email: ["Invalid e-mail"] });
  const text = (v: string, f: string, min = 2) => { const s = v.trim(); if (s.length < min) throw new ValidationError(`Fill in ${f}.`, { [f]: ["Required"] }); return s; };
  const data = {
    legalName: text(input.legalName, "legalName"), vatNumber: vat, addressLine: text(input.addressLine, "addressLine", 3), postalCode: text(input.postalCode, "postalCode", 3),
    city: text(input.city, "city"), email, phone: text(input.phone, "phone", 6),
  };
  if (id) {
    const cur = await prisma.legalEntity.findUnique({ where: { id }, include: { _count: { select: { invoices: true } } } });
    if (!cur) throw new NotFoundError("Legal entity");
    // Issued invoices carry the seller's tax number and country — those can't change under them.
    if (cur._count.invoices && (cur.taxId !== taxId || cur.countryId !== country.id))
      throw new ValidationError("Invoices were already issued with this tax number and country — add a new entity instead of changing them.", { taxId: ["Locked: invoices issued"] });
    const row = await prisma.legalEntity.update({ where: { id }, data: { ...data, taxId, countryId: country.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "legal_entity.updated", entityType: "LegalEntity", entityId: id, before: { legalName: cur.legalName, taxId: cur.taxId, vatNumber: cur.vatNumber, addressLine: cur.addressLine, postalCode: cur.postalCode, city: cur.city, email: cur.email, phone: cur.phone }, after: { ...data, taxId } });
    return row;
  }
  if (await prisma.legalEntity.findFirst({ where: { countryId: country.id, isActive: true } }))
    throw new AppError("ENTITY_EXISTS", `FIRINGI already has an active invoicing entity in ${country.code} — edit it instead.`, 409);
  const row = await prisma.legalEntity.create({ data: { ...data, taxId, countryId: country.id } }).catch((e) => {
    if ((e as { code?: string }).code === "P2002") throw new AppError("ENTITY_EXISTS", "An entity with this tax number already exists in that country.", 409);
    throw e;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "legal_entity.created", entityType: "LegalEntity", entityId: row.id, after: { ...data, taxId, country: country.code } });
  return row;
}

// ── pilot invitations ───────────────────────────────────────────────────────

const INVITE_TYPES = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] as const;
type InviteType = (typeof INVITE_TYPES)[number];
const newCode = () => randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 12).toUpperCase();
const TYPE_PATH: Record<InviteType, string> = { CUSTOMER: "customer", WHOLESALER: "wholesaler", DISTRIBUTOR: "distributor" };

export function inviteLink(inv: { code: string; type: CompanyType }) {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/register/${TYPE_PATH[inv.type as InviteType]}?invite=${inv.code}`;
}

export type InviteState = "open" | "used" | "expired" | "revoked";
export const inviteState = (i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InviteState =>
  i.usedAt ? "used" : i.revokedAt ? "revoked" : i.expiresAt < now ? "expired" : "open";

export async function listInvites(ctx: Ctx) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const rows = await prisma.pilotInvite.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { usedBy: { select: { id: true, legalName: true, status: true } } } });
  const now = new Date();
  return rows.map((r) => ({ ...r, state: inviteState(r, now), link: inviteLink(r) }));
}

export async function inviteCountries() {
  return prisma.country.findMany({
    where: { isActive: true, OR: [{ customerMarketEnabled: true }, { wholesalerMarketEnabled: true }, { distributorSourcingEnabled: true }] },
    select: { code: true, flag: true, name: true, defaultLanguageCode: true, customerMarketEnabled: true, wholesalerMarketEnabled: true, distributorSourcingEnabled: true }, orderBy: { code: "asc" },
  });
}

export async function createInvite(ctx: Ctx, input: { email: string; companyName: string; type: string; countryCode: string; days?: number; note?: string | null; send?: boolean }) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  if (!INVITE_TYPES.includes(input.type as InviteType)) throw new ValidationError("Choose customer, wholesaler or distributor.", { type: ["Invalid"] });
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid e-mail address.", { email: ["Invalid e-mail"] });
  const companyName = input.companyName.trim();
  if (companyName.length < 2) throw new ValidationError("Enter the business name.", { companyName: ["Required"] });
  const country = await prisma.country.findUnique({ where: { code: input.countryCode.toUpperCase() } });
  const FLAG = { CUSTOMER: "customerMarketEnabled", WHOLESALER: "wholesalerMarketEnabled", DISTRIBUTOR: "distributorSourcingEnabled" } as const;
  if (!country || !country.isActive || !country[FLAG[input.type as InviteType]])
    throw new ValidationError("That account type isn't open in this country — open the market first (International).", { countryCode: ["Not open"] });
  const days = Math.round(input.days ?? 30);
  if (days < 1 || days > 180) throw new ValidationError("The invitation is valid 1–180 days.", { days: ["1–180"] });
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError("EMAIL_TAKEN", "Someone already has an account with this e-mail.", 409);
  const open = await prisma.pilotInvite.findFirst({ where: { email, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (open) throw new AppError("INVITE_EXISTS", "This e-mail already has an open invitation — send it again or revoke it first.", 409);
  const inv = await prisma.pilotInvite.create({
    data: { code: newCode(), email, companyName, type: input.type as InviteType, countryCode: country.code, language: country.defaultLanguageCode, note: input.note?.trim() || null, createdById: ctx.user.id, expiresAt: new Date(Date.now() + days * DAY) },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "launch.invite_created", entityType: "PilotInvite", entityId: inv.id, after: { email, companyName, type: inv.type, country: inv.countryCode, expiresAt: inv.expiresAt } });
  if (input.send !== false) return sendInvite(ctx, inv.id);
  return { ...inv, link: inviteLink(inv) };
}

type Msgs = Record<string, unknown>;
async function launchTexts(locale: string) {
  const { toUiLocale } = await import("@/i18n/config");
  const ui = toUiLocale(locale) ?? "en";
  const en = ((await import("@/messages/en.json")).default as Msgs).launch as Record<string, string>;
  const loc = ui === "en" ? en : ((((await import(`@/messages/${ui}.json`)).default as Msgs).launch ?? {}) as Record<string, string>);
  return (k: string, vars: Record<string, string> = {}) => (loc[k] ?? en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? `{${v}}`);
}

export async function sendInvite(ctx: Ctx, id: string) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const inv = await prisma.pilotInvite.findUnique({ where: { id } });
  if (!inv) throw new NotFoundError("Invitation");
  if (inviteState(inv) !== "open") throw new ValidationError("Only open invitations can be sent.");
  const t = await launchTexts(inv.language);
  const link = inviteLink(inv);
  const { sendMail } = await import("@/server/services/mailer");
  const days = Math.max(1, Math.round((inv.expiresAt.getTime() - Date.now()) / DAY));
  const text = [t("inviteHello"), t("inviteIntro", { company: inv.companyName }), t("inviteApply", { link }), t("inviteValid", { days: String(days) }), "FIRINGI"].join("\n\n");
  await sendMail({ to: inv.email, subject: t("inviteSubject"), text });
  const row = await prisma.pilotInvite.update({ where: { id }, data: { sentAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "launch.invite_sent", entityType: "PilotInvite", entityId: id, after: { email: inv.email } });
  return { ...row, link };
}

export async function revokeInvite(ctx: Ctx, id: string) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const inv = await prisma.pilotInvite.findUnique({ where: { id } });
  if (!inv) throw new NotFoundError("Invitation");
  if (inv.usedAt) throw new ValidationError("This invitation was already used.");
  if (inv.revokedAt) return inv;
  const row = await prisma.pilotInvite.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "launch.invite_revoked", entityType: "PilotInvite", entityId: id, before: { email: inv.email } });
  return row;
}

/** Public: what the registration page may show for ?invite=… (never the e-mail of someone else's invite beyond prefilling it). */
export async function checkInvite(code: string | null | undefined, type: CompanyType) {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(c)) return { ok: false as const, reason: "missing" as const };
  const inv = await prisma.pilotInvite.findUnique({ where: { code: c } });
  if (!inv) return { ok: false as const, reason: "invalid" as const };
  const st = inviteState(inv);
  if (st !== "open") return { ok: false as const, reason: st };
  if (inv.type !== type) return { ok: false as const, reason: "type" as const, type: inv.type };
  return { ok: true as const, code: inv.code, email: inv.email, companyName: inv.companyName, countryCode: inv.countryCode };
}

/** Called inside the registration transaction: the invite is used exactly once. */
export async function consumeInvite(tx: Tx, code: string, input: { type: CompanyType; countryCode: string; companyId: string }) {
  const inv = await tx.pilotInvite.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!inv || inviteState(inv) !== "open") throw new ValidationError("This invitation is no longer valid. Ask FIRINGI for a new one.", { invite: ["Invalid"] });
  if (inv.type !== input.type || inv.countryCode !== input.countryCode) throw new ValidationError("This invitation is for another account type or country.", { countryCode: ["Not this invitation"] });
  const n = await tx.pilotInvite.updateMany({ where: { id: inv.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date(), usedByCompanyId: input.companyId } });
  if (n.count !== 1) throw new ValidationError("This invitation was just used.", { invite: ["Used"] });
}

/** Pilot banner for signed-in businesses (not staff). */
export async function pilotBanner(ctx: Ctx) {
  if (ctx.company.type === "ADMIN") return null;
  const s = await launchSettings();
  return s.pilot && s.pilotBanner ? { supportEmail: s.supportEmail || null } : null;
}
