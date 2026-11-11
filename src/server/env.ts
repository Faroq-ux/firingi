/**
 * Startup check of the server environment (pure — unit-tested).
 *
 * With FIRINGI_ENV=production (set by the production Docker setup) FIRINGI refuses to start when
 * something essential is missing or unsafe; elsewhere the same findings are only warnings.
 * The System Health page shows them too.
 */
export type EnvFinding = { level: "error" | "warning"; key: string; message: string };

const isHttps = (v: string | undefined) => !!v && /^https:\/\//.test(v);

export function checkEnv(env: Record<string, string | undefined>): EnvFinding[] {
  const out: EnvFinding[] = [];
  const err = (key: string, message: string) => out.push({ level: "error", key, message });
  const warn = (key: string, message: string) => out.push({ level: "warning", key, message });

  if (!env.DATABASE_URL) err("DATABASE_URL", "Set the PostgreSQL connection (with PostGIS).");
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32 || /change|secret|example|dev/i.test(secret)) err("BETTER_AUTH_SECRET", "Use a random secret of at least 32 characters (openssl rand -base64 48).");
  const url = env.BETTER_AUTH_URL ?? env.APP_URL;
  if (!url) err("BETTER_AUTH_URL", "Set the public address of FIRINGI (https://…).");
  else if (!isHttps(url)) err("BETTER_AUTH_URL", `The public address must use https (now ${url}).`);
  if (env.APP_URL && env.BETTER_AUTH_URL && env.APP_URL.replace(/\/$/, "") !== env.BETTER_AUTH_URL.replace(/\/$/, "")) warn("APP_URL", "APP_URL and BETTER_AUTH_URL differ — links in messages use APP_URL.");
  if ((env.CRON_SECRET ?? "").length < 24) err("CRON_SECRET", "Set a random CRON_SECRET of at least 24 characters (the scheduler uses it).");

  if (env.STORAGE_DRIVER === "s3") {
    for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[k]) err(k, `STORAGE_DRIVER=s3 needs ${k}.`);
  } else warn("STORAGE_DRIVER", "Files are kept on the server's disk (STORAGE_DIR): make sure that volume is backed up, or use S3-compatible storage.");

  if (!env.MAIL_DRIVER || env.MAIL_DRIVER === "log") warn("MAIL_DRIVER", "E-mails are only written to a log, not sent — set MAIL_DRIVER=smtp and SMTP_URL.");
  else if (env.MAIL_DRIVER === "smtp" && !env.SMTP_URL) err("SMTP_URL", "MAIL_DRIVER=smtp needs SMTP_URL.");
  if (env.SMS_DRIVER === "twilio" || env.WHATSAPP_DRIVER === "twilio") for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) if (!env[k]) err(k, `Twilio messages need ${k}.`);
  if (env.WHATSAPP_DRIVER === "meta") for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]) if (!env[k]) err(k, `WhatsApp (Meta) needs ${k}.`);
  if (env.PUSH_DRIVER === "webpush" && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)) err("VAPID_PRIVATE_KEY", "Web push needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.");

  if (env.MOLONI_SIMULATE === "1") err("MOLONI_SIMULATE", "The simulated Moloni must not run in production (its documents are not fiscal).");
  if (Number(env.AUTH_SIGNIN_RATE_LIMIT ?? 10) > 30) warn("AUTH_SIGNIN_RATE_LIMIT", "The sign-in limit is raised (testing value?) — keep it at 10 or so.");
  if (env.SEED_PASSWORD) warn("SEED_PASSWORD", "A seed password is set — demo accounts must not exist in production.");
  if (!env.SENTRY_DSN) warn("SENTRY_DSN", "No external error tracking (Sentry) — FIRINGI's own error log and alerts still work.");
  if (!env.BACKUP_ENCRYPTION_KEY) warn("BACKUP_ENCRYPTION_KEY", "Backups are not encrypted — set BACKUP_ENCRYPTION_KEY for the backup service.");
  return out;
}

export const strictEnv = () => process.env.FIRINGI_ENV === "production";
