-- AlterTable
ALTER TABLE "User" ADD COLUMN     "entraOid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_entraOid_key" ON "User"("entraOid");

