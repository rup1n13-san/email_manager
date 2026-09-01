/*
  Warnings:

  - You are about to drop the column `providerUserId` on the `Connection` table. All the data in the column will be lost.
  - The `provider` column on the `Connection` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `EmailPreference` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,provider,providerAccountId]` on the table `Connection` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[activeConnectionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `providerAccountId` to the `Connection` table without a default value. This is not possible if the table is not empty.
  - Made the column `email` on table `Connection` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ConnectionProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "NotificationStyle" AS ENUM ('COMPACT', 'DETAILED');

-- DropForeignKey
ALTER TABLE "EmailPreference" DROP CONSTRAINT "EmailPreference_userId_fkey";

-- DropIndex
DROP INDEX "Connection_userId_provider_providerUserId_key";

-- providerAccountId is NOT NULL with no default, so existing rows must go. Users re-link with /connect.
DELETE FROM "Connection";

-- AlterTable
ALTER TABLE "Connection" DROP COLUMN "providerUserId",
ADD COLUMN     "providerAccountId" TEXT NOT NULL,
DROP COLUMN "provider",
ADD COLUMN     "provider" "ConnectionProvider" NOT NULL DEFAULT 'GOOGLE',
ALTER COLUMN "refreshToken" DROP NOT NULL,
ALTER COLUMN "email" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeConnectionId" TEXT;

-- DropTable
DROP TABLE "EmailPreference";

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkIntervalHours" INTEGER NOT NULL DEFAULT 4,
    "notificationStyle" "NotificationStyle" NOT NULL DEFAULT 'COMPACT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userId_provider_providerAccountId_key" ON "Connection"("userId", "provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_activeConnectionId_key" ON "User"("activeConnectionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeConnectionId_fkey" FOREIGN KEY ("activeConnectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
