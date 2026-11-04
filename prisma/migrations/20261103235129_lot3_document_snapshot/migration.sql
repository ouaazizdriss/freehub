-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "submittedCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_submittedCode_key" ON "Timesheet"("submittedCode");

