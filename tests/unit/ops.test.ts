/** Phase 19: startup settings check and error fingerprints (pure). */
import { describe, expect, it } from "vitest";
import { checkEnv } from "@/server/env";
import { fingerprintOf } from "@/server/ops/errors";
import { componentOf } from "@/server/ops/status";

const good = {
  DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: "q8V3xZr1Lk0pT7bN2mW9yH4sJ6dF5gA0cE", BETTER_AUTH_URL: "https://app.firingi.pt",
  APP_URL: "https://app.firingi.pt", CRON_SECRET: "a".repeat(30), STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s",
  MAIL_DRIVER: "smtp", SMTP_URL: "smtps://u:p@mail:465", SENTRY_DSN: "https://k@o1.ingest.sentry.io/1", BACKUP_ENCRYPTION_KEY: "k".repeat(40),
  STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc",
};
const keys = (env: Record<string, string | undefined>, level?: "error" | "warning") => checkEnv(env).filter((f) => !level || f.level === level).map((f) => f.key);

describe("checkEnv", () => {
  it("a complete production setup has no findings", () => expect(checkEnv(good)).toEqual([]));
  it("missing or unsafe essentials are errors", () => {
    expect(keys({}, "error")).toEqual(expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "CRON_SECRET"]));
    expect(keys({ ...good, BETTER_AUTH_SECRET: "change-me-to-a-long-random-string-please" }, "error")).toEqual(["BETTER_AUTH_SECRET"]);
    expect(keys({ ...good, BETTER_AUTH_URL: "http://app.firingi.pt", APP_URL: undefined }, "error")).toEqual(["BETTER_AUTH_URL"]);
    expect(keys({ ...good, CRON_SECRET: "short" }, "error")).toEqual(["CRON_SECRET"]);
    expect(keys({ ...good, MOLONI_SIMULATE: "1" }, "error")).toEqual(["MOLONI_SIMULATE"]);
  });
  it("driver settings must be complete", () => {
    expect(keys({ ...good, S3_BUCKET: undefined }, "error")).toEqual(["S3_BUCKET"]);
    expect(keys({ ...good, SMTP_URL: undefined }, "error")).toEqual(["SMTP_URL"]);
    expect(keys({ ...good, SMS_DRIVER: "twilio" }, "error")).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
    expect(keys({ ...good, WHATSAPP_DRIVER: "meta" }, "error")).toEqual(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]);
    expect(keys({ ...good, PUSH_DRIVER: "webpush" }, "error")).toEqual(["VAPID_PRIVATE_KEY"]);
  });
  it("risky but workable choices are warnings", () => {
    expect(keys({ ...good, STORAGE_DRIVER: "local", SENTRY_DSN: undefined, BACKUP_ENCRYPTION_KEY: undefined, SEED_PASSWORD: "x", AUTH_SIGNIN_RATE_LIMIT: "500", MAIL_DRIVER: "log" }, "warning").sort())
      .toEqual(["AUTH_SIGNIN_RATE_LIMIT", "BACKUP_ENCRYPTION_KEY", "MAIL_DRIVER", "SEED_PASSWORD", "SENTRY_DSN", "STORAGE_DRIVER"]);
  });
  it("payments: no simulator in production, Stripe needs its webhook secret, test keys are flagged", () => {
    expect(keys({ ...good, PAYMENTS_SIMULATE: "1" }, "error")).toEqual(["PAYMENTS_SIMULATE"]);
    expect(keys({ ...good, STRIPE_WEBHOOK_SECRET: undefined }, "error")).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(keys({ ...good, STRIPE_SECRET_KEY: "pk_live_wrong" }, "error")).toEqual(["STRIPE_SECRET_KEY"]);
    expect(keys({ ...good, STRIPE_SECRET_KEY: "sk_test_1" }, "warning")).toEqual(["STRIPE_SECRET_KEY"]);
    expect(keys({ ...good, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }, "warning")).toEqual(["STRIPE_SECRET_KEY"]); // bank transfer only
    expect(keys({ ...good, APP_URL: "https://other.pt" }, "warning")).toEqual(["APP_URL"]);
  });
});

describe("error fingerprints", () => {
  const stack = (line: number) => `TypeError: x is undefined\n    at load (/app/.next/server/page.js:${line}:17)\n    at run (/app/x.js:1:1)`;
  it("same error in the same place groups together, whatever the line/column", () => {
    expect(fingerprintOf("server", "x is undefined", stack(10))).toBe(fingerprintOf("server", "x is undefined", stack(99)));
  });
  it("different message, source or place → different group", () => {
    const a = fingerprintOf("server", "x is undefined", stack(10));
    expect(fingerprintOf("server", "y is undefined", stack(10))).not.toBe(a);
    expect(fingerprintOf("browser", "x is undefined", stack(10))).not.toBe(a);
    expect(fingerprintOf("server", "x is undefined", "Error\n    at other (/app/y.js:3:4)")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("public status components", () => {
  it("maps internal checks to customer-facing components; internals stay private", () => {
    expect(componentOf("db")).toBe("ordering");
    expect(componentOf("job:invoicing")).toBe("invoicing");
    expect(componentOf("storage")).toBe("files");
    expect(componentOf("job:notifications")).toBe("notifications");
    expect(componentOf("disk")).toBeNull();
    expect(componentOf("env:CRON_SECRET")).toBeNull();
    expect(componentOf("errors")).toBeNull();
  });
});
