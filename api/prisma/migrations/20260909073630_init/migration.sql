-- CreateEnum
CREATE TYPE "Role" AS ENUM ('operator', 'qa');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('pending', 'verified');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('CleaningRecord', 'Equipment');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'operator',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningRecord" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "cleanedBy" TEXT NOT NULL,
    "cleanedAt" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CleaningRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" UUID NOT NULL,
    "changeSetId" UUID NOT NULL,
    "entityType" "AuditEntity" NOT NULL,
    "entityId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "actorId" UUID NOT NULL,
    "actorName" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_code_key" ON "Equipment"("code");

-- CreateIndex
CREATE INDEX "CleaningRecord_equipmentId_cleanedAt_id_idx" ON "CleaningRecord"("equipmentId", "cleanedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "CleaningRecord_equipmentId_status_cleanedAt_id_idx" ON "CleaningRecord"("equipmentId", "status", "cleanedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_changedAt_id_idx" ON "AuditEntry"("entityType", "entityId", "changedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_field_changedAt_idx" ON "AuditEntry"("entityType", "entityId", "field", "changedAt" DESC);

-- AddForeignKey
ALTER TABLE "CleaningRecord" ADD CONSTRAINT "CleaningRecord_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
