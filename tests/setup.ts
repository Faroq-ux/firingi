import "dotenv/config";
// All tests run against the dedicated test database — never the dev database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi_test";
import os from "node:os";
import path from "node:path";
// Uploaded files and the dev mail outbox go to a throw-away folder during tests.
process.env.STORAGE_DIR = path.join(os.tmpdir(), "firingi-test-storage");
process.env.MAIL_DRIVER = "log";
