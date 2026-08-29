-- CreateTable
CREATE TABLE "PortfolioImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT,
    "rawCsv" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "propertiesCreated" INTEGER NOT NULL DEFAULT 0,
    "unitsCreated" INTEGER NOT NULL DEFAULT 0,
    "tenantsCreated" INTEGER NOT NULL DEFAULT 0,
    "leasesCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PortfolioImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PortfolioImportBatch_organizationId_createdAt_idx" ON "PortfolioImportBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioImportBatch_organizationId_contentHash_key" ON "PortfolioImportBatch"("organizationId", "contentHash");
