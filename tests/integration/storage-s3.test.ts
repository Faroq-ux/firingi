/**
 * Phase 19: the S3 storage driver against a real S3-compatible server. Runs only when
 * S3_TEST_ENDPOINT is set, e.g. with the dev compose's SeaweedFS:
 *   S3_TEST_ENDPOINT=http://localhost:8333 S3_TEST_BUCKET=firingi-test pnpm vitest run tests/integration/storage-s3.test.ts
 * (keys default to the dev compose's firingi / firingi-secret; the bucket must exist).
 */
import { beforeAll, describe, expect, it } from "vitest";

const endpoint = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!endpoint)("S3 storage driver", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      STORAGE_DRIVER: "s3", S3_ENDPOINT: endpoint, S3_BUCKET: process.env.S3_TEST_BUCKET ?? "firingi-test", S3_REGION: "eu-west-1",
      S3_ACCESS_KEY_ID: process.env.S3_TEST_KEY ?? "firingi", S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET ?? "firingi-secret", S3_FORCE_PATH_STYLE: "true",
    });
  });

  it("is healthy, stores an upload (type sniffed) and reads it back", async () => {
    const { storageHealth, storeUpload, readStored, driver } = await import("@/server/services/storage");
    expect(driver()).toBe("s3");
    expect(await storageHealth()).toMatchObject({ ok: true, driver: "s3" });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("e2e-s3-" + Date.now())]);
    const stored = await storeUpload(new File([png], "../../photo.png", { type: "image/png" }), "proof-of-delivery");
    expect(stored.mimeType).toBe("image/png");
    expect(stored.key).toMatch(/^proof-of-delivery\/\d{4}\/[0-9a-f-]+\.png$/);
    expect(stored.fileName).not.toContain("/"); // only a label; the stored key is random
    expect((await readStored(stored.key)).equals(png)).toBe(true);
    await expect(readStored("../etc/passwd")).rejects.toThrow(/Invalid file key/);
  });

  it("reports a wrong key as unhealthy", async () => {
    process.env.S3_BUCKET = "bucket-that-does-not-exist-" + Date.now();
    const { storageHealth } = await import("@/server/services/storage");
    const h = await storageHealth();
    expect(h.ok).toBe(false);
  });
});
