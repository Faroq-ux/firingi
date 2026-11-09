/**
 * File storage for uploaded documents. Files are NEVER served publicly: downloads go
 * through /api/files/[documentId], which checks permissions first.
 *
 * Drivers: "local" (disk, dev). An S3-compatible driver (MinIO / AWS) plugs in here
 * with the same interface when the deployment target is chosen.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: "wx" });
  return { key, mimeType, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), fileName: safeName(file.name) };
}

export async function readStored(key: string): Promise<Buffer> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new ValidationError("Invalid file key"); // path traversal guard
  return readFile(full);
}
