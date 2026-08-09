-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "institutionName" TEXT,
    "institutionLogo" TEXT,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_organizationId_key" ON "BankConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_plaidItemId_key" ON "BankConnection"("plaidItemId");

-- CreateIndex
CREATE INDEX "BankConnection_status_idx" ON "BankConnection"("status");
