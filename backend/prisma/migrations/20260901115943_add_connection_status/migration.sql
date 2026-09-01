-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "status" "ConnectionStatus" NOT NULL DEFAULT 'CONFIRMED';
