/**
 * File storage for uploaded documents. Files are NEVER served publicly: downloads go
 * through /api/files/[documentId], which checks permissions first.
 *
 * Drivers (STORAGE_DRIVER): "local" — disk under STORAGE_DIR (default ./storage);
 * "s3" — any S3-compatible store (AWS, Hetzner, Scaleway, Backblaze, MinIO):
 *   S3_BUCKET, S3_REGION, S3_ENDPOINT (non-AWS), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_FORCE_PATH_STYLE=true for MinIO-style endpoints. Objects are private, encrypted at rest.
 */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/server/onboarding/rules";
import { ValidationError } from "@/server/errors";

export type StoredFile = { key: string; mimeType: string; sizeBytes: number; sha256: string; fileName: string };

const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage");

/** Detect the real file type from its first bytes — never trust the browser's MIME type. */
export function sniffMime(buf: Buffer): (typeof ALLOWED_MIME)[number] | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";
}

export async function storeUpload(file: File, folder: string): Promise<StoredFile> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new ValidationError("Please choose a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError(`File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMime(buf);
  if (!mimeType) throw new ValidationError("Only PDF, JPG, PNG or WEBP files are accepted.");
  const key = `${folder.replace(/[^a-z0-9/_-]/gi, "")}/${new Date().getFullYear()}/${randomUUID()}.${EXT[mimeType]}`;
  await putObject(key, buf, mimeType);
  return { key, mimeType, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), fileName: safeName(file.name) };
}

export async function readStored(key: string): Promise<Buffer> {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes("..")) throw new ValidationError("Invalid file key"); // path traversal guard
  if (driver() === "s3") {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new ValidationError("Invalid file key");
  return readFile(full);
}

// ── drivers ─────────────────────────────────────────────────────────────────

export const driver = (): "local" | "s3" => (process.env.STORAGE_DRIVER === "s3" ? "s3" : "local");
const bucket = () => {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET.");
  return b;
};
let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    region: process.env.S3_REGION ?? "eu-central-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    // Newer AWS SDKs add CRC checksums to every upload by default; many S3-compatible providers
    // refuse them. Only send checksums when an operation requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
  });
  return client;
}

/** Store bytes under a key (never overwrites on local disk). */
export async function putObject(key: string, buf: Buffer, contentType: string) {
  if (driver() === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buf, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === "AES256" ? "AES256" : undefined }));
    return;
  }
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: "wx" });
}

/** For the health check: can FIRINGI reach its file store? */
export async function storageHealth(): Promise<{ ok: boolean; driver: "local" | "s3"; detail: string }> {
  try {
    if (driver() === "s3") { await s3().send(new HeadBucketCommand({ Bucket: bucket() })); return { ok: true, driver: "s3", detail: `bucket ${bucket()}` }; }
    await mkdir(root(), { recursive: true });
    await access(root());
    return { ok: true, driver: "local", detail: root() };
  } catch (e) {
    return { ok: false, driver: driver(), detail: e instanceof Error ? e.message : String(e) };
  }
}
