-- DropIndex
DROP INDEX "Connection_userId_provider_key";

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userId_provider_providerUserId_key" ON "Connection"("userId", "provider", "providerUserId");

