-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_freelancerId_month_kind_key" ON "ReminderLog"("freelancerId", "month", "kind");

