-- AlterTable: Ajouter balance et rechargeCode à User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "balance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rechargeCode" TEXT;

-- Générer des codes de recharge uniques pour les utilisateurs existants
UPDATE "User" SET "rechargeCode" = REPLACE(gen_random_uuid()::text, '-', '') WHERE "rechargeCode" IS NULL;

-- Rendre rechargeCode NOT NULL + UNIQUE
ALTER TABLE "User" ALTER COLUMN "rechargeCode" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_rechargeCode_key" UNIQUE ("rechargeCode");

-- CreateTable: BalanceTx
CREATE TABLE IF NOT EXISTS "BalanceTx" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "senderId" TEXT,
    "receiverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceTx_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BalanceTx" ADD CONSTRAINT IF NOT EXISTS "BalanceTx_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BalanceTx" ADD CONSTRAINT IF NOT EXISTS "BalanceTx_receiverId_fkey"
    FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
