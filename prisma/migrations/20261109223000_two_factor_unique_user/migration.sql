-- One authenticator per user (better-auth deletes / looks it up by userId).
DROP INDEX IF EXISTS "TwoFactor_userId_idx";
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");
