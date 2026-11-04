-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FREELANCE', 'MANAGER', 'ADMIN', 'FINANCE');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DayHalf" AS ENUM ('AM', 'PM');

-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('LEAVE', 'UNAVAILABLE', 'SICK');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('URSSAF', 'INSURANCE', 'KBIS', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Freelancer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "company" TEXT,
    "siret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Freelancer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'MA',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "budgetHalfDays" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "dailyRateCents" INTEGER NOT NULL,
    "overtimeHourlyRateCents" INTEGER NOT NULL,
    "onCallRateCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "dailyRateCents" INTEGER,
    "overtimeHourlyRateCents" INTEGER,
    "onCallRateCents" INTEGER,
    "totalWorkHalfDays" INTEGER NOT NULL DEFAULT 0,
    "totalAbsenceHalfDays" INTEGER NOT NULL DEFAULT 0,
    "totalOvertimeHours" INTEGER NOT NULL DEFAULT 0,
    "totalOnCall" INTEGER NOT NULL DEFAULT 0,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "authCode" TEXT,
    "contentHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetDay" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "workHalfDays" INTEGER NOT NULL DEFAULT 0,
    "absenceHalfDays" INTEGER NOT NULL DEFAULT 0,
    "half" "DayHalf",
    "overtimeHours" INTEGER NOT NULL DEFAULT 0,
    "onCall" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "exceptionReason" TEXT,

    CONSTRAINT "TimesheetDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "kind" "AbsenceKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreelancerDocument" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "fileKey" TEXT,
    "expiresAt" DATE,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreelancerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "tentative" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Freelancer_userId_key" ON "Freelancer"("userId");

-- CreateIndex
CREATE INDEX "Mission_managerId_idx" ON "Mission"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_missionId_idx" ON "PurchaseOrder"("missionId");

-- CreateIndex
CREATE INDEX "Contract_freelancerId_idx" ON "Contract"("freelancerId");

-- CreateIndex
CREATE INDEX "Contract_missionId_idx" ON "Contract"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_authCode_key" ON "Timesheet"("authCode");

-- CreateIndex
CREATE INDEX "Timesheet_status_month_idx" ON "Timesheet"("status", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_freelancerId_purchaseOrderId_month_key" ON "Timesheet"("freelancerId", "purchaseOrderId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetDay_timesheetId_date_key" ON "TimesheetDay"("timesheetId", "date");

-- CreateIndex
CREATE INDEX "Absence_freelancerId_startDate_idx" ON "Absence"("freelancerId", "startDate");

-- CreateIndex
CREATE INDEX "FreelancerDocument_freelancerId_kind_idx" ON "FreelancerDocument"("freelancerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_freelancerId_key" ON "Signature"("freelancerId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_country_date_key" ON "Holiday"("country", "date");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Freelancer" ADD CONSTRAINT "Freelancer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetDay" ADD CONSTRAINT "TimesheetDay_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreelancerDocument" ADD CONSTRAINT "FreelancerDocument_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants métier non exprimables dans le schéma Prisma
ALTER TABLE "TimesheetDay"
  ADD CONSTRAINT "TimesheetDay_halfdays_range" CHECK ("workHalfDays" BETWEEN 0 AND 2 AND "absenceHalfDays" BETWEEN 0 AND 2),
  ADD CONSTRAINT "TimesheetDay_halfdays_sum" CHECK ("workHalfDays" + "absenceHalfDays" <= 2),
  ADD CONSTRAINT "TimesheetDay_overtime_range" CHECK ("overtimeHours" BETWEEN 0 AND 6),
  ADD CONSTRAINT "TimesheetDay_overtime_needs_work" CHECK ("overtimeHours" = 0 OR "workHalfDays" > 0);

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1),
  ADD CONSTRAINT "Timesheet_rejection_reason" CHECK ("status" <> 'REJECTED' OR "rejectionReason" IS NOT NULL);

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_rates_positive" CHECK ("dailyRateCents" > 0 AND "overtimeHourlyRateCents" >= 0 AND "onCallRateCents" >= 0),
  ADD CONSTRAINT "Contract_dates" CHECK ("endDate" >= "startDate");
