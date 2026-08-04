/*
  Warnings:

  - Added the required column `organizationId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL_CASH', 'IMPORT_BANK', 'IMPORT_VENMO', 'IMPORT_CASHAPP', 'IMPORT_HAP', 'STRIPE_NATIVE');

-- CreateEnum
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'SHORT', 'LATE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('REPAIRS_MAINTENANCE', 'UTILITIES', 'INSURANCE', 'TAXES', 'MANAGEMENT_FEES', 'MORTGAGE', 'OTHER');

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_leaseId_fkey";

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "subsidyOwedCents" INTEGER,
ADD COLUMN     "subsidyPayerName" TEXT;

-- AlterTable
-- organizationId is added nullable first, backfilled from each payment's
-- lease (every existing row has one), then locked to NOT NULL — Postgres
-- can't add a required column with no default onto a populated table.
ALTER TABLE "Payment" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "payerNameRaw" TEXT,
ADD COLUMN     "reconciliationStatus" "PaymentReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL_CASH',
ALTER COLUMN "leaseId" DROP NOT NULL,
ALTER COLUMN "method" DROP NOT NULL;

-- DataMigration: backfill organizationId from the lease every existing
-- payment already belongs to.
UPDATE "Payment" p
SET "organizationId" = l."organizationId"
FROM "Lease" l
WHERE p."leaseId" = l."id";

ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;

-- DataMigration: every payment that already carries a real Stripe
-- identifier was, definitionally, collected natively through Stripe Connect
-- — reclassify it out of the MANUAL_CASH default the new column arrived
-- with. Everything else predates this feature and was hand-recorded by
-- staff, so MANUAL_CASH is the correct source for it (no import history
-- exists to attribute it to a CSV source instead).
UPDATE "Payment"
SET "source" = 'STRIPE_NATIVE'
WHERE "stripePaymentIntentId" IS NOT NULL OR "stripeCheckoutSessionId" IS NOT NULL;

-- DataMigration: placeholder reconciliation status for pre-existing rows —
-- every one of them already has a lease, so none are truly UNMATCHED. This
-- is intentionally approximate; the application runs a full reconciliation
-- pass (src/lib/reconciliation.ts) after this migration to compute the real
-- MATCHED/SHORT/LATE breakdown from each lease's actual charge history.
UPDATE "Payment"
SET "reconciliationStatus" = 'MATCHED'
WHERE "leaseId" IS NOT NULL AND "status" IN ('SUCCEEDED', 'PROCESSING');

-- CreateTable
CREATE TABLE "PaymentImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT,
    "rawCsv" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "amountCents" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentImportBatch_organizationId_createdAt_idx" ON "PaymentImportBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentImportBatch_organizationId_contentHash_key" ON "PaymentImportBatch"("organizationId", "contentHash");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_propertyId_date_idx" ON "Expense"("propertyId", "date");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_reconciliationStatus_idx" ON "Payment"("organizationId", "reconciliationStatus");

-- CreateIndex
CREATE INDEX "Payment_importBatchId_idx" ON "Payment"("importBatchId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PaymentImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentImportBatch" ADD CONSTRAINT "PaymentImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentImportBatch" ADD CONSTRAINT "PaymentImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
