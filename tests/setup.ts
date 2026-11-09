import "dotenv/config";
// All tests run against the dedicated test database — never the dev database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi_test";
