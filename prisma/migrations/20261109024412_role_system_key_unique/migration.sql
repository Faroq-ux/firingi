-- System role templates (companyId IS NULL) must have unique keys. The composite unique
-- (companyId, key) does not cover this because NULLs are distinct in Postgres.
CREATE UNIQUE INDEX role_system_key_unique ON "Role" (key) WHERE "companyId" IS NULL;
