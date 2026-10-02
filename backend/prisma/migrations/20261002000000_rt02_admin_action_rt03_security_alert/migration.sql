-- RT-02: append-only admin audit trail + RT-03: merchant security alerts.

-- CreateEnum
CREATE TYPE "SecurityAlertKind" AS ENUM ('APPROVAL_BURST', 'DEVICE_REGISTERED', 'DEVICE_REVOKED');

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "actorId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" "SecurityAlertKind" NOT NULL,
    "deviceId" TEXT,
    "message" TEXT NOT NULL,
    "count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_action_idx" ON "AdminAction"("action");

-- CreateIndex
CREATE INDEX "AdminAction_targetType_targetId_idx" ON "AdminAction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "SecurityAlert_merchantId_createdAt_idx" ON "SecurityAlert"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_merchantId_kind_idx" ON "SecurityAlert"("merchantId", "kind");

-- AddForeignKey
ALTER TABLE "SecurityAlert" ADD CONSTRAINT "SecurityAlert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
