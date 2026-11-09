/**
 * Outgoing e-mail. MAIL_DRIVER=log (default, dev) writes each message as JSON into
 * STORAGE_DIR/mail-outbox; MAIL_DRIVER=smtp sends through SMTP_URL (e.g. Mailpit, or
 * the production provider once chosen). Failures are logged, never thrown, so an
 * e-mail problem can't block an approval.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail): Promise<void> {
  const from = process.env.MAIL_FROM ?? "FIRINGI <no-reply@firingi.test>";
  try {
    if (process.env.MAIL_DRIVER === "smtp") {
      const nodemailer = await import("nodemailer");
      await nodemailer.createTransport(process.env.SMTP_URL ?? "smtp://localhost:1025").sendMail({ from, ...mail });
      return;
    }
    const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage", "mail-outbox");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}.json`);
    await writeFile(file, JSON.stringify({ from, ...mail, at: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error("[mailer] failed to send", mail.subject, e);
  }
}
