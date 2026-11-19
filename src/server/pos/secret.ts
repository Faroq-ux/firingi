/** Phase 47 — a business's provider secret, sealed with AES-256-GCM (key from POS_SECRET_KEY, else the auth secret). */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = () => createHash("sha256").update(`pos-secret:${process.env.POS_SECRET_KEY ?? process.env.BETTER_AUTH_SECRET ?? "firingi-dev-only"}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function unseal(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable secret.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

export const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);

/** Cashier PINs: hashed per company + person (the till checks them offline against these). */
export const pinHash = (companyId: string, userId: string, pin: string) => createHash("sha256").update(`pos-pin:${companyId}:${userId}:${pin}`).digest("hex");
